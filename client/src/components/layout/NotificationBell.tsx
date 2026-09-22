import { useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
} from '@/api/notifications';
import { fmtRelative } from '@/lib/format';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const navigate = useNavigate();

  const unread = data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="tap relative flex items-center justify-center rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="overscroll-none-y absolute right-0 z-40 mt-2 max-h-[70vh] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-700">
              <span className="text-sm font-semibold dark:text-slate-100">Notifications</span>
              {unread > 0 && (
                <button
                  onClick={() => markAll.mutate()}
                  className="flex items-center gap-1 text-xs text-brand-600 hover:underline"
                >
                  <Check size={12} /> Mark all read
                </button>
              )}
            </div>
            {!data?.data.length && (
              <p className="p-6 text-center text-sm text-slate-400 dark:text-slate-500">No notifications</p>
            )}
            {data?.data.map((n) => (
              <button
                key={n._id}
                onClick={() => {
                  markRead.mutate(n._id);
                  if (n.link) navigate(n.link);
                  setOpen(false);
                }}
                className={`block w-full border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-700/50 ${
                  n.isRead ? '' : 'bg-brand-50/40 dark:bg-brand-500/10'
                }`}
              >
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{n.title}</p>
                {n.message && <p className="text-xs text-slate-500 dark:text-slate-400">{n.message}</p>}
                <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{fmtRelative(n.createdAt)}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
