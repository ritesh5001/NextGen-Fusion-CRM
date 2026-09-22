import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Mic } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCalls, fetchRecordingObjectUrl } from '@/api/calls';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Misc';
import { callLogOutcomeLabel } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { formatPhoneDisplay } from '@/lib/phone';

function fmtDuration(sec?: number) {
  if (!sec) return '0s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

const SLOT_LABEL: Record<string, string> = { phone1: 'Phone 1', phone2: 'Phone 2', phone3: 'Phone 3' };

/** Which number a call was placed to: the actual number if known, else the slot. */
function calledNumber(c: { phoneNumber?: string; phone?: string }) {
  return formatPhoneDisplay(c.phoneNumber) || (c.phone ? SLOT_LABEL[c.phone] : '');
}

function fmtTime(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Custom audio player with a wide, draggable seek bar. */
function AudioPlayer({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const pct = dur ? Math.min(100, (cur / dur) * 100) : 0;

  function toggle() {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }
  function seek(e: React.ChangeEvent<HTMLInputElement>) {
    const a = ref.current;
    if (!a) return;
    a.currentTime = Number(e.target.value);
    setCur(a.currentTime);
  }

  return (
    <div className="flex w-full items-center gap-2 rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-700/60 sm:w-80">
      <button
        onClick={toggle}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700"
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>

      {/* Seek bar — visual track + fill + knob, with an invisible range on top for dragging. */}
      <div className="relative h-4 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-300 dark:bg-slate-600" />
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-600"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600 shadow"
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={0}
          max={dur || 0}
          step="any"
          value={cur}
          onChange={seek}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
          aria-label="Seek"
        />
      </div>

      <span className="shrink-0 text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
        {fmtTime(cur)} / {fmtTime(dur)}
      </span>
      <audio
        ref={ref}
        src={src}
        autoPlay
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}

/** Lazily downloads (auth-proxied) and plays a single call recording. */
export function RecordingPlayer({ callId }: { callId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Release the object URL when this player unmounts.
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  async function load() {
    setLoading(true);
    try {
      setSrc(await fetchRecordingObjectUrl(callId));
    } catch (e) {
      toast.error(apiError(e));
    } finally {
      setLoading(false);
    }
  }

  if (src) return <AudioPlayer src={src} />;
  return (
    <Button size="sm" variant="secondary" onClick={load} loading={loading}>
      <Play size={13} /> Play recording
    </Button>
  );
}

/** Call log + recordings for one lead, shown in the expanded contact detail. */
export function CallHistory({ leadId }: { leadId: string }) {
  const { data, isLoading } = useCalls({ lead: leadId });
  const calls = data?.data ?? [];

  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <Mic size={13} /> Calls &amp; recordings
      </p>
      {isLoading ? (
        <Spinner />
      ) : !calls.length ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">No calls logged yet.</p>
      ) : (
        <div className="max-h-48 space-y-1.5 overflow-y-auto">
          {calls.map((c) => (
            <div
              key={c._id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 dark:bg-slate-800"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                  {callLogOutcomeLabel(c.disposition, c.callStatus)}
                  <span className="ml-1.5 font-normal text-slate-400 dark:text-slate-500">
                    · {fmtDuration(c.durationSec)}
                  </span>
                </p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  {calledNumber(c) && <span>{calledNumber(c)} · </span>}
                  {fmtDateTime(c.createdAt)}
                </p>
              </div>
              {c.recordingUrl ? (
                <RecordingPlayer callId={c._id} />
              ) : (
                <span className="text-[10px] text-slate-400 dark:text-slate-500">No recording</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
