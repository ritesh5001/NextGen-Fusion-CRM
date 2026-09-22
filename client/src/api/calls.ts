import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { useAuthStore } from '@/store/auth';
import type { CallLog, CallProvider, CallStatus, Disposition, Lead, Paginated } from '@/types';

export function useCalls(params: { lead?: string; telecaller?: string; page?: number } = {}) {
  return useQuery({
    queryKey: ['calls', params],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean } & Paginated<CallLog>>('/calls', { params });
      return data;
    },
  });
}

export interface CallConfig {
  /** Twilio is set up AND this user has a caller ID — the softphone can dial. */
  enabled: boolean;
  /** Twilio is switched on and fully credentialed (account-wide). */
  configured: boolean;
  /** This user has a Twilio number to dial from (admin-assigned). */
  hasCallerId: boolean;
  defaultCountryCode?: string;
  /** The provider this user chose, and the one actually usable right now. */
  preferredProvider: CallProvider;
  activeProvider: CallProvider;
  providers: {
    twilio: { enabled: boolean; configured: boolean; hasCallerId: boolean; defaultCountryCode?: string };
    telecmi: {
      enabled: boolean;
      configured: boolean;
      hasAgent: boolean;
      defaultCountryCode?: string;
      clickToCallReady: boolean;
    };
  };
}

/** The TeleCMI SIP credentials this user's browser softphone registers with. */
export interface TelecmiCredentials {
  userId: string;
  password: string;
  sbcUri: string;
  defaultCountryCode?: string;
}

export async function fetchTelecmiCredentials(): Promise<TelecmiCredentials> {
  const { data } = await api.get<{ success: boolean } & TelecmiCredentials>('/calls/telecmi/credentials');
  return { userId: data.userId, password: data.password, sbcUri: data.sbcUri, defaultCountryCode: data.defaultCountryCode };
}

/** Asks TeleCMI to ring this telecaller's phone, then bridge `to`. */
export async function startClickToCall(to: string, lead?: string | null): Promise<string> {
  const { data } = await api.post<{ success: boolean; requestId: string }>('/calls/telecmi/click-to-call', {
    to,
    ...(lead ? { lead } : {}),
  });
  return data.requestId;
}

/** Saves which provider this user prefers to dial with. */
export function useSetCallProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (provider: CallProvider) => {
      const { data } = await api.patch<{ success: boolean; provider: CallProvider }>('/calls/provider', { provider });
      return data.provider;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['call-config'] }),
  });
}

/** Whether in-app (Twilio) calling is configured on the server (+ default country code). */
export function useCallConfig() {
  return useQuery({
    queryKey: ['call-config'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean } & CallConfig>('/calls/config');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Fetches a fresh Twilio Voice access token for the browser softphone. */
export async function fetchVoiceToken(): Promise<string> {
  const { data } = await api.get<{ success: boolean; token: string; identity: string }>('/calls/token');
  return data.token;
}

/** Downloads a call's recording (auth-proxied) and returns a playable object URL. */
export async function fetchRecordingObjectUrl(callId: string): Promise<string> {
  const { data } = await api.get(`/calls/${callId}/recording`, { responseType: 'blob' });
  return URL.createObjectURL(data as Blob);
}

export interface DialResult {
  dialStatus: string | null;
  dialReason: string | null; // specific reason (e.g. "Invalid or unreachable number") when known
}

/** Polls the dial result (completed/busy/no-answer/failed/canceled) + reason for a Twilio call. */
export async function fetchDialStatus(callSid: string): Promise<DialResult> {
  const { data } = await api.get<{ success: boolean; dialStatus: string | null; dialReason: string | null }>(
    `/calls/dial-status/${callSid}`
  );
  return { dialStatus: data.dialStatus, dialReason: data.dialReason ?? null };
}

// Mirror of the server's DISPOSITION_TO_LEAD_STATUS for optimistic row updates.
const DISPOSITION_TO_LEAD_STATUS: Record<Disposition, Lead['status']> = {
  interested: 'interested',
  callback: 'callback',
  not_interested: 'not_interested',
  busy: 'in_progress',
  switched_off: 'in_progress',
  wrong_number: 'not_interested',
  dnd: 'dnd',
  converted: 'converted',
};

interface LogCallVars {
  /** Omitted for a custom dial to a number that isn't a saved contact. */
  lead?: string;
  callStatus: CallStatus;
  disposition?: Disposition;
  notes?: string;
  remark?: string;
  durationSec?: number;
  nextFollowUpAt?: string;
  twilioCallSid?: string;
  /** Which backend placed the call, so the outcome is logged against the right one. */
  provider?: CallProvider;
  mode?: 'softphone' | 'click_to_call';
  telecmiCallId?: string;
  telecmiRequestId?: string;
  phone?: 'phone1' | 'phone2' | 'phone3';
  phoneNumber?: string;
}

/** Optimistically patch a single lead across every cached `['leads', …]` list. */
export function patchLeadInLists(
  qc: ReturnType<typeof useQueryClient>,
  id: string,
  update: (l: Lead) => Lead
) {
  const snapshots = qc.getQueriesData<{ data: Lead[] } & Record<string, unknown>>({ queryKey: ['leads'] });
  qc.setQueriesData<{ data: Lead[] } & Record<string, unknown>>({ queryKey: ['leads'] }, (old) => {
    if (!old?.data) return old;
    return { ...old, data: old.data.map((l) => (l._id === id ? update(l) : l)) };
  });
  return snapshots;
}

export interface SaveCustomContactVars {
  callLog: string;
  name: string;
  phone: string;
  email?: string;
  company?: string;
  city?: string;
  notes?: string;
}

/** Turns a custom-dialled number into a contact, back-linking the call already logged. */
export function useSaveCustomContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: SaveCustomContactVars) =>
      (await api.post<{ success: boolean; lead: Lead }>('/calls/save-contact', payload)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead-stats'] });
      qc.invalidateQueries({ queryKey: ['calls'] });
    },
  });
}

export function useLogCall() {
  const qc = useQueryClient();
  const user = useAuthStore.getState().user;

  return useMutation({
    mutationFn: async (payload: LogCallVars) => (await api.post('/calls', payload)).data,
    onMutate: async (vars) => {
      // A custom call has no contact row to patch — nothing to do optimistically.
      if (!vars.lead) return { snapshots: undefined };
      await qc.cancelQueries({ queryKey: ['leads'] });
      const snapshots = patchLeadInLists(qc, vars.lead, (l) => {
        const next: Lead = { ...l };
        if (vars.callStatus === 'done' && vars.disposition) {
          next.callStatus = 'done';
          next.lastOutcome = vars.disposition;
          next.status = DISPOSITION_TO_LEAD_STATUS[vars.disposition];
          if (vars.disposition === 'interested' || vars.disposition === 'converted') next.qualified = true;
        } else if (vars.callStatus === 'not_done') {
          next.callStatus = 'not_done';
        }
        next.lastContactedAt = new Date().toISOString();
        if (vars.remark) {
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
    onError: (_e, _v, ctx) => {
      ctx?.snapshots?.forEach(([key, data]) => qc.setQueryData(key, data));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['lead-stats'] });
      qc.invalidateQueries({ queryKey: ['followups'] });
      qc.invalidateQueries({ queryKey: ['my-stats'] });
      qc.invalidateQueries({ queryKey: ['calls'] });
    },
  });
}
