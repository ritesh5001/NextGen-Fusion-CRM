import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

// One number in an AI campaign, and what happened when the Bolna agent called it.
//
//   queued → dialing (POST /call accepted) → in_progress (Bolna reports ringing /
//   in-progress) → completed | no_answer | busy | failed   (or cancelled)
//
// `interest` is the agent's verdict from the call's extracted data: did the
// person say yes to the service? A 'yes' (and 'callback') is saved into the CRM.
export const AI_CALL_STATUSES = [
  'queued',
  'dialing',
  'in_progress',
  'completed',
  'no_answer',
  'busy',
  'failed',
  'cancelled',
] as const;
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number];

/** Statuses that still hold one of the concurrency slots. */
export const AI_CALL_ACTIVE: AiCallStatus[] = ['dialing', 'in_progress'];

export const AI_CALL_INTERESTS = ['unknown', 'yes', 'no', 'callback'] as const;
export type AiCallInterest = (typeof AI_CALL_INTERESTS)[number];

const aiCallSchema = new Schema(
  {
    campaign: { type: Types.ObjectId, ref: 'AiCampaign', required: true, index: true },
    workspace: { type: Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, trim: true, default: '' },
    phoneNumber: { type: String, required: true, trim: true }, // E.164
    // The CRM contact this call was for, or the one it created.
    lead: { type: Types.ObjectId, ref: 'Lead' },
    status: { type: String, enum: AI_CALL_STATUSES, default: 'queued', index: true },
    interest: { type: String, enum: AI_CALL_INTERESTS, default: 'unknown', index: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date },
    executionId: { type: String, default: '', index: true },
    // Raw Bolna execution status (e.g. 'call-disconnected', 'completed').
    providerStatus: { type: String, default: '' },
    summary: { type: String, default: '' },
    transcript: { type: String, default: '' },
    extractedData: { type: Schema.Types.Mixed },
    recordingUrl: { type: String, default: '' },
    durationSec: { type: Number, default: 0 },
    cost: { type: Number },
    hangupReason: { type: String, default: '' },
    error: { type: String, default: '' },
    dialedAt: { type: Date },
    endedAt: { type: Date },
    // Set once the result has been written into the CRM (idempotency for webhooks).
    processedAt: { type: Date },
  },
  { timestamps: true }
);

aiCallSchema.index({ workspace: 1, campaign: 1, createdAt: 1 });
aiCallSchema.index({ status: 1, nextAttemptAt: 1 }); // dispatcher pick-up

aiCallSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type AiCallAttrs = InferSchemaType<typeof aiCallSchema>;
export type AiCallDoc = HydratedDocument<AiCallAttrs>;

export const AiCall = model('AiCall', aiCallSchema);
