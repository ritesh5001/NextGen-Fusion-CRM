import { useState } from 'react';
import { Phone, MessageCircle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFollowUps, useMarkFollowUpDone } from '@/api/followups';
import { useCallProvider } from '@/features/calls/useCallProvider';
import { useCallStore } from '@/store/call';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui/Misc';
import { NO_CALLER_ID_MESSAGE } from '@/lib/constants';
import { fmtDateTime, isOverdue, telLink, whatsappLink } from '@/lib/format';
import { formatPhoneDisplay, toE164 } from '@/lib/phone';
import { apiError } from '@/api/client';
import type { Lead } from '@/types';

const SCOPES = [
  { key: 'today', label: 'Today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'all', label: 'All' },
];

export function FollowUpsPage() {
  const [scope, setScope] = useState('today');
  const { data, isLoading } = useFollowUps({ scope });
  const markDone = useMarkFollowUpDone();
  const { config: callConfig, ready: callingEnabled, provider: callProvider } = useCallProvider();
  const needsCallerId =
    callProvider === 'telecmi'
      ? (callConfig?.providers?.telecmi?.configured ?? false) && !(callConfig?.providers?.telecmi?.hasAgent ?? false)
      : (callConfig?.configured ?? false) && !(callConfig?.hasCallerId ?? false);
  const startCall = useCallStore((s) => s.startCall);
  const callPhase = useCallStore((s) => s.phase);
  const callBusy = callPhase === 'connecting' || callPhase === 'ringing' || callPhase === 'in_call';

  async function handleDone(id: string) {
    try {
      await markDone.mutateAsync(id);
      toast.success('Follow-up completed');
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Follow-ups</h1>

      <div className="flex flex-wrap gap-2">
        {SCOPES.map((s) => (
          <button
            key={s.key}
            onClick={() => setScope(s.key)}
            className={`min-h-11 flex-1 rounded-lg px-3 py-1.5 text-sm font-medium sm:min-h-0 sm:flex-none ${
              scope === s.key
                ? 'bg-brand-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.data.length ? (
          <EmptyState title="No follow-ups" hint="You're all caught up here." />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.data.map((f) => {
              const lead = f.lead as Lead;
              const overdue = isOverdue(f.scheduledAt);
              return (
                <div key={f._id} className="flex flex-col gap-3 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-slate-800 dark:text-slate-100">{lead?.name}</p>
                      {overdue && <Badge className="bg-rose-100 text-rose-700">Overdue</Badge>}
                    </div>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {formatPhoneDisplay(lead?.phone, lead?.country)}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">Scheduled {fmtDateTime(f.scheduledAt)}</p>
                    {f.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">“{f.notes}”</p>}
                  </div>
                  <div className="flex gap-1.5 [&>*]:flex-1 sm:[&>*]:flex-none">
                    {lead?.phone && (
                      <>
                        {callingEnabled ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={callBusy}
                            onClick={() =>
                              startCall({
                                leadId: lead._id,
                                name: lead.name,
                                phone: toE164(lead.phone, lead.country, callConfig?.defaultCountryCode),
                              })
                            }
                          >
                            <Phone size={14} /> Call
                          </Button>
                        ) : needsCallerId ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            title={NO_CALLER_ID_MESSAGE}
                            onClick={() => toast.error(NO_CALLER_ID_MESSAGE)}
                          >
                            <Phone size={14} /> Call
                          </Button>
                        ) : (
                          <a href={telLink(lead.phone)} className="block">
                            <Button size="sm" variant="secondary" className="w-full">
                              <Phone size={14} /> Call
                            </Button>
                          </a>
                        )}
                        <a href={whatsappLink(lead.phone)} target="_blank" rel="noreferrer" className="block">
                          <Button size="sm" variant="secondary" className="w-full">
                            <MessageCircle size={14} className="text-emerald-600" />
                            <span className="sm:hidden">WhatsApp</span>
                          </Button>
                        </a>
                      </>
                    )}
                    <Button size="sm" variant="success" className="w-full sm:w-auto" onClick={() => handleDone(f._id)}>
                      <CheckCircle2 size={14} /> Done
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
