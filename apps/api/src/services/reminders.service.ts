import { db } from '../db/client';
import { BadRequestError, NotFoundError } from '../lib/errors';
import { logger } from '../logger';

// =============================================================================
// Reminders an advocate sets by hand (build-docs/features/reminders.md).
// Sent once by the `reminders.due` job: bell notification, which also goes to
// the user's devices (web push + Android app).
// =============================================================================

export interface Reminder {
  id: string;
  caseId: string | null;
  caseTitle: string | null;
  title: string;
  note: string;
  remindAt: string;
  sentAt: string | null;
}

const MAX_AHEAD_MS = 2 * 366 * 24 * 3600 * 1000;
/** A minute of grace so "now + 1 min" set on a slow phone isn't refused. */
const PAST_GRACE_MS = 60 * 1000;

/** Throws when `remindAt` isn't a usable future instant. */
export function checkRemindAt(remindAt: string, now = Date.now()): Date {
  const at = new Date(remindAt);
  if (Number.isNaN(at.getTime())) throw new BadRequestError('Pick a valid date and time for the reminder.');
  if (at.getTime() < now - PAST_GRACE_MS) throw new BadRequestError('That time has already passed. Pick a later time.');
  if (at.getTime() > now + MAX_AHEAD_MS) throw new BadRequestError('Reminders can be set up to two years ahead.');
  return at;
}

/** The yyyy-mm-dd a diary reminder is due: `offset` days before the hearing. */
export function diaryReminderDay(nextHearingDate: string, offsetDays: number): string {
  const d = new Date(`${nextHearingDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

interface Row {
  id: string; case_id: string | null; case_title: string | null; title: string; note: string;
  remind_at: Date; sent_at: Date | null;
}
const toReminder = (r: Row): Reminder => ({
  id: r.id, caseId: r.case_id, caseTitle: r.case_title, title: r.title, note: r.note,
  remindAt: r.remind_at.toISOString(), sentAt: r.sent_at ? r.sent_at.toISOString() : null,
});

export const remindersService = {
  /** The user's own reminders, upcoming first (sent ones from the last week after). */
  async list(userId: string, caseId?: string): Promise<Reminder[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<Row[]>`
      select r.id, r.case_id, coalesce(nullif(trim(c.title), ''), c.cnr) as case_title, r.title, r.note, r.remind_at, r.sent_at
      from reminders r left join cases c on c.id = r.case_id
      where r.user_id = ${userId}::uuid
        and (${caseId ?? null}::uuid is null or r.case_id = ${caseId ?? null}::uuid)
        and (r.sent_at is null or r.sent_at > now() - interval '7 days')
      order by (r.sent_at is not null), r.remind_at
      limit 100`;
    return rows.map(toReminder);
  },

  async create(
    userId: string,
    firmId: string,
    input: { caseId?: string | null; title: string; note?: string; remindAt: string },
  ): Promise<Reminder> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const at = checkRemindAt(input.remindAt);
    let caseTitle: string | null = null;
    if (input.caseId) {
      const c = await sql<Array<{ title: string }>>`
        select coalesce(nullif(trim(title), ''), cnr) as title from cases
        where id = ${input.caseId}::uuid and firm_id = ${firmId}::uuid and deleted_at is null`;
      if (!c[0]) throw new NotFoundError('Case not found');
      caseTitle = c[0].title;
    }
    const rows = await sql<Row[]>`
      insert into reminders (firm_id, user_id, case_id, title, note, remind_at)
      values (${firmId}::uuid, ${userId}::uuid, ${input.caseId ?? null}, ${input.title.trim()}, ${(input.note ?? '').trim()}, ${at})
      returning id, case_id, null::text as case_title, title, note, remind_at, sent_at`;
    return { ...toReminder(rows[0]!), caseTitle };
  },

  /** Own reminders only; false when there's nothing of the user's to delete. */
  async remove(userId: string, id: string): Promise<boolean> {
    const sql = db();
    if (!sql) return false;
    const rows = await sql`delete from reminders where id = ${id}::uuid and user_id = ${userId}::uuid returning id`;
    return rows.length > 0;
  },

  /**
   * Send every due reminder once. Rows are claimed and marked sent in one
   * statement (`skip locked`), so overlapping runs never double-send; a failed
   * notification write is logged, not retried, so a bad row can't loop.
   */
  async sendDue(): Promise<{ sent: number }> {
    const sql = db();
    if (!sql) return { sent: 0 };
    const due = await sql<Array<{ id: string; firm_id: string; user_id: string; case_id: string | null; title: string; note: string }>>`
      update reminders set sent_at = now()
      where id in (
        select id from reminders
        where sent_at is null and remind_at <= now()
        order by remind_at
        limit 200
        for update skip locked
      )
      returning id, firm_id, user_id, case_id, title, note`;
    const { notificationsStore } = await import('./notifications.service');
    let sent = 0;
    for (const r of due) {
      const id = await notificationsStore.create({
        firmId: r.firm_id,
        userId: r.user_id,
        tone: 'amber',
        icon: 'bell',
        title: `Reminder: ${r.title}`.slice(0, 160),
        body: r.note,
        view: r.case_id ? `cases/${r.case_id}` : 'dashboard',
        dedupeKey: `reminder:${r.id}`,
      });
      if (id) sent += 1;
      else logger.warn({ reminderId: r.id }, 'reminder: notification not written');
    }
    return { sent };
  },
};
