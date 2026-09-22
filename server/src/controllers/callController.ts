import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { CallLog, DISPOSITION_TO_LEAD_STATUS, type Disposition } from '../models/CallLog.js';
import { CallRecording } from '../models/CallRecording.js';
import { Lead } from '../models/Lead.js';
import { FollowUp } from '../models/FollowUp.js';
import { getPagination, paginated } from '../utils/pagination.js';
import { User } from '../models/User.js';
import type { LogCallInput, SaveCustomContactInput, ClickToCallInput } from '../validators/callValidators.js';
import {
  isEnabled as telecmiEnabled,
  resolveAgentCredentials,
  getTelecmiSettings,
  clickToCall,
  reasonForCdr,
  fetchRecordingMedia as fetchTelecmiRecording,
} from '../services/telecmiService.js';
import {
  buildDialTwiml,
  generateVoiceToken,
  isEnabled as twilioEnabled,
  resolveCallerId,
  fetchRecordingMedia,
  getTwilioSettings,
  fetchDialFailureReason,
} from '../services/twilioService.js';

/** Normalizes a phone to a dial-able form, keeping a single leading '+'. */
function cleanPhone(raw: string): string {
  const trimmed = raw.trim().replace(/[^\d+]/g, '');
  return trimmed.startsWith('+')
    ? `+${trimmed.slice(1).replace(/\+/g, '')}`
    : trimmed.replace(/\+/g, '');
}

// Maps a call disposition to the per-phone (CALL STATUS / LEAD STATUS) columns so
// that calling a number + picking an outcome updates that number's row in the table.
const DISPOSITION_TO_PHONE_OUTCOME: Record<
  Disposition,
  { callStatus: 'connected' | 'not_connected' | 'incorrect_no'; leadOutcome: 'none' | 'interested' | 'not_interested' }
> = {
  interested: { callStatus: 'connected', leadOutcome: 'interested' },
  converted: { callStatus: 'connected', leadOutcome: 'interested' },
  callback: { callStatus: 'connected', leadOutcome: 'none' },
  not_interested: { callStatus: 'connected', leadOutcome: 'not_interested' },
  dnd: { callStatus: 'connected', leadOutcome: 'not_interested' },
  busy: { callStatus: 'not_connected', leadOutcome: 'none' },
  switched_off: { callStatus: 'not_connected', leadOutcome: 'none' },
  wrong_number: { callStatus: 'incorrect_no', leadOutcome: 'not_interested' },
};

// POST /calls — telecaller records a call update on one of their contacts.
// callStatus 'done'  → logs a CallLog with an outcome (disposition) and may promote to a Lead.
// callStatus 'not_done' → records the attempt only (no CallLog, no outcome).
export const logCall = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as LogCallInput;

  // A custom dial to a number that isn't saved has no contact — log the call on
  // its own so the outcome is never lost, and let the caller save it afterwards.
  const lead = body.lead ? await Lead.findOne({ _id: body.lead, workspace: req.workspaceId }) : null;
  if (body.lead && !lead) throw ApiError.notFound('Contact not found');

  // Telecallers may only update contacts assigned to them.
  if (lead && req.user!.role === 'telecaller' && String(lead.assignedTo) !== req.user!.id) {
    throw ApiError.forbidden('This contact is not assigned to you');
  }

  let followUp = null;
  const isDone = body.callStatus === 'done';
  const disposition = isDone ? (body.disposition as Disposition) : undefined;

  // Always log the call — connected (with a disposition) OR a not-connected attempt —
  // so every call shows up in Recents / call history.
  const callLog = await CallLog.create({
    lead: lead?._id,
    telecaller: req.user!.id,
    disposition,
    callStatus: isDone ? DISPOSITION_TO_PHONE_OUTCOME[disposition!].callStatus : 'not_connected',
    notes: body.notes || body.remark,
    durationSec: body.durationSec,
    nextFollowUpAt: body.nextFollowUpAt,
    twilioCallSid: body.twilioCallSid,
    provider: body.provider,
    mode: body.mode,
    telecmiCallId: body.telecmiCallId,
    telecmiRequestId: body.telecmiRequestId,
    phone: body.phone,
    phoneNumber: body.phoneNumber,
    workspace: req.workspaceId,
  });

  // Attach a recording if the provider's webhook already landed (see CallRecording).
  // Twilio stages by CallSid; TeleCMI stages by call id / click-to-call request id.
  const stagedKey =
    body.provider === 'telecmi'
      ? body.telecmiCallId || body.telecmiRequestId
      : body.twilioCallSid;

  if (stagedKey) {
    const rec = await CallRecording.findOne({ callSid: stagedKey });
    if (rec) {
      // For TeleCMI the staged value is a recording *file name*, not a URL.
      if (rec.recordingUrl) {
        if (body.provider === 'telecmi') callLog.recordingFile = rec.recordingUrl;
        else callLog.recordingUrl = rec.recordingUrl;
      }
      if (!body.durationSec && rec.durationSec) callLog.durationSec = rec.durationSec;
      await callLog.save();
    }
  }

  // Nothing further to update for a contact-less custom call.
  if (!lead) {
    res.status(201).json({ success: true, callLog, followUp: null, lead: null });
    return;
  }

  const slot =
    body.phone === 'phone2' ? lead.phone2Outcome : body.phone === 'phone3' ? lead.phone3Outcome : lead.phone1Outcome;
  const s = slot as { callStatus: string; leadOutcome: string; lastCalledAt?: Date };

  s.lastCalledAt = new Date();

  if (isDone) {
    lead.status = DISPOSITION_TO_LEAD_STATUS[disposition!] as typeof lead.status;
    lead.callStatus = 'done';
    lead.lastOutcome = disposition!;
    // Promote to a Lead when the outcome is a success.
    if (disposition === 'interested' || disposition === 'converted') lead.qualified = true;

    // Reflect the outcome on the dialled number's CALL STATUS / LEAD STATUS columns.
    const mapped = DISPOSITION_TO_PHONE_OUTCOME[disposition!];
    s.callStatus = mapped.callStatus;
    if (mapped.leadOutcome !== 'none') s.leadOutcome = mapped.leadOutcome;

    // Schedule a follow-up if a date was provided.
    if (body.nextFollowUpAt) {
      followUp = await FollowUp.create({
        lead: lead._id,
        telecaller: req.user!.id,
        scheduledAt: body.nextFollowUpAt,
        notes: body.notes || body.remark,
        callLog: callLog._id,
        workspace: req.workspaceId,
      });
    }
  } else {
    // Not done — record the attempt on the dialled number.
    lead.callStatus = 'not_done';
    s.callStatus = 'not_connected';
  }

  lead.lastContactedAt = new Date();
  lead.nextFollowUpAt = body.nextFollowUpAt ?? lead.nextFollowUpAt;

  // Append the remark to the shared timeline, tagged with the number that was dialled.
  if (body.remark) {
    lead.remarks.push({
      text: body.remark,
      by: req.user!.id,
      byName: req.user!.name,
      byRole: req.user!.role,
      phone: body.phone,
      createdAt: new Date(),
    });
  }

  await lead.save();

  res.status(201).json({ success: true, callLog, followUp, lead });
});

// POST /calls/save-contact — promotes a custom-dialled number into a real contact
// and back-links the CallLog that was already recorded for it, so the call and its
// outcome move onto the new contact's history instead of staying orphaned.
export const saveCustomContact = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as SaveCustomContactInput;
  const callLog = await CallLog.findOne({ _id: body.callLog, workspace: req.workspaceId });
  if (!callLog) throw ApiError.notFound('Call not found');
  if (req.user!.role === 'telecaller' && String(callLog.telecaller) !== req.user!.id) {
    throw ApiError.forbidden('This call is not yours');
  }
  if (callLog.lead) throw ApiError.badRequest('This call already belongs to a contact');

  const phone = cleanPhone(body.phone);
  // The same number may already exist in this workspace — adopt it rather than
  // creating a duplicate.
  let lead = await Lead.findOne({ phone, workspace: req.workspaceId });
  if (!lead) {
    lead = await Lead.create({
      name: body.name,
      phone,
      email: body.email || '',
      company: body.company,
      city: body.city,
      notes: body.notes,
      source: 'custom_call',
      // A telecaller saving their own call keeps it; an admin leaves it unassigned.
      assignedTo: req.user!.role === 'telecaller' ? req.user!.id : undefined,
      assignedAt: req.user!.role === 'telecaller' ? new Date() : undefined,
      status: req.user!.role === 'telecaller' ? 'assigned' : 'new',
      createdBy: req.user!.id,
      workspace: req.workspaceId,
    });
  }

  // Re-apply the call's outcome to the contact now that one exists.
  callLog.set('lead', lead._id);
  await callLog.save();

  const disposition = callLog.disposition as Disposition | undefined;
  if (disposition) {
    lead.status = DISPOSITION_TO_LEAD_STATUS[disposition] as typeof lead.status;
    lead.callStatus = 'done';
    lead.lastOutcome = disposition;
    if (disposition === 'interested' || disposition === 'converted') lead.qualified = true;
    const mapped = DISPOSITION_TO_PHONE_OUTCOME[disposition];
    const s = lead.phone1Outcome as { callStatus: string; leadOutcome: string; lastCalledAt?: Date };
    s.callStatus = mapped.callStatus;
    if (mapped.leadOutcome !== 'none') s.leadOutcome = mapped.leadOutcome;
    s.lastCalledAt = callLog.createdAt ?? new Date();
  } else {
    lead.callStatus = 'not_done';
  }
  lead.lastContactedAt = callLog.createdAt ?? new Date();

  if (callLog.notes) {
    lead.remarks.push({
      text: callLog.notes,
      by: req.user!.id,
      byName: req.user!.name,
      byRole: req.user!.role,
      phone: 'phone1',
      createdAt: new Date(),
    });
  }
  await lead.save();

  res.status(201).json({ success: true, lead, callLog });
});

// GET /calls?lead=  — call history; telecallers scoped to their own logs.
export const listCalls = asyncHandler(async (req: Request, res: Response) => {
  const pg = getPagination(req.query);
  const filter: Record<string, unknown> = { workspace: req.workspaceId };

  if (req.user!.role === 'telecaller') {
    filter.telecaller = req.user!.id;
  } else if (typeof req.query.telecaller === 'string' && req.query.telecaller) {
    filter.telecaller = req.query.telecaller;
  }
  if (typeof req.query.lead === 'string' && req.query.lead) filter.lead = req.query.lead;

  const [calls, total] = await Promise.all([
    CallLog.find(filter)
      .populate('lead', 'name phone')
      .populate('telecaller', 'name')
      .sort({ createdAt: -1 })
      .skip(pg.skip)
      .limit(pg.limit)
      .lean(),
    CallLog.countDocuments(filter),
  ]);

  res.json({ success: true, ...paginated(calls, total, pg) });
});

// GET /calls/:id/recording — streams a call's recording audio, proxied + authed
// against Twilio. Telecallers can only access their own calls.
export const streamRecording = asyncHandler(async (req: Request, res: Response) => {
  const call = await CallLog.findOne({ _id: req.params.id, workspace: req.workspaceId });
  if (!call) throw ApiError.notFound('Call not found');
  if (req.user!.role === 'telecaller' && String(call.telecaller) !== req.user!.id) {
    throw ApiError.forbidden('This call is not yours');
  }
  // TeleCMI references recordings by file name and streams them from its own REST
  // API; Twilio gives us a media URL. Either way the credentials stay server-side.
  const media =
    call.provider === 'telecmi'
      ? call.recordingFile
        ? await fetchTelecmiRecording(call.recordingFile)
        : null
      : call.recordingUrl
        ? await fetchRecordingMedia(call.recordingUrl)
        : null;

  if (!media) {
    const hasRecording = call.provider === 'telecmi' ? call.recordingFile : call.recordingUrl;
    if (!hasRecording) throw ApiError.notFound('No recording for this call');
    throw ApiError.serviceUnavailable('Could not fetch the recording');
  }

  res.setHeader('Content-Type', media.contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(media.buffer);
});

// GET /calls/config — tells the client whether in-app (Twilio) calling is
// available *for this user*. A telecaller needs a Twilio number assigned by the
// admin; a superadmin falls back to the default caller ID. `configured` and
// `hasCallerId` are reported separately so the client can distinguish "Twilio
// isn't set up at all" (tel: fallback) from "you have no number" (fixable by an
// admin) instead of silently degrading to a tel: link.
export const getCallConfig = asyncHandler(async (req: Request, res: Response) => {
  const configured = await twilioEnabled();
  const hasCallerId = configured && Boolean(await resolveCallerId(req.user!.id));
  const settings = await getTwilioSettings();

  // TeleCMI availability for this same user: configured globally AND assigned an agent.
  const cmiConfigured = await telecmiEnabled();
  const cmiCreds = cmiConfigured ? await resolveAgentCredentials(req.user!.id) : null;
  const cmiSettings = await getTelecmiSettings();

  const user = await User.findById(req.user!.id).select('callProvider');
  const twilioReady = configured && hasCallerId;
  const telecmiReady = cmiConfigured && Boolean(cmiCreds);

  // The stored preference only counts if that provider is actually usable; otherwise
  // fall back to whichever one is, so a telecaller is never stranded on a dead provider.
  const preferred = user?.callProvider === 'telecmi' ? 'telecmi' : 'twilio';
  const active = preferred === 'telecmi' && telecmiReady ? 'telecmi' : twilioReady ? 'twilio' : telecmiReady ? 'telecmi' : preferred;

  res.json({
    success: true,
    // Legacy top-level fields describe Twilio (kept so existing clients keep working).
    enabled: twilioReady,
    configured,
    hasCallerId,
    defaultCountryCode: settings?.defaultCountryCode ?? '',
    preferredProvider: preferred,
    activeProvider: active,
    providers: {
      twilio: {
        enabled: twilioReady,
        configured,
        hasCallerId,
        defaultCountryCode: settings?.defaultCountryCode ?? '',
      },
      telecmi: {
        enabled: telecmiReady,
        configured: cmiConfigured,
        hasAgent: Boolean(cmiCreds),
        defaultCountryCode: cmiSettings?.defaultCountryCode ?? '',
        // Click-to-call needs a phone for TeleCMI to ring first.
        clickToCallReady: telecmiReady,
      },
    },
  });
});

// PATCH /calls/provider — the caller picks which telephony backend they dial with.
// Self-service (not admin-only): every user chooses their own preference, and it's
// stored on their User doc so it follows them across devices.
export const setCallProvider = asyncHandler(async (req: Request, res: Response) => {
  const provider = req.body.provider as 'twilio' | 'telecmi';
  await User.updateOne({ _id: req.user!.id }, { $set: { callProvider: provider } });
  res.json({ success: true, provider });
});

// GET /calls/telecmi/credentials — hands the authenticated telecaller their OWN
// TeleCMI SIP credentials so the browser SDK can register with the SBC. Unlike
// Twilio there is no short-lived token to mint: the WebRTC SDK authenticates with
// the agent's SIP password directly, so it necessarily reaches that user's browser.
// Scoped to `req.user` — a user can never fetch another agent's credentials.
export const getTelecmiCredentials = asyncHandler(async (req: Request, res: Response) => {
  if (!(await telecmiEnabled())) throw ApiError.serviceUnavailable('TeleCMI calling is not configured');
  const creds = await resolveAgentCredentials(req.user!.id);
  if (!creds) {
    throw ApiError.forbidden('No TeleCMI agent is assigned to you. Ask an admin to assign one.');
  }
  const settings = await getTelecmiSettings();
  res.json({
    success: true,
    userId: creds.userId,
    password: creds.password,
    sbcUri: creds.sbcUri,
    defaultCountryCode: settings?.defaultCountryCode ?? '',
  });
});

// POST /calls/telecmi/click-to-call — TeleCMI rings the telecaller's own phone,
// then bridges the lead once they answer. No browser audio involved, so this works
// where WebRTC can't. The resulting CDR arrives later on the webhook below.
export const telecmiClickToCall = asyncHandler(async (req: Request, res: Response) => {
  if (!(await telecmiEnabled())) throw ApiError.serviceUnavailable('TeleCMI calling is not configured');
  const body = req.body as ClickToCallInput;

  const result = await clickToCall(req.user!.id, body.to);
  if (!result.ok) throw ApiError.badRequest(result.message);

  res.json({ success: true, requestId: result.requestId });
});

// POST /calls/telecmi/cdr — TeleCMI posts the Call Detail Record when a call
// completes. Public (TeleCMI can't carry our JWT); we authenticate it by matching
// the configured appid rather than a signature, which TeleCMI doesn't provide.
// Stages the result by call id so it can be attached to the CallLog, mirroring the
// Twilio recording/dial-status flow.
export const handleTelecmiCdr = asyncHandler(async (req: Request, res: Response) => {
  const settings = await getTelecmiSettings();
  const body = req.body as Record<string, unknown>;
  const appId = body.appid != null ? String(body.appid) : '';

  // Reject anything not carrying our app id — the only shared secret available here.
  if (!settings?.appId || appId !== String(settings.appId)) {
    throw ApiError.forbidden('Unrecognised TeleCMI app');
  }

  const callId = body.call_id != null ? String(body.call_id) : '';
  const uuid = body.cmiuuid != null ? String(body.cmiuuid) : '';
  const requestId = body.request_id != null ? String(body.request_id) : '';
  const filename = body.filename != null ? String(body.filename) : '';
  const status = body.status != null ? String(body.status) : '';
  const hangupReason = body.hangup_reason != null ? String(body.hangup_reason) : '';
  const answeredSec = Number(body.answeredsec) || 0;

  // Attach to the CallLog the telecaller already logged, matching on whichever id
  // we recorded at dial time (softphone → call id, click-to-call → request id).
  const match: Record<string, string>[] = [];
  if (callId) match.push({ telecmiCallId: callId });
  if (uuid) match.push({ telecmiCallId: uuid });
  if (requestId) match.push({ telecmiRequestId: requestId });

  if (match.length) {
    await CallLog.updateOne(
      { $or: match },
      {
        $set: {
          ...(filename ? { recordingFile: filename } : {}),
          ...(answeredSec ? { durationSec: answeredSec } : {}),
        },
      }
    );
  }

  // Also stage it by id so the client can poll for *why* a call failed, the same
  // way it polls Twilio's dial status.
  const stageKey = callId || uuid || requestId;
  if (stageKey) {
    await CallRecording.updateOne(
      { callSid: stageKey },
      {
        $set: {
          dialStatus: status === 'answered' ? 'completed' : status || 'failed',
          ...(filename ? { recordingUrl: filename } : {}),
          ...(answeredSec ? { durationSec: answeredSec } : {}),
          ...(reasonForCdr(status, hangupReason) ? { dialReason: reasonForCdr(status, hangupReason) } : {}),
        },
      },
      { upsert: true }
    );
  }

  res.json({ success: true });
});

// GET /calls/token — mints a short-lived Twilio Voice access token for the
// authenticated user's browser softphone (only if they have a caller ID).
export const getVoiceToken = asyncHandler(async (req: Request, res: Response) => {
  if (!(await twilioEnabled())) throw ApiError.serviceUnavailable('Calling is not configured');
  if (!(await resolveCallerId(req.user!.id))) {
    throw ApiError.forbidden('No calling number is assigned to you. Ask an admin to assign one.');
  }
  const { token, identity } = await generateVoiceToken(req.user!.id);
  res.json({ success: true, token, identity });
});

// POST /calls/voice — Twilio fetches this when the browser places a call. Returns
// TwiML that dials the lead from the *calling telecaller's* assigned number and
// records the call. The caller's identity rides in `From` (`client:<userId>`),
// baked into the signed access token, so the caller ID is server-authoritative.
// Public endpoint, protected by Twilio signature verification (see callRoutes).
export const handleVoice = asyncHandler(async (req: Request, res: Response) => {
  res.type('text/xml');
  const to = cleanPhone(typeof req.body.To === 'string' ? req.body.To : '');
  if (!/^\+?\d{6,15}$/.test(to)) {
    res.send('<Response><Say>Sorry, the number is invalid.</Say></Response>');
    return;
  }
  const callerUserId = (typeof req.body.From === 'string' ? req.body.From : '').replace(/^client:/, '');
  const callerId = callerUserId ? await resolveCallerId(callerUserId) : '';
  if (!callerId) {
    res.send('<Response><Say>No calling number is assigned to your account.</Say></Response>');
    return;
  }
  res.send(await buildDialTwiml(to, callerId));
});

// POST /calls/recording — Twilio posts the recording details when ready. Stages
// them in CallRecording (keyed by CallSid) and patches any existing CallLog.
// Public endpoint, protected by Twilio signature verification (see callRoutes).
export const handleRecording = asyncHandler(async (req: Request, res: Response) => {
  const callSid = typeof req.body.CallSid === 'string' ? req.body.CallSid : '';
  const recordingUrl = typeof req.body.RecordingUrl === 'string' ? req.body.RecordingUrl : undefined;
  const durationSec = req.body.RecordingDuration ? Number(req.body.RecordingDuration) : undefined;

  if (callSid && recordingUrl) {
    await CallRecording.updateOne(
      { callSid },
      { $set: { recordingUrl, ...(durationSec ? { durationSec } : {}) } },
      { upsert: true }
    );
    // If the disposition was already submitted, patch its CallLog too.
    await CallLog.updateOne({ twilioCallSid: callSid }, { $set: { recordingUrl } });
  }
  res.json({ success: true });
});

// POST /calls/dial-status — Twilio's <Dial> action callback. Records WHY the call
// ended (completed/busy/no-answer/failed/canceled) so the client can show a reason.
// Public, Twilio-signature protected. Returns empty TwiML to end the parent call.
export const handleDialStatus = asyncHandler(async (req: Request, res: Response) => {
  const callSid = typeof req.body.CallSid === 'string' ? req.body.CallSid : '';
  const dialStatus = typeof req.body.DialCallStatus === 'string' ? req.body.DialCallStatus : undefined;
  const durationSec = req.body.DialCallDuration ? Number(req.body.DialCallDuration) : undefined;

  if (callSid && dialStatus) {
    await CallRecording.updateOne(
      { callSid },
      { $set: { dialStatus, ...(durationSec ? { durationSec } : {}) } },
      { upsert: true }
    );
  }
  res.type('text/xml').send('<Response></Response>');
});

// GET /calls/dial-status/:callSid — lets the client poll the dial result after hangup.
// When the dial `failed` and we haven't resolved a specific reason yet, look it up
// from Twilio's Debugger alerts (which appear a couple seconds after the failure)
// and cache it — so a generic "failed" becomes e.g. "Invalid or unreachable number".
export const getDialStatus = asyncHandler(async (req: Request, res: Response) => {
  const callSid = req.params.callSid;
  const rec = await CallRecording.findOne({ callSid });

  if (rec && rec.dialStatus === 'failed' && !rec.dialReason) {
    const { errorCode, dialReason } = await fetchDialFailureReason(callSid);
    if (dialReason) {
      await CallRecording.updateOne(
        { callSid },
        { $set: { dialReason, ...(errorCode ? { errorCode } : {}) } }
      );
      rec.dialReason = dialReason;
      if (errorCode) rec.errorCode = errorCode;
    }
  }

  res.json({
    success: true,
    dialStatus: rec?.dialStatus ?? null,
    dialReason: rec?.dialReason ?? null,
    errorCode: rec?.errorCode ?? null,
  });
});

// POST /calls/status — optional call status callback; stores authoritative
// duration/status keyed by CallSid. Public, Twilio-signature protected.
export const handleStatus = asyncHandler(async (req: Request, res: Response) => {
  const callSid = typeof req.body.CallSid === 'string' ? req.body.CallSid : '';
  const status = typeof req.body.CallStatus === 'string' ? req.body.CallStatus : undefined;
  const durationSec = req.body.CallDuration ? Number(req.body.CallDuration) : undefined;

  if (callSid) {
    await CallRecording.updateOne(
      { callSid },
      { $set: { ...(status ? { status } : {}), ...(durationSec ? { durationSec } : {}) } },
      { upsert: true }
    );
  }
  res.json({ success: true });
});
