import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { CALL_PROVIDERS } from './User.js';

export type Disposition =
  | 'interested'
  | 'callback'
  | 'not_interested'
  | 'busy'
  | 'switched_off'
  | 'wrong_number'
  | 'dnd'
  | 'converted';

export const DISPOSITIONS: Disposition[] = [
  'interested',
  'callback',
  'not_interested',
  'busy',
  'switched_off',
  'wrong_number',
  'dnd',
  'converted',
];

/** Maps a call disposition to the resulting lead status. */
export const DISPOSITION_TO_LEAD_STATUS: Record<Disposition, string> = {
  interested: 'interested',
  callback: 'callback',
  not_interested: 'not_interested',
  busy: 'in_progress',
  switched_off: 'in_progress',
  wrong_number: 'not_interested',
  dnd: 'dnd',
  converted: 'converted',
};

const callLogSchema = new Schema(
  {
    // Optional: a custom call to a number that was never saved as a contact has
    // no Lead to attach to, but the call + its outcome must still be recorded.
    lead: { type: Types.ObjectId, ref: 'Lead', index: true },
    telecaller: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    // Optional: a "not connected" attempt or a plain call-status mark has no disposition.
    disposition: { type: String, enum: DISPOSITIONS },
    // The per-phone call status this log represents (connected/not_connected/voicemail/incorrect_no).
    callStatus: { type: String, enum: ['connected', 'not_connected', 'voicemail', 'incorrect_no'] },
    notes: { type: String, default: '' },
    durationSec: { type: Number, default: 0, min: 0 },
    nextFollowUpAt: { type: Date },
    // Which of the contact's numbers was dialled, and the actual number string.
    phone: { type: String, enum: ['phone1', 'phone2', 'phone3'], default: 'phone1' },
    phoneNumber: { type: String, default: '' },
    // Which telephony backend placed the call, and how.
    provider: { type: String, enum: CALL_PROVIDERS, default: 'twilio' },
    mode: { type: String, enum: ['softphone', 'click_to_call'], default: 'softphone' },
    // Twilio call correlation (set when the call was placed via the browser softphone).
    twilioCallSid: { type: String, index: true },
    // TeleCMI correlation: the SDK/CDR call id, and the click-to-call request id.
    telecmiCallId: { type: String, index: true },
    telecmiRequestId: { type: String, index: true },
    // TeleCMI recordings are referenced by file name and streamed through our proxy.
    recordingFile: { type: String },
    recordingUrl: { type: String },
    workspace: { type: Types.ObjectId, ref: 'Workspace', required: true, index: true },
  },
  { timestamps: true }
);

// Workspace-first compound indexes for Recents/history + per-contact call lists.
callLogSchema.index({ workspace: 1, telecaller: 1, createdAt: -1 });
callLogSchema.index({ workspace: 1, lead: 1 });

callLogSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.__v;
    return ret;
  },
});

export type CallLogAttrs = InferSchemaType<typeof callLogSchema>;
export type CallLogDoc = HydratedDocument<CallLogAttrs>;

export const CallLog = model('CallLog', callLogSchema);
