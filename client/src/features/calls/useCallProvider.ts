import { useEffect } from 'react';
import { useCallConfig, useSetCallProvider } from '@/api/calls';
import { useCallStore, type CallMode } from '@/store/call';
import type { CallProvider } from '@/types';

/**
 * Single source of truth for "which telephony backend am I dialling with?".
 *
 * The server decides which providers are actually usable for this user (enabled
 * account-wide AND credentials assigned to them) and which one they prefer; this
 * hook mirrors that onto the call store so `startCall` dials through the right
 * SDK, and exposes the switcher used by the dialer and contacts table.
 */
export function useCallProvider() {
  const { data: config } = useCallConfig();
  const setPreference = useSetCallProvider();
  const provider = useCallStore((s) => s.provider);
  const mode = useCallStore((s) => s.mode);
  const setProviderInStore = useCallStore((s) => s.setProvider);

  const twilioReady = config?.providers?.twilio?.enabled ?? config?.enabled ?? false;
  const telecmiReady = config?.providers?.telecmi?.enabled ?? false;

  // Follow the server's choice of active provider. It already falls back to a
  // usable provider when the preferred one isn't available, so the telecaller is
  // never left pointed at a backend that cannot dial.
  const active = config?.activeProvider;
  useEffect(() => {
    if (!active) return;
    // Click-to-call is a per-session choice; don't clobber it on a config refetch.
    if (active === provider) return;
    setProviderInStore(active, active === 'telecmi' ? mode : 'softphone');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /** Switch backend (and mode) for this user, persisting the preference. */
  function switchTo(next: CallProvider, nextMode: CallMode = 'softphone') {
    setProviderInStore(next, nextMode);
    if (config?.preferredProvider !== next) setPreference.mutate(next);
  }

  const ready = provider === 'telecmi' ? telecmiReady : twilioReady;

  return {
    config,
    provider,
    mode,
    switchTo,
    /** The active provider can place a call right now. */
    ready,
    /** Any provider at all can dial — used to decide softphone vs `tel:` fallback. */
    anyReady: twilioReady || telecmiReady,
    twilioReady,
    telecmiReady,
    /** Both configured → show the switcher. */
    canSwitch: twilioReady && telecmiReady,
    defaultCountryCode:
      (provider === 'telecmi'
        ? config?.providers?.telecmi?.defaultCountryCode
        : config?.providers?.twilio?.defaultCountryCode) ?? config?.defaultCountryCode ?? '',
  };
}
