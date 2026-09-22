import {
  LayoutDashboard,
  Users,
  Contact,
  Star,
  ListChecks,
  CalendarClock,
  PhoneCall,
  Plug,
  Mic,
  Phone,
  type LucideIcon,
} from 'lucide-react';
import { MAX_MOBILE_TABS } from '@/store/ui';
import type { Role } from '@/types';

export interface NavItem {
  to: string;
  label: string;
  /** Shorter label for the phone tab bar, where ~9 characters fit. */
  shortLabel?: string;
  icon: LucideIcon;
}

export const NAV: Record<Role, NavItem[]> = {
  superadmin: [
    { to: '/', label: 'Dashboard', shortLabel: 'Home', icon: LayoutDashboard },
    { to: '/telecallers', label: 'Users', icon: Users },
    { to: '/contacts', label: 'Contacts', icon: Contact },
    { to: '/leads', label: 'Leads', icon: Star },
    { to: '/tasks', label: 'Tasks', icon: ListChecks },
    { to: '/dialer', label: 'Dialer', icon: Phone },
    { to: '/recents', label: 'Recents', icon: PhoneCall },
    { to: '/device-test', label: 'Device Test', shortLabel: 'Devices', icon: Mic },
    { to: '/integrations', label: 'Integrations', shortLabel: 'Setup', icon: Plug },
  ],
  telecaller: [
    { to: '/', label: 'Dashboard', shortLabel: 'Home', icon: LayoutDashboard },
    { to: '/contacts', label: 'Contacts', icon: Contact },
    { to: '/leads', label: 'Leads', icon: Star },
    { to: '/tasks', label: 'Tasks', icon: ListChecks },
    { to: '/dialer', label: 'Dialer', icon: Phone },
    { to: '/recents', label: 'Recents', icon: PhoneCall },
    { to: '/followups', label: 'Follow-ups', icon: CalendarClock },
    { to: '/device-test', label: 'Device Test', shortLabel: 'Devices', icon: Mic },
  ],
};

/**
 * The four routes that get their own tab in the phone tab bar. Nine tabs plus a
 * logout button does not fit across a phone — everything else lives one tap
 * away behind "More", which lists the *complete* nav, so nothing is lost.
 *
 * These are the screens each role opens many times a day: the admin assigns and
 * reviews work; the telecaller works their contacts, tasks and follow-ups.
 */
export const MOBILE_PRIMARY: Record<Role, string[]> = {
  superadmin: ['/', '/contacts', '/leads', '/tasks'],
  telecaller: ['/', '/contacts', '/tasks', '/followups'],
};

/** The menu as this user has it: everything they haven't switched off. */
export function visibleNav(role: Role, hidden: string[] = []): NavItem[] {
  return NAV[role].filter((i) => !hidden.includes(i.to));
}

/**
 * The phone tab bar for this user.
 *
 * An explicit choice wins outright — if they pinned two tabs, they get two, and
 * everything else lives in More. With no choice made we fall back to
 * `MOBILE_PRIMARY` and top it up from whatever else is visible, so the bar is
 * never short just because a default route was switched off.
 */
export function tabNav(role: Role, hidden: string[] = [], tabs: string[] = []): NavItem[] {
  const visible = visibleNav(role, hidden);
  const byRoute = (to: string) => visible.find((i) => i.to === to);

  const pinned = tabs.map(byRoute).filter((i): i is NavItem => !!i);
  if (pinned.length) return pinned.slice(0, MAX_MOBILE_TABS);

  const picked = MOBILE_PRIMARY[role].map(byRoute).filter((i): i is NavItem => !!i);
  for (const item of visible) {
    if (picked.length >= MAX_MOBILE_TABS) break;
    if (!picked.some((p) => p.to === item.to)) picked.push(item);
  }
  return picked.slice(0, MAX_MOBILE_TABS);
}
