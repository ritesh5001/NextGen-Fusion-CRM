import { Schema, model, Types, type Model, type HydratedDocument } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'superadmin' | 'telecaller';
export const USER_ROLES: UserRole[] = ['superadmin', 'telecaller'];

/** Telephony backends a call can be placed through. */
export const CALL_PROVIDERS = ['twilio', 'telecmi'] as const;
export type CallProvider = (typeof CALL_PROVIDERS)[number];

export interface IUser {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  dailyTarget: number;
  twilioNumber: string; // Twilio caller ID assigned to this telecaller (E.164), '' if none
  // TeleCMI (PIOPIY) agent the admin assigned this telecaller. `telecmiUserId` is
  // the SIP/agent id from the TeleCMI dashboard (e.g. '103_1111113'); the password
  // is secret and only ever sent to that telecaller's own browser for the softphone.
  telecmiUserId: string;
  telecmiPassword: string;
  // Cached click-to-call agent token (valid 30 days) + when it was issued.
  telecmiAgentToken?: string;
  telecmiTokenAt?: Date;
  // Which provider this telecaller prefers to dial with.
  callProvider: CallProvider;
  // The workspace a telecaller belongs to. Absent for the superadmin, who is
  // global (shared across all workspaces).
  workspace?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  setPassword(plain: string): Promise<void>;
  comparePassword(plain: string): Promise<boolean>;
}

export type UserModel = Model<IUser, object, IUserMethods>;
export type UserDoc = HydratedDocument<IUser, IUserMethods>;

const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: '' },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, required: true, default: 'telecaller' },
    isActive: { type: Boolean, default: true },
    dailyTarget: { type: Number, default: 50, min: 0 },
    twilioNumber: { type: String, trim: true, default: '' },
    telecmiUserId: { type: String, trim: true, default: '' },
    telecmiPassword: { type: String, default: '', select: false },
    telecmiAgentToken: { type: String, default: '', select: false },
    telecmiTokenAt: { type: Date },
    callProvider: { type: String, enum: CALL_PROVIDERS, default: 'twilio' },
    workspace: { type: Schema.Types.ObjectId, ref: 'Workspace', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    const r = ret as unknown as Record<string, unknown>;
    delete r.passwordHash;
    // Secrets are select:false, but never echo them even when explicitly selected.
    delete r.telecmiPassword;
    delete r.telecmiAgentToken;
    delete r.__v;
    return r;
  },
});

userSchema.methods.setPassword = async function (plain: string): Promise<void> {
  this.passwordHash = await bcrypt.hash(plain, 10);
};

userSchema.methods.comparePassword = function (plain: string): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash);
};

export const User = model<IUser, UserModel>('User', userSchema);
