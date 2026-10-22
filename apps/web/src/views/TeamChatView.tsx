import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, Icon, Skeleton } from '@lexdraft/ui';
import type { ConversationDetail, ConversationSummary } from '@lexdraft/types/messaging';
import { Modal } from '@/components/Modal';
import { PageHeader } from '@/components/PageHeader';
import { ConversationPane } from '@/components/team-chat/ConversationPane';
import { useCurrentUserId, useTeammates } from '@/hooks/useAssignments';
import {
  useAddGroupMembers,
  useConversation,
  useConversations,
  useCreateGroup,
  useOpenDirect,
  useRemoveGroupMember,
  useUpdateConversation,
} from '@/hooks/useTeamChat';
import { useUIStore } from '@/store/ui';

/**
 * Team Chat - internal messaging between firm members: direct messages,
 * groups, and matter discussions (the latter also live on each matter's
 * Discussion tab). `?c=<conversationId>` selects a conversation, so
 * notifications can deep-link straight into one.
 */
export function TeamChatView() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('c');
  const list = useConversations();
  const items = list.data ?? [];
  const [filter, setFilter] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const select = (id: string | null): void => {
    setParams(id ? { c: id } : {}, { replace: true });
  };

  // Desktop: open the most recent conversation by default.
  useEffect(() => {
    if (!selectedId && items.length > 0 && window.matchMedia('(min-width: 901px)').matches) {
      select(items[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, items.length]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? items.filter((c) => c.title.toLowerCase().includes(q)) : items;
  }, [items, filter]);

  const selected = useConversation(selectedId);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <PageHeader
        title="Team Chat"
        description="Message colleagues directly, in groups, or about a matter."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
            <Icon name="plus" size={14} /> New message
          </button>
        }
      />

      <div className={`team-chat-grid${selectedId ? ' has-selection' : ''}`}>
        <aside className="card team-chat-list" style={{ padding: 0, overflow: 'auto' }}>
          <div style={{ padding: 10, borderBottom: '1px solid var(--border-default)' }}>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--card)', color: 'inherit' }}
            />
          </div>
          {list.isLoading && (
            <div aria-busy="true" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} width="100%" height={36} />)}
            </div>
          )}
          {list.isError && (
            <div style={{ padding: 16 }}>
              <ErrorState variant="inline" title="Couldn't load conversations" description="Check your connection and try again." />
            </div>
          )}
          {list.data && items.length === 0 && (
            <div style={{ padding: 16 }}>
              <EmptyState
                variant="inline"
                title="No conversations yet"
                description="Start a direct message or a group with colleagues. Matter discussions appear here once someone posts on a matter."
              />
            </div>
          )}
          {visible.map((c) => (
            <ConversationRow key={c.id} c={c} active={c.id === selectedId} onClick={() => select(c.id)} />
          ))}
        </aside>

        <section className="card team-chat-thread" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {selectedId ? (
            <ConversationPane
              key={selectedId}
              conversationId={selectedId}
              headerActions={
                <>
                  <button type="button" className="btn btn-ghost team-chat-back" onClick={() => select(null)}>
                    Back
                  </button>
                  {selected.data?.kind === 'group' && (
                    <button type="button" className="btn btn-ghost" onClick={() => setManageOpen(true)}>
                      <Icon name="members" size={14} /> Members
                    </button>
                  )}
                  {selected.data?.kind === 'matter' && selected.data.caseId && (
                    <MatterLink caseId={selected.data.caseId} />
                  )}
                </>
              }
            />
          ) : (
            <div style={{ padding: 16 }}>
              <EmptyState variant="inline" title="Select a conversation" description="Choose a conversation from the list, or start a new one." />
            </div>
          )}
        </section>
      </div>

      <NewConversationModal open={newOpen} onClose={() => setNewOpen(false)} onOpened={(id) => { setNewOpen(false); select(id); }} />
      {selected.data?.kind === 'group' && (
        <GroupMembersModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          conversation={selected.data}
          onLeft={() => { setManageOpen(false); select(null); }}
        />
      )}

      <style>{`
        .team-chat-grid { display: grid; grid-template-columns: 320px 1fr; gap: 16px; height: calc(100vh - 230px); min-height: 480px; }
        .team-chat-list, .team-chat-thread { min-height: 0; }
        .team-chat-back { display: none; }
        @media (max-width: 900px) {
          .team-chat-grid { grid-template-columns: 1fr; height: calc(100vh - 200px); }
          .team-chat-grid.has-selection .team-chat-list { display: none; }
          .team-chat-grid:not(.has-selection) .team-chat-thread { display: none !important; }
          .team-chat-back { display: inline-flex; }
        }
      `}</style>
    </div>
  );
}

function ConversationRow({ c, active, onClick }: { c: ConversationSummary; active: boolean; onClick: () => void }) {
  const kindLabel = c.kind === 'matter' ? 'Matter' : c.kind === 'group' ? 'Group' : null;
  const when = c.lastMessageAt ? shortTime(c.lastMessageAt) : '';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        padding: '12px 14px', background: active ? 'var(--bg-surface-2)' : 'transparent',
        border: 'none', borderBottom: '1px solid var(--border-default)', cursor: 'pointer', color: 'inherit',
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontWeight: c.unreadCount > 0 ? 700 : 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.title}
        </div>
        <span className="muted mono" style={{ fontSize: 10, flexShrink: 0 }}>{when}</span>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {kindLabel && <span className="mono" style={{ fontSize: 9, letterSpacing: '0.1em', marginRight: 6 }}>{kindLabel.toUpperCase()}</span>}
          {c.lastMessagePreview
            ? `${c.kind !== 'direct' && c.lastMessageAuthorName ? `${c.lastMessageAuthorName.split(' ')[0]}: ` : ''}${c.lastMessagePreview}`
            : 'No messages yet'}
        </div>
        <span className="row" style={{ gap: 4, flexShrink: 0 }}>
          {c.muted && <span className="muted" title="Muted" style={{ fontSize: 11 }}>muted</span>}
          {c.mentionedUnread && <span className="badge badge-amber" title="You were mentioned">@</span>}
          {c.unreadCount > 0 && (
            <span className={`badge ${c.muted ? '' : 'badge-vermillion'}`} aria-label={`${c.unreadCount} unread`}>
              {c.unreadCount > 99 ? '99+' : c.unreadCount}
            </span>
          )}
        </span>
      </div>
    </button>
  );
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function MatterLink({ caseId }: { caseId: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" className="btn btn-ghost" onClick={() => navigate(`/app/cases/${caseId}?tab=discussion`)}>
      <Icon name="cases" size={14} /> Open matter
    </button>
  );
}

// ---------------------------------------------------------------------------

function NewConversationModal({ open, onClose, onOpened }: { open: boolean; onClose: () => void; onOpened: (id: string) => void }) {
  const teammates = useTeammates();
  const myId = useCurrentUserId();
  const openDirect = useOpenDirect();
  const createGroup = useCreateGroup();
  const showToast = useUIStore((s) => s.showToast);
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) { setPicked([]); setTitle(''); setQ(''); setMode('direct'); }
  }, [open]);

  const people = (teammates.data ?? [])
    .filter((t) => t.id !== myId)
    .filter((t) => `${t.name} ${t.email} ${t.role}`.toLowerCase().includes(q.trim().toLowerCase()));

  const fail = (err: unknown) => showToast({ type: 'vermillion', text: (err as Error)?.message || 'Could not start conversation' });

  function start(): void {
    if (mode === 'direct') {
      if (!picked[0]) return;
      openDirect.mutate(picked[0], { onSuccess: (c) => onOpened(c.id), onError: fail });
    } else {
      if (!title.trim() || picked.length === 0) return;
      createGroup.mutate({ title: title.trim(), memberIds: picked }, { onSuccess: (c) => onOpened(c.id), onError: fail });
    }
  }

  const busy = openDirect.isPending || createGroup.isPending;
  const ready = mode === 'direct' ? picked.length === 1 : picked.length > 0 && !!title.trim();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New message"
      width={520}
      footer={
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={start} disabled={!ready || busy}>
            {busy ? 'Opening…' : mode === 'direct' ? 'Open chat' : 'Create group'}
          </button>
        </div>
      }
    >
      <div className="matter-intel-tabs" role="tablist" style={{ marginBottom: 12 }}>
        {(['direct', 'group'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={`matter-intel-tab${mode === m ? ' is-active' : ''}`}
            onClick={() => { setMode(m); setPicked((p) => (m === 'direct' ? p.slice(0, 1) : p)); }}
          >
            {m === 'direct' ? 'Direct message' : 'Group'}
          </button>
        ))}
      </div>
      {mode === 'group' && (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder="Group name, e.g. Litigation team"
          aria-label="Group name"
          style={{ width: '100%', padding: '8px 10px', marginBottom: 10, border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--card)', color: 'inherit' }}
        />
      )}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search colleagues"
        aria-label="Search colleagues"
        style={{ width: '100%', padding: '8px 10px', marginBottom: 10, border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--card)', color: 'inherit' }}
      />
      {teammates.isLoading && <Skeleton width="100%" height={120} radius="md" />}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {people.map((t) => {
          const on = picked.includes(t.id);
          return (
            <label key={t.id} className="row" style={{ gap: 10, padding: '8px 4px', cursor: 'pointer', alignItems: 'center' }}>
              <input
                type={mode === 'direct' ? 'radio' : 'checkbox'}
                name="team-chat-person"
                checked={on}
                onChange={() => setPicked((p) => (mode === 'direct' ? [t.id] : on ? p.filter((x) => x !== t.id) : [...p, t.id]))}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{t.name}</span>
                <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>{t.role}</span>
              </span>
            </label>
          );
        })}
        {teammates.data && people.length === 0 && (
          <div className="muted">{(teammates.data ?? []).length <= 1 ? 'No colleagues in your firm yet. Invite members from Manage firm.' : 'No one matches that search.'}</div>
        )}
      </div>
    </Modal>
  );
}

function GroupMembersModal({ open, onClose, conversation, onLeft }: {
  open: boolean;
  onClose: () => void;
  conversation: ConversationDetail;
  onLeft: () => void;
}) {
  const myId = useCurrentUserId();
  const teammates = useTeammates();
  const add = useAddGroupMembers(conversation.id);
  const remove = useRemoveGroupMember(conversation.id);
  const rename = useUpdateConversation(conversation.id);
  const showToast = useUIStore((s) => s.showToast);
  const [title, setTitle] = useState(conversation.title);
  const [adding, setAdding] = useState('');

  useEffect(() => { setTitle(conversation.title); }, [conversation.title]);

  const fail = (err: unknown) => showToast({ type: 'vermillion', text: (err as Error)?.message || 'Something went wrong' });
  const inGroup = new Set(conversation.members.map((m) => m.userId));
  const candidates = (teammates.data ?? []).filter((t) => !inGroup.has(t.id));

  return (
    <Modal open={open} onClose={onClose} title="Group members" width={480}
      footer={
        <div className="row" style={{ gap: 8, justifyContent: 'space-between', width: '100%' }}>
          <button
            type="button"
            className="btn btn-oxblood"
            onClick={() => myId && remove.mutate(myId, { onSuccess: onLeft, onError: fail })}
            disabled={remove.isPending}
          >
            Leave group
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      }
    >
      {conversation.canManage && (
        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            aria-label="Group name"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--card)', color: 'inherit' }}
          />
          <button
            type="button"
            className="btn"
            disabled={!title.trim() || title.trim() === conversation.title || rename.isPending}
            onClick={() => rename.mutate({ title: title.trim() }, { onError: fail })}
          >
            Rename
          </button>
        </div>
      )}
      <div className="col" style={{ gap: 4 }}>
        {conversation.members.map((m) => (
          <div key={m.userId} className="row" style={{ alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <span style={{ flex: 1 }}>
              {m.userId === myId ? 'You' : m.name}
              {m.role === 'admin' && <span className="badge" style={{ marginLeft: 8 }}>Admin</span>}
            </span>
            {conversation.canManage && m.userId !== myId && (
              <button type="button" className="btn btn-ghost" onClick={() => remove.mutate(m.userId, { onError: fail })}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {conversation.canManage && candidates.length > 0 && (
        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <select
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            aria-label="Add member"
            style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--card)', color: 'inherit' }}
          >
            <option value="">Add a colleague…</option>
            {candidates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button
            type="button"
            className="btn"
            disabled={!adding || add.isPending}
            onClick={() => add.mutate([adding], { onSuccess: () => setAdding(''), onError: fail })}
          >
            Add
          </button>
        </div>
      )}
    </Modal>
  );
}
