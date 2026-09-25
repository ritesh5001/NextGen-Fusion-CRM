import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

/** Client-safe Twilio settings (secrets reduced to `*Set` flags). */
export interface TwilioIntegration {
  enabled: boolean;
  configured: boolean;
  accountSid: string;
  apiKeySid: string;
  twimlAppSid: string;
  callerId: string;
  recordCalls: boolean;
  defaultCountryCode: string;
  publicServerUrl: string;
  authTokenSet: boolean;
  apiKeySecretSet: boolean;
  voiceWebhookUrl: string;
}

export interface TwilioIntegrationUpdate {
  enabled?: boolean;
  accountSid?: string;
  authToken?: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  twimlAppSid?: string;
  callerId?: string;
  recordCalls?: boolean;
  defaultCountryCode?: string;
  publicServerUrl?: string;
}

export interface TwilioNumber {
  phoneNumber: string;
  friendlyName: string;
}

/** Voice-capable numbers owned by the Twilio account (for assigning to telecallers). */
export function useTwilioNumbers(enabled: boolean) {
  return useQuery({
    queryKey: ['twilio-numbers'],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: TwilioNumber[] }>(
        '/integrations/twilio/numbers'
      );
      return data.data;
    },
  });
}

export function useTwilioIntegration() {
  return useQuery({
    queryKey: ['twilio-integration'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: TwilioIntegration }>('/integrations/twilio');
      return data.data;
    },
  });
}

/** Client-safe TeleCMI settings (the API token reduced to a `*Set` flag). */
export interface TelecmiIntegration {
  enabled: boolean;
  configured: boolean;
  appId: string;
  sbcUri: string;
  apiRegion: 'india' | 'global';
  recordCalls: boolean;
  defaultCountryCode: string;
  publicServerUrl: string;
  apiSecretSet: boolean;
  sbcRegions: { uri: string; label: string }[];
  apiRegions: { id: string; label: string }[];
  /** Paste into the PIOPIY dashboard's "CDR URL" so call records reach us. */
  cdrWebhookUrl: string;
}

export interface TelecmiIntegrationUpdate {
  enabled?: boolean;
  appId?: string;
  apiSecret?: string;
  sbcUri?: string;
  apiRegion?: 'india' | 'global';
  recordCalls?: boolean;
  defaultCountryCode?: string;
  publicServerUrl?: string;
}

export function useTelecmiIntegration() {
  return useQuery({
    queryKey: ['telecmi-integration'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: TelecmiIntegration }>('/integrations/telecmi');
      return data.data;
    },
  });
}

export function useUpdateTelecmiIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TelecmiIntegrationUpdate) =>
      (await api.put<{ success: boolean; data: TelecmiIntegration }>('/integrations/telecmi', payload)).data.data,
    onSuccess: (data) => {
      qc.setQueryData(['telecmi-integration'], data);
      qc.invalidateQueries({ queryKey: ['call-config'] });
    },
  });
}

export function useUpdateTwilioIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TwilioIntegrationUpdate) =>
      (await api.put<{ success: boolean; data: TwilioIntegration }>('/integrations/twilio', payload)).data
        .data,
    onSuccess: (data) => {
      qc.setQueryData(['twilio-integration'], data);
      // The softphone availability may have changed — refresh it everywhere.
      qc.invalidateQueries({ queryKey: ['call-config'] });
    },
  });
}

export interface TelecmiDetectResult {
  region: 'india' | 'global' | null;
  /** Both platforms accepted the credentials but neither shows any calls. */
  ambiguous: boolean;
  tried: { region: 'india' | 'global'; ok: boolean; total: number; detail: string }[];
}

/** Probes both CHUB platforms with the given credentials to see which accepts them. */
export function useDetectTelecmiRegion() {
  return useMutation({
    mutationFn: async (creds: { appId: string; apiSecret?: string }) =>
      (await api.post<{ success: boolean } & TelecmiDetectResult>('/integrations/telecmi/detect', creds))
        .data,
  });
}

/** Client-safe Telnyx settings (the API key reduced to a `*Set` flag). */
export interface TelnyxIntegration {
  enabled: boolean;
  configured: boolean;
  connectionId: string;
  publicKey: string;
  callerId: string;
  recordCalls: boolean;
  defaultCountryCode: string;
  publicServerUrl: string;
  apiKeySet: boolean;
  /** Public key + public URL are set, so signed webhooks can reach the server. */
  webhookReady: boolean;
  webhookUrl: string;
}

export interface TelnyxIntegrationUpdate {
  enabled?: boolean;
  apiKey?: string;
  connectionId?: string;
  publicKey?: string;
  callerId?: string;
  recordCalls?: boolean;
  defaultCountryCode?: string;
  publicServerUrl?: string;
}

export interface TelnyxConnection {
  id: string;
  name: string;
  active: boolean;
  webhookUrl: string;
  hasOutboundProfile: boolean;
}

export interface TelnyxNumber {
  phoneNumber: string;
  connectionId: string;
  connectionName: string;
  /** Assigned to the connection the softphone uses. */
  onConnection: boolean;
}

export function useTelnyxIntegration() {
  return useQuery({
    queryKey: ['telnyx-integration'],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: TelnyxIntegration }>('/integrations/telnyx');
      return data.data;
    },
  });
}

export function useUpdateTelnyxIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: TelnyxIntegrationUpdate) =>
      (await api.put<{ success: boolean; data: TelnyxIntegration }>('/integrations/telnyx', payload)).data.data,
    onSuccess: (data) => {
      qc.setQueryData(['telnyx-integration'], data);
      qc.invalidateQueries({ queryKey: ['call-config'] });
      qc.invalidateQueries({ queryKey: ['telnyx-numbers'] });
    },
  });
}

/** Checks an API key (typed, or the saved one) and lists its credential connections. */
export function useTelnyxConnections() {
  return useMutation({
    mutationFn: async (apiKey?: string) =>
      (await api.post<{ success: boolean; data: TelnyxConnection[] }>('/integrations/telnyx/connections', { apiKey }))
        .data.data,
  });
}

/** The account's numbers, for assigning a caller ID to each telecaller. */
export function useTelnyxNumbers(enabled: boolean) {
  return useQuery({
    queryKey: ['telnyx-numbers'],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: TelnyxNumber[] }>('/integrations/telnyx/numbers');
      return data.data;
    },
  });
}

/** Points the saved connection's webhooks at this server. */
export function useApplyTelnyxWebhook() {
  return useMutation({
    mutationFn: async () =>
      (await api.post<{ success: boolean; connectionId: string; webhookUrl: string }>('/integrations/telnyx/apply-webhook'))
        .data,
  });
}
