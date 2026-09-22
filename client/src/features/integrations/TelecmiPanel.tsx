import { useEffect, useState } from 'react';
import { PhoneCall, Copy, CheckCircle2, AlertCircle, Users as UsersIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useTelecmiIntegration,
  useUpdateTelecmiIntegration,
  useDetectTelecmiRegion,
  type TelecmiIntegrationUpdate,
} from '@/api/integrations';
import { useTelecallers, useSetTelecallerTelecmi } from '@/api/users';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { Badge, Card, Spinner, Toggle } from '@/components/ui/Misc';

interface FormState {
  enabled: boolean;
  recordCalls: boolean;
  appId: string;
  sbcUri: string;
  apiRegion: 'india' | 'global';
  defaultCountryCode: string;
  publicServerUrl: string;
  apiSecret: string;
}

/**
 * The SBC regions TeleCMI exposes. The server sends this list too, but keeping a
 * local copy means the dropdown is still usable if that request fails — otherwise
 * the admin is left with an empty select and no way to pick a region.
 */
const FALLBACK_SBC_REGIONS = [
  { uri: 'sbcind.telecmi.com', label: 'India' },
  { uri: 'sbcus.telecmi.com', label: 'America' },
  { uri: 'sbcuk.telecmi.com', label: 'Europe' },
  { uri: 'sbcsg.telecmi.com', label: 'Asia (Singapore)' },
];

const DEFAULT_SBC_URI = 'sbcind.telecmi.com';

const EMPTY: FormState = {
  enabled: false,
  recordCalls: true,
  appId: '',
  sbcUri: DEFAULT_SBC_URI,
  apiRegion: 'india',
  defaultCountryCode: '',
  publicServerUrl: '',
  apiSecret: '',
};

/**
 * Assign each telecaller their TeleCMI agent. The agent id comes from the TeleCMI
 * dashboard (e.g. `103_1111113`); the password is write-only — once saved it's
 * never sent back, so a blank field means "leave it as it is".
 */
function AgentAssignmentCard() {
  const telecallers = useTelecallers({ limit: 200 });
  const assign = useSetTelecallerTelecmi();
  const [drafts, setDrafts] = useState<Record<string, { id: string; password: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const users = telecallers.data?.data ?? [];

  function draftFor(userId: string, current: string) {
    return drafts[userId] ?? { id: current, password: '' };
  }

  function save(userId: string, current: string) {
    const draft = draftFor(userId, current);
    setSavingId(userId);
    assign.mutate(
      { id: userId, telecmiUserId: draft.id.trim(), telecmiPassword: draft.password || undefined },
      {
        onSuccess: () => {
          toast.success(draft.id.trim() ? 'TeleCMI agent assigned' : 'TeleCMI agent cleared');
          // Drop the draft so the row re-reads the saved value.
          setDrafts((d) => {
            const next = { ...d };
            delete next[userId];
            return next;
          });
        },
        onError: (e) => toast.error(apiError(e)),
        onSettled: () => setSavingId(null),
      }
    );
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center gap-3">
        <span className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <UsersIcon size={18} />
        </span>
        <div>
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">TeleCMI agents</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Each telecaller needs their own TeleCMI agent to call. Passwords are stored write-only.
          </p>
        </div>
      </div>

      {telecallers.isLoading ? (
        <Spinner />
      ) : users.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No telecallers yet. Add users first.</p>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {users.map((u) => {
            const current = u.telecmiUserId ?? '';
            const draft = draftFor(u._id, current);
            const dirty = draft.id !== current || draft.password !== '';
            return (
              <div key={u._id} className="flex flex-col gap-2 py-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{u.name}</p>
                  <p className="truncate text-xs text-slate-400 dark:text-slate-500">{u.email}</p>
                </div>
                <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
                  <div>
                    <Label>Agent id</Label>
                    <Input
                      className="sm:w-40"
                      placeholder="103_1111113"
                      value={draft.id}
                      onChange={(e) => setDrafts((d) => ({ ...d, [u._id]: { ...draft, id: e.target.value } }))}
                    />
                  </div>
                  <div>
                    <Label>Password</Label>
                    <Input
                      className="sm:w-40"
                      type="password"
                      placeholder={current ? '•••••••• (saved)' : 'Agent password'}
                      value={draft.password}
                      onChange={(e) => setDrafts((d) => ({ ...d, [u._id]: { ...draft, password: e.target.value } }))}
                    />
                  </div>
                  <Button
                    className="col-span-2"
                    variant="secondary"
                    disabled={!dirty || savingId === u._id}
                    onClick={() => save(u._id, current)}
                  >
                    {savingId === u._id ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/**
 * Admin panel for the TeleCMI calling backend — the cloud phone system managed
 * from the Connle dashboard (connle.telecmi.com), where the App ID, API secret and
 * per-agent users all come from.
 */
export function TelecmiPanel() {
  const { data, isLoading } = useTelecmiIntegration();
  const update = useUpdateTelecmiIntegration();
  const detect = useDetectTelecmiRegion();
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (data) {
      setForm({
        enabled: data.enabled,
        recordCalls: data.recordCalls,
        appId: data.appId,
        // Never leave the select on a blank value — it would save an empty region.
        sbcUri: data.sbcUri || DEFAULT_SBC_URI,
        apiRegion: data.apiRegion || 'india',
        defaultCountryCode: data.defaultCountryCode,
        publicServerUrl: data.publicServerUrl,
        apiSecret: '',
      });
    }
  }, [data]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    const payload: TelecmiIntegrationUpdate = {
      enabled: form.enabled,
      recordCalls: form.recordCalls,
      appId: form.appId,
      sbcUri: form.sbcUri,
      apiRegion: form.apiRegion,
      defaultCountryCode: form.defaultCountryCode,
      publicServerUrl: form.publicServerUrl,
    };
    // Blank secret = keep the stored one.
    if (form.apiSecret) payload.apiSecret = form.apiSecret;
    try {
      await update.mutateAsync(payload);
      setForm((f) => ({ ...f, apiSecret: '' }));
      toast.success('TeleCMI settings saved');
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  /** Ask TeleCMI which platform these credentials belong to, and select it. */
  function handleDetect() {
    detect.mutate(
      { appId: form.appId, apiSecret: form.apiSecret || undefined },
      {
        onSuccess: (res) => {
          if (res.region) {
            set('apiRegion', res.region);
            toast.success(`Your account is on ${res.region === 'india' ? 'India (chub-india)' : 'Global (chub)'} — selected. Save to apply.`);
          } else if (res.ambiguous) {
            // Credentials work on both and neither has call history to tell them
            // apart — say so rather than silently picking one.
            toast.error(
              'Both platforms accept these credentials and neither shows any calls yet, so the region ' +
                'is ambiguous. Place one test call from the TeleCMI app, then press this again.',
              { duration: 10000 }
            );
          } else {
            // Neither accepted the credentials — report what each said.
            const detail = res.tried.map((t) => `${t.region}: ${t.detail}`).join(' · ');
            toast.error(`Neither platform accepted these credentials. ${detail}`, { duration: 8000 });
          }
        },
        onError: (e) => toast.error(apiError(e)),
      }
    );
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
    <>
      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-indigo-100 p-2 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
              <PhoneCall size={20} />
            </span>
            <div>
              <h2 className="font-semibold text-slate-800 dark:text-slate-100">TeleCMI — Browser calling</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Alternative calling backend. Telecallers can dial from the browser or have TeleCMI ring their phone.
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

        <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Enable TeleCMI calling</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Makes TeleCMI selectable by telecallers who have an agent assigned.
              </p>
            </div>
            <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Record calls</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Recordings are fetched back through the server, so credentials never reach the browser.
              </p>
            </div>
            <Toggle checked={form.recordCalls} onChange={(v) => set('recordCalls', v)} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>App ID</Label>
            <Input value={form.appId} onChange={(e) => set('appId', e.target.value)} placeholder="1111113" />
          </div>
          <div>
            <Label>API secret {data?.apiSecretSet && <span className="text-emerald-600">(saved)</span>}</Label>
            <Input
              type="password"
              value={form.apiSecret}
              onChange={(e) => set('apiSecret', e.target.value)}
              placeholder={data?.apiSecretSet ? 'Leave blank to keep current' : 'xx-xx'}
            />
          </div>
          <div>
            <Label>API platform</Label>
            <Select
              value={form.apiRegion}
              onChange={(e) => set('apiRegion', e.target.value as 'india' | 'global')}
            >
              {(data?.apiRegions?.length
                ? data.apiRegions
                : [
                    { id: 'india', label: 'India (chub-india)' },
                    { id: 'global', label: 'Global (chub)' },
                  ]
              ).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
            <div className="mt-1 flex items-center gap-2">
              <Button variant="secondary" onClick={handleDetect} disabled={detect.isPending || !form.appId}>
                {detect.isPending ? 'Testing…' : 'Test & detect'}
              </Button>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Every API endpoint differs between the two. Enter your App ID + secret and press this to
                find out which one your account is on.
              </p>
            </div>
          </div>
          <div>
            <Label>SBC region</Label>
            <Select value={form.sbcUri} onChange={(e) => set('sbcUri', e.target.value)}>
              {(data?.sbcRegions?.length ? data.sbcRegions : FALLBACK_SBC_REGIONS).map((r) => (
                <option key={r.uri} value={r.uri}>
                  {r.label} — {r.uri}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Default country code</Label>
            <Input
              value={form.defaultCountryCode}
              onChange={(e) => set('defaultCountryCode', e.target.value)}
              placeholder="+91"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Public server URL</Label>
            <Input
              value={form.publicServerUrl}
              onChange={(e) => set('publicServerUrl', e.target.value)}
              placeholder="https://your-server.example.com"
            />
          </div>
        </div>

        {/* The one URL the admin has to paste into the PIOPIY dashboard. */}
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <Label>CDR webhook URL</Label>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            In the TeleCMI dashboard (Connle) go to <strong>Settings → Webhooks</strong>, pick your business
            number, click add, set the type to <strong>call report</strong> and the method to <strong>POST</strong>,
            then paste this URL. Call records and recordings arrive here when a call ends.
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={data?.cdrWebhookUrl || 'Set a public server URL first'} />
            <Button variant="secondary" onClick={() => copy(data?.cdrWebhookUrl ?? '')}>
              <Copy size={15} />
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save TeleCMI settings'}
          </Button>
        </div>
      </Card>

      <AgentAssignmentCard />
    </>
  );
}
