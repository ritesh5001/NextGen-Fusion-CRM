import { z } from 'zod';
import { LEAD_STATUSES, LEAD_PRIORITIES, PHONE_CALL_STATUSES, PHONE_LEAD_OUTCOMES } from '../models/Lead.js';

export const createLeadSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().min(1, 'Phone is required'),
  altPhone: z.string().optional().default(''),
  altPhone2: z.string().optional().default(''),
  email: z.string().email().optional().or(z.literal('')).default(''),
  title: z.string().optional().default(''),
  company: z.string().optional().default(''),
  city: z.string().optional().default(''),
  state: z.string().optional().default(''),
  country: z.string().optional().default(''),
  source: z.string().optional().default('manual'),
  tags: z.array(z.string()).optional().default([]),
  priority: z.enum(LEAD_PRIORITIES).optional().default('medium'),
  status: z.enum(LEAD_STATUSES as [string, ...string[]]).optional(),
  notes: z.string().optional().default(''),
  assignedTo: z.string().optional(),
});

export const updateLeadSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  altPhone: z.string().optional(),
  altPhone2: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  title: z.string().optional(),
  company: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(LEAD_PRIORITIES).optional(),
  status: z.enum(LEAD_STATUSES as [string, ...string[]]).optional(),
  notes: z.string().optional(),
  qualified: z.boolean().optional(),
  // Admin-only in practice — the controller drops it for telecallers.
  assignedTo: z.string().optional().or(z.literal('')),
  nextFollowUpAt: z.coerce.date().optional().nullable(),
});

export const addRemarkSchema = z.object({
  text: z.string().min(1, 'Remark text is required'),
});

export const followUpSchema = z.object({
  scheduledAt: z.coerce.date(),
  notes: z.string().optional().default(''),
});

export const assignLeadSchema = z.object({
  assignedTo: z.string().min(1, 'assignedTo is required'),
});

export const bulkAssignSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1, 'Select at least one lead'),
  assignedTo: z.string().min(1, 'assignedTo is required'),
});

export const bulkDeleteSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1, 'Select at least one contact'),
});

export const phoneOutcomeSchema = z
  .object({
    phone: z.enum(['phone1', 'phone2', 'phone3']),
    callStatus: z.enum(PHONE_CALL_STATUSES).optional(),
    leadOutcome: z.enum(PHONE_LEAD_OUTCOMES).optional(),
    remark: z.string().optional().default(''),
  })
  .refine((d) => !!d.callStatus || !!d.leadOutcome || !!d.remark, {
    message: 'At least one of callStatus, leadOutcome, or remark is required',
  });

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type PhoneOutcomeInput = z.infer<typeof phoneOutcomeSchema>;
