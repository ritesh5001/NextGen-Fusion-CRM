import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

// An AI calling campaign: a list of numbers the Bolna voice agent works through
// on its own. Each number becomes one `AiCall`; the dispatcher
// (`services/aiCallDispatcher.ts`) dials queued calls of `running` campaigns.
export const AI_CAMPAIGN_STATUSES = ['draft', 'running', 'paused', 'completed', 'cancelled'] as const;
export type AiCampaignStatus = (typeof AI_CAMPAIGN_STATUSES)[number];

const aiCampaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: AI_CAMPAIGN_STATUSES, default: 'draft', index: true },
    // Overrides the integration's default agent / from-number ('' = use default).
    agentId: { type: String, default: '' },
    fromNumber: { type: String, default: '' },
    // Free text handed to the agent prompt as {service} / {pitch} so one agent can
    // pitch different offers per campaign.
    pitch: { type: String, default: '' },
    // Dial attempts per number: no-answer/busy is retried until this many.
    maxAttempts: { type: Number, default: 1, min: 1, max: 5 },
    retryDelayMin: { type: Number, default: 60, min: 5 },
    // Interested leads are assigned to this telecaller (optional) for follow-up.
    assignTo: { type: Types.ObjectId, ref: 'User' },
    // Save "not interested" / unknown outcomes as contacts too (default: interested only).
    saveAllContacts: { type: Boolean, default: false },
    totalNumbers: { type: Number, default: 0 },
    startedAt: { type: Date },
    completedAt: { type: Date },
    createdBy: { type: Types.ObjectId, ref: 'User' },
    workspace: { type: Types.ObjectId, ref: 'Workspace', required: true, index: true },
  },
  { timestamps: true }
);

aiCampaignSchema.index({ workspace: 1, createdAt: -1 });

aiCampaignSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type AiCampaignAttrs = InferSchemaType<typeof aiCampaignSchema>;
export type AiCampaignDoc = HydratedDocument<AiCampaignAttrs>;

export const AiCampaign = model('AiCampaign', aiCampaignSchema);
