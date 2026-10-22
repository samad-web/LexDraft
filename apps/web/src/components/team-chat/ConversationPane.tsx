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
  /** Hide the title row when the host already shows it (matter tab). */
  compactHeader?: boolean;
}

export function ConversationPane({ conversationId, headerActions, compactHeader }: Props) {
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
    <div className="col" style={{ gap: 0, height: '100%', minHeight: 0 }}>
      <header
        className="row"
        style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-default)', gap: 12, alignItems: 'center' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          {!compactHeader && (
            <div style={{ fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {d?.title ?? ' '}
            </div>
          )}
          <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d ? memberLine(d, myId) : ' '}
          </div>
        </div>
        {d && (
          <button
            type="button"
            className="btn btn-ghost"
            title={d.muted ? 'Unmute: get notified again' : 'Mute: no notifications except @mentions'}
            onClick={() => update.mutate({ muted: !d.muted })}
            disabled={update.isPending}
          >
            <Icon name="bell" size={14} /> {d.muted ? 'Unmute' : 'Mute'}
          </button>
        )}
        {headerActions}
      </header>

      <div
        ref={scroller}
        onScroll={onScroll}
        style={{ padding: 16, overflowY: 'auto', flex: 1, minHeight: 0 }}
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

      <div style={{ padding: 12, borderTop: '1px solid var(--border-default)' }}>
        {(replyTo || editing) && (
          <div
            className="row"
            style={{
              gap: 8, alignItems: 'center', marginBottom: 8, padding: '6px 10px',
              borderLeft: '3px solid var(--info)', background: 'var(--bg-surface-2)', borderRadius: 6,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
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
              <span key={a.id} className="badge" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <Icon name="file" size={12} /> {a.name}
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setAttachments((xs) => xs.filter((x) => x.id !== a.id))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <MentionComposer
          inputRef={composer}
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          onEscape={() => (replyTo || editing) && resetComposer()}
          members={members.filter((m) => m.userId !== myId)}
          placeholder={d?.kind === 'matter' ? 'Message the matter team… (@ to mention)' : 'Type a message… (@ to mention)'}
        />
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {!editing && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPickerOpen(true)}
                disabled={attachments.length >= 5}
                title="Attach a document or draft from this firm"
              >
                <Icon name="file" size={14} /> Attach
              </button>
            )}
            <span className="muted" style={{ fontSize: 12 }}>Enter to send · Shift+Enter for a new line</span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={!draft.trim() || draft.length > MAX_LEN || send.isPending || edit.isPending}
          >
            {editing ? 'Save' : send.isPending ? 'Sending…' : 'Send'}
          </button>
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
              <button type="button" className="btn btn-oxblood" onClick={() => confirmDelete('everyone')}>
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
    <div className="mono muted" style={{ textAlign: 'center', fontSize: 10, letterSpacing: '0.1em', margin: '12px 0 8px' }}>
      {label.toUpperCase()}
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
      style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 6 }}
      onMouseLeave={() => setMenu(false)}
    >
      <div style={{ maxWidth: '75%', position: 'relative' }}>
        {showAuthor && !mine && (
          <div className="muted" style={{ fontSize: 11, marginBottom: 2 }}>{m.authorName}</div>
        )}
        <div
          style={{
            background: mine ? 'var(--text-primary)' : 'var(--bg-surface-2)',
            color: mine ? 'var(--bg-base)' : 'inherit',
            padding: '8px 12px', borderRadius: 10,
            border: mine ? 'none' : '1px solid var(--border-default)',
            fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {m.replyTo && !m.deleted && (
            <div style={{ borderLeft: '3px solid var(--info)', padding: '2px 8px', marginBottom: 6, opacity: 0.85, fontSize: 12 }}>
              <div style={{ fontWeight: 600 }}>{m.replyTo.authorName}</div>
              <div>{m.replyTo.body ?? 'This message was deleted'}</div>
            </div>
          )}
          {m.deleted ? (
            <em style={{ opacity: 0.7 }}>{mine ? 'You deleted this message' : 'This message was deleted'}</em>
          ) : (
            <MessageBody body={m.body ?? ''} members={members} mentionIds={m.mentions} myId={myId} />
          )}
          {m.attachments.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {m.attachments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="badge"
                  onClick={() => void openAttachment(a)}
                  style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}
                  title={a.kind === 'draft' ? 'Open draft' : 'Open document'}
                >
                  <Icon name={a.kind === 'draft' ? 'draft' : 'file'} size={12} /> {a.name}
                </button>
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: 'right' }}>
            {m.editedAt && !m.deleted && 'Edited · '}
            {time}
            {mine && !m.deleted && (
              <span
                aria-label={readByAll ? 'Read' : 'Sent'}
                title={readByAll ? 'Read by everyone' : 'Sent'}
                style={{ marginLeft: 4, color: readByAll ? 'var(--info)' : 'inherit' }}
              >
                {readByAll ? '✓✓' : '✓'}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Message actions"
          onClick={() => setMenu((o) => !o)}
          style={{ position: 'absolute', top: showAuthor && !mine ? 16 : 0, ...(mine ? { left: -34 } : { right: -34 }), padding: '0 6px' }}
        >
          <Icon name="more" size={14} />
        </button>
        {menu && (
          <div
            className="card"
            role="menu"
            style={{
              position: 'absolute', zIndex: 20, top: 24, ...(mine ? { right: 0 } : { left: 0 }),
              padding: 4, minWidth: 160, display: 'flex', flexDirection: 'column',
            }}
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
          <strong key={i} style={{ color: who.userId === myId ? 'var(--warning, #d97706)' : 'var(--info)' }}>{part}</strong>
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
          className="card"
          role="listbox"
          aria-label="Mention a member"
          style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, padding: 4, minWidth: 220, zIndex: 30 }}
        >
          {matches.map((m, i) => (
            <button
              key={m.userId}
              type="button"
              role="option"
              aria-selected={i === highlight}
              className="btn btn-ghost"
              onMouseDown={(e) => { e.preventDefault(); pick(m); }}
              style={{
                width: '100%', justifyContent: 'flex-start',
                background: i === highlight ? 'var(--bg-surface-2)' : undefined,
              }}
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
        style={{
          width: '100%', padding: '8px 10px', fontSize: 14,
          border: '1px solid var(--border-default)', borderRadius: 6,
          background: 'var(--card)', color: 'inherit', resize: 'vertical', fontFamily: 'inherit',
        }}
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
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or matter…"
        aria-label="Search documents"
        style={{ width: '100%', padding: '8px 10px', marginBottom: 12, border: '1px solid var(--border-default)', borderRadius: 6, background: 'var(--card)', color: 'inherit' }}
      />
      {docs.isLoading && <Skeleton width="100%" height={120} radius="md" />}
      {docs.isError && <ErrorState variant="inline" title="Couldn't load documents" description="Try again in a moment." />}
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
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
              style={{ width: '100%', justifyContent: 'space-between', gap: 12 }}
            >
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                <Icon name={kind === 'draft' ? 'draft' : 'file'} size={14} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
              </span>
              <span className="muted" style={{ fontSize: 12, flexShrink: 0 }}>{picked ? 'Attached' : d.case}</span>
            </button>
          );
        })}
        {docs.data && items.length === 0 && <div className="muted">No matching documents.</div>}
      </div>
    </Modal>
  );
}
