import { forwardRef } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';

const base =
  'w-full min-h-11 rounded-btn border border-gray-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-gray-400 hover:border-gray-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:ring-brand-900/40 dark:disabled:bg-gray-900 md:min-h-0';

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300">
      {children}
    </label>
  );
}

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <p className="mt-1 text-xs text-rose-600">{children}</p>;
}

// Ref-forwarding so callers can focus a field (e.g. the contact form autofocuses
// its first input when it opens).
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input ref={ref} {...props} className={`${base} ${props.className ?? ''}`} />;
  }
);

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${base} ${props.className ?? ''}`} />;
}

// pr-8 keeps a long option label from running under the native dropdown arrow —
// at 16px (the mobile form-control size) that collision is unavoidable otherwise.
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${base} truncate bg-white pr-8 dark:bg-gray-900 ${props.className ?? ''}`}
    />
  );
}
