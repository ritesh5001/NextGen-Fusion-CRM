import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Density, Role } from '@/types';

type Theme = 'light' | 'dark';

const systemTheme = (): Theme =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

/** Persisted filter/sort/paging state for the contacts & leads views. */
export interface ContactFilters {
  search: string;
  status: string;
  callStatus: string;
  assignedTo: string;
  qualifiedChip: boolean;
  sortBy: string;
  order: 'asc' | 'desc';
  page: number;
  limit: number;
}

export const DEFAULT_CONTACT_FILTERS: ContactFilters = {
  search: '',
  status: '',
  callStatus: '',
  assignedTo: '',
  qualifiedChip: false,
  sortBy: 'createdAt',
  order: 'desc',
  page: 1,
  limit: 50,
};

interface UiState {
  sidebarCollapsed: boolean;
  filtersCollapsed: boolean;
  density: Density;
  theme: Theme;
  colWidths: Record<string, number>;
  colOrder: string[]; // persisted order of the contacts table data columns
  hiddenCols: string[]; // contacts table columns the user has hidden
  showPhoneNumbers: boolean; // reveal the actual phone digits in the contacts table phone columns
  contactFilters: Record<'contacts' | 'leads', ContactFilters>; // remembered search/sort/paging per view
  /* Navigation the user has switched off, and the phone tabs they've pinned —
   * kept per role, because the two roles have different menus and may well
   * share a browser (an admin checking a telecaller's view, a shared desk
   * machine). Values are route paths, so an entry for a route the current role
   * doesn't have is simply ignored. */
  navHidden: Record<Role, string[]>;
  navTabs: Record<Role, string[]>; // [] = "not customized", use the defaults
  toggleSidebar: () => void;
  toggleFilters: () => void;
  setDensity: (d: Density) => void;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setColWidths: (w: Record<string, number>) => void;
  setColOrder: (o: string[]) => void;
  toggleCol: (id: string) => void;
  resetCols: () => void;
  toggleShowPhoneNumbers: () => void;
  setContactFilters: (mode: 'contacts' | 'leads', filters: ContactFilters) => void;
  toggleNavItem: (role: Role, to: string) => void;
  toggleNavTab: (role: Role, to: string) => void;
  resetNav: (role: Role) => void;
}

/** Most tabs that fit across a phone before the labels start truncating. */
export const MAX_MOBILE_TABS = 4;

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      filtersCollapsed: false,
      density: 'comfortable',
      theme: systemTheme(),
      colWidths: {},
      colOrder: [],
      hiddenCols: [],
      showPhoneNumbers: true,
      contactFilters: { contacts: { ...DEFAULT_CONTACT_FILTERS }, leads: { ...DEFAULT_CONTACT_FILTERS } },
      navHidden: { superadmin: [], telecaller: [] },
      navTabs: { superadmin: [], telecaller: [] },
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      toggleFilters: () => set((s) => ({ filtersCollapsed: !s.filtersCollapsed })),
      setDensity: (density) => set({ density }),
      setColWidths: (colWidths) => set({ colWidths }),
      setColOrder: (colOrder) => set({ colOrder }),
      toggleCol: (id) =>
        set((s) => ({
          hiddenCols: s.hiddenCols.includes(id)
            ? s.hiddenCols.filter((x) => x !== id)
            : [...s.hiddenCols, id],
        })),
      resetCols: () => set({ colOrder: [], hiddenCols: [], colWidths: {} }),
      toggleShowPhoneNumbers: () => set((s) => ({ showPhoneNumbers: !s.showPhoneNumbers })),
      setContactFilters: (mode, filters) =>
        set((s) => ({ contactFilters: { ...s.contactFilters, [mode]: filters } })),

      toggleNavItem: (role, to) =>
        set((s) => {
          const hidden = s.navHidden[role] ?? [];
          const next = hidden.includes(to) ? hidden.filter((x) => x !== to) : [...hidden, to];
          return {
            navHidden: { ...s.navHidden, [role]: next },
            // A hidden page can't hold a tab slot; drop it so the bar doesn't
            // silently keep a link the user just switched off.
            navTabs: { ...s.navTabs, [role]: (s.navTabs[role] ?? []).filter((x) => !next.includes(x)) },
          };
        }),

      toggleNavTab: (role, to) =>
        set((s) => {
          const tabs = s.navTabs[role] ?? [];
          if (tabs.includes(to)) return { navTabs: { ...s.navTabs, [role]: tabs.filter((x) => x !== to) } };
          if (tabs.length >= MAX_MOBILE_TABS) return s; // the bar is full — unpin one first
          return { navTabs: { ...s.navTabs, [role]: [...tabs, to] } };
        }),

      resetNav: (role) =>
        set((s) => ({
          navHidden: { ...s.navHidden, [role]: [] },
          navTabs: { ...s.navTabs, [role]: [] },
        })),
    }),
    { name: 'crm-ui' }
  )
);
