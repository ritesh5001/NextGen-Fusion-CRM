import { useEffect, useState } from 'react';
import { Bot, Copy, CheckCircle2, AlertCircle, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useBolnaIntegration,
  useUpdateBolnaIntegration,
  useBolnaAgents,
  type BolnaAgent,
  type BolnaIntegrationUpdate,
} from '@/api/aiCalls';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Field';
import { Badge, Card, Spinner, Toggle } from '@/components/ui/Misc';

interface FormState {
  enabled: boolean;
  apiKey: string;
  agentId: string;
  callerId: string;
  maxConcurrent: number;
  defaultCountryCode: string;
  publicServerUrl: string;
}

const EMPTY: FormState = {
  enabled: false,
  apiKey: '',
  agentId: '',
  callerId: '',
  maxConcurrent: 3,
  defaultCountryCode: '',
  publicServerUrl: '',
};

/** Sample agent prompt — the agent asks one yes/no question about the service. */
const SAMPLE_PROMPT = `You are Priya, a friendly caller from NextGen Fusion. You are calling {customer_name}.
Introduce yourself in one sentence, then briefly explain our service: {service}
Then ask clearly: "Would you be interested in this service — yes or no?"
- If YES: thank them, ask for their name and email (if not known) and say our team will contact them shortly.
- If NO: thank them politely and end the call.
- If they are busy: ask when to call back, thank them and end the call.
Keep every reply short (1-2 sentences). Never argue. Speak in the language the person uses.`;

function copy(text: string) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast.success('Copied')).catch(() => toast.error('Copy failed'));
}

/**
 * Admin panel for Bolna AI voice agents — automated lead-generation calling.
 * The agent itself (voice, prompt, telephony) is built in the Bolna dashboard;
 * here we store the API key, pick the agent and hand out the webhook URL.
 */
export function BolnaPanel() {
  const { data, isLoading } = useBolnaIntegration();
  const update = useUpdateBolnaIntegration();
  const loadAgents = useBolnaAgents();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [agents, setAgents] = useState<BolnaAgent[] | null>(null);

  useEffect(() => {
    if (data) {
      setForm({
        enabled: data.enabled,
        apiKey: '',
        agentId: data.agentId,
        callerId: data.callerId,
        maxConcurrent: data.maxConcurrent,
        defaultCountryCode: data.defaultCountryCode,
        publicServerUrl: data.publicServerUrl,
      });
    }
  }, [data]);

  const apiKeySet = data?.apiKeySet ?? false;
  useEffect(() => {
    if (!apiKeySet || agents) return;
    loadAgents.mutate(undefined, { onSuccess: setAgents });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKeySet]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleTestKey() {
    loadAgents.mutate(form.apiKey || undefined, {
      onSuccess: (list) => {
        setAgents(list);
        if (!list.length) {
          toast.error('Key works, but there are no agents yet. Create one in the Bolna dashboard first.', {
            duration: 8000,
          });
          return;
        }
        toast.success(`Key works: ${list.length} agent${list.length === 1 ? '' : 's'} found`);
        if (!form.agentId && list.length === 1) set('agentId', list[0].id);
      },
      onError: (e) => toast.error(apiError(e), { duration: 8000 }),
    });
  }

  async function handleSave() {
    const payload: BolnaIntegrationUpdate = {
      enabled: form.enabled,
      agentId: form.agentId.trim(),
      callerId: form.callerId.trim(),
      maxConcurrent: Number(form.maxConcurrent) || 1,
      defaultCountryCode: form.defaultCountryCode.trim(),
      publicServerUrl: form.publicServerUrl.trim(),
    };
    if (form.apiKey) payload.apiKey = form.apiKey.trim();
    try {
      await update.mutateAsync(payload);
      setForm((f) => ({ ...f, apiKey: '' }));
      toast.success('Bolna settings saved');
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  if (isLoading) {
    return (
      <Card className="p-6">
        <Spinner />
      </Card>
    );
  }

  const agentOptions = agents ?? [];
  const showSavedAgent = Boolean(form.agentId) && !agentOptions.some((a) => a.id === form.agentId);

  return (
    <Card className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-xl border border-gray-200 bg-gray-50 p-2 text-brand-600 dark:border-gray-800 dark:bg-gray-800/60 dark:text-brand-300">
            <Bot size={20} />
          </span>
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Bolna AI — Automated calling</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              An AI voice agent calls your numbers, asks if they want your service, and saves the interested ones as
              leads.
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

      <details className="rounded-2xl border border-gray-200 p-4 text-sm dark:border-gray-800">
        <summary className="cursor-pointer font-medium text-gray-800 dark:text-gray-200">
          First time? Setup in the Bolna dashboard (about 10 minutes)
        </summary>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-xs text-gray-600 dark:text-gray-400">
          <li>
            <strong>Create an agent</strong> at platform.bolna.ai → Agents → New agent. Pick a voice and language. Use
            a prompt like this one — <code>{'{customer_name}'}</code> and <code>{'{service}'}</code> are filled in by
            the CRM for every call (the campaign's “What are you offering?” text goes into{' '}
            <code>{'{service}'}</code>):
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-[11px] text-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
              {SAMPLE_PROMPT}
            </pre>
            <Button size="sm" variant="secondary" className="mt-1" onClick={() => copy(SAMPLE_PROMPT)}>
              <Copy size={13} /> Copy prompt
            </Button>
          </li>
          <li>
            <strong>Extraction</strong> (agent → Analytics tab → Extraction): paste this. The CRM reads the{' '}
            <code>interested</code> answer to decide who becomes a lead.
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-[11px] text-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
              {data?.extractionPrompt}
            </pre>
            <Button
              size="sm"
              variant="secondary"
              className="mt-1"
              onClick={() => copy(data?.extractionPrompt ?? '')}
            >
              <Copy size={13} /> Copy extraction prompt
            </Button>
          </li>
          <li>
            <strong>Webhook</strong> (same Analytics tab → Webhook URL): paste the URL shown below so results arrive
            the moment a call ends. Without it the CRM still works — it checks each call with Bolna after ~90
            seconds.
          </li>
          <li>
            <strong>Phone number:</strong> buy or connect one under Phone numbers and attach it to the agent (or enter
            it below as the “from” number).
          </li>
          <li>
            <strong>API key:</strong> Developers → API keys → create one, paste it below and press <em>Test key</em>.
          </li>
        </ol>
      </details>

      <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
        <div>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">Enable AI calling</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Running campaigns only dial while this is on. Switch off to stop all AI calls at once.
          </p>
        </div>
        <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)} label="Enable AI calling" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>API key {apiKeySet && <span className="text-emerald-600">(saved)</span>}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
              placeholder={apiKeySet ? 'Leave blank to keep the saved key' : 'bn-…'}
            />
            <Button
              variant="secondary"
              className="w-full shrink-0 sm:w-auto"
              onClick={handleTestKey}
              loading={loadAgents.isPending}
              disabled={!form.apiKey && !apiKeySet}
            >
              <KeyRound size={15} /> Test key
            </Button>
          </div>
        </div>

        <div className="sm:col-span-2">
          <Label>Agent</Label>
          {agentOptions.length || showSavedAgent ? (
            <Select value={form.agentId} onChange={(e) => set('agentId', e.target.value)}>
              <option value="">— Choose an agent —</option>
              {showSavedAgent && <option value={form.agentId}>{form.agentId} (saved)</option>}
              {agentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.status ? ` · ${a.status}` : ''}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={form.agentId}
              onChange={(e) => set('agentId', e.target.value)}
              placeholder="Test the key to pick from your agents, or paste an agent id"
            />
          )}
        </div>

        <div>
          <Label>From number (optional)</Label>
          <Input
            value={form.callerId}
            onChange={(e) => set('callerId', e.target.value)}
            placeholder="+918035737000 — blank = agent's default"
          />
        </div>
        <div>
          <Label>Calls at the same time</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={form.maxConcurrent}
            onChange={(e) => set('maxConcurrent', Number(e.target.value))}
          />
        </div>
        <div>
          <Label>Default country code</Label>
          <Input
            value={form.defaultCountryCode}
            onChange={(e) => set('defaultCountryCode', e.target.value)}
            placeholder="+91"
          />
          <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            Added to numbers you paste without one (e.g. 9876543210).
          </p>
        </div>
        <div>
          <Label>Public server URL</Label>
          <Input
            value={form.publicServerUrl}
            onChange={(e) => set('publicServerUrl', e.target.value)}
            placeholder="https://api.yourdomain.com"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
        <Label>Webhook URL (paste into the agent's Analytics tab)</Label>
        {data?.webhookUrl ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={data.webhookUrl} className="font-mono text-xs" />
            <Button variant="secondary" className="w-full shrink-0 sm:w-auto" onClick={() => copy(data.webhookUrl)}>
              <Copy size={14} /> Copy
            </Button>
          </div>
        ) : (
          <p className="text-xs text-amber-600">Set the public server URL and save to get the webhook URL.</p>
        )}
        <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
          Keep it private — the token in it is what proves a callback came from your Bolna account.
        </p>
      </div>

      <div className="flex sm:justify-end">
        <Button className="w-full sm:w-auto" onClick={handleSave} loading={update.isPending}>
          Save settings
        </Button>
      </div>
    </Card>
  );
}
