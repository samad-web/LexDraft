import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useNotificationsStore, type Notification } from '@/store/notifications';
import type { AppNotification } from '@lexdraft/types';

// =============================================================================
// useNotifications — bridges the server-persisted notification feed
// (GET /api/notifications, migration 0061) into the existing client-side
// notification store that powers the topbar bell + panel.
//
// The store stays the single source the UI reads; this hook keeps it in sync
// with the server: on mount (and every 60s while the tab is open) it fetches
// the feed and hydrates the store, and it exposes mark-read mutations that
// write through to the API and optimistically update the store so the bell
// badge reacts instantly.
// =============================================================================

function toStoreItem(n: AppNotification): Notification {
  return {
    id: n.id,
    icon: n.icon as Notification['icon'],
    tone: n.tone,
    title: n.title,
    body: n.body,
    view: n.view,
    createdAt: n.createdAt,
    unread: n.unread,
  };
}

interface FeedResponse {
  items: AppNotification[];
  unreadCount: number;
}

/**
 * Mount this once high in the app tree (App shell). It runs the polling fetch
 * and returns the mark-read helpers wired to the API. Components that only
 * render notifications keep reading the store directly (useNotificationsStore /
 * useUnreadCount) — they don't need this hook.
 */
export function useNotifications() {
  const token = useAuthStore((s) => s.token);
  const hydrateFromServer = useNotificationsStore((s) => s.hydrateFromServer);
  const storeMarkRead = useNotificationsStore((s) => s.markRead);
  const storeMarkAllRead = useNotificationsStore((s) => s.markAllRead);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<FeedResponse>('/notifications'),
    enabled: !!token,
    // Poll while the tab is open so nightly-sync notifications appear without a
    // reload. 60s is well inside the once-a-day cadence and cheap.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Push every fresh server snapshot into the store the UI reads.
  useEffect(() => {
    if (query.data?.items) {
      hydrateFromServer(query.data.items.map(toStoreItem));
    }
  }, [query.data, hydrateFromServer]);

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onMutate: (id) => {
      storeMarkRead(id); // optimistic — bell badge drops immediately
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onMutate: () => {
      storeMarkAllRead();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return {
    unreadCount: query.data?.unreadCount ?? 0,
    isLoading: query.isLoading,
    markRead: (id: string) => markRead.mutate(id),
    markAllRead: () => markAllRead.mutate(),
  };
}
