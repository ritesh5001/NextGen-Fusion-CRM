import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

export type LeadStatus =
  | 'new'
  | 'assigned'
  | 'in_progress'
  | 'interested'
  | 'callback'
  | 'not_interested'
  | 'converted'
  | 'dnd';

export const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'assigned',
  'in_progress',
  'interested',
  'callback',
  'not_interested',
  'converted',
  'dnd',
];

export const LEAD_PRIORITIES = ['low', 'medium', 'high'] as const;
export const CALL_STATUSES = ['pending', 'done', 'not_done'] as const;

export const PHONE_CALL_STATUSES = ['pending', 'connected', 'not_connected', 'voicemail', 'incorrect_no'] as const;
export type PhoneCallStatus = (typeof PHONE_CALL_STATUSES)[number];

export const PHONE_LEAD_OUTCOMES = ['none', 'interested', 'not_interested'] as const;
export type PhoneLeadOutcome = (typeof PHONE_LEAD_OUTCOMES)[number];

/** Derives the overall lead callStatus from the per-phone statuses. */
export function deriveCallStatus(...statuses: PhoneCallStatus[]): 'pending' | 'done' | 'not_done' {
  if (statuses.some((s) => s === 'connected')) return 'done';
  if (statuses.some((s) => s !== 'pending')) return 'not_done';
  return 'pending';
}

/** Derives overall lead status from per-phone outcomes. 'interested' always wins. Returns null when all 'none'. */
export function deriveLeadStatus(...outcomes: PhoneLeadOutcome[]) {
  if (outcomes.some((o) => o === 'interested')) return { status: 'interested' as const, qualified: true };
  if (outcomes.some((o) => o === 'not_interested')) return { status: 'not_interested' as const, qualified: false };
  return null;
}

const phoneOutcomeSchema = new Schema(
  {
    callStatus: { type: String, enum: PHONE_CALL_STATUSES, default: 'pending' },
    leadOutcome: { type: String, enum: PHONE_LEAD_OUTCOMES, default: 'none' },
    lastCalledAt: { type: Date },
  },
  { _id: false }
);

const remarkSchema = new Schema(
  {
    text: { type: String, required: true, trim: true },
    by: { type: Types.ObjectId, ref: 'User' },
    byName: { type: String, default: '' },
    byRole: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    phone: { type: String, enum: ['phone1', 'phone2', 'phone3'], default: null },
  },
  { _id: true }
);

const leadSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    altPhone: { type: String, trim: true, default: '' },
    altPhone2: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },
    title: { type: String, trim: true, default: '' },
    company: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: '' },
    source: { type: String, trim: true, default: 'manual' },
    tags: { type: [String], default: [] },
    status: { type: String, enum: LEAD_STATUSES, default: 'new', index: true },
    priority: { type: String, enum: LEAD_PRIORITIES, default: 'medium' },
    qualified: { type: Boolean, default: false, index: true },
    callStatus: { type: String, enum: CALL_STATUSES, default: 'pending', index: true },
    lastOutcome: { type: String, default: '' },
    remarks: { type: [remarkSchema], default: [] },
    assignedTo: { type: Types.ObjectId, ref: 'User', index: true },
    assignedAt: { type: Date },
    lastContactedAt: { type: Date },
    nextFollowUpAt: { type: Date },
    notes: { type: String, default: '' },
    phone1Outcome: { type: phoneOutcomeSchema, default: () => ({}) },
    phone2Outcome: { type: phoneOutcomeSchema, default: () => ({}) },
    phone3Outcome: { type: phoneOutcomeSchema, default: () => ({}) },
    createdBy: { type: Types.ObjectId, ref: 'User' },
    importBatch: { type: Types.ObjectId, ref: 'ImportBatch' },
    workspace: { type: Types.ObjectId, ref: 'Workspace', required: true, index: true },
  },
  { timestamps: true }
);

leadSchema.index({ name: 'text', phone: 'text', email: 'text', company: 'text' });

// Workspace-first compound indexes matching the list/stats query shapes so scoped
// queries hit an index instead of scanning the whole (multi-workspace) collection.
leadSchema.index({ workspace: 1, createdAt: -1 }); // default list + pagination count
leadSchema.index({ workspace: 1, assignedTo: 1 }); // telecaller scope / admin assignee filter
leadSchema.index({ workspace: 1, qualified: 1 }); // Leads tab
leadSchema.index({ workspace: 1, callStatus: 1 }); // call-status chips

leadSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type LeadAttrs = InferSchemaType<typeof leadSchema>;
export type LeadDoc = HydratedDocument<LeadAttrs>;

export const Lead = model('Lead', leadSchema);
