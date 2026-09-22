import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Phone,
  MessageCircle,
  ChevronRight,
  ChevronDown,
  Send,
  ArrowUp,
  ArrowDown,
  Trash2,
  Copy,
  Columns3,
  GripVertical,
  RotateCcw,
  Eye,
  EyeOff,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { isValidPhoneNumber } from 'libphonenumber-js';
import toast from 'react-hot-toast';
import { Badge, EmptyState, Spinner } from '@/components/ui/Misc';
import { Button } from '@/components/ui/Button';
import { apiError } from '@/api/client';
import { useAddRemark, useScheduleFollowUp, useUpdateLead, useDeleteLead, useUpdatePhoneOutcome } from '@/api/leads';
import { useCallProvider } from '@/features/calls/useCallProvider';
import { useCallStore } from '@/store/call';
import { CallHistory } from '@/features/calls/CallHistory';
import { ContactFormModal } from './ContactFormModal';
import {
  LEAD_STATUS_COLORS,
  LEAD_STATUS_LABELS,
  NO_CALLER_ID_MESSAGE,
  PHONE_CALL_STATUS_COLORS,
  PHONE_CALL_STATUS_LABELS,
  PHONE_LEAD_OUTCOME_COLORS,
  PHONE_LEAD_OUTCOME_LABELS,
  PRIORITY_COLORS,
} from '@/lib/constants';
import { cleanPhone, fmtDate, fmtDateTime, fmtRelative, telLink, toDateInput, whatsappLink } from '@/lib/format';
import { formatPhoneDisplay, toE164 } from '@/lib/phone';
import { CountryTime } from '@/components/CountryTime';
import { useUiStore } from '@/store/ui';
import type { Density, Lead, PhoneCallStatus, PhoneLeadOutcome, Role, User } from '@/types';

const DEFAULT_WIDTHS: Record<string, number> = {
  select: 36,
  expand: 32,
  name: 210,
  title: 150,
  company: 150,
  location: 170,
  email: 210,
  priority: 100,
  assigned: 150,
  phone1: 130,
  callstatus1: 145,
  leadstatus1: 140,
  remark1: 200,
  phone2: 130,
  callstatus2: 145,
  leadstatus2: 140,
  remark2: 200,
  phone3: 130,
  callstatus3: 145,
  leadstatus3: 140,
  remark3: 200,
  lastContacted: 120,
  followup: 200,
  added: 110,
};

interface Props {
  leads: Lead[];
  isLoading: boolean;
  role: Role;
  density: Density;
  selectable?: boolean;
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  telecallers?: User[];
  onAssign?: (leadId: string, telecallerId: string, name: string) => void;
  sortBy: string;
  order: 'asc' | 'desc';
  onSort: (field: string) => void;
  emptyHint?: string;
}

const PRIORITIES = ['low', 'medium', 'high'] as const;
const PHONE_CALL_OPTIONS: PhoneCallStatus[] = ['connected', 'not_connected', 'voicemail', 'incorrect_no'];
const PHONE_LEAD_OPTIONS: PhoneLeadOutcome[] = ['interested', 'not_interested'];

function location(l: Lead) {
  return [l.city, l.state, l.country].filter(Boolean).join(', ');
}

function copyPhone(phone: string) {
  const num = cleanPhone(phone);
  navigator.clipboard
    .writeText(num)
    .then(() => toast.success(`Copied ${num}`))
    .catch(() => toast.error('Copy failed'));
}

/** Inline follow-up scheduler (both roles; telecaller scoped server-side). */
function FollowUpCell({ lead }: { lead: Lead }) {
  const schedule = useScheduleFollowUp();
  return (
    <div onClick={(e) => e.stopPropagation()} className="space-y-0.5">
      <input
        type="date"
        value={toDateInput(lead.nextFollowUpAt)}
        onChange={(e) =>
          e.target.value &&
          schedule.mutate(
            { id: lead._id, scheduledAt: new Date(e.target.value).toISOString() },
            { onSuccess: () => toast.success('Follow-up scheduled'), onError: (err) => toast.error(apiError(err)) }
          )
        }
        className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
      {lead.nextFollowUpAt && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500">Next: {fmtDate(lead.nextFollowUpAt)}</p>
      )}
    </div>
  );
}

/** Copy (left) · Call · WhatsApp actions for a phone number.
 *  When Twilio calling is enabled and a `lead` is provided, Call dials in-app
 *  (browser softphone). If Twilio is set up but this user has no caller ID, Call
 *  explains that rather than opening a `tel:` link (which just makes the OS ask
 *  which app to dial with). Only when Twilio isn't set up at all do we fall back
 *  to `tel:`. */
function PhoneActions({ phone, lead, slot = 'phone1', big }: { phone: string; lead?: Lead; slot?: PhoneSlot; big?: boolean }) {
  const size = big ? 18 : 15;
  // `big` is the phone layout: real 44px targets, not 28px desktop icon buttons.
  const cls = big
    ? 'tap flex items-center justify-center rounded-xl border border-slate-200 p-2.5 dark:border-slate-700'
    : 'rounded p-1.5';
  const { config: callConfig, ready: callingEnabled, provider: callProvider } = useCallProvider();
  // "Configured but no number/agent assigned to you" — a gap an admin can fix.
  const needsCallerId =
    callProvider === 'telecmi'
      ? (callConfig?.providers?.telecmi?.configured ?? false) && !(callConfig?.providers?.telecmi?.hasAgent ?? false)
      : (callConfig?.configured ?? false) && !(callConfig?.hasCallerId ?? false);
  const startCall = useCallStore((s) => s.startCall);
  const phase = useCallStore((s) => s.phase);
  const busy = phase === 'connecting' || phase === 'ringing' || phase === 'in_call';
  const callCls = `${cls} text-brand-600 hover:bg-brand-50 ${big ? 'border-brand-200 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/15' : ''}`;
  // Parse with the contact's country (handles missing '+'), else admin default code.
  const dialNumber = toE164(phone, lead?.country, callConfig?.defaultCountryCode);

  // Inline number editing (both roles; telecaller scoped to assigned server-side).
  const updateLead = useUpdateLead();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(phone);

  function saveNumber() {
    if (!lead) return;
    const next = val.trim();
    const payload: { id: string } & Partial<Lead> = { id: lead._id };
    if (slot === 'phone1') payload.phone = next;
    else if (slot === 'phone2') payload.altPhone = next;
    else payload.altPhone2 = next;
    updateLead.mutate(payload, {
      onSuccess: () => {
        setEditing(false);
        toast.success('Number updated');
      },
      onError: (e) => toast.error(apiError(e)),
    });
  }

  function handleCall() {
    if (!lead) return;
    if (dialNumber.startsWith('+') && !isValidPhoneNumber(dialNumber)) {
      toast.error('This number looks invalid. Update it and try again.');
      setVal(phone);
      setEditing(true);
      return;
    }
    startCall({ leadId: lead._id, name: lead.name, phone: dialNumber, phoneSlot: slot });
  }

  if (editing) {
    return (
      <div className="flex w-full items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveNumber()}
          placeholder="+countrycode number"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 md:w-36 md:flex-none"
        />
        <button onClick={saveNumber} disabled={updateLead.isPending} title="Save" className={`${cls} text-emerald-600 hover:bg-emerald-50`}>
          <Check size={size} />
        </button>
        <button onClick={() => { setEditing(false); setVal(phone); }} title="Cancel" className={`${cls} text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700`}>
          <X size={size} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 ${big ? '[&>*]:flex-1' : 'shrink-0'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => copyPhone(phone)}
        title="Copy number"
        className={`${cls} text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700`}
      >
        <Copy size={size} />
      </button>
      {callingEnabled && lead ? (
        <button
          onClick={handleCall}
          disabled={busy}
          title={busy ? 'A call is in progress' : `Call ${phone}`}
          className={`${callCls} disabled:opacity-40`}
        >
          <Phone size={size} />
        </button>
      ) : needsCallerId ? (
        <button onClick={() => toast.error(NO_CALLER_ID_MESSAGE)} title={NO_CALLER_ID_MESSAGE} className={callCls}>
          <Phone size={size} />
        </button>
      ) : (
        <a href={telLink(phone)} title={phone} className={callCls}>
          <Phone size={size} />
        </a>
      )}
      <a
        href={whatsappLink(phone)}
        target="_blank"
        rel="noreferrer"
        className={`${cls} text-emerald-600 hover:bg-emerald-50 ${big ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/15' : ''}`}
      >
        <MessageCircle size={size} />
      </a>
      {lead && (
        <button
          onClick={() => { setVal(phone); setEditing(true); }}
          title="Edit number"
          className={`${cls} text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700`}
        >
          <Pencil size={size} />
        </button>
      )}
    </div>
  );
}

/* --------------------------- per-phone cell inputs ------------------------- */

type PhoneSlot = 'phone1' | 'phone2' | 'phone3';

/** Resolves a contact's phone number for the given slot (phone1=primary, phone2/3=alternates). */
function phoneNumberOf(lead: Lead, phone: PhoneSlot) {
  return phone === 'phone1' ? lead.phone : phone === 'phone2' ? lead.altPhone : lead.altPhone2;
}

/** Resolves the per-phone outcome sub-document for the given slot. */
function phoneSlotOf(lead: Lead, phone: PhoneSlot) {
  return phone === 'phone1' ? lead.phone1Outcome : phone === 'phone2' ? lead.phone2Outcome : lead.phone3Outcome;
}

/** Phone number with copy/call/WhatsApp actions, or a dash when empty.
 *  The actual digits are revealed when the "Show numbers" top-bar toggle is on. */
function PhoneNumberCell({ lead, phone }: { lead: Lead; phone: PhoneSlot }) {
  const num = phoneNumberOf(lead, phone);
  const showNumbers = useUiStore((s) => s.showPhoneNumbers);
  if (!num) return <span className="text-slate-300">—</span>;
  const pretty = formatPhoneDisplay(num, lead.country);
  return (
    <div className="space-y-0.5">
      {showNumbers && (
        <span className="block truncate text-xs font-medium text-slate-700 dark:text-slate-200" title={pretty}>
          {pretty}
        </span>
      )}
      <PhoneActions phone={num} lead={lead} slot={phone} />
    </div>
  );
}

/** Inline call-status dropdown for one phone (connected / not connected / voice mail / incorrect no). */
function CallStatusCell({ lead, phone }: { lead: Lead; phone: PhoneSlot }) {
  const update = useUpdatePhoneOutcome();
  const num = phoneNumberOf(lead, phone);
  const slot = phoneSlotOf(lead, phone);
  const value = (slot?.callStatus ?? 'pending') as PhoneCallStatus;
  if (phone !== 'phone1' && !num) return <span className="text-slate-300">—</span>;
  return (
    <div className="space-y-0.5">
      <select
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) =>
          update.mutate(
            { id: lead._id, phone, callStatus: e.target.value as PhoneCallStatus },
            { onError: (err) => toast.error(apiError(err)) }
          )
        }
        className={`w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium outline-none focus:border-brand-500 dark:border-slate-600 ${PHONE_CALL_STATUS_COLORS[value]}`}
      >
        <option value="pending">Not Called</option>
        <option value="connected">Connected</option>
        <option value="not_connected">Not Connected</option>
        <option value="voicemail">Voice Mail</option>
        <option value="incorrect_no">Incorrect No</option>
      </select>
      {slot?.lastCalledAt && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500" title={fmtDateTime(slot.lastCalledAt)}>
          Called {fmtRelative(slot.lastCalledAt)}
        </p>
      )}
    </div>
  );
}

/** Inline lead-outcome dropdown for one phone (interested / not interested). */
function LeadStatusCell({ lead, phone }: { lead: Lead; phone: PhoneSlot }) {
  const update = useUpdatePhoneOutcome();
  const num = phoneNumberOf(lead, phone);
  const slot = phoneSlotOf(lead, phone);
  const value = (slot?.leadOutcome ?? 'none') as PhoneLeadOutcome;
  if (phone !== 'phone1' && !num) return <span className="text-slate-300">—</span>;
  return (
    <select
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) =>
        update.mutate(
          { id: lead._id, phone, leadOutcome: e.target.value as PhoneLeadOutcome },
          { onError: (err) => toast.error(apiError(err)) }
        )
      }
      className={`w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium outline-none focus:border-brand-500 dark:border-slate-600 ${PHONE_LEAD_OUTCOME_COLORS[value]}`}
    >
      <option value="none">—</option>
      <option value="interested">Interested</option>
      <option value="not_interested">Not Interested</option>
    </select>
  );
}

/** Inline remark input scoped to one phone, showing the latest phone-specific remark. */
function PhoneRemarkCell({ lead, phone }: { lead: Lead; phone: PhoneSlot }) {
  const [text, setText] = useState('');
  const update = useUpdatePhoneOutcome();
  const num = phoneNumberOf(lead, phone);
  const phoneRemarks = (lead.remarks ?? []).filter((r) => r.phone === phone || (phone === 'phone1' && !r.phone));
  const last = phoneRemarks[phoneRemarks.length - 1];

  function submit() {
    const t = text.trim();
    if (!t) return;
    setText('');
    update.mutate({ id: lead._id, phone, remark: t }, { onError: (e) => toast.error(apiError(e)) });
  }

  if (phone !== 'phone1' && !num) return <span className="text-slate-300">—</span>;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Remark…"
          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        <button onClick={submit} className="rounded p-1 text-brand-600 hover:bg-brand-50" title="Add remark">
          <Send size={13} />
        </button>
      </div>
      {last && (
        <p className="mt-0.5 truncate text-[11px] text-slate-400" title={last.text}>
          {phoneRemarks.length}× · {last.text}
        </p>
      )}
    </div>
  );
}

/* ----------------------------- column registry ---------------------------- */


/* --------------------------- inline editable cell -------------------------- */

/**
 * Click-to-edit for the text fields people correct most often. Saves on Enter or
 * blur, cancels on Escape. The full record (tags, notes, status, location, …)
 * is edited through ContactFormModal — this is the fast path, not a replacement.
 */
function EditableTextCell({
  lead,
  field,
  placeholder,
  type = 'text',
}: {
  lead: Lead;
  field: 'name' | 'title' | 'company' | 'email' | 'city';
  placeholder?: string;
  type?: string;
}) {
  const update = useUpdateLead();
  const current = (lead[field] as string | undefined) ?? '';
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(current);

  function save() {
    const next = val.trim();
    if (next === current) {
      setEditing(false);
      return;
    }
    if (field === 'name' && !next) {
      toast.error('Name cannot be empty');
      return;
    }
    update.mutate(
      { id: lead._id, [field]: next } as { id: string } & Partial<Lead>,
      {
        onSuccess: () => {
          setEditing(false);
          toast.success('Saved');
        },
        onError: (e) => {
          toast.error(apiError(e));
          setVal(current);
          setEditing(false);
        },
      }
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        type={type}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          else if (e.key === 'Escape') {
            setVal(current);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        placeholder={placeholder}
        className="w-full rounded border border-brand-500 bg-white px-1.5 py-0.5 text-sm outline-none dark:bg-slate-800 dark:text-slate-100"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setVal(current);
        setEditing(true);
      }}
      title={current || 'Click to edit'}
      className="flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
    >
      <span className="truncate">{current || '\u2014'}</span>
      <Pencil size={11} className="shrink-0 text-slate-300 opacity-0 group-hover:opacity-100 dark:text-slate-500" />
    </button>
  );
}

interface CellCtx {
  isAdmin: boolean;
  telecallers: User[];
  onAssign?: (id: string, tid: string, name: string) => void;
  onEdit?: (lead: Lead) => void;
}

interface ColumnDef {
  id: string;
  label: string;
  sortField?: string;
  adminOnly?: boolean; // only rendered for superadmins
  locked?: boolean; // cannot be hidden (always visible)
  muted?: boolean; // cell gets the muted text color
  cell: (lead: Lead, ctx: CellCtx) => ReactNode;
}

// Source-of-truth column definitions. Order here is the default order; the user
// can reorder (drag) and hide/show columns — both persisted in the UI store.
const COLUMNS: ColumnDef[] = [
  {
    id: 'name',
    label: 'Name',
    sortField: 'name',
    locked: true,
    cell: (l, ctx) => (
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 font-medium text-slate-800 dark:text-slate-100">
          <EditableTextCell lead={l} field="name" />
        </span>
        <Badge className={`shrink-0 ${LEAD_STATUS_COLORS[l.status]}`}>{LEAD_STATUS_LABELS[l.status]}</Badge>
        {l.qualified && <Badge className="shrink-0 bg-green-600 text-white">Lead</Badge>}
        {ctx.onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); ctx.onEdit!(l); }}
            title="Edit all details"
            className="shrink-0 rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-600 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <Pencil size={13} />
          </button>
        )}
      </div>
    ),
  },
  { id: 'title', label: 'Title', muted: true, cell: (l) => <EditableTextCell lead={l} field="title" /> },
  { id: 'company', label: 'Company', sortField: 'company', muted: true, cell: (l) => <EditableTextCell lead={l} field="company" /> },
  {
    id: 'location',
    label: 'Location',
    sortField: 'country',
    muted: true,
    cell: (l) => (
      <div className="min-w-0" title={location(l)}>
        <span className="block truncate">{location(l) || '—'}</span>
        {l.country && <CountryTime country={l.country} />}
      </div>
    ),
  },
  {
    id: 'email',
    label: 'Email',
    muted: true,
    cell: (l) => <EditableTextCell lead={l} field="email" type="email" />,
  },
  { id: 'priority', label: 'Priority', cell: (l, ctx) => <PriorityCell lead={l} isAdmin={ctx.isAdmin} /> },
  {
    id: 'assigned',
    label: 'Assigned To',
    sortField: 'assignedAt',
    adminOnly: true,
    cell: (l, ctx) =>
      ctx.onAssign ? (
        <AssignSelect lead={l} telecallers={ctx.telecallers} onAssign={ctx.onAssign} />
      ) : (
        (l.assignedTo as User | undefined)?.name ?? <span className="text-slate-300">—</span>
      ),
  },
  { id: 'phone1', label: 'Phone 1', cell: (l) => <PhoneNumberCell lead={l} phone="phone1" /> },
  { id: 'callstatus1', label: 'Call Status 1', cell: (l) => <CallStatusCell lead={l} phone="phone1" /> },
  { id: 'leadstatus1', label: 'Lead Status 1', cell: (l) => <LeadStatusCell lead={l} phone="phone1" /> },
  { id: 'remark1', label: 'Remark 1', cell: (l) => <PhoneRemarkCell lead={l} phone="phone1" /> },
  { id: 'phone2', label: 'Phone 2', cell: (l) => <PhoneNumberCell lead={l} phone="phone2" /> },
  { id: 'callstatus2', label: 'Call Status 2', cell: (l) => <CallStatusCell lead={l} phone="phone2" /> },
  { id: 'leadstatus2', label: 'Lead Status 2', cell: (l) => <LeadStatusCell lead={l} phone="phone2" /> },
  { id: 'remark2', label: 'Remark 2', cell: (l) => <PhoneRemarkCell lead={l} phone="phone2" /> },
  { id: 'phone3', label: 'Phone 3', cell: (l) => <PhoneNumberCell lead={l} phone="phone3" /> },
  { id: 'callstatus3', label: 'Call Status 3', cell: (l) => <CallStatusCell lead={l} phone="phone3" /> },
  { id: 'leadstatus3', label: 'Lead Status 3', cell: (l) => <LeadStatusCell lead={l} phone="phone3" /> },
  { id: 'remark3', label: 'Remark 3', cell: (l) => <PhoneRemarkCell lead={l} phone="phone3" /> },
  { id: 'lastContacted', label: 'Last Contacted', sortField: 'lastContactedAt', muted: true, cell: (l) => (l.lastContactedAt ? fmtDate(l.lastContactedAt) : '—') },
  { id: 'followup', label: 'Follow-up', cell: (l) => <FollowUpCell lead={l} /> },
  { id: 'added', label: 'Added', sortField: 'createdAt', muted: true, cell: (l) => fmtDate(l.createdAt) },
];

const COLUMN_MAP: Record<string, ColumnDef> = Object.fromEntries(COLUMNS.map((c) => [c.id, c]));
const DEFAULT_DATA_COL_IDS = COLUMNS.map((c) => c.id);

/** Resolves the effective full data-column order from the persisted order, appending any new columns. */
function resolveOrder(stored: string[]): string[] {
  const valid = stored.filter((id) => COLUMN_MAP[id]);
  const missing = DEFAULT_DATA_COL_IDS.filter((id) => !valid.includes(id));
  return [...valid, ...missing];
}

/** Toggle that reveals/hides the phone number digits, in the desktop top bar and
 *  (as `full`) in the phone filter sheet, where it applies to the mobile cards. */
export function ShowNumbersToggle({ full }: { full?: boolean } = {}) {
  const show = useUiStore((s) => s.showPhoneNumbers);
  const toggle = useUiStore((s) => s.toggleShowPhoneNumbers);
  return (
    <button
      onClick={toggle}
      title={show ? 'Hide phone numbers' : 'Show phone numbers'}
      className={`flex items-center gap-1 rounded-lg border font-medium transition-colors ${
        full ? 'min-h-11 w-full justify-center px-3 py-2 text-sm' : 'shrink-0 px-2.5 py-1.5 text-xs'
      } ${
        show
          ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/15 dark:text-brand-300'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {show ? <Eye size={full ? 15 : 13} /> : <EyeOff size={full ? 15 : 13} />}
      {full ? (show ? 'Numbers shown' : 'Numbers hidden') : 'Numbers'}
    </button>
  );
}

/** Dropdown to show/hide table columns. Rendered in the contacts top bar. */
export function ColumnsMenu({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hiddenCols = useUiStore((s) => s.hiddenCols);
  const toggleCol = useUiStore((s) => s.toggleCol);
  const resetCols = useUiStore((s) => s.resetCols);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const cols = COLUMNS.filter((c) => !c.adminOnly || isAdmin);
  const hiddenCount = cols.filter((c) => hiddenCols.includes(c.id)).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          open || hiddenCount
            ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/15 dark:text-brand-300'
            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
        }`}
      >
        <Columns3 size={13} />
        Columns
        <ChevronDown size={12} />
        {hiddenCount > 0 && <span className="ml-0.5 rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-white">{hiddenCount}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Toggle columns</span>
            <button onClick={resetCols} className="flex items-center gap-1 text-[11px] text-brand-600 hover:underline dark:text-brand-400">
              <RotateCcw size={11} /> Reset
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto text-slate-700 dark:text-slate-200">
            {cols.map((c) => {
              const visible = !hiddenCols.includes(c.id);
              return (
                <label
                  key={c.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                    c.locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    disabled={c.locked}
                    onChange={() => toggleCol(c.id)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  {c.label}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function ContactsTable({
  leads,
  isLoading,
  role,
  density,
  selectable,
  selected,
  onToggle,
  onToggleAll,
  telecallers = [],
  onAssign,
  sortBy,
  order,
  onSort,
  emptyHint,
}: Props) {
  const isAdmin = role === 'superadmin';
  const pad = density === 'compact' ? 'px-2 py-1' : 'px-2 py-2.5';

  // The contact currently open in the full edit modal (null = closed). Both roles
  // may edit; the server scopes telecallers to contacts assigned to them.
  const [editingLead, setEditingLead] = useState<Lead | null>(null);

  // Resizable columns (widths persisted in the UI store).
  const storedWidths = useUiStore((s) => s.colWidths);
  const setColWidths = useUiStore((s) => s.setColWidths);
  const colOrder = useUiStore((s) => s.colOrder);
  const setColOrder = useUiStore((s) => s.setColOrder);
  const hiddenCols = useUiStore((s) => s.hiddenCols);
  const [widths, setWidths] = useState<Record<string, number>>({ ...DEFAULT_WIDTHS, ...storedWidths });
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  // The effective, ordered & visible data columns (respects role + hidden list).
  const fullOrder = resolveOrder(colOrder);
  const visibleCols = fullOrder
    .map((id) => COLUMN_MAP[id])
    .filter((c): c is ColumnDef => !!c && (!c.adminOnly || isAdmin) && !hiddenCols.includes(c.id));

  // Keep Name as the first data column so it can stay frozen (sticky) on the left.
  const nameIdx = visibleCols.findIndex((c) => c.id === 'name');
  if (nameIdx > 0) visibleCols.unshift(visibleCols.splice(nameIdx, 1)[0]);

  const renderedColIds = [...(selectable ? ['select'] : []), 'expand', ...visibleCols.map((c) => c.id)];
  const widthOf = (id: string) => widths[id] ?? DEFAULT_WIDTHS[id] ?? 120;
  const totalWidth = renderedColIds.reduce((s, id) => s + widthOf(id), 0);

  // Left offsets for the frozen (sticky) leading columns: select · expand · name.
  const PINNED_IDS = ['select', 'expand', 'name'];
  const pinnedLeft: Record<string, number> = {};
  {
    let x = 0;
    for (const cid of renderedColIds) {
      if (PINNED_IDS.includes(cid)) pinnedLeft[cid] = x;
      x += widthOf(cid);
    }
  }

  function startResize(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(id);
    const move = (ev: MouseEvent) => setWidths((p) => ({ ...p, [id]: Math.max(60, startW + ev.clientX - startX) }));
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      setColWidths(widthsRef.current);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  // Drag-to-reorder: operates on the full data order so hidden columns keep position.
  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setOverId(null);
      return;
    }
    const base = resolveOrder(colOrder);
    const from = base.indexOf(dragId);
    const to = base.indexOf(targetId);
    if (from !== -1 && to !== -1) {
      base.splice(to, 0, base.splice(from, 1)[0]);
      setColOrder(base);
    }
    setDragId(null);
    setOverId(null);
  }

  if (isLoading) return <Spinner />;
  if (!leads.length) return <EmptyState title="Nothing here yet" hint={emptyHint} />;

  const allChecked = selectable && leads.every((l) => selected.includes(l._id));

  const SortHeader = ({ field, label }: { field: string; label: string }) => (
    <button onClick={() => onSort(field)} className="flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
      {label}
      {sortBy === field && (order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  );

  // Header cell for a draggable, resizable, sortable data column.
  const ThData = ({ col }: { col: ColumnDef }) => {
    const pinned = col.id === 'name';
    return (
    <th
      style={pinned ? { position: 'sticky', left: pinnedLeft.name } : undefined}
      className={`relative select-none px-2 py-2 ${overId === col.id ? 'bg-brand-50' : ''} ${
        pinned ? 'z-30 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700' : ''
      }`}
      onDragOver={(e) => {
        if (dragId) {
          e.preventDefault();
          if (overId !== col.id) setOverId(col.id);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(col.id);
      }}
    >
      <div
        draggable
        onDragStart={() => setDragId(col.id)}
        onDragEnd={() => { setDragId(null); setOverId(null); }}
        title="Drag to reorder"
        className={`flex cursor-grab items-center gap-1 active:cursor-grabbing ${dragId === col.id ? 'opacity-40' : ''}`}
      >
        <GripVertical size={11} className="shrink-0 text-slate-300" />
        {col.sortField ? <SortHeader field={col.sortField} label={col.label} /> : <span>{col.label}</span>}
      </div>
      <span
        onMouseDown={(e) => startResize(col.id, e)}
        className="absolute right-0 top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-brand-300"
      />
    </th>
    );
  };

  return (
    <>
      {/* Desktop grid (horizontally scrollable, resizable + reorderable columns) */}
      <div className="hidden md:block">
        <table className="text-sm" style={{ tableLayout: 'fixed', width: totalWidth }}>
          <colgroup>
            {renderedColIds.map((id) => (
              <col key={id} style={{ width: widthOf(id) }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_#e2e8f0] dark:bg-slate-900 dark:shadow-[0_1px_0_0_#334155]">
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {selectable && (
                <th
                  style={{ position: 'sticky', left: pinnedLeft.select }}
                  className="relative z-30 select-none bg-white px-2 py-2 dark:bg-slate-900"
                >
                  <input type="checkbox" className="h-4 w-4" checked={!!allChecked} onChange={onToggleAll} />
                </th>
              )}
              <th
                style={{ position: 'sticky', left: pinnedLeft.expand }}
                className="relative z-30 select-none bg-white px-2 py-2 dark:bg-slate-900"
              />
              {visibleCols.map((col) => (
                <ThData key={col.id} col={col} />
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <Row
                key={lead._id}
                columns={visibleCols}
                pinnedLeft={pinnedLeft}
                lead={lead}
                isAdmin={isAdmin}
                role={role}
                pad={pad}
                selectable={selectable}
                selected={selected.includes(lead._id)}
                onToggle={onToggle}
                telecallers={telecallers}
                onAssign={onAssign}
                onEdit={setEditingLead}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
        {leads.map((lead) => (
          <MobileCard
            key={lead._id}
            lead={lead}
            isAdmin={isAdmin}
            role={role}
            selectable={selectable}
            selected={selected.includes(lead._id)}
            onToggle={onToggle}
            telecallers={telecallers}
            onAssign={onAssign}
            onEdit={setEditingLead}
          />
        ))}
      </div>

      <ContactFormModal
        open={!!editingLead}
        lead={editingLead}
        onClose={() => setEditingLead(null)}
      />
    </>
  );
}

/* ----------------------------- shared cells ------------------------------ */

function AssignSelect({
  lead,
  telecallers,
  onAssign,
}: {
  lead: Lead;
  telecallers: User[];
  onAssign?: (id: string, tid: string, name: string) => void;
}) {
  return (
    <select
      value={(lead.assignedTo as User | undefined)?._id ?? ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const t = telecallers.find((x) => x._id === e.target.value);
        if (t) onAssign?.(lead._id, t._id, t.name);
      }}
      className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 md:min-h-0"
    >
      <option value="">Assign…</option>
      {telecallers.map((t) => (
        <option key={t._id} value={t._id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}

function PriorityCell({ lead, isAdmin }: { lead: Lead; isAdmin: boolean }) {
  const update = useUpdateLead();
  if (!isAdmin) {
    return <Badge className={PRIORITY_COLORS[lead.priority]}>{lead.priority}</Badge>;
  }
  return (
    <select
      value={lead.priority}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) =>
        update.mutate(
          { id: lead._id, priority: e.target.value as Lead['priority'] },
          { onError: (err) => toast.error(apiError(err)) }
        )
      }
      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
    >
      {PRIORITIES.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}

/** Per-phone call tracking panel shown inside the expanded row. */
function PhoneOutcomePanel({
  lead,
  phone,
  isAdmin,
}: {
  lead: Lead;
  phone: PhoneSlot;
  isAdmin: boolean;
}) {
  const phoneNumber = phoneNumberOf(lead, phone) ?? '';
  const slot = phoneSlotOf(lead, phone) ?? {
    callStatus: 'pending' as PhoneCallStatus,
    leadOutcome: 'none' as PhoneLeadOutcome,
  };
  const [remarkText, setRemarkText] = useState('');
  const update = useUpdatePhoneOutcome();

  const phoneRemarks = (lead.remarks ?? []).filter(
    (r) => r.phone === phone || (phone === 'phone1' && !r.phone),
  );

  function setCallStatus(cs: PhoneCallStatus) {
    update.mutate({ id: lead._id, phone, callStatus: cs }, { onError: (e) => toast.error(apiError(e)) });
  }
  function setLeadOutcome(lo: PhoneLeadOutcome) {
    update.mutate({ id: lead._id, phone, leadOutcome: lo }, { onError: (e) => toast.error(apiError(e)) });
  }
  function submitRemark() {
    const t = remarkText.trim();
    if (!t) return;
    setRemarkText('');
    update.mutate({ id: lead._id, phone, remark: t }, { onError: (e) => toast.error(apiError(e)) });
  }

  const label = phone === 'phone1' ? 'Phone 1' : phone === 'phone2' ? 'Phone 2' : 'Phone 3';

  if (isAdmin) {
    return (
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {label}
          {phoneNumber && (
            <span className="ml-1.5 normal-case text-slate-500 dark:text-slate-400">
              {formatPhoneDisplay(phoneNumber, lead.country)}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <PhoneActions phone={phoneNumber} lead={lead} slot={phone} />
          <Badge className={PHONE_CALL_STATUS_COLORS[slot.callStatus]}>
            {PHONE_CALL_STATUS_LABELS[slot.callStatus]}
          </Badge>
          {slot.leadOutcome !== 'none' && (
            <Badge className={PHONE_LEAD_OUTCOME_COLORS[slot.leadOutcome]}>
              {PHONE_LEAD_OUTCOME_LABELS[slot.leadOutcome]}
            </Badge>
          )}
        </div>
        {phoneRemarks.slice(-2).reverse().map((r, i) => (
          <div key={r._id ?? i} className="rounded bg-slate-50 p-1.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {r.text}
            <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">{fmtDate(r.createdAt)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
      <PhoneActions phone={phoneNumber} lead={lead} slot={phone} />
      <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
        {PHONE_CALL_OPTIONS.map((cs) => (
          <button
            key={cs}
            onClick={() => setCallStatus(cs)}
            disabled={update.isPending}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              slot.callStatus === cs
                ? `${PHONE_CALL_STATUS_COLORS[cs]} ring-1 ring-current`
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
          >
            {PHONE_CALL_STATUS_LABELS[cs]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
        {PHONE_LEAD_OPTIONS.map((lo) => (
          <button
            key={lo}
            onClick={() => setLeadOutcome(lo)}
            disabled={update.isPending}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              slot.leadOutcome === lo
                ? `${PHONE_LEAD_OUTCOME_COLORS[lo]} ring-1 ring-current`
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
          >
            {PHONE_LEAD_OUTCOME_LABELS[lo]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input
          value={remarkText}
          onChange={(e) => setRemarkText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitRemark()}
          placeholder={`Remark for ${label}…`}
          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        <button onClick={submitRemark} className="rounded p-1 text-brand-600 hover:bg-brand-50" title="Send">
          <Send size={13} />
        </button>
      </div>
      {phoneRemarks.slice(-2).reverse().map((r, i) => (
        <p key={r._id ?? i} className="truncate text-[11px] text-slate-400" title={r.text}>
          {r.text}
        </p>
      ))}
    </div>
  );
}

function ExpandedDetail({
  lead,
  isAdmin,
  onEdit,
  compact,
}: {
  lead: Lead;
  isAdmin: boolean;
  onEdit?: (lead: Lead) => void;
  /** Mobile: the card above already shows the per-phone panels — don't repeat them. */
  compact?: boolean;
}) {
  const del = useDeleteLead();
  const loc = location(lead);

  function onDelete() {
    if (!confirm(`Delete contact "${lead.name}"? This cannot be undone.`)) return;
    del.mutate(lead._id, {
      onSuccess: () => toast.success('Contact deleted'),
      onError: (e) => toast.error(apiError(e)),
    });
  }

  return (
    <div className="space-y-4 bg-slate-50 p-3 dark:bg-slate-900/50 sm:p-4">
      {/* Per-phone call tracking */}
      {!compact && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <PhoneOutcomePanel lead={lead} phone="phone1" isAdmin={isAdmin} />
          {lead.altPhone && <PhoneOutcomePanel lead={lead} phone="phone2" isAdmin={isAdmin} />}
          {lead.altPhone2 && <PhoneOutcomePanel lead={lead} phone="phone3" isAdmin={isAdmin} />}
        </div>
      )}

      {/* Contact details, timestamps, and full remarks timeline */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-2 text-sm">
          {lead.email && <Detail label="Email" value={lead.email} />}
          {loc && <Detail label="Location" value={loc} />}
          {lead.source && <Detail label="Source" value={lead.source} />}
          {!!lead.tags?.length && <Detail label="Tags" value={lead.tags.join(', ')} />}
        </div>
        <div className="space-y-2 text-sm">
          {lead.lastContactedAt && <Detail label="Last contacted" value={fmtDateTime(lead.lastContactedAt)} />}
          {lead.nextFollowUpAt && <Detail label="Next follow-up" value={fmtDateTime(lead.nextFollowUpAt)} />}
          <Detail label="Added" value={fmtDateTime(lead.createdAt)} />
          <div className="flex flex-wrap gap-2 pt-1">
            {onEdit && (
              <Button size="sm" variant="secondary" onClick={() => onEdit(lead)}>
                <Pencil size={14} /> Edit details
              </Button>
            )}
            {isAdmin && (
              <Button size="sm" variant="danger" onClick={onDelete}>
                <Trash2 size={14} /> Delete contact
              </Button>
            )}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">All Remarks</p>
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {!lead.remarks?.length && <p className="text-xs text-slate-400 dark:text-slate-500">No remarks yet.</p>}
            {(lead.remarks ?? [])
              .slice()
              .reverse()
              .map((r, i) => (
                <div key={r._id ?? i} className="rounded-lg bg-white p-2 dark:bg-slate-800">
                  <p className="text-xs text-slate-700 dark:text-slate-200">{r.text}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                    {r.byName || 'Unknown'}
                    {r.byRole ? ` (${r.byRole === 'superadmin' ? 'Admin' : 'User'})` : ''}
                    {r.phone ? ` · ${r.phone === 'phone1' ? 'Phone 1' : r.phone === 'phone2' ? 'Phone 2' : 'Phone 3'}` : ''} ·{' '}
                    {fmtDateTime(r.createdAt)}
                  </p>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Call log & recordings for this contact */}
      <CallHistory leadId={lead._id} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-slate-400 dark:text-slate-500">{label}</span>
      <p className="break-words text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
}

/* ------------------------------ desktop row ------------------------------ */

function Row({
  lead,
  columns,
  pinnedLeft,
  isAdmin,
  pad,
  selectable,
  selected,
  onToggle,
  telecallers,
  onAssign,
  onEdit,
}: {
  lead: Lead;
  columns: ColumnDef[];
  pinnedLeft: Record<string, number>;
  isAdmin: boolean;
  role: Role;
  pad: string;
  selectable?: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  telecallers: User[];
  onAssign?: (id: string, tid: string, name: string) => void;
  onEdit?: (lead: Lead) => void;
}) {
  const [open, setOpen] = useState(false);
  const muted = 'text-slate-500 dark:text-slate-400';
  const ctx: CellCtx = { isAdmin, telecallers, onAssign, onEdit };

  // Frozen-left cells share an opaque background that follows the row hover state.
  const stickyBg =
    'bg-white group-hover:bg-slate-50 dark:bg-slate-900 dark:group-hover:bg-slate-800';

  return (
    <>
      <tr className="group border-b border-slate-100 hover:bg-slate-50/60 dark:border-slate-800 dark:hover:bg-slate-800/40">
        {selectable && (
          <td style={{ position: 'sticky', left: pinnedLeft.select, zIndex: 10 }} className={`${pad} ${stickyBg}`}>
            <input type="checkbox" className="h-4 w-4" checked={selected} onChange={() => onToggle(lead._id)} />
          </td>
        )}
        <td style={{ position: 'sticky', left: pinnedLeft.expand, zIndex: 10 }} className={`${pad} ${stickyBg}`}>
          <button onClick={() => setOpen((o) => !o)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        {columns.map((col) => {
          const pinned = col.id === 'name';
          return (
            <td
              key={col.id}
              style={pinned ? { position: 'sticky', left: pinnedLeft.name, zIndex: 10 } : undefined}
              className={`${col.muted ? `${pad} ${muted}` : pad} ${
                pinned ? `${stickyBg} border-r border-slate-200 dark:border-slate-700` : ''
              }`}
            >
              {col.cell(lead, ctx)}
            </td>
          );
        })}
      </tr>
      {open && (
        <tr>
          <td colSpan={99} className="p-0">
            <ExpandedDetail lead={lead} isAdmin={isAdmin} onEdit={onEdit} />
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------ mobile card ------------------------------ */

/**
 * One contact, sized for a thumb. The desktop grid packs 24 columns behind a
 * horizontal scrollbar; on a phone that same information is layered instead —
 * identity and status up front, then one block per phone number carrying the
 * actions and the two outcome dropdowns that make up the actual call workflow,
 * then everything else behind the expander.
 */
function MobilePhoneBlock({ lead, slot }: { lead: Lead; slot: PhoneSlot }) {
  const num = phoneNumberOf(lead, slot);
  const outcome = phoneSlotOf(lead, slot);
  const showNumbers = useUiStore((s) => s.showPhoneNumbers);
  const update = useUpdatePhoneOutcome();
  const [remark, setRemark] = useState('');
  const [showRemark, setShowRemark] = useState(false);

  const phoneRemarks = (lead.remarks ?? []).filter((r) => r.phone === slot || (slot === 'phone1' && !r.phone));
  const last = phoneRemarks[phoneRemarks.length - 1];
  const callStatus = (outcome?.callStatus ?? 'pending') as PhoneCallStatus;
  const leadOutcome = (outcome?.leadOutcome ?? 'none') as PhoneLeadOutcome;
  const label = slot === 'phone1' ? 'Phone 1' : slot === 'phone2' ? 'Phone 2' : 'Phone 3';

  if (!num) return null;

  function submitRemark() {
    const t = remark.trim();
    if (!t) return;
    setRemark('');
    setShowRemark(false);
    update.mutate({ id: lead._id, phone: slot, remark: t }, { onError: (e) => toast.error(apiError(e)) });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {label}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
          {showNumbers ? formatPhoneDisplay(num, lead.country) : '•••• ••••'}
        </p>
      </div>
      <div className="mt-1.5">
        <PhoneActions phone={num} lead={lead} slot={slot} big />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <select
          aria-label={`Call status for ${label}`}
          value={callStatus}
          onChange={(e) =>
            update.mutate(
              { id: lead._id, phone: slot, callStatus: e.target.value as PhoneCallStatus },
              { onError: (err) => toast.error(apiError(err)) }
            )
          }
          className={`min-h-11 w-full truncate rounded-lg border border-slate-300 py-2 pl-2 pr-7 font-medium outline-none focus:border-brand-500 dark:border-slate-600 ${PHONE_CALL_STATUS_COLORS[callStatus]}`}
        >
          <option value="pending">Not Called</option>
          <option value="connected">Connected</option>
          <option value="not_connected">Not Connected</option>
          <option value="voicemail">Voice Mail</option>
          <option value="incorrect_no">Incorrect No</option>
        </select>
        <select
          aria-label={`Lead status for ${label}`}
          value={leadOutcome}
          onChange={(e) =>
            update.mutate(
              { id: lead._id, phone: slot, leadOutcome: e.target.value as PhoneLeadOutcome },
              { onError: (err) => toast.error(apiError(err)) }
            )
          }
          className={`min-h-11 w-full truncate rounded-lg border border-slate-300 py-2 pl-2 pr-7 font-medium outline-none focus:border-brand-500 dark:border-slate-600 ${PHONE_LEAD_OUTCOME_COLORS[leadOutcome]}`}
        >
          <option value="none">No outcome</option>
          <option value="interested">Interested</option>
          <option value="not_interested">Not Interested</option>
        </select>
      </div>

      {outcome?.lastCalledAt && (
        <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500" title={fmtDateTime(outcome.lastCalledAt)}>
          Called {fmtRelative(outcome.lastCalledAt)}
        </p>
      )}

      {/* The remark box only unfolds when it's wanted — otherwise three of them
          would push the next contact off the screen. */}
      {showRemark ? (
        <div className="mt-2 flex items-center gap-1.5">
          <input
            autoFocus
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitRemark()}
            placeholder={`Remark for ${label}…`}
            className="min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <button
            onClick={submitRemark}
            aria-label="Save remark"
            className="tap flex items-center justify-center rounded-lg bg-brand-600 px-3 text-white"
          >
            <Send size={16} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowRemark(true)}
          className="mt-2 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-2.5 py-2 text-left text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400"
        >
          <Send size={12} className="shrink-0" />
          <span className="truncate">
            {last ? `${phoneRemarks.length}× · ${last.text}` : 'Add a remark'}
          </span>
        </button>
      )}
    </div>
  );
}

function MobileCard({
  lead,
  isAdmin,
  selectable,
  selected,
  onToggle,
  telecallers,
  onAssign,
  onEdit,
}: {
  lead: Lead;
  isAdmin: boolean;
  role: Role;
  selectable?: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  telecallers: User[];
  onAssign?: (id: string, tid: string, name: string) => void;
  onEdit?: (lead: Lead) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showAllPhones, setShowAllPhones] = useState(false);
  // The detail panel opens below a tall card — pull it into view so the tap
  // visibly does something.
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [open]);
  const loc = location(lead);
  const assignee = (lead.assignedTo as User | undefined)?.name;
  const extraSlots = (['phone2', 'phone3'] as PhoneSlot[]).filter((sl) => !!phoneNumberOf(lead, sl));

  return (
    <div className="p-3">
      <div className="flex items-start gap-2.5">
        {selectable && (
          <label className="tap -m-1 flex shrink-0 items-start p-1 pt-2">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={selected}
              onChange={() => onToggle(lead._id)}
              aria-label={`Select ${lead.name}`}
            />
          </label>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-slate-800 dark:text-slate-100">{lead.name}</p>
              {(lead.company || lead.title) && (
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {[lead.title, lead.company].filter(Boolean).join(' · ')}
                </p>
              )}
              {loc && <p className="truncate text-xs text-slate-400 dark:text-slate-500">{loc}</p>}
            </div>
            <button
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? 'Hide details' : 'Show details'}
              aria-expanded={open}
              className="tap -mr-1 flex shrink-0 items-center justify-center rounded-lg text-slate-400"
            >
              {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
            </button>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge className={LEAD_STATUS_COLORS[lead.status]}>{LEAD_STATUS_LABELS[lead.status]}</Badge>
            {lead.qualified && <Badge className="bg-green-600 text-white">Lead</Badge>}
            <Badge className={PRIORITY_COLORS[lead.priority]}>{lead.priority}</Badge>
            {assignee && (
              <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{assignee}</Badge>
            )}
          </div>
        </div>
      </div>

      {/* Phone 1 is the working number and stays open; the alternates fold away
          so one contact doesn't fill the whole screen. */}
      <div className="mt-2.5 space-y-2">
        <MobilePhoneBlock lead={lead} slot="phone1" />
        {extraSlots.length > 0 &&
          (showAllPhones ? (
            extraSlots.map((slot) => <MobilePhoneBlock key={slot} lead={lead} slot={slot} />)
          ) : (
            <button
              onClick={() => setShowAllPhones(true)}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 text-xs font-medium text-slate-500 dark:border-slate-600 dark:text-slate-400"
            >
              <Phone size={13} /> {extraSlots.length} more number{extraSlots.length > 1 ? 's' : ''}
            </button>
          ))}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {isAdmin && onAssign && (
          <div className="min-w-0 flex-1">
            <AssignSelect lead={lead} telecallers={telecallers} onAssign={onAssign} />
          </div>
        )}
        {onEdit && (
          <button
            onClick={() => onEdit(lead)}
            className="tap flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-medium text-slate-600 dark:border-slate-600 dark:text-slate-300"
          >
            <Pencil size={14} /> Edit
          </button>
        )}
      </div>

      {open && (
        <div
          ref={detailRef}
          className="mt-2 overflow-hidden rounded-xl border border-slate-200 scroll-mb-24 dark:border-slate-700"
        >
          <ExpandedDetail lead={lead} isAdmin={isAdmin} onEdit={onEdit} compact />
        </div>
      )}
    </div>
  );
}
