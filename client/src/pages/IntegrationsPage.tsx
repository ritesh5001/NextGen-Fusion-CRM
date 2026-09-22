import { useEffect, useState } from 'react';
import { Phone, Copy, CheckCircle2, AlertCircle, Users as UsersIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useTwilioIntegration,
  useUpdateTwilioIntegration,
  useTwilioNumbers,
  type TwilioIntegrationUpdate,
} from '@/api/integrations';
import { useTelecallers, useSetTelecallerTwilioNumber } from '@/api/users';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { Badge, Card, Spinner, Toggle } from '@/components/ui/Misc';
import { TelecmiPanel } from '@/features/integrations/TelecmiPanel';

interface FormState {
  enabled: boolean;
  recordCalls: boolean;
  accountSid: string;
  apiKeySid: string;
  twimlAppSid: string;
  callerId: string;
  defaultCountryCode: string;
  publicServerUrl: string;
  authToken: string;
  apiKeySecret: string;
}

const EMPTY: FormState = {
  enabled: false,
  recordCalls: true,
  accountSid: '',
  apiKeySid: '',
  twimlAppSid: '',
  callerId: '',
  defaultCountryCode: '',
  publicServerUrl: '',
  authToken: '',
  apiKeySecret: '',
};

/** Assign a Twilio number (caller ID) to each telecaller. */
function NumberAssignmentCard({ configured }: { configured: boolean }) {
  const numbers = useTwilioNumbers(configured);
  const telecallers = useTelecallers({ limit: 200 });
  const assign = useSetTelecallerTwilioNumber();
  const [savingId, setSavingId] = useState<string | null>(null);

  const users = telecallers.data?.data ?? [];
  const numberList = numbers.data ?? [];

  function handleAssign(id: string, twilioNumber: string) {
    setSavingId(id);
    assign.mutate(
      { id, twilioNumber },
      {
        onSuccess: () => toast.success(twilioNumber ? 'Number assigned' : 'Number cleared'),
        onError: (e) => toast.error(apiError(e)),
        onSettled: () => setSavingId(null),
      }
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-brand-100 p-2 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
          <UsersIcon size={20} />
        </span>
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-100">Caller numbers</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Assign a Twilio number to each telecaller — they'll dial leads from that number.
          </p>
        </div>
      </div>

      {!configured ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Save valid Twilio credentials above first to load your numbers.
        </p>
      ) : numbers.isLoading || telecallers.isLoading ? (
        <Spinner />
      ) : numberList.length === 0 ? (
        <p className="text-sm text-amber-600">
          No voice-capable numbers found on your Twilio account. Buy a number in the Twilio console.
        </p>
      ) : users.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No telecallers yet. Add users first.</p>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {users.map((u) => {
            // Keep a stale/unknown assigned number visible as an option.
            const known = numberList.some((n) => n.phoneNumber === u.twilioNumber);
            return (
              <div key={u._id} className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{u.name}</p>
                  <p className="truncate text-xs text-slate-400 dark:text-slate-500">{u.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    className="w-full sm:w-56"
                    value={u.twilioNumber ?? ''}
                    disabled={savingId === u._id}
                    onChange={(e) => handleAssign(u._id, e.target.value)}
                  >
                    <option value="">— Not assigned —</option>
                    {!known && u.twilioNumber && <option value={u.twilioNumber}>{u.twilioNumber} (current)</option>}
                    {numberList.map((n) => (
                      <option key={n.phoneNumber} value={n.phoneNumber}>
                        {n.friendlyName === n.phoneNumber ? n.phoneNumber : `${n.friendlyName} (${n.phoneNumber})`}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export function IntegrationsPage() {
  const { data, isLoading } = useTwilioIntegration();
  const update = useUpdateTwilioIntegration();
  const [form, setForm] = useState<FormState>(EMPTY);

  // Hydrate the form once settings load. Secrets stay blank (already-set is shown
  // via the placeholder); typing a new value replaces them.
  useEffect(() => {
    if (data) {
      setForm({
        enabled: data.enabled,
        recordCalls: data.recordCalls,
        accountSid: data.accountSid,
        apiKeySid: data.apiKeySid,
        twimlAppSid: data.twimlAppSid,
        callerId: data.callerId,
        defaultCountryCode: data.defaultCountryCode,
        publicServerUrl: data.publicServerUrl,
        authToken: '',
        apiKeySecret: '',
      });
    }
  }, [data]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    const payload: TwilioIntegrationUpdate = {
      enabled: form.enabled,
      recordCalls: form.recordCalls,
      accountSid: form.accountSid,
      apiKeySid: form.apiKeySid,
      twimlAppSid: form.twimlAppSid,
      callerId: form.callerId,
      defaultCountryCode: form.defaultCountryCode.trim(),
      publicServerUrl: form.publicServerUrl,
    };
    if (form.authToken) payload.authToken = form.authToken;
    if (form.apiKeySecret) payload.apiKeySecret = form.apiKeySecret;
    try {
      await update.mutateAsync(payload);
      toast.success('Twilio settings saved');
      setForm((f) => ({ ...f, authToken: '', apiKeySecret: '' }));
    } catch (e) {
      toast.error(apiError(e));
    }
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Integrations</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Connect third-party services. Credentials are stored securely and never shown again.
        </p>
      </div>

      <Card className="space-y-5 p-5">
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-brand-100 p-2 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
              <Phone size={20} />
            </span>
            <div>
              <h2 className="font-semibold text-slate-800 dark:text-slate-100">Twilio — Browser calling</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Place calls to leads directly from the browser (WebRTC softphone).
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

        {/* Toggles */}
        <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Enable calling</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Turn the in-app dialer on. When off, Call buttons use the phone's native dialer.
              </p>
            </div>
            <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Record calls</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Store a recording of each call and attach it to the call log.
              </p>
            </div>
            <Toggle checked={form.recordCalls} onChange={(v) => set('recordCalls', v)} />
          </div>
        </div>

        {/* Credentials */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Account SID</Label>
            <Input
              value={form.accountSid}
              onChange={(e) => set('accountSid', e.target.value)}
              placeholder="AC…"
            />
          </div>
          <div>
            <Label>Auth Token</Label>
            <Input
              type="password"
              value={form.authToken}
              onChange={(e) => set('authToken', e.target.value)}
              placeholder={data?.authTokenSet ? '•••••••• (saved — leave blank to keep)' : 'Enter auth token'}
            />
          </div>
          <div>
            <Label>API Key SID</Label>
            <Input value={form.apiKeySid} onChange={(e) => set('apiKeySid', e.target.value)} placeholder="SK…" />
          </div>
          <div>
            <Label>API Key Secret</Label>
            <Input
              type="password"
              value={form.apiKeySecret}
              onChange={(e) => set('apiKeySecret', e.target.value)}
              placeholder={data?.apiKeySecretSet ? '•••••••• (saved — leave blank to keep)' : 'Enter API key secret'}
            />
          </div>
          <div>
            <Label>TwiML App SID</Label>
            <Input
              value={form.twimlAppSid}
              onChange={(e) => set('twimlAppSid', e.target.value)}
              placeholder="AP…"
            />
          </div>
          <div>
            <Label>Default caller ID (admin / fallback number)</Label>
            <Input
              value={form.callerId}
              onChange={(e) => set('callerId', e.target.value)}
              placeholder="+14155551234"
            />
          </div>
          <div>
            <Label>Default country code</Label>
            <Input
              value={form.defaultCountryCode}
              onChange={(e) => set('defaultCountryCode', e.target.value)}
              placeholder="+91"
            />
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              Added to dialled numbers that have no country code (used when a contact's country is unknown).
            </p>
          </div>
          <div className="sm:col-span-2">
            <Label>Public server URL (for webhooks)</Label>
            <Input
              value={form.publicServerUrl}
              onChange={(e) => set('publicServerUrl', e.target.value)}
              placeholder="https://your-server.com (leave blank to use the server default)"
            />
          </div>
        </div>

        {/* Setup hint */}
        {data?.voiceWebhookUrl && (
          <div className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
            <p className="font-medium text-slate-700 dark:text-slate-200">Twilio setup</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              In your Twilio TwiML App, set the <span className="font-medium">Voice Request URL (POST)</span> to:
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {data.voiceWebhookUrl}
              </code>
              <Button size="sm" variant="secondary" className="shrink-0" onClick={() => copy(data.voiceWebhookUrl)}>
                <Copy size={14} /> Copy
              </Button>
            </div>
          </div>
        )}

        <div className="flex sm:justify-end">
          <Button className="w-full sm:w-auto" onClick={handleSave} loading={update.isPending}>
            Save settings
          </Button>
        </div>
      </Card>

      <NumberAssignmentCard configured={data?.configured ?? false} />

      <TelecmiPanel />
    </div>
  );
}
