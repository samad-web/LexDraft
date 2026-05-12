import type { CalendarHearing, CalendarWeek, Hearing } from '@lexdraft/types';
import { db } from '../db/client';
import { SEED_HEARINGS } from '../data/seed';

interface HearingRow {
  id: string;
  case_label: string;
  hearing_time: string;
  court: string;
  purpose: string;
  status: Hearing['status'];
}

interface HearingDateRow extends HearingRow {
  hearing_date: string | Date | null;
  judge: string | null;
}

const memory: Hearing[] = SEED_HEARINGS.map((h, i) => ({ ...h, id: `h${i + 1}` }));

function dateOnly(v: string | Date | null): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

function fromRow(r: HearingRow): Hearing {
  return {
    id: r.id,
    case: r.case_label,
    time: r.hearing_time,
    court: r.court,
    purpose: r.purpose,
    status: r.status,
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

/**
 * `hearings` doesn't carry firm_id directly — it joins to `cases.firm_id`
 * via `case_id`. Hearings without a `case_id` are orphans (legacy / loose
 * entries) and are excluded from per-firm reads to prevent cross-tenant
 * disclosure. The cause-list view renders hearings with case_label even when
 * case_id is null — but only when they belong to a case in the same firm.
 */
export const hearingsService = {
  async listToday(firmId: string | null): Promise<Hearing[]> {
    if (!firmId) return [];
    const sql = db();
    if (sql) {
      const rows = await sql<HearingRow[]>`
        select h.id, h.case_label, h.hearing_time, h.court, h.purpose, h.status
        from hearings h
        join cases c on c.id = h.case_id
        where h.status = 'today' and c.firm_id = ${firmId}::uuid
        order by h.hearing_time
      `;
      return rows.map(fromRow);
    }
    return memory.filter((h) => h.status === 'today');
  },

  async listUpcoming(firmId: string | null): Promise<Hearing[]> {
    if (!firmId) return [];
    const sql = db();
    if (sql) {
      const rows = await sql<HearingRow[]>`
        select h.id, h.case_label, h.hearing_time, h.court, h.purpose, h.status
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
    const start = startOfWeek(weekStartIso ?? today.toISOString().slice(0, 10));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = end.toISOString().slice(0, 10);

    const days: CalendarWeek['days'] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      return {
        date: iso,
        weekday: WEEKDAY_LABELS[i]!,
        count: 0,
        isToday: iso === today.toISOString().slice(0, 10),
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
      throw Object.assign(new Error('No firm attached — cannot create hearing'), { status: 422 });
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
      };
      memory.push(fallback);
      return fallback;
    }
    // Resolve case_id either from input.caseId (must be in this firm) or from
    // matching the case_label inside the firm. Refuse to create cross-firm.
    const [caseRow] = input.caseId
      ? await sql<Array<{ id: string }>>`
          select id from cases
          where id = ${input.caseId}::uuid and firm_id = ${firmId}::uuid limit 1
        `
      : await sql<Array<{ id: string }>>`
          select id from cases
          where firm_id = ${firmId}::uuid and title = ${input.case}
          order by created_at desc limit 1
        `;
    if (!caseRow) {
      throw Object.assign(new Error('Case not found in this firm'), { status: 404 });
    }
    const rows = await sql<HearingDateRow[]>`
      insert into hearings (case_id, case_label, hearing_time, court, purpose, status, hearing_date, judge)
      values (${caseRow.id}::uuid, ${input.case}, ${input.time}, ${input.court}, ${input.purpose},
              ${input.status}::hearing_status, ${input.date || null},
              ${input.judge || null})
      returning id, case_label, hearing_time, court, purpose, status,
                hearing_date, judge
    `;
    return fromDateRow(rows[0]!);
  },
};
