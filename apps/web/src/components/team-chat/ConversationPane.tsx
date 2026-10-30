import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, Icon, Skeleton } from '@lexdraft/ui';
import type { ConversationDetail, ConversationMember, MessageAttachment, TeamMessage } from '@lexdraft/types/messaging';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useDocuments } from '@/hooks/useDocuments';
import {
  flattenMessages,
  useConversation,
  useDeleteMessage,
  useEditMessage,
  useMarkRead,
  useMessages,
  useSendMessage,
  useTeamChatUi,
  useUpdateConversation,
} from '@/hooks/useTeamChat';

// =============================================================================
// ConversationPane - one conversation's thread + composer. Used by the Team
// Chat page and the matter Discussion tab.
//
// WhatsApp-style rules (enforced server-side; the UI only hides what the API
// would refuse): edit your own message for 15 min; delete for everyone within
// 48 h; delete for me any time.
// =============================================================================

const MAX_LEN = 4000;

interface Props {
  conversationId: string;
  /** Extra header controls (e.g. group member management). */
  headerActions?: ReactNode;
  /** Back-to-list arrow, shown on narrow screens only. */
  onBack?: () => void;
  /** Hide the title row when the host already shows it (matter tab). */
  compactHeader?: boolean;
}

export function ConversationPane({ conversationId, headerActions, compactHeader, onBack }: Props) {
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const showToast = useUIStore((s) => s.showToast);
  const detail = useConversation(conversationId);
  const messages = useMessages(conversationId);
  const send = useSendMessage(conversationId);
  const edit = useEditMessage();
  const del = useDeleteMessage();
  const markRead = useMarkRead();
  const update = useUpdateConversation(conversationId);
  const setActive = useTeamChatUi((s) => s.setActive);

  const items = useMemo(() => flattenMessages(messages.data), [messages.data]);
  const members = detail.data?.members ?? [];

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<TeamMessage | null>(null);
  const [editing, setEditing] = useState<TeamMessage | null>(null);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleting, setDeleting] = useState<TeamMessage | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const errorText = (err: unknown, fallback: string): string =>
    (err as Error)?.message || fallback;

  // Mark this conversation as the open one so incoming messages here don't
  // bump its unread count.
  useEffect(() => {
    setActive(conversationId);
    return () => setActive(null);
  }, [conversationId, setActive]);

  // Mark read when there's something newer than my read marker, debounced so
  // a burst of incoming messages costs one request.
  const lastFromOthers = [...items].reverse().find((m) => m.authorId !== myId);
  const myReadAt = members.find((m) => m.userId === myId)?.lastReadAt ?? null;
  const needsRead = !!lastFromOthers && (!myReadAt || myReadAt < lastFromOthers.createdAt);
  useEffect(() => {
    if (!needsRead) return;
    const fire = () => {
      if (document.visibilityState === 'visible') markRead.mutate(conversationId);
    };
    const t = setTimeout(fire, 800);
    document.addEventListener('visibilitychange', fire);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', fire); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRead, conversationId, lastFromOthers?.id]);

  // Keep pinned to the newest message unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [items.length, conversationId]);

  function onScroll(): void {
    const el = scroller.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder(): Promise<void> {
    const el = scroller.current;
    const prevHeight = el?.scrollHeight ?? 0;
    await messages.fetchNextPage();
    // Preserve the reading position after older messages are prepended.
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - prevHeight;
    });
  }

  function mentionsIn(text: string): string[] {
    return members.filter((m) => m.userId !== myId && text.includes(`@${m.name}`)).map((m) => m.userId);
  }

  function resetComposer(): void {
    setDraft('');
    setReplyTo(null);
    setEditing(null);
    setAttachments([]);
    composer.current?.focus();
  }

  function submit(): void {
    const body = draft.trim();
    if (!body) return;
    stickToBottom.current = true;
    if (editing) {
      edit.mutate({ id: editing.id, body, mentions: mentionsIn(body) }, {
        onSuccess: resetComposer,
        onError: (err) => showToast({ type: 'vermillion', text: errorText(err, 'Could not edit message') }),
      });
      return;
    }
    send.mutate({
      body,
      replyToId: replyTo?.id ?? null,
      mentions: mentionsIn(body),
      attachments,
    }, {
      onSuccess: resetComposer,
      onError: (err) => showToast({ type: 'vermillion', text: errorText(err, 'Message not sent') }),
    });
  }

  function startEdit(m: TeamMessage): void {
    setEditing(m);
    setReplyTo(null);
    setAttachments([]);
    setDraft(m.body ?? '');
    composer.current?.focus();
  }

  function confirmDelete(scope: 'me' | 'everyone'): void {
    if (!deleting) return;
    del.mutate({ message: deleting, scope }, {
      onError: (err) => showToast({ type: 'vermillion', text: errorText(err, 'Could not delete message') }),
    });
    setDeleting(null);
  }

  const d = detail.data;
  const showAuthors = d?.kind !== 'direct';

  return (
    <div className="fm-thread">
      <header className="fm-thread-head">
        {onBack && (
          // Only shown on narrow screens (TeamChatView's .team-chat-back rule).
          <button
            type="button"
            className="btn btn-ghost team-chat-back"
            onClick={onBack}
            aria-label="Back to conversations"
            style={{ padding: '0 6px', marginLeft: -6 }}
          >
            <Icon name="chevron" size={18} style={{ transform: 'rotate(180deg)' }} />
          </button>
        )}
        <div className="fm-thread-who">
          {!compactHeader && (
            <div className="fm-thread-title">
              {d?.title ?? ' '}
            </div>
          )}
          <div className="fm-thread-members">
            {d ? memberLine(d, myId) : ' '}
          </div>
        </div>
        {d && (
          <button
            type="button"
            className="btn btn-ghost"
            title={d.muted ? 'Unmute: get notified again' : 'Mute: no notifications except @mentions'}
            aria-label={d.muted ? 'Unmute' : 'Mute'}
            onClick={() => update.mutate({ muted: !d.muted })}
            disabled={update.isPending}
          >
            <Icon name="bell" size={14} />
            <span className="tc-btn-label"> {d.muted ? 'Unmute' : 'Mute'}</span>
          </button>
        )}
        {headerActions}
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="fm-thread-log"
        role="log"
        aria-live="polite"
      >
        {messages.isLoading && (
          <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Skeleton width="60%" height={32} radius="md" />
            <div style={{ alignSelf: 'flex-end', width: '50%' }}><Skeleton width="100%" height={28} radius="md" /></div>
            <Skeleton width="70%" height={40} radius="md" />
          </div>
        )}
        {messages.isError && (
          <ErrorState variant="inline" title="Couldn't load messages" description="Check your connection and try again." />
        )}
        {messages.hasNextPage && (
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => void loadOlder()} disabled={messages.isFetchingNextPage}>
              {messages.isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        )}
        {messages.data && items.length === 0 && (
          <EmptyState variant="inline" title="No messages yet" description="Say hello. Messages here are visible only to the members listed above." />
        )}
        {items.map((m, i) => {
          const prev = items[i - 1];
          const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
          return (
            <div key={m.id}>
              {newDay && <DaySeparator iso={m.createdAt} />}
              <Bubble
                message={m}
                mine={m.authorId === myId}
                showAuthor={showAuthors && (!prev || prev.authorId !== m.authorId || newDay)}
                members={members}
                myId={myId}
                onReply={() => { setEditing(null); setReplyTo(m); composer.current?.focus(); }}
                onEdit={() => startEdit(m)}
                onDelete={() => setDeleting(m)}
              />
            </div>
          );
        })}
      </div>

      <div className="fm-composer-wrap">
        {(replyTo || editing) && (
          <div className="fm-composer-ctx">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{editing ? 'Editing message' : `Replying to ${replyTo!.authorName}`}</div>
              <div className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(editing ?? replyTo)!.body ?? 'This message was deleted'}
              </div>
            </div>
            <button type="button" className="btn btn-ghost" aria-label="Cancel" onClick={resetComposer}>
              <Icon name="close" size={14} />
            </button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {attachments.map((a) => (
              <span key={a.id} className="fm-chip-file">
                <Icon name="file" size={12} /> <span>{a.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((xs) => xs.filter((x) => x.id !== a.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="fm-composer">
        <MentionComposer
          inputRef={composer}
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          onEscape={() => (replyTo || editing) && resetComposer()}
          members={members.filter((m) => m.userId !== myId)}
          placeholder={d?.kind === 'matter' ? 'Message the matter team… (@ to mention)' : 'Type a message… (@ to mention)'}
        />
        <div className="fm-composer-bar">
          <div className="row" style={{ gap: 8, alignItems: 'center', minWidth: 0 }}>
            {!editing && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setPickerOpen(true)}
                disabled={attachments.length >= 5}
                title="Attach a document or draft from this firm"
              >
                <Icon name="file" size={14} /> Attach
              </button>
            )}
            <span className="tc-hint">Enter to send · Shift+Enter for a new line</span>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={submit}
            disabled={!draft.trim() || draft.length > MAX_LEN || send.isPending || edit.isPending}
          >
            {editing ? 'Save' : send.isPending ? 'Sending…' : <>Send <Icon name="arrow" size={13} /></>}
          </button>
        </div>
        </div>
      </div>

      <AttachmentPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selected={attachments}
        onPick={(a) => setAttachments((xs) => (xs.some((x) => x.id === a.id) || xs.length >= 5 ? xs : [...xs, a]))}
      />

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete message?"
        width={420}
        footer={
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(null)}>Cancel</button>
            <button type="button" className="btn" onClick={() => confirmDelete('me')}>Delete for me</button>
            {deleting && canDeleteForEveryone(deleting, myId) && (
              <button type="button" className="btn btn-danger" onClick={() => confirmDelete('everyone')}>
                Delete for everyone
              </button>
            )}
          </div>
        }
      >
        <p className="body-sm muted">
          {deleting && canDeleteForEveryone(deleting, myId)
            ? 'Delete for everyone replaces the message with "This message was deleted" for all members. Delete for me hides it only from you.'
            : 'This hides the message only from you. Other members will still see it.'}
        </p>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------

function memberLine(d: ConversationDetail, myId: string | null): string {
  if (d.kind === 'direct') return 'Direct message';
  const names = d.members.map((m) => (m.userId === myId ? 'You' : m.name));
  const prefix = d.kind === 'matter' ? 'Assigned: ' : '';
  return `${prefix}${names.join(', ')}`;
}

function canEdit(m: TeamMessage, myId: string | null): boolean {
  return m.authorId === myId && !m.deleted && Date.now() < Date.parse(m.editableUntil);
}

function canDeleteForEveryone(m: TeamMessage, myId: string | null): boolean {
  return m.authorId === myId && !m.deleted && Date.now() < Date.parse(m.deletableUntil);
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function DaySeparator({ iso }: { iso: string }) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  const label = d.toDateString() === today.toDateString()
    ? 'Today'
    : d.toDateString() === yesterday.toDateString()
      ? 'Yesterday'
      : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div className="fm-day">
      <span>{label}</span>
    </div>
  );
}

interface BubbleProps {
  message: TeamMessage;
  mine: boolean;
  showAuthor: boolean;
  members: ConversationMember[];
  myId: string | null;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function Bubble({ message: m, mine, showAuthor, members, myId, onReply, onEdit, onDelete }: BubbleProps) {
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const showToast = useUIStore((s) => s.showToast);
  const time = new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  // Sent (✓) until every other member has read past this message (✓✓).
  const others = members.filter((x) => x.userId !== myId);
  const readByAll = others.length > 0 && others.every((x) => x.lastReadAt && x.lastReadAt >= m.createdAt);

  async function openAttachment(a: MessageAttachment): Promise<void> {
    if (a.kind === 'draft') {
      navigate('/app/draft', { state: { draftId: a.id } });
      return;
    }
    try {
      const { downloadUrl } = await api.get<{ downloadUrl: string }>(`/documents/${a.id}/download-url`);
      window.open(downloadUrl, '_blank', 'noopener');
    } catch {
      showToast({ type: 'amber', text: 'This document has no file to open. Showing the document register instead.' });
      navigate('/app/documents');
    }
  }

  return (
    <div
      className={`fm-msg${mine ? ' is-mine' : ''}${showAuthor && !mine ? ' has-author' : ''}`}
      onMouseLeave={() => setMenu(false)}
    >
      <div className="fm-msg-col">
        {showAuthor && !mine && (
          <div className="fm-msg-author">{m.authorName}</div>
        )}
        <div className="fm-bubble">
          {m.replyTo && !m.deleted && (
            <div className="fm-bubble-quote">
              <strong>{m.replyTo.authorName}</strong>
              <div>{m.replyTo.body ?? 'This message was deleted'}</div>
            </div>
          )}
          {m.deleted ? (
            <em style={{ opacity: 0.7 }}>{mine ? 'You deleted this message' : 'This message was deleted'}</em>
          ) : (
            <MessageBody body={m.body ?? ''} members={members} mentionIds={m.mentions} myId={myId} />
          )}
          {m.attachments.length > 0 && (
            <div className="fm-attach-row">
              {m.attachments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="fm-attach"
                  onClick={() => void openAttachment(a)}
                  title={a.kind === 'draft' ? 'Open draft' : 'Open document'}
                >
                  <Icon name={a.kind === 'draft' ? 'draft' : 'file'} size={13} /> {a.name}
                </button>
              ))}
            </div>
          )}
          <div className="fm-bubble-meta">
            {m.editedAt && !m.deleted && 'Edited · '}
            {time}
            {mine && !m.deleted && (
              <span
                aria-label={readByAll ? 'Read' : 'Sent'}
                title={readByAll ? 'Read by everyone' : 'Sent'}
                // Monochrome: read is a bold, fully opaque double tick.
                style={{ marginLeft: 4, fontWeight: readByAll ? 800 : 400, opacity: readByAll ? 1 : 0.8 }}
              >
                {readByAll ? '✓✓' : '✓'}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm fm-msg-more"
          aria-label="Message actions"
          aria-expanded={menu}
          onClick={() => setMenu((o) => !o)}
          style={{ top: showAuthor && !mine ? 22 : 2, ...(mine ? { left: -34 } : { right: -34 }) }}
        >
          <Icon name="more" size={14} />
        </button>
        {menu && (
          <div
            className="fm-msg-menu"
            role="menu"
            style={{ top: showAuthor && !mine ? 52 : 32, ...(mine ? { right: 0 } : { left: 0 }) }}
          >
            {!m.deleted && <MenuItem onClick={() => { setMenu(false); onReply(); }}>Reply</MenuItem>}
            {canEdit(m, myId) && <MenuItem onClick={() => { setMenu(false); onEdit(); }}>Edit</MenuItem>}
            <MenuItem onClick={() => { setMenu(false); onDelete(); }}>Delete…</MenuItem>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      className="btn btn-ghost"
      onClick={onClick}
      style={{ justifyContent: 'flex-start', width: '100%' }}
    >
      {children}
    </button>
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Renders the body with @mentions of tagged members highlighted. */
function MessageBody({ body, members, mentionIds, myId }: { body: string; members: ConversationMember[]; mentionIds: string[]; myId: string | null }) {
  const tagged = members.filter((m) => mentionIds.includes(m.userId));
  if (tagged.length === 0) return <>{body}</>;
  const re = new RegExp(`(@(?:${tagged.map((m) => escapeRegExp(m.name)).join('|')}))`, 'g');
  return (
    <>
      {body.split(re).map((part, i) => {
        const who = tagged.find((m) => part === `@${m.name}`);
        if (!who) return <span key={i}>{part}</span>;
        return (
          // Monochrome: mentions are bold; a mention of me is also underlined.
          <strong key={i} style={{ textDecoration: who.userId === myId ? 'underline' : 'none', textUnderlineOffset: 2 }}>{part}</strong>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Composer with @mention autocomplete
// ---------------------------------------------------------------------------

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onEscape: () => void;
  members: ConversationMember[];
  placeholder: string;
  inputRef: RefObject<HTMLTextAreaElement>;
}

function MentionComposer({ value, onChange, onSubmit, onEscape, members, placeholder, inputRef: ref }: ComposerProps) {
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);

  const matches = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, members]);

  function detect(text: string, caret: number): void {
    // "@" at a word start, followed by up to two words, right before the caret.
    const match = /(?:^|\s)@([^\s@]*(?: [^\s@]*)?)$/.exec(text.slice(0, caret));
    setQuery(match ? match[1]! : null);
    setHighlight(0);
  }

  function pick(m: ConversationMember): void {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret).replace(/@([^\s@]*(?: [^\s@]*)?)$/, `@${m.name} `);
    const next = before + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (matches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => (h + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => (h - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[highlight]!); return; }
      if (e.key === 'Escape') { e.preventDefault(); setQuery(null); return; }
    }
    if (e.key === 'Escape') { onEscape(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      {matches.length > 0 && (
        <div
          className="fm-mentions"
          role="listbox"
          aria-label="Mention a member"
        >
          {matches.map((m, i) => (
            <button
              key={m.userId}
              type="button"
              role="option"
              aria-selected={i === highlight}
              className="btn btn-ghost"
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
            >
              @{m.name}
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => { onChange(e.target.value); detect(e.target.value, e.target.selectionStart); }}
        onKeyDown={onKeyDown}
        onBlur={() => setQuery(null)}
        rows={2}
        maxLength={MAX_LEN}
        placeholder={placeholder}
        aria-label="Message"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachment picker - existing firm documents and drafts
// ---------------------------------------------------------------------------

function AttachmentPicker({ open, onClose, selected, onPick }: {
  open: boolean;
  onClose: () => void;
  selected: MessageAttachment[];
  onPick: (a: MessageAttachment) => void;
}) {
  const docs = useDocuments();
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const all = (docs.data ?? []).filter((d) => !!d.id);
    const needle = q.trim().toLowerCase();
    return (needle ? all.filter((d) => `${d.name} ${d.case}`.toLowerCase().includes(needle)) : all).slice(0, 50);
  }, [docs.data, q]);

  return (
    <Modal open={open} onClose={onClose} title="Attach a document or draft" width={560}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}
    >
      <div className="fm-search" style={{ marginBottom: 12 }}>
        <input
          type="search"
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or matter…"
          aria-label="Search documents"
        />
        <span className="fm-search-icon"><Icon name="search" size={14} /></span>
      </div>
      {docs.isLoading && <Skeleton width="100%" height={120} radius="md" />}
      {docs.isError && <ErrorState variant="inline" title="Couldn't load documents" description="Try again in a moment." />}
      <div className="fm-people">
        {items.map((d) => {
          const kind: MessageAttachment['kind'] = d.kind === 'draft' ? 'draft' : 'document';
          const picked = selected.some((s) => s.id === d.id);
          return (
            <button
              key={d.id}
              type="button"
              className="btn btn-ghost"
              disabled={picked}
              onClick={() => onPick({ kind, id: d.id!, name: d.name })}
              style={{ width: '100%', justifyContent: 'space-between', gap: 12, height: 'auto', minHeight: 44, padding: '8px 10px', color: 'var(--text-primary)' }}
            >
              <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                <span className="fm-doc-icon" style={{ width: 30, height: 30 }} aria-hidden><Icon name={kind === 'draft' ? 'draft' : 'file'} size={14} /></span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{d.name}</span>
              </span>
              <span className="muted" style={{ fontSize: 12, flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '40%' }}>{picked ? 'Attached' : d.case}</span>
            </button>
          );
        })}
        {docs.data && items.length === 0 && <div className="muted">No matching documents.</div>}
      </div>
    </Modal>
  );
}
