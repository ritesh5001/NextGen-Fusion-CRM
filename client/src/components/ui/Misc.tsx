import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center p-8">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-10 text-center">
      <p className="font-medium text-gray-600 dark:text-gray-300">{title}</p>
      {hint && <p className="mt-1 text-sm text-gray-400 dark:text-gray-500">{hint}</p>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="h-full p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 sm:text-xs">
            {label}
          </p>
          <p className="text-gradient mt-1 w-fit text-xl font-bold sm:text-2xl">{value}</p>
          {sub && <p className="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
        </div>
        {icon && (
          <div className="shrink-0 rounded-xl border border-gray-200 bg-gray-50 p-2 text-brand-600 dark:border-gray-800 dark:bg-gray-800/60 dark:text-brand-300">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

/** On/off switch. Shared by the integration panels and the menu customizer. */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-brand-gradient-br' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
