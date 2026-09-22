import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Label, Select, Textarea, Input } from '@/components/ui/Field';
import { apiError } from '@/api/client';
import { useLogCall } from '@/api/calls';
import { DISPOSITION_LABELS, DISPOSITIONS } from '@/lib/constants';
import { useCallStore } from '@/store/call';
import type { CallStatus, Disposition } from '@/types';
import { SaveCustomContactModal } from './SaveCustomContactModal';

function fmtDuration(sec: number) {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

/** Opens automatically after a Twilio call ends to capture the outcome. */
export function CallDispositionModal() {
  const pending = useCallStore((s) => s.pending);
  const clearPending = useCallStore((s) => s.clearPending);
  const logCall = useLogCall();

  const [callStatus, setCallStatus] = useState<CallStatus>('done');
  const [disposition, setDisposition] = useState<Disposition>('interested');
  const [remark, setRemark] = useState('');
  const [nextFollowUpAt, setNextFollowUpAt] = useState('');
  // Set after a custom call is logged → opens the (skippable) save-contact step.
  const [savePrompt, setSavePrompt] = useState<{ callLogId: string; phone: string } | null>(null);

  // Reset the form each time a new call ends.
  useEffect(() => {
    if (pending) {
      setCallStatus('done');
      setDisposition('interested');
      setRemark('');
      setNextFollowUpAt('');
    }
  }, [pending]);

  // The save-contact step outlives `pending` (cleared once the call is logged).
  if (savePrompt) {
    return (
      <SaveCustomContactModal
        callLogId={savePrompt.callLogId}
        phone={savePrompt.phone}
        onDone={() => setSavePrompt(null)}
      />
    );
  }

  if (!pending) return null;

  function submit() {
    if (!pending) return;
    const isCustom = !pending.leadId;
    const phone = pending.phone;
    logCall.mutate(
      {
        lead: pending.leadId ?? undefined,
        callStatus,
        disposition: callStatus === 'done' ? disposition : undefined,
        remark: remark.trim() || undefined,
        durationSec: pending.durationSec,
        nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : undefined,
        twilioCallSid: pending.twilioCallSid,
        provider: pending.provider,
        mode: pending.mode,
        telecmiCallId: pending.telecmiCallId,
        telecmiRequestId: pending.telecmiRequestId,
        phone: pending.phoneSlot,
        phoneNumber: phone,
      },
      {
        onSuccess: (res) => {
          toast.success('Call logged');
          clearPending();
          // Custom number → offer to save it as a contact (skippable).
          const callLogId = (res as { callLog?: { _id?: string } })?.callLog?._id;
          if (isCustom && callLogId) setSavePrompt({ callLogId, phone });
        },
        onError: (err) => toast.error(apiError(err)),
      }
    );
  }

  return (
    <Modal
      open
      onClose={clearPending}
      title="Call outcome"
      size="sm"
      footer={
        <div className="flex gap-2 [&>*]:flex-1 sm:justify-end sm:[&>*]:flex-none">
          <Button variant="secondary" onClick={clearPending} disabled={logCall.isPending}>
            Skip
          </Button>
          <Button onClick={submit} loading={logCall.isPending}>
            Save outcome
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
          <p className="font-medium text-slate-800 dark:text-slate-100">{pending.leadName || pending.phone}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {pending.phone} · Duration: {fmtDuration(pending.durationSec)}
          </p>
        </div>

        {pending.resultReason && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{pending.resultReason}</span>
          </div>
        )}

        <div>
          <Label>Call status</Label>
          <div className="flex gap-2">
            <Button
              className="flex-1 sm:flex-none"
              variant={callStatus === 'done' ? 'success' : 'secondary'}
              onClick={() => setCallStatus('done')}
            >
              Connected
            </Button>
            <Button
              className="flex-1 sm:flex-none"
              variant={callStatus === 'not_done' ? 'danger' : 'secondary'}
              onClick={() => setCallStatus('not_done')}
            >
              Not connected
            </Button>
          </div>
        </div>

        {callStatus === 'done' && (
          <div>
            <Label htmlFor="disposition">Outcome</Label>
            <Select
              id="disposition"
              value={disposition}
              onChange={(e) => setDisposition(e.target.value as Disposition)}
            >
              {DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {DISPOSITION_LABELS[d]}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div>
          <Label htmlFor="remark">Remark</Label>
          <Textarea
            id="remark"
            rows={2}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="What happened on the call?"
          />
        </div>

        <div>
          <Label htmlFor="followup">Next follow-up (optional)</Label>
          <Input
            id="followup"
            type="date"
            value={nextFollowUpAt}
            onChange={(e) => setNextFollowUpAt(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
