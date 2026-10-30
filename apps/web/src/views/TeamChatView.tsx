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
    <div className="col stagger fm-view fm-chat">
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
        <aside className="card team-chat-list">
          <div className="fm-chat-search">
            <div className="fm-search">
              <input
                type="search"
                className="input"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
              />
              <span className="fm-search-icon"><Icon name="search" size={14} /></span>
            </div>
          </div>
          <div className="fm-chat-rows">
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
          {list.data && items.length > 0 && visible.length === 0 && (
            <div className="fm-quiet" style={{ padding: '16px 12px' }}>No conversations match “{filter.trim()}”.</div>
          )}
          </div>
        </aside>

        <section className="card team-chat-thread">
          {selectedId ? (
            <ConversationPane
              key={selectedId}
              conversationId={selectedId}
              onBack={() => select(null)}
              headerActions={
                <>
                  {selected.data?.kind === 'group' && (
                    <button type="button" className="btn btn-ghost" onClick={() => setManageOpen(true)} aria-label="Members" title="Members">
                      <Icon name="members" size={14} /><span className="tc-btn-label"> Members</span>
                    </button>
                  )}
                  {selected.data?.kind === 'matter' && selected.data.caseId && (
                    <MatterLink caseId={selected.data.caseId} />
                  )}
                </>
              }
            />
          ) : (
            <div style={{ margin: 'auto', padding: 24 }}>
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
        .team-chat-back { display: none; }
        @media (max-width: 900px) {
          .team-chat-back { display: inline-flex; }
        }
        /* Phone (matches the shell's 767px breakpoint): the list scrolls with
           the page, and an open conversation fills the space between the
           topbar (56px) and the bottom tab bar (64px), WhatsApp-style, so the
           composer and Send are always on screen. */
        @media (max-width: 767px) {
          /* .stagger's fadeUp (fill: both) keeps a transform animation in
             effect, which turns this grid into the containing block for
             position: fixed and collapses the full-screen thread. */
          .team-chat-grid { height: auto; min-height: 0; animation: none !important; }
          .team-chat-grid.has-selection .team-chat-thread {
            position: fixed; left: 0; right: 0; z-index: 46;
            top: env(safe-area-inset-top, 0px);
            bottom: calc(86px + env(safe-area-inset-bottom, 0px));
            border-radius: 0; border-left: 0; border-right: 0; border-bottom: 0;
          }
          .tc-btn-label, .tc-hint { display: none; }
        }
      `}</style>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => /[A-Za-z0-9]/.test(p));
  if (parts.length === 0) return '?';
  return parts.length === 1 ? parts[0]!.slice(0, 2).toUpperCase() : (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function ConvoAvatar({ c }: { c: ConversationSummary }) {
  if (c.kind === 'matter') {
    return <span className="fm-avatar is-ink" aria-hidden><Icon name="cases" size={15} /></span>;
  }
  if (c.kind === 'group') {
    return <span className="fm-avatar" aria-hidden><Icon name="members" size={15} /></span>;
  }
  return <span className="fm-avatar" aria-hidden>{initialsOf(c.title)}</span>;
}

function ConversationRow({ c, active, onClick }: { c: ConversationSummary; active: boolean; onClick: () => void }) {
  const kindLabel = c.kind === 'matter' ? 'Matter' : c.kind === 'group' ? 'Group' : null;
  const when = c.lastMessageAt ? shortTime(c.lastMessageAt) : '';
  const unread = c.unreadCount > 0 && !c.muted;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`fm-convo${unread ? ' is-unread' : ''}`}
    >
      <ConvoAvatar c={c} />
      <span className="fm-convo-body">
        <span className="fm-convo-top">
          <span className="fm-convo-title">{c.title}</span>
          <span className="fm-convo-time">{when}</span>
        </span>
        <span className="fm-convo-bottom">
          <span className="fm-convo-preview">
            {kindLabel && <span className="fm-convo-kind">{kindLabel}</span>}
            {c.lastMessagePreview
              ? `${c.kind !== 'direct' && c.lastMessageAuthorName ? `${c.lastMessageAuthorName.split(' ')[0]}: ` : ''}${c.lastMessagePreview}`
              : 'No messages yet'}
          </span>
          <span className="fm-convo-flags">
            {c.muted && <span className="fm-convo-muted" title="Muted" aria-label="Muted"><Icon name="bell" size={12} /></span>}
            {c.mentionedUnread && <span className="fm-unread is-at" title="You were mentioned">@</span>}
            {c.unreadCount > 0 && (
              <span
                className={`fm-unread${c.muted ? ' is-muted' : ''}`}
                aria-label={`${c.unreadCount} unread`}
              >
                {c.unreadCount > 99 ? '99+' : c.unreadCount}
              </span>
            )}
          </span>
        </span>
      </span>
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
      <Icon name="cases" size={14} /><span className="tc-btn-label"> Open matter</span>
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
      <div className="fm-seg" role="tablist" style={{ marginBottom: 14 }}>
        {(['direct', 'group'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setPicked((p) => (m === 'direct' ? p.slice(0, 1) : p)); }}
          >
            {m === 'direct' ? 'Direct message' : 'Group'}
          </button>
        ))}
      </div>
      {mode === 'group' && (
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          placeholder="Group name, e.g. Litigation team"
          aria-label="Group name"
          style={{ width: '100%', marginBottom: 10 }}
        />
      )}
      <div className="fm-search" style={{ marginBottom: 10 }}>
        <input
          type="search"
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search colleagues"
          aria-label="Search colleagues"
        />
        <span className="fm-search-icon"><Icon name="search" size={14} /></span>
      </div>
      {teammates.isLoading && <Skeleton width="100%" height={120} radius="md" />}
      <div className="fm-people">
        {people.map((t) => {
          const on = picked.includes(t.id);
          return (
            <label key={t.id} className="fm-person">
              <input
                type={mode === 'direct' ? 'radio' : 'checkbox'}
                name="team-chat-person"
                checked={on}
                onChange={() => setPicked((p) => (mode === 'direct' ? [t.id] : on ? p.filter((x) => x !== t.id) : [...p, t.id]))}
              />
              <span className="fm-avatar is-sm" aria-hidden>{initialsOf(t.name)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="fm-person-name" style={{ display: 'block' }}>{t.name}</span>
                <span className="fm-person-role" style={{ display: 'block' }}>{t.role}</span>
              </span>
            </label>
          );
        })}
        {teammates.data && people.length === 0 && (
          <div className="fm-quiet">{(teammates.data ?? []).length <= 1 ? 'No colleagues in your firm yet. Invite members from Manage firm.' : 'No one matches that search.'}</div>
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
            className="btn btn-ghost"
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
        <div className="fm-inline" style={{ marginBottom: 16 }}>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            aria-label="Group name"
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
      <div className="fm-eyebrow" style={{ marginBottom: 6 }}>{conversation.members.length} members</div>
      <div className="col" style={{ gap: 0 }}>
        {conversation.members.map((m) => (
          <div key={m.userId} className="row" style={{ alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--border-subtle)' }}>
            <span className="fm-avatar is-sm" aria-hidden>{initialsOf(m.name)}</span>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>
              {m.userId === myId ? 'You' : m.name}
              {m.role === 'admin' && <span className="fm-pill is-muted" style={{ marginLeft: 8 }}>Admin</span>}
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
        <div className="fm-inline" style={{ marginTop: 16 }}>
          <select
            className="input"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            aria-label="Add member"
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
