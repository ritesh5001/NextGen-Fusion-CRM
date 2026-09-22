import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WorkspaceState {
  // The workspace the superadmin has selected; sent as the X-Workspace-Id header.
  // For a telecaller this is ignored server-side (they're pinned to their own).
  activeWorkspaceId: string | null;
  setActiveWorkspace: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeWorkspaceId: null,
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
    }),
    { name: 'crm-workspace' }
  )
);
