import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IconName } from '@lexdraft/ui';

export type NotificationTone = 'cobalt' | 'sage' | 'vermillion' | 'amber';

export interface Notification {
  id: string;
  icon: IconName;
  tone: NotificationTone;
  title: string;
  body: string;
  /** ISO timestamp. Displayed humanised ("2h ago"). */
  createdAt: string;
  /** True until the user marks it read or the inbox is bulk-marked. */
  unread: boolean;
  /** Path the user lands on when clicking the notification (e.g. 'cases'). */
  view: string;
}

interface NotificationsState {
  items: Notification[];
  /** Push a new notification onto the inbox. Newest first. */
  add: (n: Omit<Notification, 'id' | 'createdAt' | 'unread'> & { id?: string; unread?: boolean }) => void;
  /** Mark a single notification read. No-op if already read. */
  markRead: (id: string) => void;
  /** Mark every notification read. */
  markAllRead: () => void;
  /** Remove a notification entirely. */
  dismiss: (id: string) => void;
  /** Clear the entire inbox. */
  clear: () => void;
}

// Seeded with sample notifications on first load so a brand-new account
// doesn't open the bell to a blank panel. Real notifications are inserted
// by feature code as they happen; this seed is dev/demo affordance.
const SEED: Notification[] = [
  {
    id: 'seed-1',
    icon: 'calendar',
    tone: 'cobalt',
    title: 'Welcome to LexDraft',
    body: 'Notifications about hearings, deadlines, and payments will land here.',
    createdAt: new Date().toISOString(),
    unread: true,
    view: 'dashboard',
  },
];

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    (set, get) => ({
      items: SEED,
      add: (input) => {
        const id = input.id ?? `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const item: Notification = {
          id,
          icon: input.icon,
          tone: input.tone,
          title: input.title,
          body: input.body,
          view: input.view,
          createdAt: new Date().toISOString(),
          unread: input.unread ?? true,
        };
        set({ items: [item, ...get().items].slice(0, 200) });
      },
      markRead: (id) =>
        set({ items: get().items.map((n) => (n.id === id ? { ...n, unread: false } : n)) }),
      markAllRead: () => set({ items: get().items.map((n) => ({ ...n, unread: false })) }),
      dismiss: (id) => set({ items: get().items.filter((n) => n.id !== id) }),
      clear: () => set({ items: [] }),
    }),
    {
      name: 'lexdraft-notifications',
      version: 1,
      partialize: (s) => ({ items: s.items }),
    },
  ),
);

/** Selector — pull just the unread count without subscribing to the full list. */
export function useUnreadCount(): number {
  return useNotificationsStore((s) => s.items.filter((n) => n.unread).length);
}

/** Format a created-at timestamp as a relative phrase ("2h ago", "Yesterday"). */
export function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const ms = Date.now() - t;
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
