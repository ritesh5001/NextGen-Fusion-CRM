import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

// Singleton settings document(s) for third-party integrations, keyed by `key`.
// Currently only 'twilio'. Credentials live here (managed from the admin panel)
// instead of env vars. Secrets are never returned to the client raw — see
// `integrationController.sanitizeTwilio`.
const integrationSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true }, // e.g. 'twilio'
    enabled: { type: Boolean, default: false },
    // Twilio credentials.
    accountSid: { type: String, default: '' },
    authToken: { type: String, default: '' }, // secret
    apiKeySid: { type: String, default: '' },
    apiKeySecret: { type: String, default: '' }, // secret
    twimlAppSid: { type: String, default: '' },
    callerId: { type: String, default: '' },
    // TeleCMI (PIOPIY) credentials — used when `key` is 'telecmi'.
    // `appId` + `apiSecret` authenticate the REST API (recording playback); the
    // per-agent SIP user/password live on the User doc, not here.
    appId: { type: String, default: '' },
    apiSecret: { type: String, default: '' }, // secret
    // Regional SBC the browser softphone registers against, e.g. 'sbcind.telecmi.com'.
    sbcUri: { type: String, default: '' },
    // Which TeleCMI CHUB platform this account lives on — 'india' or 'global'.
    // Every REST endpoint differs between them (see telecmiService).
    apiRegion: { type: String, enum: ['india', 'global'], default: 'india' },
    // Call behaviour.
    recordCalls: { type: Boolean, default: true },
    // Prepended to dialled numbers that have no country code (e.g. '+91').
    defaultCountryCode: { type: String, default: '' },
    // Public base URL Twilio uses to reach our webhooks (overrides env fallback).
    publicServerUrl: { type: String, default: '' },
    updatedBy: { type: Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

integrationSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type IntegrationAttrs = InferSchemaType<typeof integrationSchema>;
export type IntegrationDoc = HydratedDocument<IntegrationAttrs>;

export const Integration = model('Integration', integrationSchema);
