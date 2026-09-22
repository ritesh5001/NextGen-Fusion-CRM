import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface Overview {
  totalTelecallers: number;
  activeTelecallers: number;
  totalLeads: number;
  convertedLeads: number;
  conversionRate: number;
  callsToday: number;
  pendingTasks: number;
  leadsByStatus: { _id: string; count: number }[];
  dispositionBreakdown: { _id: string; count: number }[];
  perTelecaller: { _id: string; name: string; calls: number; dailyTarget: number }[];
}

export interface MyStats {
  dailyTarget: number;
  callsToday: number;
  targetProgress: number;
  myContacts: number;
  myLeads: number;
  pendingTasks: number;
  followUpsToday: number;
  overdueFollowUps: number;
  dispositionToday: { _id: string; count: number }[];
}

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: async () => (await api.get<{ overview: Overview }>('/reports/overview')).data.overview,
  });
}

export function useMyStats() {
  return useQuery({
    queryKey: ['my-stats'],
    queryFn: async () => (await api.get<{ stats: MyStats }>('/reports/me')).data.stats,
  });
}
