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

export const hearingsService = {
  async listToday(): Promise<Hearing[]> {
    const sql = db();
    if (sql) {
      const rows = await sql<HearingRow[]>`
        select id, case_label, hearing_time, court, purpose, status
        from hearings where status = 'today'
        order by hearing_time
      `;
      return rows.map(fromRow);
    }
    return memory.filter((h) => h.status === 'today');
  },

  async listUpcoming(): Promise<Hearing[]> {
    const sql = db();
    if (sql) {
      const rows = await sql<HearingRow[]>`
        select id, case_label, hearing_time, court, purpose, status
        from hearings order by status desc, hearing_time
      `;
      return rows.map(fromRow);
    }
    return memory;
  },

  async week(weekStartIso?: string): Promise<CalendarWeek> {
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

    const sql = db();
    if (!sql) {
      return { weekStart: startStr, days, hearings: [] };
    }

    const rows = await sql<HearingDateRow[]>`
      select id, case_label, hearing_time, court, purpose, status,
             hearing_date, judge
      from hearings
      where hearing_date between ${startStr}::date and ${endStr}::date
      order by hearing_date asc, hearing_time asc
    `;
    const hearings = rows.map(fromDateRow);
    for (const h of hearings) {
      const day = days.find((x) => x.date === h.date);
      if (day) day.count += 1;
    }
    return { weekStart: startStr, days, hearings };
  },

  async listForDay(iso: string): Promise<CalendarHearing[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<HearingDateRow[]>`
      select id, case_label, hearing_time, court, purpose, status,
             hearing_date, judge
      from hearings where hearing_date = ${iso}::date
      order by hearing_time asc
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
  }): Promise<CalendarHearing> {
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
    const rows = await sql<HearingDateRow[]>`
      insert into hearings (case_label, hearing_time, court, purpose, status, hearing_date, judge)
      values (${input.case}, ${input.time}, ${input.court}, ${input.purpose},
              ${input.status}::hearing_status, ${input.date || null},
              ${input.judge || null})
      returning id, case_label, hearing_time, court, purpose, status,
                hearing_date, judge
    `;
    return fromDateRow(rows[0]!);
  },
};
