/**
 * TeleCMI telephony provider — the second calling backend alongside Twilio.
 *
 * This targets TeleCMI's **cloud phone system**, administered from the Connle
 * dashboard (connle.telecmi.com) — not their separate PIOPIY programmable-telephony
 * product. The App ID / API secret, the per-agent users and the CDR webhook all come
 * from Connle. The `piopiy.telecmi.com` agent endpoints below are shared by both.
 *
 * Two calling modes are supported, both configured from the admin panel:
 *  - **Softphone**: the browser registers directly with a TeleCMI SBC via the
 *    `@telecmi/piopiyjs` WebRTC SDK using the telecaller's own SIP user/password.
 *    Unlike Twilio there is no server-minted token and no TwiML webhook — we just
 *    hand the authenticated telecaller their own credentials.
 *  - **Click-to-call**: the server asks TeleCMI to ring the telecaller's phone and
 *    bridge the lead (`/v1/agentConnect`), authenticated with a per-agent token
 *    obtained from `/v1/agentLogin` (valid 30 days, cached on the User doc).
 *
 * Call outcomes arrive asynchronously on the CDR webhook; recordings are fetched
 * back through the REST API and proxied so credentials never reach the browser.
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { env } from '../config/env.js';
import { Integration, type IntegrationDoc } from '../models/Integration.js';
import { User } from '../models/User.js';

export const TELECMI_KEY = 'telecmi';

/**
 * TeleCMI runs two separate CHUB platforms and **every** endpoint differs between
 * them — including the query-parameter name for the app secret. Getting this wrong
 * fails authentication rather than erroring usefully, so the region is an explicit
 * admin setting rather than something we guess.
 *
 * Docs: doc.telecmi.com/chub-india (India) · doc.telecmi.com/chub (Global).
 */
export const API_REGIONS = [
  { id: 'india', label: 'India (chub-india)' },
  { id: 'global', label: 'Global (chub)' },
] as const;
export type ApiRegion = (typeof API_REGIONS)[number]['id'];

export const DEFAULT_API_REGION: ApiRegion = 'india';

const ENDPOINTS: Record<
  ApiRegion,
  { login: string; connect: string; play: string; analysis: string; secretParam: 'token' | 'secret' }
> = {
  india: {
    login: 'https://piopiy.telecmi.com/v1/agentLogin',
    connect: 'https://piopiy.telecmi.com/v1/agentConnect',
    play: 'https://piopiy.telecmi.com/v1/play',
    analysis: 'https://piopiy.telecmi.com/v1/analysis',
    secretParam: 'token',
  },
  global: {
    login: 'https://rest.telecmi.com/v2/user/login',
    connect: 'https://rest.telecmi.com/v2/click2call',
    play: 'https://rest.telecmi.com/v2/play',
    analysis: 'https://rest.telecmi.com/v2/analysis',
    secretParam: 'secret',
  },
};

/** The endpoint set for the configured region (defaults to India). */
function endpointsFor(s: IntegrationDoc | null) {
  const region = (s?.apiRegion as ApiRegion) || DEFAULT_API_REGION;
  return ENDPOINTS[region] ?? ENDPOINTS[DEFAULT_API_REGION];
}

/** Agent tokens are valid 30 days; refresh a little early to avoid edge failures. */
const TOKEN_TTL_MS = 29 * 24 * 60 * 60 * 1000;

/** The SBC regions TeleCMI exposes for the browser SDK. */
export const SBC_REGIONS = [
  { uri: 'sbcind.telecmi.com', label: 'India' },
  { uri: 'sbcus.telecmi.com', label: 'America' },
  { uri: 'sbcuk.telecmi.com', label: 'Europe' },
  { uri: 'sbcsg.telecmi.com', label: 'Asia (Singapore)' },
] as const;

export const DEFAULT_SBC_URI = 'sbcind.telecmi.com';

/** Loads the saved TeleCMI settings (admin panel), or null if never configured. */
export async function getTelecmiSettings(): Promise<IntegrationDoc | null> {
  return Integration.findOne({ key: TELECMI_KEY });
}

/** True when a settings doc has the credentials needed for the REST API. */
function hasAllCreds(s: IntegrationDoc): boolean {
  return Boolean(s.appId && s.apiSecret);
}

/** True when TeleCMI calling is switched on AND fully configured. */
export async function isEnabled(): Promise<boolean> {
  const s = await getTelecmiSettings();
  return Boolean(s && s.enabled && hasAllCreds(s));
}

/** Public base URL TeleCMI should use for our CDR webhook (panel value, else env). */
export function publicBase(s: IntegrationDoc | null): string | undefined {
  const base = s?.publicServerUrl || env.publicUrl;
  return base ? base.replace(/\/$/, '') : undefined;
}

/**
 * Normalizes a number to E.164 for TeleCMI. Same rule as the Twilio path: a
 * number that already carries its country code without the '+' must not be
 * prefixed again.
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
 * The softphone credentials a given telecaller registers with. Returns null when
 * the admin hasn't assigned this user a TeleCMI SIP user yet — the caller turns
 * that into a clear "ask your admin" error rather than a failed registration.
 */
export async function resolveAgentCredentials(
  userId: string
): Promise<{ userId: string; password: string; sbcUri: string } | null> {
  const user = await User.findById(userId).select('+telecmiPassword telecmiUserId');
  const sipUser = (user?.telecmiUserId || '').trim();
  const password = (user?.telecmiPassword || '').trim();
  if (!sipUser || !password) return null;

  const s = await getTelecmiSettings();
  return { userId: sipUser, password, sbcUri: (s?.sbcUri || '').trim() || DEFAULT_SBC_URI };
}

/**
 * Returns a valid agent token for click-to-call, logging in against TeleCMI and
 * caching the result on the User doc. Tokens last 30 days, so this hits the
 * network roughly once a month per telecaller.
 */
export async function getAgentToken(userId: string, forceRefresh = false): Promise<string | null> {
  const user = await User.findById(userId).select('+telecmiPassword +telecmiAgentToken telecmiUserId telecmiTokenAt');
  if (!user) return null;
  const { login: loginUrl } = endpointsFor(await getTelecmiSettings());

  const cached = (user.telecmiAgentToken || '').trim();
  const issuedAt = user.telecmiTokenAt ? new Date(user.telecmiTokenAt).getTime() : 0;
  if (!forceRefresh && cached && Date.now() - issuedAt < TOKEN_TTL_MS) return cached;

  const sipUser = (user.telecmiUserId || '').trim();
  const password = (user.telecmiPassword || '').trim();
  if (!sipUser || !password) return null;

  const resp = await fetch(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: sipUser, password }),
  });
  const data = (await resp.json().catch(() => null)) as { code?: number; token?: string } | null;
  if (!resp.ok || data?.code !== 200 || !data.token) return null;

  user.telecmiAgentToken = data.token;
  user.telecmiTokenAt = new Date();
  await user.save();
  return data.token;
}

/**
 * Places a click-to-call: TeleCMI rings the telecaller's own phone first, then
 * bridges `to` once they answer. Retries once with a fresh token so an expired
 * cached token self-heals instead of surfacing as a failure.
 */
export async function clickToCall(
  userId: string,
  to: string
): Promise<{ ok: true; requestId: string } | { ok: false; message: string }> {
  const s = await getTelecmiSettings();
  const number = toE164(to, s?.defaultCountryCode);
  const { connect: connectUrl } = endpointsFor(s);

  for (const forceRefresh of [false, true]) {
    const token = await getAgentToken(userId, forceRefresh);
    if (!token) return { ok: false, message: 'No TeleCMI agent credentials assigned to you. Ask your admin.' };

    const resp = await fetch(connectUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, to: number }),
    });
    const data = (await resp.json().catch(() => null)) as
      | { code?: number; msg?: string; request_id?: string }
      | null;

    if (resp.ok && data?.code === 200 && data.request_id) {
      return { ok: true, requestId: data.request_id };
    }
    // A stale token reads as an auth failure — fall through and retry once.
    if (forceRefresh) {
      return { ok: false, message: data?.msg || 'TeleCMI rejected the call. Check the number and your agent setup.' };
    }
  }
  return { ok: false, message: 'Could not place the call through TeleCMI.' };
}

/**
 * Fetches a recorded call's audio from TeleCMI. Like the Twilio path this must be
 * proxied server-side — the app id + API secret would otherwise reach the browser.
 */
export async function fetchRecordingMedia(
  filename: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const s = await getTelecmiSettings();
  if (!s || !hasAllCreds(s) || !filename) return null;

  // India passes the app secret as `token`, Global as `secret` — same value.
  const { play, secretParam } = endpointsFor(s);
  const url = new URL(play);
  url.searchParams.set('appid', s.appId);
  url.searchParams.set(secretParam, s.apiSecret);
  url.searchParams.set('file', filename);

  const resp = await fetch(url);
  if (!resp.ok) return null;
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { buffer, contentType: resp.headers.get('content-type') || 'audio/mpeg' };
}

/** Maps a TeleCMI CDR hangup reason / status onto a human-readable failure cause. */
export function reasonForCdr(status?: string, hangupReason?: string): string | undefined {
  if (status === 'answered') return undefined;
  switch (hangupReason) {
    case 'recv_reject':
    case 'sent_reject':
      return 'Call rejected by the other end.';
    case 'recv_cancel':
      return 'Call cancelled before it was answered.';
    case 'no_answer':
      return 'No answer.';
    case 'busy':
      return 'The line was busy.';
    default:
      return status === 'missed' ? 'No answer.' : undefined;
  }
}

/**
 * Works out which CHUB platform an account lives on by asking both.
 *
 * The Analysis API is the cheapest credential check TeleCMI offers — it needs only
 * the app id + secret and returns `code: 200` when they're valid.
 *
 * **Both platforms can accept the same credentials** (verified against a live
 * account), so "first one that answers 200" picks the wrong platform. The account's
 * calls only exist on one of them, so we compare the call totals the Analysis API
 * reports and choose where the traffic actually is. Only when both are credentialed
 * *and* both are empty is the answer genuinely ambiguous.
 */
export async function detectApiRegion(
  appId: string,
  apiSecret: string
): Promise<{
  region: ApiRegion | null;
  ambiguous: boolean;
  tried: { region: ApiRegion; ok: boolean; total: number; detail: string }[];
}> {
  const tried: { region: ApiRegion; ok: boolean; total: number; detail: string }[] = [];

  for (const candidate of API_REGIONS.map((r) => r.id)) {
    const ep = ENDPOINTS[candidate];
    try {
      const resp = await fetch(ep.analysis, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The date range is optional on India but *required* on Global, which
        // schema-checks before it authenticates — omit it and Global always 400s,
        // so detection could never pick it. A 24h window keeps the response small.
        // A 30-day window: long enough that a low-volume account still shows
        // traffic, which is what distinguishes the two platforms.
        body: JSON.stringify({
          appid: Number(appId) || appId,
          [ep.secretParam]: apiSecret,
          start_date: Date.now() - 30 * 24 * 60 * 60 * 1000,
          end_date: Date.now(),
        }),
      });
      const data = (await resp.json().catch(() => null)) as
        | { code?: number; msg?: string; total?: number }
        | null;
      const ok = resp.ok && data?.code === 200;
      const total = ok ? Number(data?.total) || 0 : 0;
      tried.push({
        region: candidate,
        ok,
        total,
        detail: ok ? `credentials accepted · ${total} calls in 30d` : data?.msg || `HTTP ${resp.status}`,
      });
    } catch (e) {
      tried.push({
        region: candidate,
        ok: false,
        total: 0,
        detail: e instanceof Error ? e.message : 'unreachable',
      });
    }
  }

  const accepted = tried.filter((t) => t.ok);
  if (accepted.length === 0) return { region: null, ambiguous: false, tried };

  // Prefer whichever platform actually holds this account's call history.
  const best = accepted.reduce((a, b) => (b.total > a.total ? b : a));
  const ambiguous = accepted.length > 1 && best.total === 0;

  return { region: ambiguous ? null : best.region, ambiguous, tried };
}
