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

  async month(firmId: string | null, year: number, month: number): Promise<CalendarMonth> {
    const monthIndex = month - 1; // JS Date months are 0-based
    const first = new Date(year, monthIndex, 1);
    first.setHours(0, 0, 0, 0);
    const last = new Date(year, monthIndex + 1, 0);
    last.setHours(0, 0, 0, 0);
    const startStr = first.toISOString().slice(0, 10);
    const endStr = last.toISOString().slice(0, 10);
    const todayIso = (() => {
      const t = new Date(); t.setHours(0, 0, 0, 0);
      return t.toISOString().slice(0, 10);
    })();

    const days: CalendarMonth['days'] = [];
    for (let d = 1; d <= last.getDate(); d++) {
      const dt = new Date(year, monthIndex, d);
      const iso = dt.toISOString().slice(0, 10);
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
      };
      memory.push(fallback);
      return fallback;
    }
    const caseId = await ensureCaseId(sql, firmId, input);
    const rows = await sql<HearingDateRow[]>`
      insert into hearings (case_id, case_label, hearing_time, court, purpose, status, hearing_date, judge)
      values (${caseId}::uuid, ${input.case}, ${input.time}, ${input.court}, ${input.purpose},
              ${input.status}::hearing_status, ${input.date || null},
              ${input.judge || null})
      returning id, case_label, hearing_time, court, purpose, status,
                hearing_date, judge
    `;
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
      };
      memory[idx] = next;
      return next;
    }
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
    const rows = await sql<Array<{ id: string }>>`
      delete from hearings h
      using cases c
      where h.case_id = c.id
        and h.id = ${id}::uuid
        and c.firm_id = ${firmId}::uuid
      returning h.id
    `;
    if (rows.length === 0) {
      throw Object.assign(new Error('Hearing not found'), { status: 404 });
    }
  },
};
