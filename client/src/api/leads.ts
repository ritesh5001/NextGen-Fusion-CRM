import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { patchLeadInLists } from './calls';
import { useAuthStore } from '@/store/auth';
import type { Lead, Paginated, PhoneCallStatus, PhoneLeadOutcome } from '@/types';

export interface LeadQuery {
  search?: string;
  status?: string;
  priority?: string;
  assignedTo?: string;
  qualified?: string;
  callStatus?: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface LeadStats {
  total: number;
  notCalled: number;
  done: number;
  notDone: number;
  leads: number;
}

export function useLeadStats(params: LeadQuery = {}) {
  // Stats ignore callStatus/page/limit (server recomputes per chip within the scope).
  const { callStatus: _c, page: _p, limit: _l, ...scope } = params;
  return useQuery({
    queryKey: ['lead-stats', scope],
    queryFn: async () => (await api.get<{ stats: LeadStats }>('/leads/stats', { params: scope })).data.stats,
  });
}

export async function fetchLeadsForExport(params: LeadQuery): Promise<Lead[]> {
  const { page: _p, limit: _l, ...rest } = params;
  const { data } = await api.get<{ data: Lead[] }>('/leads/export', { params: rest });
  return data.data;
}

export function useLeads(params: LeadQuery = {}) {
  return useQuery({
    queryKey: ['leads', params],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean } & Paginated<Lead>>('/leads', { params });
      return data;
    },
  });
}

/** Contacts are the full list (no qualified filter); Leads are the qualified subset. */
export const useContacts = useLeads;

export function useAddRemark() {
  const qc = useQueryClient();
  const user = useAuthStore.getState().user;
  return useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) =>
      (await api.post(`/leads/${id}/remarks`, { text })).data,
    onMutate: async ({ id, text }) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const snapshots = patchLeadInLists(qc, id, (l) => ({
        ...l,
        remarks: [
          ...(l.remarks ?? []),
          { text, byName: user?.name, byRole: user?.role, createdAt: new Date().toISOString() },
        ],
      }));
      return { snapshots };
    },
    onError: (_e, _v, ctx) => ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead', v.id] });
    },
  });
}

export function useScheduleFollowUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, scheduledAt, notes }: { id: string; scheduledAt: string; notes?: string }) =>
      (await api.post(`/leads/${id}/followup`, { scheduledAt, notes })).data,
    onMutate: async ({ id, scheduledAt }) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const snapshots = patchLeadInLists(qc, id, (l) => ({ ...l, nextFollowUpAt: scheduledAt }));
      return { snapshots };
    },
    onError: (_e, _v, ctx) => ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['followups'] });
    },
  });
}

export function useLead(id?: string) {
  return useQuery({
    queryKey: ['lead', id],
    enabled: !!id,
    queryFn: async () => (await api.get<{ lead: Lead }>(`/leads/${id}`)).data.lead,
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<Lead>) => (await api.post('/leads', payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string } & Partial<Lead>) =>
      (await api.put(`/leads/${id}`, payload)).data,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead', v.id] });
    },
  });
}

export function useAssignLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, assignedTo }: { id: string; assignedTo: string; assignedToName?: string }) =>
      (await api.patch(`/leads/${id}/assign`, { assignedTo })).data,
    onMutate: async ({ id, assignedTo, assignedToName }) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const snapshots = patchLeadInLists(qc, id, (l) => ({
        ...l,
        assignedTo: { _id: assignedTo, name: assignedToName ?? '' } as Lead['assignedTo'],
        status: l.status === 'new' ? 'assigned' : l.status,
      }));
      return { snapshots };
    },
    onError: (_e, _v, ctx) => ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead-stats'] });
    },
  });
}

export function useBulkAssignLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadIds, assignedTo }: { leadIds: string[]; assignedTo: string; assignedToName?: string }) =>
      (await api.patch('/leads/bulk-assign', { leadIds, assignedTo })).data,
    onMutate: async ({ leadIds, assignedTo, assignedToName }) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const ids = new Set(leadIds);
      const snapshots = qc.getQueriesData<{ data: Lead[] }>({ queryKey: ['leads'] });
      qc.setQueriesData<{ data: Lead[] }>({ queryKey: ['leads'] }, (old) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((l) =>
            ids.has(l._id)
              ? { ...l, assignedTo: { _id: assignedTo, name: assignedToName ?? '' } as Lead['assignedTo'], status: l.status === 'new' ? 'assigned' : l.status }
              : l
          ),
        };
      });
      return { snapshots };
    },
    onError: (_e, _v, ctx) => ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead-stats'] });
    },
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/leads/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}

export function useBulkDeleteLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (leadIds: string[]) => (await api.post('/leads/bulk-delete', { leadIds })).data,
    onMutate: async (leadIds) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const ids = new Set(leadIds);
      const snapshots = qc.getQueriesData<{ data: Lead[] }>({ queryKey: ['leads'] });
      qc.setQueriesData<{ data: Lead[] }>({ queryKey: ['leads'] }, (old) => {
        if (!old?.data) return old;
        return { ...old, data: old.data.filter((l) => !ids.has(l._id)) };
      });
      return { snapshots };
    },
    onError: (_e, _v, ctx) => ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead-stats'] });
    },
  });
}

export interface PhoneOutcomeVars {
  id: string;
  phone: 'phone1' | 'phone2' | 'phone3';
  callStatus?: PhoneCallStatus;
  leadOutcome?: PhoneLeadOutcome;
  remark?: string;
}

export function useUpdatePhoneOutcome() {
  const qc = useQueryClient();
  const user = useAuthStore.getState().user;

  return useMutation({
    mutationFn: async ({ id, ...payload }: PhoneOutcomeVars) =>
      (await api.patch(`/leads/${id}/phone-outcome`, payload)).data,

    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['leads'] });
      const snapshots = patchLeadInLists(qc, vars.id, (l) => {
        const slotKey =
          vars.phone === 'phone1' ? 'phone1Outcome' : vars.phone === 'phone2' ? 'phone2Outcome' : 'phone3Outcome';
        const prevSlot = l[slotKey] ?? { callStatus: 'pending' as PhoneCallStatus, leadOutcome: 'none' as PhoneLeadOutcome };
        const updatedSlot = {
          ...prevSlot,
          ...(vars.callStatus ? { callStatus: vars.callStatus } : {}),
          ...(vars.leadOutcome ? { leadOutcome: vars.leadOutcome } : {}),
        };

        const p1cs = (vars.phone === 'phone1' ? updatedSlot : l.phone1Outcome)?.callStatus ?? 'pending';
        const p2cs = (vars.phone === 'phone2' ? updatedSlot : l.phone2Outcome)?.callStatus ?? 'pending';
        const p3cs = (vars.phone === 'phone3' ? updatedSlot : l.phone3Outcome)?.callStatus ?? 'pending';
        const newCallStatus =
          p1cs === 'connected' || p2cs === 'connected' || p3cs === 'connected' ? 'done' :
          p1cs !== 'pending' || p2cs !== 'pending' || p3cs !== 'pending' ? 'not_done' : 'pending';

        const next: Lead = { ...l, [slotKey]: updatedSlot, callStatus: newCallStatus };

        // Mirror the server's call-status side effects for instant feedback.
        if (vars.callStatus) {
          // Any call-status change stamps the last-contacted date.
          next.lastContactedAt = new Date().toISOString();
          if (vars.callStatus === 'connected' && !l.nextFollowUpAt) {
            // A connecting call seeds a follow-up 2 weeks out if none exists.
            const followUpAt = new Date();
            followUpAt.setDate(followUpAt.getDate() + 14);
            next.nextFollowUpAt = followUpAt.toISOString();
          } else if (vars.callStatus === 'not_connected') {
            // A not-connected call reschedules the follow-up one week out.
            const followUpAt = new Date();
            followUpAt.setDate(followUpAt.getDate() + 7);
            next.nextFollowUpAt = followUpAt.toISOString();
          }
        }

        const p1lo = (vars.phone === 'phone1' ? updatedSlot : l.phone1Outcome)?.leadOutcome ?? 'none';
        const p2lo = (vars.phone === 'phone2' ? updatedSlot : l.phone2Outcome)?.leadOutcome ?? 'none';
        const p3lo = (vars.phone === 'phone3' ? updatedSlot : l.phone3Outcome)?.leadOutcome ?? 'none';
        if (p1lo === 'interested' || p2lo === 'interested' || p3lo === 'interested') {
          next.status = 'interested';
          next.qualified = true;
        } else if (p1lo === 'not_interested' || p2lo === 'not_interested' || p3lo === 'not_interested') {
          next.status = 'not_interested';
          next.qualified = false;
        }

        if (vars.remark?.trim()) {
          next.remarks = [
            ...(l.remarks ?? []),
            {
              text: vars.remark,
              byName: user?.name,
              byRole: user?.role,
              phone: vars.phone,
              createdAt: new Date().toISOString(),
            },
          ];
        }
        return next;
      });
      return { snapshots };
    },

    onError: (_e, _v, ctx) => ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data)),

    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead', v.id] });
      qc.invalidateQueries({ queryKey: ['lead-stats'] });
      qc.invalidateQueries({ queryKey: ['followups'] });
      qc.invalidateQueries({ queryKey: ['calls'] }); // a call-status change logs a call → refresh Recents
    },
  });
}

export interface ImportPreview {
  headers: string[];
  totalRows: number;
  sample: Record<string, string>[];
}

/** Uploads a file just to read its header row + a sample, for column mapping. */
export async function previewImportFile(file: File): Promise<ImportPreview> {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post('/leads/import/preview', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.preview as ImportPreview;
}

export type DuplicateStrategy = 'skip' | 'update' | 'import';

export interface ImportResult {
  totalRows: number;
  successCount: number;
  updatedCount: number;
  duplicateCount: number;
  errorCount: number;
}

export function useImportLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      assignedTo,
      mapping,
      duplicateStrategy,
    }: {
      file: File;
      assignedTo?: string;
      mapping?: Record<string, string>;
      duplicateStrategy?: DuplicateStrategy;
    }) => {
      const fd = new FormData();
      fd.append('file', file);
      if (assignedTo) fd.append('assignedTo', assignedTo);
      if (mapping && Object.keys(mapping).length) fd.append('mapping', JSON.stringify(mapping));
      if (duplicateStrategy) fd.append('duplicateStrategy', duplicateStrategy);
      const { data } = await api.post('/leads/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data.result as ImportResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leads'] }),
  });
}
