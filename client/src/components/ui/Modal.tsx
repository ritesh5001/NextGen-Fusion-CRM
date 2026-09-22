import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useBodyScrollLock } from './Sheet';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

export function Modal({ open, onClose, title, children, footer, size = 'md' }: Props) {
  // Without this the page keeps scrolling under the sheet on iOS, and the modal
  // "jumps" back to a different scroll position when it closes.
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-gray-950/40 backdrop-blur-sm p-0 sm:items-center sm:p-4">
      {/* Backdrop click-to-dismiss, behind the panel. */}
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default" />
      <div
        className={`relative flex max-h-[92dvh] w-full ${sizes[size]} flex-col rounded-t-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900 sm:max-h-[92vh] sm:rounded-2xl`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-5 sm:py-3.5">
          <h3 className="min-w-0 truncate pr-2 font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="tap -mr-1 flex shrink-0 items-center justify-center rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={20} />
          </button>
        </div>
        <div className="overscroll-none-y flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-gray-200 px-4 pb-safe pt-3 dark:border-gray-700 sm:px-5">
            <div className="pb-3">{footer}</div>
          </div>
        ) : (
          <div className="pb-safe shrink-0 sm:hidden" />
        )}
      </div>
    </div>
  );
}
