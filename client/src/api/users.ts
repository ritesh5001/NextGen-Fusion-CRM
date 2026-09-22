import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Paginated, User } from '@/types';

export interface UserQuery {
  search?: string;
  isActive?: string;
  page?: number;
  limit?: number;
}

export function useTelecallers(params: UserQuery = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['users', params],
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean } & Paginated<User>>('/users', { params });
      return data;
    },
  });
}

export function useCreateTelecaller() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      name: string;
      email: string;
      phone?: string;
      password: string;
      dailyTarget?: number;
    }) => (await api.post('/users', payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateTelecaller() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...payload }: { id: string } & Partial<User>) =>
      (await api.put(`/users/${id}`, payload)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useSetTelecallerStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      (await api.patch(`/users/${id}/status`, { isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useResetTelecallerPassword() {
  return useMutation({
    mutationFn: async ({ id, newPassword }: { id: string; newPassword: string }) =>
      (await api.patch(`/users/${id}/reset-password`, { newPassword })).data,
  });
}

export function useDeleteTelecaller() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/users/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

/**
 * Assign (or clear, with an empty id) the TeleCMI agent a telecaller dials as.
 * A blank password keeps whatever is already stored, so the admin only has to
 * retype it when it actually changes.
 */
export function useSetTelecallerTelecmi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      telecmiUserId,
      telecmiPassword,
    }: {
      id: string;
      telecmiUserId: string;
      telecmiPassword?: string;
    }) => (await api.patch(`/users/${id}/telecmi`, { telecmiUserId, telecmiPassword })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['call-config'] });
    },
  });
}

/** Assign (or clear, with '') the Twilio caller-ID number a telecaller dials from. */
export function useSetTelecallerTwilioNumber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, twilioNumber }: { id: string; twilioNumber: string }) =>
      (await api.patch(`/users/${id}/twilio-number`, { twilioNumber })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
