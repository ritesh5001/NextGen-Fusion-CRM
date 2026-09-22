import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied';

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

/** Turns a getUserMedia rejection into a reason the telecaller can act on. */
export function micErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access was blocked. Allow the mic for this site in your browser settings, then test again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Plug in a headset or mic and test again.';
    case 'NotReadableError':
      return 'The microphone is in use by another app (Zoom, Meet, Teams…). Close it and test again.';
    case 'AbortError':
      return 'The microphone could not be started. Try reconnecting it.';
    default:
      return e instanceof Error ? e.message : 'Could not access the microphone.';
  }
}

interface AudioState {
  inputs: AudioDeviceInfo[];
  outputs: AudioDeviceInfo[];
  /** Chosen mic deviceId; '' = follow the OS default. Not persisted (ids rotate). */
  inputDeviceId: string;
  /** Chosen speaker deviceId; '' = follow the OS default. Not persisted. */
  outputDeviceId: string;
  /**
   * Label of the chosen mic/speaker. Persisted *instead of* the deviceId, which
   * the browser rotates per session — the label is what survives a reload and
   * lets us re-resolve the id.
   */
  inputLabel: string;
  outputLabel: string;
  permission: PermissionState;
  error: string | null;

  /** List devices. Labels are only populated once mic permission is granted. */
  refreshDevices: () => Promise<void>;
  /** Ask for mic permission (the label-revealing step), then re-list. */
  requestPermission: () => Promise<boolean>;
  setInputDeviceId: (id: string) => void;
  setOutputDeviceId: (id: string) => void;
}

export const useAudioStore = create<AudioState>()(
  persist(
    (set, get) => ({
      inputs: [],
      outputs: [],
      inputDeviceId: '',
      outputDeviceId: '',
      inputLabel: '',
      outputLabel: '',
      permission: 'unknown',
      error: null,

      refreshDevices: async () => {
        if (!navigator.mediaDevices?.enumerateDevices) {
          set({ error: 'This browser does not support device selection.' });
          return;
        }
        // Adopt the standing permission (no prompt) when we haven't looked yet, so
        // callers outside the Device Test page can still resolve a saved device.
        if (get().permission === 'unknown') {
          try {
            const st = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
            if (st) set({ permission: st.state as PermissionState });
          } catch {
            /* not queryable (Firefox/Safari) — a real getUserMedia call settles it */
          }
        }
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          const pick = (kind: 'audioinput' | 'audiooutput'): AudioDeviceInfo[] =>
            all
              // 'default'/'communications' are OS-default aliases of a device that is
              // also listed under its own id — drop them so each mic appears once.
              .filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications')
              .map((d, i) => ({
                deviceId: d.deviceId,
                // Labels stay empty until permission is granted.
                label: d.label || `${kind === 'audioinput' ? 'Microphone' : 'Speaker'} ${i + 1}`,
                kind,
              }));
          const inputs = pick('audioinput');
          const outputs = pick('audiooutput');

          // Browsers rotate deviceIds between sessions, so the remembered *label*
          // is what identifies the device — re-resolve the current id from it.
          // Without permission, labels are blank and nothing can be matched yet.
          const { inputLabel, outputLabel, permission } = get();
          if (permission !== 'granted') {
            set({ inputs, outputs });
            return;
          }
          const resolve = (list: AudioDeviceInfo[], label: string) =>
            (label && list.find((d) => d.label === label)?.deviceId) || '';
          set({
            inputs,
            outputs,
            inputDeviceId: resolve(inputs, inputLabel),
            outputDeviceId: resolve(outputs, outputLabel),
            // A remembered device that is gone (unplugged) falls back to the default.
            inputLabel: inputs.some((d) => d.label === inputLabel) ? inputLabel : '',
            outputLabel: outputs.some((d) => d.label === outputLabel) ? outputLabel : '',
          });
        } catch (e) {
          set({ error: micErrorMessage(e) });
        }
      },

      requestPermission: async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
          set({ error: 'This browser does not support microphone access.', permission: 'denied' });
          return false;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop()); // permission only — release the mic
          set({ permission: 'granted', error: null });
          await get().refreshDevices();
          return true;
        } catch (e) {
          set({ permission: 'denied', error: micErrorMessage(e) });
          return false;
        }
      },

      // Store the label alongside the id so the choice survives an id rotation.
      setInputDeviceId: (inputDeviceId) =>
        set({ inputDeviceId, inputLabel: get().inputs.find((d) => d.deviceId === inputDeviceId)?.label ?? '' }),
      setOutputDeviceId: (outputDeviceId) =>
        set({ outputDeviceId, outputLabel: get().outputs.find((d) => d.deviceId === outputDeviceId)?.label ?? '' }),
    }),
    {
      name: 'crm-audio',
      // Only labels are durable — deviceIds are re-resolved on each load.
      partialize: (s) => ({ inputLabel: s.inputLabel, outputLabel: s.outputLabel }),
    }
  )
);

/** The mic constraint to hand to getUserMedia for the current selection. */
export function inputConstraint(deviceId: string): MediaTrackConstraints | true {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}
