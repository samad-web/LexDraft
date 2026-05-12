import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { FirmPortalThreadSummary, PortalMessage } from '@lexdraft/types';
import {
  useFirmPortalInbox,
  useFirmPortalThread,
  useSendFirmPortalMessage,
  useMarkFirmPortalThreadRead,
} from '@/hooks/usePortalAdmin';

/**
 * Firm-side "Portal Messages" view (CLIENT_PORTAL.md §7.1 — last row of the
 * affordances table). Lists every (client × matter|null) thread with an
 * unread badge, opens the selected thread on the right, and lets advocates
 * reply. Polls at 60s — same cadence as the client side.
 */
export function PortalInboxView() {
  const inbox = useFirmPortalInbox();
  const items = inbox.data?.items ?? [];

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Auto-select the first thread once loaded so the right pane has content.
  useEffect(() => {
    if (selectedKey === null && items.length > 0) {
      setSelectedKey(threadKey(items[0]!));
    }
  }, [items, selectedKey]);

  const selected = useMemo<FirmPortalThreadSummary | null>(
    () => items.find((t) => threadKey(t) === selectedKey) ?? null,
    [items, selectedKey],
  );

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Client portal</div>
        <h1 className="heading-xl">Portal messages</h1>
      </div>

      <div className="inbox-grid" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
        <aside className="card" style={{ padding: 0, overflow: 'hidden', alignSelf: 'flex-start' }}>
          {inbox.isLoading && <div style={{ padding: 16 }} className="muted">Loading…</div>}
          {inbox.isError && <div style={{ padding: 16, color: 'var(--danger)' }}>Could not load inbox.</div>}
          {!inbox.isLoading && items.length === 0 && (
            <div style={{ padding: 16 }} className="muted">No portal messages yet.</div>
          )}
          {items.map((t) => {
            const k = threadKey(t);
            const active = k === selectedKey;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSelectedKey(k)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '12px 14px', background: active ? 'var(--bg-surface-2)' : 'transparent',
                  border: 'none', borderBottom: '1px solid var(--border-default)',
                  cursor: 'pointer', color: 'inherit',
                }}
              >
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.clientName}
                  </div>
                  {t.unreadFromClient > 0 && (
                    <span className="badge badge-vermillion" aria-label={`${t.unreadFromClient} unread`}>
                      {t.unreadFromClient}
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {t.matterTitle ?? 'General thread'}
                </div>
                <div style={{ fontSize: 13, marginTop: 6, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t.lastMessagePreview}
                </div>
              </button>
            );
          })}
        </aside>

        <section className="card" style={{ padding: 0, overflow: 'hidden', minHeight: 360 }}>
          {selected ? (
            <ThreadPane
              clientId={selected.clientId}
              clientName={selected.clientName}
              matterId={selected.matterId}
              matterTitle={selected.matterTitle}
            />
          ) : (
            <div style={{ padding: 24 }} className="muted">Select a thread to read.</div>
          )}
        </section>
      </div>

      <style>{`
        @media (max-width: 900px) { .inbox-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

function threadKey(t: FirmPortalThreadSummary): string {
  return `${t.clientId}:${t.matterId ?? 'general'}`;
}

interface PaneProps {
  clientId: string;
  clientName: string;
  matterId: string | null;
  matterTitle: string | null;
}

function ThreadPane({ clientId, clientName, matterId, matterTitle }: PaneProps) {
  const thread = useFirmPortalThread({ clientId, matterId });
  const send = useSendFirmPortalMessage();
  const markRead = useMarkFirmPortalThreadRead();

  const [draft, setDraft] = useState('');
  const composer = useRef<HTMLTextAreaElement>(null);

  // Mark the thread as read once the firm-side opens it.
  useEffect(() => {
    if (!thread.data) return;
    const hasUnread = thread.data.items.some((m) => m.senderKind === 'client' && !m.readAt);
    if (!hasUnread) return;
    markRead.mutate({ clientId, matterId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.data, clientId, matterId]);

  function onSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    send.mutate({ clientId, matterId, body: trimmed }, {
      onSuccess: () => { setDraft(''); composer.current?.focus(); },
    });
  }

  return (
    <div className="col" style={{ gap: 0, height: '100%' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-default)' }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{clientName}</div>
        <div className="muted" style={{ fontSize: 12 }}>{matterTitle ?? 'General thread'}</div>
      </header>

      <div style={{ padding: 16, overflowY: 'auto', maxHeight: 480, flex: 1 }} role="log" aria-live="polite">
        {thread.isLoading && <div className="muted">Loading messages…</div>}
        {thread.isError && <div style={{ color: 'var(--danger)' }}>Could not load messages.</div>}
        {thread.data && thread.data.items.length === 0 && (
          <div className="muted">No messages yet — start the conversation.</div>
        )}
        {thread.data?.items.map((m) => <Bubble key={m.id} message={m} />)}
      </div>

      <form onSubmit={onSubmit} style={{ padding: 12, borderTop: '1px solid var(--border-default)' }}>
        <textarea
          ref={composer}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Reply to the client…"
          aria-label="Reply"
          style={{
            width: '100%', padding: '8px 10px', fontSize: 14,
            border: '1px solid var(--border-default)', borderRadius: 6,
            background: 'var(--card)', color: 'inherit', resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>{draft.length}/4000</span>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={send.isPending || !draft.trim()}
          >
            {send.isPending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Bubble({ message }: { message: PortalMessage }) {
  const align = message.mine ? 'flex-end' : 'flex-start';
  const ts = new Date(message.sentAt).toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short',
  });
  return (
    <div style={{ display: 'flex', justifyContent: align, marginBottom: 8 }}>
      <div style={{ maxWidth: '75%' }}>
        <div className="muted" style={{ fontSize: 11, marginBottom: 2, textAlign: message.mine ? 'right' : 'left' }}>
          {message.mine ? 'You' : message.senderName} · {ts}
        </div>
        <div style={{
          background: message.mine ? 'var(--text-primary)' : 'var(--bg-surface-2)',
          color: message.mine ? 'var(--bg-base)' : 'inherit',
          padding: '8px 12px', borderRadius: 10,
          border: message.mine ? 'none' : '1px solid var(--border-default)',
          fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {message.body}
        </div>
      </div>
    </div>
  );
}
