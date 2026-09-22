import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { isValidPhoneNumber } from 'libphonenumber-js';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Field';
import { useCreateLead, useUpdateLead } from '@/api/leads';
import { useTelecallers } from '@/api/users';
import { apiError } from '@/api/client';
import { useAuthStore } from '@/store/auth';
import { LEAD_STATUS_LABELS } from '@/lib/constants';
import { COUNTRY_NAMES } from '@/lib/countries';
import { toE164 } from '@/lib/phone';
import type { Lead, LeadStatus, User } from '@/types';

const STATUSES: LeadStatus[] = [
  'new',
  'assigned',
  'in_progress',
  'interested',
  'callback',
  'not_interested',
  'converted',
  'dnd',
];

/** Every editable field, as strings — the form's single source of truth. */
interface FormState {
  name: string;
  title: string;
  company: string;
  phone: string;
  altPhone: string;
  altPhone2: string;
  email: string;
  city: string;
  state: string;
  country: string;
  source: string;
  status: LeadStatus;
  priority: 'low' | 'medium' | 'high';
  assignedTo: string;
  tags: string[];
  notes: string;
}

const EMPTY: FormState = {
  name: '',
  title: '',
  company: '',
  phone: '',
  altPhone: '',
  altPhone2: '',
  email: '',
  city: '',
  state: '',
  country: '',
  source: '',
  status: 'new',
  priority: 'medium',
  assignedTo: '',
  tags: [],
  notes: '',
};

function fromLead(lead: Lead): FormState {
  return {
    name: lead.name ?? '',
    title: lead.title ?? '',
    company: lead.company ?? '',
    phone: lead.phone ?? '',
    altPhone: lead.altPhone ?? '',
    altPhone2: lead.altPhone2 ?? '',
    email: lead.email ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    country: lead.country ?? '',
    source: lead.source ?? '',
    status: lead.status ?? 'new',
    priority: lead.priority ?? 'medium',
    // assignedTo arrives populated on list reads and as a raw id elsewhere.
    assignedTo:
      typeof lead.assignedTo === 'string'
        ? lead.assignedTo
        : (lead.assignedTo as User | null | undefined)?._id ?? '',
    tags: lead.tags ?? [],
    notes: lead.notes ?? '',
  };
}

/* -------------------------------- layout -------------------------------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {title}
      </h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function FormField({
  label,
  span,
  hint,
  error,
  children,
}: {
  label: string;
  span?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={span ? 'sm:col-span-2' : undefined}>
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------ tags editor ------------------------------ */

function TagsInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [draft, setDraft] = useState('');

  function commit(raw: string) {
    // Accept comma-separated pastes in one go.
    const added = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !tags.includes(t));
    if (added.length) onChange([...tags, ...added]);
    setDraft('');
  }

  return (
    <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 px-2 py-1.5 focus-within:border-brand-500 dark:border-slate-600 dark:bg-slate-800">
      {tags.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
        >
          {t}
          <button
            type="button"
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="-mr-1 rounded-full p-1 text-brand-400 hover:text-brand-700 dark:hover:text-brand-200"
            aria-label={`Remove tag ${t}`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => draft && commit(draft)}
        placeholder={tags.length ? '' : 'Type a tag and press Enter'}
        className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none dark:text-slate-100"
      />
    </div>
  );
}

/* -------------------------------- modal --------------------------------- */

interface Props {
  open: boolean;
  onClose: () => void;
  /** Provide to edit an existing contact; omit to create a new one. */
  lead?: Lead | null;
}

export function ContactFormModal({ open, onClose, lead }: Props) {
  const isEdit = !!lead;
  const isAdmin = useAuthStore((s) => s.user!.role) === 'superadmin';
  const create = useCreateLead();
  const update = useUpdateLead();
  const { data: telecallers } = useTelecallers({ isActive: 'true', limit: 100 }, { enabled: open && isAdmin });

  // The baseline the form was opened with — used for dirty-tracking and to send
  // only changed fields on save.
  const initial = useMemo(() => (lead ? fromLead(lead) : EMPTY), [lead]);
  const [form, setForm] = useState<FormState>(initial);
  const [touched, setTouched] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Re-seed whenever the modal opens, or the row being edited changes.
  useEffect(() => {
    if (open) {
      setForm(initial);
      setTouched(false);
    }
  }, [open, initial]);

  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /* ------------------------------ validation ----------------------------- */

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.phone.trim()) e.phone = 'Phone 1 is required';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      e.email = 'Enter a valid email address';
    }
    return e;
  }, [form.name, form.phone, form.email]);

  const hasErrors = Object.keys(errors).length > 0;

  // Numbers that parse but aren't dialable are a warning, not a blocker — plenty
  // of imported rows are imperfect and still worth saving.
  const phoneWarnings = useMemo(() => {
    const warn: string[] = [];
    for (const [label, raw] of [
      ['Phone 1', form.phone],
      ['Phone 2', form.altPhone],
      ['Phone 3', form.altPhone2],
    ] as const) {
      if (!raw.trim()) continue;
      const e164 = toE164(raw, form.country);
      if (e164.startsWith('+') && !isValidPhoneNumber(e164)) warn.push(label);
    }
    return warn;
  }, [form.phone, form.altPhone, form.altPhone2, form.country]);

  // Mirrors the server's gap-free phone slots: it slides numbers up on save, so
  // say that will happen rather than letting it look like data was lost.
  const willCompact =
    (!form.phone.trim() && (form.altPhone.trim() || form.altPhone2.trim())) ||
    (!form.altPhone.trim() && !!form.altPhone2.trim());

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial]
  );

  /* -------------------------------- save --------------------------------- */

  async function handleSubmit() {
    setTouched(true);
    if (hasErrors) return;

    const trimmed: FormState = {
      ...form,
      name: form.name.trim(),
      title: form.title.trim(),
      company: form.company.trim(),
      phone: form.phone.trim(),
      altPhone: form.altPhone.trim(),
      altPhone2: form.altPhone2.trim(),
      email: form.email.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      country: form.country.trim(),
      source: form.source.trim(),
    };

    try {
      if (isEdit) {
        // Send only what changed — avoids clobbering fields another user edited
        // between this row loading and the save.
        const patch: Record<string, unknown> = {};
        for (const k of Object.keys(trimmed) as (keyof FormState)[]) {
          if (JSON.stringify(trimmed[k]) !== JSON.stringify(initial[k])) patch[k] = trimmed[k];
        }
        // Ownership is admin-only; the server drops it for telecallers anyway.
        if (!isAdmin) delete patch.assignedTo;
        if (!Object.keys(patch).length) {
          onClose();
          return;
        }
        await update.mutateAsync({ id: lead!._id, ...(patch as Partial<Lead>) });
        toast.success('Contact updated');
      } else {
        await create.mutateAsync({
          ...trimmed,
          source: trimmed.source || 'manual',
          assignedTo: trimmed.assignedTo || undefined,
        });
        toast.success('Contact created');
      }
      onClose();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  const saving = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? `Edit ${lead!.name}` : 'Add contact'}
      footer={
        <div className="flex items-center justify-between gap-2">
          {/* The keyboard hint only means something where there's a keyboard. */}
          <span className="hidden text-[11px] text-slate-400 dark:text-slate-500 sm:block">
            {isEdit && !dirty ? 'No changes yet' : <>Press <kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">⌘</kbd>+<kbd className="rounded border border-slate-300 px-1 dark:border-slate-600">Enter</kbd> to save</>}
          </span>
          <div className="flex flex-1 gap-2 [&>*]:flex-1 sm:flex-none sm:[&>*]:flex-none">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={saving} disabled={isEdit && !dirty}>
              {isEdit ? 'Save changes' : 'Create contact'}
            </Button>
          </div>
        </div>
      }
    >
      <div
        className="space-y-5"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          }
        }}
      >
        <Section title="Identity">
          <FormField label="Name *" span error={touched ? errors.name : undefined}>
            <Input
              ref={firstFieldRef}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Contact or company contact name"
            />
          </FormField>
          <FormField label="Job title">
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Ops Manager" />
          </FormField>
          <FormField label="Company">
            <Input value={form.company} onChange={(e) => set('company', e.target.value)} placeholder="Acme Pvt Ltd" />
          </FormField>
          <FormField label="Email" span error={touched ? errors.email : undefined}>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="ops@acme.com"
            />
          </FormField>
        </Section>

        <Section title="Phone numbers">
          <FormField label="Phone 1 *" error={touched ? errors.phone : undefined}>
            <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" />
          </FormField>
          <FormField label="Phone 2">
            <Input value={form.altPhone} onChange={(e) => set('altPhone', e.target.value)} placeholder="Optional" />
          </FormField>
          <FormField label="Phone 3">
            <Input value={form.altPhone2} onChange={(e) => set('altPhone2', e.target.value)} placeholder="Optional" />
          </FormField>
          <div className="space-y-1.5 sm:col-span-2">
            {phoneWarnings.length > 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {phoneWarnings.join(' and ')} may not be dialable. Saving is still fine — set the country to help
                us read local numbers.
              </p>
            )}
            {willCompact && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Empty slots get closed up on save, so the remaining numbers move up.
              </p>
            )}
          </div>
        </Section>

        <Section title="Location">
          <FormField label="City">
            <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
          </FormField>
          <FormField label="State / region">
            <Input value={form.state} onChange={(e) => set('state', e.target.value)} />
          </FormField>
          <FormField
            label="Country"
            span
            hint="Used to read local numbers and show the contact's local time."
          >
            <Input
              list="contact-country-list"
              value={form.country}
              onChange={(e) => set('country', e.target.value)}
              placeholder="India"
            />
            <datalist id="contact-country-list">
              {COUNTRY_NAMES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </FormField>
        </Section>

        <Section title="Classification">
          <FormField label="Status">
            <Select value={form.status} onChange={(e) => set('status', e.target.value as LeadStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Priority">
            <Select
              value={form.priority}
              onChange={(e) => set('priority', e.target.value as FormState['priority'])}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </FormField>
          <FormField label="Source">
            <Input value={form.source} onChange={(e) => set('source', e.target.value)} placeholder="manual" />
          </FormField>
          {isAdmin && (
            <FormField label="Assigned to">
              <Select value={form.assignedTo} onChange={(e) => set('assignedTo', e.target.value)}>
                <option value="">Unassigned</option>
                {telecallers?.data.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          <FormField label="Tags" span>
            <TagsInput tags={form.tags} onChange={(t) => set('tags', t)} />
          </FormField>
        </Section>

        <Section title="Notes">
          <FormField label="Internal notes" span>
            <Textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </FormField>
        </Section>
      </div>
    </Modal>
  );
}
