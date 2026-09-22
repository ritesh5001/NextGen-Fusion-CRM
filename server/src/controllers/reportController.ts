import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { Lead } from '../models/Lead.js';
import { Task } from '../models/Task.js';
import { CallLog } from '../models/CallLog.js';
import { FollowUp } from '../models/FollowUp.js';
import { User } from '../models/User.js';

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

// GET /reports/overview — superadmin dashboard (scoped to the active workspace).
export const overview = asyncHandler(async (req: Request, res: Response) => {
  const today = { $gte: startOfToday(), $lte: endOfToday() };
  const ws = new Types.ObjectId(req.workspaceId);

  const [
    totalTelecallers,
    activeTelecallers,
    totalLeads,
    leadsByStatus,
    callsToday,
    dispositionBreakdown,
    pendingTasks,
    perTelecaller,
  ] = await Promise.all([
    User.countDocuments({ role: 'telecaller', workspace: ws }),
    User.countDocuments({ role: 'telecaller', isActive: true, workspace: ws }),
    Lead.countDocuments({ workspace: ws }),
    Lead.aggregate([{ $match: { workspace: ws } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    CallLog.countDocuments({ workspace: ws, createdAt: today }),
    CallLog.aggregate([{ $match: { workspace: ws } }, { $group: { _id: '$disposition', count: { $sum: 1 } } }]),
    Task.countDocuments({ workspace: ws, status: { $in: ['pending', 'in_progress'] } }),
    CallLog.aggregate([
      { $match: { workspace: ws, createdAt: today } },
      { $group: { _id: '$telecaller', calls: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: '$user' },
      {
        $project: {
          _id: 1,
          calls: 1,
          name: '$user.name',
          dailyTarget: '$user.dailyTarget',
        },
      },
      { $sort: { calls: -1 } },
    ]),
  ]);

  const converted = leadsByStatus.find((s) => s._id === 'converted')?.count ?? 0;

  res.json({
    success: true,
    overview: {
      totalTelecallers,
      activeTelecallers,
      totalLeads,
      convertedLeads: converted,
      conversionRate: totalLeads ? Number(((converted / totalLeads) * 100).toFixed(1)) : 0,
      callsToday,
      pendingTasks,
      leadsByStatus,
      dispositionBreakdown,
      perTelecaller,
    },
  });
});

// GET /reports/me — telecaller's personal dashboard.
export const myStats = asyncHandler(async (req: Request, res: Response) => {
  const uid = new Types.ObjectId(req.user!.id);
  const ws = new Types.ObjectId(req.workspaceId);
  const today = { $gte: startOfToday(), $lte: endOfToday() };

  const [user, callsToday, myContacts, myLeads, pendingTasks, followUpsToday, overdueFollowUps, dispToday] =
    await Promise.all([
      User.findById(uid).select('dailyTarget name'),
      CallLog.countDocuments({ telecaller: uid, workspace: ws, createdAt: today }),
      Lead.countDocuments({ assignedTo: uid, workspace: ws }),
      Lead.countDocuments({ assignedTo: uid, workspace: ws, qualified: true }),
      Task.countDocuments({ assignedTo: uid, workspace: ws, status: { $in: ['pending', 'in_progress'] } }),
      FollowUp.countDocuments({ telecaller: uid, workspace: ws, status: 'pending', scheduledAt: today }),
      FollowUp.countDocuments({
        telecaller: uid,
        workspace: ws,
        status: 'pending',
        scheduledAt: { $lt: startOfToday() },
      }),
      CallLog.aggregate([
        { $match: { telecaller: uid, workspace: ws, createdAt: today } },
        { $group: { _id: '$disposition', count: { $sum: 1 } } },
      ]),
    ]);

  const target = user?.dailyTarget ?? 0;

  res.json({
    success: true,
    stats: {
      dailyTarget: target,
      callsToday,
      targetProgress: target ? Number(((callsToday / target) * 100).toFixed(0)) : 0,
      myContacts,
      myLeads,
      pendingTasks,
      followUpsToday,
      overdueFollowUps,
      dispositionToday: dispToday,
    },
  });
});
