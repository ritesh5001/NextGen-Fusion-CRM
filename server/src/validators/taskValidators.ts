import { z } from 'zod';
import { TASK_TYPES, TASK_STATUSES, TASK_PRIORITIES } from '../models/Task.js';

/** Tolerate a couple of minutes of client clock skew when checking "not in the future". */
const CLOCK_SKEW_MS = 2 * 60 * 1000;

const notInFuture = (d: Date) => d.getTime() <= Date.now() + CLOCK_SKEW_MS;

/** '' from a cleared <input> means "no value", not an invalid id. */
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

/** On create there is nothing to clear, so an explicit null is simply "not set". */
const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional().default(''),
  type: z.enum(TASK_TYPES).optional().default('custom'),
  relatedLead: z.preprocess(blankToUndefined, z.string().optional()),
  // One id, or several — the admin can hand the same task to a whole group at once.
  assignedTo: z.union([
    z.string().min(1),
    z.array(z.string().min(1)).min(1, 'Choose at least one user'),
  ]),
  dueDate: z.preprocess(blankToUndefined, z.coerce.date().optional()),
  priority: z.enum(TASK_PRIORITIES).optional().default('medium'),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  type: z.enum(TASK_TYPES).optional(),
  // null clears the link / the due date.
  relatedLead: z.preprocess(emptyToUndefined, z.string().nullable().optional()),
  assignedTo: z.string().min(1).optional(),
  dueDate: z.preprocess(emptyToUndefined, z.coerce.date().nullable().optional()),
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  // The admin can correct a wrongly-reported completion time.
  completedAt: z.preprocess(
    emptyToUndefined,
    z.coerce.date().refine(notInFuture, 'Completion date cannot be in the future').optional()
  ),
});

export const updateTaskStatusSchema = z.object({
  status: z.enum(TASK_STATUSES),
  /** When the work was actually done. Defaults to now; never accepted in the future. */
  completedAt: z.preprocess(
    emptyToUndefined,
    z.coerce.date().refine(notInFuture, 'Completion date cannot be in the future').optional()
  ),
  completionNote: z.string().max(2000).optional(),
  timeSpentMin: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(24 * 60).optional()
  ),
});

export const listTaskQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  type: z.string().optional(),
  assignedTo: z.string().optional(),
  /** Due-date window: today | overdue | upcoming | undated | all. */
  scope: z.enum(['today', 'overdue', 'upcoming', 'undated', 'all']).optional(),
  sortBy: z.enum(['dueDate', 'createdAt', 'priority', 'status', 'completedAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
