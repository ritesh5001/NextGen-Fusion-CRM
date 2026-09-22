import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** Strips junk (quotes, spaces, letters) keeping digits and a single leading '+'. */
function stripJunk(raw: string): string {
  const s = raw.trim().replace(/[^\d+]/g, '');
  return s.startsWith('+') ? `+${s.slice(1).replace(/\+/g, '')}` : s.replace(/\+/g, '');
}

/**
 * Canonical comparison key for a phone number, used to detect duplicates on import.
 * Normalizes to E.164 so the same number written differently collapses to one key,
 * e.g. `+91 70074 36164` and `917007436164` both → `+917007436164`.
 *
 * `defaultCountryCode` (the integration's dialling code, e.g. '+91') is used to
 * resolve national numbers that omit their country code. Returns '' when there
 * are no digits (blank/garbage), so callers can treat empty keys as non-matching.
 */
export function phoneKey(raw?: string | null, defaultCountryCode?: string | null): string {
  if (!raw) return '';
  const cleaned = stripJunk(String(raw));
  if (!cleaned || cleaned === '+') return '';

  // Already international (has '+'): parse directly.
  if (cleaned.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(cleaned);
    return parsed?.isValid() ? parsed.number : cleaned;
  }

  const digits = cleaned;
  const code = (defaultCountryCode || '').replace(/[^\d]/g, ''); // e.g. '+91' → '91'

  // Candidate A: the digits already include a country code (just missing the '+').
  const asIntl = parsePhoneNumberFromString(`+${digits}`);
  if (asIntl?.isValid()) return asIntl.number;

  // Candidate B: the digits are a national number → prepend the default country code.
  if (code) {
    const national = digits.replace(/^0+/, '');
    const withCode = parsePhoneNumberFromString(`+${code}${national}`);
    if (withCode?.isValid()) return withCode.number;
    return `+${code}${national}`;
  }

  return `+${digits}`;
}
