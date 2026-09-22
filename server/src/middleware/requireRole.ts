import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError.js';
import type { UserRole } from '../models/User.js';

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    next();
  };
}
