import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Notification } from '../models/Notification.js';
import { getPagination, paginated } from '../utils/pagination.js';

export const listNotifications = asyncHandler(async (req: Request, res: Response) => {
  const pg = getPagination(req.query);
  const filter: Record<string, unknown> = { recipient: req.user!.id, workspace: req.workspaceId };
  if (req.query.unread === 'true') filter.isRead = false;

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: req.user!.id, workspace: req.workspaceId, isRead: false }),
  ]);

  res.json({ success: true, unreadCount, ...paginated(items, total, pg) });
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, recipient: req.user!.id, workspace: req.workspaceId },
    { $set: { isRead: true } },
    { new: true }
  );
  if (!n) throw ApiError.notFound('Notification not found');
  res.json({ success: true, notification: n });
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  await Notification.updateMany(
    { recipient: req.user!.id, workspace: req.workspaceId, isRead: false },
    { $set: { isRead: true } }
  );
  res.json({ success: true, message: 'All notifications marked read' });
});
