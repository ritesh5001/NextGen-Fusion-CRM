import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth';
import { useWorkspaceStore } from '@/store/workspace';
import { useWorkspaces, useCreateWorkspace, useRenameWorkspace, useDeleteWorkspace } from '@/api/workspaces';
import { apiError } from '@/api/client';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';

export function WorkspaceSwitcher() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'superadmin';
  const activeId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActive = useWorkspaceStore((s) => s.setActiveWorkspace);
  const qc = useQueryClient();

  const { data: workspaces = [] } = useWorkspaces({ enabled: !!user });
  const createMut = useCreateWorkspace();
  const renameMut = useRenameWorkspace();
  const deleteMut = useDeleteWorkspace();

  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<null | 'create' | 'rename' | 'delete'>(null);
  const [name, setName] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  const active = workspaces.find((w) => w._id === activeId) ?? null;

  // Keep the active workspace valid: telecallers are pinned to their own; the
  // superadmin defaults to the first workspace when none/invalid is selected.
  useEffect(() => {
    if (!user) return;
    if (user.role === 'telecaller') {
      if (user.workspace && activeId !== user.workspace) setActive(user.workspace);
      return;
    }
    if (workspaces.length && !workspaces.some((w) => w._id === activeId)) {
      setActive(workspaces[0]._id);
    }
  }, [user, workspaces, activeId, setActive]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  /** Switch the active workspace and drop all cached data so every view reloads scoped. */
  function switchTo(id: string) {
    if (id !== activeId) {
      setActive(id);
      qc.clear();
    }
    setOpen(false);
  }

  async function handleCreate() {
    try {
      const ws = await createMut.mutateAsync(name.trim());
      toast.success(`Workspace "${ws.name}" created`);
      setModal(null);
      setName('');
      switchTo(ws._id); // jump straight into the new (empty) workspace
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function handleRename() {
    if (!active) return;
    try {
      await renameMut.mutateAsync({ id: active._id, name: name.trim() });
      toast.success('Workspace renamed');
      setModal(null);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  async function handleDelete() {
    if (!active) return;
    try {
      await deleteMut.mutateAsync(active._id);
      toast.success(`Workspace "${active.name}" deleted`);
      const next = workspaces.find((w) => w._id !== active._id);
      setModal(null);
      setConfirmName('');
      if (next) switchTo(next._id);
    } catch (err) {
      toast.error(apiError(err));
    }
  }

  const label = active?.name ?? (user?.role === 'telecaller' ? 'Workspace' : 'Select workspace');

  // Telecallers see a static badge — they can't switch or manage workspaces.
  if (!isAdmin) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">
        <Building2 size={16} className="text-brand-600 dark:text-brand-400" />
        <span className="max-w-[10rem] truncate">{label}</span>
      </div>
    );
  }

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <Building2 size={16} className="text-brand-600 dark:text-brand-400" />
          <span className="max-w-[10rem] truncate">{label}</span>
          <ChevronDown size={15} className="text-gray-400" />
        </button>

        {open && (
          <div className="absolute left-0 z-40 mt-1 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
            <div className="max-h-64 overflow-y-auto py-1">
              {workspaces.map((w) => (
                <button
                  key={w._id}
                  onClick={() => switchTo(w._id)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  <span className="truncate">{w.name}</span>
                  {w._id === activeId && <Check size={15} className="shrink-0 text-brand-600 dark:text-brand-400" />}
                </button>
              ))}
            </div>
            <div className="border-t border-gray-200 py-1 dark:border-gray-700">
              <button
                onClick={() => {
                  setName('');
                  setModal('create');
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Plus size={15} /> Create workspace
              </button>
              {active && (
                <button
                  onClick={() => {
                    setName(active.name);
                    setModal('rename');
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <Pencil size={15} /> Rename current
                </button>
              )}
              {active && workspaces.length > 1 && (
                <button
                  onClick={() => {
                    setConfirmName('');
                    setModal('delete');
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                >
                  <Trash2 size={15} /> Delete current
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create / rename */}
      <Modal
        open={modal === 'create' || modal === 'rename'}
        onClose={() => setModal(null)}
        title={modal === 'rename' ? 'Rename workspace' : 'Create workspace'}
        size="sm"
        footer={
          <div className="flex gap-2 [&>*]:flex-1 sm:justify-end sm:[&>*]:flex-none">
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              onClick={modal === 'rename' ? handleRename : handleCreate}
              loading={createMut.isPending || renameMut.isPending}
              disabled={!name.trim()}
            >
              {modal === 'rename' ? 'Save' : 'Create'}
            </Button>
          </div>
        }
      >
        <Label htmlFor="ws-name">Workspace name</Label>
        <Input
          id="ws-name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. NextGen Fusion"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) (modal === 'rename' ? handleRename : handleCreate)();
          }}
        />
      </Modal>

      {/* Delete (typed confirmation) */}
      <Modal
        open={modal === 'delete'}
        onClose={() => setModal(null)}
        title="Delete workspace"
        size="sm"
        footer={
          <div className="flex gap-2 [&>*]:flex-1 sm:justify-end sm:[&>*]:flex-none">
            <Button variant="secondary" onClick={() => setModal(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              loading={deleteMut.isPending}
              disabled={confirmName.trim() !== active?.name}
            >
              Delete permanently
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">
          This permanently deletes <span className="font-semibold">{active?.name}</span> and all of its
          telecallers, contacts, tasks, calls, and follow-ups. This cannot be undone.
        </p>
        <Label htmlFor="ws-confirm">
          Type <span className="font-semibold">{active?.name}</span> to confirm
        </Label>
        <Input
          id="ws-confirm"
          value={confirmName}
          autoFocus
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={active?.name}
        />
      </Modal>
    </>
  );
}
