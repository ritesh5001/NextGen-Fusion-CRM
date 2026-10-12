/**
 * Bolna AI voice agents — automated outbound calling for lead generation.
 *
 * Unlike the Twilio/TeleCMI/Telnyx softphones there is no human on our side: the
 * admin builds a voice agent in the Bolna dashboard (prompt, voice, telephony),
 * and the CRM asks Bolna to have that agent call each number of a campaign
 * (`POST /call`). Bolna reports every status change of a call to our webhook with
 * the full execution (transcript, recording, extracted data) — the same shape
 * `GET /executions/{id}` returns, which the dispatcher also polls as a fallback.
 *
 * The agent's *extraction* prompt is what turns a conversation into a CRM
 * outcome: it should output `interested: yes|no|callback` (plus name/email when
 * given). `parseInterest` reads that tolerantly.
 *
 * Bolna doesn't sign webhooks, so the URL carries a random token
 * (`Integration.webhookToken`) that the handler compares in constant time.
 *
 * Everything is configured from the admin panel (Integration doc `key:'bolna'`).
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { Integration, type IntegrationDoc } from '../models/Integration.js';
import type { AiCallInterest, AiCallStatus } from '../models/AiCall.js';

export const BOLNA_KEY = 'bolna';

const API_BASE = 'https://api.bolna.ai';

/** A Bolna REST failure, carrying the HTTP status so callers can map it to 4xx/5xx. */
export class BolnaApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export async function getBolnaSettings(): Promise<IntegrationDoc | null> {
  return Integration.findOne({ key: BOLNA_KEY });
}

export function hasAllCreds(s: IntegrationDoc | null): s is IntegrationDoc {
  return Boolean(s?.apiKey && s?.agentId);
}

/** Creates the webhook token on first use so the URL is stable afterwards. */
export async function ensureWebhookToken(s: IntegrationDoc): Promise<string> {
  if (!s.webhookToken) {
    s.webhookToken = randomBytes(24).toString('hex');
    await s.save();
  }
  return s.webhookToken;
}

export function webhookUrlFor(s: IntegrationDoc | null): string {
  const base = (s?.publicServerUrl || env.publicUrl || '').replace(/\/$/, '');
  if (!base || !s?.webhookToken) return '';
  return `${base}/api/v1/ai-calls/webhook?token=${s.webhookToken}`;
}

export function tokenMatches(s: IntegrationDoc | null, token: unknown): boolean {
  if (!s?.webhookToken || typeof token !== 'string') return false;
  const a = Buffer.from(s.webhookToken);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function request<T>(apiKey: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new BolnaApiError(503, `Could not reach Bolna: ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* keep raw text */
  }
  if (!res.ok) {
    const b = body as { message?: string; detail?: unknown; error?: string };
    const detail =
      b?.message ?? b?.error ?? (typeof b?.detail === 'string' ? b.detail : JSON.stringify(b?.detail ?? body));
    const msg =
      res.status === 401 || res.status === 403
        ? 'Bolna rejected the API key'
        : `Bolna error ${res.status}: ${String(detail).slice(0, 300)}`;
    throw new BolnaApiError(res.status, msg);
  }
  return body as T;
}

export interface BolnaAgent {
  id: string;
  name: string;
  status?: string;
}

/** Lists the account's agents — doubles as the "test API key" check. */
export async function listAgents(apiKey?: string): Promise<BolnaAgent[]> {
  const key = apiKey || (await getBolnaSettings())?.apiKey;
  if (!key) throw new BolnaApiError(400, 'Enter the Bolna API key first.');
  const raw = await request<unknown>(key, '/v2/agent/all');
  const list = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? []);
  return (list as Record<string, unknown>[]).map((a) => ({
    id: String(a.id ?? a.agent_id ?? ''),
    name: String(a.agent_name ?? a.name ?? 'Untitled agent'),
    status: a.agent_status ? String(a.agent_status) : undefined,
  }));
}

export interface PlaceCallInput {
  agentId: string;
  to: string;
  from?: string;
  userData?: Record<string, string>;
}

/** Asks Bolna to have the agent call `to`. Returns the execution id. */
export async function placeCall(s: IntegrationDoc, input: PlaceCallInput): Promise<string> {
  const body: Record<string, unknown> = {
    agent_id: input.agentId,
    recipient_phone_number: input.to,
  };
  if (input.from) body.from_phone_number = input.from;
  if (input.userData && Object.keys(input.userData).length) body.user_data = input.userData;
  const res = await request<{ execution_id?: string; id?: string }>(s.apiKey, '/call', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const id = res.execution_id ?? res.id;
  if (!id) throw new BolnaApiError(502, 'Bolna accepted the call but returned no execution id');
  return String(id);
}

export async function getExecution(s: IntegrationDoc, executionId: string): Promise<BolnaExecution> {
  return request<BolnaExecution>(s.apiKey, `/executions/${encodeURIComponent(executionId)}`);
}

/** The parts of a Bolna execution payload (webhook or GET) we use. */
export interface BolnaExecution {
  id?: string;
  execution_id?: string;
  agent_id?: string;
  status?: string;
  transcript?: string;
  summary?: string;
  extracted_data?: unknown;
  conversation_duration?: number;
  conversation_time?: number;
  total_cost?: number;
  error_message?: string;
  telephony_data?: {
    duration?: number | string;
    recording_url?: string;
    hangup_reason?: string;
    hangup_by?: string;
    to_number?: string;
  } | null;
  context_details?: { recipient_phone_number?: string } | null;
}

/**
 * Maps Bolna's execution status onto ours. Returns null for intermediate states we
 * treat as "still in progress" — notably `call-disconnected`, which arrives before
 * post-call processing (transcript, extraction, recording) has finished; the final
 * data comes with `completed`.
 */
export function mapStatus(ex: BolnaExecution): AiCallStatus {
  const st = String(ex.status ?? '').toLowerCase();
  switch (st) {
    case 'completed': {
      // Bolna derives status from the call lifecycle, so a rejected/unanswered
      // call can still say "completed" — the hangup reason tells the truth.
      const reason = String(ex.telephony_data?.hangup_reason ?? '').toLowerCase();
      if (/no.?answer|not answered|timeout/.test(reason) && !ex.transcript) return 'no_answer';
      if (/busy|reject|declin/.test(reason) && !ex.transcript) return 'busy';
      return 'completed';
    }
    case 'no-answer':
    case 'no_answer':
      return 'no_answer';
    case 'busy':
      return 'busy';
    case 'failed':
    case 'error':
    case 'canceled':
    case 'cancelled':
    case 'stopped':
    case 'balance-low':
      return 'failed';
    default:
      return 'in_progress'; // queued / initiated / ringing / in-progress / call-disconnected
  }
}

export function isTerminal(status: AiCallStatus): boolean {
  return !['queued', 'dialing', 'in_progress'].includes(status);
}

/** Bolna sometimes returns extracted_data as a JSON string. */
export function normalizeExtracted(raw: unknown): Record<string, unknown> | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: raw };
    } catch {
      return { value: raw };
    }
  }
  return typeof raw === 'object' ? (raw as Record<string, unknown>) : { value: raw };
}

/** Flattens nested extraction output into [key, value] pairs (keys lowercased). */
function entries(obj: Record<string, unknown>, prefix = ''): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = `${prefix}${k}`.toLowerCase();
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...entries(v as Record<string, unknown>, `${key}.`));
    else out.push([key, v]);
  }
  return out;
}

function interestFromValue(v: unknown): AiCallInterest | null {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/call ?back|later|maybe|not now|busy|reschedul/.test(s)) return 'callback';
  if (/^(no|n|false|0)$|not interested|uninterested|declin|refus|\bno\b/.test(s)) return 'no';
  if (/^(yes|y|true|1)$|interested|agree|\byes\b|wants|accepted/.test(s)) return 'yes';
  return null;
}

/**
 * Reads the agent's yes/no verdict from the extraction output. Looks for the key
 * the recommended extraction prompt uses (`interested`) first, then anything that
 * looks like it (`is_interested`, `wants_service`, `lead_status`…).
 */
export function parseInterest(extracted: Record<string, unknown> | undefined): AiCallInterest {
  if (!extracted) return 'unknown';
  const pairs = entries(extracted);
  const ranked = [
    (k: string) => /(^|\.)interested$/.test(k),
    (k: string) => /interest/.test(k),
    (k: string) => /want|agree|consent|accept|opt.?in/.test(k),
    (k: string) => /lead.?status|outcome|disposition|result/.test(k),
  ];
  for (const match of ranked) {
    for (const [k, v] of pairs) {
      if (!match(k)) continue;
      const verdict = interestFromValue(v);
      if (verdict) return verdict;
    }
  }
  return 'unknown';
}

/** Picks a contact detail (name/email/notes) out of the extraction output. */
export function pickExtracted(extracted: Record<string, unknown> | undefined, pattern: RegExp): string {
  if (!extracted) return '';
  for (const [k, v] of entries(extracted)) {
    if (pattern.test(k) && v != null && typeof v !== 'object' && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** Recommended Bolna extraction prompt — shown in the admin panel to copy. */
export const RECOMMENDED_EXTRACTION_PROMPT = `interested : Did the person say YES to wanting our service? Answer exactly one of: "yes", "no", "callback" (callback = they asked to be called later or were busy).
name : The person's name if they said it, else "".
email : Their email address if they gave it, else "".
company : Their company/business name if mentioned, else "".
requirement : One short sentence on what they need, else "".
callback_time : When they asked to be called back, if they did, else "".`;
