import { z } from 'zod';
import { DISPOSITIONS } from '../models/CallLog.js';
import { CALL_PROVIDERS } from '../models/User.js';

/** POST /calls/telecmi/click-to-call — ring the telecaller, then bridge the lead. */
export const clickToCallSchema = z.object({
  to: z.string().trim().min(1, 'A number to call is required'),
  lead: z.string().min(1).optional(),
});

export type ClickToCallInput = z.infer<typeof clickToCallSchema>;

/** PATCH /calls/provider — the caller's preferred telephony backend. */
export const setCallProviderSchema = z.object({
  provider: z.enum(CALL_PROVIDERS),
});

export const logCallSchema = z
  .object({
    // Optional: a custom call to an unsaved number has no contact (see logCall).
    lead: z.string().min(1).optional(),
    callStatus: z.enum(['done', 'not_done']).optional().default('done'),
    disposition: z.enum(DISPOSITIONS as [string, ...string[]]).optional(),
    notes: z.string().optional().default(''),
    remark: z.string().optional().default(''),
    durationSec: z.number().int().min(0).optional().default(0),
    nextFollowUpAt: z.coerce.date().optional(),
    twilioCallSid: z.string().optional(),
    // TeleCMI equivalents of twilioCallSid, plus which backend placed the call.
    provider: z.enum(CALL_PROVIDERS).optional().default('twilio'),
    mode: z.enum(['softphone', 'click_to_call']).optional().default('softphone'),
    telecmiCallId: z.string().optional(),
    telecmiRequestId: z.string().optional(),
    phone: z.enum(['phone1', 'phone2', 'phone3']).optional().default('phone1'),
    phoneNumber: z.string().optional().default(''),
  })
  .refine((d) => d.callStatus !== 'done' || !!d.disposition, {
    message: 'An outcome (disposition) is required when the call is marked done',
    path: ['disposition'],
  })
  // A call has to be identifiable: either it belongs to a contact, or it's a
  // custom dial and we keep the raw number.
  .refine((d) => !!d.lead || !!d.phoneNumber, {
    message: 'Either a contact or a phone number is required',
    path: ['lead'],
  });

export type LogCallInput = z.infer<typeof logCallSchema>;

/** POST /calls/custom — save a custom-dialled number as a contact after the fact. */
export const saveCustomContactSchema = z.object({
  callLog: z.string().min(1, 'callLog is required'),
  name: z.string().trim().min(1, 'Name is required'),
  phone: z.string().trim().min(1, 'Phone is required'),
  email: z.string().trim().email('Invalid email').optional().or(z.literal('')),
  company: z.string().trim().optional().default(''),
  city: z.string().trim().optional().default(''),
  notes: z.string().trim().optional().default(''),
});

export type SaveCustomContactInput = z.infer<typeof saveCustomContactSchema>;
