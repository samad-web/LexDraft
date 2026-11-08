// =============================================================================
// deadline-alerts — daily bell (and email, when urgent) for limitation
// deadlines and open tasks. Design: build-docs/features/limitation-alerts.md and
// build-docs/features/task-alerts.md.
//
// Runs hourly 09:00–21:00 IST (jobs.service). Every alert carries a dedupe key
// (<kind>:<id>:<days left>), so the later runs only catch what an earlier run
// missed (server down at 9) and never repeat a notification or an email.
// =============================================================================

import { db } from '../db/client';
import { logger } from '../logger';
import { jobs } from './jobs.service';
import { notificationsStore, resolveCaseRecipients } from './notifications.service';

type Tone = 'vermillion' | 'amber' | 'cobalt';
export type TaskPriority = 'very_high' | 'high' | 'medium' | 'low';

/** Days before a limitation deadline that alert (0 = the due day). */
export const LIMITATION_ALERT_DAYS: readonly number[] = [90, 30, 7, 1, 0];

/** Days before a task's due date that alert, by priority (-1 = one day overdue).
 *  User's choice 2026-11-08: scaled by priority. */
export const TASK_ALERT_DAYS: Record<TaskPriority, readonly number[]> = {
  very_high: [3, 1, 0, -1],
  high: [1, 0, -1],
  medium: [0, -1],
  low: [0],
};

/** Today's date in India (YYYY-MM-DD), whatever the server's time zone. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function displayDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}
function dateOnly(v: string | Date): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}
function inDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export interface Alert {
  firmId: string;
  ownerUserId: string | null;
  dedupeKey: string;
  view: 'limitation' | 'tasks';
  icon: 'limitation' | 'tasks';
  tone: Tone;
  title: string;
  body: string;
  email: boolean;
}

export interface LimitationDue {
  id: string; firm_id: string; owner_user_id: string | null;
  case_label: string; filing_type: string; forum: string; deadline: string | Date; days_left: number;
}
export interface TaskDue {
  id: string; firm_id: string; owner_user_id: string | null;
  case_label: string; title: string; priority: string; due_date: string | Date; days_left: number;
}

export function limitationAlert(r: LimitationDue): Alert | null {
  if (!LIMITATION_ALERT_DAYS.includes(r.days_left)) return null;
  const due = displayDate(dateOnly(r.deadline));
  return {
    firmId: r.firm_id,
    ownerUserId: r.owner_user_id,
    dedupeKey: `limitation:${r.id}:${r.days_left}`,
    view: 'limitation',
    icon: 'limitation',
    tone: r.days_left <= 7 ? 'vermillion' : 'cobalt',
    title: `Limitation ${r.days_left === 0 ? 'expires today' : `expires ${inDays(r.days_left)}`}: ${r.case_label}`,
    body: `${r.filing_type}${r.forum ? ` before ${r.forum}` : ''}. Last day: ${due}. Verify the period against the Act and file before it lapses.`,
    email: r.days_left <= 7,
  };
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  very_high: 'Very high', high: 'High', medium: 'Medium', low: 'Low',
};

export function taskAlert(r: TaskDue): Alert | null {
  const priority = r.priority as TaskPriority;
  const days = TASK_ALERT_DAYS[priority];
  if (!days || !days.includes(r.days_left)) return null;
  const due = displayDate(dateOnly(r.due_date));
  const overdue = r.days_left < 0;
  return {
    firmId: r.firm_id,
    ownerUserId: r.owner_user_id,
    dedupeKey: `task:${r.id}:${r.days_left}`,
    view: 'tasks',
    icon: 'tasks',
    tone: overdue ? 'vermillion' : r.days_left === 0 ? 'amber' : 'cobalt',
    title: overdue ? `Task overdue: ${r.title}` : `Task due ${inDays(r.days_left)}: ${r.title}`,
    body: `${r.case_label} · ${PRIORITY_LABEL[priority]} priority · due ${due}.`,
    email: priority === 'very_high' || priority === 'high',
  };
}

/** Raise every alert due today (IST). Returns how many notifications were created. */
export async function runDeadlineAlerts(now: Date = new Date()): Promise<number> {
  const sql = db();
  if (!sql) return 0;
  const today = istToday(now);

  const limitations = await sql<LimitationDue[]>`
    select l.id, l.firm_id, c.created_by_user_id as owner_user_id,
           l.case_label, l.filing_type, l.forum, l.deadline,
           (l.deadline - ${today}::date)::int as days_left
    from limitations l
    left join cases c on c.id = (to_jsonb(l) ->> 'case_id')::uuid
    where l.firm_id is not null
      and (l.deadline - ${today}::date) in (90, 30, 7, 1, 0)
  `;
  const tasks = await sql<TaskDue[]>`
    select t.id, t.firm_id, c.created_by_user_id as owner_user_id,
           t.case_label, t.title, t.priority::text as priority, t.due_date,
           (t.due_date - ${today}::date)::int as days_left
    from tasks t
    left join cases c on c.id = (to_jsonb(t) ->> 'case_id')::uuid
    where t.firm_id is not null
      and t.column_name <> 'done'
      and t.due_date is not null
      and (t.due_date - ${today}::date) between -1 and 3
  `;

  const alerts = [
    ...limitations.map(limitationAlert),
    ...tasks.map(taskAlert),
  ].filter((a): a is Alert => a !== null);

  let created = 0;
  for (const a of alerts) {
    for (const r of await resolveCaseRecipients(a.firmId, a.ownerUserId)) {
      // Already raised by an earlier run today: no second bell, no second email.
      const seen = await sql<Array<{ one: number }>>`
        select 1 as one from notifications
        where user_id = ${r.id}::uuid and dedupe_key = ${a.dedupeKey}
        limit 1
      `;
      if (seen.length) continue;
      const id = await notificationsStore.create({
        firmId: a.firmId, userId: r.id, tone: a.tone, icon: a.icon,
        title: a.title, body: a.body, view: a.view, dedupeKey: a.dedupeKey,
      });
      if (!id) continue;
      created += 1;
      if (a.email) {
        try {
          await jobs.enqueue('email.send', { to: r.email, subject: a.title, body: `${a.body}\n\nOpen DifAi to review it.` });
        } catch (err) {
          logger.warn({ err, dedupeKey: a.dedupeKey }, 'deadline-alerts: email enqueue failed');
        }
      }
    }
  }
  logger.info({ today, candidates: alerts.length, created }, 'deadline-alerts: run complete');
  return created;
}
