import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Square,
  Play,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Label, Select } from '@/components/ui/Field';
import { Badge, Card } from '@/components/ui/Misc';
import { useAudioStore } from '@/store/audio';
import { useCallStore } from '@/store/call';
import { useCallProvider } from '@/features/calls/useCallProvider';
import { useMicRecorder, useMicTest } from '@/features/devices/useMicTest';

type Status = 'ok' | 'warn' | 'bad' | 'idle';

const STATUS_STYLE: Record<Status, string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  bad: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  idle: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function StatusBadge({ status, children }: { status: Status; children: React.ReactNode }) {
  const Icon = status === 'ok' ? CheckCircle2 : status === 'bad' ? XCircle : status === 'warn' ? AlertTriangle : Mic;
  return (
    <Badge className={`gap-1 ${STATUS_STYLE[status]}`}>
      <Icon size={12} /> {children}
    </Badge>
  );
}

/** Segmented level meter — green while speaking, red near clipping. */
function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const bars = 24;
  const lit = Math.round(level * bars);
  return (
    <div className="flex h-8 items-end gap-1" aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const on = active && i < lit;
        const hot = i > bars * 0.85;
        return (
          <span
            key={i}
            className={`flex-1 rounded-sm transition-[height,background-color] duration-75 ${
              on ? (hot ? 'bg-rose-500' : 'bg-emerald-500') : 'bg-slate-200 dark:bg-slate-700'
            }`}
            style={{ height: on ? `${30 + (i / bars) * 70}%` : '30%' }}
          />
        );
      })}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0 dark:border-slate-800">
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </div>
  );
}

/**
 * Hardware check for the softphone: mic permission, device selection, a live
 * level meter, and a record/playback loop so a telecaller can prove their mic
 * works before they start dialling.
 */
export function DeviceTestPage() {
  const { inputs, outputs, inputDeviceId, outputDeviceId, permission, error: storeError } = useAudioStore();
  const { refreshDevices, requestPermission, setInputDeviceId, setOutputDeviceId } = useAudioStore();
  const { listening, level, peak, error: testError, start, stop } = useMicTest();
  const { recording, clipUrl, error: recError, startRecording, stopRecording } = useMicRecorder();

  const softphoneReady = useCallStore((s) => s.ready);
  const callingEnabled = useCallProvider().ready;
  const playbackRef = useRef<HTMLAudioElement>(null);
  const [checkedPermission, setCheckedPermission] = useState(false);

  // Read the standing permission (no prompt) and list whatever we can see.
  useEffect(() => {
    let cancelled = false;
    let status: PermissionStatus | null = null;
    // Only adopt the query result while the user hasn't already proven access —
    // this resolves async and must not clobber a grant that landed first.
    const adopt = (state: string) => {
      if (cancelled) return;
      if (useAudioStore.getState().permission === 'granted' && state !== 'denied') return;
      useAudioStore.setState({ permission: state as 'granted' | 'denied' | 'prompt' });
      void refreshDevices();
    };
    (async () => {
      try {
        status = (await navigator.permissions?.query({ name: 'microphone' as PermissionName })) ?? null;
        if (status) {
          adopt(status.state);
          // Permission can be changed from the browser UI while the page is open.
          status.onchange = () => adopt(status!.state);
        }
      } catch {
        /* Firefox/Safari don't expose the microphone permission — the test itself tells us. */
      }
      await refreshDevices();
      if (!cancelled) setCheckedPermission(true);
    })();
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, [refreshDevices]);

  // Keep the list live as headsets are plugged in and out.
  useEffect(() => {
    const onChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  }, [refreshDevices]);

  const granted = permission === 'granted';
  const selectedMic = inputs.find((d) => d.deviceId === inputDeviceId);
  const micName = selectedMic?.label ?? (inputs[0]?.label || 'System default microphone');
  const heardSound = peak > 0.05;
  const error = testError ?? recError ?? storeError;

  const micStatus: Status = !granted ? (permission === 'denied' ? 'bad' : 'idle') : inputs.length ? 'ok' : 'bad';

  async function handleEnable() {
    const ok = await requestPermission();
    if (ok) await start();
  }

  // Route playback to the chosen speaker where the browser allows it (Chromium).
  useEffect(() => {
    const el = playbackRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId && outputDeviceId) void el.setSinkId(outputDeviceId).catch(() => {});
  }, [outputDeviceId, clipUrl]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800 dark:text-slate-100">
            <Mic size={20} /> Device Test
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Check your microphone and audio before you start calling.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refreshDevices()}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Microphone */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
              <Mic size={16} /> Microphone
            </h2>
            <StatusBadge status={micStatus}>
              {!checkedPermission
                ? 'Checking…'
                : permission === 'denied'
                  ? 'Blocked'
                  : !granted
                    ? 'Not tested'
                    : inputs.length
                      ? 'Connected'
                      : 'None found'}
            </StatusBadge>
          </div>

          <div className="mb-3">
            <Row label="Detected">
              <span className="max-w-[60%] truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                {granted ? micName : `${inputs.length || 'No'} device${inputs.length === 1 ? '' : 's'}`}
              </span>
            </Row>
            <Row label="Inputs available">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{inputs.length}</span>
            </Row>
          </div>

          {!granted ? (
            <div className="rounded-lg bg-slate-50 p-4 text-center dark:bg-slate-800/50">
              <MicOff size={22} className="mx-auto mb-2 text-slate-400" />
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
                {permission === 'denied'
                  ? 'Mic access is blocked. Allow it in your browser’s site settings, then refresh.'
                  : 'Allow microphone access to see your devices and test them.'}
              </p>
              <Button onClick={handleEnable}>
                <Mic size={14} /> Allow microphone
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-3">
                <Label htmlFor="mic">Microphone in use</Label>
                <Select id="mic" value={inputDeviceId} onChange={(e) => setInputDeviceId(e.target.value)}>
                  <option value="">System default</option>
                  {inputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                  Used for your browser calls. Remembered on this computer.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Input level</span>
                  {listening && (
                    <span className={`text-xs font-medium ${heardSound ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {heardSound ? 'Sound detected' : 'Say something…'}
                    </span>
                  )}
                </div>
                <LevelMeter level={level} active={listening} />
                <div className="mt-3 flex gap-2">
                  {listening ? (
                    <Button variant="secondary" size="sm" onClick={stop}>
                      <Square size={13} /> Stop test
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => void start()}>
                      <Mic size={13} /> Test mic
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </Card>

        {/* Playback + calling readiness */}
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
              <Volume2 size={16} /> Speaker &amp; playback
            </h2>

            {outputs.length > 0 && (
              <div className="mb-3">
                <Label htmlFor="spk">Speaker</Label>
                <Select id="spk" value={outputDeviceId} onChange={(e) => setOutputDeviceId(e.target.value)}>
                  <option value="">System default</option>
                  {outputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
              Record a few seconds and play it back — if you hear yourself clearly, your setup is good.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {recording ? (
                <Button variant="danger" size="sm" onClick={stopRecording}>
                  <Square size={13} /> Stop recording
                </Button>
              ) : (
                <Button variant="secondary" size="sm" disabled={!granted} onClick={() => void startRecording()}>
                  <Play size={13} /> Record a test clip
                </Button>
              )}
              {recording && <span className="text-xs text-rose-600">Recording…</span>}
            </div>
            {clipUrl && (
              <audio ref={playbackRef} src={clipUrl} controls className="mt-3 w-full" />
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
              <Wifi size={16} /> Calling readiness
            </h2>
            <div>
              <Row label="Calling configured">
                <StatusBadge status={callingEnabled ? 'ok' : 'warn'}>
                  {callingEnabled ? 'Enabled' : 'Not set up'}
                </StatusBadge>
              </Row>
              <Row label="Softphone connected">
                <StatusBadge status={softphoneReady ? 'ok' : callingEnabled ? 'warn' : 'idle'}>
                  {softphoneReady ? 'Ready' : callingEnabled ? 'Connecting…' : 'Unavailable'}
                </StatusBadge>
              </Row>
              <Row label="Microphone">
                <StatusBadge status={granted ? (heardSound ? 'ok' : 'warn') : 'bad'}>
                  {granted ? (heardSound ? 'Working' : 'Allowed — not tested') : 'No access'}
                </StatusBadge>
              </Row>
              <Row label="Secure connection">
                <StatusBadge status={window.isSecureContext ? 'ok' : 'bad'}>
                  {window.isSecureContext ? 'Yes' : 'Insecure (mic blocked)'}
                </StatusBadge>
              </Row>
            </div>
            {!callingEnabled && (
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                Browser calling isn’t configured yet — ask your admin to set up Twilio in Integrations.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
