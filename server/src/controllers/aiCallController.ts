import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { getPagination, paginated } from '../utils/pagination.js';
import { phoneKey } from '../utils/phone.js';
import { AiCampaign } from '../models/AiCampaign.js';
import { AiCall, AI_CALL_ACTIVE } from '../models/AiCall.js';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { getBolnaSettings, hasAllCreds, tokenMatches, type BolnaExecution } from '../services/bolnaService.js';
import { applyExecution, campaignStats, saveOutcome, tick } from '../services/aiCallService.js';
import type { CreateCampaignInput } from '../validators/aiCallValidators.js';

function oid(value: string, what = 'id'): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw ApiError.badRequest(`Invalid ${what}`);
  return new Types.ObjectId(value);
}

async function assertBolnaReady() {
  const s = await getBolnaSettings();
  if (!s?.enabled || !hasAllCreds(s)) {
    throw ApiError.badRequest('Set up Bolna first: Integrations → Bolna AI (API key + agent, then enable).');
  }
  return s;
}

async function findCampaign(req: Request) {
  const campaign = await AiCampaign.findOne({ _id: oid(String(req.params.id)), workspace: req.workspaceId });
  if (!campaign) throw ApiError.notFound('Campaign not found');
  return campaign;
}

// GET /ai-calls/campaigns — campaigns of the active workspace with live counts.
export const listCampaigns = asyncHandler(async (req: Request, res: Response) => {
  const campaigns = await AiCampaign.find({ workspace: req.workspaceId })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('assignTo', 'name')
    .lean();
  const stats = await campaignStats(String(req.workspaceId), campaigns.map((c) => c._id));
  const empty = { total: 0, queued: 0, active: 0, completed: 0, unreachable: 0, failed: 0, interested: 0, notInterested: 0, callback: 0 };
  res.json({
    success: true,
    data: campaigns.map((c) => {
      const { _id, ...counts } = stats.get(String(c._id)) ?? { _id: c._id, ...empty };
      void _id;
      return { ...c, stats: counts };
    }),
  });
});

// POST /ai-calls/campaigns — build a campaign from numbers and/or contacts.
export const createCampaign = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CreateCampaignInput;
  const workspace = String(req.workspaceId);
  const settings = await getBolnaSettings();
  if (body.startNow) await assertBolnaReady();
  const cc = settings?.defaultCountryCode || undefined;

  if (body.assignTo) {
    const ok = await User.exists({ _id: oid(body.assignTo, 'user id'), workspace, isActive: true });
    if (!ok) throw ApiError.badRequest('The selected telecaller is not active in this workspace');
  }

  const seen = new Set<string>();
  const rows: { name: string; phoneNumber: string; lead?: Types.ObjectId }[] = [];
  const invalid: string[] = [];

  function add(raw: string, name: string, lead?: Types.ObjectId) {
    const key = phoneKey(raw, cc);
    const digits = key.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) {
      invalid.push(raw);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ name, phoneNumber: key, lead });
  }

  for (const n of body.numbers) add(n.phone, n.name);

  if (body.contacts) {
    const filter: Record<string, unknown> = {
      workspace,
      status: { $nin: ['dnd', 'converted', 'not_interested'] },
    };
    if (body.contacts.callStatus !== 'any') filter.callStatus = body.contacts.callStatus;
    const leads = await Lead.find(filter).sort({ createdAt: 1 }).limit(body.contacts.limit).select('name phone').lean();
    for (const l of leads) add(l.phone, l.name, l._id);
  }

  if (!rows.length) {
    throw ApiError.badRequest(
      invalid.length ? `None of the numbers look valid (e.g. "${invalid[0]}")` : 'No numbers to call'
    );
  }

  // Pasted numbers that already exist as contacts are matched when the call ends.
  const campaign = await AiCampaign.create({
    name: body.name,
    pitch: body.pitch,
    agentId: body.agentId,
    fromNumber: body.fromNumber ?? '',
    maxAttempts: body.maxAttempts,
    retryDelayMin: body.retryDelayMin,
    assignTo: body.assignTo,
    saveAllContacts: body.saveAllContacts,
    totalNumbers: rows.length,
    status: body.startNow ? 'running' : 'draft',
    startedAt: body.startNow ? new Date() : undefined,
    createdBy: req.user!.id,
    workspace,
  });
  await AiCall.insertMany(rows.map((r) => ({ ...r, campaign: campaign._id, workspace })));
  if (body.startNow) void tick();

  res.status(201).json({ success: true, data: campaign, added: rows.length, invalid });
});

// GET /ai-calls/campaigns/:id
export const getCampaign = asyncHandler(async (req: Request, res: Response) => {
  const campaign = await findCampaign(req);
  const stats = await campaignStats(String(req.workspaceId), [campaign._id]);
  res.json({ success: true, data: { ...campaign.toJSON(), stats: stats.get(String(campaign._id)) } });
});

// PATCH /ai-calls/campaigns/:id/status — start | pause | cancel.
export const campaignAction = asyncHandler(async (req: Request, res: Response) => {
  const campaign = await findCampaign(req);
  const { action } = req.body as { action: 'start' | 'pause' | 'cancel' };

  if (action === 'start') {
    if (campaign.status === 'cancelled') throw ApiError.badRequest('A cancelled campaign cannot be restarted');
    await assertBolnaReady();
    campaign.status = 'running';
    campaign.startedAt ??= new Date();
    campaign.completedAt = undefined;
  } else if (action === 'pause') {
    if (campaign.status !== 'running') throw ApiError.badRequest('Only a running campaign can be paused');
    campaign.status = 'paused';
  } else {
    campaign.status = 'cancelled';
    campaign.completedAt = new Date();
    // Calls already ringing finish on their own; nothing new is dialled.
    await AiCall.updateMany({ campaign: campaign._id, status: 'queued' }, { status: 'cancelled' });
  }
  await campaign.save();
  if (action === 'start') void tick();
  res.json({ success: true, data: campaign });
});

// DELETE /ai-calls/campaigns/:id — removes the campaign and its call history.
// Contacts/leads it created stay in the CRM.
export const deleteCampaign = asyncHandler(async (req: Request, res: Response) => {
  const campaign = await findCampaign(req);
  const active = await AiCall.exists({ campaign: campaign._id, status: { $in: AI_CALL_ACTIVE } });
  if (active) throw ApiError.badRequest('Calls are still in progress — cancel the campaign and wait for them to end');
  await AiCall.deleteMany({ campaign: campaign._id });
  await campaign.deleteOne();
  res.json({ success: true, message: 'Campaign deleted' });
});

// GET /ai-calls/calls — the calls of a campaign (or all), newest activity first.
export const listCalls = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const filter: Record<string, unknown> = { workspace: req.workspaceId };
  if (q.campaign) filter.campaign = oid(q.campaign, 'campaign id');
  if (q.status) filter.status = q.status;
  if (q.interest) filter.interest = q.interest;
  if (q.search?.trim()) {
    const rx = new RegExp(q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { phoneNumber: rx }];
  }
  const pg = getPagination(q);
  const [data, total] = await Promise.all([
    AiCall.find(filter)
      .sort({ updatedAt: -1 })
      .skip(pg.skip)
      .limit(pg.limit)
      .populate('lead', 'name status qualified')
      .populate('campaign', 'name')
      .lean(),
    AiCall.countDocuments(filter),
  ]);
  res.json({ success: true, ...paginated(data, total, pg) });
});

async function findCall(req: Request) {
  const call = await AiCall.findOne({ _id: oid(String(req.params.id)), workspace: req.workspaceId });
  if (!call) throw ApiError.notFound('Call not found');
  return call;
}

// PATCH /ai-calls/calls/:id/interest — the admin overrides the agent's verdict
// (e.g. they listened to the recording). yes/callback saves the person as a lead.
export const setInterest = asyncHandler(async (req: Request, res: Response) => {
  const call = await findCall(req);
  const campaign = await AiCampaign.findById(call.campaign);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  call.interest = req.body.interest;
  call.processedAt = undefined;
  await call.save();
  const force = call.interest === 'yes' || call.interest === 'callback';
  await saveOutcome(call, campaign, await getBolnaSettings(), force);
  const fresh = await AiCall.findById(call._id).populate('lead', 'name status qualified').populate('campaign', 'name');
  res.json({ success: true, data: fresh });
});

// POST /ai-calls/calls/:id/retry — queue a finished call again right away.
export const retryCall = asyncHandler(async (req: Request, res: Response) => {
  const call = await findCall(req);
  if (AI_CALL_ACTIVE.includes(call.status as (typeof AI_CALL_ACTIVE)[number]) || call.status === 'queued') {
    throw ApiError.badRequest('This call is already queued or in progress');
  }
  const campaign = await AiCampaign.findById(call.campaign);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  if (campaign.status === 'cancelled') throw ApiError.badRequest('The campaign was cancelled');
  await assertBolnaReady();

  call.set({ status: 'queued', nextAttemptAt: new Date(), executionId: '', error: '', processedAt: undefined });
  await call.save();
  if (campaign.status === 'completed' || campaign.status === 'draft') {
    campaign.status = 'running';
    campaign.completedAt = undefined;
    campaign.startedAt ??= new Date();
    await campaign.save();
  }
  void tick();
  res.json({ success: true, data: call });
});

// POST /ai-calls/webhook?token=… (public) — Bolna's execution callback. Bolna
// doesn't sign requests, so the secret token in the URL authenticates it.
export const bolnaWebhook = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getBolnaSettings();
  if (!tokenMatches(settings, req.query.token)) throw ApiError.unauthorized('Bad webhook token');

  const ex = (req.body ?? {}) as BolnaExecution;
  const executionId = String(ex.id ?? ex.execution_id ?? '');
  if (executionId) {
    const call = await AiCall.findOne({ executionId });
    if (call) await applyExecution(call, ex);
  }
  // Always 200 so Bolna doesn't retry events for calls we don't track.
  res.json({ success: true });
});
