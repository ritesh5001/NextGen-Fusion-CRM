export type Role = 'superadmin' | 'telecaller';

/** Telephony backends a call can be placed through. */
export type CallProvider = 'twilio' | 'telecmi';

export type Density = 'comfortable' | 'compact';

export interface Workspace {
  _id: string;
  name: string;
  isActive?: boolean;
  createdBy?: string;
  createdAt: string;
}

export interface User {
  _id: string;
  id?: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  isActive: boolean;
  dailyTarget: number;
  twilioNumber?: string;
  /** TeleCMI agent id assigned by the admin ('' when none). The password never leaves the server. */
  telecmiUserId?: string;
  /** Which provider this user prefers to dial with. */
  callProvider?: CallProvider;
  // The workspace a telecaller belongs to (absent for the superadmin).
  workspace?: string;
  lastLoginAt?: string;
  createdAt: string;
}

export type LeadStatus =
  | 'new'
  | 'assigned'
  | 'in_progress'
  | 'interested'
  | 'callback'
  | 'not_interested'
  | 'converted'
  | 'dnd';

export interface Lead {
  _id: string;
  name: string;
  phone: string;
  altPhone?: string;
  altPhone2?: string;
  email?: string;
  title?: string;
  company?: string;
  city?: string;
  state?: string;
  country?: string;
  source?: string;
  tags?: string[];
  status: LeadStatus;
  priority: 'low' | 'medium' | 'high';
  qualified?: boolean;
  callStatus?: CallStatus;
  lastOutcome?: string;
  remarks?: Remark[];
  assignedTo?: User | string | null;
  assignedAt?: string;
  lastContactedAt?: string;
  nextFollowUpAt?: string;
  notes?: string;
  phone1Outcome?: PhoneOutcome;
  phone2Outcome?: PhoneOutcome;
  phone3Outcome?: PhoneOutcome;
  createdAt: string;
}

export type CallStatus = 'pending' | 'done' | 'not_done';

export type PhoneCallStatus = 'pending' | 'connected' | 'not_connected' | 'voicemail' | 'incorrect_no';
export type PhoneLeadOutcome = 'none' | 'interested' | 'not_interested';

export interface PhoneOutcome {
  callStatus: PhoneCallStatus;
  leadOutcome: PhoneLeadOutcome;
  lastCalledAt?: string;
}

export interface Remark {
  _id?: string;
  text: string;
  by?: string;
  byName?: string;
  byRole?: string;
  createdAt: string;
  phone?: 'phone1' | 'phone2' | 'phone3' | null;
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export type TaskType = 'call' | 'follow_up' | 'custom';

export interface Task {
  _id: string;
  title: string;
  description?: string;
  type: TaskType;
  relatedLead?: Lead | string | null;
  assignedTo?: User | string;
  assignedBy?: User | string;
  /** When it was handed to the current assignee. Absent on tasks created before
   *  the field existed — fall back to `createdAt` via `assignedOn()`. */
  assignedAt?: string;
  dueDate?: string;
  priority: 'low' | 'medium' | 'high';
  status: TaskStatus;
  /** Stamped the first time the task moves to In Progress. */
  startedAt?: string;
  /** When the work was actually done — set by whoever completed it, not the click time. */
  completedAt?: string;
  completedBy?: User | string;
  completionNote?: string;
  timeSpentMin?: number;
  createdAt: string;
}

export type Disposition =
  | 'interested'
  | 'callback'
  | 'not_interested'
  | 'busy'
  | 'switched_off'
  | 'wrong_number'
  | 'dnd'
  | 'converted';

export interface CallLog {
  _id: string;
  /** Null for a custom-dialled number that was never saved as a contact. */
  lead: Lead | string | null;
  telecaller: User | string;
  disposition?: Disposition;
  callStatus?: PhoneCallStatus;
  notes?: string;
  durationSec?: number;
  nextFollowUpAt?: string;
  twilioCallSid?: string;
  recordingUrl?: string;
  /** Which telephony backend placed this call, and how. */
  provider?: CallProvider;
  mode?: 'softphone' | 'click_to_call';
  telecmiCallId?: string;
  telecmiRequestId?: string;
  /** TeleCMI recordings are referenced by file name, streamed via our proxy. */
  recordingFile?: string;
  phone?: 'phone1' | 'phone2' | 'phone3';
  phoneNumber?: string;
  createdAt: string;
}

export interface FollowUp {
  _id: string;
  lead: Lead | string;
  telecaller: User | string;
  scheduledAt: string;
  status: 'pending' | 'done' | 'missed';
  notes?: string;
  createdAt: string;
}

export interface Notification {
  _id: string;
  type: string;
  title: string;
  message?: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}
