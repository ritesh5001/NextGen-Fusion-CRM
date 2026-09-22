import { useCallProvider } from './useCallProvider';
import type { CallProvider } from '@/types';

const LABELS: Record<CallProvider, string> = { twilio: 'Twilio', telecmi: 'TeleCMI' };

/**
 * Lets a telecaller pick which telephony backend they dial with, and — for
 * TeleCMI — whether the call runs through the browser or rings their own phone.
 * Renders nothing unless more than one option is actually available to them.
 */
export function ProviderSwitcher({ className = '' }: { className?: string }) {
  const { provider, mode, switchTo, twilioReady, telecmiReady, canSwitch } = useCallProvider();

  if (!canSwitch && !telecmiReady) return null;

  const options: CallProvider[] = [];
  if (twilioReady) options.push('twilio');
  if (telecmiReady) options.push('telecmi');
  if (options.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {options.length > 1 && (
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
          {options.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => switchTo(p, p === 'telecmi' ? mode : 'softphone')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                provider === p
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {LABELS[p]}
            </button>
          ))}
        </div>
      )}

      {/* TeleCMI can also ring the telecaller's own phone instead of the browser. */}
      {provider === 'telecmi' && (
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600"
            checked={mode === 'click_to_call'}
            onChange={(e) => switchTo('telecmi', e.target.checked ? 'click_to_call' : 'softphone')}
          />
          Ring my phone
        </label>
      )}
    </div>
  );
}
