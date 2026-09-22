import { useRef } from 'react';

/** The 12 DTMF keys, with the letters phone menus refer to ("press 2 for sales"). */
const KEYS: { digit: string; letters?: string }[] = [
  { digit: '1' },
  { digit: '2', letters: 'ABC' },
  { digit: '3', letters: 'DEF' },
  { digit: '4', letters: 'GHI' },
  { digit: '5', letters: 'JKL' },
  { digit: '6', letters: 'MNO' },
  { digit: '7', letters: 'PQRS' },
  { digit: '8', letters: 'TUV' },
  { digit: '9', letters: 'WXYZ' },
  { digit: '*' },
  { digit: '0', letters: '+' },
  { digit: '#' },
];

const LONG_PRESS_MS = 500;

/**
 * A phone keypad. Used both to compose a number before dialling and to send
 * DTMF tones during a call (IVR menus: "press 1 for reception").
 *
 * `longPressPlus` turns holding `0` into `+` (the usual phone convention) for
 * composing international numbers. It's opt-in because mid-call `0` must always
 * send a literal DTMF 0 to the menu.
 */
export function Keypad({
  onPress,
  disabled,
  size = 'md',
  longPressPlus = false,
}: {
  onPress: (digit: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  longPressPlus?: boolean;
}) {
  // Roomier keys on a phone — this is the one control people aim at while
  // holding the device one-handed.
  const pad = size === 'sm' ? 'py-2.5 md:py-2' : 'py-3';
  const timer = useRef<number | null>(null);
  const firedPlus = useRef(false);

  function startHold(digit: string) {
    if (!longPressPlus || digit !== '0') return;
    firedPlus.current = false;
    timer.current = window.setTimeout(() => {
      firedPlus.current = true;
      onPress('+');
    }, LONG_PRESS_MS);
  }

  function cancelHold() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }

  function press(digit: string) {
    cancelHold();
    // The hold already inserted '+' — don't also append a '0' on release.
    if (firedPlus.current) {
      firedPlus.current = false;
      return;
    }
    onPress(digit);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {KEYS.map(({ digit, letters }) => {
        const plusKey = longPressPlus && digit === '0';
        return (
          <button
            key={digit}
            type="button"
            disabled={disabled}
            onClick={() => press(digit)}
            onPointerDown={() => startHold(digit)}
            onPointerUp={cancelHold}
            onPointerLeave={cancelHold}
            onContextMenu={(e) => plusKey && e.preventDefault()}
            aria-label={plusKey ? 'Key 0, hold for plus' : `Key ${digit}`}
            title={plusKey ? 'Hold for +' : undefined}
            className={`flex touch-manipulation select-none flex-col items-center justify-center rounded-lg border border-slate-200 bg-white ${pad} leading-none transition-colors hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700`}
          >
            <span className="text-xl font-semibold text-slate-800 dark:text-slate-100 md:text-lg">{digit}</span>
            {letters && (
              <span className="mt-0.5 text-[9px] font-medium tracking-wider text-slate-400 dark:text-slate-500">
                {letters}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export const KEYPAD_DIGITS = KEYS.map((k) => k.digit);
