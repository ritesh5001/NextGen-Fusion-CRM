import { useCallback, useEffect, useRef, useState } from 'react';
import { inputConstraint, micErrorMessage, useAudioStore } from '@/store/audio';

/**
 * Live mic test: opens the selected input, exposes a 0–1 level for the meter,
 * and tracks whether any sound was actually heard (a mic can be "connected"
 * yet muted in hardware — level stays flat at 0).
 */
export function useMicTest() {
  const inputDeviceId = useAudioStore((s) => s.inputDeviceId);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setListening(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    stop();
    setError(null);
    setPeak(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: inputConstraint(inputDeviceId) });
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        // RMS around the 128 midpoint → rough loudness, scaled for a usable meter.
        let sum = 0;
        for (const v of buf) {
          const x = (v - 128) / 128;
          sum += x * x;
        }
        const rms = Math.sqrt(sum / buf.length);
        const next = Math.min(1, rms * 3);
        setLevel(next);
        setPeak((p) => (next > p ? next : p));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
      setListening(true);
    } catch (e) {
      setError(micErrorMessage(e));
      stop();
    }
  }, [inputDeviceId, stop]);

  // Switching mics mid-test should re-open the new one. `start` is keyed to the
  // device id, so this fires exactly once per change.
  const listeningRef = useRef(false);
  listeningRef.current = listening;
  useEffect(() => {
    if (listeningRef.current) void start();
  }, [start]);

  useEffect(() => stop, [stop]);

  return { listening, level, peak, error, start, stop };
}

/** Record a short clip from the selected mic and play it back. */
export function useMicRecorder() {
  const inputDeviceId = useAudioStore((s) => s.inputDeviceId);
  const [recording, setRecording] = useState(false);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const urlRef = useRef<string | null>(null);

  const stopRecording = useCallback(() => {
    recRef.current?.state === 'recording' && recRef.current.stop();
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setClipUrl(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: inputConstraint(inputDeviceId) });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        urlRef.current = url;
        setClipUrl(url);
        setRecording(false);
      };
      rec.start();
      setRecording(true);
    } catch (e) {
      setError(micErrorMessage(e));
      setRecording(false);
    }
  }, [inputDeviceId]);

  useEffect(
    () => () => {
      recRef.current?.state === 'recording' && recRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  return { recording, clipUrl, error, startRecording, stopRecording };
}
