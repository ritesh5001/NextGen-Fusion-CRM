import { useEffect, useState } from 'react';
import { Radio, Copy, CheckCircle2, AlertCircle, Users as UsersIcon, Link2, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useTelnyxIntegration,
  useUpdateTelnyxIntegration,
  useTelnyxConnections,
  useTelnyxNumbers,
  useApplyTelnyxWebhook,
  type TelnyxConnection,
  type TelnyxIntegrationUpdate,
} from '@/api/integrations';
import { useTelecallers, useSetTelecallerTelnyxNumber } from '@/api/users';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { Badge, Card, Spinner, Toggle } from '@/components/ui/Misc';

interface FormState {
  enabled: boolean;
  recordCalls: boolean;
  apiKey: string;
  connectionId: string;
  publicKey: string;
  callerId: string;
  defaultCountryCode: string;
  publicServerUrl: string;
}

const EMPTY: FormState = {
  enabled: false,
  recordCalls: true,
  apiKey: '',
  connectionId: '',
  publicKey: '',
  callerId: '',
  defaultCountryCode: '',
  publicServerUrl: '',
};

/** Assign a Telnyx number (caller ID) to each telecaller. */
function TelnyxNumberCard({ configured }: { configured: boolean }) {
  const numbers = useTelnyxNumbers(configured);
  const telecallers = useTelecallers({ limit: 200 });
  const assign = useSetTelecallerTelnyxNumber();
  const [savingId, setSavingId] = useState<string | null>(null);

  const users = telecallers.data?.data ?? [];
  const numberList = numbers.data ?? [];

  function handleAssign(id: string, telnyxNumber: string) {
    setSavingId(id);
    assign.mutate(
      { id, telnyxNumber },
      {
        onSuccess: () => toast.success(telnyxNumber ? 'Number assigned' : 'Number cleared'),
        onError: (e) => toast.error(apiError(e)),
        onSettled: () => setSavingId(null),
      }
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <span className="rounded-xl border border-gray-200 bg-gray-50 p-2 text-gray-600 dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-300">
          <UsersIcon size={18} />
        </span>
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Telnyx caller numbers</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Each telecaller dials from the number you assign here. No number means no Telnyx calling for them.
          </p>
        </div>
      </div>

      {!configured ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Save a valid API key and credential connection above first to load your numbers.
        </p>
      ) : numbers.isLoading || telecallers.isLoading ? (
        <Spinner />
      ) : numbers.isError ? (
        <p className="text-sm text-rose-600">{apiError(numbers.error)}</p>
      ) : numberList.length === 0 ? (
        <p className="text-sm text-amber-600">
          No active numbers on this Telnyx account. Buy one in the Telnyx portal under Numbers.
        </p>
      ) : users.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No telecallers yet. Add users first.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {users.map((u) => {
            const known = numberList.some((n) => n.phoneNumber === u.telnyxNumber);
            return (
              <div
                key={u._id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{u.name}</p>
                  <p className="truncate text-xs text-gray-400 dark:text-gray-500">{u.email}</p>
                </div>
                <Select
                  className="w-full sm:w-72"
                  value={u.telnyxNumber ?? ''}
                  disabled={savingId === u._id}
                  onChange={(e) => handleAssign(u._id, e.target.value)}
                >
                  <option value="">— Not assigned —</option>
                  {!known && u.telnyxNumber && <option value={u.telnyxNumber}>{u.telnyxNumber} (current)</option>}
                  {numberList.map((n) => (
                    <option key={n.phoneNumber} value={n.phoneNumber}>
                      {n.phoneNumber}
                      {n.onConnection ? '' : n.connectionName ? ` (on ${n.connectionName})` : ' (no connection)'}
                    </option>
                  ))}
                </Select>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/**
 * Admin panel for the Telnyx calling backend. Everything the integration needs is
 * entered here — no env vars. The browser softphone logs in with short-lived
 * tokens the server mints per user, so no SIP password is ever handed out.
 */
export function TelnyxPanel() {
  const { data, isLoading } = useTelnyxIntegration();
  const update = useUpdateTelnyxIntegration();
  const loadConnections = useTelnyxConnections();
  const applyWebhook = useApplyTelnyxWebhook();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [connections, setConnections] = useState<TelnyxConnection[] | null>(null);

  useEffect(() => {
    if (data) {
      setForm({
        enabled: data.enabled,
        recordCalls: data.recordCalls,
        apiKey: '',
        connectionId: data.connectionId,
        publicKey: data.publicKey,
        callerId: data.callerId,
        defaultCountryCode: data.defaultCountryCode,
        publicServerUrl: data.publicServerUrl,
      });
    }
  }, [data]);

  // With a key already saved, fill the connection picker straight away.
  const apiKeySet = data?.apiKeySet ?? false;
  useEffect(() => {
    if (!apiKeySet || connections) return;
    loadConnections.mutate(undefined, { onSuccess: setConnections });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeySet]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** Check the typed (or saved) API key and list its credential connections. */
  function handleTestKey() {
    loadConnections.mutate(form.apiKey || undefined, {
      onSuccess: (list) => {
        setConnections(list);
        if (list.length === 0) {
          toast.error('Key works, but this account has no credential connections yet. Create one in Telnyx first.', {
            duration: 8000,
          });
          return;
        }
        toast.success(`Key works: ${list.length} connection${list.length === 1 ? '' : 's'} found`);
        // One connection and nothing chosen yet: pick it for them.
        if (!form.connectionId && list.length === 1) set('connectionId', list[0].id);
      },
      onError: (e) => toast.error(apiError(e), { duration: 8000 }),
    });
  }

  async function handleSave() {
    const payload: TelnyxIntegrationUpdate = {
      enabled: form.enabled,
      recordCalls: form.recordCalls,
      connectionId: form.connectionId,
      publicKey: form.publicKey.trim(),
      callerId: form.callerId.trim(),
      defaultCountryCode: form.defaultCountryCode.trim(),
      publicServerUrl: form.publicServerUrl.trim(),
    };
    // Blank key = keep the stored one.
    if (form.apiKey) payload.apiKey = form.apiKey.trim();
    try {
      await update.mutateAsync(payload);
      setForm((f) => ({ ...f, apiKey: '' }));
      toast.success('Telnyx settings saved');
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  function handleApplyWebhook() {
    applyWebhook.mutate(undefined, {
      onSuccess: (res) => {
        toast.success('Webhook set on the connection');
        setConnections((list) =>
          list ? list.map((c) => (c.id === res.connectionId ? { ...c, webhookUrl: res.webhookUrl } : c)) : list
        );
      },
      onError: (e) => toast.error(apiError(e), { duration: 8000 }),
    });
  }

  function copy(text: string) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => toast.success('Copied')).catch(() => toast.error('Copy failed'));
  }

  if (isLoading) {
    return (
      <Card className="p-6">
        <Spinner />
      </Card>
    );
  }

  const selected = connections?.find((c) => c.id === form.connectionId);
  const savedConnection = data?.connectionId ?? '';
  const webhookUrl = data?.webhookUrl ?? '';
  const webhookApplied = Boolean(selected && webhookUrl && selected.webhookUrl === webhookUrl);
  // The picker needs the list; until it loads, keep a saved id selectable.
  const connectionOptions: TelnyxConnection[] = connections ?? [];
  const showSavedFallback = Boolean(form.connectionId) && !connectionOptions.some((c) => c.id === form.connectionId);

  return (
    <>
      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-xl border border-gray-200 bg-gray-50 p-2 text-brand-600 dark:border-gray-800 dark:bg-gray-800/60 dark:text-brand-300">
              <Radio size={20} />
            </span>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">Telnyx — Browser calling</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Call leads from the browser through Telnyx. Works alongside Twilio and TeleCMI; each telecaller picks one.
              </p>
            </div>
          </div>
          {data?.configured ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <CheckCircle2 size={13} className="mr-1 inline" /> Configured
            </Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              <AlertCircle size={13} className="mr-1 inline" /> Incomplete
            </Badge>
          )}
        </div>

        {/* One-time setup in the Telnyx portal — the only part that can't happen here. */}
        <details className="rounded-2xl border border-gray-200 p-4 text-sm dark:border-gray-800">
          <summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-200">
            First time? Setup in the Telnyx portal (about 5 minutes)
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs text-gray-600 dark:text-gray-400">
            <li>
              <strong>Outbound Voice Profile:</strong> Voice → Outbound Voice Profiles → create one and allow the
              countries you call.
            </li>
            <li>
              <strong>Credential connection:</strong> Voice → SIP Trunking → Create SIP Connection, type{' '}
              <strong>Credentials</strong>. Under Outbound, pick the profile from step 1. Leave “Park outbound calls” off.
            </li>
            <li>
              <strong>Numbers:</strong> Numbers → My Numbers → set each number’s connection to the one from step 2.
            </li>
            <li>
              <strong>API key:</strong> Account → Keys &amp; Credentials → API Keys → create a key, paste it below and
              press <em>Test key</em>.
            </li>
            <li>
              <strong>Public key:</strong> Account → Keys &amp; Credentials → Public Key → copy it below. It lets the
              server check that call events really come from Telnyx.
            </li>
            <li>
              Save, then press <em>Set webhook on connection</em>. Recording and “why did it fail” both depend on it.
            </li>
          </ol>
        </details>

        <div className="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Enable Telnyx calling</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Makes Telnyx available to telecallers who have a Telnyx number assigned.
              </p>
            </div>
            <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Enable Telnyx calling" />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3 dark:border-gray-800">
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Record calls</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Recording starts when the lead answers. Needs the webhook below.
              </p>
            </div>
            <Toggle checked={form.recordCalls} onChange={(v) => set('recordCalls', v)} label="Record Telnyx calls" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>
              API key (v2) {data?.apiKeySet && <span className="text-emerald-600">(saved)</span>}
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(e) => set('apiKey', e.target.value)}
                placeholder={data?.apiKeySet ? 'Leave blank to keep the saved key' : 'KEY01…'}
              />
              <Button
                variant="secondary"
                className="shrink-0"
                onClick={handleTestKey}
                loading={loadConnections.isPending}
                disabled={!form.apiKey && !data?.apiKeySet}
              >
                <KeyRound size={14} /> Test key
              </Button>
            </div>
          </div>

          <div className="sm:col-span-2">
            <Label>Credential connection</Label>
            <Select value={form.connectionId} onChange={(e) => set('connectionId', e.target.value)}>
              <option value="">{connections ? '— Choose a connection —' : 'Test the key to load connections'}</option>
              {showSavedFallback && <option value={form.connectionId}>{form.connectionId} (saved)</option>}
              {connectionOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.id}
                  {c.active ? '' : ' (inactive)'}
                </option>
              ))}
            </Select>
            {selected && !selected.hasOutboundProfile && (
              <p className="mt-1 text-[11px] text-amber-600">
                This connection has no Outbound Voice Profile, so calls from it will fail. Assign one in Telnyx.
              </p>
            )}
            {selected && !selected.active && (
              <p className="mt-1 text-[11px] text-amber-600">This connection is inactive in Telnyx.</p>
            )}
          </div>

          <div className="sm:col-span-2">
            <Label>Webhook public key</Label>
            <Input
              value={form.publicKey}
              onChange={(e) => set('publicKey', e.target.value)}
              placeholder="Base64 key from Keys & Credentials → Public Key"
              autoComplete="off"
            />
          </div>

          <div>
            <Label>Default caller number (admin / fallback)</Label>
            <Input value={form.callerId} onChange={(e) => set('callerId', e.target.value)} placeholder="+14155551234" />
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              Used by superadmins. Telecallers always dial from their own assigned number.
            </p>
          </div>
          <div>
            <Label>Default country code</Label>
            <Input
              value={form.defaultCountryCode}
              onChange={(e) => set('defaultCountryCode', e.target.value)}
              placeholder="+91"
            />
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              Added to numbers typed without one.
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label>Public server URL</Label>
            <Input
              value={form.publicServerUrl}
              onChange={(e) => set('publicServerUrl', e.target.value)}
              placeholder="https://your-server.example.com (blank = server default)"
            />
          </div>
        </div>

        {/* Where Telnyx sends call events, and a one-click way to set it. */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/40">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Webhook URL</Label>
            {webhookApplied ? (
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <CheckCircle2 size={13} className="mr-1 inline" /> Set on connection
              </Badge>
            ) : selected ? (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                Not set on this connection
              </Badge>
            ) : null}
          </div>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input readOnly value={webhookUrl || 'Set a public server URL first'} />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => copy(webhookUrl)} disabled={!webhookUrl} aria-label="Copy webhook URL">
                <Copy size={15} />
              </Button>
              <Button
                variant="secondary"
                className="flex-1 sm:flex-none"
                onClick={handleApplyWebhook}
                loading={applyWebhook.isPending}
                disabled={!webhookUrl || !savedConnection || !data?.apiKeySet}
              >
                <Link2 size={14} /> Set webhook on connection
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
            Save first. This sets the saved connection’s webhook to this URL (API v2). Without it calls still work, but
            there are no recordings and failed calls show no reason.
            {!data?.publicKey && ' The public key is also needed, or the server rejects the events.'}
          </p>
        </div>

        <div className="flex sm:justify-end">
          <Button className="w-full sm:w-auto" onClick={handleSave} loading={update.isPending}>
            Save Telnyx settings
          </Button>
        </div>
      </Card>

      <TelnyxNumberCard configured={data?.configured ?? false} />
    </>
  );
}
