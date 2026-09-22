import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { User } from '../models/User.js';
import { getPagination, paginated } from '../utils/pagination.js';
import type { CreateUserInput, UpdateUserInput } from '../validators/userValidators.js';

// GET /users — list telecallers (superadmin). Supports ?search=&isActive=&page=&limit=
export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const pg = getPagination(req.query);
  const filter: Record<string, unknown> = { role: 'telecaller', workspace: req.workspaceId };

  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    const rx = new RegExp(req.query.search.trim(), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  if (req.query.isActive === 'true' || req.query.isActive === 'false') {
    filter.isActive = req.query.isActive === 'true';
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(pg.skip).limit(pg.limit),
    User.countDocuments(filter),
  ]);

  res.json({ success: true, ...paginated(users, total, pg) });
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findOne({ _id: req.params.id, role: 'telecaller', workspace: req.workspaceId });
  if (!user) throw ApiError.notFound('Telecaller not found');
  res.json({ success: true, user });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as CreateUserInput;
  // Email is globally unique — a telecaller belongs to exactly one workspace.
  const exists = await User.findOne({ email: body.email });
  if (exists) throw ApiError.conflict('A user with this email already exists');

  const user = new User({
    name: body.name,
    email: body.email,
    phone: body.phone ?? '',
    role: 'telecaller',
    dailyTarget: body.dailyTarget ?? 50,
    workspace: req.workspaceId,
    createdBy: req.user!.id,
  });
  await user.setPassword(body.password);
  await user.save();

  res.status(201).json({ success: true, user: user.toJSON() });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as UpdateUserInput;
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'telecaller', workspace: req.workspaceId },
    { $set: body },
    { new: true }
  );
  if (!user) throw ApiError.notFound('Telecaller not found');
  res.json({ success: true, user });
});

export const setUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'telecaller', workspace: req.workspaceId },
    { $set: { isActive: req.body.isActive } },
    { new: true }
  );
  if (!user) throw ApiError.notFound('Telecaller not found');
  res.json({ success: true, user });
});

export const setUserTarget = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'telecaller', workspace: req.workspaceId },
    { $set: { dailyTarget: req.body.dailyTarget } },
    { new: true }
  );
  if (!user) throw ApiError.notFound('Telecaller not found');
  res.json({ success: true, user });
});

// Assign (or clear, with '') the Twilio caller-ID number a telecaller dials from.
export const setUserTwilioNumber = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, role: 'telecaller', workspace: req.workspaceId },
    { $set: { twilioNumber: req.body.twilioNumber } },
    { new: true }
  );
  if (!user) throw ApiError.notFound('Telecaller not found');
  res.json({ success: true, user });
});

// PATCH /users/:id/telecmi — assign (or clear) this telecaller's TeleCMI agent.
// Changing the credentials invalidates any cached click-to-call token so the next
// call re-authenticates instead of using a token minted for the old agent.
export const setUserTelecmi = asyncHandler(async (req: Request, res: Response) => {
  const { telecmiUserId, telecmiPassword } = req.body as {
    telecmiUserId: string;
    telecmiPassword?: string;
  };

  const user = await User.findOne({ _id: req.params.id, role: 'telecaller', workspace: req.workspaceId });
  if (!user) throw ApiError.notFound('Telecaller not found');

  user.telecmiUserId = telecmiUserId;
  // A blank password means "keep the stored one" — except when the agent id is
  // cleared, which unassigns the agent entirely.
  if (!telecmiUserId) {
    user.telecmiPassword = '';
  } else if (telecmiPassword) {
    user.telecmiPassword = telecmiPassword;
  }
  user.telecmiAgentToken = '';
  user.telecmiTokenAt = undefined;
  await user.save();

  res.json({ success: true, user });
});

export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findOne({ _id: req.params.id, role: 'telecaller', workspace: req.workspaceId }).select('+passwordHash');
  if (!user) throw ApiError.notFound('Telecaller not found');
  await user.setPassword(req.body.newPassword);
  await user.save();
  res.json({ success: true, message: 'Password reset' });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await User.findOneAndDelete({ _id: req.params.id, role: 'telecaller', workspace: req.workspaceId });
  if (!user) throw ApiError.notFound('Telecaller not found');
  res.json({ success: true, message: 'Telecaller deleted' });
});
