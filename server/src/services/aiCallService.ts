/**
 * AI calling campaigns — the dispatcher loop and the "write the result into the
 * CRM" step for Bolna agent calls.
 *
 * The dispatcher (`startAiCallDispatcher`, every few seconds) is stateless: every
 * decision is read from Mongo, so a restart simply resumes where it left off.
 *   1. dial: claim queued calls of running campaigns (atomically, up to the
 *      integration's `maxConcurrent` in-flight calls) and ask Bolna to call them;
 *   2. reconcile: poll Bolna for in-flight calls the webhook hasn't settled — so
 *      campaigns still finish when the webhook isn't reachable (e.g. local dev);
 *   3. finish: mark running campaigns with nothing left to do as completed.
 *
 * When a call ends, `applyExecution` records it and `saveOutcome` turns an
 * interested person into a qualified Lead (and optionally everyone into contacts).
 */
import { Types } from 'mongoose';
import { AiCall, AI_CALL_ACTIVE, type AiCallDoc, type AiCallStatus } from '../models/AiCall.js';
import { AiCampaign, type AiCampaignDoc } from '../models/AiCampaign.js';
import { Lead, deriveCallStatus, type LeadDoc, type PhoneCallStatus } from '../models/Lead.js';
import type { IntegrationDoc } from '../models/Integration.js';
import { notify } from './notificationService.js';
import { phoneKey } from '../utils/phone.js';
import {
  BolnaApiError,
  getBolnaSettings,
  getExecution,
  hasAllCreds,
  isTerminal,
  mapStatus,
  normalizeExtracted,
  parseInterest,
  pickExtracted,
  placeCall,
  type BolnaExecution,
} from './bolnaService.js';

const TICK_MS = 5_000;
/** In-flight calls the webhook hasn't touched for this long get polled. */
const RECONCILE_AFTER_MS = 90_000;
/** A call stuck in flight this long is given up on. */
const GIVE_UP_AFTER_MS = 45 * 60_000;
const MAX_POLLS_PER_TICK = 10;

// ───────────────────────────── result → CRM ─────────────────────────────

const PHONE_SLOTS = [
  { field: 'phone', outcome: 'phone1Outcome', tag: 'phone1' },
  { field: 'altPhone', outcome: 'phone2Outcome', tag: 'phone2' },
  { field: 'altPhone2', outcome: 'phone3Outcome', tag: 'phone3' },
] as const;

/** Finds an existing contact in the workspace holding this number in any slot. */
export async function findLeadByPhone(workspace: Types.ObjectId | string, e164: string, cc?: string) {
  const digits = e164.replace(/\D/g, '');
  const tail = digits.slice(-Math.min(10, digits.length));
  if (tail.length < 6) return null;
  // Stored numbers may be formatted ("+91 70074 36164"), so allow junk between digits.
  const pattern = new RegExp(tail.split('').join('\\D*') + '\\D*$');
  const candidates = await Lead.find({
    workspace,
    $or: [{ phone: pattern }, { altPhone: pattern }, { altPhone2: pattern }],
  }).limit(20);
  return candidates.find((l) => slotOf(l, e164, cc) !== null) ?? null;
}

function slotOf(lead: LeadDoc, e164: string, cc?: string) {
  const key = phoneKey(e164, cc);
  return PHONE_SLOTS.find((s) => phoneKey(lead.get(s.field) as string, cc) === key) ?? null;
}

const INTEREST_TO_STATUS = {
  yes: 'interested',
  callback: 'callback',
  no: 'not_interested',
  unknown: 'in_progress',
} as const;

/**
 * Writes a finished, connected AI call into the CRM. Interested ('yes') people
 * become qualified Leads; 'callback' is saved as a contact to call back; 'no' and
 * unclear calls only update a contact that already exists — unless the campaign
 * saves everyone. Idempotent via `call.processedAt`.
 */
export async function saveOutcome(call: AiCallDoc, campaign: AiCampaignDoc, settings: IntegrationDoc | null, force = false) {
  if (!force) {
    // The webhook and the poller can both land here for one call — first one wins.
    const claimed = await AiCall.updateOne({ _id: call._id, processedAt: null }, { $set: { processedAt: new Date() } });
    if (!claimed.modifiedCount) return;
  }
  const cc = settings?.defaultCountryCode || undefined;
  const extracted = normalizeExtracted(call.extractedData);
  const interest = call.interest;

  let lead: LeadDoc | null = call.lead
    ? await Lead.findOne({ _id: call.lead, workspace: call.workspace })
    : await findLeadByPhone(String(call.workspace), call.phoneNumber, cc);

  const shouldCreate = force || interest === 'yes' || interest === 'callback' || campaign.saveAllContacts;
  if (!lead && !shouldCreate) {
    call.processedAt = new Date();
    await call.save();
    return;
  }

  const name = pickExtracted(extracted, /(^|\.)(name|full_?name|customer_?name)$/) || call.name;
  const email = pickExtracted(extracted, /email/);
  const company = pickExtracted(extracted, /company|business|organi[sz]ation/);
  const requirement = pickExtracted(extracted, /requirement|need|notes?$|interest_?details/);
  const callbackTime = pickExtracted(extracted, /callback|call_?back|follow.?up/);

  const isNew = !lead;
  if (!lead) {
    lead = new Lead({
      name: name || call.phoneNumber,
      phone: call.phoneNumber,
      source: 'ai_call',
      tags: ['ai-call'],
      createdBy: campaign.createdBy,
      workspace: call.workspace,
    });
  } else if (name && (!lead.name || lead.name === lead.phone)) {
    lead.name = name;
  }
  if (email && !lead.email) lead.email = email.toLowerCase();
  if (company && !lead.company) lead.company = company;
  if (!lead.tags.includes('ai-call')) lead.tags.push('ai-call');

  // Per-number outcome on whichever slot was dialled.
  const slot = slotOf(lead, call.phoneNumber, cc) ?? PHONE_SLOTS[0];
  const connected = call.status === 'completed';
  const phoneOutcome = lead.get(slot.outcome) ?? {};
  lead.set(slot.outcome, {
    ...phoneOutcome,
    callStatus: connected ? 'connected' : 'not_connected',
    leadOutcome: interest === 'yes' ? 'interested' : interest === 'no' ? 'not_interested' : (phoneOutcome.leadOutcome ?? 'none'),
    lastCalledAt: call.endedAt ?? new Date(),
  });
  lead.callStatus = deriveCallStatus(
    ...PHONE_SLOTS.map((s) => (lead!.get(s.outcome)?.callStatus ?? 'pending') as PhoneCallStatus)
  );

  // Never downgrade a contact a human already converted / marked DND.
  if (connected && !['converted', 'dnd'].includes(lead.status)) {
    if (interest !== 'unknown' || isNew) lead.status = INTEREST_TO_STATUS[interest];
  }
  if (interest === 'yes') lead.qualified = true;
  else if (interest === 'no' && connected && lead.status === 'not_interested') lead.qualified = false;
  lead.lastOutcome = `ai_${interest}`;
  lead.lastContactedAt = call.endedAt ?? new Date();

  const verdict = { yes: 'Interested ✅', no: 'Not interested', callback: 'Asked for a callback', unknown: 'Outcome unclear' }[interest];
  const parts = [`AI call (${campaign.name}): ${verdict}.`];
  if (call.summary) parts.push(call.summary);
  if (requirement) parts.push(`Requirement: ${requirement}`);
  if (callbackTime && interest === 'callback') parts.push(`Call back: ${callbackTime}`);
  lead.remarks.push({ text: parts.join(' ').slice(0, 2000), byName: 'AI Agent', byRole: 'ai', phone: slot.tag });

  let assignedNow = false;
  if (campaign.assignTo && !lead.assignedTo && (interest === 'yes' || interest === 'callback')) {
    lead.assignedTo = campaign.assignTo;
    lead.assignedAt = new Date();
    assignedNow = true;
  }

  await lead.save();
  call.lead = lead._id as unknown as AiCallDoc['lead'];
  call.processedAt = new Date();
  await call.save();

  if (interest === 'yes' || interest === 'callback') {
    const who = lead.name || call.phoneNumber;
    const title = interest === 'yes' ? `AI agent found an interested lead: ${who}` : `${who} asked for a callback`;
    const message = call.summary?.slice(0, 280) ?? '';
    const recipients = new Set<string>();
    if (campaign.createdBy) recipients.add(String(campaign.createdBy));
    if (assignedNow && campaign.assignTo) recipients.add(String(campaign.assignTo));
    await Promise.all(
      [...recipients].map((r) =>
        notify({
          recipient: r,
          type: r === String(campaign.assignTo) && assignedNow ? 'lead_assigned' : 'system',
          title,
          message,
          link: interest === 'yes' ? '/leads' : '/contacts',
          workspace: String(call.workspace),
        }).catch(() => undefined)
      )
    );
  }
}

// ─────────────────────────── execution → AiCall ───────────────────────────

/**
 * Records a Bolna execution (webhook or poll) on its call. On a terminal status it
 * either schedules a retry (no answer / busy, attempts left) or saves the outcome.
 */
export async function applyExecution(call: AiCallDoc, ex: BolnaExecution) {
  if (call.status === 'cancelled') return;
  if (isTerminal(call.status as AiCallStatus) && call.processedAt) return; // already settled

  const status = mapStatus(ex);
  // Events can arrive out of order; a late "in progress" never reopens an ended call.
  if (!isTerminal(status) && isTerminal(call.status as AiCallStatus)) return;
  call.providerStatus = String(ex.status ?? '');
  if (ex.transcript) call.transcript = ex.transcript;
  if (ex.summary) call.summary = ex.summary;
  const extracted = normalizeExtracted(ex.extracted_data);
  if (extracted) {
    call.extractedData = extracted;
    call.interest = parseInterest(extracted);
  }
  const tel = ex.telephony_data ?? {};
  if (tel.recording_url) call.recordingUrl = tel.recording_url;
  if (tel.hangup_reason) call.hangupReason = tel.hangup_reason;
  const duration = Number(ex.conversation_duration ?? ex.conversation_time ?? tel.duration ?? 0);
  if (duration > 0) call.durationSec = Math.round(duration);
  if (typeof ex.total_cost === 'number') call.cost = ex.total_cost;
  if (ex.error_message) call.error = String(ex.error_message).slice(0, 500);

  if (!isTerminal(status)) {
    call.status = 'in_progress';
    await call.save();
    return;
  }

  call.status = status;
  call.endedAt = new Date();
  const campaign = await AiCampaign.findById(call.campaign);

  const retryable = status === 'no_answer' || status === 'busy';
  if (retryable && campaign && call.attempts < campaign.maxAttempts && campaign.status !== 'cancelled') {
    call.status = 'queued';
    call.nextAttemptAt = new Date(Date.now() + campaign.retryDelayMin * 60_000);
    call.executionId = '';
    await call.save();
    return;
  }

  await call.save();
  if (!campaign) return;
  if (status === 'completed') {
    await saveOutcome(call, campaign, await getBolnaSettings());
  } else if (call.lead) {
    // Unreachable after all attempts: reflect it on the contact's number.
    await markNotConnected(call);
  }
}

async function markNotConnected(call: AiCallDoc) {
  const lead = await Lead.findOne({ _id: call.lead, workspace: call.workspace });
  if (!lead) return;
  const settings = await getBolnaSettings();
  const slot = slotOf(lead, call.phoneNumber, settings?.defaultCountryCode || undefined) ?? PHONE_SLOTS[0];
  const prev = lead.get(slot.outcome) ?? {};
  if (prev.callStatus === 'connected') return;
  lead.set(slot.outcome, { ...prev, callStatus: 'not_connected', lastCalledAt: new Date() });
  lead.callStatus = deriveCallStatus(
    ...PHONE_SLOTS.map((s) => (lead.get(s.outcome)?.callStatus ?? 'pending') as PhoneCallStatus)
  );
  await lead.save();
}

// ──────────────────────────────── dispatcher ────────────────────────────────

async function dialNext(settings: IntegrationDoc, runningIds: Types.ObjectId[]) {
  const now = new Date();
  const call = await AiCall.findOneAndUpdate(
    {
      campaign: { $in: runningIds },
      status: 'queued',
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }],
    },
    { $set: { status: 'dialing', dialedAt: now, error: '' }, $inc: { attempts: 1 } },
    { sort: { nextAttemptAt: 1, createdAt: 1 }, new: true }
  );
  if (!call) return false;

  const campaign = await AiCampaign.findById(call.campaign);
  try {
    call.executionId = await placeCall(settings, {
      agentId: campaign?.agentId || settings.agentId,
      to: call.phoneNumber,
      from: campaign?.fromNumber || settings.callerId || undefined,
      userData: {
        name: call.name || '',
        customer_name: call.name || '',
        phone: call.phoneNumber,
        service: campaign?.pitch || '',
        pitch: campaign?.pitch || '',
        campaign: campaign?.name || '',
      },
    });
    await call.save();
  } catch (e) {
    const err = e as BolnaApiError;
    const accountProblem = err instanceof BolnaApiError && [401, 402, 403].includes(err.status);
    if (accountProblem && campaign) {
      // Key/balance problem: every call would fail the same way, so stop and say so.
      call.status = 'queued';
      call.attempts = Math.max(0, call.attempts - 1);
      call.error = err.message;
      await call.save();
      campaign.status = 'paused';
      await campaign.save();
      if (campaign.createdBy) {
        await notify({
          recipient: String(campaign.createdBy),
          type: 'system',
          title: `AI campaign "${campaign.name}" paused`,
          message: err.message,
          link: '/ai-calling',
          workspace: String(campaign.workspace),
        }).catch(() => undefined);
      }
      return false;
    }
    call.status = 'failed';
    call.error = (err?.message ?? 'Call failed').slice(0, 500);
    call.endedAt = new Date();
    await call.save();
  }
  return true;
}

async function reconcile(settings: IntegrationDoc) {
  const cutoff = new Date(Date.now() - RECONCILE_AFTER_MS);
  const stale = await AiCall.find({ status: { $in: AI_CALL_ACTIVE }, updatedAt: { $lt: cutoff } })
    .sort({ updatedAt: 1 })
    .limit(MAX_POLLS_PER_TICK);
  for (const call of stale) {
    const age = Date.now() - (call.dialedAt?.getTime() ?? call.createdAt.getTime());
    if (!call.executionId) {
      // Claimed but never placed (server died mid-request).
      call.status = 'failed';
      call.error = 'Call was not placed';
      await call.save();
      continue;
    }
    try {
      await applyExecution(call, await getExecution(settings, call.executionId));
    } catch {
      /* transient — try again next tick */
    }
    if (AI_CALL_ACTIVE.includes(call.status as AiCallStatus)) {
      if (age > GIVE_UP_AFTER_MS) {
        call.status = 'failed';
        call.error = 'No final status from Bolna';
        await call.save();
      } else {
        await AiCall.updateOne({ _id: call._id }, { $set: { updatedAt: new Date() } }); // back of the queue
      }
    }
  }
}

async function finishCampaigns() {
  const running = await AiCampaign.find({ status: 'running' }).select('_id');
  for (const c of running) {
    const left = await AiCall.exists({ campaign: c._id, status: { $in: ['queued', ...AI_CALL_ACTIVE] } });
    if (!left) await AiCampaign.updateOne({ _id: c._id, status: 'running' }, { status: 'completed', completedAt: new Date() });
  }
}

let ticking = false;

export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const settings = await getBolnaSettings();
    if (!settings || !settings.enabled || !hasAllCreds(settings)) return;

    await reconcile(settings);

    const running = await AiCampaign.find({ status: 'running' }).select('_id');
    if (running.length) {
      const ids = running.map((c) => c._id);
      const limit = Math.max(1, settings.maxConcurrent ?? 3);
      let inFlight = await AiCall.countDocuments({ status: { $in: AI_CALL_ACTIVE } });
      while (inFlight < limit && (await dialNext(settings, ids))) inFlight++;
    }

    await finishCampaigns();
  } catch (e) {
    console.error('[ai-calls] dispatcher tick failed:', (e as Error).message);
  } finally {
    ticking = false;
  }
}

export function startAiCallDispatcher() {
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
}

/** Per-campaign counts for the UI, in one aggregation. */
export async function campaignStats(workspace: string, campaignIds: Types.ObjectId[]) {
  const rows = await AiCall.aggregate<{
    _id: Types.ObjectId;
    total: number;
    queued: number;
    active: number;
    completed: number;
    unreachable: number;
    failed: number;
    interested: number;
    notInterested: number;
    callback: number;
  }>([
    { $match: { workspace: new Types.ObjectId(workspace), campaign: { $in: campaignIds } } },
    {
      $group: {
        _id: '$campaign',
        total: { $sum: 1 },
        queued: { $sum: { $cond: [{ $eq: ['$status', 'queued'] }, 1, 0] } },
        active: { $sum: { $cond: [{ $in: ['$status', AI_CALL_ACTIVE] }, 1, 0] } },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        unreachable: { $sum: { $cond: [{ $in: ['$status', ['no_answer', 'busy']] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'cancelled']] }, 1, 0] } },
        interested: { $sum: { $cond: [{ $eq: ['$interest', 'yes'] }, 1, 0] } },
        notInterested: { $sum: { $cond: [{ $eq: ['$interest', 'no'] }, 1, 0] } },
        callback: { $sum: { $cond: [{ $eq: ['$interest', 'callback'] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
}
