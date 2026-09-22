import { create } from 'zustand';
import { Call, Device } from '@twilio/voice-sdk';
import PIOPIY from '@telecmi/piopiyjs';
import { isValidPhoneNumber } from 'libphonenumber-js';
import {
  fetchVoiceToken,
  fetchDialStatus,
  fetchTelecmiCredentials,
  startClickToCall,
  type DialResult,
} from '@/api/calls';
import { cleanPhone } from '@/lib/format';
import { useAudioStore } from '@/store/audio';
import type { CallProvider } from '@/types';

/**
 * Point the Twilio Device at the mic/speaker chosen on the Device Test page.
 * Best-effort: a remembered device can be unplugged, and speaker selection is
 * Chromium-only — either way we fall back to the OS default rather than fail
 * the call.
 */
async function applyAudioDevices(device: Device) {
  // Only the labels persist across a reload, so re-resolve the live deviceIds
  // before dialling — otherwise a saved mic silently reverts to the default for
  // anyone who hasn't opened the Device Test page this session.
  const audio = useAudioStore.getState();
  if ((audio.inputLabel || audio.outputLabel) && !audio.inputDeviceId && !audio.outputDeviceId) {
    await audio.refreshDevices();
  }
  const { inputDeviceId, outputDeviceId } = useAudioStore.getState();
  try {
    if (inputDeviceId) await device.audio?.setInputDevice(inputDeviceId);
    else await device.audio?.unsetInputDevice();
  } catch {
    /* fall back to the default mic */
  }
  try {
    if (outputDeviceId && device.audio?.isOutputSelectionSupported) {
      await device.audio.speakerDevices.set(outputDeviceId);
    }
  } catch {
    /* fall back to the default speaker */
  }
}

export type CallPhase = 'idle' | 'connecting' | 'ringing' | 'in_call' | 'ended';
export type PhoneSlot = 'phone1' | 'phone2' | 'phone3';
/** How the call is placed: through the browser, or by TeleCMI ringing the user's phone. */
export type CallMode = 'softphone' | 'click_to_call';

/** Summary of a just-ended call, used to seed the disposition modal. */
export interface PendingDisposition {
  /** Null for a custom dial to a number that isn't a saved contact. */
  leadId: string | null;
  leadName: string;
  phone: string; // the actual number that was dialled
  phoneSlot: PhoneSlot; // which of the contact's numbers (phone1/2/3)
  durationSec: number;
  twilioCallSid?: string;
  /** Which backend placed the call, so the outcome is logged against it. */
  provider: CallProvider;
  mode: CallMode;
  telecmiCallId?: string;
  telecmiRequestId?: string;
  dialStatus?: string; // completed | busy | no-answer | failed | canceled
  resultReason?: string; // human-readable reason shown to the user
}

/** Turns a Twilio dial result into a clear, human reason. */
export function dialStatusReason(status?: string | null): string | null {
  switch (status) {
    case 'busy':
      return 'The number was busy.';
    case 'no-answer':
      return 'No answer.';
    case 'failed':
      return 'Call failed — the number may be wrong or unreachable. Try updating it.';
    case 'canceled':
      return 'Call was canceled.';
    case 'completed':
      return null;
    default:
      return null;
  }
}

/** Maps Twilio Voice SDK error codes to a clear message for the telecaller. */
function friendlyDeviceError(e: { code?: number; message?: string }): string {
  switch (e.code) {
    case 31401:
      return 'Microphone permission denied. Allow mic access and try again.';
    case 31208:
      return 'Microphone permission denied. Allow mic access in your browser.';
    case 31003:
    case 31005:
      return 'Connection problem. Check your internet and try again.';
    case 20101:
    case 20104:
    case 31204:
      return 'Calling session expired. Refresh the page and try again.';
    case 31002:
      return 'Could not connect the call. The number may be invalid or not allowed.';
    case 13224:
    case 13223:
    case 21211:
      return 'Invalid phone number. Please update the number.';
    case 13227:
      return 'Calls to this country are not enabled on the Twilio account.';
    default:
      return e.message || 'Call error. Please try again.';
  }
}

/** Maps TeleCMI SDK status codes onto a clear message for the telecaller. */
function friendlyPiopiyError(e: { code?: number; status?: string }): string {
  switch (e.code) {
    case 401:
      return 'TeleCMI login failed. Ask your admin to check your agent id and password.';
    case 480:
      return 'The number is unavailable.';
    case 486:
      return 'The line was busy.';
    case 404:
      return 'Invalid number — TeleCMI could not reach it. Please update it.';
    case 408:
      return 'No answer.';
    case 1001:
    case 1002:
      return e.status || 'Calling error. Please try again.';
    default:
      return e.status || 'Call error. Please try again.';
  }
}

interface CallState {
  /** Which backend the *current* session dials with, and in which mode. */
  provider: CallProvider;
  mode: CallMode;
  device: Device | null;
  /** The TeleCMI softphone, created lazily and kept registered with the SBC. */
  piopiy: PIOPIY | null;
  ready: boolean;
  initializing: boolean;
  call: Call | null;
  phase: CallPhase;
  leadId: string | null;
  leadName: string;
  phone: string;
  phoneSlot: PhoneSlot;
  startedAt: number | null; // epoch ms when the call was accepted
  muted: boolean;
  error: string | null;
  pending: PendingDisposition | null;
  /** DTMF digits sent during this call, e.g. "1" then "3" → "13". For the UI. */
  digitsSent: string;

  /** Switch backend/mode. Tears down the old device so the next call re-registers. */
  setProvider: (provider: CallProvider, mode?: CallMode) => void;
  /** Lazily create the softphone for the active provider (idempotent). */
  initDevice: () => Promise<void>;
  startCall: (lead: {
    leadId: string | null;
    name: string;
    phone: string;
    phoneSlot?: PhoneSlot;
  }) => Promise<void>;
  /** Send a DTMF tone (IVR menus: "press 1 for sales"). Only valid mid-call. */
  sendDigit: (digit: string) => void;
  toggleMute: () => void;
  hangup: () => void;
  clearPending: () => void;
  pollDialStatus: (callSid: string) => Promise<void>;
  destroy: () => void;
}

export const useCallStore = create<CallState>((set, get) => ({
  provider: 'twilio',
  mode: 'softphone',
  device: null,
  piopiy: null,
  ready: false,
  initializing: false,
  call: null,
  phase: 'idle',
  leadId: null,
  leadName: '',
  phone: '',
  phoneSlot: 'phone1',
  startedAt: null,
  muted: false,
  error: null,
  pending: null,
  digitsSent: '',

  setProvider: (provider, mode = 'softphone') => {
    if (get().provider === provider && get().mode === mode) return;
    // Drop the old provider's registration so the next call initialises cleanly.
    get().destroy();
    set({ provider, mode, error: null });
  },

  initDevice: async () => {
    const { initializing, provider, mode } = get();
    if (initializing) return;
    // Click-to-call places the call server-side — there is no device to register.
    if (provider === 'telecmi' && mode === 'click_to_call') {
      set({ ready: true });
      return;
    }
    if (provider === 'telecmi') {
      if (get().piopiy) return;
      set({ initializing: true, error: null });
      try {
        const creds = await fetchTelecmiCredentials();
        const phone = new PIOPIY({ name: 'NextGen Fusion CRM', debug: false, autoplay: true, ringTime: 60 });

        // Registration is asynchronous — resolve once the SBC accepts the login so
        // a call placed straight after init isn't dialled on an unregistered device.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('TeleCMI login timed out. Check your connection.')), 15000);
          phone.on('login', () => {
            clearTimeout(timer);
            resolve();
          });
          phone.on('loginFailed', (e) => {
            clearTimeout(timer);
            reject(new Error(friendlyPiopiyError(e)));
          });
          phone.login(creds.userId, creds.password, creds.sbcUri);
        });

        phone.on('error', (e) => set({ error: friendlyPiopiyError(e) }));
        phone.on('mediaFailed', () => set({ error: 'Microphone permission denied. Allow mic access and try again.' }));

        // Call lifecycle — bound once for the life of the device, reading the
        // current lead/number straight from the store each time.
        phone.on('trying', () => set({ phase: 'connecting' }));
        phone.on('ringing', () => set({ phase: 'ringing' }));
        phone.on('answered', () => set({ phase: 'in_call', startedAt: Date.now() }));

        const finish = () => {
          // Ignore stray end events when no call of ours is in flight.
          if (get().phase === 'idle' || get().phase === 'ended') return;
          const { startedAt, leadId, leadName, phone: ph, phoneSlot } = get();
          const durationSec = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
          const callId = phone.getCallId();
          set({
            phase: 'ended',
            startedAt: null,
            muted: false,
            pending: {
              leadId,
              leadName,
              phone: ph,
              phoneSlot,
              durationSec,
              provider: 'telecmi',
              mode: 'softphone',
              telecmiCallId: callId || undefined,
            },
          });
        };
        phone.on('ended', (e) => {
          // A call that never connected carries the reason in its end status.
          if (!get().startedAt && e?.code && e.code !== 200) set({ error: friendlyPiopiyError(e) });
          finish();
        });
        phone.on('hangup', finish);

        set({ piopiy: phone, ready: true, initializing: false });
      } catch (e) {
        set({
          initializing: false,
          ready: false,
          error: e instanceof Error ? e.message : 'Failed to initialize TeleCMI calling',
        });
      }
      return;
    }

    if (get().device) return;
    set({ initializing: true, error: null });
    try {
      const token = await fetchVoiceToken();
      const dev = new Device(token, {
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        logLevel: 'error',
      });
      dev.on('error', (e: { code?: number; message?: string }) => set({ error: friendlyDeviceError(e) }));
      // Refresh the token shortly before it expires so the softphone stays live.
      dev.on('tokenWillExpire', async () => {
        try {
          dev.updateToken(await fetchVoiceToken());
        } catch {
          /* a failed refresh surfaces on the next call attempt */
        }
      });
      await applyAudioDevices(dev);
      set({ device: dev, ready: true, initializing: false });
    } catch (e) {
      set({
        initializing: false,
        ready: false,
        error: e instanceof Error ? e.message : 'Failed to initialize calling',
      });
    }
  },

  startCall: async ({ leadId, name, phone, phoneSlot = 'phone1' }) => {
    const { phase } = get();
    if (phase !== 'idle' && phase !== 'ended') return; // a call is already in progress

    const to = cleanPhone(phone);
    // Reject clearly-invalid E.164 numbers up front with a clear reason.
    if (to.startsWith('+') && !isValidPhoneNumber(to)) {
      set({ error: 'This number looks invalid. Please update it before calling.' });
      return;
    }

    const { provider, mode } = get();

    await get().initDevice();

    const baseCallState = {
      phase: 'connecting' as CallPhase,
      leadId,
      leadName: name,
      phone: to,
      phoneSlot,
      muted: false,
      startedAt: null,
      error: null,
      pending: null,
      digitsSent: '',
    };

    // ── TeleCMI click-to-call: the call happens on the telecaller's own phone, so
    // there is nothing to observe in the browser. Fire it, then hand straight to
    // the disposition step so the outcome is still captured.
    if (provider === 'telecmi' && mode === 'click_to_call') {
      set(baseCallState);
      try {
        const requestId = await startClickToCall(to, leadId);
        set({
          phase: 'ended',
          pending: {
            leadId,
            leadName: name,
            phone: to,
            phoneSlot,
            durationSec: 0,
            provider: 'telecmi',
            mode: 'click_to_call',
            telecmiRequestId: requestId,
          },
        });
      } catch (e) {
        set({
          phase: 'idle',
          error: e instanceof Error ? e.message : 'Could not place the call through TeleCMI',
        });
      }
      return;
    }

    // ── TeleCMI softphone (WebRTC).
    if (provider === 'telecmi') {
      const phone = get().piopiy;
      if (!phone) {
        set({ error: get().error ?? 'TeleCMI calling is unavailable' });
        return;
      }
      set(baseCallState);
      try {
        // Lifecycle handlers are bound once in initDevice — binding them here would
        // stack a fresh set on every call and fire `finish` N times.
        phone.call(to, leadId ? { extra_param: leadId } : undefined);
      } catch (e) {
        set({
          phase: 'idle',
          error: e instanceof Error ? e.message : 'Could not place the call',
        });
      }
      return;
    }

    // ── Twilio softphone.
    const device = get().device;
    if (!device) {
      set({ error: 'Calling is unavailable' });
      return;
    }
    // Honour a mic/speaker change made since the Device was created.
    await applyAudioDevices(device);
    set(baseCallState);

    let callSid: string | undefined;
    try {
      const call = await device.connect({ params: { To: to, ...(leadId ? { leadId } : {}) } });

      call.on('ringing', () => set({ phase: 'ringing' }));
      call.on('accept', (c: Call) => {
        callSid = c.parameters?.CallSid ?? callSid;
        set({ phase: 'in_call', startedAt: Date.now() });
      });
      const finish = () => {
        const { startedAt, leadId: lid, leadName: lname, phone: ph, phoneSlot: slot } = get();
        const durationSec = startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
        set({
          phase: 'ended',
          call: null,
          startedAt: null,
          muted: false,
          // A custom dial has no leadId but still needs its outcome captured.
          pending: {
            leadId: lid,
            leadName: lname,
            phone: ph,
            phoneSlot: slot,
            durationSec,
            twilioCallSid: callSid,
            provider: 'twilio',
            mode: 'softphone',
          },
        });
        // The call never connected (no talk time) → find out why from Twilio's dial result.
        if (callSid && durationSec === 0) void get().pollDialStatus(callSid);
      };
      call.on('disconnect', finish);
      call.on('cancel', finish);
      call.on('error', (e: { code?: number; message?: string }) => {
        set({ error: friendlyDeviceError(e) });
        finish();
      });

      set({ call });
    } catch (e) {
      set({
        phase: 'idle',
        call: null,
        error: e instanceof Error ? e.message : 'Could not place the call',
      });
    }
  },

  // Twilio only transmits DTMF on a connected call — pressing a key while it's
  // still ringing would be silently dropped, so ignore it rather than pretend.
  sendDigit: (digit) => {
    const { call, piopiy, provider, phase } = get();
    if (phase !== 'in_call') return;
    if (!/^[0-9*#]$/.test(digit)) return;
    if (provider === 'telecmi') {
      if (!piopiy) return;
      piopiy.sendDtmf(digit);
    } else {
      if (!call) return;
      call.sendDigits(digit);
    }
    set((s) => ({ digitsSent: s.digitsSent + digit }));
  },

  toggleMute: () => {
    const { call, piopiy, provider, muted } = get();
    if (provider === 'telecmi') {
      if (!piopiy) return;
      if (muted) piopiy.unMute();
      else piopiy.mute();
    } else {
      if (!call) return;
      call.mute(!muted);
    }
    set({ muted: !muted });
  },

  hangup: () => {
    const { call, piopiy, provider } = get();
    if (provider === 'telecmi') piopiy?.terminate();
    else call?.disconnect();
  },

  // After a 0-duration call, poll Twilio's dial result (it arrives a moment later)
  // and attach a human reason to the pending disposition so the user sees why.
  pollDialStatus: async (callSid: string) => {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (get().pending?.twilioCallSid !== callSid) return; // a new call started
      let result: DialResult | null = null;
      try {
        result = await fetchDialStatus(callSid);
      } catch {
        /* keep polling */
      }
      if (result?.dialStatus) {
        const status = result.dialStatus;
        // Prefer the server's specific reason (derived from the Twilio error code,
        // e.g. "Invalid or unreachable number"); fall back to the generic status message.
        const reason = result.dialReason ?? dialStatusReason(status);
        set((st) => ({
          pending: st.pending ? { ...st.pending, dialStatus: status, resultReason: reason ?? undefined } : st.pending,
          error: reason ?? st.error,
        }));
        // For a failed dial, the specific reason (from Twilio's error alert) lands a
        // beat later — keep polling to upgrade the generic message until it arrives.
        if (status !== 'failed' || result.dialReason) return;
      }
    }
  },

  clearPending: () =>
    set({ pending: null, phase: 'idle', leadId: null, leadName: '', phone: '', error: null, digitsSent: '' }),

  destroy: () => {
    const { device, call, piopiy } = get();
    call?.disconnect();
    device?.destroy();
    if (piopiy) {
      try {
        piopiy.terminate();
        piopiy.removeAllListeners();
        piopiy.logout();
      } catch {
        /* already torn down */
      }
    }
    set({ device: null, piopiy: null, ready: false, call: null, phase: 'idle', pending: null });
  },
}));

// Softphone state is only reachable mid-call, which makes it awkward to inspect
// when something goes wrong. Expose the store in dev builds so it can be read and
// driven from the browser console. Stripped from production bundles.
if (import.meta.env.DEV) {
  (window as unknown as { callStore?: typeof useCallStore }).callStore = useCallStore;
}
