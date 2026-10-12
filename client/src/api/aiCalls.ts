import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { patchListItem, restoreSnapshots } from '@/lib/queryPatch';
import type { Paginated } from '@/types';

// ───────────────────────────── Bolna settings ─────────────────────────────

/** Client-safe Bolna settings (API key reduced to a `*Set` flag). */
export interface BolnaIntegration {
  enabled: boolean;
  configured: boolean;
  agentId: string;
  callerId: string;
  maxConcurrent: number;
  defaultCountryCode: string;
  publicServerUrl: string;
  apiKeySet: boolean;
  webhookUrl: string;
  extractionPrompt: string;
}

export interface BolnaIntegrationUpdate {
  enabled?: boolean;
  apiKey?: string;
  agentId?: string;
  callerId?: string;
  maxConcurrent?: number;
  defaultCountryCode?: string;
  publicServerUrl?: string;
}

export interface BolnaAgent {
  id: string;
  name: string;
  status?: string;
}

export function useBolnaIntegration() {
  return useQuery({
    queryKey: ['bolna-integration'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: BolnaIntegration }>('/integrations/bolna');
      return data.data;
    },
  });
}

export function useUpdateBolnaIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: BolnaIntegrationUpdate) =>
      (await api.put<{ success: boolean; data: BolnaIntegration }>('/integrations/bolna', payload)).data.data,
    onSuccess: (data) => qc.setQueryData(['bolna-integration'], data),
  });
}

/** Tests a typed (or the stored) API key by listing the account's agents. */
export function useBolnaAgents() {
  return useMutation({
    mutationFn: async (apiKey?: string) =>
      (await api.post<{ success: boolean; data: BolnaAgent[] }>('/integrations/bolna/agents', { apiKey })).data.data,
  });
}

// ─────────────────────────────── campaigns ───────────────────────────────

export type AiCampaignStatus = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled';
export type AiCallStatus =
  | 'queued'
  | 'dialing'
  | 'in_progress'
  | 'completed'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'cancelled';
export type AiCallInterest = 'unknown' | 'yes' | 'no' | 'callback';

export interface AiCampaignStats {
  total: number;
  queued: number;
  active: number;
  completed: number;
  unreachable: number;
  failed: number;
  interested: number;
  notInterested: number;
  callback: number;
}

export interface AiCampaign {
  _id: string;
  name: string;
  status: AiCampaignStatus;
  pitch: string;
  agentId: string;
  fromNumber: string;
  maxAttempts: number;
  retryDelayMin: number;
  assignTo?: { _id: string; name: string } | null;
  saveAllContacts: boolean;
  totalNumbers: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  stats: AiCampaignStats;
}

export interface AiCall {
  _id: string;
  campaign: { _id: string; name: string } | string;
  name: string;
  phoneNumber: string;
  lead?: { _id: string; name: string; status: string; qualified: boolean } | null;
  status: AiCallStatus;
  interest: AiCallInterest;
  attempts: number;
  nextAttemptAt?: string;
  providerStatus: string;
  summary: string;
  transcript: string;
  extractedData?: Record<string, unknown>;
  recordingUrl: string;
  durationSec: number;
  cost?: number;
  hangupReason: string;
  error: string;
  dialedAt?: string;
  endedAt?: string;
  updatedAt: string;
}

export interface CreateCampaignPayload {
  name: string;
  numbers: { name?: string; phone: string }[];
  contacts?: { callStatus: 'pending' | 'not_done' | 'any'; limit: number };
  pitch?: string;
  agentId?: string;
  fromNumber?: string;
  maxAttempts?: number;
  retryDelayMin?: number;
  assignTo?: string;
  saveAllContacts?: boolean;
  startNow?: boolean;
}

/** Polls while something is dialling so progress updates live. */
export function useAiCampaigns() {
  return useQuery({
    queryKey: ['ai-campaigns'],
    queryFn: async () =>
      (await api.get<{ success: boolean; data: AiCampaign[] }>('/ai-calls/campaigns')).data.data,
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === 'running') ? 5000 : false),
  });
}

export function useCreateAiCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateCampaignPayload) =>
      (
        await api.post<{ success: boolean; data: AiCampaign; added: number; invalid: string[] }>(
          '/ai-calls/campaigns',
          payload
        )
      ).data,
    onSettled: () => qc.invalidateQueries({ queryKey: ['ai-campaigns'] }),
  });
}

export function useAiCampaignAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'start' | 'pause' | 'cancel' }) =>
      (await api.patch(`/ai-calls/campaigns/${id}/status`, { action })).data,
    onMutate: async ({ id, action }) => {
      await qc.cancelQueries({ queryKey: ['ai-campaigns'] });
      const prev = qc.getQueryData<AiCampaign[]>(['ai-campaigns']);
      const status: AiCampaignStatus = action === 'start' ? 'running' : action === 'pause' ? 'paused' : 'cancelled';
      qc.setQueryData<AiCampaign[]>(['ai-campaigns'], (old) =>
        old?.map((c) => (c._id === id ? { ...c, status } : c))
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['ai-campaigns'], ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['ai-campaigns'] });
      qc.invalidateQueries({ queryKey: ['ai-calls'] });
    },
  });
}

export function useDeleteAiCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/ai-calls/campaigns/${id}`)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['ai-campaigns'] });
      const prev = qc.getQueryData<AiCampaign[]>(['ai-campaigns']);
      qc.setQueryData<AiCampaign[]>(['ai-campaigns'], (old) => old?.filter((c) => c._id !== id));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(['ai-campaigns'], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['ai-campaigns'] }),
  });
}

// ──────────────────────────────── calls ────────────────────────────────

export interface AiCallQuery {
  campaign?: string;
  status?: string;
  interest?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export function useAiCalls(params: AiCallQuery, live: boolean) {
  return useQuery({
    queryKey: ['ai-calls', params],
    queryFn: async () =>
      (await api.get<{ success: boolean } & Paginated<AiCall>>('/ai-calls/calls', { params })).data,
    refetchInterval: live ? 5000 : false,
  });
}

export function useSetAiCallInterest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, interest }: { id: string; interest: AiCallInterest }) =>
      (await api.patch<{ success: boolean; data: AiCall }>(`/ai-calls/calls/${id}/interest`, { interest })).data
        .data,
    onMutate: async ({ id, interest }) => {
      await qc.cancelQueries({ queryKey: ['ai-calls'] });
      return { snapshots: patchListItem<AiCall>(qc, ['ai-calls'], id, (c) => ({ ...c, interest })) };
    },
    onError: (_e, _v, ctx) => ctx && restoreSnapshots(qc, ctx.snapshots),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['ai-calls'] });
      qc.invalidateQueries({ queryKey: ['ai-campaigns'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}

export function useRetryAiCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/ai-calls/calls/${id}/retry`)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['ai-calls'] });
      return {
        snapshots: patchListItem<AiCall>(qc, ['ai-calls'], id, (c) => ({ ...c, status: 'queued', error: '' })),
      };
    },
    onError: (_e, _v, ctx) => ctx && restoreSnapshots(qc, ctx.snapshots),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['ai-calls'] });
      qc.invalidateQueries({ queryKey: ['ai-campaigns'] });
    },
  });
}
