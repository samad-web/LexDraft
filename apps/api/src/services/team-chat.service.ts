import type { AuditAction, AuditLogEntry } from '@lexdraft/types';
import type {
  ConversationDetail,
  ConversationKind,
  ConversationMember,
  ConversationSummary,
  MatterDiscussionAccess,
  MessageAttachment,
  MessagePage,
  SendMessageRequest,
  TeamMessage,
} from '@lexdraft/types/messaging';
import { db } from '../db/client';
import { logger } from '../logger';
import { BadRequestError, ForbiddenError, NotFoundError, UnprocessableEntityError } from '../lib/errors';
import { auditService } from './audit.service';
import { assignmentsService, isHeadRole } from './assignments.service';
import { jobs } from './jobs.service';
import { notificationsStore } from './notifications.service';
import { teamChatRealtime } from './team-chat-realtime';

// =============================================================================
// team-chat.service - internal team messaging (migration 0087).
//
// Access model
//   direct / group  - active rows in conversation_members.
//   matter          - live from case_assignments: exactly the users assigned to
//                     the matter (lead, collaborators, co-counsel guests). Firm
//                     heads who are not assigned do not see the discussion, but
//                     can assign themselves.
//   Every "you can't see this" path returns 404, never 403, so conversation
//   ids don't leak existence.
//
// Edit / delete (WhatsApp parity) - see the migration header. Edits keep every
// previous body in message_edits; delete-for-everyone keeps the body in the row
// but the API never returns it again.
// =============================================================================

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const DELETE_FOR_EVERYONE_WINDOW_MS = 48 * 60 * 60 * 1000;
const PAGE_SIZE = 50;
const MAX_GROUP_MEMBERS = 100;
const MAX_ATTACHMENTS = 5;
/** Unread DMs / mentions are emailed if still unread after this long. */
const UNREAD_EMAIL_DELAY_SEC = 15 * 60;

export interface Viewer {
  id: string;
  /** The caller's own firm. Null for a guest with no firm of their own. */
  firmId: string | null;
  role: string;
  isSuperadmin: boolean;
  /** Who the audit log should name (the real admin during impersonation). */
  auditActorId: string;
  auditActorEmail: string;
}

interface ConversationRow {
  id: string;
  firm_id: string;
  kind: ConversationKind;
  case_id: string | null;
  title: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  author_id: string | null;
  author_name: string | null;
  body: string;
  attachments: MessageAttachment[] | string | null;
  mentions: string[] | null;
  created_at: Date;
  edited_at: Date | null;
  deleted_for_everyone_at: Date | null;
  reply_id: string | null;
  reply_author_name: string | null;
  reply_body: string | null;
  reply_deleted: boolean | null;
}

interface SummaryRow {
  id: string;
  kind: ConversationKind;
  case_id: string | null;
  title: string | null;
  case_title: string | null;
  other_name: string | null;
  last_message_at: Date | null;
  last_body: string | null;
  last_deleted: boolean | null;
  last_author_name: string | null;
  unread: number;
  mentioned_unread: boolean;
  muted: boolean;
  my_role: 'admin' | 'member';
}

function requireSql() {
  const sql = db();
  if (!sql) throw new UnprocessableEntityError('Team messaging requires a database');
  return sql;
}

function iso(v: Date | string | null): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function parseAttachments(raw: MessageRow['attachments']): MessageAttachment[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as MessageAttachment[]; } catch { return []; }
  }
  return raw;
}

function preview(body: string, max = 140): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function rowToMessage(r: MessageRow): TeamMessage {
  const deleted = r.deleted_for_everyone_at != null;
  const created = r.created_at instanceof Date ? r.created_at : new Date(r.created_at);
  return {
    id: r.id,
    conversationId: r.conversation_id,
    authorId: r.author_id,
    authorName: r.author_name ?? 'Former member',
    body: deleted ? null : r.body,
    replyTo: r.reply_id
      ? {
          id: r.reply_id,
          authorName: r.reply_author_name ?? 'Former member',
          body: r.reply_deleted ? null : preview(r.reply_body ?? ''),
        }
      : null,
    attachments: deleted ? [] : parseAttachments(r.attachments),
    mentions: deleted ? [] : (r.mentions ?? []),
    createdAt: created.toISOString(),
    editedAt: deleted ? null : iso(r.edited_at),
    deleted,
    editableUntil: new Date(created.getTime() + EDIT_WINDOW_MS).toISOString(),
    deletableUntil: new Date(created.getTime() + DELETE_FOR_EVERYONE_WINDOW_MS).toISOString(),
  };
}

function rowToSummary(r: SummaryRow): ConversationSummary {
  const title = r.kind === 'matter'
    ? (r.case_title ?? 'Matter discussion')
    : r.kind === 'direct'
      ? (r.other_name ?? 'Former member')
      : (r.title ?? 'Group');
  return {
    id: r.id,
    kind: r.kind,
    title,
    caseId: r.case_id,
    lastMessageAt: iso(r.last_message_at),
    lastMessagePreview: r.last_deleted
      ? 'This message was deleted'
      : r.last_body != null ? preview(r.last_body, 80) : null,
    lastMessageAuthorName: r.last_author_name,
    unreadCount: r.unread,
    mentionedUnread: r.mentioned_unread,
    muted: r.muted,
  };
}

// Columns + joins that build a TeamMessage. `$viewer` filtering (delete-for-me)
// is applied by each caller.
const MESSAGE_SELECT = `
  select m.id, m.conversation_id, m.author_id, u.name as author_name, m.body,
         m.attachments, m.created_at, m.edited_at, m.deleted_for_everyone_at,
         coalesce((select array_agg(mm.user_id::text) from message_mentions mm where mm.message_id = m.id), '{}') as mentions,
         r.id as reply_id, ru.name as reply_author_name, r.body as reply_body,
         (r.deleted_for_everyone_at is not null) as reply_deleted
  from messages m
  left join users u  on u.id = m.author_id
  left join messages r on r.id = m.reply_to_id
  left join users ru on ru.id = r.author_id
`;

async function loadMessageDto(messageId: string): Promise<TeamMessage | undefined> {
  const sql = db();
  if (!sql) return undefined;
  const rows = await sql<MessageRow[]>`
    ${sql.unsafe(MESSAGE_SELECT)}
    where m.id = ${messageId}::uuid
    limit 1
  `;
  return rows[0] ? rowToMessage(rows[0]) : undefined;
}

teamChatRealtime.setMessageLoader(loadMessageDto);

async function audit(viewer: Viewer, action: string, targetId: string, payload?: unknown): Promise<void> {
  try {
    await auditService.write({
      actorUserId: viewer.auditActorId,
      actorEmail: viewer.auditActorEmail,
      // Messaging actions are not yet in the shared AuditAction union; the
      // audit_log column is free text, so the cast is storage-safe.
      action: action as AuditAction,
      targetType: 'team_message' as AuditLogEntry['targetType'],
      targetId,
      payload,
    });
  } catch (err) {
    logger.warn({ err, action }, 'team-chat audit write failed');
  }
}

// ---------------------------------------------------------------------------
// Access helpers
// ---------------------------------------------------------------------------

async function loadConversation(conversationId: string): Promise<ConversationRow | undefined> {
  const sql = requireSql();
  const rows = await sql<ConversationRow[]>`
    select id, firm_id, kind, case_id, title
    from conversations where id = ${conversationId}::uuid limit 1
  `;
  return rows[0];
}

/** The viewer's membership role, or null when they can't see the conversation. */
async function membership(conv: ConversationRow, userId: string): Promise<'admin' | 'member' | null> {
  const sql = requireSql();
  if (conv.kind === 'matter') {
    const rows = await sql<Array<{ user_id: string }>>`
      select user_id from case_assignments
      where case_id = ${conv.case_id}::uuid and user_id = ${userId}::uuid
      limit 1
    `;
    return rows.length > 0 ? 'member' : null;
  }
  const rows = await sql<Array<{ role: 'admin' | 'member' }>>`
    select role from conversation_members
    where conversation_id = ${conv.id}::uuid and user_id = ${userId}::uuid and left_at is null
    limit 1
  `;
  return rows[0]?.role ?? null;
}

async function requireAccess(conversationId: string, viewer: Viewer): Promise<{ conv: ConversationRow; role: 'admin' | 'member' }> {
  const conv = await loadConversation(conversationId);
  const role = conv ? await membership(conv, viewer.id) : null;
  if (!conv || !role) throw new NotFoundError('Conversation not found');
  return { conv, role };
}

/** Everyone currently in the conversation (recipients for fan-out). */
async function memberIds(conv: ConversationRow): Promise<string[]> {
  const sql = requireSql();
  const rows = conv.kind === 'matter'
    ? await sql<Array<{ user_id: string }>>`
        select user_id from case_assignments where case_id = ${conv.case_id}::uuid
      `
    : await sql<Array<{ user_id: string }>>`
        select user_id from conversation_members
        where conversation_id = ${conv.id}::uuid and left_at is null
      `;
  return rows.map((r) => r.user_id);
}

async function members(conv: ConversationRow): Promise<ConversationMember[]> {
  const sql = requireSql();
  const rows = conv.kind === 'matter'
    ? await sql<Array<{ user_id: string; name: string; role: 'admin' | 'member'; last_read_at: Date | null }>>`
        select ca.user_id, u.name, 'member' as role, cm.last_read_at
        from case_assignments ca
        join users u on u.id = ca.user_id
        left join conversation_members cm
          on cm.conversation_id = ${conv.id}::uuid and cm.user_id = ca.user_id
        where ca.case_id = ${conv.case_id}::uuid
        order by u.name
      `
    : await sql<Array<{ user_id: string; name: string; role: 'admin' | 'member'; last_read_at: Date | null }>>`
        select cm.user_id, u.name, cm.role, cm.last_read_at
        from conversation_members cm
        join users u on u.id = cm.user_id
        where cm.conversation_id = ${conv.id}::uuid and cm.left_at is null
        order by u.name
      `;
  return rows.map((r) => ({ userId: r.user_id, name: r.name, role: r.role, lastReadAt: iso(r.last_read_at) }));
}

/** Summaries for the viewer. With `conversationId`, returns just that one
 *  (and doubles as the access check); without, the inbox list - matter
 *  threads only appear once they have a message. */
async function summaries(viewer: Viewer, conversationId?: string): Promise<SummaryRow[]> {
  const sql = requireSql();
  const only = conversationId ? sql`and c.id = ${conversationId}::uuid` : sql``;
  const matterHasMessages = conversationId ? sql`` : sql`and c.last_message_at is not null`;
  return sql<SummaryRow[]>`
    with mine as (
      select c.id, cm.role as my_role, cm.last_read_at, cm.muted
      from conversations c
      join conversation_members cm
        on cm.conversation_id = c.id and cm.user_id = ${viewer.id}::uuid and cm.left_at is null
      where c.kind in ('direct', 'group') ${only}
      union all
      select c.id, 'member' as my_role, cm.last_read_at, coalesce(cm.muted, false) as muted
      from conversations c
      join case_assignments ca on ca.case_id = c.case_id and ca.user_id = ${viewer.id}::uuid
      left join conversation_members cm on cm.conversation_id = c.id and cm.user_id = ${viewer.id}::uuid
      where c.kind = 'matter' ${only} ${matterHasMessages}
    )
    select c.id, c.kind, c.case_id, c.title, c.last_message_at, mine.muted, mine.my_role,
           cs.title as case_title,
           (select u2.name from conversation_members o join users u2 on u2.id = o.user_id
             where c.kind = 'direct' and o.conversation_id = c.id and o.user_id <> ${viewer.id}::uuid
             limit 1) as other_name,
           lm.body as last_body, lm.deleted as last_deleted, lm.author_name as last_author_name,
           (select count(*)::int from messages m
             where m.conversation_id = c.id
               and m.created_at > coalesce(mine.last_read_at, '-infinity'::timestamptz)
               and m.author_id is distinct from ${viewer.id}::uuid
               and m.deleted_for_everyone_at is null
               and not exists (select 1 from message_hidden h where h.message_id = m.id and h.user_id = ${viewer.id}::uuid)
           ) as unread,
           exists (select 1 from message_mentions mm join messages m on m.id = mm.message_id
             where mm.user_id = ${viewer.id}::uuid and m.conversation_id = c.id
               and m.created_at > coalesce(mine.last_read_at, '-infinity'::timestamptz)
               and m.deleted_for_everyone_at is null
           ) as mentioned_unread
    from mine
    join conversations c on c.id = mine.id
    left join cases cs on cs.id = c.case_id
    left join lateral (
      select m.body, (m.deleted_for_everyone_at is not null) as deleted, u.name as author_name
      from messages m left join users u on u.id = m.author_id
      where m.conversation_id = c.id
        and not exists (select 1 from message_hidden h where h.message_id = m.id and h.user_id = ${viewer.id}::uuid)
      order by m.created_at desc
      limit 1
    ) lm on true
    order by c.last_message_at desc nulls last, c.created_at desc
    limit 200
  `;
}

async function detail(viewer: Viewer, conversationId: string): Promise<ConversationDetail> {
  const [row] = await summaries(viewer, conversationId);
  if (!row) throw new NotFoundError('Conversation not found');
  const conv = await loadConversation(conversationId);
  if (!conv) throw new NotFoundError('Conversation not found');
  return {
    ...rowToSummary(row),
    members: await members(conv),
    canManage: conv.kind === 'group' && row.my_role === 'admin',
  };
}

async function requireTeammates(userIds: string[], firmId: string): Promise<void> {
  for (const id of userIds) await assignmentsService.requireTeammate(id, firmId);
}

async function validateAttachments(input: MessageAttachment[] | undefined, firmId: string): Promise<MessageAttachment[]> {
  if (!input || input.length === 0) return [];
  if (input.length > MAX_ATTACHMENTS) throw new BadRequestError(`At most ${MAX_ATTACHMENTS} attachments per message`);
  const sql = requireSql();
  const out: MessageAttachment[] = [];
  for (const a of input) {
    // Names come from the DB, not the client, so a chip can't be spoofed.
    const rows = a.kind === 'document'
      ? await sql<Array<{ name: string }>>`
          select name from documents where id = ${a.id}::uuid and firm_id = ${firmId}::uuid limit 1
        `
      : await sql<Array<{ name: string }>>`
          select title as name from drafts where id = ${a.id}::uuid and firm_id = ${firmId}::uuid limit 1
        `;
    if (!rows[0]) throw new BadRequestError('Attachment not found in this firm');
    out.push({ kind: a.kind, id: a.id, name: rows[0].name });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Notifications (in-app bell + delayed email for unread DMs / mentions)
// ---------------------------------------------------------------------------

interface UnreadEmailPayload {
  userId: string;
  conversationId: string;
  messageId: string;
}

jobs.register<UnreadEmailPayload>('team-chat.unread-email', async (data) => {
  const sql = db();
  if (!sql) return;
  const [row] = await sql<Array<{
    email: string | null; name: string; author_name: string | null; body: string;
    created_at: Date; deleted: boolean; last_read_at: Date | null; muted: boolean | null;
  }>>`
    select u.email, u.name, au.name as author_name, m.body, m.created_at,
           (m.deleted_for_everyone_at is not null) as deleted,
           cm.last_read_at, cm.muted
    from messages m
    join users u on u.id = ${data.userId}::uuid and (u.status is null or u.status = 'active')
    left join users au on au.id = m.author_id
    left join conversation_members cm
      on cm.conversation_id = m.conversation_id and cm.user_id = u.id
    where m.id = ${data.messageId}::uuid and m.conversation_id = ${data.conversationId}::uuid
    limit 1
  `;
  if (!row || !row.email || row.deleted || row.muted) return;
  if (row.last_read_at && row.last_read_at >= row.created_at) return; // read in the meantime
  const conv = await loadConversation(data.conversationId);
  if (!conv || !(await membership(conv, data.userId))) return;
  const author = row.author_name ?? 'A colleague';
  await jobs.enqueue('email.send', {
    to: row.email,
    subject: `${author} sent you a message on LexDraft`,
    body: [
      `Hi ${row.name},`,
      ``,
      `You have an unread message from ${author}:`,
      ``,
      `  "${preview(row.body, 300)}"`,
      ``,
      `Open Team Chat in LexDraft to read and reply.`,
    ].join('\n'),
  });
});

async function notifyRecipients(args: {
  conv: ConversationRow;
  conversationTitle: string;
  messageId: string;
  authorId: string;
  authorName: string;
  body: string;
  mentions: string[];
  recipients: string[];
}): Promise<void> {
  const sql = requireSql();
  const others = args.recipients.filter((id) => id !== args.authorId);
  if (others.length === 0) return;
  const mutedRows = await sql<Array<{ user_id: string }>>`
    select user_id from conversation_members
    where conversation_id = ${args.conv.id}::uuid and muted = true
  `;
  const muted = new Set(mutedRows.map((r) => r.user_id));
  const mentioned = new Set(args.mentions);
  const view = `team-chat?c=${args.conv.id}`;

  for (const userId of others) {
    const isMention = mentioned.has(userId);
    // Mentions break through mute (WhatsApp behaviour); plain messages don't.
    if (muted.has(userId) && !isMention) continue;
    if (!isMention && args.conv.kind !== 'direct') continue; // group/matter: badge only

    await notificationsStore.create({
      firmId: args.conv.firm_id,
      userId,
      tone: 'cobalt',
      icon: 'chat',
      title: isMention
        ? `${args.authorName} mentioned you in ${args.conversationTitle}`
        : `${args.authorName} sent you a message`,
      body: preview(args.body),
      view,
      dedupeKey: `${isMention ? 'team-chat-mention' : 'team-chat-dm'}:${args.conv.id}`,
    });
    try {
      await jobs.enqueue<UnreadEmailPayload>(
        'team-chat.unread-email',
        { userId, conversationId: args.conv.id, messageId: args.messageId },
        { delaySec: UNREAD_EMAIL_DELAY_SEC, singletonKey: `team-chat:${userId}:${args.conv.id}` },
      );
    } catch (err) {
      logger.warn({ err, userId }, 'team-chat: unread email enqueue failed');
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const teamChatService = {
  async listConversations(viewer: Viewer): Promise<ConversationSummary[]> {
    const rows = await summaries(viewer);
    return rows.map(rowToSummary);
  },

  async getConversation(viewer: Viewer, conversationId: string): Promise<ConversationDetail> {
    return detail(viewer, conversationId);
  },

  /** Open (or create) the DM between the viewer and another firm member. */
  async openDirect(viewer: Viewer, otherUserId: string): Promise<ConversationDetail> {
    if (!viewer.firmId) throw new UnprocessableEntityError('No firm attached');
    if (otherUserId === viewer.id) throw new BadRequestError("You can't message yourself");
    await assignmentsService.requireTeammate(otherUserId, viewer.firmId);
    const sql = requireSql();
    const key = [viewer.id, otherUserId].sort().join(':');
    const id = await sql.begin(async (tx) => {
      await tx`
        insert into conversations (firm_id, kind, direct_key, created_by)
        values (${viewer.firmId}::uuid, 'direct', ${key}, ${viewer.id}::uuid)
        on conflict (firm_id, direct_key) where kind = 'direct' do nothing
      `;
      const [row] = await tx<Array<{ id: string }>>`
        select id from conversations
        where firm_id = ${viewer.firmId}::uuid and kind = 'direct' and direct_key = ${key}
      `;
      for (const uid of [viewer.id, otherUserId]) {
        await tx`
          insert into conversation_members (conversation_id, user_id, role)
          values (${row!.id}::uuid, ${uid}::uuid, 'member')
          on conflict (conversation_id, user_id) do update set left_at = null
        `;
      }
      return row!.id;
    });
    return detail(viewer, id);
  },

  async createGroup(viewer: Viewer, title: string, memberUserIds: string[]): Promise<ConversationDetail> {
    if (!viewer.firmId) throw new UnprocessableEntityError('No firm attached');
    const others = Array.from(new Set(memberUserIds.filter((id) => id !== viewer.id)));
    if (others.length === 0) throw new BadRequestError('Add at least one other member');
    if (others.length + 1 > MAX_GROUP_MEMBERS) throw new BadRequestError(`Groups are limited to ${MAX_GROUP_MEMBERS} members`);
    await requireTeammates(others, viewer.firmId);
    const sql = requireSql();
    const id = await sql.begin(async (tx) => {
      const [row] = await tx<Array<{ id: string }>>`
        insert into conversations (firm_id, kind, title, created_by)
        values (${viewer.firmId}::uuid, 'group', ${title}, ${viewer.id}::uuid)
        returning id
      `;
      await tx`
        insert into conversation_members (conversation_id, user_id, role)
        values (${row!.id}::uuid, ${viewer.id}::uuid, 'admin')
      `;
      for (const uid of others) {
        await tx`
          insert into conversation_members (conversation_id, user_id, role)
          values (${row!.id}::uuid, ${uid}::uuid, 'member')
        `;
      }
      return row!.id;
    });
    await teamChatRealtime.publish([viewer.id, ...others], { type: 'conversation.updated', conversationId: id });
    return detail(viewer, id);
  },

  /** Rename (group admins) and/or mute (any member, for themselves). */
  async updateConversation(
    viewer: Viewer,
    conversationId: string,
    patch: { title?: string | undefined; muted?: boolean | undefined },
  ): Promise<ConversationDetail> {
    const { conv, role } = await requireAccess(conversationId, viewer);
    const sql = requireSql();
    if (patch.title !== undefined) {
      if (conv.kind !== 'group' || role !== 'admin') throw new ForbiddenError('Only group admins can rename a group');
      await sql`update conversations set title = ${patch.title} where id = ${conv.id}::uuid`;
      await teamChatRealtime.publish(await memberIds(conv), { type: 'conversation.updated', conversationId: conv.id });
    }
    if (patch.muted !== undefined) {
      await sql`
        insert into conversation_members (conversation_id, user_id, role, muted)
        values (${conv.id}::uuid, ${viewer.id}::uuid, 'member', ${patch.muted})
        on conflict (conversation_id, user_id) do update set muted = excluded.muted
      `;
    }
    return detail(viewer, conv.id);
  },

  async addGroupMembers(viewer: Viewer, conversationId: string, userIds: string[]): Promise<ConversationDetail> {
    const { conv, role } = await requireAccess(conversationId, viewer);
    if (conv.kind !== 'group' || role !== 'admin') throw new ForbiddenError('Only group admins can add members');
    const current = await memberIds(conv);
    const toAdd = Array.from(new Set(userIds)).filter((id) => !current.includes(id));
    if (current.length + toAdd.length > MAX_GROUP_MEMBERS) throw new BadRequestError(`Groups are limited to ${MAX_GROUP_MEMBERS} members`);
    await requireTeammates(toAdd, conv.firm_id);
    const sql = requireSql();
    for (const uid of toAdd) {
      // A re-added member starts fresh: history before re-joining reads as read.
      await sql`
        insert into conversation_members (conversation_id, user_id, role, last_read_at)
        values (${conv.id}::uuid, ${uid}::uuid, 'member', now())
        on conflict (conversation_id, user_id)
        do update set left_at = null, joined_at = now(), role = 'member', last_read_at = now()
      `;
    }
    await teamChatRealtime.publish([...current, ...toAdd], { type: 'conversation.updated', conversationId: conv.id });
    return detail(viewer, conv.id);
  },

  /** Admin removes someone, or a member leaves (userId === viewer). */
  async removeGroupMember(viewer: Viewer, conversationId: string, userId: string): Promise<void> {
    const { conv, role } = await requireAccess(conversationId, viewer);
    if (conv.kind !== 'group') throw new BadRequestError('Only group members can be removed');
    if (userId !== viewer.id && role !== 'admin') throw new ForbiddenError('Only group admins can remove members');
    const sql = requireSql();
    const before = await memberIds(conv);
    await sql.begin(async (tx) => {
      await tx`
        update conversation_members set left_at = now(), role = 'member'
        where conversation_id = ${conv.id}::uuid and user_id = ${userId}::uuid and left_at is null
      `;
      // Never leave a group without an admin: promote the longest-standing member.
      const [admin] = await tx<Array<{ user_id: string }>>`
        select user_id from conversation_members
        where conversation_id = ${conv.id}::uuid and left_at is null and role = 'admin' limit 1
      `;
      if (!admin) {
        await tx`
          update conversation_members set role = 'admin'
          where (conversation_id, user_id) = (
            select conversation_id, user_id from conversation_members
            where conversation_id = ${conv.id}::uuid and left_at is null
            order by joined_at asc limit 1
          )
        `;
      }
    });
    await teamChatRealtime.publish(before, { type: 'conversation.updated', conversationId: conv.id });
  },

  async listMessages(viewer: Viewer, conversationId: string, before?: string): Promise<MessagePage> {
    await requireAccess(conversationId, viewer);
    const sql = requireSql();
    const cursor = before
      ? sql`and m.created_at < (select created_at from messages where id = ${before}::uuid)`
      : sql``;
    const rows = await sql<MessageRow[]>`
      ${sql.unsafe(MESSAGE_SELECT)}
      where m.conversation_id = ${conversationId}::uuid ${cursor}
        and not exists (select 1 from message_hidden h where h.message_id = m.id and h.user_id = ${viewer.id}::uuid)
      order by m.created_at desc
      limit ${PAGE_SIZE + 1}
    `;
    const hasMore = rows.length > PAGE_SIZE;
    const page = rows.slice(0, PAGE_SIZE).reverse().map(rowToMessage);
    return { items: page, nextCursor: hasMore ? page[0]?.id ?? null : null };
  },

  async sendMessage(viewer: Viewer, conversationId: string, input: SendMessageRequest): Promise<TeamMessage> {
    const { conv } = await requireAccess(conversationId, viewer);
    const sql = requireSql();
    const body = input.body.trim();
    if (!body) throw new BadRequestError('Message is empty');

    const recipients = await memberIds(conv);
    const mentions = Array.from(new Set(input.mentions ?? [])).filter((id) => recipients.includes(id) && id !== viewer.id);
    // Co-counsel guests can talk on the matter but not reference the host
    // firm's document vault by id.
    if ((input.attachments?.length ?? 0) > 0 && viewer.firmId !== conv.firm_id) {
      throw new ForbiddenError('Only members of the matter\'s firm can attach documents');
    }
    const attachments = await validateAttachments(input.attachments, conv.firm_id);
    if (input.replyToId) {
      const [r] = await sql<Array<{ id: string }>>`
        select id from messages where id = ${input.replyToId}::uuid and conversation_id = ${conv.id}::uuid limit 1
      `;
      if (!r) throw new BadRequestError('The message you replied to is not in this conversation');
    }

    const messageId = await sql.begin(async (tx) => {
      const [row] = await tx<Array<{ id: string; created_at: Date }>>`
        insert into messages (firm_id, conversation_id, author_id, body, reply_to_id, attachments)
        values (
          ${conv.firm_id}::uuid, ${conv.id}::uuid, ${viewer.id}::uuid, ${body},
          ${input.replyToId ?? null}, ${JSON.stringify(attachments)}::jsonb
        )
        returning id, created_at
      `;
      for (const uid of mentions) {
        await tx`insert into message_mentions (message_id, user_id) values (${row!.id}::uuid, ${uid}::uuid)`;
      }
      await tx`update conversations set last_message_at = ${row!.created_at} where id = ${conv.id}::uuid`;
      // Sending implies the sender has read everything up to here.
      await tx`
        insert into conversation_members (conversation_id, user_id, role, last_read_at)
        values (${conv.id}::uuid, ${viewer.id}::uuid, 'member', ${row!.created_at})
        on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at
      `;
      return row!.id;
    });

    const message = await loadMessageDto(messageId);
    if (!message) throw new NotFoundError('Message not found');
    await teamChatRealtime.publish(recipients, { type: 'message.created', conversationId: conv.id, messageId });

    // Notifications are best-effort and must not delay or fail the send.
    void (async () => {
      const [summary] = await summaries(viewer, conv.id);
      const conversationTitle = summary ? rowToSummary(summary).title : 'a conversation';
      await notifyRecipients({
        conv, conversationTitle, messageId,
        authorId: viewer.id, authorName: message.authorName,
        body, mentions, recipients,
      });
    })().catch((err) => logger.warn({ err, messageId }, 'team-chat notify failed'));

    return message;
  },

  async editMessage(viewer: Viewer, messageId: string, body: string, mentions: string[] | undefined): Promise<TeamMessage> {
    const sql = requireSql();
    const [msg] = await sql<Array<{ conversation_id: string; author_id: string | null; body: string; created_at: Date; deleted_for_everyone_at: Date | null }>>`
      select conversation_id, author_id, body, created_at, deleted_for_everyone_at
      from messages where id = ${messageId}::uuid limit 1
    `;
    if (!msg) throw new NotFoundError('Message not found');
    const { conv } = await requireAccess(msg.conversation_id, viewer);
    if (msg.author_id !== viewer.id) throw new ForbiddenError('You can only edit your own messages');
    if (msg.deleted_for_everyone_at) throw new BadRequestError('This message was deleted');
    if (Date.now() - msg.created_at.getTime() > EDIT_WINDOW_MS) {
      throw new ForbiddenError('Messages can only be edited within 15 minutes of sending');
    }
    const next = body.trim();
    if (!next) throw new BadRequestError('Message is empty');
    if (next === msg.body) return (await loadMessageDto(messageId))!;

    const recipients = await memberIds(conv);
    const cleanMentions = Array.from(new Set(mentions ?? [])).filter((id) => recipients.includes(id) && id !== viewer.id);
    await sql.begin(async (tx) => {
      await tx`insert into message_edits (message_id, previous_body) values (${messageId}::uuid, ${msg.body})`;
      await tx`update messages set body = ${next}, edited_at = now() where id = ${messageId}::uuid`;
      if (mentions !== undefined) {
        await tx`delete from message_mentions where message_id = ${messageId}::uuid`;
        for (const uid of cleanMentions) {
          await tx`insert into message_mentions (message_id, user_id) values (${messageId}::uuid, ${uid}::uuid)`;
        }
      }
    });
    await audit(viewer, 'team_chat.message.edit', messageId, { conversationId: conv.id });
    await teamChatRealtime.publish(recipients, { type: 'message.updated', conversationId: conv.id, messageId });
    return (await loadMessageDto(messageId))!;
  },

  async deleteMessage(viewer: Viewer, messageId: string, scope: 'me' | 'everyone'): Promise<TeamMessage | null> {
    const sql = requireSql();
    const [msg] = await sql<Array<{ conversation_id: string; author_id: string | null; created_at: Date; deleted_for_everyone_at: Date | null }>>`
      select conversation_id, author_id, created_at, deleted_for_everyone_at
      from messages where id = ${messageId}::uuid limit 1
    `;
    if (!msg) throw new NotFoundError('Message not found');
    const { conv } = await requireAccess(msg.conversation_id, viewer);

    if (scope === 'me') {
      await sql`
        insert into message_hidden (message_id, user_id) values (${messageId}::uuid, ${viewer.id}::uuid)
        on conflict do nothing
      `;
      // Other tabs of the same user drop it too.
      await teamChatRealtime.publish([viewer.id], { type: 'message.hidden', conversationId: conv.id, messageId });
      return null;
    }

    if (msg.author_id !== viewer.id) throw new ForbiddenError('You can only delete your own messages for everyone');
    if (msg.deleted_for_everyone_at) return (await loadMessageDto(messageId))!;
    if (Date.now() - msg.created_at.getTime() > DELETE_FOR_EVERYONE_WINDOW_MS) {
      throw new ForbiddenError('Messages can only be deleted for everyone within 48 hours of sending');
    }
    await sql`update messages set deleted_for_everyone_at = now() where id = ${messageId}::uuid`;
    await audit(viewer, 'team_chat.message.delete_for_everyone', messageId, { conversationId: conv.id });
    await teamChatRealtime.publish(await memberIds(conv), { type: 'message.updated', conversationId: conv.id, messageId });
    return (await loadMessageDto(messageId))!;
  },

  async markRead(viewer: Viewer, conversationId: string): Promise<void> {
    const { conv } = await requireAccess(conversationId, viewer);
    const sql = requireSql();
    const [row] = await sql<Array<{ last_read_at: Date }>>`
      insert into conversation_members (conversation_id, user_id, role, last_read_at)
      values (${conv.id}::uuid, ${viewer.id}::uuid, 'member', now())
      on conflict (conversation_id, user_id) do update set last_read_at = now()
      returning last_read_at
    `;
    // Clear the matching bell rows so the two badges agree.
    await sql`
      update notifications set read_at = now()
      where user_id = ${viewer.id}::uuid and read_at is null
        and dedupe_key in (${`team-chat-dm:${conv.id}`}, ${`team-chat-mention:${conv.id}`})
    `;
    await teamChatRealtime.publish(await memberIds(conv), {
      type: 'conversation.read',
      conversationId: conv.id,
      userId: viewer.id,
      lastReadAt: row!.last_read_at.toISOString(),
    });
  },

  // ---- Matter discussions -------------------------------------------------

  async getMatterDiscussion(viewer: Viewer, caseId: string): Promise<MatterDiscussionAccess> {
    const sql = requireSql();
    const [matter] = await sql<Array<{ firm_id: string }>>`select firm_id from cases where id = ${caseId}::uuid limit 1`;
    if (!matter) throw new NotFoundError('Matter not found');
    const assignees = await sql<Array<{ user_id: string; name: string; role_on_case: 'lead' | 'collaborator' | 'observer' }>>`
      select ca.user_id, u.name, ca.role_on_case
      from case_assignments ca join users u on u.id = ca.user_id
      where ca.case_id = ${caseId}::uuid
      order by case ca.role_on_case when 'lead' then 0 else 1 end, u.name
    `;
    const isMember = assignees.some((a) => a.user_id === viewer.id);
    const sameFirm = viewer.firmId === matter.firm_id;
    if (!sameFirm && !isMember) throw new NotFoundError('Matter not found');

    const isLead = assignees.some((a) => a.user_id === viewer.id && a.role_on_case === 'lead');
    const canManageMembers = sameFirm && (isLead || isHeadRole(viewer));

    let conversation: ConversationDetail | null = null;
    if (isMember) {
      await sql`
        insert into conversations (firm_id, kind, case_id, created_by)
        values (${matter.firm_id}::uuid, 'matter', ${caseId}::uuid, ${viewer.id}::uuid)
        on conflict (case_id) where kind = 'matter' do nothing
      `;
      const [c] = await sql<Array<{ id: string }>>`
        select id from conversations where case_id = ${caseId}::uuid and kind = 'matter' limit 1
      `;
      conversation = await detail(viewer, c!.id);
    }

    return {
      conversation,
      isMember,
      canManageMembers,
      assignees: assignees.map((a) => ({ userId: a.user_id, name: a.name, roleOnCase: a.role_on_case })),
    };
  },

  /** Assign a firm member to the matter as a collaborator (joins its discussion). */
  async addMatterMember(viewer: Viewer, caseId: string, userId: string): Promise<MatterDiscussionAccess> {
    const access = await this.getMatterDiscussion(viewer, caseId);
    if (!access.canManageMembers) throw new ForbiddenError('Only the matter lead or a firm head can add people');
    await assignmentsService.requireTeammate(userId, viewer.firmId!);
    const sql = requireSql();
    await sql`
      insert into case_assignments (case_id, user_id, role_on_case)
      values (${caseId}::uuid, ${userId}::uuid, 'collaborator')
      on conflict (case_id, user_id) do nothing
    `;
    await this.publishMatterUpdate(caseId);
    return this.getMatterDiscussion(viewer, caseId);
  },

  /** Unassign a collaborator/observer from the same firm. The lead changes
   *  via handover, and co-counsel guests via the co-counsel flow. */
  async removeMatterMember(viewer: Viewer, caseId: string, userId: string): Promise<MatterDiscussionAccess> {
    const access = await this.getMatterDiscussion(viewer, caseId);
    const self = userId === viewer.id;
    if (!access.canManageMembers && !self) throw new ForbiddenError('Only the matter lead or a firm head can remove people');
    const sql = requireSql();
    const before = access.assignees.map((a) => a.userId);
    const removed = await sql`
      delete from case_assignments ca
      using users u, cases c
      where ca.case_id = ${caseId}::uuid and ca.user_id = ${userId}::uuid
        and ca.role_on_case <> 'lead'
        and u.id = ca.user_id and c.id = ca.case_id and u.firm_id = c.firm_id
    `;
    if (removed.count === 0) throw new BadRequestError("That person can't be removed here (the lead changes via handover)");
    await this.publishMatterUpdate(caseId, before);
    return this.getMatterDiscussion(viewer, caseId);
  },

  async publishMatterUpdate(caseId: string, extraRecipients: string[] = []): Promise<void> {
    const sql = requireSql();
    const [c] = await sql<Array<{ id: string }>>`
      select id from conversations where case_id = ${caseId}::uuid and kind = 'matter' limit 1
    `;
    if (!c) return;
    const now = await sql<Array<{ user_id: string }>>`select user_id from case_assignments where case_id = ${caseId}::uuid`;
    await teamChatRealtime.publish([...extraRecipients, ...now.map((r) => r.user_id)], {
      type: 'conversation.updated',
      conversationId: c.id,
    });
  },
};
