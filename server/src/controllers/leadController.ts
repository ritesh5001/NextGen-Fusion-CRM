import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Lead, deriveCallStatus, deriveLeadStatus } from '../models/Lead.js';
import type { PhoneCallStatus, PhoneLeadOutcome } from '../models/Lead.js';
import { User } from '../models/User.js';
import { CallLog } from '../models/CallLog.js';
import { FollowUp } from '../models/FollowUp.js';
import { getPagination, paginated } from '../utils/pagination.js';
import { importLeads, previewImport } from '../services/importService.js';
import type { FieldMapping } from '../services/importService.js';
import { notify } from '../services/notificationService.js';
import { idOf } from '../utils/idOf.js';
import type { PhoneOutcomeInput } from '../validators/leadValidators.js';
import { compactPhoneFields, compactPhoneSlots, type SlotRemap } from '../utils/phoneSlots.js';

/**
 * Slides a lead's filled phone numbers up so the slots stay gap-free, moving each
 * number's outcome, remarks and call logs along with it. Does NOT save the lead —
 * the caller saves (it is already saving for its own edits).
 */
async function compactLeadPhones(lead: InstanceType<typeof Lead>): Promise<SlotRemap> {
  const remap = compactPhoneSlots(lead);
  if (remap.size === 0) return remap;

  for (const remark of lead.remarks as unknown as { phone?: 'phone1' | 'phone2' | 'phone3' | null }[]) {
    const target = remark.phone ? remap.get(remark.phone) : undefined;
    if (target) remark.phone = target;
  }
  lead.markModified('remarks');

  // Per old-slot, so a log is never shifted twice (e.g. phone3→phone2 then phone2→phone1).
  for (const [from, to] of remap) {
    await CallLog.updateMany({ lead: lead._id, phone: from }, { $set: { phone: to } });
  }
  return remap;
}

// Builds the Mongo filter from query params. `includeCallStatus=false` is used by
// the stats endpoint so chip counts reflect every callStatus within the same scope.
function buildFilter(req: Request, includeCallStatus = true): Record<string, unknown> {
  // Every query is scoped to the active workspace.
  const filter: Record<string, unknown> = { workspace: req.workspaceId };

  // Telecallers only ever see their own leads.
  if (req.user!.role === 'telecaller') {
    filter.assignedTo = req.user!.id;
  } else if (typeof req.query.assignedTo === 'string' && req.query.assignedTo) {
    filter.assignedTo = req.query.assignedTo === 'unassigned' ? null : req.query.assignedTo;
  }

  if (typeof req.query.status === 'string' && req.query.status) filter.status = req.query.status;
  if (typeof req.query.priority === 'string' && req.query.priority) filter.priority = req.query.priority;
  if (includeCallStatus && typeof req.query.callStatus === 'string' && req.query.callStatus)
    filter.callStatus = req.query.callStatus;
  // Leads tab passes qualified=true; Contacts tab omits it (shows everything).
  if (req.query.qualified === 'true') filter.qualified = true;
  else if (req.query.qualified === 'false') filter.qualified = false;

  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    const rx = new RegExp(req.query.search.trim(), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }, { company: rx }];
  }
  return filter;
}

const SORTABLE = new Set([
  'name',
  'company',
  'city',
  'country',
  'status',
  'callStatus',
  'lastContactedAt',
  'assignedAt',
  'createdAt',
  'qualified',
]);

function buildSort(req: Request): Record<string, 1 | -1> {
  const by = typeof req.query.sortBy === 'string' && SORTABLE.has(req.query.sortBy) ? req.query.sortBy : 'createdAt';
  const order: 1 | -1 = req.query.order === 'asc' ? 1 : -1;
  return { [by]: order };
}

export const listLeads = asyncHandler(async (req: Request, res: Response) => {
  const pg = getPagination(req.query);
  const filter = buildFilter(req);

  const [leads, total] = await Promise.all([
    Lead.find(filter)
      .populate('assignedTo', 'name email')
      .collation({ locale: 'en', strength: 2 }) // case-insensitive sort for name/company
      .sort(buildSort(req))
      .skip(pg.skip)
      .limit(pg.limit)
      .lean(),
    Lead.countDocuments(filter),
  ]);

  res.json({ success: true, ...paginated(leads, total, pg) });
});

// GET /leads/stats — counts for the clickable stat chips (scope minus callStatus).
// One `$facet` aggregation computes every chip in a single round-trip. Aggregation
// `$match` doesn't auto-cast ObjectIds (unlike find/count), so cast them here.
export const getLeadStats = asyncHandler(async (req: Request, res: Response) => {
  const match: Record<string, unknown> = buildFilter(req, false);
  if (typeof match.workspace === 'string') match.workspace = new Types.ObjectId(match.workspace);
  if (typeof match.assignedTo === 'string') match.assignedTo = new Types.ObjectId(match.assignedTo);

  const [row] = await Lead.aggregate<{
    total: { n: number }[];
    notCalled: { n: number }[];
    done: { n: number }[];
    notDone: { n: number }[];
    leads: { n: number }[];
  }>([
    { $match: match },
    {
      $facet: {
        total: [{ $count: 'n' }],
        notCalled: [{ $match: { callStatus: 'pending' } }, { $count: 'n' }],
        done: [{ $match: { callStatus: 'done' } }, { $count: 'n' }],
        notDone: [{ $match: { callStatus: 'not_done' } }, { $count: 'n' }],
        leads: [{ $match: { qualified: true } }, { $count: 'n' }],
      },
    },
  ]);

  const n = (a?: { n: number }[]) => a?.[0]?.n ?? 0;
  res.json({
    success: true,
    stats: {
      total: n(row?.total),
      notCalled: n(row?.notCalled),
      done: n(row?.done),
      notDone: n(row?.notDone),
      leads: n(row?.leads),
    },
  });
});

// GET /leads/export — all matching rows (capped) for client-side CSV.
export const exportLeads = asyncHandler(async (req: Request, res: Response) => {
  const filter = buildFilter(req);
  const leads = await Lead.find(filter)
    .populate('assignedTo', 'name')
    .collation({ locale: 'en', strength: 2 })
    .sort(buildSort(req))
    .limit(10000)
    .lean();
  res.json({ success: true, data: leads });
});

export const getLead = asyncHandler(async (req: Request, res: Response) => {
  const lead = await Lead.findOne({ _id: req.params.id, workspace: req.workspaceId }).populate(
    'assignedTo',
    'name email'
  );
  if (!lead) throw ApiError.notFound('Lead not found');
  if (req.user!.role === 'telecaller' && idOf(lead.assignedTo) !== req.user!.id) {
    throw ApiError.forbidden('This lead is not assigned to you');
  }
  res.json({ success: true, lead });
});

export const createLead = asyncHandler(async (req: Request, res: Response) => {
  const body = compactPhoneFields({ ...req.body });
  if (body.assignedTo) {
    body.status = 'assigned';
    body.assignedAt = new Date();
  }
  const lead = await Lead.create({ ...body, createdBy: req.user!.id, workspace: req.workspaceId });

  if (lead.assignedTo) {
    await notify({
      recipient: String(lead.assignedTo),
      type: 'lead_assigned',
      title: 'New lead assigned',
      message: `${lead.name} (${lead.phone})`,
      link: `/leads/${lead._id}`,
      workspace: req.workspaceId,
    });
  }
  res.status(201).json({ success: true, lead });
});

export const updateLead = asyncHandler(async (req: Request, res: Response) => {
  const lead = await Lead.findOne({ _id: req.params.id, workspace: req.workspaceId });
  if (!lead) throw ApiError.notFound('Lead not found');
  if (req.user!.role === 'telecaller' && String(lead.assignedTo) !== req.user!.id) {
    throw ApiError.forbidden('This lead is not assigned to you');
  }

  const body = { ...req.body };

  // Ownership is an admin power. The edit form only renders the field for admins,
  // but a telecaller could still post it — drop it rather than trust the client,
  // otherwise they could reassign a contact away from themselves (or grab another's).
  if (req.user!.role === 'telecaller') delete body.assignedTo;

  // Reassigning through the edit form should behave like PATCH /:id/assign:
  // validate the target and stamp the assignment metadata.
  if ('assignedTo' in body) {
    if (body.assignedTo) {
      if (idOf(lead.assignedTo) !== body.assignedTo) {
        await assertTelecaller(body.assignedTo, req.workspaceId);
        body.assignedAt = new Date();
        if (lead.status === 'new') body.status = body.status ?? 'assigned';
      }
    } else {
      body.assignedTo = null;
      body.assignedAt = null;
    }
  }

  Object.assign(lead, body);
  // Clearing/editing a number inline can leave a hole (e.g. phone2 emptied while
  // phone3 is filled) — slide the rest up so the slots stay contiguous.
  await compactLeadPhones(lead);
  await lead.save();
  res.json({ success: true, lead });
});

export const deleteLead = asyncHandler(async (req: Request, res: Response) => {
  const lead = await Lead.findOneAndDelete({ _id: req.params.id, workspace: req.workspaceId });
  if (!lead) throw ApiError.notFound('Lead not found');
  res.json({ success: true, message: 'Lead deleted' });
});

// POST /leads/:id/followup — schedule a follow-up inline (no CallLog logged).
export const scheduleFollowUp = asyncHandler(async (req: Request, res: Response) => {
  const lead = await Lead.findOne({ _id: req.params.id, workspace: req.workspaceId });
  if (!lead) throw ApiError.notFound('Contact not found');

  // Telecallers may only schedule follow-ups on contacts assigned to them.
  if (req.user!.role === 'telecaller' && idOf(lead.assignedTo) !== req.user!.id) {
    throw ApiError.forbidden('This contact is not assigned to you');
  }

  // The follow-up belongs to whoever the contact is assigned to (fallback: actor).
  const telecaller = idOf(lead.assignedTo) || req.user!.id;

  const followUp = await FollowUp.create({
    lead: lead._id,
    telecaller,
    scheduledAt: req.body.scheduledAt,
    notes: req.body.notes,
    workspace: req.workspaceId,
  });

  lead.nextFollowUpAt = req.body.scheduledAt;
  await lead.save();

  // If an admin scheduled it, notify the assigned telecaller.
  if (req.user!.role === 'superadmin' && telecaller && telecaller !== req.user!.id) {
    await notify({
      recipient: telecaller,
      type: 'followup_due',
      title: `Follow-up scheduled: ${lead.name}`,
      message: `Scheduled for ${new Date(req.body.scheduledAt).toLocaleString()}`,
      link: '/followups',
      workspace: req.workspaceId,
    });
  }

  res.status(201).json({ success: true, followUp, lead });
});

// POST /leads/:id/remarks — both roles add to the shared remark timeline.
export const addRemark = asyncHandler(async (req: Request, res: Response) => {
  const lead = await Lead.findOne({ _id: req.params.id, workspace: req.workspaceId });
  if (!lead) throw ApiError.notFound('Contact not found');

  // Telecallers may only remark on contacts assigned to them.
  if (req.user!.role === 'telecaller' && idOf(lead.assignedTo) !== req.user!.id) {
    throw ApiError.forbidden('This contact is not assigned to you');
  }

  lead.remarks.push({
    text: req.body.text,
    by: req.user!.id,
    byName: req.user!.name,
    byRole: req.user!.role,
    createdAt: new Date(),
  });
  await lead.save();

  // Notify the counterparty: superadmin → assigned telecaller; telecaller → contact creator.
  const recipient =
    req.user!.role === 'superadmin' ? idOf(lead.assignedTo) : idOf(lead.createdBy);
  if (recipient && recipient !== req.user!.id) {
    await notify({
      recipient,
      type: 'system',
      title: `New remark on ${lead.name}`,
      message: req.body.text,
      link: `/contacts`,
      workspace: req.workspaceId,
    });
  }

  res.status(201).json({ success: true, lead });
});

// Verifies the assignee is an active telecaller *in the same workspace* — you can
// never assign a contact/task to a telecaller from another workspace.
async function assertTelecaller(id: string, workspace: string | undefined) {
  const u = await User.findOne({ _id: id, role: 'telecaller', isActive: true, workspace });
  if (!u) throw ApiError.badRequest('Invalid or inactive telecaller');
  return u;
}

export const assignLead = asyncHandler(async (req: Request, res: Response) => {
  await assertTelecaller(req.body.assignedTo, req.workspaceId);
  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, workspace: req.workspaceId },
    { $set: { assignedTo: req.body.assignedTo, assignedAt: new Date(), status: 'assigned' } },
    { new: true }
  );
  if (!lead) throw ApiError.notFound('Lead not found');

  await notify({
    recipient: req.body.assignedTo,
    type: 'lead_assigned',
    title: 'New lead assigned',
    message: `${lead.name} (${lead.phone})`,
    link: `/leads/${lead._id}`,
    workspace: req.workspaceId,
  });
  res.json({ success: true, lead });
});

export const bulkAssignLeads = asyncHandler(async (req: Request, res: Response) => {
  const { leadIds, assignedTo } = req.body as { leadIds: string[]; assignedTo: string };
  await assertTelecaller(assignedTo, req.workspaceId);

  const result = await Lead.updateMany(
    { _id: { $in: leadIds }, workspace: req.workspaceId },
    { $set: { assignedTo, assignedAt: new Date(), status: 'assigned' } }
  );

  await notify({
    recipient: assignedTo,
    type: 'lead_assigned',
    title: `${result.modifiedCount} leads assigned`,
    message: 'New leads have been assigned to you',
    link: '/leads',
    workspace: req.workspaceId,
  });

  res.json({ success: true, modified: result.modifiedCount });
});

export const bulkDeleteLeads = asyncHandler(async (req: Request, res: Response) => {
  const { leadIds } = req.body as { leadIds: string[] };
  const result = await Lead.deleteMany({ _id: { $in: leadIds }, workspace: req.workspaceId });
  res.json({ success: true, deleted: result.deletedCount });
});

// POST /leads/import/preview — returns the file's headers + a small sample for column mapping.
export const previewImportHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded (field name must be "file")');
  const preview = previewImport(req.file.buffer);
  if (!preview.headers.length) throw ApiError.badRequest('No header row found in the file');
  res.json({ success: true, preview });
});

export const importLeadsHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded (field name must be "file")');
  const assignedTo = typeof req.body.assignedTo === 'string' && req.body.assignedTo ? req.body.assignedTo : undefined;
  if (assignedTo) await assertTelecaller(assignedTo, req.workspaceId);

  // Optional admin-defined column mapping (sent as a JSON string in the multipart body).
  let mapping: FieldMapping | undefined;
  if (typeof req.body.mapping === 'string' && req.body.mapping.trim()) {
    try {
      mapping = JSON.parse(req.body.mapping) as FieldMapping;
    } catch {
      throw ApiError.badRequest('Invalid column mapping');
    }
  }

  const duplicateStrategy =
    req.body.duplicateStrategy === 'update' || req.body.duplicateStrategy === 'import'
      ? req.body.duplicateStrategy
      : 'skip';

  const result = await importLeads(
    req.file.buffer,
    req.file.originalname,
    req.user!.id,
    req.workspaceId!,
    assignedTo,
    mapping,
    duplicateStrategy
  );

  if (assignedTo && result.successCount > 0) {
    await notify({
      recipient: assignedTo,
      type: 'lead_assigned',
      title: `${result.successCount} leads assigned`,
      message: 'Imported leads have been assigned to you',
      link: '/leads',
      workspace: req.workspaceId,
    });
  }
  res.status(201).json({ success: true, result });
});

export const updatePhoneOutcome = asyncHandler(async (req: Request, res: Response) => {
  const { phone, callStatus, leadOutcome, remark } = req.body as PhoneOutcomeInput;

  const lead = await Lead.findOne({ _id: req.params.id, workspace: req.workspaceId });
  if (!lead) throw ApiError.notFound('Contact not found');

  if (req.user!.role === 'telecaller' && idOf(lead.assignedTo) !== req.user!.id) {
    throw ApiError.forbidden('This contact is not assigned to you');
  }

  const slot =
    phone === 'phone1' ? lead.phone1Outcome : phone === 'phone2' ? lead.phone2Outcome : lead.phone3Outcome;

  if (callStatus) {
    (slot as { callStatus: PhoneCallStatus }).callStatus = callStatus;

    // Any call-status change counts as contact activity — stamp the last-contacted date.
    lead.lastContactedAt = new Date();

    const telecaller = idOf(lead.assignedTo) || req.user!.id;

    if (callStatus === 'connected') {
      // Default a follow-up to 2 weeks out when a call connects and none is set yet.
      if (!lead.nextFollowUpAt) {
        const followUpAt = new Date();
        followUpAt.setDate(followUpAt.getDate() + 14);
        lead.nextFollowUpAt = followUpAt;
        await FollowUp.create({
          lead: lead._id,
          telecaller,
          scheduledAt: followUpAt,
          notes: 'Auto-scheduled 2 weeks after connected call',
          workspace: req.workspaceId,
        });
      }
    } else if (callStatus === 'not_connected') {
      // Reschedule a retry follow-up one week out when the call didn't connect.
      const followUpAt = new Date();
      followUpAt.setDate(followUpAt.getDate() + 7);
      lead.nextFollowUpAt = followUpAt;
      // Update the latest pending follow-up if one exists, else create a fresh one.
      const pending = await FollowUp.findOne({ lead: lead._id, status: 'pending' }).sort({ scheduledAt: -1 });
      if (pending) {
        pending.scheduledAt = followUpAt;
        pending.notes = 'Auto-rescheduled 1 week after not-connected call';
        await pending.save();
      } else {
        await FollowUp.create({
          lead: lead._id,
          telecaller,
          scheduledAt: followUpAt,
          notes: 'Auto-scheduled 1 week after not-connected call',
          workspace: req.workspaceId,
        });
      }
    }
  }
  if (leadOutcome) {
    (slot as { leadOutcome: PhoneLeadOutcome }).leadOutcome = leadOutcome;
    if (leadOutcome !== 'none') lead.lastOutcome = leadOutcome;
  }

  lead.callStatus = deriveCallStatus(
    (lead.phone1Outcome as { callStatus: PhoneCallStatus }).callStatus,
    (lead.phone2Outcome as { callStatus: PhoneCallStatus }).callStatus,
    (lead.phone3Outcome as { callStatus: PhoneCallStatus }).callStatus
  );

  const derived = deriveLeadStatus(
    (lead.phone1Outcome as { leadOutcome: PhoneLeadOutcome }).leadOutcome,
    (lead.phone2Outcome as { leadOutcome: PhoneLeadOutcome }).leadOutcome,
    (lead.phone3Outcome as { leadOutcome: PhoneLeadOutcome }).leadOutcome
  );
  if (derived !== null) {
    lead.status = derived.status;
    lead.qualified = derived.qualified;
  }

  // A call-status change (via the dropdown) is a call activity — log it so it shows
  // in Recents / call history, mirroring how the softphone disposition is logged.
  if (callStatus && callStatus !== 'pending') {
    (slot as { lastCalledAt?: Date }).lastCalledAt = new Date();
    const lo = (slot as { leadOutcome: PhoneLeadOutcome }).leadOutcome;
    const number = phone === 'phone1' ? lead.phone : phone === 'phone2' ? lead.altPhone : lead.altPhone2;
    await CallLog.create({
      lead: lead._id,
      telecaller: idOf(lead.assignedTo) || req.user!.id,
      disposition: lo === 'interested' ? 'interested' : lo === 'not_interested' ? 'not_interested' : undefined,
      callStatus,
      phone,
      phoneNumber: number || '',
      notes: remark?.trim() || '',
      workspace: req.workspaceId,
    });
  }

  if (remark?.trim()) {
    lead.remarks.push({
      text: remark.trim(),
      by: req.user!.id as unknown as typeof lead.remarks[0]['by'],
      byName: req.user!.name ?? '',
      byRole: req.user!.role,
      createdAt: new Date(),
      phone,
    } as typeof lead.remarks[0]);
  }

  await lead.save();
  res.json({ success: true, lead });
});
