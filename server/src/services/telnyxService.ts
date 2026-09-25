/**
 * Telnyx telephony provider — the third calling backend alongside Twilio and TeleCMI.
 *
 * Browser calling uses the `@telnyx/webrtc` SDK authenticated with a short-lived
 * JWT, so — like Twilio and unlike TeleCMI — no SIP password ever reaches the
 * browser. The chain is:
 *
 *   Credential Connection (admin creates it in the Telnyx portal, id saved here)
 *     └─ Telephony Credential  (one per CRM user, created on demand, id on User)
 *          └─ JWT access token (minted per session, valid 24h)
 *
 * Calls go straight out through the connection's outbound voice profile (no call
 * parking), so there is no dial/bridge webhook to answer. The connection's webhook
 * URL still points at us: Telnyx reports each call's answer/hangup there, which is
 * where we start recording and learn why a call failed. Those webhooks are signed
 * with Ed25519 (account public key) over `timestamp|rawBody`.
 *
 * Everything is configured from the admin panel (Integration doc `key:'telnyx'`),
 * never env vars.
 */
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import { env } from '../config/env.js';
import { Integration, type IntegrationDoc } from '../models/Integration.js';
import { User } from '../models/User.js';
import { toE164 as twilioToE164 } from './twilioService.js';

export const TELNYX_KEY = 'telnyx';

const API_BASE = 'https://api.telnyx.com/v2';

/** Webhooks older/newer than this are rejected as replays (matches Telnyx's SDK). */
const SIGNATURE_TOLERANCE_SEC = 300;

/** Loads the saved Telnyx settings (admin panel), or null if never configured. */
export async function getTelnyxSettings(): Promise<IntegrationDoc | null> {
  return Integration.findOne({ key: TELNYX_KEY });
}

/** True when a settings doc has what browser calling needs. */
function hasAllCreds(s: IntegrationDoc): boolean {
  return Boolean(s.apiKey && s.connectionId);
}

/** True when Telnyx calling is switched on AND fully configured. */
export async function isEnabled(): Promise<boolean> {
  const s = await getTelnyxSettings();
  return Boolean(s && s.enabled && hasAllCreds(s));
}

/** Public base URL Telnyx should use for our webhook (panel value, else env). */
export function publicBase(s: IntegrationDoc | null): string | undefined {
  const base = s?.publicServerUrl || env.publicUrl;
  return base ? base.replace(/\/$/, '') : undefined;
}

/** The URL to register as the credential connection's webhook. */
export function webhookUrlFor(s: IntegrationDoc | null): string {
  const base = publicBase(s);
  return base ? `${base}/api/v1/calls/telnyx/webhook` : '';
}

/** Same E.164 rule as the other providers (never double-prefix a country code). */
export function toE164(raw: string, defaultCountryCode?: string): string {
  return twilioToE164(raw, defaultCountryCode);
}

export class TelnyxApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/**
 * Calls the Telnyx v2 REST API with the stored (or a supplied) API key and turns
 * Telnyx's `{ errors: [{ title, detail }] }` into a readable message.
 */
async function telnyxFetch<T>(
  apiKey: string,
  pathname: string,
  init: { method?: string; body?: unknown; query?: Record<string, string>; raw?: boolean } = {}
): Promise<T> {
  const url = new URL(`${API_BASE}${pathname}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

  const resp = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: init.raw ? 'text/plain' : 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!resp.ok) {
    const data = (await resp.json().catch(() => null)) as
      | { errors?: { title?: string; detail?: string }[] }
      | null;
    const first = data?.errors?.[0];
    const detail = first?.detail || first?.title;
    const message =
      resp.status === 401
        ? 'Telnyx rejected the API key. Check it in Telnyx → Account settings → Keys & credentials.'
        : detail || `Telnyx request failed (HTTP ${resp.status})`;
    throw new TelnyxApiError(message, resp.status);
  }

  if (init.raw) return (await resp.text()) as T;
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

/** Requires a configured API key, else throws a clear error for the admin. */
async function requireApiKey(): Promise<{ s: IntegrationDoc; apiKey: string }> {
  const s = await getTelnyxSettings();
  const apiKey = (s?.apiKey || '').trim();
  if (!s || !apiKey) throw new TelnyxApiError('Telnyx API key is not configured.', 400);
  return { s, apiKey };
}

export interface TelnyxConnectionSummary {
  id: string;
  name: string;
  active: boolean;
  webhookUrl: string;
  hasOutboundProfile: boolean;
}

/**
 * Lists the account's credential connections — the admin picks the one the
 * softphone logs in through. Accepts an unsaved key so "Test" works before Save.
 */
export async function listCredentialConnections(apiKeyOverride?: string): Promise<TelnyxConnectionSummary[]> {
  const apiKey = (apiKeyOverride || (await getTelnyxSettings())?.apiKey || '').trim();
  if (!apiKey) throw new TelnyxApiError('Enter the Telnyx API key first.', 400);

  const res = await telnyxFetch<{
    data: {
      id: string;
      connection_name?: string;
      active?: boolean;
      webhook_event_url?: string;
      outbound?: { outbound_voice_profile_id?: string };
    }[];
  }>(apiKey, '/credential_connections', { query: { 'page[size]': '100' } });

  return (res.data ?? []).map((c) => ({
    id: String(c.id),
    name: c.connection_name || String(c.id),
    active: c.active !== false,
    webhookUrl: c.webhook_event_url || '',
    hasOutboundProfile: Boolean(c.outbound?.outbound_voice_profile_id),
  }));
}

/**
 * Points the chosen credential connection's webhooks at this server (API v2), so
 * the admin doesn't have to paste the URL into the portal by hand. Parking stays
 * off: calls dial straight out and we only observe them.
 */
export async function applyWebhookToConnection(): Promise<{ connectionId: string; webhookUrl: string }> {
  const { s, apiKey } = await requireApiKey();
  const connectionId = (s.connectionId || '').trim();
  if (!connectionId) throw new TelnyxApiError('Choose a credential connection first.', 400);
  const webhookUrl = webhookUrlFor(s);
  if (!webhookUrl) throw new TelnyxApiError('Set the public server URL first.', 400);

  await telnyxFetch(apiKey, `/credential_connections/${encodeURIComponent(connectionId)}`, {
    method: 'PATCH',
    body: { webhook_event_url: webhookUrl, webhook_api_version: '2' },
  });
  return { connectionId, webhookUrl };
}

/** The account's phone numbers, for assigning a caller ID to each telecaller. */
export async function listNumbers(): Promise<
  { phoneNumber: string; connectionId: string; connectionName: string; onConnection: boolean }[]
> {
  const { s, apiKey } = await requireApiKey();
  const res = await telnyxFetch<{
    data: { phone_number: string; connection_id?: string | null; connection_name?: string | null; status?: string }[];
  }>(apiKey, '/phone_numbers', { query: { 'page[size]': '250' } });

  return (res.data ?? [])
    .filter((n) => !n.status || n.status === 'active')
    .map((n) => ({
      phoneNumber: n.phone_number,
      connectionId: n.connection_id ? String(n.connection_id) : '',
      connectionName: n.connection_name || '',
      onConnection: Boolean(n.connection_id && String(n.connection_id) === String(s.connectionId)),
    }));
}

/**
 * The caller ID a user dials from: their admin-assigned Telnyx number, else (for
 * the superadmin only) the integration's default. A telecaller with no number
 * can't call — same rule as Twilio.
 */
export async function resolveCallerId(userId: string): Promise<string> {
  const user = await User.findById(userId).select('telnyxNumber role');
  const assigned = (user?.telnyxNumber || '').trim();
  if (assigned) return assigned;
  if (user?.role === 'superadmin') {
    const s = await getTelnyxSettings();
    return (s?.callerId || '').trim();
  }
  return '';
}

/**
 * Returns this user's telephony credential on the configured connection,
 * creating it if they don't have one yet (or it belongs to an older connection).
 * `fresh` tells the caller Telnyx may need a few seconds before it can log in.
 */
async function ensureCredential(userId: string): Promise<{ credentialId: string; fresh: boolean }> {
  const { s, apiKey } = await requireApiKey();
  const connectionId = (s.connectionId || '').trim();
  if (!connectionId) throw new TelnyxApiError('Telnyx connection is not configured.', 400);

  const user = await User.findById(userId).select('+telnyxCredentialId +telnyxCredentialConnectionId email');
  if (!user) throw new TelnyxApiError('User not found', 404);

  if (user.telnyxCredentialId && user.telnyxCredentialConnectionId === connectionId) {
    return { credentialId: user.telnyxCredentialId, fresh: false };
  }

  const created = await telnyxFetch<{ data: { id: string } }>(apiKey, '/telephony_credentials', {
    method: 'POST',
    body: { connection_id: connectionId, name: `crm-${user.email}`.slice(0, 64), tag: 'nextgen-fusion-crm' },
  });
  user.telnyxCredentialId = String(created.data.id);
  user.telnyxCredentialConnectionId = connectionId;
  await user.save();
  return { credentialId: user.telnyxCredentialId, fresh: true };
}

/** Forgets a user's stored credential so the next token request makes a new one. */
async function dropCredential(userId: string) {
  await User.updateOne({ _id: userId }, { $set: { telnyxCredentialId: '', telnyxCredentialConnectionId: '' } });
}

/**
 * Mints a WebRTC login token (JWT, valid 24h) for this user. A credential deleted
 * or expired in the portal reads as 404/422 — recreate it once and retry, so the
 * softphone heals itself instead of failing until an admin intervenes.
 */
export async function generateLoginToken(userId: string): Promise<{ token: string; fresh: boolean }> {
  const { apiKey } = await requireApiKey();
  for (const attempt of [0, 1]) {
    const { credentialId, fresh } = await ensureCredential(userId);
    try {
      const token = await telnyxFetch<string>(
        apiKey,
        `/telephony_credentials/${encodeURIComponent(credentialId)}/token`,
        { method: 'POST', raw: true }
      );
      return { token: token.trim(), fresh };
    } catch (e) {
      const status = e instanceof TelnyxApiError ? e.status : 0;
      if (attempt === 0 && (status === 404 || status === 422)) {
        await dropCredential(userId);
        continue;
      }
      throw e;
    }
  }
  throw new TelnyxApiError('Could not create a Telnyx login token.', 502);
}

/**
 * Starts recording an answered call (dual channel: telecaller and lead on
 * separate tracks). Best-effort — a failure here must never drop the call.
 */
export async function startRecording(callControlId: string): Promise<void> {
  const s = await getTelnyxSettings();
  if (!s?.apiKey || !callControlId) return;
  try {
    await telnyxFetch(s.apiKey, `/calls/${encodeURIComponent(callControlId)}/actions/record_start`, {
      method: 'POST',
      body: { format: 'mp3', channels: 'dual' },
    });
  } catch (e) {
    console.warn('Telnyx record_start failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * Fetches a call's recording audio. The URLs in the `call.recording.saved` webhook
 * are pre-signed and expire within minutes, so we look the recording up again by
 * call leg/session and download from the fresh link. Proxied server-side so the API
 * key never reaches the browser.
 */
export async function fetchRecordingMedia(ids: {
  callLegId?: string | null;
  callSessionId?: string | null;
  fallbackUrl?: string | null;
}): Promise<{ buffer: Buffer; contentType: string } | null> {
  const s = await getTelnyxSettings();
  if (!s?.apiKey) return null;

  const urls: string[] = [];
  for (const [filter, value] of [
    ['filter[call_leg_id]', ids.callLegId],
    ['filter[call_session_id]', ids.callSessionId],
  ] as const) {
    if (!value) continue;
    try {
      const res = await telnyxFetch<{ data: { download_urls?: { mp3?: string; wav?: string } }[] }>(
        s.apiKey,
        '/recordings',
        { query: { [filter]: value, 'page[size]': '5' } }
      );
      const rec = res.data?.find((r) => r.download_urls?.mp3 || r.download_urls?.wav);
      if (rec) {
        urls.push(rec.download_urls!.mp3 || rec.download_urls!.wav!);
        break;
      }
    } catch {
      /* try the next identifier */
    }
  }
  if (ids.fallbackUrl) urls.push(ids.fallbackUrl);

  for (const url of urls) {
    // An expired pre-signed link 403s; an unreachable one throws. Either way,
    // move on rather than turning a missing recording into a 500.
    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const buffer = Buffer.from(await resp.arrayBuffer());
      return { buffer, contentType: resp.headers.get('content-type') || 'audio/mpeg' };
    } catch {
      continue;
    }
  }
  return null;
}

// DER prefix that wraps a raw 32-byte Ed25519 key as SubjectPublicKeyInfo.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verifies a Telnyx webhook: Ed25519 over `${telnyx-timestamp}|${raw body}` with
 * the account public key (Portal → Keys & credentials → Public key). Must be given
 * the exact received bytes — re-serialised JSON will not verify.
 */
export async function validateWebhook(req: {
  headers: Record<string, unknown>;
  rawBody?: Buffer;
}): Promise<boolean> {
  const s = await getTelnyxSettings();
  const publicKey = (s?.publicKey || '').trim();
  const signature = req.headers['telnyx-signature-ed25519'];
  const timestamp = req.headers['telnyx-timestamp'];
  if (!publicKey || !req.rawBody || typeof signature !== 'string' || typeof timestamp !== 'string') return false;
  if (!/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > SIGNATURE_TOLERANCE_SEC) return false;

  try {
    const rawKey = Buffer.from(publicKey, 'base64');
    const sig = Buffer.from(signature, 'base64');
    if (rawKey.length !== 32 || sig.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]), format: 'der', type: 'spki' });
    const signed = Buffer.concat([Buffer.from(`${timestamp}|`), req.rawBody]);
    return verifySignature(null, signed, key, sig);
  } catch {
    return false;
  }
}

/** True for a base64 string that decodes to a 32-byte Ed25519 key. */
export function isValidPublicKey(value: string): boolean {
  try {
    return Buffer.from(value.trim(), 'base64').length === 32;
  } catch {
    return false;
  }
}

/** Maps a Telnyx `hangup_cause` onto a reason a telecaller can act on. */
export function reasonForHangup(cause?: string, sipCode?: string): string | undefined {
  switch (cause) {
    case 'normal_clearing':
    case 'originator_cancel':
      return undefined;
    case 'user_busy':
      return 'The line was busy.';
    case 'timeout':
    case 'no_answer':
      return 'No answer.';
    case 'call_rejected':
      return 'Call rejected by the other end.';
    case 'unallocated_number':
    case 'invalid_number_format':
      return 'Invalid or unreachable number. Check and update it.';
    case 'destination_out_of_order':
    case 'network_out_of_order':
      return 'The number is unreachable right now.';
    default:
      if (sipCode === '403') return 'Telnyx refused the call. Check the caller ID and outbound voice profile.';
      return cause && cause !== 'unspecified' ? `Call ended: ${cause.replace(/_/g, ' ')}.` : undefined;
  }
}
