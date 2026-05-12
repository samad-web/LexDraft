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
 *      ignore preferences — see §6.4.
 *   3. Enqueues the job. Failures are logged, never thrown — notifications
 *      are observability-grade, not a correctness gate on the originating
 *      mutation.
 *
 * No SMTP provider is wired yet — the underlying handler in `jobs.service`
 * just logs. When credentials land, swap that handler and every event here
 * begins delivering with no further changes.
 */

import { db } from '../db/client';
import { jobs } from './jobs.service';
import { logger } from '../logger';
import type { PortalNotificationPreferences } from '@lexdraft/types';

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

async function loadFirmRecipients(firmId: string): Promise<string[]> {
  const sql = db();
  if (!sql) return [];
  // Send to every active firm admin (`role = 'Firm Admin'`) — when there's no
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
    // Never bubble — the calling mutation has already succeeded.
    logger.warn({ err, to: args.to, subject: args.subject }, 'notifications: enqueue failed');
  }
}

// ---------------------------------------------------------------------------
// Events. Each event ignores wiring failures (no rethrow) and is keyed off
// the spec's §6.4 recipient table. Add new events here so the call sites
// remain one-liners.
// ---------------------------------------------------------------------------

export const notify = {
  /** Portal access enabled — fired by the firm-side "Enable portal" toggle.
   *  System message: ignores preferences. */
  async portalEnabled(clientId: string, magicLink: string): Promise<void> {
    const c = await loadClient(clientId);
    if (!c) return;
    await send({
      to: c.email,
      subject: `Your portal is ready — sign in`,
      body: [
        `Hi ${c.name},`,
        ``,
        `${c.firmName} has enabled the client portal for you.`,
        `Use this link to sign in (it expires in 15 minutes):`,
        ``,
        magicLink,
        ``,
        `If you didn't expect this, you can ignore the email.`,
      ].join('\n'),
    });
  },

  /** Magic-link re-sent — system message, ignores preferences. */
  async magicLinkResent(clientId: string, magicLink: string): Promise<void> {
    const c = await loadClient(clientId);
    if (!c) return;
    await send({
      to: c.email,
      subject: `Your new sign-in link`,
      body: [
        `Hi ${c.name},`,
        ``,
        `Your new sign-in link is below. It expires in 15 minutes:`,
        ``,
        magicLink,
      ].join('\n'),
    });
  },

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
   *  delivered — firm users don't have per-event preferences in v1. */
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
};
