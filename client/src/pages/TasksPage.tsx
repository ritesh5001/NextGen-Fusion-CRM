import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, ListChecks, Search } from 'lucide-react';
import { useTask, useTaskStats, useTasks } from '@/api/tasks';
import { useTelecallers } from '@/api/users';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/Button';
import { EmptyState, Spinner } from '@/components/ui/Misc';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { TaskComposer } from '@/features/tasks/TaskComposer';
import { TaskTable } from '@/features/tasks/TaskTable';

/** Status tabs. `value` is what the API receives ('' = everything). */
const TABS = [
  { key: 'open', label: 'To do', value: 'pending,in_progress' },
  { key: 'completed', label: 'Done', value: 'completed' },
  { key: 'cancelled', label: 'Cancelled', value: 'cancelled' },
  { key: 'all', label: 'All', value: '' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const SCOPES = [
  { value: 'all', label: 'Any due date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'undated', label: 'No due date' },
];

export function TasksPage() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'superadmin';

  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>('open');
  const [scope, setScope] = useState('all');
  const [assignedTo, setAssignedTo] = useState('');
  const [priority, setPriority] = useState('');
  const [term, setTerm] = useState('');
  const search = useDebouncedValue(term, 300);
  const [page, setPage] = useState(1);

  const deepLinked = params.get('task');

  const wantedStatus = TABS.find((t) => t.key === tab)!.value;
  const needsMultiStatus = wantedStatus.includes(',');

  const baseQuery = useMemo(
    () => ({
      scope,
      assignedTo: isAdmin ? assignedTo : '',
      priority,
      search,
      page,
      limit: 50,
    }),
    [scope, assignedTo, priority, search, page, isAdmin]
  );

  // If the counts can't be fetched, show '—' rather than a confident, wrong 0.
  const { data: stats, isError: statsFailed } = useTaskStats(baseQuery);

  /*
   * COMPATIBILITY SHIM — delete once the API is redeployed.
   *
   * `/tasks/stats` and comma-separated `status` shipped in the same commit, so a
   * failing stats call means the API also can't read `status=pending,in_progress`
   * — it matches that literally and returns nothing, leaving "To do" empty even
   * though the tasks exist. When that's detected, ask for every status and narrow
   * here instead. Costs exact pagination totals on the multi-status tabs.
   */
  const legacyApi = statsFailed;
  const filterLocally = legacyApi && needsMultiStatus;

  const query = useMemo(
    () => ({ ...baseQuery, status: filterLocally ? '' : wantedStatus }),
    [baseQuery, filterLocally, wantedStatus]
  );

  const { data, isLoading } = useTasks(query);
  const { data: telecallers } = useTelecallers({ isActive: 'true', limit: 200 }, { enabled: isAdmin });

  // Filters change the result set — go back to the first page.
  useEffect(() => setPage(1), [tab, scope, assignedTo, priority, search]);

  // A notification deep link may point at a task the current filters hide.
  useEffect(() => {
    if (deepLinked) setTab('all');
  }, [deepLinked]);

  const wanted = wantedStatus ? wantedStatus.split(',') : null;
  const pageTasks = (data?.data ?? []).filter(
    (t) => !filterLocally || !wanted || wanted.includes(t.status)
  );
  // A notification can point at a task that falls outside the current page —
  // fetch that one directly and show it at the top rather than nothing at all.
  const missingDeepLink = Boolean(deepLinked) && !pageTasks.some((t) => t._id === deepLinked);
  const { data: linkedTask } = useTask(missingDeepLink ? deepLinked : null);
  const tasks = linkedTask && missingDeepLink ? [linkedTask, ...pageTasks] : pageTasks;
  const totalPages = data?.pagination.totalPages ?? 1;
  const filtered = Boolean(search || priority || assignedTo || scope !== 'all');

  const cards = [
    {
      label: 'To do',
      value: (stats?.pending ?? 0) + (stats?.in_progress ?? 0),
      icon: <ListChecks size={16} />,
      active: tab === 'open' && scope === 'all',
      on: () => {
        setTab('open');
        setScope('all');
      },
    },
    {
      label: 'Overdue',
      value: stats?.overdue ?? 0,
      icon: <AlertTriangle size={16} />,
      danger: !statsFailed && (stats?.overdue ?? 0) > 0,
      active: scope === 'overdue',
      on: () => {
        setTab('open');
        setScope('overdue');
      },
    },
    {
      label: 'Due today',
      value: stats?.dueToday ?? 0,
      icon: <CalendarClock size={16} />,
      active: scope === 'today',
      on: () => {
        setTab('open');
        setScope('today');
      },
    },
    {
      label: 'Completed',
      value: stats?.completed ?? 0,
      icon: <CheckCircle2 size={16} />,
      active: tab === 'completed',
      on: () => {
        setTab('completed');
        setScope('all');
      },
    },
  ];

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">{isAdmin ? 'Tasks' : 'My Tasks'}</h1>
        <p className="hidden text-sm text-slate-500 dark:text-slate-400 sm:block">
          {isAdmin
            ? 'Assign work to your users and see exactly when it got done.'
            : 'Everything assigned to you. Tick it off and say when you did it.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.label}
            onClick={c.on}
            className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors ${
              c.active
                ? 'border-brand-500 bg-brand-50 dark:border-brand-500 dark:bg-brand-500/10'
                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
            }`}
          >
            <span
              className={`rounded-lg p-1.5 ${
                c.danger
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'
                  : 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400'
              }`}
            >
              {c.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-bold leading-tight tabular-nums text-slate-800 dark:text-slate-100">
                {statsFailed ? <span className="text-slate-400 dark:text-slate-600">—</span> : c.value}
              </span>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{c.label}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Assigning happens right here — no dialog. */}
      {isAdmin && <TaskComposer />}

      <div className="space-y-2 md:flex md:flex-wrap md:items-center md:gap-2 md:space-y-0">
        {/* Swipeable on a phone, wrapped on desktop — either way the four tabs
            stay on one line instead of stealing two rows from the list. */}
        <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 md:mx-0 md:flex-wrap md:px-0">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors md:min-h-0 md:px-3 md:py-1.5 ${
                tab === t.key
                  ? 'bg-brand-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative md:min-w-40 md:flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={15}
            aria-hidden
          />
          <input
            aria-label="Search tasks"
            type="search"
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-brand-500/25 md:min-h-0"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search tasks…"
          />
        </div>

        <div className="grid grid-cols-2 gap-2 md:contents">
          {isAdmin && (
            <select
              aria-label="Filter by assignee"
              className="col-span-2 min-h-11 w-full truncate rounded-lg border border-slate-300 bg-white py-2 pl-2 pr-7 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 md:col-span-1 md:min-h-0 md:w-40 md:shrink-0 md:pr-2"
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
            >
              <option value="">Everyone</option>
              {telecallers?.data.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          <select
            aria-label="Filter by due date"
            className="min-h-11 w-full truncate rounded-lg border border-slate-300 bg-white py-2 pl-2 pr-7 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 md:pr-2 md:min-h-0 md:w-36 md:shrink-0"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by priority"
            className="min-h-11 w-full truncate rounded-lg border border-slate-300 bg-white py-2 pl-2 pr-7 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 md:pr-2 md:min-h-0 md:w-32 md:shrink-0"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">Any priority</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {isLoading && !data ? (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Spinner />
        </div>
      ) : !tasks.length ? (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <EmptyState
            title={filtered ? 'Nothing matches those filters' : tab === 'open' ? 'All caught up 🎉' : 'No tasks here'}
            hint={
              filtered
                ? 'Try clearing the search or filters.'
                : isAdmin
                  ? 'Type a task in the bar above, pick who, and press Enter.'
                  : 'New tasks from your admin will show up here.'
            }
          />
        </div>
      ) : (
        <TaskTable
          tasks={tasks}
          isAdmin={isAdmin}
          people={telecallers?.data ?? []}
          openId={deepLinked}
          onOpenHandled={() => {
            params.delete('task');
            setParams(params, { replace: true });
          }}
        />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {data?.pagination.page ?? page} / {totalPages}
          </span>
          <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
