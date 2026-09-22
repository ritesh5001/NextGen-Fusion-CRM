import type { CallStatus, Disposition, LeadStatus, PhoneCallStatus, PhoneLeadOutcome, TaskStatus } from '@/types';

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  interested: 'Interested',
  callback: 'Callback',
  not_interested: 'Not Interested',
  converted: 'Converted',
  dnd: 'DND',
};

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
  assigned: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  interested: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  callback: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  not_interested: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
  converted: 'bg-green-600 text-white',
  dnd: 'bg-gray-700 text-white',
};

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  interested: 'Interested',
  callback: 'Callback',
  not_interested: 'Not Interested',
  busy: 'Busy',
  switched_off: 'Switched Off',
  wrong_number: 'Wrong Number',
  dnd: 'DND',
  converted: 'Converted',
};

export const DISPOSITIONS = Object.keys(DISPOSITION_LABELS) as Disposition[];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Light/dark pairs are defined together so chips keep their meaning (and 4.5:1
// contrast) on both the white and the slate-950 surface.
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-200',
  in_progress: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  cancelled: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
};

export const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  high: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
};

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  pending: 'Not Called',
  done: 'Call Done',
  not_done: 'Not Done',
};

export const CALL_STATUS_COLORS: Record<CallStatus, string> = {
  pending: 'bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300',
  done: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  not_done: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
};

export const PHONE_CALL_STATUS_LABELS: Record<PhoneCallStatus, string> = {
  pending: 'Not Called',
  connected: 'Connected',
  not_connected: 'Not Connected',
  voicemail: 'Voice Mail',
  incorrect_no: 'Incorrect No',
};

/** Label for a call log: its disposition if any, else the call status (for attempts/dropdown marks). */
export function callLogOutcomeLabel(disposition?: Disposition | null, callStatus?: PhoneCallStatus | null): string {
  if (disposition) return DISPOSITION_LABELS[disposition];
  if (callStatus && callStatus !== 'pending') return PHONE_CALL_STATUS_LABELS[callStatus];
  return 'Logged';
}

export const PHONE_CALL_STATUS_COLORS: Record<PhoneCallStatus, string> = {
  pending: 'bg-slate-100 text-slate-500 dark:bg-slate-700/60 dark:text-slate-300',
  connected: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  not_connected: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  voicemail: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  incorrect_no: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
};

export const PHONE_LEAD_OUTCOME_LABELS: Record<PhoneLeadOutcome, string> = {
  none: '—',
  interested: 'Interested',
  not_interested: 'Not Interested',
};

export const PHONE_LEAD_OUTCOME_COLORS: Record<PhoneLeadOutcome, string> = {
  none: 'bg-slate-100 text-slate-400 dark:bg-slate-700/60 dark:text-slate-400',
  interested: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  not_interested: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
};

/** Shown when Twilio calling is set up but the admin hasn't assigned this user a number. */
export const NO_CALLER_ID_MESSAGE = 'No calling number is assigned to you. Ask an admin to assign one.';
