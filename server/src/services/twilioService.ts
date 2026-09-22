import twilio from 'twilio';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { env } from '../config/env.js';
import { Integration, type IntegrationDoc } from '../models/Integration.js';
import { User } from '../models/User.js';

const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken;
const { VoiceResponse } = twilio.twiml;

export const TWILIO_KEY = 'twilio';

/** Loads the saved Twilio settings (admin panel), or null if never configured. */
export async function getTwilioSettings(): Promise<IntegrationDoc | null> {
  return Integration.findOne({ key: TWILIO_KEY });
}

/** True when a settings doc has every credential needed to place a call. */
function hasAllCreds(s: IntegrationDoc): boolean {
  return Boolean(s.accountSid && s.apiKeySid && s.apiKeySecret && s.twimlAppSid && s.callerId);
}

/** True when calling is switched on AND fully configured. */
export async function isEnabled(): Promise<boolean> {
  const s = await getTwilioSettings();
  return Boolean(s && s.enabled && hasAllCreds(s));
}

/** Public base URL Twilio should use for our webhooks (panel value, else env). */
function publicBase(s: IntegrationDoc | null): string | undefined {
  const base = s?.publicServerUrl || env.publicUrl;
  return base ? base.replace(/\/$/, '') : undefined;
}

/**
 * Ensures a number is E.164: if it has no leading '+', prepends the default
 * country code (stripping any leading zeros from the local part).
 *
 * A number that already carries its own country code but was typed/stored without
 * the '+' (e.g. `97143062043`) must NOT be prefixed again — `+97197143062043` is
 * not a real number and Twilio fails the dial as invalid/unreachable. We only
 * treat the digits as local when prefixing actually produces a valid number.
 */
export function toE164(raw: string, defaultCountryCode?: string): string {
  const cleaned = raw.trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return `+${cleaned.slice(1).replace(/\+/g, '')}`;
  const digits = cleaned.replace(/\+/g, '');
  const local = digits.replace(/^0+/, '');
  const code = (defaultCountryCode || '').trim();
  if (!code) return digits;
  const plusCode = code.startsWith('+') ? code : `+${code}`;

  const asIs = parsePhoneNumberFromString(`+${digits}`);
  const prefixed = parsePhoneNumberFromString(`${plusCode}${local}`);
  if (asIs?.isValid() && !prefixed?.isValid()) return asIs.number;
  if (prefixed?.isValid()) return prefixed.number;
  if (asIs?.isPossible()) return asIs.number;
  return `${plusCode}${local}`;
}

/**
 * Resolves the caller-ID (Twilio number) a given user dials from:
 *  - a telecaller uses the number the admin assigned them (else none → can't call);
 *  - a superadmin uses their assigned number, else the global default caller ID.
 */
export async function resolveCallerId(userId: string): Promise<string> {
  const user = await User.findById(userId).select('twilioNumber role');
  const assigned = (user?.twilioNumber || '').trim();
  if (assigned) return assigned;
  if (user?.role === 'superadmin') {
    const s = await getTwilioSettings();
    return (s?.callerId || '').trim();
  }
  return '';
}

/**
 * Fetches a call recording's audio from Twilio, authenticated with the account
 * credentials. Twilio recording media requires HTTP Basic auth, so this must be
 * proxied server-side — never expose the recording URL/creds to the browser.
 */
export async function fetchRecordingMedia(
  recordingUrl: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const s = await getTwilioSettings();
  if (!s || !s.accountSid || !s.authToken) return null;
  const auth = Buffer.from(`${s.accountSid}:${s.authToken}`).toString('base64');

  const baseUrl = recordingUrl.replace(/\.(mp3|wav)$/i, '');
  const candidates = [
    { ext: '.mp3', requestedChannels: '2' },
    { ext: '.wav', requestedChannels: '2' },
    { ext: '.mp3', requestedChannels: '1' },
    { ext: '.wav', requestedChannels: '1' },
  ];

  for (const { ext, requestedChannels } of candidates) {
    const mediaUrl = new URL(`${baseUrl}${ext}`);
    mediaUrl.searchParams.set('RequestedChannels', requestedChannels);

    const resp = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) continue;

    const buffer = Buffer.from(await resp.arrayBuffer());
    return { buffer, contentType: resp.headers.get('content-type') || (ext === '.wav' ? 'audio/x-wav' : 'audio/mpeg') };
  }

  return null;
}

// Maps common Twilio call error codes (set on a failed dial) to a clear reason a
// telecaller can act on. See https://www.twilio.com/docs/api/errors.
const DIAL_ERROR_REASONS: Record<number, string> = {
  13214: 'Invalid caller ID — the number this call dials from is not valid.',
  13223: 'This number cannot be dialled from your account.',
  13224: 'Invalid or unreachable number — the number does not exist or cannot be reached. Check and update it.',
  13225: 'This number is blocked from being dialled.',
  13226: 'Invalid number — calling this number is not allowed.',
  13227: 'Calling this country is not enabled on the account (geo permissions).',
  21211: 'Invalid number — the number is not a valid phone number.',
  21214: 'This number could not be called (invalid or unreachable).',
  21215: 'Calling this country is not enabled on the account (geo permissions).',
  21401: 'Invalid number — not a valid phone number.',
  21601: 'This number is not a valid, callable phone number.',
};

/** Human reason for a Twilio call error code (falls back to a generic message). */
export function reasonForErrorCode(code?: number | null): string {
  if (code && DIAL_ERROR_REASONS[code]) return DIAL_ERROR_REASONS[code];
  return 'Call failed — the number may be wrong or unreachable. Try updating it.';
}

/**
 * Resolves *why* a call failed by reading Twilio's Debugger alerts, which carry
 * the error code (e.g. 13224 "invalid number") attached to the call SID. Alerts
 * land a few seconds after the failure, so this is meant to be retried (polled).
 * Best-effort — returns {} if nothing is found or Twilio can't be reached.
 */
export async function fetchDialFailureReason(
  callSid: string
): Promise<{ errorCode?: number; dialReason?: string }> {
  const s = await getTwilioSettings();
  if (!s || !s.accountSid || !s.authToken || !callSid) return {};
  try {
    const client = twilio(s.accountSid, s.authToken);
    const alerts = await client.monitor.v1.alerts.list({
      startDate: new Date(Date.now() - 15 * 60 * 1000),
      limit: 100,
    });
    const alert = alerts.find((a) => a.resourceSid === callSid && a.errorCode);
    if (!alert) return {};
    const code = Number(alert.errorCode);
    const errorCode = Number.isFinite(code) ? code : undefined;
    return { errorCode, dialReason: reasonForErrorCode(errorCode) };
  } catch {
    return {};
  }
}

/** Lists the account's voice-capable phone numbers (for the admin assignment UI). */
export async function listNumbers(): Promise<{ phoneNumber: string; friendlyName: string }[]> {
  const s = await getTwilioSettings();
  if (!s || !s.accountSid || !s.authToken) return [];
  const client = twilio(s.accountSid, s.authToken);
  const nums = await client.incomingPhoneNumbers.list({ limit: 100 });
  return nums
    .filter((n) => n.capabilities?.voice)
    .map((n) => ({ phoneNumber: n.phoneNumber, friendlyName: n.friendlyName || n.phoneNumber }));
}

/**
 * Mints a short-lived Voice access token for a telecaller's browser softphone.
 * Throws if calling isn't fully configured (callers should check `isEnabled`).
 */
export async function generateVoiceToken(identity: string): Promise<{ token: string; identity: string }> {
  const s = await getTwilioSettings();
  if (!s || !hasAllCreds(s)) throw new Error('Twilio is not configured');
  const token = new AccessToken(s.accountSid, s.apiKeySid, s.apiKeySecret, { identity, ttl: 3600 });
  token.addGrant(new VoiceGrant({ outgoingApplicationSid: s.twimlAppSid, incomingAllow: false }));
  return { token: token.toJwt(), identity };
}

/**
 * Builds the TwiML that dials the lead from the browser leg, using `callerId`
 * (the calling telecaller's assigned Twilio number). Records the call (dual
 * channel) when recording is enabled and asks Twilio to POST the recording back.
 */
export async function buildDialTwiml(to: string, callerId: string): Promise<string> {
  const s = await getTwilioSettings();
  const response = new VoiceResponse();
  const base = publicBase(s);
  const recordingCallback = base ? `${base}/api/v1/calls/recording` : undefined;

  const dialOptions: Record<string, unknown> = { callerId };
  // `action` makes Twilio POST the dial result (completed/busy/no-answer/failed) back to us.
  if (base) dialOptions.action = `${base}/api/v1/calls/dial-status`;
  if (s?.recordCalls) {
    dialOptions.record = 'record-from-answer-dual';
    if (recordingCallback) {
      dialOptions.recordingStatusCallback = recordingCallback;
      dialOptions.recordingStatusCallbackEvent = ['completed'];
    }
  }
  const dial = response.dial(dialOptions);
  // Ensure the dialled number carries a country code (Twilio needs E.164).
  dial.number(toE164(to, s?.defaultCountryCode));
  return response.toString();
}

/**
 * Verifies an incoming Twilio webhook request signature using the saved auth
 * token. Reconstructs the public URL so validation works behind a proxy/tunnel.
 */
export async function validateSignature(req: {
  headers: Record<string, unknown>;
  originalUrl: string;
  body: Record<string, unknown>;
}): Promise<boolean> {
  const s = await getTwilioSettings();
  if (!s || !s.authToken) return false;
  const signature = req.headers['x-twilio-signature'];
  if (typeof signature !== 'string') return false;
  const base = publicBase(s);
  if (!base) return false;
  const url = `${base}${req.originalUrl}`;
  return twilio.validateRequest(s.authToken, signature, url, req.body);
}
