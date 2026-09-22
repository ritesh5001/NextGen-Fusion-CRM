import { useState } from 'react';
import { Plus, Pencil, KeyRound, Power, Trash2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  useTelecallers,
  useSetTelecallerStatus,
  useResetTelecallerPassword,
  useDeleteTelecaller,
} from '@/api/users';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui/Misc';
import { TelecallerFormModal } from '@/features/telecallers/TelecallerFormModal';
import { fmtRelative } from '@/lib/format';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import type { User } from '@/types';

export function TelecallersPage() {
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);
  const { data, isLoading } = useTelecallers({ search: debouncedSearch });
  const setStatus = useSetTelecallerStatus();
  const resetPw = useResetTelecallerPassword();
  const del = useDeleteTelecaller();

  async function handleReset(u: User) {
    const pw = prompt(`New password for ${u.name}:`);
    if (!pw) return;
    try {
      await resetPw.mutateAsync({ id: u._id, newPassword: pw });
      toast.success('Password reset');
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  async function handleDelete(u: User) {
    if (!confirm(`Delete user "${u.name}"? This cannot be undone.`)) return;
    try {
      await del.mutateAsync(u._id);
      toast.success('User deleted');
    } catch (e) {
      toast.error(apiError(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Users</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          <Plus size={16} /> Add user
        </Button>
      </div>

      <div className="relative sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={16} />
        <Input
          className="pl-9"
          placeholder="Search by name, email, phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : !data?.data.length ? (
          <EmptyState title="No users yet" hint="Add your first user to get started." />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.data.map((u) => (
              <div key={u._id} className="p-3 sm:p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
                    {u.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-100">{u.name}</p>
                      <Badge className={u.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="truncate text-sm text-slate-500 dark:text-slate-400">{u.email}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Target: {u.dailyTarget}/day · Last login {fmtRelative(u.lastLoginAt)}
                    </p>
                  </div>
                  {/* Desktop keeps the compact icon rail beside the row. */}
                  <div className="hidden shrink-0 gap-1 sm:flex">
                    <Button size="sm" variant="ghost" title="Edit" onClick={() => { setEditing(u); setModalOpen(true); }}>
                      <Pencil size={15} />
                    </Button>
                    <Button size="sm" variant="ghost" title="Reset password" onClick={() => handleReset(u)}>
                      <KeyRound size={15} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={u.isActive ? 'Deactivate' : 'Activate'}
                      onClick={() => setStatus.mutate({ id: u._id, isActive: !u.isActive })}
                    >
                      <Power size={15} className={u.isActive ? 'text-emerald-600' : 'text-slate-400'} />
                    </Button>
                    <Button size="sm" variant="ghost" title="Delete" onClick={() => handleDelete(u)}>
                      <Trash2 size={15} className="text-rose-500" />
                    </Button>
                  </div>
                </div>

                {/* Phone: labelled, full-width actions — four unlabelled 30px
                    icons squeezed at the end of a wrapped row is a guessing game. */}
                <div className="mt-2.5 grid grid-cols-4 gap-1.5 sm:hidden">
                  <Button size="sm" variant="secondary" onClick={() => { setEditing(u); setModalOpen(true); }}>
                    <Pencil size={14} /> Edit
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleReset(u)}>
                    <KeyRound size={14} /> Pass
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setStatus.mutate({ id: u._id, isActive: !u.isActive })}
                  >
                    <Power size={14} className={u.isActive ? 'text-emerald-600' : 'text-slate-400'} />
                    {u.isActive ? 'On' : 'Off'}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleDelete(u)}>
                    <Trash2 size={14} className="text-rose-500" /> Del
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <TelecallerFormModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />
    </div>
  );
}
