import { format, formatDistanceToNow, isToday, isTomorrow, isYesterday, isPast } from 'date-fns';

export function fmtDate(d?: string | Date | null) {
  if (!d) return '—';
  return format(new Date(d), 'dd MMM yyyy');
}

export function fmtDateTime(d?: string | Date | null) {
  if (!d) return '—';
  return format(new Date(d), 'dd MMM yyyy, hh:mm a');
}

export function fmtRelative(d?: string | Date | null) {
  if (!d) return '—';
  return formatDistanceToNow(new Date(d), { addSuffix: true });
}

/** Formats a date to local `yyyy-MM-dd` for a <input type="date"> value. */
export function toDateInput(d?: string | Date | null) {
  if (!d) return '';
  return format(new Date(d), 'yyyy-MM-dd');
}

export function isOverdue(d?: string | Date | null) {
  if (!d) return false;
  return isPast(new Date(d)) && !isToday(new Date(d));
}

/** Normalizes a phone to a clean dial-able form, preserving the leading +country code. */
export function cleanPhone(phone: string) {
  const trimmed = phone.trim().replace(/[^\d+]/g, '');
  // Keep only a single leading '+'.
  return trimmed.startsWith('+') ? `+${trimmed.slice(1).replace(/\+/g, '')}` : trimmed.replace(/\+/g, '');
}

/** Builds a click-to-call (tel:) link. */
export function telLink(phone: string) {
  return `tel:${cleanPhone(phone)}`;
}

/** Builds a WhatsApp deep link. */
export function whatsappLink(phone: string) {
  return `https://wa.me/${phone.replace(/[^\d]/g, '')}`;
}

/**
 * Turns a `yyyy-MM-dd` input value into a **local** Date at `hour`.
 * `new Date('2026-09-04')` parses as UTC midnight, which lands on the previous
 * day west of Greenwich — this keeps the day the user actually picked.
 */
export function fromDateInput(value: string, hour = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, 0, 0, 0);
}

/** "2h 15m" / "45m" — for a self-reported effort in minutes. */
export function fmtMinutes(mins?: number | null) {
  if (mins == null || mins < 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Dates carry no clock, so `dd MMM` — with the year only when it isn't the current one. */
const dayFormat = (date: Date) =>
  date.getFullYear() === new Date().getFullYear() ? 'dd MMM' : 'dd MMM yyyy';

/** Day-relative label for a due date: "Today" / "Tomorrow" / "12 Mar". */
export function fmtDueLabel(d?: string | Date | null) {
  if (!d) return 'No due date';
  const date = new Date(d);
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, dayFormat(date));
}

/** Compact date for dense table cells: "01 Sep". */
export function fmtStamp(d?: string | Date | null) {
  if (!d) return '—';
  const date = new Date(d);
  return format(date, dayFormat(date));
}
