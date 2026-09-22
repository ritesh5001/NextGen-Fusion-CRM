import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LogOut,
  Phone,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  MoreHorizontal,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { useUiStore } from '@/store/ui';
import { useWorkspaceStore } from '@/store/workspace';
import { useCallProvider } from '@/features/calls/useCallProvider';
import { useCallStore } from '@/store/call';
import { CallBar } from '@/features/calls/CallBar';
import { CallDispositionModal } from '@/features/calls/CallDispositionModal';
import { Sheet } from '@/components/ui/Sheet';
import { tabNav, visibleNav } from './nav';
import { NavCustomizer } from './NavCustomizer';
import { NotificationBell } from './NotificationBell';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const callingEnabled = useCallProvider().ready;
  const initDevice = useCallStore((s) => s.initDevice);

  // Warm up the Twilio softphone once we know calling is configured (no mic
  // prompt yet — that only happens on the first actual call).
  useEffect(() => {
    if (callingEnabled) void initDevice();
  }, [callingEnabled, initDevice]);

  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);
  const navigate = useNavigate();
  const location = useLocation();
  const clearWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  // The menu is per-user: pages they've switched off are gone from the sidebar
  // and the More sheet, and they choose which routes get a phone tab.
  const navHidden = useUiStore((s) => s.navHidden);
  const navTabs = useUiStore((s) => s.navTabs);
  const items = user ? visibleNav(user.role, navHidden[user.role]) : [];
  const tabs = user ? tabNav(user.role, navHidden[user.role], navTabs[user.role]) : [];

  const [moreOpen, setMoreOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // A tab-bar destination shouldn't leave the sheet hanging over the new page.
  useEffect(() => setMoreOpen(false), [location.pathname]);
  // Anything not on the tab bar is only reachable through More — highlight the
  // More button itself so the user still knows where they are.
  const moreIsActive = !tabs.some(
    (t) => location.pathname === t.to || (t.to !== '/' && location.pathname.startsWith(t.to))
  );

  function handleLogout() {
    logout();
    clearWorkspace(null);
    navigate('/login');
  }

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside
        className={`hidden flex-col border-r border-gray-200 bg-white transition-[width] duration-200 dark:border-gray-800 dark:bg-gray-900 md:flex ${
          collapsed ? 'w-16' : 'w-60'
        }`}
      >
        <div className={`flex items-center py-4 ${collapsed ? 'justify-center px-2' : 'gap-2 px-4'}`}>
          {collapsed ? (
            <div className="bg-brand-gradient-br rounded-btn p-1.5 text-white">
              <Phone size={18} />
            </div>
          ) : (
            <>
              {/* Black-on-transparent logo: a white pad keeps it legible in dark mode. */}
              <div className="rounded-btn bg-white px-1.5 py-1">
                <img src="/logo.png" alt="NextGen Fusion" className="h-8 w-auto" />
              </div>
              <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                CRM
              </span>
            </>
          )}
        </div>
        <nav className="flex-1 space-y-1 px-2 py-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                  collapsed ? 'justify-center' : 'gap-3'
                } ${
                  isActive
                    ? 'bg-gray-950 text-white dark:bg-white dark:text-gray-950'
                    : 'text-gray-700 hover:bg-gray-100 hover:text-gray-950 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white'
                }`
              }
            >
              <item.icon size={18} />
              {!collapsed && item.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => setCustomizeOpen(true)}
          title="Customize menu"
          className={`flex items-center px-3 py-2 text-sm font-medium text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 ${
            collapsed ? 'justify-center' : 'gap-3 px-5'
          }`}
        >
          <SlidersHorizontal size={18} />
          {!collapsed && 'Customize'}
        </button>
        <button
          onClick={toggleSidebar}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`flex items-center px-3 py-2 text-sm font-medium text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 ${
            collapsed ? 'justify-center' : 'gap-3 px-5'
          }`}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          {!collapsed && 'Collapse'}
        </button>
        <button
          onClick={handleLogout}
          title={collapsed ? 'Log out' : undefined}
          className={`flex items-center py-4 text-sm font-medium text-gray-500 hover:text-rose-600 dark:text-gray-400 dark:hover:text-rose-400 ${
            collapsed ? 'justify-center px-3' : 'gap-3 px-5'
          }`}
        >
          <LogOut size={18} /> {!collapsed && 'Log out'}
        </button>
      </aside>

      {/* Main area. min-w-0 so a wide table scrolls inside its own container
          instead of stretching the whole layout sideways. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white/90 backdrop-blur px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900 sm:px-4 sm:py-3">
          <WorkspaceSwitcher />
          <div className="flex items-center gap-1 sm:gap-3">
            {/* On a phone the theme switch lives in the More sheet — the header
                only has room for what's needed while working. */}
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle dark mode"
              className="hidden rounded-full border border-gray-200 p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100 md:block"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <NotificationBell />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{user?.name}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500">{user?.email}</p>
            </div>
            <div className="bg-brand-gradient-br flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-semibold text-white">
              {user?.name?.[0]?.toUpperCase()}
            </div>
          </div>
        </header>

        <main className="overscroll-none-y pb-navbar min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 md:pb-4">
          <Outlet />
        </main>

        {/* Mobile tab bar: four destinations + More. */}
        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-gray-200 bg-white/95 backdrop-blur pb-safe dark:border-gray-800 dark:bg-gray-900 md:hidden">
          {tabs.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
                  isActive ? 'text-gray-950 dark:text-white' : 'text-gray-400 dark:text-gray-500'
                }`
              }
            >
              <item.icon size={20} />
              <span className="max-w-full truncate px-0.5">{item.shortLabel ?? item.label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            aria-label="More"
            aria-expanded={moreOpen}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium ${
              moreIsActive ? 'text-gray-950 dark:text-white' : 'text-gray-400 dark:text-gray-500'
            }`}
          >
            <MoreHorizontal size={20} />
            More
          </button>
        </nav>
      </div>

      {/* The full nav, plus the account actions the header drops on a phone. */}
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center text-xs font-medium transition-colors ${
                  isActive
                    ? 'border-gray-950 bg-gray-950 text-white dark:border-white dark:bg-white dark:text-gray-950'
                    : 'border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                }`
              }
            >
              <item.icon size={20} />
              <span className="leading-tight">{item.label}</span>
            </NavLink>
          ))}
        </div>

        <div className="mt-4 space-y-1 border-t border-gray-200 pt-3 dark:border-gray-700">
          <div className="px-1 pb-2">
            <p className="truncate text-sm font-medium text-gray-700 dark:text-gray-200">{user?.name}</p>
            <p className="truncate text-xs text-gray-400 dark:text-gray-500">{user?.email}</p>
          </div>
          <button
            onClick={() => {
              setMoreOpen(false);
              setCustomizeOpen(true);
            }}
            className="tap flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <SlidersHorizontal size={18} /> Customize menu
          </button>
          <button
            onClick={toggleTheme}
            className="tap flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            onClick={handleLogout}
            className="tap flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
          >
            <LogOut size={18} /> Log out
          </button>
        </div>
      </Sheet>

      {user && (
        <NavCustomizer role={user.role} open={customizeOpen} onClose={() => setCustomizeOpen(false)} />
      )}

      {/* Global softphone UI (no-op until a call is placed). */}
      <CallBar />
      <CallDispositionModal />
    </div>
  );
}
