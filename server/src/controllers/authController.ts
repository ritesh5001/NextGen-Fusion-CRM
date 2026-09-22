import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/User.js';
import { signToken } from '../utils/jwt.js';
import type { ChangePasswordInput, LoginInput } from '../validators/authValidators.js';

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as LoginInput;

  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('Invalid email or password');
  if (!user.isActive) throw ApiError.forbidden('Your account has been deactivated');

  const ok = await user.comparePassword(password);
  if (!ok) throw ApiError.unauthorized('Invalid email or password');

  user.lastLoginAt = new Date();
  await user.save();

  const token = signToken({ sub: String(user._id), role: user.role, name: user.name });
  res.json({ success: true, token, user: user.toJSON() });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.notFound('User not found');
  res.json({ success: true, user: user.toJSON() });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as ChangePasswordInput;
  const user = await User.findById(req.user!.id).select('+passwordHash');
  if (!user) throw ApiError.notFound('User not found');

  const ok = await user.comparePassword(currentPassword);
  if (!ok) throw ApiError.badRequest('Current password is incorrect');

  await user.setPassword(newPassword);
  await user.save();
  res.json({ success: true, message: 'Password updated' });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  // Stateless JWT — client discards the token.
  res.json({ success: true, message: 'Logged out' });
});
