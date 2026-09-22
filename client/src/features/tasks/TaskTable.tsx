import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, Circle, Link2, Trash2, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useDeleteTask, useUpdateTask, useUpdateTaskStatus } from '@/api/tasks';
import { apiError } from '@/api/client';
import { PRIORITY_COLORS, TASK_STATUS_COLORS, TASK_STATUS_LABELS } from '@/lib/constants';
import { fmtDateTime, fmtDueLabel, fmtMinutes, fmtStamp, fromDateInput, toDateInput } from '@/lib/format';
import { formatPhoneDisplay } from '@/lib/phone';
import {
  TASK_TYPE_LABELS,
  assignedOn,
  completionInstant,
  isTaskOverdue,
  localDateInput,
  sameDay,
} from './taskHelpers';
import type { Lead, Task, TaskStatus, TaskType, User } from '@/types';

const CELL =
  'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:ring-brand-500/25';

/** Same control, sized for a thumb — used everywhere the phone layout renders one. */
const CELL_TOUCH = `${CELL} min-h-11 w-full truncate py-2 pl-2.5 pr-7 md:min-h-0 md:py-1 md:pr-2`;

const TH = 'px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400';

interface Props {
  tasks: Task[];
  isAdmin: boolean;
  people: User[];
  /** Row to auto-open (deep link from a notification). */
  openId?: string | null;
  onOpenHandled?: () => void;
}

type OpenMode = 'details' | 'complete';

export function TaskTable({ tasks, isAdmin, people, openId, onOpenHandled }: Props) {
  // Only one row is ever expanded: 'details' shows/edits it, 'complete' reports the time.
  const [open, setOpen] = useState<{ id: string; mode: OpenMode } | null>(null);

  useEffect(() => {
    if (!openId) return;
    setOpen({ id: openId, mode: 'details' });
    onOpenHandled?.();
  }, [openId, onOpenHandled]);

  // done · task · [assignee] · assigned · due · priority · status · completed · actions
  const cols = isAdmin ? 9 : 8;

  const toggleFor = (id: string) => (mode: OpenMode) =>
    setOpen((cur) => (cur?.id === id && cur.mode === mode ? null : { id, mode }));

  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {/* Phone: cards. The desktop grid is ~60rem wide — on a 390px screen that
          is a sideways scroll through eight columns of 11px selects, so the same
          controls are stacked here instead, at full tap size. */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
        {tasks.map((task) => (
          <TaskCard
            key={task._id}
            task={task}
            isAdmin={isAdmin}
            people={people}
            open={open?.id === task._id ? open.mode : null}
            onToggle={toggleFor(task._id)}
            onClose={() => setOpen(null)}
          />
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[66rem] border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/70">
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <th className={`${TH} w-9`}>
                <span className="sr-only">Done</span>
              </th>
              <th className={TH}>Task</th>
              {isAdmin && <th className={`${TH} w-32`}>Assignee</th>}
              <th className={`${TH} w-28`}>Assigned</th>
              <th className={`${TH} w-32`}>Due</th>
              <th className={`${TH} w-28`}>Priority</th>
              <th className={`${TH} w-32`}>Status</th>
              <th className={`${TH} w-40`}>Completed</th>
              <th className={`${TH} w-14`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <TaskRow
                key={task._id}
                task={task}
                isAdmin={isAdmin}
                people={people}
                cols={cols}
                open={open?.id === task._id ? open.mode : null}
                onToggle={toggleFor(task._id)}
                onClose={() => setOpen(null)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared behaviour                                                           */
/* -------------------------------------------------------------------------- */

/** The mutations + guards every task row/card needs, in one place. */
function useTaskActions(task: Task, onToggle: (mode: OpenMode) => void) {
  const update = useUpdateTask();
  const updateStatus = useUpdateTaskStatus();
  const del = useDeleteTask();

  /** Instant save for the in-cell selects. */
  async function patch(payload: { assignedTo?: string; priority?: Task['priority'] }) {
    try {
      await update.mutateAsync({ id: task._id, ...payload });
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  async function setStatus(status: TaskStatus) {
    // Completing needs a time, so it opens the inline strip instead of firing.
    if (status === 'completed') return onToggle('complete');
    try {
      await updateStatus.mutateAsync({ id: task._id, status });
      toast.success(status === 'pending' ? 'Reopened' : `Marked ${TASK_STATUS_LABELS[status].toLowerCase()}`);
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  async function remove() {
    if (!confirm(`Delete "${task.title}"? The assignee will no longer see it.`)) return;
    try {
      await del.mutateAsync(task._id);
      toast.success('Task deleted');
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  return { patch, setStatus, remove };
}

/* -------------------------------------------------------------------------- */
/* Phone card                                                                 */
/* -------------------------------------------------------------------------- */

function TaskCard({
  task,
  isAdmin,
  people,
  open,
  onToggle,
  onClose,
}: {
  task: Task;
  isAdmin: boolean;
  people: User[];
  open: OpenMode | null;
  onToggle: (mode: OpenMode) => void;
  onClose: () => void;
}) {
  const { patch, setStatus, remove } = useTaskActions(task, onToggle);
  const assignee = task.assignedTo as User | undefined;
  const overdue = isTaskOverdue(task);
  const isOpen = task.status === 'pending' || task.status === 'in_progress';
  const done = task.status === 'completed';
  const lead = task.relatedLead && typeof task.relatedLead === 'object' ? (task.relatedLead as Lead) : null;

  // The panel opens under a card that may already be at the bottom of the
  // screen, so tapping the tick would otherwise appear to do nothing.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [open]);

  return (
    <div className={`p-3 ${open ? 'bg-slate-50 dark:bg-slate-800/40' : ''}`}>
      <div className="flex items-start gap-2">
        <button
          onClick={() => (isOpen ? onToggle('complete') : setStatus('pending'))}
          aria-label={isOpen ? `Mark ${task.title} as done` : `Reopen ${task.title}`}
          className={`tap -m-1 flex shrink-0 items-center justify-center rounded-full p-1 ${
            done ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600'
          }`}
        >
          {done ? <CheckCircle2 size={24} /> : <Circle size={24} />}
        </button>

        <button onClick={() => onToggle('details')} className="min-w-0 flex-1 text-left">
          <span
            className={`line-clamp-2 text-sm font-medium ${
              done ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'
            }`}
          >
            {task.title}
          </span>
          {task.description && (
            <span className="mt-0.5 line-clamp-1 block text-xs text-slate-400 dark:text-slate-500">
              {task.description}
            </span>
          )}
        </button>

        <button
          onClick={() => onToggle('details')}
          aria-label={`Details for ${task.title}`}
          aria-expanded={open === 'details'}
          className="tap -mr-1 flex shrink-0 items-center justify-center rounded-lg text-slate-400"
        >
          <ChevronDown size={20} className={open === 'details' ? 'rotate-180' : ''} />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-7 text-[11px]">
        <span
          className={`rounded-full px-2 py-0.5 font-medium tabular-nums ${
            overdue
              ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          {fmtDueLabel(task.dueDate)}
        </span>
        <span
          className="rounded-full bg-slate-100 px-2 py-0.5 tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400"
          title={`Assigned ${fmtDateTime(assignedOn(task))}`}
        >
          Assigned {fmtStamp(assignedOn(task))}
        </span>
        <span className={`rounded-full px-2 py-0.5 font-medium capitalize ${PRIORITY_COLORS[task.priority]}`}>
          {task.priority}
        </span>
        <span className={`rounded-full px-2 py-0.5 font-medium ${TASK_STATUS_COLORS[task.status]}`}>
          {TASK_STATUS_LABELS[task.status]}
        </span>
        {task.type !== 'custom' && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {TASK_TYPE_LABELS[task.type]}
          </span>
        )}
        {lead && (
          <span className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500">
            <Link2 size={10} /> {lead.name}
          </span>
        )}
      </div>

      {done && task.completedAt && (
        <p className="mt-1.5 pl-7 text-[11px] tabular-nums text-emerald-600 dark:text-emerald-400">
          Done {fmtStamp(task.completedAt)}
          {task.timeSpentMin ? ` · took ${fmtMinutes(task.timeSpentMin)}` : ''}
        </p>
      )}
      {task.status === 'cancelled' && (
        <p className="mt-1.5 inline-flex items-center gap-1 pl-7 text-[11px] text-slate-400">
          <XCircle size={12} /> Cancelled
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 pl-7">
        <select
          aria-label={`Status for ${task.title}`}
          value={task.status}
          onChange={(e) => setStatus(e.target.value as TaskStatus)}
          className={`${CELL_TOUCH} flex-1 font-medium`}
        >
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          {isAdmin && <option value="cancelled">Cancelled</option>}
        </select>

        {isAdmin && (
          <>
            <select
              aria-label={`Assignee for ${task.title}`}
              value={assignee?._id ?? ''}
              onChange={(e) => patch({ assignedTo: e.target.value })}
              className={`${CELL_TOUCH} flex-1`}
            >
              {!assignee && <option value="">Unassigned</option>}
              {people.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={remove}
              aria-label={`Delete ${task.title}`}
              className="tap flex shrink-0 items-center justify-center rounded-lg border border-slate-200 px-3 text-slate-400 dark:border-slate-700"
            >
              <Trash2 size={16} />
            </button>
          </>
        )}
        {!isAdmin && assignee && (
          <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">{assignee.name}</span>
        )}
      </div>

      <div ref={panelRef} className="scroll-mb-24">
        {open === 'complete' && (
          <div className="mt-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/25 dark:bg-emerald-500/5">
            <CompletionStrip task={task} onClose={onClose} />
          </div>
        )}
        {open === 'details' && (
          <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/30">
            <DetailsPanel task={task} isAdmin={isAdmin} onClose={onClose} />
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Desktop row                                                                */
/* -------------------------------------------------------------------------- */

function TaskRow({
  task,
  isAdmin,
  people,
  cols,
  open,
  onToggle,
  onClose,
}: {
  task: Task;
  isAdmin: boolean;
  people: User[];
  cols: number;
  open: OpenMode | null;
  onToggle: (mode: OpenMode) => void;
  onClose: () => void;
}) {
  const { patch, setStatus, remove } = useTaskActions(task, onToggle);

  const assignee = task.assignedTo as User | undefined;
  const overdue = isTaskOverdue(task);
  const isOpen = task.status === 'pending' || task.status === 'in_progress';
  const done = task.status === 'completed';

  return (
    <>
      <tr
        className={`border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 ${
          open ? 'bg-slate-50 dark:bg-slate-800/40' : ''
        }`}
      >
        <td className="px-2.5 py-2 align-top">
          <button
            onClick={() => (isOpen ? onToggle('complete') : setStatus('pending'))}
            title={isOpen ? 'Mark as done' : 'Reopen this task'}
            aria-label={isOpen ? `Mark ${task.title} as done` : `Reopen ${task.title}`}
            className={`rounded-full p-1 transition-colors ${
              done
                ? 'text-emerald-500 hover:text-emerald-600'
                : 'text-slate-300 hover:text-emerald-500 dark:text-slate-600 dark:hover:text-emerald-400'
            }`}
          >
            {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
          </button>
        </td>

        <td className="min-w-[14rem] px-2.5 py-2 align-top">
          <button onClick={() => onToggle('details')} className="block w-full text-left" title={task.title}>
            <span
              className={`line-clamp-2 text-sm font-medium ${
                done ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'
              }`}
            >
              {task.title}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400 dark:text-slate-500">
              {task.type !== 'custom' && <span>{TASK_TYPE_LABELS[task.type]}</span>}
              {task.description && <span className="line-clamp-1 max-w-md">{task.description}</span>}
              {task.relatedLead && typeof task.relatedLead === 'object' && (
                <span className="inline-flex items-center gap-1">
                  <Link2 size={10} /> {(task.relatedLead as Lead).name}
                </span>
              )}
            </span>
          </button>
        </td>

        {isAdmin && (
          <td className="px-2.5 py-2 align-top">
            <select
              aria-label={`Assignee for ${task.title}`}
              value={assignee?._id ?? ''}
              onChange={(e) => patch({ assignedTo: e.target.value })}
              className={`${CELL} w-full`}
            >
              {!assignee && <option value="">Unassigned</option>}
              {people.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
            </select>
          </td>
        )}

        <td className="px-2.5 py-2 align-top">
          <span
            className="whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400"
            title={fmtDateTime(assignedOn(task))}
          >
            {fmtStamp(assignedOn(task))}
          </span>
        </td>

        <td className="px-2.5 py-2 align-top">
          <span
            className={`text-xs tabular-nums ${
              overdue ? 'font-semibold text-rose-500' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {fmtDueLabel(task.dueDate)}
          </span>
        </td>

        <td className="px-2.5 py-2 align-top">
          {isAdmin ? (
            <select
              aria-label={`Priority for ${task.title}`}
              value={task.priority}
              onChange={(e) => patch({ priority: e.target.value as Task['priority'] })}
              className={`${CELL} w-full`}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          ) : (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${PRIORITY_COLORS[task.priority]}`}
            >
              {task.priority}
            </span>
          )}
        </td>

        <td className="px-2.5 py-2 align-top">
          <select
            aria-label={`Status for ${task.title}`}
            value={task.status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            className={`${CELL} w-full font-medium`}
          >
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            {isAdmin && <option value="cancelled">Cancelled</option>}
          </select>
        </td>

        <td className="px-2.5 py-2 align-top">
          {done && task.completedAt ? (
            <span className="whitespace-nowrap text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
              {fmtStamp(task.completedAt)}
              {task.timeSpentMin ? (
                <span className="block text-[11px] text-slate-400">took {fmtMinutes(task.timeSpentMin)}</span>
              ) : null}
            </span>
          ) : task.status === 'cancelled' ? (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
              <XCircle size={12} /> Cancelled
            </span>
          ) : (
            <span className="text-xs text-slate-300 dark:text-slate-600">—</span>
          )}
        </td>

        <td className="px-2.5 py-2 align-top">
          <div className="flex items-center justify-end gap-0.5">
            <button
              onClick={() => onToggle('details')}
              aria-label={`Details for ${task.title}`}
              aria-expanded={open === 'details'}
              className="rounded p-1 text-slate-400 transition-transform hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            >
              <ChevronDown size={15} className={open === 'details' ? 'rotate-180' : ''} />
            </button>
            {isAdmin && (
              <button
                onClick={remove}
                aria-label={`Delete ${task.title}`}
                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </td>
      </tr>

      {open === 'complete' && (
        <tr className="border-b border-slate-100 bg-emerald-50/50 dark:border-slate-800 dark:bg-emerald-500/5">
          <td colSpan={cols} className="px-3 py-3">
            <CompletionStrip task={task} onClose={onClose} />
          </td>
        </tr>
      )}

      {open === 'details' && (
        <tr className="border-b border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/30">
          <td colSpan={cols} className="px-3 py-3">
            <DetailsPanel task={task} isAdmin={isAdmin} onClose={onClose} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Inline "when did you actually do it?" — the completion flow, without a dialog. */
function CompletionStrip({ task, onClose }: { task: Task; onClose: () => void }) {
  const updateStatus = useUpdateTaskStatus();
  const [when, setWhen] = useState(localDateInput());
  const [mins, setMins] = useState(task.timeSpentMin ? String(task.timeSpentMin) : '');
  const [note, setNote] = useState(task.completionNote ?? '');
  const [error, setError] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  // Autofocus opens the keyboard immediately on a phone and hides the strip the
  // user was just shown, so only the pointer-based layouts grab focus.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus();
  }, []);

  const createdOn = new Date(task.createdAt);

  async function submit() {
    const at = completionInstant(when);
    if (!at) return setError('Pick the day you did this.');
    if (at.getTime() > Date.now() + 60_000) return setError("That's in the future.");
    // Compared by day: the task can't have been done before the day it existed.
    if (at.getTime() < createdOn.getTime() && !sameDay(at, createdOn)) {
      return setError(`This task only exists since ${fmtStamp(task.createdAt)}.`);
    }
    setError('');
    try {
      await updateStatus.mutateAsync({
        id: task._id,
        status: 'completed',
        completedAt: at.toISOString(),
        completionNote: note.trim(),
        timeSpentMin: mins ? Number(mins) : undefined,
      });
      toast.success('Marked done');
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  // Only offer days the task could actually have been done on.
  const quick = [
    { label: 'Today', daysAgo: 0 },
    { label: 'Yesterday', daysAgo: 1 },
  ].filter((q) => {
    const d = completionInstant(localDateInput(new Date(), q.daysAgo));
    return d !== null && (d.getTime() >= createdOn.getTime() || sameDay(d, createdOn));
  });

  const label = 'mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400';

  return (
    <div className="space-y-3 md:flex md:flex-wrap md:items-start md:gap-3 md:space-y-0">
      <div className="flex gap-3 md:block">
        <div className="min-w-0 flex-1 md:flex-none">
          <label htmlFor={`when-${task._id}`} className={label}>
            Which day did you do it?
          </label>
          <input
            id={`when-${task._id}`}
            ref={ref}
            type="date"
            value={when}
            max={localDateInput()}
            onChange={(e) => setWhen(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className={`${CELL_TOUCH} md:w-44 md:py-1.5`}
          />
          <div className="mt-1.5 flex gap-1.5">
            {quick.map((q) => (
              <button
                key={q.label}
                onClick={() => setWhen(localDateInput(new Date(), q.daysAgo))}
                className="rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-500 hover:bg-white dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 md:px-2 md:py-0.5"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-28 shrink-0 md:w-auto">
          <label htmlFor={`mins-${task._id}`} className={label}>
            Time spent
          </label>
          <div className="relative">
            <input
              id={`mins-${task._id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              value={mins}
              onChange={(e) => setMins(e.target.value)}
              placeholder="0"
              className={`${CELL_TOUCH} pr-8 tabular-nums md:w-24 md:py-1.5`}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">
              min
            </span>
          </div>
        </div>
      </div>

      <div className="md:min-w-48 md:flex-1">
        <label htmlFor={`note-${task._id}`} className={label}>
          Note back to admin (optional)
        </label>
        <input
          id={`note-${task._id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="What happened…"
          className={`${CELL_TOUCH} md:py-1.5`}
        />
      </div>

      <div className="flex gap-2 md:pt-[22px]">
        <button
          onClick={onClose}
          className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 md:min-h-0 md:flex-none md:rounded-md"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={updateStatus.isPending}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60 md:min-h-0 md:flex-none md:rounded-md"
        >
          <CheckCircle2 size={14} /> Mark done
        </button>
      </div>

      {error && (
        <p role="alert" className="w-full text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

/** Expanded row: the full record, editable in place for the admin. */
function DetailsPanel({ task, isAdmin, onClose }: { task: Task; isAdmin: boolean; onClose: () => void }) {
  const update = useUpdateTask();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [due, setDue] = useState(toDateInput(task.dueDate));
  const [type, setType] = useState<TaskType>(task.type);

  const dirty =
    title !== task.title ||
    description !== (task.description ?? '') ||
    due !== toDateInput(task.dueDate) ||
    type !== task.type;

  async function save() {
    if (!title.trim()) return toast.error('Title cannot be empty.');
    try {
      await update.mutateAsync({
        id: task._id,
        title: title.trim(),
        description: description.trim(),
        type,
        // Local midnight, so the stored day matches the one that was picked.
        dueDate: due ? (fromDateInput(due) ?? new Date(due)).toISOString() : null,
      });
      toast.success('Task updated');
      onClose();
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  const lead = task.relatedLead && typeof task.relatedLead === 'object' ? (task.relatedLead as Lead) : null;
  const nameOf = (r?: User | string | null) => (r && typeof r === 'object' ? r.name : '—');
  const label = 'mb-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400';

  return (
    <div className="space-y-3">
      {isAdmin ? (
        <div className="space-y-3 md:flex md:flex-wrap md:items-start md:gap-3 md:space-y-0">
          <div className="md:min-w-56 md:flex-1">
            <label htmlFor={`t-${task._id}`} className={label}>
              Title
            </label>
            <input
              id={`t-${task._id}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`${CELL_TOUCH} md:py-1.5`}
            />
          </div>
          <div className="md:min-w-56 md:flex-[2]">
            <label htmlFor={`d-${task._id}`} className={label}>
              Details
            </label>
            <input
              id={`d-${task._id}`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything the user should know"
              className={`${CELL_TOUCH} md:py-1.5`}
            />
          </div>
          <div className="flex gap-3 md:contents">
            <div className="min-w-0 flex-1 md:flex-none">
              <label htmlFor={`due-${task._id}`} className={label}>
                Due
              </label>
              <input
                id={`due-${task._id}`}
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className={`${CELL_TOUCH} md:w-40 md:py-1.5`}
              />
            </div>
            <div className="min-w-0 flex-1 md:flex-none">
              <label htmlFor={`ty-${task._id}`} className={label}>
                Type
              </label>
              <select
                id={`ty-${task._id}`}
                value={type}
                onChange={(e) => setType(e.target.value as TaskType)}
                className={`${CELL_TOUCH} md:w-28 md:py-1.5`}
              >
                {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((t) => (
                  <option key={t} value={t}>
                    {TASK_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={save}
            disabled={!dirty || update.isPending}
            className="min-h-11 w-full rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50 md:mt-[22px] md:min-h-0 md:w-auto md:rounded-md"
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        task.description && <p className="text-sm text-slate-600 dark:text-slate-300">{task.description}</p>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-400 dark:text-slate-500">
        <span>Assigned by {nameOf(task.assignedBy)}</span>
        <span>Assigned {fmtStamp(assignedOn(task))}</span>
        {assignedOn(task) !== task.createdAt && <span>Created {fmtStamp(task.createdAt)}</span>}
        {task.startedAt && task.startedAt !== task.completedAt && <span>Started {fmtStamp(task.startedAt)}</span>}
        {lead && (
          <span className="inline-flex items-center gap-1">
            <Link2 size={11} /> {lead.name} · {formatPhoneDisplay(lead.phone, lead.country)}
          </span>
        )}
      </div>

      {task.status === 'completed' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-500/25 dark:bg-emerald-500/10">
          <p className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 size={13} /> Done {task.completedAt ? fmtStamp(task.completedAt) : ''} by{' '}
            {nameOf(task.completedBy ?? task.assignedTo)}
            {task.timeSpentMin ? ` · took ${fmtMinutes(task.timeSpentMin)}` : ''}
          </p>
          {task.completionNote && (
            <p className="mt-1 text-xs text-emerald-900 dark:text-emerald-200">“{task.completionNote}”</p>
          )}
        </div>
      )}
    </div>
  );
}
