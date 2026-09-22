import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
type Size = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  // nextgenfusion.in's CTAs are solid black ("Book a Free Call"); inverted in dark mode.
  primary:
    'bg-gray-950 text-white hover:bg-gray-800 disabled:bg-gray-400 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200 dark:disabled:bg-gray-600',
  secondary:
    'bg-white text-gray-900 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700 dark:hover:bg-gray-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:bg-rose-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
  ghost: 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
};

// Buttons are roomier on phones and snap back to the dense desktop metrics at
// `md` — the same breakpoint where the tables and sidebar come back.
const sizes: Record<Size, string> = {
  sm: 'min-h-9 px-3 py-2 text-xs md:min-h-0 md:px-2.5 md:py-1.5',
  md: 'min-h-11 px-4 py-2.5 text-sm md:min-h-0 md:py-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className = '',
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      className={`inline-flex touch-manipulation items-center justify-center gap-1.5 whitespace-nowrap rounded-btn font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-70 ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && (
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}
