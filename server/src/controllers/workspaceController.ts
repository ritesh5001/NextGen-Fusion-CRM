import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { Workspace } from '../models/Workspace.js';
import { User } from '../models/User.js';
import { Lead } from '../models/Lead.js';
import { Task } from '../models/Task.js';
import { CallLog } from '../models/CallLog.js';
import { FollowUp } from '../models/FollowUp.js';
import { Notification } from '../models/Notification.js';
import { ImportBatch } from '../models/ImportBatch.js';
import type { CreateWorkspaceInput, UpdateWorkspaceInput } from '../validators/workspaceValidators.js';

// GET /workspaces — superadmin sees all; a telecaller sees only their own (for the header badge).
export const listWorkspaces = asyncHandler(async (req: Request, res: Response) => {
  const filter = req.user!.role === 'telecaller' ? { _id: req.user!.workspace } : {};
  const workspaces = await Workspace.find(filter).sort({ createdAt: 1 });
  res.json({ success: true, data: workspaces });
});

// POST /workspaces (superadmin) — create a new, empty workspace.
export const createWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body as CreateWorkspaceInput;
  const workspace = await Workspace.create({ name, createdBy: req.user!.id });
  res.status(201).json({ success: true, workspace });
});

// PUT /workspaces/:id (superadmin) — rename a workspace.
export const updateWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const { name } = req.body as UpdateWorkspaceInput;
  const workspace = await Workspace.findByIdAndUpdate(req.params.id, { $set: { name } }, { new: true });
  if (!workspace) throw ApiError.notFound('Workspace not found');
  res.json({ success: true, workspace });
});

// DELETE /workspaces/:id (superadmin) — permanently delete a workspace and cascade
// all of its data. Blocked when it's the last remaining workspace.
export const deleteWorkspace = asyncHandler(async (req: Request, res: Response) => {
  const workspace = await Workspace.findById(req.params.id);
  if (!workspace) throw ApiError.notFound('Workspace not found');

  const total = await Workspace.countDocuments();
  if (total <= 1) throw ApiError.badRequest('You cannot delete the last remaining workspace');

  const wsId = workspace._id;
  // Cascade delete everything scoped to this workspace (telecallers + all CRM data).
  await Promise.all([
    User.deleteMany({ workspace: wsId, role: 'telecaller' }),
    Lead.deleteMany({ workspace: wsId }),
    Task.deleteMany({ workspace: wsId }),
    CallLog.deleteMany({ workspace: wsId }),
    FollowUp.deleteMany({ workspace: wsId }),
    Notification.deleteMany({ workspace: wsId }),
    ImportBatch.deleteMany({ workspace: wsId }),
  ]);
  await workspace.deleteOne();

  res.json({ success: true, message: 'Workspace deleted' });
});
