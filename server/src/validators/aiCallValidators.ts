import { z } from 'zod';
import { AI_CALL_INTERESTS, AI_CALL_STATUSES } from '../models/AiCall.js';

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

/** Bolna settings — same convention as the other providers (blank apiKey = keep). */
export const updateBolnaSchema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().trim().optional(),
  agentId: z.string().trim().optional(),
  callerId: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\+\d{6,15}$/.test(v), 'Use E.164 format, e.g. +918035737000')
    .optional(),
  maxConcurrent: z.coerce.number().int().min(1).max(50).optional(),
  publicServerUrl: z.string().trim().optional(),
  defaultCountryCode: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\+\d{1,4}$/.test(v), 'Use a country code like +91 or +1')
    .optional(),
});
export type UpdateBolnaInput = z.infer<typeof updateBolnaSchema>;

export const bolnaTestSchema = z.object({ apiKey: z.string().trim().optional() });

const numberEntry = z.object({
  name: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().min(3).max(40),
});

/**
 * Create a campaign from pasted/uploaded numbers and/or existing contacts. The
 * `contacts` selector picks CRM contacts that haven't been reached yet.
 */
export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the campaign').max(120),
    numbers: z.array(numberEntry).max(5000).optional().default([]),
    contacts: z
      .object({
        callStatus: z.enum(['pending', 'not_done', 'any']).default('pending'),
        limit: z.coerce.number().int().min(1).max(5000).default(100),
      })
      .optional(),
    pitch: z.string().trim().max(1000).optional().default(''),
    agentId: z.string().trim().optional().default(''),
    fromNumber: z.preprocess(
      blankToUndefined,
      z.string().trim().regex(/^\+\d{6,15}$/, 'Use E.164 format, e.g. +918035737000').optional()
    ),
    maxAttempts: z.coerce.number().int().min(1).max(5).optional().default(1),
    retryDelayMin: z.coerce.number().int().min(5).max(24 * 60).optional().default(60),
    assignTo: z.preprocess(blankToUndefined, z.string().optional()),
    saveAllContacts: z.boolean().optional().default(false),
    startNow: z.boolean().optional().default(true),
  })
  .refine((v) => v.numbers.length > 0 || v.contacts, {
    message: 'Add at least one number or pick contacts',
    path: ['numbers'],
  });
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const campaignActionSchema = z.object({
  action: z.enum(['start', 'pause', 'cancel']),
});

export const listAiCallsQuerySchema = z.object({
  campaign: z.string().optional(),
  status: z.preprocess(blankToUndefined, z.enum(AI_CALL_STATUSES).optional()),
  interest: z.preprocess(blankToUndefined, z.enum(AI_CALL_INTERESTS).optional()),
  search: z.string().optional(),
  page: z.coerce.number().optional(),
  limit: z.coerce.number().optional(),
});

/** Manually override the agent's verdict (and save to the CRM). */
export const setInterestSchema = z.object({
  interest: z.enum(AI_CALL_INTERESTS),
});
