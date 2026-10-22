import type { CalendarHearing, CalendarMonth, CalendarWeek, Hearing } from '@lexdraft/types';
import { db } from '../db/client';
import { SEED_HEARINGS } from '../data/seed';

interface HearingRow {
  id: string;
  case_label: string;
  hearing_time: string;
  court: string;
  purpose: string;
  status: Hearing['status'];
  judge: string | null;
}

interface HearingDateRow extends HearingRow {
  hearing_date: string | Date | null;
}

const memory: Hearing[] = SEED_HEARINGS.map((h, i) => ({ ...h, id: `h${i + 1}` }));

function dateOnly(v: string | Date | null): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

/**
 * Formats a *locally-constructed* Date (e.g. `new Date(year, month, day)` or
 * `new Date()`) as a local-calendar YYYY-MM-DD string. Unlike
 * `.toISOString().slice(0, 10)` - which converts to UTC first - this reads
 * the Date's local year/month/date fields directly, so it doesn't shift the
 * result backwards by the server's UTC offset (e.g. Asia/Kolkata, UTC+5:30).
 * Use this for any Date built with the local-time constructor; `dateOnly()`
 * above remains correct for DB-sourced DATE values, which the driver already
 * parses as UTC midnight.
 */
function isoOfLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromRow(r: HearingRow): Hearing {
  return {
    id: r.id,
    case: r.case_label,
    time: r.hearing_time,
    court: r.court,
    purpose: r.purpose,
    status: r.status,
    judge: r.judge,
  };
}

function fromDateRow(r: HearingDateRow): CalendarHearing {
  return {
    ...fromRow(r),
    date: dateOnly(r.hearing_date),
  };
}

function startOfWeek(iso: string): Date {
  const d = new Date(iso + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}

const WEEKDAY_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

function placeholderCnr(): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TEMP-${today}-${rand}`;
}

/**
 * Resolve the case_id for a hearing payload, creating a placeholder case in
 * the caller's firm when none exists yet. Hearings *must* have a parent case
 * row so per-firm reads (which join through cases.firm_id) can find them - so
 * if the user types a brand-new matter title we materialise a thin case
 * record they can flesh out from the Cases tab later. This lets lawyers
 * schedule hearings for prospects, walk-ins, or matters that haven't been
 * formally filed without the form rejecting them.
 */
/**
 * Recomputes `cases.next_hearing` as the earliest today-or-future hearing
 * date for this case, after any hearing create/update/delete.
 *
 * Without this, `cases.next_hearing` only ever got set once - when a hearing
 * created a brand-new placeholder case (see ensureCaseId) - and was frozen
 * from then on for every existing case. That field is what the Calendar's
 * "next hearing" display AND the daily hearing-reminder scan both read, so
 * manually-added hearings on an existing case silently never surfaced there
 * or triggered a reminder. eCourts syncs don't have this gap - they write
 * next_hearing directly from eCourts' own "next hearing" field - this closes
 * the same gap for manually-entered hearings.
 */
async function syncCaseNextHearing(sql: NonNullable<ReturnType<typeof db>>, caseId: string): Promise<void> {
  await sql`
    update cases set next_hearing = (
      select min(hearing_date) from hearings
      where case_id = ${caseId}::uuid and hearing_date >= current_date
    )
    where id = ${caseId}::uuid
  `;
}

async function ensureCaseId(
  sql: NonNullable<ReturnType<typeof db>>,
  firmId: string,
  input: { case: string; court: string; date?: string; caseId?: string },
): Promise<string> {
  if (input.caseId) {
    const [byId] = await sql<Array<{ id: string }>>`
      select id from cases
      where id = ${input.caseId}::uuid and firm_id = ${firmId}::uuid limit 1
    `;
    if (!byId) {
      throw Object.assign(new Error('Case not found in this firm'), { status: 404 });
    }
    return byId.id;
  }

  const [byTitle] = await sql<Array<{ id: string }>>`
    select id from cases
    where firm_id = ${firmId}::uuid and title = ${input.case}
    order by created_at desc limit 1
  `;
  if (byTitle) return byTitle.id;

  // No existing case - create a placeholder so the hearing can attach. CNR
  // gets a TEMP- prefix that the user can later replace with a real eCourts
  // CNR. Client is left blank: lawyers can fill it in once they have one.
  const [created] = await sql<Array<{ id: string }>>`
    insert into cases (firm_id, cnr, title, court, stage, client, status, next_hearing, type)
    values (${firmId}::uuid, ${placeholderCnr()}, ${input.case},
            ${input.court || ''}, 'Filing', '', 'Active',
            ${input.date || null}, 'Other')
    returning id
  `;
  if (!created) {
    throw Object.assign(new Error('Could not create matter for this hearing'), { status: 500 });
  }
  return created.id;
}

/**
 * `hearings` doesn't carry firm_id directly - it joins to `cases.firm_id`
 * via `case_id`. Hearings without a `case_id` are orphans (legacy / loose
 * entries) and are excluded from per-firm reads to prevent cross-tenant
 * disclosure. The cause-list view renders hearings with case_label even when
 * case_id is null - but only when they belong to a case in the same firm.
 */
export const hearingsService = {
  /**
   * Hearings listed for today's local date. `assignedToUserId` is the
   * effective advocate: the per-hearing override, else the matter's lead. `status` is only set when a
   * hearing is saved and never rolls forward, so it can't be trusted on its
   * own - a hearing saved last week as 'upcoming' for today would be missed.
   * The date decides; `status = 'today'` only counts for undated rows.
   */
  async listToday(firmId: string | null): Promise<Hearing[]> {
    if (!firmId) return [];
    const sql = db();
    if (sql) {
      const todayIso = isoOfLocal(new Date());
      const rows = await sql<Array<HearingRow & { case_id: string; assigned_to_user_id: string | null }>>`
        select h.id, h.case_label, h.hearing_time, h.court, h.purpose, h.status, h.judge,
               h.case_id,
               -- An unassigned hearing belongs to the matter's lead (see assignments.service).
               coalesce(h.assigned_to_user_id, (
                 select ca.user_id from case_assignments ca
                 where ca.case_id = h.case_id and ca.role_on_case = 'lead'
                 limit 1
               )) as assigned_to_user_id
        from hearings h
        join cases c on c.id = h.case_id
        where c.firm_id = ${firmId}::uuid
          and (h.hearing_date = ${todayIso}::date
               or (h.hearing_date is null and h.status = 'today'))
        order by h.hearing_time
      `;
      return rows.map((r) => ({
        ...fromRow(r),
        status: 'today' as const,
        caseId: r.case_id,
        assignedToUserId: r.assigned_to_user_id,
      }));
    }
    return memory.filter((h) => h.status === 'today');
  },

  async listUpcoming(firmId: string | null): Promise<Hearing[]> {
    if (!firmId) return [];
    const sql = db();
    if (sql) {
      const rows = await sql<HearingRow[]>`
        select h.id, h.case_label, h.hearing_time, h.court, h.purpose, h.status, h.judge
        from hearings h
        join cases c on c.id = h.case_id
        where c.firm_id = ${firmId}::uuid
        order by h.status desc, h.hearing_time
      `;
      return rows.map(fromRow);
    }
    return memory;
  },

  async week(firmId: string | null, weekStartIso?: string): Promise<CalendarWeek> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = isoOfLocal(today);
    const start = startOfWeek(weekStartIso ?? todayIso);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const startStr = isoOfLocal(start);
    const endStr = isoOfLocal(end);

    const days: CalendarWeek['days'] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = isoOfLocal(d);
      return {
        date: iso,
        weekday: WEEKDAY_LABELS[i]!,
        count: 0,
        isToday: iso === todayIso,
      };
    });

    if (!firmId) return { weekStart: startStr, days, hearings: [] };
    const sql = db();
    if (!sql) {
      return { weekStart: startStr, days, hearings: [] };
    }

    const rows = await sql<HearingDateRow[]>`
      select h.id, h.case_label, h.hearing_time, h.court, h.purpose, h.status,
             h.hearing_date, h.judge
      from hearings h
      join cases c on c.id = h.case_id
      where h.hearing_date between ${startStr}::date and ${endStr}::date
        and c.firm_id = ${firmId}::uuid
      order by h.hearing_date asc, h.hearing_time asc
    `;
    const hearings = rows.map(fromDateRow);
    for (const h of hearings) {
      const day = days.find((x) => x.date === h.date);
      if (day) day.count += 1;
    }
    return { weekStart: startStr, days, hearings };
  },

  async month(firmId: string | null, year: number, month: number): Promise<CalendarMonth> {
    const monthIndex = month - 1; // JS Date months are 0-based
    const first = new Date(year, monthIndex, 1);
    first.setHours(0, 0, 0, 0);
    const last = new Date(year, monthIndex + 1, 0);
    last.setHours(0, 0, 0, 0);
    const startStr = isoOfLocal(first);
    const endStr = isoOfLocal(last);
    const todayIso = (() => {
      const t = new Date(); t.setHours(0, 0, 0, 0);
      return isoOfLocal(t);
    })();

    const days: CalendarMonth['days'] = [];
    for (let d = 1; d <= last.getDate(); d++) {
      const dt = new Date(year, monthIndex, d);
      const iso = isoOfLocal(dt);
      const dow = ((dt.getDay() + 6) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
      days.push({ date: iso, weekdayIndex: dow, count: 0, isToday: iso === todayIso });
    }

    if (!firmId) return { year, month, monthStart: startStr, days, hearings: [] };
    const sql = db();
    if (!sql) return { year, month, monthStart: startStr, days, hearings: [] };

    const rows = await sql<HearingDateRow[]>`
      select h.id, h.case_label, h.hearing_time, h.court, h.purpose, h.status,
             h.hearing_date, h.judge
      from hearings h
      join cases c on c.id = h.case_id
      where h.hearing_date between ${startStr}::date and ${endStr}::date
        and c.firm_id = ${firmId}::uuid
      order by h.hearing_date asc, h.hearing_time asc
    `;
    const hearings = rows.map(fromDateRow);
    for (const h of hearings) {
      const cell = days.find((x) => x.date === h.date);
      if (cell) cell.count += 1;
    }
    return { year, month, monthStart: startStr, days, hearings };
  },

  async listForDay(firmId: string | null, iso: string): Promise<CalendarHearing[]> {
    if (!firmId) return [];
    const sql = db();
    if (!sql) return [];
    const rows = await sql<HearingDateRow[]>`
      select h.id, h.case_label, h.hearing_time, h.court, h.purpose, h.status,
             h.hearing_date, h.judge
      from hearings h
      join cases c on c.id = h.case_id
      where h.hearing_date = ${iso}::date and c.firm_id = ${firmId}::uuid
      order by h.hearing_time asc
    `;
    return rows.map(fromDateRow);
  },

  async create(input: {
    case: string;
    time: string;
    court: string;
    purpose: string;
    status: Hearing['status'];
    date?: string;
    judge?: string;
    /** Required so we can constrain the new row to a case in the caller's firm. */
    caseId?: string;
  }, firmId: string | null): Promise<CalendarHearing> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot create hearing'), { status: 422 });
    }
    const sql = db();
    if (!sql) {
      const fallback: CalendarHearing = {
        id: `h${memory.length + 1}`,
        case: input.case,
        time: input.time,
        court: input.court,
        purpose: input.purpose,
        status: input.status,
        date: input.date ?? '',
        judge: input.judge || null,
      };
      memory.push(fallback);
      return fallback;
    }
    const caseId = await ensureCaseId(sql, firmId, input);
    // firm_id is NOT NULL on this table (migration 0043_tenant_invariants.sql,
    // the cross-tenant-exposure fix) - this INSERT predates that migration
    // and was never updated, so every manually-added hearing since then has
    // thrown a constraint violation at the DB. eCourts-synced hearings never
    // hit this because case-sync.service.ts's own INSERT already sets it.
    const rows = await sql<HearingDateRow[]>`
      insert into hearings (case_id, firm_id, case_label, hearing_time, court, purpose, status, hearing_date, judge)
      values (${caseId}::uuid, ${firmId}::uuid, ${input.case}, ${input.time}, ${input.court}, ${input.purpose},
              ${input.status}::hearing_status, ${input.date || null},
              ${input.judge || null})
      returning id, case_label, hearing_time, court, purpose, status,
                hearing_date, judge
    `;
    await syncCaseNextHearing(sql, caseId);
    return fromDateRow(rows[0]!);
  },

  async update(
    id: string,
    input: {
      case: string;
      time: string;
      court: string;
      purpose: string;
      status: Hearing['status'];
      date?: string;
      judge?: string;
      /** Pins re-resolution to this exact case row; falls back to a
       *  title-match lookup (newest case wins) only when absent. */
      caseId?: string;
    },
    firmId: string | null,
  ): Promise<CalendarHearing> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot update hearing'), { status: 422 });
    }
    const sql = db();
    if (!sql) {
      const idx = memory.findIndex((h) => h.id === id);
      if (idx === -1) {
        throw Object.assign(new Error('Hearing not found'), { status: 404 });
      }
      const next: CalendarHearing = {
        id,
        case: input.case,
        time: input.time,
        court: input.court,
        purpose: input.purpose,
        status: input.status,
        date: input.date ?? (memory[idx] as Hearing & { date?: string }).date ?? '',
        judge: input.judge || (memory[idx]?.judge ?? null),
      };
      memory[idx] = next;
      return next;
    }
    // Capture the hearing's CURRENT case before any change, so a moved or
    // retimed hearing recomputes next_hearing on both the old case (which
    // may have lost its soonest hearing) and the new one.
    const [before] = await sql<Array<{ case_id: string }>>`
      select h.case_id from hearings h join cases c on c.id = h.case_id
      where h.id = ${id}::uuid and c.firm_id = ${firmId}::uuid
    `;

    // If the matter label changed, re-resolve (or auto-create) the case so we
    // never reattach a hearing to a case belonging to a different firm.
    const caseId = await ensureCaseId(sql, firmId, input);
    const rows = await sql<HearingDateRow[]>`
      update hearings h
      set case_id      = ${caseId}::uuid,
          case_label   = ${input.case},
          hearing_time = ${input.time},
          court        = ${input.court},
          purpose      = ${input.purpose},
          status       = ${input.status}::hearing_status,
          hearing_date = ${input.date || null},
          judge        = ${input.judge || null}
      from cases c
      where h.case_id = c.id
        and h.id = ${id}::uuid
        and c.firm_id = ${firmId}::uuid
      returning h.id, h.case_label, h.hearing_time, h.court, h.purpose, h.status,
                h.hearing_date, h.judge
    `;
    const row = rows[0];
    if (!row) {
      throw Object.assign(new Error('Hearing not found'), { status: 404 });
    }
    await syncCaseNextHearing(sql, caseId);
    if (before && before.case_id !== caseId) await syncCaseNextHearing(sql, before.case_id);
    return fromDateRow(row);
  },

  async remove(id: string, firmId: string | null): Promise<void> {
    if (!firmId) {
      throw Object.assign(new Error('No firm attached - cannot delete hearing'), { status: 422 });
    }
    const sql = db();
    if (!sql) {
      const idx = memory.findIndex((h) => h.id === id);
      if (idx === -1) {
        throw Object.assign(new Error('Hearing not found'), { status: 404 });
      }
      memory.splice(idx, 1);
      return;
    }
    const rows = await sql<Array<{ id: string; case_id: string }>>`
      delete from hearings h
      using cases c
      where h.case_id = c.id
        and h.id = ${id}::uuid
        and c.firm_id = ${firmId}::uuid
      returning h.id, h.case_id
    `;
    if (rows.length === 0) {
      throw Object.assign(new Error('Hearing not found'), { status: 404 });
    }
    await syncCaseNextHearing(sql, rows[0]!.case_id);
  },
};
