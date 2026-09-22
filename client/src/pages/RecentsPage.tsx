import { useState } from 'react';
import { PhoneCall, Phone } from 'lucide-react';
import { useCalls } from '@/api/calls';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui/Misc';
import { RecordingPlayer } from '@/features/calls/CallHistory';
import { callLogOutcomeLabel } from '@/lib/constants';
import { fmtRelative, fmtDateTime } from '@/lib/format';
import { formatPhoneDisplay } from '@/lib/phone';
import type { CallLog, Lead, User } from '@/types';

function fmtDuration(sec?: number) {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

const SLOT_LABEL: Record<string, string> = { phone1: 'Phone 1', phone2: 'Phone 2', phone3: 'Phone 3' };

function leadOf(c: CallLog): Lead | null {
  return typeof c.lead === 'object' && c.lead ? (c.lead as Lead) : null;
}
function telecallerName(c: CallLog): string {
  return typeof c.telecaller === 'object' && c.telecaller ? (c.telecaller as User).name : '';
}

/** Recent calls ("phone book") with last recordings — newest first. */
export function RecentsPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'superadmin');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useCalls({ page });
  const calls = data?.data ?? [];
  const totalPages = data?.pagination.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
          <PhoneCall size={20} /> Recents
        </h1>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span className="px-1 text-xs text-slate-500 dark:text-slate-400">
              {data?.pagination.page ?? page} / {totalPages}
            </span>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>

      <Card>
        {isLoading ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : !calls.length ? (
          <EmptyState title="No calls yet" hint="Calls you place will show up here with their recordings." />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {calls.map((c) => {
              const lead = leadOf(c);
              const number =
                formatPhoneDisplay(c.phoneNumber || lead?.phone) || (c.phone ? SLOT_LABEL[c.phone] : '');
              return (
                <div key={c._id} className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                      {lead?.name ? lead.name[0].toUpperCase() : <Phone size={15} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      {/* A custom dial has no contact — lead with the number itself
                          rather than an anonymous "unknown". */}
                      <p className="truncate font-medium text-slate-800 dark:text-slate-100">
                        {lead?.name ?? number ?? 'Unknown contact'}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {lead ? number : 'Not saved as a contact'}
                        {isAdmin && telecallerName(c) ? ` · by ${telecallerName(c)}` : ''}
                      </p>
                      {/* On a phone the outcome sits under the name instead of in
                          a right-hand column that squeezes it to two words wide. */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                        <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {callLogOutcomeLabel(c.disposition, c.callStatus)}
                        </Badge>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          {fmtDuration(c.durationSec)} · {fmtRelative(c.createdAt)}
                        </span>
                      </div>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {callLogOutcomeLabel(c.disposition, c.callStatus)}
                      </Badge>
                      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500" title={fmtDateTime(c.createdAt)}>
                        {fmtDuration(c.durationSec)} · {fmtRelative(c.createdAt)}
                      </p>
                    </div>
                    <div className="hidden sm:block">
                      {c.recordingUrl ? (
                        <RecordingPlayer callId={c._id} />
                      ) : (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">No recording</span>
                      )}
                    </div>
                  </div>
                  {c.recordingUrl && (
                    <div className="mt-2 sm:hidden">
                      <RecordingPlayer callId={c._id} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
