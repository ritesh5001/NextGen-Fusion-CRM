import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const FOLLOWUP_STATUSES = ['pending', 'done', 'missed'] as const;

const followUpSchema = new Schema(
  {
    lead: { type: Types.ObjectId, ref: 'Lead', required: true, index: true },
    telecaller: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    scheduledAt: { type: Date, required: true, index: true },
    status: { type: String, enum: FOLLOWUP_STATUSES, default: 'pending', index: true },
    notes: { type: String, default: '' },
    callLog: { type: Types.ObjectId, ref: 'CallLog' },
    workspace: { type: Types.ObjectId, ref: 'Workspace', required: true, index: true },
  },
  { timestamps: true }
);

// Workspace-first compound index for the scoped follow-up scope queries.
followUpSchema.index({ workspace: 1, telecaller: 1, status: 1, scheduledAt: 1 });

followUpSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type FollowUpAttrs = InferSchemaType<typeof followUpSchema>;
export type FollowUpDoc = HydratedDocument<FollowUpAttrs>;

export const FollowUp = model('FollowUp', followUpSchema);
