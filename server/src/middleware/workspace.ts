import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { Workspace } from '../models/Workspace.js';

/**
 * Resolves the active workspace for a request and sets `req.workspaceId`. Must run
 * after `authenticate`.
 *
 *  - Telecaller → always their own `user.workspace`. Any `X-Workspace-Id` header is
 *    ignored, so a telecaller can never reach another workspace.
 *  - Superadmin → the `X-Workspace-Id` header (the one they picked in the UI),
 *    validated to be a real workspace; falls back to the earliest workspace when the
 *    header is absent/invalid. When no workspace exists yet, `req.workspaceId` is
 *    left unset — only auth + workspace-management routes are usable until one is created.
 */
export async function resolveWorkspace(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.user) throw ApiError.unauthorized();

    if (req.user.role === 'telecaller') {
      if (!req.user.workspace) throw ApiError.forbidden('Your account is not attached to a workspace');
      req.workspaceId = req.user.workspace;
      return next();
    }

    // Superadmin: honour the requested workspace if it exists, else default.
    const requested = req.header('X-Workspace-Id');
    if (requested && Types.ObjectId.isValid(requested) && (await Workspace.exists({ _id: requested }))) {
      req.workspaceId = requested;
      return next();
    }

    const first = await Workspace.findOne().sort({ createdAt: 1 }).select('_id');
    if (first) req.workspaceId = String(first._id);
    next();
  } catch (err) {
    next(err);
  }
}

/** Guards a handler that requires an active workspace (422 when none is resolved). */
export function requireWorkspace(req: Request, _res: Response, next: NextFunction) {
  if (!req.workspaceId) {
    return next(ApiError.badRequest('No workspace selected. Create or select a workspace first.'));
  }
  next();
}
