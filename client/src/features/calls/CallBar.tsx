import { useEffect, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Grid3x3 } from 'lucide-react';
import { useCallStore } from '@/store/call';
import { Keypad } from './Keypad';

function fmtElapsed(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Floating in-call bar; persists across routes while a call is active. */
export function CallBar() {
  const phase = useCallStore((s) => s.phase);
  const leadName = useCallStore((s) => s.leadName);
  const phone = useCallStore((s) => s.phone);
  const startedAt = useCallStore((s) => s.startedAt);
  const muted = useCallStore((s) => s.muted);
  const error = useCallStore((s) => s.error);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const hangup = useCallStore((s) => s.hangup);
  const sendDigit = useCallStore((s) => s.sendDigit);
  const digitsSent = useCallStore((s) => s.digitsSent);

  const [elapsed, setElapsed] = useState(0);
  const [keypadOpen, setKeypadOpen] = useState(false);

  // Tick the live timer once the call is connected.
  useEffect(() => {
    if (phase !== 'in_call' || !startedAt) return;
    setElapsed(Math.round((Date.now() - startedAt) / 1000));
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase, startedAt]);

  // Don't leave the keypad hanging open over the next call.
  useEffect(() => {
    if (phase !== 'in_call') setKeypadOpen(false);
  }, [phase]);

  // While the keypad is open, the number row types DTMF straight through — the
  // fastest way to answer "press 1 for sales" without hunting for the button.
  useEffect(() => {
    if (!keypadOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (/^[0-9*#]$/.test(e.key)) {
        e.preventDefault();
        sendDigit(e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keypadOpen, sendDigit]);

  // Only show while a call is live (the disposition modal takes over once ended).
  if (phase !== 'connecting' && phase !== 'ringing' && phase !== 'in_call') return null;

  const statusText =
    phase === 'connecting' ? 'Connecting…' : phase === 'ringing' ? 'Ringing…' : fmtElapsed(elapsed);

  return (
    // On a phone the bar floats just above the tab bar (and the home
    // indicator) rather than burying it — the user can still navigate mid-call.
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-50 flex flex-col items-center gap-2 px-3 pb-2 md:bottom-4 md:pb-0">
      {keypadOpen && (
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 flex h-6 items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Press a key to send it to the menu
            </span>
            {digitsSent && (
              <span className="font-mono text-sm font-semibold tracking-widest text-slate-800 dark:text-slate-100">
                {digitsSent}
              </span>
            )}
          </div>
          <Keypad size="sm" onPress={sendDigit} />
        </div>
      )}

      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <Phone size={16} />
          {phase !== 'in_call' && (
            <span className="absolute inset-0 animate-ping rounded-full border-2 border-emerald-400/70" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            {leadName || phone || 'Call'}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {error ? <span className="text-rose-600">{error}</span> : statusText}
          </p>
        </div>

        <button
          onClick={() => setKeypadOpen((o) => !o)}
          disabled={phase !== 'in_call'}
          title={phase === 'in_call' ? 'Keypad (for phone menus)' : 'Keypad available once connected'}
          aria-pressed={keypadOpen}
          className={`tap flex items-center justify-center rounded-full p-3 disabled:opacity-40 md:p-2.5 ${
            keypadOpen
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          <Grid3x3 size={18} />
        </button>
        <button
          onClick={toggleMute}
          disabled={phase !== 'in_call'}
          title={muted ? 'Unmute' : 'Mute'}
          className="tap flex items-center justify-center rounded-full p-3 text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800 md:p-2.5"
        >
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button
          onClick={hangup}
          title="Hang up"
          className="tap flex items-center justify-center rounded-full bg-rose-600 p-3 text-white hover:bg-rose-700 md:p-2.5"
        >
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}
