// =============================================================================
// Team messaging DTOs (migration 0087). Shared by apps/api and apps/web.
//
// Lives in its own entry point (`@lexdraft/types/messaging`) rather than in
// index.ts so the feature can ship independently of the main types barrel.
// =============================================================================

export type ConversationKind = 'direct' | 'group' | 'matter';

// Type-only module: apps/api runs compiled JS under plain Node, which cannot
// load this .ts file at runtime, so value exports here would break production.
// The edit / delete-for-everyone windows are enforced by the API and surfaced
// per message as `editableUntil` / `deletableUntil`.

export interface ConversationMember {
  userId: string;
  name: string;
  role: 'admin' | 'member';
  /** ISO timestamp; drives the read ticks on the sender's side. */
  lastReadAt: string | null;
}

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  /** Display title: group name, the other person's name (direct), or the
   *  matter title (matter). Resolved server-side for the viewer. */
  title: string;
  caseId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageAuthorName: string | null;
  unreadCount: number;
  /** True when someone @mentioned the viewer in an unread message. */
  mentionedUnread: boolean;
  muted: boolean;
}

export interface ConversationDetail extends ConversationSummary {
  members: ConversationMember[];
  /** Viewer may rename / add / remove members (group admins only). */
  canManage: boolean;
}

export interface MessageAttachment {
  kind: 'document' | 'draft';
  id: string;
  name: string;
}

export interface TeamMessage {
  id: string;
  conversationId: string;
  authorId: string | null;
  authorName: string;
  /** Null when deleted for everyone. */
  body: string | null;
  replyTo: { id: string; authorName: string; body: string | null } | null;
  attachments: MessageAttachment[];
  mentions: string[];
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  /** ISO; the author may edit until then (15 min after sending). */
  editableUntil: string;
  /** ISO; the author may delete for everyone until then (48 h after sending). */
  deletableUntil: string;
}

export interface MessagePage {
  items: TeamMessage[];
  /** Pass as `before` to load older messages; null when at the start. */
  nextCursor: string | null;
}

export interface SendMessageRequest {
  body: string;
  replyToId?: string | null;
  mentions?: string[];
  attachments?: MessageAttachment[];
}

export interface MatterDiscussionAccess {
  /** Null until the first message is sent or the thread is opened. */
  conversation: ConversationDetail | null;
  /** Viewer is assigned to the matter and can read/post. */
  isMember: boolean;
  /** Viewer may add/remove assigned collaborators (matter lead or firm head). */
  canManageMembers: boolean;
  assignees: Array<{ userId: string; name: string; roleOnCase: 'lead' | 'collaborator' | 'observer' }>;
}

/** Frames on GET /team-chat/stream (Server-Sent Events). */
export type TeamChatStreamEvent =
  | { type: 'ready' }
  | { type: 'message.created'; conversationId: string; message: TeamMessage }
  | { type: 'message.updated'; conversationId: string; message: TeamMessage }
  | { type: 'message.hidden'; conversationId: string; messageId: string }
  | { type: 'conversation.read'; conversationId: string; userId: string; lastReadAt: string }
  | { type: 'conversation.updated'; conversationId: string };
