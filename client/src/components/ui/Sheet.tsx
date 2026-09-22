import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Locks the page behind an overlay so iOS doesn't scroll it under the sheet. */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * A bottom sheet for phone-sized screens: slides up from the bottom edge, sized
 * to its content, dismissed by the backdrop or the drag handle. Used for the
 * things that are a dropdown or a popover on desktop but need a thumb-reachable
 * surface on a phone (the nav overflow menu, filters, row actions).
 */
export function Sheet({ open, onClose, title, children, footer }: Props) {
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
      />
      <div className="relative flex max-h-[85vh] w-full flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        {/* Drag handle — the affordance people expect on a sheet. */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600"
        />
        {title && (
          <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Close"
              className="tap -mr-2 flex items-center justify-center rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X size={20} />
            </button>
          </div>
        )}
        <div className="overscroll-none-y flex-1 overflow-y-auto px-4 pb-4 pt-1">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-slate-200 px-4 pb-safe pt-3 dark:border-slate-700">
            <div className="pb-3">{footer}</div>
          </div>
        )}
        {!footer && <div className="pb-safe shrink-0" />}
      </div>
    </div>
  );
}
