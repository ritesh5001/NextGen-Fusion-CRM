import { useEffect, useReducer } from 'react';
import { Clock } from 'lucide-react';
import { countryCurrentTime } from '@/lib/countries';

// One shared timer ticks all <CountryTime> instances every minute, so a table
// full of rows doesn't spin up hundreds of intervals.
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: () => void) {
  subscribers.add(fn);
  if (!timer) timer = setInterval(() => subscribers.forEach((f) => f()), 60_000);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Shows the current local time for a country (ticks every minute). Renders nothing for unknown countries. */
export function CountryTime({ country, className = '' }: { country?: string | null; className?: string }) {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribe(tick), []);

  const time = countryCurrentTime(country);
  if (!time) return null;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-slate-500 ${className}`}
      title={`Local time in ${country}`}
    >
      <Clock size={10} /> {time}
    </span>
  );
}
