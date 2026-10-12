import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  Play,
  Pause,
  XCircle,
  Trash2,
  Upload,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  Clock,
  AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useAiCampaigns,
  useCreateAiCampaign,
  useAiCampaignAction,
  useDeleteAiCampaign,
  useAiCalls,
  useSetAiCallInterest,
  useRetryAiCall,
  useBolnaIntegration,
  type AiCall,
  type AiCallInterest,
  type AiCallStatus,
  type AiCampaign,
  type AiCampaignStatus,
} from '@/api/aiCalls';
import { useTelecallers } from '@/api/users';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Field';
import { Badge, Card, EmptyState, Spinner, Toggle } from '@/components/ui/Misc';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { fmtRelative, fmtDateTime } from '@/lib/format';
import { formatPhoneDisplay } from '@/lib/phone';

// ───────────────────────────── label / colour maps ─────────────────────────────

const CAMPAIGN_STATUS: Record<AiCampaignStatus, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  running: { label: 'Running', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  paused: { label: 'Paused', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  completed: { label: 'Completed', cls: 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
};

const CALL_STATUS: Record<AiCallStatus, { label: string; cls: string }> = {
  queued: { label: 'Queued', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  dialing: { label: 'Dialling', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  in_progress: { label: 'On call', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  completed: { label: 'Answered', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  no_answer: { label: 'No answer', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  busy: { label: 'Busy', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  failed: { label: 'Failed', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
};

const INTEREST: Record<AiCallInterest, { label: string; cls: string }> = {
  yes: { label: 'Interested', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  callback: { label: 'Callback', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  no: { label: 'Not interested', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  unknown: { label: '—', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
};

const INTEREST_TABS: { key: '' | AiCallInterest; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'yes', label: 'Interested' },
  { key: 'callback', label: 'Callback' },
  { key: 'no', label: 'Not interested' },
  { key: 'unknown', label: 'Unclear / not reached' },
];

function fmtDuration(sec?: number) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

// ───────────────────────────── number parsing ─────────────────────────────

interface NumberRow {
  name: string;
  phone: string;
}

/**
 * Reads pasted text or a CSV/TXT file: one person per line, either just a number
 * or "name, number" (any order, comma/tab/semicolon separated). A header row and
 * lines without a number are skipped.
 */
function parseNumbers(text: string): NumberRow[] {
  const rows: NumberRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line
      .split(/[,;\t|]/)
      .map((c) => c.trim().replace(/^["']+|["']+$/g, ''))
      .filter(Boolean);
    if (!cells.length) continue;
    const phoneIdx = cells.findIndex((c) => (c.match(/\d/g)?.length ?? 0) >= 7 && /^[+\d\s().-]+$/.test(c));
    if (phoneIdx === -1) continue;
    const name = cells.find((c, i) => i !== phoneIdx && /[a-z]/i.test(c) && !c.includes('@')) ?? '';
    rows.push({ phone: cells[phoneIdx], name });
  }
  return rows;
}

// ───────────────────────────── composer ─────────────────────────────

function CampaignComposer({ ready, onCreated }: { ready: boolean; onCreated: (id: string) => void }) {
  const create = useCreateAiCampaign();
  const { data: telecallers } = useTelecallers({ isActive: 'true', limit: 200 });
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [numbersText, setNumbersText] = useState('');
  const [useContacts, setUseContacts] = useState(false);
  const [contactScope, setContactScope] = useState<'pending' | 'not_done' | 'any'>('pending');
  const [contactLimit, setContactLimit] = useState(100);
  const [pitch, setPitch] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [retryDelayMin, setRetryDelayMin] = useState(60);
  const [saveAllContacts, setSaveAllContacts] = useState(false);

  const parsed = useMemo(() => parseNumbers(numbersText), [numbersText]);

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      const rows = parseNumbers(text);
      if (!rows.length) {
        toast.error('No phone numbers found in that file');
        return;
      }
      setNumbersText((prev) =>
        [prev.trim(), ...rows.map((r) => (r.name ? `${r.name}, ${r.phone}` : r.phone))].filter(Boolean).join('\n')
      );
      if (!name) setName(file.name.replace(/\.[^.]+$/, ''));
      toast.success(`${rows.length} number${rows.length === 1 ? '' : 's'} added`);
    });
  }

  function submit(startNow: boolean) {
    if (!name.trim()) return toast.error('Give the campaign a name');
    if (!parsed.length && !useContacts) return toast.error('Paste some numbers or pick contacts');
    create.mutate(
      {
        name: name.trim(),
        numbers: parsed,
        contacts: useContacts ? { callStatus: contactScope, limit: contactLimit } : undefined,
        pitch: pitch.trim(),
        assignTo: assignTo || undefined,
        maxAttempts,
        retryDelayMin,
        saveAllContacts,
        startNow,
      },
      {
        onSuccess: (res) => {
          toast.success(
            `${res.added} number${res.added === 1 ? '' : 's'} ${startNow ? 'queued — the agent is calling' : 'saved'}` +
              (res.invalid.length ? ` (${res.invalid.length} invalid skipped)` : '')
          );
          setName('');
          setNumbersText('');
          setUseContacts(false);
          onCreated(res.data._id);
        },
        onError: (e) => toast.error(apiError(e), { duration: 8000 }),
      }
    );
  }

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">New AI calling campaign</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Give the numbers — the AI agent calls each one, asks if they want your service, and everyone who says yes is
          saved as a lead.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <div>
            <Label>Campaign name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali offer – Pune" />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label>Numbers (one per line, optionally “name, number”)</Label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="tap inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
              >
                <Upload size={13} /> CSV / TXT
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={handleFile} />
            </div>
            <Textarea
              rows={7}
              value={numbersText}
              onChange={(e) => setNumbersText(e.target.value)}
              placeholder={'9876543210\nRahul Sharma, +91 98765 43211\nPriya, 9876543212'}
              className="font-mono text-xs"
            />
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              {parsed.length} number{parsed.length === 1 ? '' : 's'} detected · duplicates are removed
            </p>
          </div>
          <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">Also call existing contacts</p>
              <Toggle checked={useContacts} onChange={setUseContacts} label="Also call existing contacts" />
            </div>
            {useContacts && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={contactScope} onChange={(e) => setContactScope(e.target.value as typeof contactScope)}>
                  <option value="pending">Never called</option>
                  <option value="not_done">Called, not reached</option>
                  <option value="any">Any (not DND / closed)</option>
                </Select>
                <Input
                  type="number"
                  min={1}
                  max={5000}
                  value={contactLimit}
                  onChange={(e) => setContactLimit(Number(e.target.value) || 1)}
                  aria-label="How many contacts"
                />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <Label>What are you offering? (the agent says this)</Label>
            <Textarea
              rows={3}
              value={pitch}
              onChange={(e) => setPitch(e.target.value)}
              placeholder="e.g. a free website audit and SEO plan for local businesses"
            />
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              Sent to the agent as <code>{'{service}'}</code>. Leave blank if your agent prompt already describes it.
            </p>
          </div>
          <div>
            <Label>Give interested leads to</Label>
            <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">Nobody — I'll assign later</option>
              {telecallers?.data.map((u) => (
                <option key={u._id} value={u._id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Attempts per number</Label>
              <Select value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? '1 (no retry)' : n}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Retry after</Label>
              <Select
                value={retryDelayMin}
                disabled={maxAttempts === 1}
                onChange={(e) => setRetryDelayMin(Number(e.target.value))}
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={180}>3 hours</option>
                <option value={1440}>1 day</option>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800">
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-300">Save everyone as a contact</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                Off: only interested / callback people are added to the CRM.
              </p>
            </div>
            <Toggle checked={saveAllContacts} onChange={setSaveAllContacts} label="Save everyone as a contact" />
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => submit(false)} loading={create.isPending}>
          Save as draft
        </Button>
        <Button onClick={() => submit(true)} loading={create.isPending} disabled={!ready}>
          <Play size={15} /> Start calling
        </Button>
      </div>
    </Card>
  );
}

// ───────────────────────────── campaign card ─────────────────────────────

function CampaignCard({
  campaign,
  selected,
  onSelect,
}: {
  campaign: AiCampaign;
  selected: boolean;
  onSelect: () => void;
}) {
  const action = useAiCampaignAction();
  const del = useDeleteAiCampaign();
  const s = campaign.stats;
  const done = s.total - s.queued - s.active;
  const pct = s.total ? Math.round((done / s.total) * 100) : 0;
  const st = CAMPAIGN_STATUS[campaign.status];

  function run(a: 'start' | 'pause' | 'cancel') {
    if (a === 'cancel' && !confirm(`Stop "${campaign.name}"? Numbers not yet called will be skipped.`)) return;
    action.mutate({ id: campaign._id, action: a }, { onError: (e) => toast.error(apiError(e), { duration: 8000 }) });
  }

  function remove() {
    if (!confirm(`Delete "${campaign.name}" and its call history? Leads it created stay in the CRM.`)) return;
    del.mutate(campaign._id, { onError: (e) => toast.error(apiError(e)) });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`cursor-pointer space-y-3 rounded-2xl border bg-white p-4 transition-colors dark:bg-gray-900 ${
        selected
          ? 'border-gray-950 ring-1 ring-gray-950 dark:border-white dark:ring-white'
          : 'border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900 dark:text-gray-100">{campaign.name}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {s.total} numbers · {fmtRelative(campaign.createdAt)}
            {campaign.assignTo?.name ? ` · → ${campaign.assignTo.name}` : ''}
          </p>
        </div>
        <Badge className={st.cls}>{st.label}</Badge>
      </div>

      <div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div className="h-full bg-brand-gradient transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
          {done}/{s.total} done{s.active ? ` · ${s.active} on call now` : ''}
          {s.queued ? ` · ${s.queued} waiting` : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        <Badge className={INTEREST.yes.cls}>{s.interested} interested</Badge>
        <Badge className={INTEREST.callback.cls}>{s.callback} callback</Badge>
        <Badge className={INTEREST.no.cls}>{s.notInterested} not interested</Badge>
        {s.unreachable > 0 && <Badge className={CALL_STATUS.no_answer.cls}>{s.unreachable} unreachable</Badge>}
        {s.failed > 0 && <Badge className={CALL_STATUS.failed.cls}>{s.failed} failed</Badge>}
      </div>

      <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        {(campaign.status === 'draft' || campaign.status === 'paused') && (
          <Button size="sm" onClick={() => run('start')} loading={action.isPending}>
            <Play size={13} /> {campaign.status === 'draft' ? 'Start' : 'Resume'}
          </Button>
        )}
        {campaign.status === 'running' && (
          <Button size="sm" variant="secondary" onClick={() => run('pause')} loading={action.isPending}>
            <Pause size={13} /> Pause
          </Button>
        )}
        {['draft', 'running', 'paused'].includes(campaign.status) && (
          <Button size="sm" variant="ghost" onClick={() => run('cancel')}>
            <XCircle size={13} /> Stop
          </Button>
        )}
        {campaign.status !== 'running' && (
          <Button size="sm" variant="ghost" onClick={remove} loading={del.isPending} aria-label="Delete campaign">
            <Trash2 size={13} />
          </Button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── call rows ─────────────────────────────

function CallDetails({ call }: { call: AiCall }) {
  const setInterest = useSetAiCallInterest();
  const retry = useRetryAiCall();
  const finished = !['queued', 'dialing', 'in_progress'].includes(call.status);
  const extracted = call.extractedData && Object.entries(call.extractedData).filter(([, v]) => v !== '' && v != null);

  function mark(interest: AiCallInterest) {
    setInterest.mutate(
      { id: call._id, interest },
      {
        onSuccess: () =>
          toast.success(interest === 'yes' ? 'Saved as a lead' : interest === 'callback' ? 'Saved for callback' : 'Updated'),
        onError: (e) => toast.error(apiError(e)),
      }
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {call.summary && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Summary</p>
          <p className="text-gray-700 dark:text-gray-300">{call.summary}</p>
        </div>
      )}
      {extracted && extracted.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">What the agent captured</p>
          <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {extracted.map(([k, v]) => (
              <div key={k} className="flex gap-2 text-xs">
                <dt className="shrink-0 text-gray-500 dark:text-gray-400">{k}:</dt>
                <dd className="min-w-0 break-words text-gray-800 dark:text-gray-200">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {call.recordingUrl && (
        <audio controls preload="none" src={call.recordingUrl} className="h-10 w-full max-w-md" />
      )}
      {call.transcript && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-300">Transcript</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-3 font-sans text-xs text-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
            {call.transcript}
          </pre>
        </details>
      )}
      {(call.error || call.hangupReason) && (
        <p className="flex items-start gap-1 text-xs text-gray-500 dark:text-gray-400">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          {[call.error, call.hangupReason && `Hangup: ${call.hangupReason}`].filter(Boolean).join(' · ')}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {call.status === 'completed' && (
          <>
            <span className="text-xs text-gray-500 dark:text-gray-400">Correct the outcome:</span>
            <Button size="sm" variant="success" onClick={() => mark('yes')} disabled={call.interest === 'yes'}>
              <ThumbsUp size={13} /> Interested
            </Button>
            <Button size="sm" variant="secondary" onClick={() => mark('callback')} disabled={call.interest === 'callback'}>
              <Clock size={13} /> Callback
            </Button>
            <Button size="sm" variant="secondary" onClick={() => mark('no')} disabled={call.interest === 'no'}>
              <ThumbsDown size={13} /> Not interested
            </Button>
          </>
        )}
        {finished && call.status !== 'cancelled' && (
          <Button size="sm" variant="ghost" onClick={() => retry.mutate(call._id, { onError: (e) => toast.error(apiError(e)) })}>
            <RotateCcw size={13} /> Call again
          </Button>
        )}
        {call.lead && (
          <Link
            to={call.lead.qualified ? '/leads' : '/contacts'}
            className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-300"
          >
            Open {call.lead.qualified ? 'lead' : 'contact'} →
          </Link>
        )}
      </div>
    </div>
  );
}

function CallsPanel({ campaign }: { campaign: AiCampaign }) {
  const [interest, setInterest] = useState<'' | AiCallInterest>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const debounced = useDebouncedValue(search, 300);
  const live = campaign.status === 'running';
  const { data, isLoading } = useAiCalls(
    { campaign: campaign._id, interest: interest || undefined, search: debounced || undefined, page, limit: 25 },
    live
  );
  const calls = data?.data ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;

  function toggle(id: string, el: HTMLElement | null) {
    setOpenId((cur) => (cur === id ? null : id));
    // Open panels can land below the fold on a phone — bring them into view.
    setTimeout(() => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
  }

  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 border-b border-gray-100 p-3 dark:border-gray-800 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{campaign.name} — calls</h2>
          {live && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
            </span>
          )}
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {INTEREST_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setInterest(t.key);
                setPage(1);
              }}
              className={`shrink-0 rounded-btn px-3 py-1.5 text-xs font-medium transition-colors ${
                interest === t.key
                  ? 'bg-gray-950 text-white dark:bg-white dark:text-gray-950'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search name or number"
          className="md:max-w-xs"
        />
      </div>

      {isLoading ? (
        <Spinner />
      ) : !calls.length ? (
        <EmptyState title="No calls here" hint={interest ? 'Try another tab.' : undefined} />
      ) : (
        <>
          {/* Phone: cards */}
          <div className="divide-y divide-gray-100 dark:divide-gray-800 md:hidden">
            {calls.map((c) => (
              <div key={c._id} className="p-3" id={`ai-call-${c._id}`}>
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-2 text-left"
                  onClick={(e) => toggle(c._id, (e.currentTarget.parentElement as HTMLElement) ?? null)}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900 dark:text-gray-100">{c.name || c.lead?.name || 'Unknown'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{formatPhoneDisplay(c.phoneNumber)}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge className={CALL_STATUS[c.status].cls}>{CALL_STATUS[c.status].label}</Badge>
                      {c.interest !== 'unknown' && (
                        <Badge className={INTEREST[c.interest].cls}>{INTEREST[c.interest].label}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-gray-400">
                    <p>{fmtDuration(c.durationSec)}</p>
                    <p>{fmtRelative(c.updatedAt)}</p>
                    {openId === c._id ? <ChevronDown size={16} className="ml-auto" /> : <ChevronRight size={16} className="ml-auto" />}
                  </div>
                </button>
                {openId === c._id && (
                  <div className="mt-3">
                    <CallDetails call={c} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Call</th>
                  <th className="px-3 py-2">Wants service?</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Attempts</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {calls.map((c) => (
                  <CallTableRow key={c._id} call={c} open={openId === c._id} onToggle={(el) => toggle(c._id, el)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-1 border-t border-gray-100 p-3 dark:border-gray-800">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="px-1 text-xs text-gray-500 dark:text-gray-400">
            {page} / {totalPages}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </Card>
  );
}

function CallTableRow({ call: c, open, onToggle }: { call: AiCall; open: boolean; onToggle: (el: HTMLElement | null) => void }) {
  return (
    <>
      <tr
        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/40"
        onClick={(e) => onToggle(e.currentTarget)}
      >
        <td className="px-3 py-2 text-gray-400">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
        <td className="px-3 py-2">
          <p className="font-medium text-gray-900 dark:text-gray-100">{c.name || c.lead?.name || '—'}</p>
          {c.lead && (
            <p className="text-[11px] text-gray-400">{c.lead.qualified ? 'Saved as lead' : 'In contacts'}</p>
          )}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-gray-300">{formatPhoneDisplay(c.phoneNumber)}</td>
        <td className="px-3 py-2">
          <Badge className={CALL_STATUS[c.status].cls}>{CALL_STATUS[c.status].label}</Badge>
        </td>
        <td className="px-3 py-2">
          <Badge className={INTEREST[c.interest].cls}>{INTEREST[c.interest].label}</Badge>
        </td>
        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{fmtDuration(c.durationSec)}</td>
        <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{c.attempts}</td>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400" title={fmtDateTime(c.updatedAt)}>
          {fmtRelative(c.updatedAt)}
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50/60 dark:bg-gray-800/30">
          <td colSpan={8} className="px-6 py-4">
            <CallDetails call={c} />
          </td>
        </tr>
      )}
    </>
  );
}

// ───────────────────────────── page ─────────────────────────────

/** AI calling console: build campaigns of numbers, watch the agent work, review outcomes. */
export function AiCallingPage() {
  const { data: settings } = useBolnaIntegration();
  const { data: campaigns, isLoading } = useAiCampaigns();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ready = Boolean(settings?.enabled && settings?.configured);

  const list = campaigns ?? [];
  const selected = list.find((c) => c._id === selectedId) ?? list[0];

  const totals = list.reduce(
    (acc, c) => ({
      calls: acc.calls + c.stats.total - c.stats.queued,
      interested: acc.interested + c.stats.interested,
      callback: acc.callback + c.stats.callback,
    }),
    { calls: 0, interested: 0, callback: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-800 dark:text-gray-100">
          <Bot size={22} /> AI Calling
        </h1>
        {list.length > 0 && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {totals.calls} calls · <span className="text-emerald-600 dark:text-emerald-400">{totals.interested} interested</span> ·{' '}
            {totals.callback} callbacks
          </p>
        )}
      </div>

      {settings && !ready && (
        <Card className="flex items-start gap-3 border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            AI calling isn't set up yet. Add your Bolna API key and agent in{' '}
            <Link to="/integrations" className="font-medium underline">
              Integrations → Bolna AI
            </Link>{' '}
            and switch it on. You can still prepare campaigns as drafts.
          </p>
        </Card>
      )}

      <CampaignComposer ready={ready} onCreated={setSelectedId} />

      {isLoading ? (
        <Spinner />
      ) : !list.length ? (
        <Card>
          <EmptyState title="No campaigns yet" hint="Paste some numbers above and press Start calling." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="space-y-3">
            {list.map((c) => (
              <CampaignCard key={c._id} campaign={c} selected={selected?._id === c._id} onSelect={() => setSelectedId(c._id)} />
            ))}
          </div>
          {selected && <CallsPanel key={selected._id} campaign={selected} />}
        </div>
      )}
    </div>
  );
}
