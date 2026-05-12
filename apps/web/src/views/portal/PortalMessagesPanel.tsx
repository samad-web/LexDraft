import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortalMessage } from '@lexdraft/types';
import { portalApi, portalErrorMessage } from '@/lib/portalApi';

interface Props {
  /** null → the per-client "general" thread. */
  matterId: string | null;
}

/**
 * Threaded message panel for the portal. Used both inside a matter detail
 * view and standalone for the per-client general thread. Polls every 60 s
 * (per CLIENT_PORTAL.md §2.2 — WebSockets are deferred to v2) and marks
 * unread firm-side messages as read on mount.
 */
export function PortalMessagesPanel({ matterId }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ['portal', 'messages', matterId ?? 'general'];
  const path = matterId ? `/messages?matterId=${matterId}` : '/messages';

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const messages = useQuery({
    queryKey,
    queryFn: () => portalApi.get<{ items: PortalMessage[] }>(path),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  // Mark firm → client messages as read once the thread is visible. The
  // server returns the count of newly-marked rows; if any, invalidate the
  // dashboard's unread count.
  useEffect(() => {
    if (!messages.data) return;
    const hasUnreadFirmMessage = messages.data.items.some(
      (m) => m.senderKind === 'firm' && !m.readAt,
    );
    if (!hasUnreadFirmMessage) return;
    const readPath = matterId ? `/messages/read?matterId=${matterId}` : '/messages/read';
    portalApi.post<{ ok: true; marked: number }>(readPath).then((res) => {
      if (res.marked > 0) {
        queryClient.invalidateQueries({ queryKey: ['portal', 'dashboard'] });
        queryClient.invalidateQueries({ queryKey });
      }
    }).catch(() => {/* silent — the next poll will retry */});
  }, [messages.data, matterId, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useMutation({
    mutationFn: (body: string) =>
      portalApi.post<PortalMessage>('/messages', { matterId, body }),
    onSuccess: () => {
      setDraft('');
      setError(null);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['portal', 'dashboard'] });
      composer.current?.focus();
    },
    onError: (err) => setError(portalErrorMessage(err, 'Could not send the message.')),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed.length > 4000) {
      setError('Messages are limited to 4000 characters.');
      return;
    }
    send.mutate(trimmed);
  }

  return (
    <section aria-labelledby="portal-thread-heading" style={panelStyle}>
      <h2 id="portal-thread-heading" style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>
        {matterId ? 'Messages on this matter' : 'General thread'}
      </h2>

      <div style={threadStyle} role="log" aria-live="polite">
        {messages.isLoading && <Empty>Loading messages…</Empty>}
        {messages.isError && (
          <Empty>{portalErrorMessage(messages.error, 'Could not load messages.')}</Empty>
        )}
        {messages.data && messages.data.items.length === 0 && (
          <Empty>No messages yet — start the conversation.</Empty>
        )}
        {messages.data?.items.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      <form onSubmit={onSubmit} style={composerStyle}>
        <textarea
          ref={composer}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type your message…"
          rows={3}
          maxLength={4000}
          aria-label="Message body"
          style={textareaStyle}
        />
        {error && (
          <div role="alert" style={{ color: 'var(--danger, #c0392b)', fontSize: 13 }}>{error}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.6 }}>{draft.length}/4000</span>
          <button
            type="submit"
            disabled={send.isPending || draft.trim().length === 0}
            style={btnPrimary}
          >
            {send.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </section>
  );
}

function MessageBubble({ message }: { message: PortalMessage }) {
  const align = message.mine ? 'flex-end' : 'flex-start';
  const bg = message.mine ? '#1f2937' : 'var(--card, #fff)';
  const fg = message.mine ? '#fff' : 'inherit';
  const ts = new Date(message.sentAt);
  const tsLabel = ts.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <div style={{ display: 'flex', justifyContent: align, marginBottom: 8 }}>
      <div style={{ maxWidth: '75%' }}>
        <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2, textAlign: message.mine ? 'right' : 'left' }}>
          {message.mine ? 'You' : message.senderName} · {tsLabel}
        </div>
        <div style={{
          background: bg, color: fg, padding: '8px 12px', borderRadius: 10,
          border: message.mine ? 'none' : '1px solid var(--border, #e4e4e7)',
          fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {message.body}
        </div>
      </div>
    </div>
  );
}

function Empty(props: { children: React.ReactNode }) {
  return <div style={{ padding: 12, fontSize: 13, opacity: 0.6 }}>{props.children}</div>;
}

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--border, #e4e4e7)', borderRadius: 8,
  background: 'var(--card, #fff)', padding: 16, marginTop: 24,
};
const threadStyle: React.CSSProperties = {
  maxHeight: 360, overflowY: 'auto', padding: 4,
  borderTop: '1px solid var(--border, #e4e4e7)',
  borderBottom: '1px solid var(--border, #e4e4e7)',
  marginBottom: 12,
};
const composerStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
};
const textareaStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 14,
  border: '1px solid var(--border, #d4d4d8)', borderRadius: 6,
  background: 'var(--card, #fff)', color: 'inherit', resize: 'vertical',
  fontFamily: 'inherit',
};
const btnPrimary: React.CSSProperties = {
  padding: '6px 14px', fontSize: 13, fontWeight: 500,
  background: 'var(--text, #18181b)', color: '#fff',
  border: 'none', borderRadius: 6, cursor: 'pointer',
};
