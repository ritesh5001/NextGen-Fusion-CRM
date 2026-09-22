import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { FollowUp } from '../models/FollowUp.js';
import { getPagination, paginated } from '../utils/pagination.js';

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

// GET /followups?scope=today|upcoming|overdue|all
export const listFollowUps = asyncHandler(async (req: Request, res: Response) => {
  const pg = getPagination(req.query);
  const filter: Record<string, unknown> = { status: 'pending', workspace: req.workspaceId };

  if (req.user!.role === 'telecaller') {
    filter.telecaller = req.user!.id;
  } else if (typeof req.query.telecaller === 'string' && req.query.telecaller) {
    filter.telecaller = req.query.telecaller;
  }

  const scope = req.query.scope;
  if (scope === 'today') {
    filter.scheduledAt = { $gte: startOfToday(), $lte: endOfToday() };
  } else if (scope === 'upcoming') {
    filter.scheduledAt = { $gt: endOfToday() };
  } else if (scope === 'overdue') {
    filter.scheduledAt = { $lt: startOfToday() };
  }
  if (req.query.status) filter.status = req.query.status;

  const [followUps, total] = await Promise.all([
    FollowUp.find(filter)
      .populate('lead', 'name phone status')
      .populate('telecaller', 'name')
      .sort({ scheduledAt: 1 })
      .skip(pg.skip)
      .limit(pg.limit)
      .lean(),
    FollowUp.countDocuments(filter),
  ]);

  res.json({ success: true, ...paginated(followUps, total, pg) });
});

export const markFollowUpDone = asyncHandler(async (req: Request, res: Response) => {
  const followUp = await FollowUp.findOne({ _id: req.params.id, workspace: req.workspaceId });
  if (!followUp) throw ApiError.notFound('Follow-up not found');
  if (req.user!.role === 'telecaller' && String(followUp.telecaller) !== req.user!.id) {
    throw ApiError.forbidden('This follow-up is not assigned to you');
  }
  followUp.status = 'done';
  await followUp.save();
  res.json({ success: true, followUp });
});
