import { useEffect, useMemo } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { create } from 'zustand';
import type {
  ConversationDetail,
  ConversationSummary,
  MatterDiscussionAccess,
  MessagePage,
  SendMessageRequest,
  TeamChatStreamEvent,
  TeamMessage,
} from '@lexdraft/types/messaging';
import { api, apiClient } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useMeFeatures } from '@/hooks/useFirmAdmin';

// =============================================================================
// Team chat hooks (backend: /api/team-chat, migration 0087).
//
// Live updates arrive over one SSE stream per tab (useTeamChatStream, mounted
// once in the app shell). Events patch the React Query caches in place rather
// than triggering refetches: the API's IP rate limit is shared by everyone in
// an office, so "refetch on every message" would burn it quickly.
// =============================================================================

export const TEAM_CHAT_FEATURE = 'team.messaging';

const keys = {
  all: ['team-chat'] as const,
  conversations: ['team-chat', 'conversations'] as const,
  conversation: (id: string) => ['team-chat', 'conversation', id] as const,
  messages: (id: string) => ['team-chat', 'messages', id] as const,
  matter: (caseId: string) => ['team-chat', 'matter', caseId] as const,
};

type MessagesData = InfiniteData<MessagePage, string | null>;

/** Which conversation is open and visible - incoming messages there don't
 *  count as unread. */
export const useTeamChatUi = create<{ activeId: string | null; setActive: (id: string | null) => void }>((set) => ({
  activeId: null,
  setActive: (activeId) => set({ activeId }),
}));

export function useHasTeamChat(): boolean {
  const me = useMeFeatures();
  return (me.data?.features ?? []).includes(TEAM_CHAT_FEATURE);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useConversations(enabled = true) {
  return useQuery({
    queryKey: keys.conversations,
    queryFn: () => api.get<{ items: ConversationSummary[] }>('/team-chat/conversations').then((r) => r.items),
    enabled,
    staleTime: 30_000,
  });
}

export function useTeamChatUnreadTotal(): number {
  const enabled = useHasTeamChat();
  const { data } = useConversations(enabled);
  return useMemo(
    () => (data ?? []).reduce((n, c) => n + (c.muted && !c.mentionedUnread ? 0 : c.unreadCount), 0),
    [data],
  );
}

export function useConversation(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.conversation(id ?? ''),
    queryFn: () => api.get<ConversationDetail>(`/team-chat/conversations/${id}`),
    enabled: !!id,
  });
}

export function useMessages(conversationId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: keys.messages(conversationId ?? ''),
    queryFn: ({ pageParam }) =>
      api.get<MessagePage>(
        `/team-chat/conversations/${conversationId}/messages`,
        pageParam ? { before: pageParam } : undefined,
      ),
    initialPageParam: null as string | null,
    // pages[0] is the newest page; each further page is older.
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!conversationId,
    // The stream keeps this cache current; a focus refetch would only reset
    // pagination and scroll position.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

/** Flatten infinite pages into oldest-first order for rendering. */
export function flattenMessages(data: InfiniteData<MessagePage, unknown> | undefined): TeamMessage[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((p) => p.items);
}

export function useMatterDiscussion(caseId: string | undefined) {
  return useQuery({
    queryKey: keys.matter(caseId ?? ''),
    queryFn: () => api.get<MatterDiscussionAccess>(`/team-chat/matters/${caseId}`),
    enabled: !!caseId,
  });
}

// ---------------------------------------------------------------------------
// Cache patch helpers (shared by mutations and the stream)
// ---------------------------------------------------------------------------

function upsertMessage(qc: QueryClient, m: TeamMessage, append: boolean): void {
  qc.setQueryData<MessagesData>(keys.messages(m.conversationId), (old) => {
    if (!old) return old;
    let found = false;
    const pages = old.pages.map((p) => ({
      ...p,
      items: p.items.map((x) => {
        if (x.id !== m.id) return x;
        found = true;
        return m;
      }),
    }));
    if (!found && append && pages[0]) {
      pages[0] = { ...pages[0], items: [...pages[0].items, m] };
    }
    return { ...old, pages };
  });
}

function removeMessage(qc: QueryClient, conversationId: string, messageId: string): void {
  qc.setQueryData<MessagesData>(keys.messages(conversationId), (old) =>
    old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== messageId) })) } : old);
}

function patchSummary(
  qc: QueryClient,
  conversationId: string,
  fn: (c: ConversationSummary) => ConversationSummary,
  moveToTop = false,
): boolean {
  let found = false;
  qc.setQueryData<ConversationSummary[]>(keys.conversations, (old) => {
    if (!old) return old;
    const next = old.map((c) => {
      if (c.id !== conversationId) return c;
      found = true;
      return fn(c);
    });
    if (!moveToTop || !found) return next;
    const idx = next.findIndex((c) => c.id === conversationId);
    return [next[idx]!, ...next.slice(0, idx), ...next.slice(idx + 1)];
  });
  qc.setQueryData<ConversationDetail>(keys.conversation(conversationId), (old) => (old ? { ...old, ...fn(old) } : old));
  return found;
}

function previewOf(m: TeamMessage): string {
  if (m.deleted) return 'This message was deleted';
  const body = (m.body ?? '').replace(/\s+/g, ' ').trim();
  return body.length > 80 ? `${body.slice(0, 79)}…` : body;
}

function applyIncoming(qc: QueryClient, m: TeamMessage, myId: string | null): void {
  upsertMessage(qc, m, true);
  const fromMe = m.authorId === myId;
  const isOpen = useTeamChatUi.getState().activeId === m.conversationId && document.visibilityState === 'visible';
  const found = patchSummary(qc, m.conversationId, (c) => ({
    ...c,
    lastMessageAt: m.createdAt,
    lastMessagePreview: previewOf(m),
    lastMessageAuthorName: m.authorName,
    unreadCount: fromMe || isOpen ? c.unreadCount : c.unreadCount + 1,
    mentionedUnread: c.mentionedUnread || (!isOpen && !!myId && m.mentions.includes(myId)),
  }), true);
  // First message in a conversation this tab hasn't listed yet.
  if (!found) void qc.invalidateQueries({ queryKey: keys.conversations });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id ?? null);
  return useMutation({
    mutationFn: (input: SendMessageRequest) =>
      api.post<TeamMessage>(`/team-chat/conversations/${conversationId}/messages`, input),
    onSuccess: (m) => applyIncoming(qc, m, myId),
  });
}

export function useEditMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: string; mentions?: string[] }) =>
      api.patch<TeamMessage>(`/team-chat/messages/${input.id}`, { body: input.body, mentions: input.mentions }),
    onSuccess: (m) => upsertMessage(qc, m, false),
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { message: TeamMessage; scope: 'me' | 'everyone' }) =>
      api.post<TeamMessage | ''>(`/team-chat/messages/${input.message.id}/delete`, { scope: input.scope }),
    onSuccess: (res, input) => {
      if (input.scope === 'me') removeMessage(qc, input.message.conversationId, input.message.id);
      else if (res) upsertMessage(qc, res, false);
    },
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) => api.post(`/team-chat/conversations/${conversationId}/read`),
    onMutate: (conversationId) => {
      patchSummary(qc, conversationId, (c) => ({ ...c, unreadCount: 0, mentionedUnread: false }));
    },
    // The bell rows for this conversation were cleared server-side.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useOpenDirect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.post<ConversationDetail>('/team-chat/conversations/direct', { userId }),
    onSuccess: (c) => {
      qc.setQueryData(keys.conversation(c.id), c);
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; memberIds: string[] }) =>
      api.post<ConversationDetail>('/team-chat/conversations/group', input),
    onSuccess: (c) => {
      qc.setQueryData(keys.conversation(c.id), c);
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

export function useUpdateConversation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { title?: string; muted?: boolean }) =>
      api.patch<ConversationDetail>(`/team-chat/conversations/${conversationId}`, patch),
    onSuccess: (c) => {
      qc.setQueryData(keys.conversation(c.id), c);
      patchSummary(qc, c.id, (s) => ({ ...s, title: c.title, muted: c.muted }));
    },
  });
}

export function useAddGroupMembers(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api.post<ConversationDetail>(`/team-chat/conversations/${conversationId}/members`, { userIds }),
    onSuccess: (c) => qc.setQueryData(keys.conversation(c.id), c),
  });
}

export function useRemoveGroupMember(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/team-chat/conversations/${conversationId}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useAddMatterMember(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.post<MatterDiscussionAccess>(`/team-chat/matters/${caseId}/members`, { userId }),
    onSuccess: (d) => {
      qc.setQueryData(keys.matter(caseId), d);
      if (d.conversation) qc.setQueryData(keys.conversation(d.conversation.id), d.conversation);
    },
  });
}

export function useRemoveMatterMember(caseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete<MatterDiscussionAccess>(`/team-chat/matters/${caseId}/members/${userId}`),
    onSuccess: (d) => {
      qc.setQueryData(keys.matter(caseId), d);
      void qc.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

// ---------------------------------------------------------------------------
// Live stream
// ---------------------------------------------------------------------------

const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

function handleEvent(qc: QueryClient, e: TeamChatStreamEvent, myId: string | null): void {
  switch (e.type) {
    case 'message.created':
      applyIncoming(qc, e.message, myId);
      break;
    case 'message.updated':
      upsertMessage(qc, e.message, false);
      patchSummary(qc, e.conversationId, (c) =>
        c.lastMessageAt === e.message.createdAt ? { ...c, lastMessagePreview: previewOf(e.message) } : c);
      break;
    case 'message.hidden':
      removeMessage(qc, e.conversationId, e.messageId);
      break;
    case 'conversation.read':
      // Others' markers drive the read ticks on my messages; mine stops the
      // pane from re-sending "mark read".
      qc.setQueryData<ConversationDetail>(keys.conversation(e.conversationId), (old) => old && {
        ...old,
        members: old.members.map((mb) => (mb.userId === e.userId ? { ...mb, lastReadAt: e.lastReadAt } : mb)),
      });
      if (e.userId === myId) {
        patchSummary(qc, e.conversationId, (c) => ({ ...c, unreadCount: 0, mentionedUnread: false }));
      }
      break;
    case 'conversation.updated':
      void qc.invalidateQueries({ queryKey: keys.conversations });
      void qc.invalidateQueries({ queryKey: keys.conversation(e.conversationId) });
      void qc.invalidateQueries({ queryKey: ['team-chat', 'matter'] });
      break;
    case 'ready':
      break;
  }
}

/** Mount once in the app shell. Holds one SSE connection while signed in. */
export function useTeamChatStream(): void {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const enabled = useHasTeamChat();

  useEffect(() => {
    if (!token || !enabled) return;
    const controller = new AbortController();
    const base = (apiClient.defaults.baseURL ?? '').replace(/\/+$/, '');
    let attempt = 0;
    let connectedBefore = false;

    const run = async (): Promise<void> => {
      while (!controller.signal.aborted) {
        try {
          const res = await fetch(`${base}/api/team-chat/stream`, {
            headers: { accept: 'text/event-stream', authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          // Auth/plan/feature refusals won't fix themselves by retrying.
          if (res.status === 401 || res.status === 402 || res.status === 403) return;
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let sep = buffer.indexOf('\n\n');
            while (sep !== -1) {
              const chunk = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              sep = buffer.indexOf('\n\n');
              let data = '';
              for (const line of chunk.split('\n')) {
                if (line.startsWith('data:')) data += line.slice(5).trim();
              }
              if (!data) continue; // heartbeat comment
              let event: TeamChatStreamEvent;
              try { event = JSON.parse(data) as TeamChatStreamEvent; } catch { continue; }
              if (event.type === 'ready') {
                attempt = 0;
                // Anything sent while we were disconnected: resync once.
                if (connectedBefore) void qc.invalidateQueries({ queryKey: keys.all });
                connectedBefore = true;
              }
              handleEvent(qc, event, myId);
            }
          }
        } catch {
          if (controller.signal.aborted) return;
        }
        const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!;
        attempt += 1;
        await new Promise((r) => setTimeout(r, delay));
      }
    };
    void run();
    return () => controller.abort();
  }, [qc, token, myId, enabled]);
}
