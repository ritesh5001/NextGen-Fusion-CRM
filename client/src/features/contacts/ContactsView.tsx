import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Upload, Search, Download, X, SlidersHorizontal, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useLeads,
  useLeadStats,
  useAssignLead,
  useBulkAssignLeads,
  useBulkDeleteLeads,
  fetchLeadsForExport,
  type LeadQuery,
} from '@/api/leads';
import { useTelecallers } from '@/api/users';
import { apiError } from '@/api/client';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { ContactsTable, ColumnsMenu, ShowNumbersToggle } from './ContactsTable';
import { ContactFormModal } from './ContactFormModal';
import { ImportModal } from '@/features/leads/ImportModal';
import { downloadLeadsCsv } from '@/lib/csv';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { useIsMobile } from '@/lib/useMediaQuery';
import { LEAD_STATUS_LABELS } from '@/lib/constants';
import type { LeadStatus } from '@/types';

const STATUSES: LeadStatus[] = [
  'new',
  'assigned',
  'in_progress',
  'interested',
  'callback',
  'not_interested',
  'converted',
  'dnd',
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </span>
      {children}
    </div>
  );
}

const SORT_FIELDS: { value: string; label: string }[] = [
  { value: 'createdAt', label: 'Added' },
  { value: 'name', label: 'Name' },
  { value: 'company', label: 'Company' },
  { value: 'country', label: 'Country' },
  { value: 'callStatus', label: 'Call status' },
  { value: 'lastContactedAt', label: 'Last contacted' },
];

export function ContactsView({ mode }: { mode: 'contacts' | 'leads' }) {
  const role = useAuthStore((s) => s.user!.role);
  const isAdmin = role === 'superadmin';
  const isContacts = mode === 'contacts';
  const isMobile = useIsMobile();

  const density = useUiStore((s) => s.density);
  const setDensity = useUiStore((s) => s.setDensity);
  const filtersCollapsed = useUiStore((s) => s.filtersCollapsed);
  const toggleFilters = useUiStore((s) => s.toggleFilters);
  const setContactFilters = useUiStore((s) => s.setContactFilters);

  // Restore this view's last-used filters (persisted per user in localStorage) on mount.
  const saved = useMemo(() => useUiStore.getState().contactFilters[mode], [mode]);

  const [search, setSearch] = useState(saved.search);
  const [status, setStatus] = useState(saved.status);
  const [callStatus, setCallStatus] = useState(saved.callStatus);
  const [assignedTo, setAssignedTo] = useState(saved.assignedTo);
  const [qualifiedChip, setQualifiedChip] = useState(saved.qualifiedChip);
  const [sortBy, setSortBy] = useState(saved.sortBy);
  const [order, setOrder] = useState<'asc' | 'desc'>(saved.order);
  const [page, setPage] = useState(saved.page);
  const [limit, setLimit] = useState(saved.limit);
  const [selected, setSelected] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  // On a phone the filter panel is a bottom sheet, not an inline block that
  // shoves the list off screen — so it needs its own open state.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // The input stays instant; the network query only fires ~300ms after typing stops.
  const debouncedSearch = useDebouncedValue(search, 300);

  // Persist filter/sort/paging changes so they survive a page refresh.
  useEffect(() => {
    setContactFilters(mode, { search, status, callStatus, assignedTo, qualifiedChip, sortBy, order, page, limit });
  }, [mode, search, status, callStatus, assignedTo, qualifiedChip, sortBy, order, page, limit, setContactFilters]);

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const query: LeadQuery = useMemo(
    () => ({
      search: debouncedSearch,
      status,
      callStatus,
      assignedTo: isAdmin ? assignedTo : undefined,
      qualified: isContacts ? (qualifiedChip ? 'true' : undefined) : 'true',
      sortBy,
      order,
      page,
      limit,
    }),
    [debouncedSearch, status, callStatus, assignedTo, isAdmin, isContacts, qualifiedChip, sortBy, order, page, limit]
  );

  const { data, isLoading } = useLeads(query);
  const { data: stats } = useLeadStats(query);

  const leads = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;
  const selectable = isAdmin && isContacts;

  const { data: tcData } = useTelecallers({ isActive: 'true', limit: 100 }, { enabled: isAdmin });
  const telecallers = tcData?.data ?? [];
  const assign = useAssignLead();
  const bulkAssign = useBulkAssignLeads();
  const bulkDelete = useBulkDeleteLeads();

  function resetPage() { setPage(1); }

  function handleAssign(leadId: string, telecallerId: string, name: string) {
    assign.mutate(
      { id: leadId, assignedTo: telecallerId, assignedToName: name },
      { onSuccess: () => toast.success('Assigned'), onError: (err) => toast.error(apiError(err)) }
    );
  }
  function handleBulkAssign(telecallerId: string) {
    const t = telecallers.find((x) => x._id === telecallerId);
    if (!t || !selected.length) return;
    bulkAssign.mutate(
      { leadIds: selected, assignedTo: telecallerId, assignedToName: t.name },
      {
        onSuccess: () => { toast.success(`Assigned ${selected.length} to ${t.name}`); setSelected([]); },
        onError: (err) => toast.error(apiError(err)),
      }
    );
  }
  function handleBulkDelete() {
    if (!selected.length) return;
    if (!confirm(`Delete ${selected.length} contact${selected.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    bulkDelete.mutate(selected, {
      onSuccess: () => { toast.success(`Deleted ${selected.length} contact${selected.length > 1 ? 's' : ''}`); setSelected([]); },
      onError: (err) => toast.error(apiError(err)),
    });
  }
  function onSort(field: string) {
    if (sortBy === field) setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(field); setOrder('asc'); }
    resetPage();
  }
  function setCallChip(v: string) {
    setQualifiedChip(false);
    setCallStatus((cur) => (cur === v ? '' : v));
    resetPage();
  }
  function clearFilters() {
    setSearch(''); setStatus(''); setCallStatus(''); setAssignedTo(''); setQualifiedChip(false); resetPage();
  }
  async function handleExport() {
    setExporting(true);
    try {
      const rows = await fetchLeadsForExport(query);
      downloadLeadsCsv(rows, isContacts ? 'contacts.csv' : 'leads.csv');
      toast.success(`Exported ${rows.length} row(s)`);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setExporting(false);
    }
  }
  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }
  function toggleAll() {
    setSelected((s) => (leads.every((l) => s.includes(l._id)) ? [] : leads.map((l) => l._id)));
  }

  const hasFilters = !!(search || status || callStatus || assignedTo || qualifiedChip);
  const activeFilterCount = [search, status, callStatus, assignedTo].filter(Boolean).length + (qualifiedChip ? 1 : 0);
  const title = isContacts ? (isAdmin ? 'Contacts' : 'My Contacts') : isAdmin ? 'Leads' : 'My Leads';

  const chips = stats
    ? [
        { key: 'total', label: 'Total', value: stats.total, active: !callStatus && !qualifiedChip, onClick: clearFilters },
        { key: 'pending', label: 'Not Called', value: stats.notCalled, active: callStatus === 'pending', onClick: () => setCallChip('pending') },
        { key: 'done', label: 'Call Done', value: stats.done, active: callStatus === 'done', onClick: () => setCallChip('done') },
        { key: 'not_done', label: 'Not Done', value: stats.notDone, active: callStatus === 'not_done', onClick: () => setCallChip('not_done') },
        { key: 'leads', label: 'Leads', value: stats.leads, active: qualifiedChip, onClick: () => { setCallStatus(''); setQualifiedChip((q) => !q); resetPage(); } },
      ]
    : [];

  const searchBox = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={15} />
      <Input
        className="pl-9"
        type="search"
        inputMode="search"
        placeholder="Search name, phone, email, company..."
        value={search}
        onChange={(e) => { setSearch(e.target.value); resetPage(); }}
      />
    </div>
  );

  /* The filter controls — inline under the desktop bar, inside a sheet on a phone. */
  const filterFields = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-7">
      <Field label="Status">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Call">
        <Select value={callStatus} onChange={(e) => { setQualifiedChip(false); setCallStatus(e.target.value); resetPage(); }}>
          <option value="">All calls</option>
          <option value="pending">Not Called</option>
          <option value="done">Call Done</option>
          <option value="not_done">Not Done</option>
        </Select>
      </Field>
      {isAdmin && (
        <Field label="Assignee">
          <Select value={assignedTo} onChange={(e) => { setAssignedTo(e.target.value); resetPage(); }}>
            <option value="">All assignees</option>
            <option value="unassigned">Unassigned</option>
            {telecallers.map((t) => (
              <option key={t._id} value={t._id}>{t.name}</option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Sort by">
        <Select value={sortBy} onChange={(e) => { setSortBy(e.target.value); resetPage(); }}>
          {SORT_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </Select>
      </Field>
      <Field label="Order">
        <button
          onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
          className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 md:min-h-0"
        >
          {order === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
        </button>
      </Field>
      <Field label="Rows">
        <Select value={String(limit)} onChange={(e) => { setLimit(Number(e.target.value)); resetPage(); }}>
          <option value="50">50 / page</option>
          <option value="100">100 / page</option>
          <option value="200">200 / page</option>
        </Select>
      </Field>
      {/* Density only changes the desktop table's row padding. */}
      <Field label="Density">
        <div className="hidden w-full overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600 md:flex">
          <button
            onClick={() => setDensity('comfortable')}
            className={`flex-1 py-2 text-xs ${density === 'comfortable' ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'}`}
          >
            Cozy
          </button>
          <button
            onClick={() => setDensity('compact')}
            className={`flex-1 py-2 text-xs ${density === 'compact' ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'}`}
          >
            Compact
          </button>
        </div>
        {/* …so on a phone that slot carries the phone-number privacy toggle instead. */}
        <div className="md:hidden">
          <ShowNumbersToggle full />
        </div>
      </Field>
      {hasFilters && (
        <Field label=" ">
          <Button variant="ghost" className="w-full" onClick={clearFilters}>
            <X size={14} /> Clear filters
          </Button>
        </Field>
      )}
    </div>
  );

  const pager =
    totalPages > 1 ? (
      <>
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span className="px-1 text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {data?.pagination.page ?? page} / {totalPages}
        </span>
        <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </>
    ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">

      {/* ── Desktop: one compact top bar ── */}
      <div className="hidden flex-wrap items-center gap-x-2 gap-y-1.5 md:flex">
        <h1 className="shrink-0 text-base font-bold text-slate-800 dark:text-slate-100">
          {title} <span className="text-xs font-normal text-slate-400 dark:text-slate-500">({total})</span>
        </h1>

        {isContacts && chips.map((c) => (
          <button
            key={c.key}
            onClick={c.onClick}
            className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
              c.active
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/15 dark:text-brand-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {c.label} <span className="font-semibold">{c.value}</span>
          </button>
        ))}

        <div className="flex-1" />

        <button
          onClick={toggleFilters}
          className={`flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            !filtersCollapsed
              ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/15 dark:text-brand-300'
              : hasFilters
              ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/15 dark:text-brand-300'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
          }`}
        >
          <SlidersHorizontal size={13} />
          Filters
          {filtersCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          {filtersCollapsed && hasFilters && (
            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-brand-500" />
          )}
        </button>

        <ShowNumbersToggle />
        <ColumnsMenu isAdmin={isAdmin} />

        <Button size="sm" variant="secondary" onClick={handleExport} loading={exporting}>
          <Download size={14} /> Export
        </Button>
        {selectable && (
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload size={14} /> Import
          </Button>
        )}
        {isAdmin && (
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus size={14} /> Add
          </Button>
        )}

        {pager && <div className="flex shrink-0 items-center gap-1">{pager}</div>}
      </div>

      {/* ── Mobile: title row, search, then a swipeable chip strip ── */}
      <div className="space-y-2 md:hidden">
        <div className="flex items-center gap-1.5">
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-slate-800 dark:text-slate-100">
            {title} <span className="text-sm font-normal text-slate-400 dark:text-slate-500">({total})</span>
          </h1>
          <button
            onClick={() => setMobileFiltersOpen(true)}
            aria-label="Filters"
            className={`tap relative flex items-center justify-center rounded-lg border px-3 ${
              hasFilters
                ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/15 dark:text-brand-300'
                : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            <SlidersHorizontal size={18} />
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            aria-label="Export CSV"
            className="tap flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <Download size={18} />
          </button>
          {selectable && (
            <button
              onClick={() => setImportOpen(true)}
              aria-label="Import contacts"
              className="tap flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              <Upload size={18} />
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setFormOpen(true)}
              aria-label="Add contact"
              className="tap flex items-center justify-center rounded-lg bg-brand-600 px-3 text-white"
            >
              <Plus size={20} />
            </button>
          )}
        </div>

        {searchBox}

        {isContacts && !!chips.length && (
          // Bleed to the screen edges so the strip reads as scrollable.
          <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5">
            {chips.map((c) => (
              <button
                key={c.key}
                onClick={c.onClick}
                className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${
                  c.active
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-500 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                {c.label} <span className="font-semibold">{c.value}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Desktop filter panel (the phone gets the sheet below) ── */}
      {!filtersCollapsed && (
        <div className="hidden space-y-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 md:block">
          {searchBox}
          {filterFields}
        </div>
      )}

      {isMobile && (
        <Sheet
          open={mobileFiltersOpen}
          onClose={() => setMobileFiltersOpen(false)}
          title="Filters & sorting"
          footer={
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={clearFilters} disabled={!hasFilters}>
                <X size={15} /> Clear
              </Button>
              <Button className="flex-1" onClick={() => setMobileFiltersOpen(false)}>
                Show {total} result{total === 1 ? '' : 's'}
              </Button>
            </div>
          }
        >
          {filterFields}
        </Sheet>
      )}

      {/* Bulk-action bar */}
      {selectable && selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 p-2 text-sm dark:bg-brand-500/15 dark:text-slate-200 sm:gap-3 sm:px-4">
          <span className="font-medium">{selected.length} selected</span>
          <Select
            className="w-full sm:w-52"
            value=""
            onChange={(e) => handleBulkAssign(e.target.value)}
          >
            <option value="">Assign selected to...</option>
            {telecallers.map((t) => (
              <option key={t._id} value={t._id}>{t.name}</option>
            ))}
          </Select>
          <Button size="sm" variant="danger" onClick={handleBulkDelete} loading={bulkDelete.isPending}>
            <Trash2 size={14} /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      {/* List — takes all remaining vertical space */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-none-y rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <ContactsTable
          leads={leads}
          isLoading={isLoading}
          role={role}
          density={density}
          selectable={selectable}
          selected={selected}
          onToggle={toggle}
          onToggleAll={toggleAll}
          telecallers={telecallers}
          onAssign={isAdmin ? handleAssign : undefined}
          sortBy={sortBy}
          order={order}
          onSort={onSort}
          emptyHint={
            isContacts
              ? isAdmin
                ? 'Import or add contacts to begin.'
                : 'No contacts assigned to you yet.'
              : 'No leads yet — set a call outcome to "Interested" to create one.'
          }
        />
      </div>

      {/* Paging sits under the list on a phone, where the top bar has no room. */}
      {pager && <div className="flex items-center justify-center gap-2 md:hidden">{pager}</div>}

      {isAdmin && (
        <>
          <ContactFormModal open={formOpen} onClose={() => setFormOpen(false)} />
          <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
        </>
      )}
    </div>
  );
}
