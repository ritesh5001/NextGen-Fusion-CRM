import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

// Stores Twilio recording/status callbacks keyed by CallSid. Twilio's webhooks
// arrive asynchronously (and may land before the telecaller submits a
// disposition), so we stage them here and let `logCall` attach the recording to
// the CallLog by CallSid — avoiding a race between the webhook and the user.
const callRecordingSchema = new Schema(
  {
    callSid: { type: String, required: true, unique: true, index: true },
    recordingUrl: { type: String },
    durationSec: { type: Number, min: 0 },
    status: { type: String },
    // Result of dialing the lead: completed | busy | no-answer | failed | canceled.
    dialStatus: { type: String },
    // When a dial fails, the Twilio error code on the child leg (e.g. 13224) and a
    // human-readable reason derived from it — so the UI can show *why* it failed.
    errorCode: { type: Number },
    dialReason: { type: String },
  },
  { timestamps: true }
);

callRecordingSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type CallRecordingAttrs = InferSchemaType<typeof callRecordingSchema>;
export type CallRecordingDoc = HydratedDocument<CallRecordingAttrs>;

export const CallRecording = model('CallRecording', callRecordingSchema);
