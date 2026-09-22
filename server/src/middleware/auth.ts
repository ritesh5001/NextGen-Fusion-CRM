import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../utils/jwt.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/User.js';
import type { UserRole } from '../models/User.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // `workspace` is the telecaller's own workspace (empty for the superadmin).
      user?: { id: string; role: UserRole; name: string; workspace: string };
      // The active workspace resolved for this request (see middleware/workspace.ts).
      workspaceId?: string;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('Missing or invalid authorization header');
    }
    const token = header.slice('Bearer '.length);
    const payload = verifyToken(token);

    // Ensure the user still exists and is active.
    const user = await User.findById(payload.sub).select('isActive role name workspace');
    if (!user || !user.isActive) {
      throw ApiError.unauthorized('Account not found or deactivated');
    }

    req.user = {
      id: String(user._id),
      role: user.role,
      name: user.name,
      workspace: user.workspace ? String(user.workspace) : '',
    };
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(ApiError.unauthorized('Invalid or expired token'));
  }
}
