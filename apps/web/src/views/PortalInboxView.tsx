import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Skeleton, EmptyState, ErrorState } from '@lexdraft/ui';
import type { FirmPortalThreadSummary, PortalMessage } from '@lexdraft/types';
import {
  useFirmPortalInbox,
  useFirmPortalThread,
  useSendFirmPortalMessage,
  useMarkFirmPortalThreadRead,
} from '@/hooks/usePortalAdmin';
import { PageHeader } from '@/components/PageHeader';

/**
 * Firm-side "Portal Messages" view (CLIENT_PORTAL.md §7.1 - last row of the
 * affordances table). Lists every (client × matter|null) thread with an
 * unread badge, opens the selected thread on the right, and lets advocates
 * reply. Polls at 60s - same cadence as the client side.
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

  const unreadTotal = items.reduce((n, t) => n + (t.unreadFromClient || 0), 0);

  return (
    <div className="col stagger cm-inbox" style={{ gap: 24 }}>
      <PageHeader
        title="Client Messages"
        description="Read and reply to messages clients send through the client portal."
      />

      <div className="inbox-grid">
        <aside className="card cm-threads" aria-label="Threads">
          <div className="cm-threads-head">
            <h2 className="cm-threads-title">Threads</h2>
            {items.length > 0 && (
              <span className="cm-label">{unreadTotal > 0 ? `${unreadTotal} unread` : `${items.length} ${items.length === 1 ? 'thread' : 'threads'}`}</span>
            )}
          </div>
          {inbox.isLoading && (
            <div aria-busy="true" aria-label="Loading inbox">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={`sk-${i}`} className="cm-thread" style={{ cursor: 'default' }}>
                  <Skeleton width={38} height={38} radius="pill" />
                  <div className="cm-thread-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Skeleton width="55%" height={13} />
                    <Skeleton width="40%" height={10} />
                    <Skeleton width="80%" height={11} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {inbox.isError && (
            <div style={{ padding: 16 }}>
              <ErrorState
                variant="inline"
                title="Couldn't load inbox"
                description="Check your connection and try again."
              />
            </div>
          )}
          {!inbox.isLoading && !inbox.isError && items.length === 0 && (
            <div style={{ padding: '28px 16px' }}>
              <EmptyState
                variant="inline"
                title="No portal messages yet"
                description="Threads with clients via their portal will appear here."
              />
            </div>
          )}
          {items.map((t) => {
            const k = threadKey(t);
            const active = k === selectedKey;
            const unread = t.unreadFromClient > 0;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setSelectedKey(k)}
                aria-current={active ? 'true' : undefined}
                className={`cm-thread${active ? ' is-active' : ''}${unread ? ' is-unread' : ''}`}
              >
                <span className="cm-avatar" aria-hidden>{initialsOf(t.clientName)}</span>
                <span className="cm-thread-body">
                  <span className="cm-thread-top">
                    <span className="cm-thread-name">{t.clientName}</span>
                    {threadTime(t) && <span className="cm-thread-time">{threadTime(t)}</span>}
                  </span>
                  <span className="cm-thread-matter" style={{ display: 'block' }}>{t.matterTitle ?? 'General thread'}</span>
                  <span className="cm-thread-row">
                    <span className="cm-thread-preview">{t.lastMessagePreview}</span>
                    {unread && (
                      <span className="cm-unread" aria-label={`${t.unreadFromClient} unread`}>
                        {t.unreadFromClient}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="card cm-pane">
          {selected ? (
            <ThreadPane
              clientId={selected.clientId}
              clientName={selected.clientName}
              matterId={selected.matterId}
              matterTitle={selected.matterTitle}
            />
          ) : (
            <div style={{ padding: '48px 16px' }}>
              <EmptyState
                variant="inline"
                title="Select a thread"
                description="Choose a conversation from the list to read it here."
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}

/** Short time for the thread list: "2:25 pm" today, else "29 Oct". */
function threadTime(t: FirmPortalThreadSummary): string {
  const raw = (t as unknown as { lastMessageAt?: string | null }).lastMessageAt;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
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
    <div className="col" style={{ gap: 0, height: '100%', minHeight: 0 }}>
      <header className="cm-pane-head">
        <span className="cm-avatar" aria-hidden>{initialsOf(clientName)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="cm-pane-name">{clientName}</div>
          <div className="cm-pane-matter">{matterTitle ?? 'General thread'}</div>
        </div>
      </header>

      <div className="cm-log" role="log" aria-live="polite">
        {thread.isLoading && (
          <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Skeleton width="40%" height={11} />
              <Skeleton width="75%" height={32} radius="md" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <Skeleton width="35%" height={11} />
              <Skeleton width="60%" height={28} radius="md" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Skeleton width="40%" height={11} />
              <Skeleton width="70%" height={40} radius="md" />
            </div>
          </div>
        )}
        {thread.isError && (
          <ErrorState
            variant="inline"
            title="Couldn't load messages"
            description="The next refresh will retry."
          />
        )}
        {thread.data && thread.data.items.length === 0 && (
          <div className="cm-log-empty">No messages yet - start the conversation.</div>
        )}
        {thread.data?.items.map((m) => <Bubble key={m.id} message={m} />)}
      </div>

      <form onSubmit={onSubmit} className="cm-composer">
        <div className="cm-composer-box">
          <textarea
            ref={composer}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Reply to the client…"
            aria-label="Reply"
          />
          <div className="cm-composer-bar">
            <span className="cm-composer-count">{draft.length}/4000</span>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={send.isPending || !draft.trim()}
            >
              {send.isPending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Bubble({ message }: { message: PortalMessage }) {
  const ts = new Date(message.sentAt).toLocaleString('en-IN', {
    dateStyle: 'medium', timeStyle: 'short',
  });
  return (
    <div className={`cm-msg${message.mine ? ' is-mine' : ''}`}>
      <div className="cm-msg-meta">
        <strong>{message.mine ? 'You' : message.senderName}</strong> · {ts}
      </div>
      <div className="cm-bubble">{message.body}</div>
    </div>
  );
}
