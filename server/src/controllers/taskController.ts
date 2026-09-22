import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Task, type TaskDoc } from '../models/Task.js';
import { Lead } from '../models/Lead.js';
import { User } from '../models/User.js';
import { getPagination, paginated } from '../utils/pagination.js';
import { notify } from '../services/notificationService.js';
import { idOf } from '../utils/idOf.js';

/** Link used by every task notification — the Tasks page opens this task on load. */
const taskLink = (id: unknown) => `/tasks?task=${String(id)}`;

const POPULATE = [
  { path: 'assignedTo', select: 'name email' },
  { path: 'assignedBy', select: 'name' },
  { path: 'relatedLead', select: 'name phone company country' },
  { path: 'completedBy', select: 'name' },
];

function oid(value: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) throw ApiError.badRequest('Invalid id');
  return new Types.ObjectId(value);
}

/**
 * Guards the `:id` routes. Without this a path that isn't a real id — e.g. a
 * client calling `/tasks/stats` against a build that predates that route —
 * reaches Mongoose and surfaces as a baffling 400 "Invalid identifier".
 */
function taskId(req: Request): string {
  const { id } = req.params;
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('Task not found');
  return id;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Builds the Mongo filter for the scoped task list. Values are cast to ObjectId
 * because this filter also feeds aggregations, which don't auto-cast.
 * `includeStatus=false` is used by the stats endpoint so every tab's count
 * reflects the same search/assignee scope.
 */
function buildFilter(req: Request, includeStatus = true): Record<string, unknown> {
  const filter: Record<string, unknown> = { workspace: oid(String(req.workspaceId)) };

  // Telecallers only ever see their own tasks.
  if (req.user!.role === 'telecaller') {
    filter.assignedTo = oid(req.user!.id);
  } else if (typeof req.query.assignedTo === 'string' && req.query.assignedTo) {
    filter.assignedTo = oid(req.query.assignedTo);
  }

  // 'pending,in_progress' — the Open tab asks for several statuses at once.
  if (includeStatus && typeof req.query.status === 'string' && req.query.status) {
    const statuses = req.query.status.split(',').filter(Boolean);
    filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
  }
  if (typeof req.query.priority === 'string' && req.query.priority) filter.priority = req.query.priority;
  if (typeof req.query.type === 'string' && req.query.type) filter.type = req.query.type;

  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    const rx = new RegExp(req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: rx }, { description: rx }, { completionNote: rx }];
  }

  const scope = typeof req.query.scope === 'string' ? req.query.scope : '';
  if (scope === 'today') filter.dueDate = { $gte: startOfToday(), $lte: endOfToday() };
  else if (scope === 'overdue') {
    filter.dueDate = { $lt: startOfToday() };
    if (includeStatus) filter.status = filter.status ?? { $in: ['pending', 'in_progress'] };
  } else if (scope === 'upcoming') filter.dueDate = { $gt: endOfToday() };
  else if (scope === 'undated') filter.dueDate = null;

  return filter;
}

/**
 * Default ordering: open work first, then by due date (undated last), then by
 * priority. Mongo sorts missing dates first, so the due date is ranked through a
 * computed field instead of sorted on directly.
 */
const FAR_FUTURE = new Date('2999-12-31T00:00:00.000Z');

function sortStage(req: Request): Record<string, 1 | -1> {
  const order: 1 | -1 = req.query.order === 'asc' ? 1 : -1;
  const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : '';
  if (sortBy === 'dueDate') return { _dueRank: order, _prioRank: -1 };
  if (sortBy === 'priority') return { _prioRank: order === 1 ? 1 : -1, _dueRank: 1 };
  if (sortBy === 'createdAt') return { createdAt: order };
  if (sortBy === 'completedAt') return { completedAt: order };
  if (sortBy === 'status') return { status: order, _dueRank: 1 };
  return { _openRank: 1, _dueRank: 1, _prioRank: -1, createdAt: -1 };
}

export const listTasks = asyncHandler(async (req: Request, res: Response) => {
  const pg = getPagination(req.query);
  const filter = buildFilter(req);

  const [rows, total] = await Promise.all([
    Task.aggregate([
      { $match: filter },
      {
        $addFields: {
          _openRank: { $cond: [{ $in: ['$status', ['completed', 'cancelled']] }, 1, 0] },
          _dueRank: { $ifNull: ['$dueDate', FAR_FUTURE] },
          _prioRank: {
            $switch: {
              branches: [
                { case: { $eq: ['$priority', 'high'] }, then: 3 },
                { case: { $eq: ['$priority', 'medium'] }, then: 2 },
              ],
              default: 1,
            },
          },
        },
      },
      { $sort: sortStage(req) },
      { $skip: pg.skip },
      { $limit: pg.limit },
      { $project: { _openRank: 0, _dueRank: 0, _prioRank: 0, __v: 0 } },
    ]),
    Task.countDocuments(filter),
  ]);

  const tasks = await Task.populate(rows, POPULATE);
  res.json({ success: true, ...paginated(tasks, total, pg) });
});

/** GET /tasks/stats — counts for the status tabs, within the current search/assignee scope. */
export const taskStats = asyncHandler(async (req: Request, res: Response) => {
  const filter = buildFilter(req, false);
  const open = { $in: ['pending', 'in_progress'] };

  const [agg] = await Task.aggregate([
    { $match: filter },
    {
      $facet: {
        total: [{ $count: 'n' }],
        pending: [{ $match: { status: 'pending' } }, { $count: 'n' }],
        in_progress: [{ $match: { status: 'in_progress' } }, { $count: 'n' }],
        completed: [{ $match: { status: 'completed' } }, { $count: 'n' }],
        cancelled: [{ $match: { status: 'cancelled' } }, { $count: 'n' }],
        overdue: [{ $match: { status: open, dueDate: { $lt: startOfToday() } } }, { $count: 'n' }],
        dueToday: [
          { $match: { status: open, dueDate: { $gte: startOfToday(), $lte: endOfToday() } } },
          { $count: 'n' },
        ],
      },
    },
  ]);

  const n = (k: string) => (agg?.[k]?.[0]?.n as number | undefined) ?? 0;
  res.json({
    success: true,
    stats: {
      total: n('total'),
      pending: n('pending'),
      in_progress: n('in_progress'),
      completed: n('completed'),
      cancelled: n('cancelled'),
      overdue: n('overdue'),
      dueToday: n('dueToday'),
    },
  });
});

export const getTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await Task.findOne({ _id: taskId(req), workspace: req.workspaceId }).populate(POPULATE);
  if (!task) throw ApiError.notFound('Task not found');
  if (req.user!.role === 'telecaller' && idOf(task.assignedTo) !== req.user!.id) {
    throw ApiError.forbidden('This task is not assigned to you');
  }
  res.json({ success: true, task });
});

/** Resolves the assignee ids an admin passed, rejecting anyone outside this workspace. */
async function resolveAssignees(ids: string[], workspaceId: string): Promise<string[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) throw ApiError.badRequest('Choose at least one user to assign this task to');
  unique.forEach((id) => {
    if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid user id');
  });

  const users = await User.find({
    _id: { $in: unique },
    role: 'telecaller',
    isActive: true,
    workspace: workspaceId,
  }).select('_id');

  if (users.length !== unique.length) {
    throw ApiError.badRequest(
      users.length
        ? 'One or more selected users are inactive or not in this workspace'
        : 'Invalid or inactive telecaller'
    );
  }
  return users.map((u) => String(u._id));
}

async function assertLeadInWorkspace(leadId: string, workspaceId: string) {
  if (!Types.ObjectId.isValid(leadId)) throw ApiError.badRequest('Invalid contact id');
  const exists = await Lead.exists({ _id: leadId, workspace: workspaceId });
  if (!exists) throw ApiError.badRequest('Linked contact not found in this workspace');
}

export const createTask = asyncHandler(async (req: Request, res: Response) => {
  const raw = req.body.assignedTo;
  const assignees = await resolveAssignees(
    Array.isArray(raw) ? raw : [raw],
    String(req.workspaceId)
  );
  if (req.body.relatedLead) await assertLeadInWorkspace(req.body.relatedLead, String(req.workspaceId));

  // One task per assignee, so each person owns (and completes) their own copy.
  const tasks = await Task.create(
    assignees.map((assignedTo) => ({
      ...req.body,
      assignedTo,
      assignedBy: req.user!.id,
      workspace: req.workspaceId,
    }))
  );

  await Promise.all(
    tasks.map((task) =>
      notify({
        recipient: String(task.assignedTo),
        type: 'task_assigned',
        title: 'New task assigned',
        message: task.dueDate
          ? `${task.title} — due ${task.dueDate.toLocaleDateString('en-GB', { dateStyle: 'medium' })}`
          : task.title,
        link: taskLink(task._id),
        workspace: req.workspaceId,
      })
    )
  );

  const populated = await Task.populate(tasks, POPULATE);
  res.status(201).json({ success: true, tasks: populated, task: populated[0], count: populated.length });
});

/**
 * Applies a status transition and its side effects (start/completion stamps).
 * `completedAt` is whatever the person reports they did the work at — defaulting
 * to now, and never allowed before the task existed.
 */
function applyStatus(
  task: TaskDoc,
  status: string,
  actorId: string,
  extra: { completedAt?: Date; completionNote?: string; timeSpentMin?: number } = {}
) {
  const previous = task.status;
  task.status = status as TaskDoc['status'];

  if (status === 'in_progress' && !task.startedAt) task.startedAt = new Date();

  if (status === 'completed') {
    const when = extra.completedAt ?? new Date();
    const createdAt = (task as unknown as { createdAt?: Date }).createdAt;
    /*
     * Completion is recorded by *day*, so this only rejects absurd values (done
     * long before the task existed). The one-day grace matters because a past
     * day arrives as local noon: a task created yesterday afternoon and marked
     * done "yesterday" is legitimate even though noon precedes it, and the
     * client's own timezone can shift the day boundary either way.
     */
    if (createdAt && when.getTime() < createdAt.getTime() - 24 * 60 * 60 * 1000) {
      throw ApiError.badRequest('Completion date cannot be before the task was created');
    }
    task.completedAt = when;
    task.completedBy = new Types.ObjectId(actorId);
    if (extra.completionNote !== undefined) task.completionNote = extra.completionNote;
    if (extra.timeSpentMin !== undefined) task.timeSpentMin = extra.timeSpentMin;
    if (!task.startedAt) task.startedAt = when;
  } else if (previous === 'completed') {
    // Reopened — drop the completion record so it can't report a stale time.
    task.completedAt = undefined;
    task.completedBy = undefined;
    task.completionNote = '';
    task.timeSpentMin = undefined;
  }
  return previous;
}

export const updateTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await Task.findOne({ _id: taskId(req), workspace: req.workspaceId });
  if (!task) throw ApiError.notFound('Task not found');

  const { assignedTo, relatedLead, dueDate, status, completedAt, ...rest } = req.body as Record<
    string,
    unknown
  >;

  const previousAssignee = idOf(task.assignedTo);
  if (typeof assignedTo === 'string' && assignedTo && assignedTo !== previousAssignee) {
    const [valid] = await resolveAssignees([assignedTo], String(req.workspaceId));
    task.assignedTo = new Types.ObjectId(valid);
    // Handing the task to someone else restarts the clock for them.
    task.assignedAt = new Date();
  }

  if (relatedLead === null) task.relatedLead = undefined;
  else if (typeof relatedLead === 'string' && relatedLead) {
    await assertLeadInWorkspace(relatedLead, String(req.workspaceId));
    task.relatedLead = new Types.ObjectId(relatedLead);
  }

  if (dueDate === null) task.dueDate = undefined;
  else if (dueDate instanceof Date) task.dueDate = dueDate;

  Object.entries(rest).forEach(([k, v]) => {
    if (v !== undefined) (task as unknown as Record<string, unknown>)[k] = v;
  });

  if (typeof status === 'string' && status !== task.status) {
    applyStatus(task, status, req.user!.id, { completedAt: completedAt as Date | undefined });
  } else if (completedAt instanceof Date && task.status === 'completed') {
    // Correcting the reported time without changing the status.
    task.completedAt = completedAt;
  }

  await task.save();

  if (idOf(task.assignedTo) !== previousAssignee) {
    await notify({
      recipient: idOf(task.assignedTo),
      type: 'task_assigned',
      title: 'Task assigned to you',
      message: task.title,
      link: taskLink(task._id),
      workspace: req.workspaceId,
    });
  }

  res.json({ success: true, task: await task.populate(POPULATE) });
});

export const updateTaskStatus = asyncHandler(async (req: Request, res: Response) => {
  const task = await Task.findOne({ _id: taskId(req), workspace: req.workspaceId });
  if (!task) throw ApiError.notFound('Task not found');

  // Telecallers can only update the status of their own tasks.
  if (req.user!.role === 'telecaller' && idOf(task.assignedTo) !== req.user!.id) {
    throw ApiError.forbidden('This task is not assigned to you');
  }

  const { status, completedAt, completionNote, timeSpentMin } = req.body;
  applyStatus(task, status, req.user!.id, { completedAt, completionNote, timeSpentMin });
  await task.save();

  // Tell the assigner when a telecaller finishes — including when they did it.
  if (req.user!.role === 'telecaller' && status === 'completed') {
    const when = task.completedAt!.toLocaleDateString('en-GB', { dateStyle: 'medium' });
    await notify({
      recipient: idOf(task.assignedBy),
      type: 'task_updated',
      title: 'Task completed',
      message: `${req.user!.name} completed "${task.title}" on ${when}`,
      link: taskLink(task._id),
      workspace: req.workspaceId,
    });
  }

  res.json({ success: true, task: await task.populate(POPULATE) });
});

export const deleteTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await Task.findOneAndDelete({ _id: taskId(req), workspace: req.workspaceId });
  if (!task) throw ApiError.notFound('Task not found');
  res.json({ success: true, message: 'Task deleted' });
});
