import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { countryISO } from './countries';

/** Strips junk (quotes, spaces, letters) keeping digits and a single leading '+'. */
function stripJunk(raw: string): string {
  const s = raw.trim().replace(/[^\d+]/g, '');
  return s.startsWith('+') ? `+${s.slice(1).replace(/\+/g, '')}` : s.replace(/\+/g, '');
}

/**
 * Formats a phone number for display, e.g. `"+971501510371` → "+971 50 151 0371"
 * and `14102927721` (US contact) → "+1 410 292 7721". Uses the contact's country
 * to parse local numbers. Falls back to the cleaned digits when it can't parse.
 */
export function formatPhoneDisplay(raw?: string | null, country?: string | null): string {
  if (!raw) return '';
  const cleaned = stripJunk(raw);
  if (!cleaned) return '';
  const region = countryISO(country) as CountryCode | undefined;
  const parsed = parsePhoneNumberFromString(cleaned, region);
  if (parsed && parsed.isValid()) return parsed.formatInternational();
  return cleaned;
}

/**
 * Normalizes a number to E.164 for dialling. Parses with the contact's country
 * (so `14102927721` for a US contact → `+14102927721`, not `+1110…`). Falls back
 * to prepending `defaultCode` when the country/number can't be parsed.
 */
export function toE164(raw: string, country?: string | null, defaultCode?: string | null): string {
  const cleaned = stripJunk(raw);
  if (!cleaned) return '';
  const region = countryISO(country) as CountryCode | undefined;
  const parsed = parsePhoneNumberFromString(cleaned, region);
  if (parsed && parsed.isValid()) return parsed.number; // E.164, e.g. +14102927721
  if (cleaned.startsWith('+')) return cleaned;
  const code = (defaultCode || '').trim();
  if (!code) return cleaned;
  const plusCode = code.startsWith('+') ? code : `+${code}`;
  // A number that already begins with its own country code (typed without the '+',
  // e.g. `97143062043`) must not get a second one prepended — that produces
  // `+97197143062043`, which Twilio rejects as unreachable. Only treat the digits
  // as *local* when prefixing actually yields a valid number.
  const asIs = parsePhoneNumberFromString(`+${cleaned}`);
  const local = cleaned.replace(/^0+/, '');
  const prefixed = parsePhoneNumberFromString(`${plusCode}${local}`);
  if (asIs?.isValid() && !prefixed?.isValid()) return asIs.number;
  if (prefixed?.isValid()) return prefixed.number;
  // Neither parses cleanly: fall back to treating an already-country-coded number
  // as complete rather than double-prefixing it.
  if (asIs?.isPossible()) return asIs.number;
  return `${plusCode}${local}`;
}
