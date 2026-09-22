import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { restoreSnapshots, type Snapshots } from '@/lib/queryPatch';
import type { Notification, Paginated } from '@/types';

// A notifications page carries an `unreadCount` alongside the list, so read-marking
// patches both the item(s) and the counter for an instant bell update.
type NotifPage = { data: Notification[]; unreadCount: number } & Record<string, unknown>;

export function useNotifications(params: { unread?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['notifications', params],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; unreadCount: number } & Paginated<Notification>>(
        '/notifications',
        { params }
      );
      return data;
    },
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.patch(`/notifications/${id}/read`)).data,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['notifications'] });
      const snapshots = qc.getQueriesData<NotifPage>({ queryKey: ['notifications'] }) as Snapshots;
      qc.setQueriesData<NotifPage>({ queryKey: ['notifications'] }, (old) => {
        if (!old?.data) return old;
        const wasUnread = old.data.some((n) => n._id === id && !n.isRead);
        return {
          ...old,
          data: old.data.map((n) => (n._id === id ? { ...n, isRead: true } : n)),
          unreadCount: Math.max(0, old.unreadCount - (wasUnread ? 1 : 0)),
        };
      });
      return { snapshots };
    },
    onError: (_e, _v, ctx) => restoreSnapshots(qc, ctx?.snapshots),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.patch('/notifications/read-all')).data,
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['notifications'] });
      const snapshots = qc.getQueriesData<NotifPage>({ queryKey: ['notifications'] }) as Snapshots;
      qc.setQueriesData<NotifPage>({ queryKey: ['notifications'] }, (old) => {
        if (!old?.data) return old;
        return { ...old, data: old.data.map((n) => ({ ...n, isRead: true })), unreadCount: 0 };
      });
      return { snapshots };
    },
    onError: (_e, _v, ctx) => restoreSnapshots(qc, ctx?.snapshots),
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
