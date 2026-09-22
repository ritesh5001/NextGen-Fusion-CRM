import { isPast, isToday } from 'date-fns';
import { fromDateInput } from '@/lib/format';
import type { Task, TaskType } from '@/types';

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  custom: 'To-do',
  call: 'Call',
  follow_up: 'Follow-up',
};

export function isOpen(task: Task) {
  return task.status === 'pending' || task.status === 'in_progress';
}

/**
 * When the task was handed to its current assignee. Tasks created before
 * `assignedAt` existed have none, and for those the creation date *is* the
 * assignment date — assigning is how a task comes into being here.
 */
export function assignedOn(task: Task): string {
  return task.assignedAt ?? task.createdAt;
}

/**
 * A due date carrying a time is overdue the moment it passes; a date-only due
 * date (midnight) only goes overdue once the day is over.
 */
export function isTaskOverdue(task: Task) {
  if (!task.dueDate || !isOpen(task)) return false;
  const due = new Date(task.dueDate);
  const dateOnly = due.getHours() === 0 && due.getMinutes() === 0;
  return dateOnly ? isPast(due) && !isToday(due) : isPast(due);
}

/** `yyyy-MM-dd` for a date input, `daysAgo` before `date`. */
export function localDateInput(date = new Date(), daysAgo = 0) {
  const d = new Date(date);
  d.setDate(d.getDate() - daysAgo);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True when two instants fall on the same local calendar day. */
export function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * The instant to record for a task completed on `dateValue` (a `yyyy-MM-dd`).
 * Today resolves to *now* so it never lands before the task was created or in
 * the future; an earlier day resolves to local noon, which is unambiguous
 * across time zones and DST. Only the date is ever shown.
 */
export function completionInstant(dateValue: string, now = new Date()): Date | null {
  const picked = fromDateInput(dateValue, 12);
  if (!picked) return null;
  return sameDay(picked, now) ? now : picked;
}
