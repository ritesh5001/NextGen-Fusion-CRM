import { Users, Contact, Phone, TrendingUp, ListChecks } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useOverview } from '@/api/reports';
import { useIsMobile } from '@/lib/useMediaQuery';
import { Card, Spinner, StatCard } from '@/components/ui/Misc';
import { LEAD_STATUS_LABELS } from '@/lib/constants';
import type { LeadStatus } from '@/types';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#16a34a', '#1f2937'];

export function SuperadminDashboard() {
  const { data, isLoading } = useOverview();
  const isMobile = useIsMobile();
  if (isLoading || !data) return <Spinner />;

  const statusData = data.leadsByStatus.map((s) => ({
    name: LEAD_STATUS_LABELS[s._id as LeadStatus] ?? s._id,
    value: s.count,
  }));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Dashboard</h1>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
        <StatCard
          label="Users"
          value={data.totalTelecallers}
          sub={`${data.activeTelecallers} active`}
          icon={<Users size={18} />}
        />
        <StatCard label="Total Leads" value={data.totalLeads} icon={<Contact size={18} />} />
        <StatCard label="Calls Today" value={data.callsToday} icon={<Phone size={18} />} />
        <StatCard
          label="Conversion"
          value={`${data.conversionRate}%`}
          sub={`${data.convertedLeads} converted`}
          icon={<TrendingUp size={18} />}
        />
        <Link to="/tasks" className="block h-full">
          <StatCard
            label="Open Tasks"
            value={data.pendingTasks}
            sub="Assigned, not yet done"
            icon={<ListChecks size={18} />}
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Leads by status</h2>
          <ResponsiveContainer width="100%" height={isMobile ? 200 : 240}>
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                outerRadius={isMobile ? 70 : 90}
                label={!isMobile}
              >
                {statusData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          {/* Slice labels don't fit on a phone, so the breakdown is spelled out. */}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 md:hidden">
            {statusData.map((s, i) => (
              <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                />
                {s.name} <b className="text-slate-700 dark:text-slate-200">{s.value}</b>
              </span>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Calls today by user</h2>
          {data.perTelecaller.length === 0 ? (
            <p className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">No calls logged today</p>
          ) : (
            <ResponsiveContainer width="100%" height={isMobile ? 200 : 240}>
              <BarChart data={data.perTelecaller} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="calls" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">User performance (today)</h2>

        {/* Phone: one block per user. */}
        <div className="space-y-3 md:hidden">
          {data.perTelecaller.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">No activity yet today</p>
          )}
          {data.perTelecaller.map((t) => {
            const pct = t.dailyTarget ? Math.round((t.calls / t.dailyTarget) * 100) : 0;
            return (
              <div key={t._id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                    {t.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {t.calls} / {t.dailyTarget} · {pct}%
                  </span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-400 dark:text-slate-500">
                <th className="pb-2">Name</th>
                <th className="pb-2">Calls</th>
                <th className="pb-2">Target</th>
                <th className="pb-2">Progress</th>
              </tr>
            </thead>
            <tbody>
              {data.perTelecaller.map((t) => {
                const pct = t.dailyTarget ? Math.round((t.calls / t.dailyTarget) * 100) : 0;
                return (
                  <tr key={t._id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{t.name}</td>
                    <td className="py-2">{t.calls}</td>
                    <td className="py-2">{t.dailyTarget}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {data.perTelecaller.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-slate-400">
                    No activity yet today
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
