import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Workspace } from '@/types';

export function useWorkspaces(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['workspaces'],
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: Workspace[] }>('/workspaces');
      return data.data;
    },
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      (await api.post<{ success: boolean; workspace: Workspace }>('/workspaces', { name })).data.workspace,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspaces'] }),
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      (await api.put<{ success: boolean; workspace: Workspace }>(`/workspaces/${id}`, { name })).data.workspace,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspaces'] }),
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete(`/workspaces/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspaces'] }),
  });
}
