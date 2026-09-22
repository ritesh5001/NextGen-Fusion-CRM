import { Link } from 'react-router-dom';
import { Phone, Contact, Star, ListChecks, CalendarClock, AlertTriangle } from 'lucide-react';
import { useMyStats } from '@/api/reports';
import { useAuthStore } from '@/store/auth';
import { Card, Spinner, StatCard } from '@/components/ui/Misc';
import { DISPOSITION_LABELS } from '@/lib/constants';
import type { Disposition } from '@/types';

export function TelecallerDashboard() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading } = useMyStats();
  if (isLoading || !data) return <Spinner />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Hi, {user?.name} 👋</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Here's your work for today.</p>
      </div>

      {/* Daily target progress */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase text-slate-400 dark:text-slate-500">Today's calls</p>
            <p className="text-3xl font-bold text-slate-800 dark:text-slate-100">
              {data.callsToday}
              <span className="text-base font-normal text-slate-400 dark:text-slate-500"> / {data.dailyTarget}</span>
            </p>
          </div>
          <div className="rounded-lg bg-brand-50 p-3 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
            <Phone size={22} />
          </div>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${Math.min(100, data.targetProgress)}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{data.targetProgress}% of daily target</p>
      </Card>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
        <Link to="/contacts" className="block h-full">
          <StatCard label="My Contacts" value={data.myContacts} icon={<Contact size={18} />} />
        </Link>
        <Link to="/leads" className="block h-full">
          <StatCard label="Leads" value={data.myLeads} icon={<Star size={18} />} />
        </Link>
        <Link to="/tasks" className="block h-full">
          <StatCard label="Pending Tasks" value={data.pendingTasks} icon={<ListChecks size={18} />} />
        </Link>
        <Link to="/followups" className="block h-full">
          <StatCard
            label="Follow-ups Today"
            value={data.followUpsToday}
            icon={<CalendarClock size={18} />}
          />
        </Link>
        <Link to="/followups" className="block h-full">
          <StatCard
            label="Overdue"
            value={data.overdueFollowUps}
            icon={<AlertTriangle size={18} />}
          />
        </Link>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Today's call outcomes</h2>
        {data.dispositionToday.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">No calls logged yet today</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.dispositionToday.map((d) => (
              <span
                key={d._id}
                className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {DISPOSITION_LABELS[d._id as Disposition] ?? d._id}: <b>{d.count}</b>
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
