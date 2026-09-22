import { RotateCcw, Smartphone } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Misc';
import { MAX_MOBILE_TABS, useUiStore } from '@/store/ui';
import { NAV, tabNav, visibleNav } from './nav';
import type { Role } from '@/types';

/**
 * Lets each user build their own menu: switch off the pages they never open,
 * and choose which ones get a tab on their phone. Everything is per role and
 * persisted in the UI store, so it survives a refresh and doesn't leak between
 * an admin and a telecaller sharing a browser.
 */
export function NavCustomizer({ role, open, onClose }: { role: Role; open: boolean; onClose: () => void }) {
  const navHidden = useUiStore((s) => s.navHidden);
  const navTabs = useUiStore((s) => s.navTabs);
  const toggleNavItem = useUiStore((s) => s.toggleNavItem);
  const toggleNavTab = useUiStore((s) => s.toggleNavTab);
  const resetNav = useUiStore((s) => s.resetNav);

  const hidden = navHidden[role] ?? [];
  const tabs = navTabs[role] ?? [];
  const items = NAV[role];
  const visible = visibleNav(role, hidden);
  // What the bar will actually show — including the defaults that fill in when
  // nothing is pinned, so the preview never lies about the outcome.
  const effectiveTabs = tabNav(role, hidden, tabs);
  const customized = hidden.length > 0 || tabs.length > 0;
  const barFull = tabs.length >= MAX_MOBILE_TABS;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize menu"
      size="md"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => resetNav(role)} disabled={!customized}>
            <RotateCcw size={14} /> Reset
          </Button>
          <div className="flex-1" />
          <Button className="min-w-24" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Pages in your menu
          </h4>
          <p className="mb-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Switch off anything you don't use. It leaves the sidebar and the More menu — the page itself
            keeps working if you follow a link to it.
          </p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {items.map((item) => {
              const on = !hidden.includes(item.to);
              // Never let someone empty their own menu and get stranded.
              const last = on && visible.length === 1;
              return (
                <label
                  key={item.to}
                  className={`flex items-center gap-3 px-3 py-2.5 ${last ? 'opacity-60' : 'cursor-pointer'}`}
                >
                  <item.icon size={18} className="shrink-0 text-slate-400 dark:text-slate-500" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                    {item.label}
                  </span>
                  {effectiveTabs.some((t) => t.to === item.to) && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                      <Smartphone size={10} /> Tab
                    </span>
                  )}
                  <Toggle
                    checked={on}
                    disabled={last}
                    label={`Show ${item.label}`}
                    onChange={() => toggleNavItem(role, item.to)}
                  />
                </label>
              );
            })}
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Phone tab bar
            </h4>
            <span className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
              {tabs.length} of {MAX_MOBILE_TABS} chosen
            </span>
          </div>
          <p className="mb-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            {tabs.length
              ? `Only these get a tab along the bottom of your phone. Everything else stays one tap away in More.`
              : `Nothing chosen yet, so your phone uses the default ${MAX_MOBILE_TABS}. Pick your own below.`}
          </p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {visible.map((item) => {
              const pinned = tabs.includes(item.to);
              // The bar holds four; unpin one before adding another.
              const blocked = !pinned && barFull;
              return (
                <label
                  key={item.to}
                  className={`flex items-center gap-3 px-3 py-2.5 ${blocked ? 'opacity-40' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-brand-600"
                    checked={pinned}
                    disabled={blocked}
                    onChange={() => toggleNavTab(role, item.to)}
                  />
                  <item.icon size={18} className="shrink-0 text-slate-400 dark:text-slate-500" />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                    {item.label}
                  </span>
                </label>
              );
            })}
          </div>

          {/* A live preview of the bar, so the effect is obvious on a desktop
              screen where the real thing isn't rendered. */}
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">Preview</p>
            <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              {effectiveTabs.map((item) => (
                <span
                  key={item.to}
                  className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-slate-500 dark:text-slate-400"
                >
                  <item.icon size={18} />
                  <span className="max-w-full truncate px-0.5">{item.shortLabel ?? item.label}</span>
                </span>
              ))}
              <span className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                <span className="text-lg leading-[18px]">···</span>
                More
              </span>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
