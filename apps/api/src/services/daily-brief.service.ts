import { db } from '../db/client';
import { logger } from '../logger';
import { notificationsStore, resolveCaseRecipients } from './notifications.service';

// =============================================================================
// Daily brief (build-docs/features/daily-brief.md). One notification a day per
// advocate at 07:00 IST (today, tomorrow, tasks, reminders) and one in the
// evening after the eCourts run (tomorrow's hearings). Hearings come from
// eCourts-synced case dates, hearings entered by hand, and the Court Diary.
// =============================================================================

export interface BriefHearing { key: string; label: string; time: string | null; court: string | null }
export interface UserBrief {
  today: BriefHearing[];
  tomorrow: BriefHearing[];
  next: { label: string; day: string } | null;
  tasksDue: number;
  tasksOverdue: number;
  remindersToday: number;
}
export interface BriefText { title: string; body: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** yyyy-mm-dd in India for `now`, plus `plus` days. */
export function istDay(now: Date, plus = 0): string {
  return new Date(now.getTime() + 330 * 60_000 + plus * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function fmtDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function names(hs: BriefHearing[], withCourt = false): string {
  const shown = hs.slice(0, 3).map((h) => {
    const extra = [h.time, withCourt ? h.court : null].filter(Boolean).join(', ');
    return extra ? `${h.label} (${extra})` : h.label;
  });
  if (hs.length > 3) shown.push(`+${hs.length - 3} more`);
  return shown.join(' · ');
}

function workLine(b: UserBrief): string[] {
  const out: string[] = [];
  if (b.tasksDue > 0) out.push(`${plural(b.tasksDue, 'task')} due today`);
  if (b.tasksOverdue > 0) out.push(`${b.tasksOverdue} overdue`);
  if (b.remindersToday > 0) out.push(plural(b.remindersToday, 'reminder') + ' today');
  return out;
}

/** 07:00 brief, or null when there is nothing useful to say. */
export function composeMorning(b: UserBrief): BriefText | null {
  const work = workLine(b);
  if (b.today.length === 0 && b.tomorrow.length === 0 && !b.next && work.length === 0) return null;
  const parts: string[] = [];
  let title: string;
  if (b.today.length > 0) {
    title = `Today: ${plural(b.today.length, 'hearing')}`;
    parts.push(names(b.today));
    if (b.tomorrow.length > 0) parts.push(`Tomorrow: ${plural(b.tomorrow.length, 'hearing')}`);
  } else {
    title = 'No hearings today';
    if (b.tomorrow.length > 0) parts.push(`Tomorrow: ${names(b.tomorrow)}`);
    else if (b.next) parts.push(`Next: ${b.next.label} on ${fmtDay(b.next.day)}`);
  }
  if (work.length > 0) parts.push(work.join(', '));
  return { title, body: parts.join('. ') + '.' };
}

/** Evening brief: tomorrow's hearings, or null when there are none. */
export function composeEvening(b: UserBrief): BriefText | null {
  if (b.tomorrow.length === 0) return null;
  return { title: `Tomorrow: ${plural(b.tomorrow.length, 'hearing')}`, body: `${names(b.tomorrow, true)}.` };
}

interface HearingRow { firm_id: string; case_id: string | null; label: string; day: string; time: string | null; court: string | null; owner: string | null }
interface UserRow { id: string; firm_id: string; daily_brief: boolean }

const emptyBrief = (): UserBrief => ({ today: [], tomorrow: [], next: null, tasksDue: 0, tasksOverdue: 0, remindersToday: 0 });

/** Everyone's brief for `today` (IST yyyy-mm-dd). Hearings are read up to
 *  `horizonDays` ahead (for "Next:"). Users who switched the brief off, or
 *  are not active, get none. */
export async function collectBriefs(today: string, horizonDays: number, withWork: boolean): Promise<Map<string, { firmId: string; brief: UserBrief }>> {
  const out = new Map<string, { firmId: string; brief: UserBrief }>();
  const sql = db();
  if (!sql) return out;
  const tomorrow = addDays(today, 1);
  const until = addDays(today, horizonDays);

  const users = await sql<UserRow[]>`
    select id, firm_id, daily_brief from users
    where firm_id is not null and (status is null or status = 'active')`;
  const byId = new Map(users.map((u) => [u.id, u]));
  const get = (u: UserRow) => {
    let e = out.get(u.id);
    if (!e) { e = { firmId: u.firm_id, brief: emptyBrief() }; out.set(u.id, e); }
    return e.brief;
  };

  const rows = await sql<HearingRow[]>`
    with lead as (
      select distinct on (case_id) case_id, user_id from case_assignments where role_on_case = 'lead' order by case_id, user_id
    )
    select c.firm_id, c.id as case_id, coalesce(nullif(trim(c.title), ''), c.cnr) as label, c.next_hearing::text as day,
           null::text as time, nullif(trim(c.court), '') as court, coalesce(l.user_id, c.created_by_user_id) as owner
    from cases c left join lead l on l.case_id = c.id
    where c.status in ('Active', 'Pending') and c.deleted_at is null
      and c.next_hearing between ${today}::date and ${until}::date
    union all
    select h.firm_id, h.case_id, coalesce(nullif(trim(c.title), ''), h.case_label), h.hearing_date::text,
           nullif(trim(h.hearing_time), ''), nullif(trim(h.court), ''), coalesce(h.assigned_to_user_id, l.user_id, c.created_by_user_id)
    from hearings h left join cases c on c.id = h.case_id left join lead l on l.case_id = h.case_id
    where h.hearing_date between ${today}::date and ${until}::date and h.status <> 'past'
      and (c.id is null or (c.deleted_at is null and c.status in ('Active', 'Pending')))
    union all
    select d.firm_id, null, d.case_label, d.next_hearing_date::text, null, nullif(trim(d.forum), ''), null
    from diary_entries d
    where d.firm_id is not null and d.next_hearing_date between ${today}::date and ${until}::date
    order by day, time nulls last`;

  // Owner if active (and opted in); else the firm's usual recipients.
  const firmCache = new Map<string, string[]>();
  const recipients = async (r: HearingRow): Promise<UserRow[]> => {
    const owner = r.owner ? byId.get(r.owner) : undefined;
    let ids: string[];
    if (owner) ids = [owner.id];
    else {
      if (!firmCache.has(r.firm_id)) firmCache.set(r.firm_id, (await resolveCaseRecipients(r.firm_id, null)).map((u) => u.id));
      ids = firmCache.get(r.firm_id)!;
    }
    return ids.map((id) => byId.get(id)).filter((u): u is UserRow => !!u && u.daily_brief);
  };

  const seen = new Set<string>();
  for (const r of rows) {
    const label = (r.label ?? '').trim() || 'Untitled matter';
    for (const u of await recipients(r)) {
      // Once per user per day per matter: by case, or by name for diary rows.
      const k1 = `${u.id}|${r.day}|${r.case_id ?? ''}`;
      const k2 = `${u.id}|${r.day}|${label.toLowerCase()}`;
      if ((r.case_id && seen.has(k1)) || seen.has(k2)) continue;
      if (r.case_id) seen.add(k1);
      seen.add(k2);
      const b = get(u);
      const h: BriefHearing = { key: r.case_id ?? label, label, time: r.time, court: r.court };
      if (r.day === today) b.today.push(h);
      else if (r.day === tomorrow) b.tomorrow.push(h);
      if (r.day > today && (!b.next || r.day < b.next.day)) b.next = { label, day: r.day };
    }
  }

  if (withWork) {
    const tasks = await sql<Array<{ user_id: string; due: number; overdue: number }>>`
      select assignee_user_id as user_id,
             count(*) filter (where due_date = ${today}::date)::int as due,
             count(*) filter (where due_date < ${today}::date)::int as overdue
      from tasks
      where assignee_user_id is not null and due_date <= ${today}::date and column_name <> 'done'
      group by assignee_user_id`;
    for (const t of tasks) {
      const u = byId.get(t.user_id);
      if (!u?.daily_brief) continue;
      const b = get(u);
      b.tasksDue = t.due;
      b.tasksOverdue = t.overdue;
    }
    const rem = await sql<Array<{ user_id: string; n: number }>>`
      select user_id, count(*)::int as n from reminders
      where sent_at is null and remind_at >= now()
        and remind_at < (${tomorrow}::date)::timestamp at time zone 'Asia/Kolkata'
      group by user_id`;
    for (const r of rem) {
      const u = byId.get(r.user_id);
      if (u?.daily_brief) get(u).remindersToday = r.n;
    }
  }
  return out;
}

async function send(kind: 'morning' | 'evening', now: Date): Promise<{ users: number; sent: number }> {
  const day = istDay(now);
  const briefs = await collectBriefs(day, kind === 'morning' ? 60 : 1, kind === 'morning');
  let sent = 0;
  for (const [userId, { firmId, brief }] of briefs) {
    const text = kind === 'morning' ? composeMorning(brief) : composeEvening(brief);
    if (!text) continue;
    const id = await notificationsStore.create({
      firmId, userId, tone: 'cobalt', icon: 'calendar', title: text.title, body: text.body, view: 'causelist',
      dedupeKey: `brief:${kind}:${day}`,
      // Morning: once a day, even if the job runs again. Evening: an eCourts
      // retry that changes tomorrow's list sends the corrected one.
      repeat: kind === 'morning' ? 'never' : 'if-changed',
    });
    if (id) sent += 1;
  }
  return { users: briefs.size, sent };
}

export const dailyBrief = {
  sendMorning: (now = new Date()) => send('morning', now),
  sendEvening: (now = new Date()) => send('evening', now),
  async isOn(userId: string): Promise<boolean> {
    const sql = db();
    if (!sql) return true;
    const [r] = await sql<Array<{ daily_brief: boolean }>>`select daily_brief from users where id = ${userId}::uuid`;
    return r?.daily_brief ?? true;
  },
  async setOn(userId: string, on: boolean): Promise<void> {
    const sql = db();
    if (!sql) return;
    await sql`update users set daily_brief = ${on} where id = ${userId}::uuid`;
  },
};

/** The watchdog re-runs the morning brief in this window (server was down at 07:00). */
export function inMorningWindow(now: Date): boolean {
  const h = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  return h >= 7 && h < 9;
}

export async function safeRun(kind: 'morning' | 'evening', now = new Date()): Promise<void> {
  // A late catch-up of the evening slot after midnight must not announce the
  // wrong "tomorrow"; the morning brief covers that day instead.
  if (kind === 'evening' && new Date(now.getTime() + 330 * 60_000).getUTCHours() < 15) return;
  try {
    const r = await (kind === 'morning' ? dailyBrief.sendMorning(now) : dailyBrief.sendEvening(now));
    if (r.sent) logger.info(r, `daily brief (${kind}) sent`);
  } catch (err) {
    logger.warn({ err }, `daily brief (${kind}) failed`);
  }
}
