import { useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCreateTask } from '@/api/tasks';
import { useTelecallers } from '@/api/users';
import { apiError } from '@/api/client';
import { fromDateInput } from '@/lib/format';
import { useIsMobile } from '@/lib/useMediaQuery';
import { TASK_TYPE_LABELS, localDateInput } from './taskHelpers';
import type { TaskType } from '@/types';

/**
 * The whole assign flow, inline above the table — no dialog. Type a title, pick
 * people (each pick becomes a chip so one task can go to several users), hit
 * Enter. Everything else has a sane default.
 *
 * On a phone the bar's six controls would wrap into four ragged rows and push
 * the task list off screen, so it starts collapsed behind one button and opens
 * into a stacked form.
 */
export function TaskComposer() {
  const create = useCreateTask();
  const { data: telecallers } = useTelecallers({ isActive: 'true', limit: 200 });
  const titleRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [type, setType] = useState<TaskType>('custom');
  const [error, setError] = useState('');

  const people = telecallers?.data ?? [];
  const byId = useMemo(() => new Map(people.map((p) => [p._id, p])), [people]);
  const remaining = people.filter((p) => !assignees.includes(p._id));

  function reset() {
    setTitle('');
    setAssignees([]);
    setDueDate('');
    setPriority('medium');
    setType('custom');
    setError('');
  }

  async function submit() {
    if (!title.trim()) {
      setError('Give the task a title.');
      titleRef.current?.focus();
      return;
    }
    if (!assignees.length) {
      setError('Pick at least one person.');
      return;
    }
    setError('');
    try {
      // Omit what isn't set rather than sending explicit nulls, and send a lone
      // assignee as a plain string — a create has nothing to clear, so null adds
      // nothing and only narrows what the API has to accept.
      const res = await create.mutateAsync({
        title: title.trim(),
        description: '',
        type,
        priority,
        // Local midnight, so the day the admin picked is the day that's stored.
        ...(dueDate ? { dueDate: (fromDateInput(dueDate) ?? new Date(dueDate)).toISOString() } : {}),
        assignedTo: assignees.length === 1 ? assignees[0] : assignees,
      });
      toast.success(res.count > 1 ? `Assigned to ${res.count} people` : 'Task assigned');
      reset();
      if (isMobile) setOpen(false);
      else titleRef.current?.focus();
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  const cell =
    'rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-brand-500/25';
  const cellTouch = `${cell} min-h-11 w-full md:min-h-0`;

  const chips = assignees.length > 0 && (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 md:pl-7">
      {assignees.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1.5 pl-3 pr-1.5 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 md:py-1 md:pl-2.5 md:pr-1"
        >
          {byId.get(id)?.name ?? 'Unknown'}
          <button
            onClick={() => setAssignees((a) => a.filter((x) => x !== id))}
            aria-label={`Remove ${byId.get(id)?.name ?? 'person'}`}
            className="rounded-full p-1 hover:bg-brand-100 dark:hover:bg-brand-500/25 md:p-0.5"
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {people.length > 1 && assignees.length < people.length && (
        <button
          onClick={() => setAssignees(people.map((p) => p._id))}
          className="ml-1 px-1 py-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          Everyone
        </button>
      )}
    </div>
  );

  const errorLine = error && (
    <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400 md:pl-7">
      {error}
    </p>
  );

  /* ---------------------------- phone: stacked ---------------------------- */
  if (isMobile) {
    if (!open) {
      return (
        <button
          onClick={() => {
            setOpen(true);
            setTimeout(() => titleRef.current?.focus(), 50);
          }}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
        >
          <Plus size={16} /> Assign a task
        </button>
      );
    }

    return (
      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">New task</span>
          <button
            onClick={() => {
              reset();
              setOpen(false);
            }}
            aria-label="Cancel"
            className="tap -mr-2 flex items-center justify-center rounded-lg p-2 text-slate-400"
          >
            <X size={18} />
          </button>
        </div>

        <input
          ref={titleRef}
          aria-label="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          className={cellTouch}
        />

        <select
          aria-label="Assign to"
          value=""
          onChange={(e) => {
            if (e.target.value) setAssignees((a) => [...a, e.target.value]);
          }}
          disabled={!remaining.length}
          className={`${cellTouch} disabled:opacity-50`}
        >
          <option value="">{assignees.length ? 'Add another person…' : 'Assign to…'}</option>
          {remaining.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>

        {chips}

        <div className="grid grid-cols-2 gap-2">
          <input
            aria-label="Due date"
            type="date"
            value={dueDate}
            min={localDateInput()}
            onChange={(e) => setDueDate(e.target.value)}
            className={cellTouch}
          />
          <select
            aria-label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as typeof priority)}
            className={cellTouch}
          >
            <option value="low">Low priority</option>
            <option value="medium">Medium priority</option>
            <option value="high">High priority</option>
          </select>
        </div>

        <select
          aria-label="Task type"
          value={type}
          onChange={(e) => setType(e.target.value as TaskType)}
          className={cellTouch}
        >
          {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => (
            <option key={t} value={t}>
              {TASK_TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        {errorLine}

        <button
          onClick={submit}
          disabled={create.isPending}
          className="min-h-11 w-full rounded-lg bg-brand-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {create.isPending ? 'Assigning…' : assignees.length > 1 ? `Assign to ${assignees.length} people` : 'Assign'}
        </button>
      </div>
    );
  }

  /* ------------------------------ desktop bar ----------------------------- */
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <Plus size={16} className="ml-1 shrink-0 text-slate-400" aria-hidden />

        <input
          ref={titleRef}
          aria-label="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="What needs doing? Type it here, pick who, press Enter"
          className={`${cell} min-w-56 flex-1 border-transparent bg-transparent text-[15px] placeholder:text-slate-400 focus:border-brand-500 dark:border-transparent dark:bg-transparent`}
        />

        {/* Native picker; each choice becomes a chip, so one task can go to many. */}
        <select
          aria-label="Assign to"
          value=""
          onChange={(e) => {
            if (e.target.value) setAssignees((a) => [...a, e.target.value]);
          }}
          disabled={!remaining.length}
          className={`${cell} w-36 shrink-0 disabled:opacity-50`}
        >
          <option value="">{assignees.length ? 'Add person…' : 'Assign to…'}</option>
          {remaining.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>

        <input
          aria-label="Due date"
          type="date"
          value={dueDate}
          min={localDateInput()}
          onChange={(e) => setDueDate(e.target.value)}
          className={`${cell} w-40 shrink-0`}
        />

        <select
          aria-label="Priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as typeof priority)}
          className={`${cell} w-28 shrink-0`}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>

        <select
          aria-label="Task type"
          value={type}
          onChange={(e) => setType(e.target.value as TaskType)}
          className={`${cell} w-28 shrink-0`}
        >
          {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => (
            <option key={t} value={t}>
              {TASK_TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        <button
          onClick={submit}
          disabled={create.isPending}
          className="shrink-0 rounded-md bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {create.isPending ? 'Assigning…' : assignees.length > 1 ? `Assign to ${assignees.length}` : 'Assign'}
        </button>
      </div>

      {chips}
      {errorLine}
    </div>
  );
}
