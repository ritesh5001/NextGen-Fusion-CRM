import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { removeListItem, restoreSnapshots } from '@/lib/queryPatch';
import type { FollowUp, Paginated } from '@/types';

export function useFollowUps(params: { scope?: string; telecaller?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['followups', params],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean } & Paginated<FollowUp>>('/followups', { params });
      return data;
    },
  });
}

export function useMarkFollowUpDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`/followups/${id}/done`)).data,
    // Follow-up lists only show `pending`, so drop the row immediately.
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['followups'] });
      const snapshots = removeListItem<FollowUp>(qc, ['followups'], id);
      return { snapshots };
    },
    onError: (_e, _v, ctx) => restoreSnapshots(qc, ctx?.snapshots),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['followups'] });
      qc.invalidateQueries({ queryKey: ['my-stats'] });
    },
  });
}
