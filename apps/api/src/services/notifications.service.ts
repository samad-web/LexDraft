/**
 * Transactional email notifications for the LexDraft client portal.
 *
 * Wraps `jobs.enqueue('email.send', …)` with the templates and routing
 * rules from CLIENT_PORTAL.md §6.4. Each event has a single dispatch
 * function that:
 *
 *   1. Resolves the recipient (client email or firm advocate emails).
 *   2. For client-bound events, honours `clients.portal_preferences.notifications.*`
 *      so a client who has opted out of, say, hearing reminders won't
 *      receive them. System messages (sign-in alerts, magic-link resends)
 *      ignore preferences - see §6.4.
 *   3. Enqueues the job. Failures are logged, never thrown - notifications
 *      are observability-grade, not a correctness gate on the originating
 *      mutation.
 *
 * No SMTP provider is wired yet - the underlying handler in `jobs.service`
 * just logs. When credentials land, swap that handler and every event here
 * begins delivering with no further changes.
 */

import { db } from '../db/client';
import { jobs } from './jobs.service';
import { logger } from '../logger';
import type { AppNotification, NotificationTone, PortalNotificationPreferences } from '@lexdraft/types';

interface ClientLookup {
  id: string;
  firmId: string;
  name: string;
  email: string;
  preferences: Partial<PortalNotificationPreferences>;
  firmName: string;
}

const DEFAULT_PREFS: PortalNotificationPreferences = {
  newDocument: true,
  hearingReminder: true,
  newMessage: true,
  invoiceIssued: true,
  invoiceOverdue: true,
};

async function loadClient(clientId: string): Promise<ClientLookup | null> {
  const sql = db();
  if (!sql) return null;
  const rows = await sql<Array<{
    id: string; firm_id: string; name: string; email: string | null;
    portal_preferences: unknown; firm_name: string | null;
  }>>`
    select c.id, c.firm_id, c.name, c.email, c.portal_preferences,
           f.name as firm_name
    from clients c
    left join firms f on f.id = c.firm_id
    where c.id = ${clientId}::uuid
    limit 1
  `;
  const row = rows[0];
  if (!row || !row.email) return null;
  const raw = row.portal_preferences;
  const obj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const notif = (obj['notifications'] && typeof obj['notifications'] === 'object')
    ? obj['notifications'] as Partial<PortalNotificationPreferences>
    : {};
  return {
    id: row.id,
    firmId: row.firm_id,
    name: row.name,
    email: row.email,
    preferences: notif,
    firmName: row.firm_name ?? 'your firm',
  };
}

interface UserLookup { id: string; name: string; email: string; firmId: string }

async function loadUser(userId: string): Promise<UserLookup | null> {
  const sql = db();
  if (!sql) return null;
  const rows = await sql<Array<{ id: string; name: string; email: string | null; firm_id: string }>>`
    select id, name, email, firm_id
    from users
    where id = ${userId}::uuid and (status is null or status = 'active')
    limit 1
  `;
  const row = rows[0];
  if (!row || !row.email) return null;
  return { id: row.id, name: row.name, email: row.email, firmId: row.firm_id };
}

async function loadFirmRecipients(firmId: string): Promise<string[]> {
  const sql = db();
  if (!sql) return [];
  // Send to every active firm admin (`role = 'Firm Admin'`) - when there's no
  // explicit primary advocate on the matter, this is the safest fallback so
  // someone sees the message. Future enhancement: route via matter.assigned_advocate.
  const rows = await sql<Array<{ email: string }>>`
    select email from users
    where firm_id = ${firmId}::uuid
      and (status is null or status = 'active')
    order by case when role = 'Firm Admin' then 0 else 1 end, email
    limit 5
  `;
  return rows.map((r) => r.email).filter((e) => !!e);
}

/** Like loadFirmRecipients but returns user ids alongside emails — needed when
 *  the caller also persists an in-app notification (which is keyed by user id).
 *  Firm admins first, capped at 5. */
async function loadFirmRecipientUsers(firmId: string): Promise<Array<{ id: string; email: string }>> {
  const sql = db();
  if (!sql) return [];
  const rows = await sql<Array<{ id: string; email: string | null }>>`
    select id, email from users
    where firm_id = ${firmId}::uuid
      and (status is null or status = 'active')
    order by case when role = 'Firm Admin' then 0 else 1 end, email
    limit 5
  `;
  return rows
    .filter((r): r is { id: string; email: string } => !!r.email)
    .map((r) => ({ id: r.id, email: r.email }));
}

function prefAllows(prefs: Partial<PortalNotificationPreferences>, key: keyof PortalNotificationPreferences): boolean {
  return prefs[key] ?? DEFAULT_PREFS[key];
}

interface SendArgs {
  to: string;
  subject: string;
  body: string;
}

async function send(args: SendArgs): Promise<void> {
  try {
    await jobs.enqueue('email.send', args);
  } catch (err) {
    // Never bubble - the calling mutation has already succeeded.
    logger.warn({ err, to: args.to, subject: args.subject }, 'notifications: enqueue failed');
  }
}

// ---------------------------------------------------------------------------
// In-app notification feed (migration 0061). Server-persisted rows the web
// bell/panel reads via GET /notifications. Kept independent of the email path
// above — an event may raise an in-app row, an email, or both. Like the email
// helpers, create() never throws into the caller: a notification is
// observability-grade, not a correctness gate on the originating mutation.
// ---------------------------------------------------------------------------

interface CreateNotificationInput {
  firmId: string;
  userId: string;
  title: string;
  body?: string;
  tone?: NotificationTone;
  icon?: string;
  view?: string;
  /** When set, upserts on (user_id, dedupe_key) so a repeated event (e.g. the
   *  nightly sync touching the same case) refreshes the existing row instead of
   *  stacking duplicates. The refreshed row is bumped back to unread. */
  dedupeKey?: string;
}

interface NotificationRow {
  id: string;
  tone: NotificationTone;
  icon: string;
  title: string;
  body: string;
  view: string;
  read_at: string | Date | null;
  created_at: string | Date;
}

function rowToDto(r: NotificationRow): AppNotification {
  const iso = (v: string | Date): string => (v instanceof Date ? v.toISOString() : v);
  return {
    id: r.id,
    tone: r.tone,
    icon: r.icon,
    title: r.title,
    body: r.body,
    view: r.view,
    unread: r.read_at == null,
    createdAt: iso(r.created_at),
  };
}

export const notificationsStore = {
  /** Insert (or upsert on dedupeKey) an in-app notification. Returns the id, or
   *  null when there's no DB or the write failed. */
  async create(input: CreateNotificationInput): Promise<string | null> {
    const sql = db();
    if (!sql) return null;
    try {
      const rows = await sql<Array<{ id: string }>>`
        insert into notifications (firm_id, user_id, tone, icon, title, body, view, dedupe_key)
        values (
          ${input.firmId}::uuid, ${input.userId}::uuid,
          ${input.tone ?? 'cobalt'}, ${input.icon ?? 'bell'},
          ${input.title}, ${input.body ?? ''}, ${input.view ?? 'dashboard'},
          ${input.dedupeKey ?? null}
        )
        on conflict (user_id, dedupe_key) where dedupe_key is not null
        do update set
          title = excluded.title,
          body = excluded.body,
          tone = excluded.tone,
          icon = excluded.icon,
          view = excluded.view,
          read_at = null,
          created_at = now()
        returning id
      `;
      return rows[0]?.id ?? null;
    } catch (err) {
      logger.warn({ err, userId: input.userId }, 'notificationsStore.create failed');
      return null;
    }
  },

  /** Newest-first feed for one user. Caps at `limit` (default 50). */
  async listForUser(userId: string, limit = 50): Promise<AppNotification[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Array<NotificationRow>>`
      select id, tone, icon, title, body, view, read_at, created_at
      from notifications
      where user_id = ${userId}::uuid
      order by created_at desc
      limit ${Math.min(Math.max(limit, 1), 200)}
    `;
    return rows.map(rowToDto);
  },

  async unreadCount(userId: string): Promise<number> {
    const sql = db();
    if (!sql) return 0;
    const rows = await sql<Array<{ n: number }>>`
      select count(*)::int as n from notifications
      where user_id = ${userId}::uuid and read_at is null
    `;
    return rows[0]?.n ?? 0;
  },

  /** Mark one notification read. Scoped to the owner so a user can't touch
   *  another user's rows. Returns true when a row was updated. */
  async markRead(userId: string, id: string): Promise<boolean> {
    const sql = db();
    if (!sql) return false;
    const rows = await sql<Array<{ id: string }>>`
      update notifications set read_at = coalesce(read_at, now())
      where id = ${id}::uuid and user_id = ${userId}::uuid
      returning id
    `;
    return rows.length > 0;
  },

  /** Mark every unread notification for the user read. Returns the count. */
  async markAllRead(userId: string): Promise<number> {
    const sql = db();
    if (!sql) return 0;
    const rows = await sql<Array<{ id: string }>>`
      update notifications set read_at = now()
      where user_id = ${userId}::uuid and read_at is null
      returning id
    `;
    return rows.length;
  },
};

// ---------------------------------------------------------------------------
// Events. Each event ignores wiring failures (no rethrow) and is keyed off
// the spec's §6.4 recipient table. Add new events here so the call sites
// remain one-liners.
// ---------------------------------------------------------------------------

export const notify = {
  /** Document shared with client. Honours `notifications.newDocument`. */
  async documentShared(clientId: string, documentName: string): Promise<void> {
    const c = await loadClient(clientId);
    if (!c) return;
    if (!prefAllows(c.preferences, 'newDocument')) return;
    await send({
      to: c.email,
      subject: `A new document is ready in your portal`,
      body: [
        `Hi ${c.name},`,
        ``,
        `${c.firmName} has shared a new document with you:`,
        `  ${documentName}`,
        ``,
        `Sign in to your portal to view it.`,
      ].join('\n'),
    });
  },

  /** Document needs acknowledgement. Honours `notifications.newDocument`. */
  async documentRequiresAck(clientId: string, documentName: string): Promise<void> {
    const c = await loadClient(clientId);
    if (!c) return;
    if (!prefAllows(c.preferences, 'newDocument')) return;
    await send({
      to: c.email,
      subject: `Action needed: please review a document`,
      body: [
        `Hi ${c.name},`,
        ``,
        `${c.firmName} has asked you to review and acknowledge:`,
        `  ${documentName}`,
        ``,
        `Sign in to your portal to view and acknowledge it.`,
      ].join('\n'),
    });
  },

  /** Hearing scheduled or rescheduled. Honours `notifications.hearingReminder`. */
  async hearingScheduled(clientId: string, summary: { matterTitle: string; date?: string; time: string; court: string }): Promise<void> {
    const c = await loadClient(clientId);
    if (!c) return;
    if (!prefAllows(c.preferences, 'hearingReminder')) return;
    await send({
      to: c.email,
      subject: `Your hearing has been scheduled`,
      body: [
        `Hi ${c.name},`,
        ``,
        `${c.firmName} has scheduled a hearing on your matter:`,
        `  Matter: ${summary.matterTitle}`,
        `  Date:   ${summary.date ?? 'TBD'} ${summary.time}`,
        `  Court:  ${summary.court}`,
        ``,
        `Sign in to your portal for details.`,
      ].join('\n'),
    });
  },

  /** Invoice issued (status moved out of draft). Honours `notifications.invoiceIssued`. */
  async invoiceIssued(clientId: string, summary: { invoiceNo: string; amountInr: number; dueDate: string }): Promise<void> {
    const c = await loadClient(clientId);
    if (!c) return;
    if (!prefAllows(c.preferences, 'invoiceIssued')) return;
    const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
      .format(summary.amountInr);
    await send({
      to: c.email,
      subject: `Invoice ${summary.invoiceNo} from ${c.firmName}`,
      body: [
        `Hi ${c.name},`,
        ``,
        `${c.firmName} has issued invoice ${summary.invoiceNo}:`,
        `  Amount: ${amount}`,
        `  Due:    ${summary.dueDate}`,
        ``,
        `Sign in to your portal to view it.`,
      ].join('\n'),
    });
  },

  /** New message from advocate → client. Honours `notifications.newMessage`. */
  async messageFromAdvocate(clientId: string, summary: { advocateName: string; matterTitle: string | null; preview: string }): Promise<void> {
    const c = await loadClient(clientId);
    if (!c) return;
    if (!prefAllows(c.preferences, 'newMessage')) return;
    await send({
      to: c.email,
      subject: `New message from ${summary.advocateName}`,
      body: [
        `Hi ${c.name},`,
        ``,
        `${summary.advocateName} sent you a message${summary.matterTitle ? ` on ${summary.matterTitle}` : ''}:`,
        ``,
        `  ${summary.preview}`,
        ``,
        `Sign in to your portal to read and reply.`,
      ].join('\n'),
    });
  },

  /** Notify the firm side that a portal client sent a message. Always
   *  delivered - firm users don't have per-event preferences in v1. */
  async messageFromClient(firmId: string, summary: { clientName: string; matterTitle: string | null; preview: string }): Promise<void> {
    const recipients = await loadFirmRecipients(firmId);
    for (const to of recipients) {
      await send({
        to,
        subject: `${summary.clientName} sent you a message${summary.matterTitle ? ` on ${summary.matterTitle}` : ''}`,
        body: [
          `${summary.clientName} sent a portal message${summary.matterTitle ? ` on ${summary.matterTitle}` : ''}:`,
          ``,
          `  ${summary.preview}`,
          ``,
          `Open the firm-side Portal Messages inbox to reply.`,
        ].join('\n'),
      });
    }
  },

  /** Notify the firm that a client acknowledged a document. */
  async documentAcknowledged(firmId: string, summary: { clientName: string; documentName: string }): Promise<void> {
    const recipients = await loadFirmRecipients(firmId);
    for (const to of recipients) {
      await send({
        to,
        subject: `${summary.clientName} acknowledged ${summary.documentName}`,
        body: [
          `${summary.clientName} acknowledged the document:`,
          ``,
          `  ${summary.documentName}`,
          ``,
          `The acknowledgement is recorded against the document in the firm-side register.`,
        ].join('\n'),
      });
    }
  },

  /**
   * A nightly eCourts sync detected a change on a matter — notify the firm
   * side (case owner if resolvable, else firm admins). Fire-and-forget like
   * every other event: a wiring failure logs and never bubbles into the
   * sync batch. No per-user preference gate — this is firm-internal, not a
   * client-portal opt-out surface.
   */
  async caseUpdatedFromEcourts(
    firmId: string,
    summary: {
      matterTitle: string;
      cnr: string;
      /** Human-readable lines describing what moved, e.g.
       *  "Next hearing: 2026-08-20 → 2026-09-14". */
      changes: string[];
      ownerUserId?: string | null;
      /** Case id — used to build a per-day dedupe key so re-runs upsert. */
      caseId?: string;
      /** yyyy-mm-dd of the run, folded into the dedupe key. Caller passes the
       *  batch date so the key is deterministic across the run. */
      runDate?: string;
    },
  ): Promise<void> {
    // Resolve recipient user rows: prefer the matter owner, else firm admins.
    // We need user *ids* (for the in-app row) as well as emails.
    let recipients: Array<{ id: string; email: string }> = [];
    if (summary.ownerUserId) {
      const u = await loadUser(summary.ownerUserId);
      if (u) recipients = [{ id: u.id, email: u.email }];
    }
    if (recipients.length === 0) recipients = await loadFirmRecipientUsers(firmId);

    const body = summary.changes.join(' · ');
    for (const r of recipients) {
      // In-app row (deduped per case per run-day so a nightly re-run refreshes
      // rather than stacks).
      await notificationsStore.create({
        firmId,
        userId: r.id,
        tone: 'cobalt',
        icon: 'ecourts',
        title: `Case update: ${summary.matterTitle}`,
        body,
        view: 'cases',
        dedupeKey: summary.caseId ? `ecourts-sync:${summary.caseId}:${summary.runDate ?? ''}` : undefined,
      });
      // Email (best-effort; no-op until SMTP is configured).
      await send({
        to: r.email,
        subject: `Case update from eCourts: ${summary.matterTitle}`,
        body: [
          `The nightly eCourts sync found new activity on:`,
          `  Matter: ${summary.matterTitle}`,
          `  CNR:    ${summary.cnr}`,
          ``,
          `What changed:`,
          ...summary.changes.map((c) => `  • ${c}`),
          ``,
          `Open the matter in LexDraft for the full updated record.`,
        ].join('\n'),
      });
    }
  },

  /**
   * A case's next hearing is coming up within the reminder window. In-app
   * only (the user chose not to add email/SMS/WhatsApp here - those need a
   * paid provider and separate setup). Deduped per (case, hearing date) so
   * the daily scan that calls this doesn't stack a fresh row every day
   * between now and the hearing - it refreshes the same row back to unread
   * instead, which is the effect an advocate actually wants from a
   * reminder re-surfacing.
   */
  async hearingReminder(
    firmId: string,
    reminder: {
      matterTitle: string;
      caseId: string;
      hearingDate: string; // yyyy-mm-dd
      daysUntil: number;
      ownerUserId?: string | null;
    },
  ): Promise<void> {
    let recipients: Array<{ id: string; email: string }> = [];
    if (reminder.ownerUserId) {
      const u = await loadUser(reminder.ownerUserId);
      if (u) recipients = [{ id: u.id, email: u.email }];
    }
    if (recipients.length === 0) recipients = await loadFirmRecipientUsers(firmId);

    const when = reminder.daysUntil <= 0 ? 'today' : reminder.daysUntil === 1 ? 'tomorrow' : `in ${reminder.daysUntil} days`;
    for (const r of recipients) {
      await notificationsStore.create({
        firmId,
        userId: r.id,
        tone: 'amber',
        icon: 'calendar',
        title: `Hearing ${when}: ${reminder.matterTitle}`,
        body: `Next hearing on ${reminder.hearingDate}.`,
        view: 'cases',
        dedupeKey: `hearing-reminder:${reminder.caseId}:${reminder.hearingDate}`,
      });
    }
  },

  /**
   * A payment-provider webhook changed the firm's billing status. In-app
   * only, same contract as hearingReminder — fire-and-forget, never throws.
   * Dedupe key omitted on purpose: unlike a hearing date, a second
   * `past_due` event a day later is new information worth a fresh row.
   */
  async planStatusChanged(
    firmId: string,
    change: { planStatus: 'trial' | 'active' | 'past_due' | 'cancelled'; renewsAt?: string | null },
  ): Promise<void> {
    const recipients = await loadFirmRecipientUsers(firmId);
    const tone: NotificationTone = change.planStatus === 'active' ? 'sage'
      : change.planStatus === 'past_due' ? 'amber' : 'vermillion';
    const title = change.planStatus === 'active' ? 'Payment received'
      : change.planStatus === 'past_due' ? 'Payment past due'
      : change.planStatus === 'cancelled' ? 'Subscription cancelled'
      : 'Trial started';
    const body = change.renewsAt ? `Plan renews ${change.renewsAt}.` : '';
    for (const r of recipients) {
      await notificationsStore.create({
        firmId, userId: r.id, tone, icon: 'credit-card', title, body, view: 'billing',
      });
    }
  },

  // ----- Contract review workflow -----------------------------------------
  // No per-user preferences yet for these - firm-side internal workflow,
  // not subject to client-portal opt-outs. Same fire-and-forget contract:
  // failures log a warn and never bubble back to the originating mutation.

  /** A reviewer was assigned (or re-assigned). The assignee gets the ping. */
  async reviewAssigned(
    assigneeId: string,
    summary: { reviewTitle: string; assignerName: string },
  ): Promise<void> {
    const u = await loadUser(assigneeId);
    if (!u) return;
    await send({
      to: u.email,
      subject: `You've been assigned a contract review: ${summary.reviewTitle}`,
      body: [
        `Hi ${u.name},`,
        ``,
        `${summary.assignerName} assigned you to review the contract:`,
        `  ${summary.reviewTitle}`,
        ``,
        `Open the Review tab in LexDraft to read the AI findings, leave comments, and approve or request changes.`,
      ].join('\n'),
    });
  },

  /** Decision recorded - notify whoever requested the review. */
  async reviewDecided(
    requesterId: string,
    summary: {
      reviewTitle: string;
      decision: 'approved' | 'changes_requested';
      reviewerName: string;
    },
  ): Promise<void> {
    const u = await loadUser(requesterId);
    if (!u) return;
    const verb = summary.decision === 'approved' ? 'approved' : 'requested changes on';
    await send({
      to: u.email,
      subject: `${summary.reviewerName} ${verb} your review: ${summary.reviewTitle}`,
      body: [
        `Hi ${u.name},`,
        ``,
        `${summary.reviewerName} ${verb} the contract review:`,
        `  ${summary.reviewTitle}`,
        ``,
        summary.decision === 'approved'
          ? 'The review is now marked approved.'
          : 'Open the review to see the comments and decide your next steps.',
      ].join('\n'),
    });
  },

  /** A comment was posted on a review. Notify the assignee, the requester,
   *  and (if this is a reply) the parent comment's author. Author skips
   *  themselves so they don't get an email for their own post. */
  async reviewCommentPosted(
    recipientIds: ReadonlyArray<string>,
    summary: {
      reviewTitle: string;
      commenterName: string;
      preview: string;
      isReply: boolean;
    },
  ): Promise<void> {
    // De-dupe and resolve once; one user can't appear twice as a recipient.
    const unique = Array.from(new Set(recipientIds.filter(Boolean)));
    for (const id of unique) {
      const u = await loadUser(id);
      if (!u) continue;
      await send({
        to: u.email,
        subject: summary.isReply
          ? `${summary.commenterName} replied on ${summary.reviewTitle}`
          : `${summary.commenterName} commented on ${summary.reviewTitle}`,
        body: [
          `Hi ${u.name},`,
          ``,
          `${summary.commenterName} ${summary.isReply ? 'replied to a comment' : 'added a comment'} on the review:`,
          `  ${summary.reviewTitle}`,
          ``,
          `  "${summary.preview}"`,
          ``,
          `Open the review in LexDraft to read the full thread and respond.`,
        ].join('\n'),
      });
    }
  },
};
