import { z } from 'zod';

export const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email(),
  phone: z.string().optional().default(''),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  dailyTarget: z.number().int().min(0).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  dailyTarget: z.number().int().min(0).optional(),
});

export const setStatusSchema = z.object({
  isActive: z.boolean(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

export const setTargetSchema = z.object({
  dailyTarget: z.number().int().min(0),
});

// Assign a TeleCMI agent to a telecaller. An empty `telecmiUserId` unassigns them;
// a blank password keeps whatever is already stored.
export const setTelecmiAgentSchema = z.object({
  telecmiUserId: z.string().trim().default(''),
  telecmiPassword: z.string().trim().optional(),
});

export const setTwilioNumberSchema = z.object({
  // E.164 (e.g. +14155551234), or empty string to unassign.
  twilioNumber: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\+\d{6,15}$/.test(v),
      'Must be a valid number in E.164 format (e.g. +14155551234)'
    )
    .default(''),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
