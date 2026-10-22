import type { AttentionGroup, DashboardToday, DayHearing } from '@lexdraft/types';
import { db } from '../db/client';
import { authService } from './auth.service';
import { firmIdForUser } from './tenant';
import { resolveFeatures } from './permissions.service';
import { fyBoundaries, inrLabel } from './firm.service';

// =============================================================================
// dashboard-today.service
//
// The "advocate's day" dashboard in one read: today's hearings, the coming
// week, what needs attention, and a few practice figures. Read-only; every
// query is scoped by firm_id. Sections the caller can't see (by feature) come
// back null/omitted rather than zero, so the UI never shows a false "0".
// =============================================================================

/** Local-calendar YYYY-MM-DD (not UTC - see hearings.service isoOfLocal). */
function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateOnly(v: string | Date | null): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v.slice(0, 10);
}

const ATTENTION_SAMPLE = 4;

interface HearingRow {
  id: string;
  case_id: string;
  case_label: string;
  hearing_date: string | Date;
  hearing_time: string;
  court: string;
  purpose: string;
  judge: string | null;
  assignee: string | null;
  advocate: string | null;
}

function emptyToday(date: string): DashboardToday {
  return {
    date,
    user: { name: '', role: '' },
    canSeeFirm: false,
    hearingsToday: [],
    hearingsWeek: [],
    attention: [],
    practice: { activeMatters: 0, totalMatters: 0, revenueFY: null, overdueInvoices: null, openLeads: null },
  };
}

export const dashboardTodayService = {
  async today(userId: string | undefined): Promise<DashboardToday> {
    const now = new Date();
    const todayIso = localIso(now);
    // One 7-day horizon for both the week strip and "limitation due soon".
    const weekEndIso = localIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
    const soonIso = weekEndIso;

    const firmId = await firmIdForUser(userId);
    const sql = db();
    if (!userId || !firmId || !sql) return emptyToday(todayIso);

    const [{ features }, user] = await Promise.all([
      resolveFeatures(userId),
      authService.getById(userId),
    ]);
    const can = (f: string) => features.includes(f);

    // ---- Hearings: today through +7 days, with the effective advocate. -----
    const hearingRows = await sql<HearingRow[]>`
      select h.id, h.case_id, h.case_label, h.hearing_date, h.hearing_time,
             h.court, h.purpose, h.judge,
             a.assignee::text as assignee, au.name as advocate
      from hearings h
      join cases c on c.id = h.case_id
      -- Effective advocate: per-hearing override, else the matter's lead.
      left join lateral (
        select coalesce(h.assigned_to_user_id, (
          select ca.user_id from case_assignments ca
          where ca.case_id = h.case_id and ca.role_on_case = 'lead'
          limit 1
        )) as assignee
      ) a on true
      left join users au on au.id = a.assignee
      where c.firm_id = ${firmId}::uuid
        and c.deleted_at is null
        and h.hearing_date between ${todayIso}::date and ${weekEndIso}::date
      order by h.hearing_date, h.hearing_time
      limit 300
    `;
    const hearings: DayHearing[] = hearingRows.map((r) => ({
      id: r.id,
      caseId: r.case_id,
      case: r.case_label,
      date: dateOnly(r.hearing_date),
      time: r.hearing_time,
      court: r.court,
      purpose: r.purpose,
      judge: r.judge,
      mine: r.assignee === userId,
      unassigned: r.assignee === null,
      advocate: r.advocate ?? null,
    }));

    // ---- Attention + practice counts, one row. ------------------------------
    const [counts] = await sql<Array<{
      limitations: number; objections: number; no_next_date: number;
      reviews: number; client_messages: number; esign: number; overdue_tasks: number;
      active_matters: number; total_matters: number; overdue_inv_count: number; overdue_inv_total: number | string;
      revenue_fy: number | string; open_leads: number;
    }>>`
      select
        (select count(*) from limitations
          where firm_id = ${firmId}::uuid
            and deadline between ${todayIso}::date and ${soonIso}::date)::int as limitations,
        (select count(*) from efiling_filings
          where firm_id = ${firmId}::uuid and status = 'objected')::int as objections,
        (select count(*) from cases
          where firm_id = ${firmId}::uuid and kind = 'matter' and deleted_at is null
            and status = 'Active'
            and (next_hearing is null or next_hearing < ${todayIso}::date))::int as no_next_date,
        (select count(*) from contract_reviews
          where firm_id = ${firmId}::uuid and assigned_to = ${userId}::uuid
            and (decision is null or decision = 'pending'))::int as reviews,
        (select count(*) from portal_messages
          where firm_id = ${firmId}::uuid and sender_kind = 'client' and read_at is null)::int as client_messages,
        (select count(*) from esign_requests
          where firm_id = ${firmId}::uuid and status in ('sent', 'partially_signed'))::int as esign,
        (select count(*) from tasks
          where firm_id = ${firmId}::uuid and column_name <> 'done'
            and due_date is not null and due_date < ${todayIso}::date)::int as overdue_tasks,
        (select count(*) from cases
          where firm_id = ${firmId}::uuid and kind = 'matter' and deleted_at is null
            and status = 'Active')::int as active_matters,
        (select count(*) from cases
          where firm_id = ${firmId}::uuid and kind = 'matter' and deleted_at is null)::int as total_matters,
        (select count(*) from invoices
          where firm_id = ${firmId}::uuid and status = 'overdue')::int as overdue_inv_count,
        (select coalesce(sum(amount_inr), 0) from invoices
          where firm_id = ${firmId}::uuid and status = 'overdue')::bigint as overdue_inv_total,
        (select coalesce(sum(amount_inr), 0) from invoices
          where firm_id = ${firmId}::uuid
            and issued_date between ${fyBoundaries().startCurrent}::date and ${fyBoundaries().endCurrent}::date)::bigint as revenue_fy,
        (select count(*) from leads
          where firm_id = ${firmId}::uuid and stage in ('new', 'qualified', 'proposal'))::int as open_leads
    `;
    const n = (v: number | string | null | undefined) => Number(v ?? 0);

    // ---- A few rows per attention group, only for non-empty groups. --------
    const attention: AttentionGroup[] = [];
    const matterOk = can('matter.view');

    if (matterOk && n(counts?.limitations) > 0) {
      const rows = await sql<Array<{ id: string; case_label: string; filing_type: string; deadline: string | Date }>>`
        select id, case_label, filing_type, deadline from limitations
        where firm_id = ${firmId}::uuid
          and deadline between ${todayIso}::date and ${soonIso}::date
        order by deadline limit ${ATTENTION_SAMPLE}
      `;
      attention.push({
        key: 'limitations', count: n(counts?.limitations), to: '/app/limitation', tone: 'danger',
        items: rows.map((r) => ({
          id: r.id, label: r.case_label, detail: `${r.filing_type} · due ${dateOnly(r.deadline)}`, to: '/app/limitation',
        })),
      });
    }
    if (matterOk && n(counts?.objections) > 0) {
      const rows = await sql<Array<{ id: string; title: string; objections_raised_at: string | Date | null }>>`
        select id, title, objections_raised_at from efiling_filings
        where firm_id = ${firmId}::uuid and status = 'objected'
        order by objections_raised_at desc nulls last limit ${ATTENTION_SAMPLE}
      `;
      attention.push({
        key: 'objections', count: n(counts?.objections), to: '/app/efiling?m=objections', tone: 'danger',
        items: rows.map((r) => ({
          id: r.id, label: r.title,
          detail: r.objections_raised_at ? `Objection raised ${dateOnly(r.objections_raised_at)}` : 'Objection raised',
          to: `/app/efiling?filing=${r.id}`,
        })),
      });
    }
    if (matterOk && n(counts?.overdue_tasks) > 0) {
      const rows = await sql<Array<{ id: string; title: string; case_label: string; due_date: string | Date }>>`
        select id, title, case_label, due_date from tasks
        where firm_id = ${firmId}::uuid and column_name <> 'done'
          and due_date is not null and due_date < ${todayIso}::date
        order by due_date limit ${ATTENTION_SAMPLE}
      `;
      attention.push({
        key: 'overdueTasks', count: n(counts?.overdue_tasks), to: '/app/tasks', tone: 'warning',
        items: rows.map((r) => ({
          id: r.id, label: r.title, detail: `${r.case_label} · was due ${dateOnly(r.due_date)}`, to: '/app/tasks',
        })),
      });
    }
    if (matterOk && n(counts?.no_next_date) > 0) {
      const rows = await sql<Array<{ id: string; title: string; court: string }>>`
        select id, title, court from cases
        where firm_id = ${firmId}::uuid and kind = 'matter' and deleted_at is null
          and status = 'Active'
          and (next_hearing is null or next_hearing < ${todayIso}::date)
        order by updated_at desc limit ${ATTENTION_SAMPLE}
      `;
      attention.push({
        key: 'noNextDate', count: n(counts?.no_next_date), to: '/app/cases', tone: 'warning',
        items: rows.map((r) => ({ id: r.id, label: r.title, detail: r.court || undefined, to: `/app/cases/${r.id}` })),
      });
    }
    if (can('review.comment') && n(counts?.reviews) > 0) {
      const rows = await sql<Array<{ id: string; title: string }>>`
        select id, title from contract_reviews
        where firm_id = ${firmId}::uuid and assigned_to = ${userId}::uuid
          and (decision is null or decision = 'pending')
        order by created_at desc limit ${ATTENTION_SAMPLE}
      `;
      attention.push({
        key: 'reviews', count: n(counts?.reviews), to: '/app/review-queue', tone: 'info',
        items: rows.map((r) => ({ id: r.id, label: r.title, to: '/app/review-queue' })),
      });
    }
    if (can('client.view') && n(counts?.client_messages) > 0) {
      attention.push({
        key: 'clientMessages', count: n(counts?.client_messages), to: '/app/messages', tone: 'info', items: [],
      });
    }
    if (n(counts?.esign) > 0) {
      attention.push({ key: 'esign', count: n(counts?.esign), to: '/app/documents', tone: 'info', items: [] });
    }

    const billing = can('billing.view');
    return {
      date: todayIso,
      user: { name: user?.name ?? '', role: user?.role ?? '' },
      canSeeFirm: can('firm.dashboard.view'),
      hearingsToday: hearings.filter((h) => h.date === todayIso),
      hearingsWeek: hearings.filter((h) => h.date !== todayIso),
      attention,
      practice: {
        activeMatters: n(counts?.active_matters),
        totalMatters: n(counts?.total_matters),
        revenueFY: billing ? inrLabel(n(counts?.revenue_fy)) : null,
        overdueInvoices: billing
          ? { count: n(counts?.overdue_inv_count), amount: inrLabel(n(counts?.overdue_inv_total)) }
          : null,
        openLeads: can('leads.view') ? n(counts?.open_leads) : null,
      },
    };
  },
};
