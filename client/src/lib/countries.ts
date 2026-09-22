// Maps a (free-text) country name to its calling code and a representative IANA
// timezone. Used to (a) prepend a country code when dialling a local number and
// (b) show the country's current local time in the contacts table.
// Keys are lower-cased; common aliases are included.

interface CountryInfo {
  code: string; // E.164 calling code, e.g. '+91'
  tz: string; // representative IANA timezone
  iso: string; // ISO 3166-1 alpha-2 region code, e.g. 'IN' (for phone parsing)
}

const COUNTRIES: Record<string, CountryInfo> = {
  india: { code: '+91', tz: 'Asia/Kolkata', iso: 'IN' },
  'united states': { code: '+1', tz: 'America/New_York', iso: 'US' },
  'united states of america': { code: '+1', tz: 'America/New_York', iso: 'US' },
  usa: { code: '+1', tz: 'America/New_York', iso: 'US' },
  us: { code: '+1', tz: 'America/New_York', iso: 'US' },
  america: { code: '+1', tz: 'America/New_York', iso: 'US' },
  canada: { code: '+1', tz: 'America/Toronto', iso: 'CA' },
  'united kingdom': { code: '+44', tz: 'Europe/London', iso: 'GB' },
  uk: { code: '+44', tz: 'Europe/London', iso: 'GB' },
  'great britain': { code: '+44', tz: 'Europe/London', iso: 'GB' },
  england: { code: '+44', tz: 'Europe/London', iso: 'GB' },
  australia: { code: '+61', tz: 'Australia/Sydney', iso: 'AU' },
  'new zealand': { code: '+64', tz: 'Pacific/Auckland', iso: 'NZ' },
  'united arab emirates': { code: '+971', tz: 'Asia/Dubai', iso: 'AE' },
  uae: { code: '+971', tz: 'Asia/Dubai', iso: 'AE' },
  'saudi arabia': { code: '+966', tz: 'Asia/Riyadh', iso: 'SA' },
  qatar: { code: '+974', tz: 'Asia/Qatar', iso: 'QA' },
  kuwait: { code: '+965', tz: 'Asia/Kuwait', iso: 'KW' },
  bahrain: { code: '+973', tz: 'Asia/Bahrain', iso: 'BH' },
  oman: { code: '+968', tz: 'Asia/Muscat', iso: 'OM' },
  singapore: { code: '+65', tz: 'Asia/Singapore', iso: 'SG' },
  malaysia: { code: '+60', tz: 'Asia/Kuala_Lumpur', iso: 'MY' },
  indonesia: { code: '+62', tz: 'Asia/Jakarta', iso: 'ID' },
  philippines: { code: '+63', tz: 'Asia/Manila', iso: 'PH' },
  thailand: { code: '+66', tz: 'Asia/Bangkok', iso: 'TH' },
  vietnam: { code: '+84', tz: 'Asia/Ho_Chi_Minh', iso: 'VN' },
  china: { code: '+86', tz: 'Asia/Shanghai', iso: 'CN' },
  'hong kong': { code: '+852', tz: 'Asia/Hong_Kong', iso: 'HK' },
  japan: { code: '+81', tz: 'Asia/Tokyo', iso: 'JP' },
  'south korea': { code: '+82', tz: 'Asia/Seoul', iso: 'KR' },
  pakistan: { code: '+92', tz: 'Asia/Karachi', iso: 'PK' },
  bangladesh: { code: '+880', tz: 'Asia/Dhaka', iso: 'BD' },
  'sri lanka': { code: '+94', tz: 'Asia/Colombo', iso: 'LK' },
  nepal: { code: '+977', tz: 'Asia/Kathmandu', iso: 'NP' },
  germany: { code: '+49', tz: 'Europe/Berlin', iso: 'DE' },
  france: { code: '+33', tz: 'Europe/Paris', iso: 'FR' },
  spain: { code: '+34', tz: 'Europe/Madrid', iso: 'ES' },
  italy: { code: '+39', tz: 'Europe/Rome', iso: 'IT' },
  netherlands: { code: '+31', tz: 'Europe/Amsterdam', iso: 'NL' },
  belgium: { code: '+32', tz: 'Europe/Brussels', iso: 'BE' },
  switzerland: { code: '+41', tz: 'Europe/Zurich', iso: 'CH' },
  sweden: { code: '+46', tz: 'Europe/Stockholm', iso: 'SE' },
  norway: { code: '+47', tz: 'Europe/Oslo', iso: 'NO' },
  denmark: { code: '+45', tz: 'Europe/Copenhagen', iso: 'DK' },
  ireland: { code: '+353', tz: 'Europe/Dublin', iso: 'IE' },
  portugal: { code: '+351', tz: 'Europe/Lisbon', iso: 'PT' },
  poland: { code: '+48', tz: 'Europe/Warsaw', iso: 'PL' },
  russia: { code: '+7', tz: 'Europe/Moscow', iso: 'RU' },
  turkey: { code: '+90', tz: 'Europe/Istanbul', iso: 'TR' },
  'south africa': { code: '+27', tz: 'Africa/Johannesburg', iso: 'ZA' },
  nigeria: { code: '+234', tz: 'Africa/Lagos', iso: 'NG' },
  kenya: { code: '+254', tz: 'Africa/Nairobi', iso: 'KE' },
  egypt: { code: '+20', tz: 'Africa/Cairo', iso: 'EG' },
  brazil: { code: '+55', tz: 'America/Sao_Paulo', iso: 'BR' },
  mexico: { code: '+52', tz: 'America/Mexico_City', iso: 'MX' },
  argentina: { code: '+54', tz: 'America/Argentina/Buenos_Aires', iso: 'AR' },
  israel: { code: '+972', tz: 'Asia/Jerusalem', iso: 'IL' },
  greece: { code: '+30', tz: 'Europe/Athens', iso: 'GR' },
  cyprus: { code: '+357', tz: 'Asia/Nicosia', iso: 'CY' },
  gabon: { code: '+241', tz: 'Africa/Libreville', iso: 'GA' },
  cameroon: { code: '+237', tz: 'Africa/Douala', iso: 'CM' },
  'papua new guinea': { code: '+675', tz: 'Pacific/Port_Moresby', iso: 'PG' },
};

export function countryInfo(country?: string | null): CountryInfo | null {
  if (!country) return null;
  return COUNTRIES[country.trim().toLowerCase()] ?? null;
}

/** E.164 calling code for a country name, or null if unknown. */
export function countryCallingCode(country?: string | null): string | null {
  return countryInfo(country)?.code ?? null;
}

/** ISO 3166-1 alpha-2 region code for a country name (for phone parsing), or undefined. */
export function countryISO(country?: string | null): string | undefined {
  return countryInfo(country)?.iso;
}

/** Current local time in a country (e.g. "3:45 PM"), or null if unknown. */
export function countryCurrentTime(country?: string | null): string | null {
  const tz = countryInfo(country)?.tz;
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());
  } catch {
    return null;
  }
}

/**
 * Canonical country names for the contact form's suggestion list. The map above
 * carries aliases (usa/us/america all map to US), so dedupe on ISO and keep the
 * first spelling — that yields the full name rather than an abbreviation.
 * The field stays free text: imported data holds spellings not listed here.
 */
export const COUNTRY_NAMES: string[] = (() => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const [name, info] of Object.entries(COUNTRIES)) {
    if (seen.has(info.iso)) continue;
    seen.add(info.iso);
    names.push(name.replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  return names.sort();
})();
