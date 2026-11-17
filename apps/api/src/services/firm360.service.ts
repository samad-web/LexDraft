/**
 * Firm 360 + business overview for /admin (build-docs/features/admin-firm-360.md).
 * Read-mostly: plan mix / MRR / ARR, plans ending soon, sign-ups stuck before
 * payment, one firm's payments + invoices + credit ledger, and the one write:
 * extend a plan by whole months at no charge (audited).
 */
import type { AdminBusinessOverview, AdminFirmLedgerPage, AdminFirmPayments } from '@lexdraft/types';
import { db } from '../db/client';
import { BadRequestError, HttpError, NotFoundError } from '../lib/errors';
import { PLAN_NAMES } from '../lib/plans';
import { auditService } from './audit.service';
import { addPeriod } from './billing.service';
import { invalidatePlanStatusCache } from './plan-status.service';
import { subscriptionInvoiceService } from './subscription-invoice.service';

/** A plan that is paid for and still running (what MRR counts). */
export const PAID_NOW = `f.status = 'active' and f.plan_status = 'active' and not coalesce(f.free_plan, false)
  and f.renews_at > now() and coalesce(f.mrr_inr, 0) > 0`;

export function planName(selected: string | null, custom: string | null, free: boolean | null): string {
  if (free) return 'Free launch';
  if (selected === 'enterprise') return custom ? `${custom} (custom)` : 'Enterprise';
  if (!selected) return '—';
  const v4 = ['sanad', 'vakalat', 'brief', 'associates', 'partners', 'solo', 'practice', 'firm'].includes(selected);
  return `${PLAN_NAMES[selected] ?? selected}${v4 ? ' (v4)' : ''}`;
}

export const firm360Service = {
  async overview(): Promise<AdminBusinessOverview> {
    const sql = db();
    if (!sql) return { mrrInr: 0, arrInr: 0, planMix: [], endingSoon: [], stuckSignups: [] };
    const [mix, ending, stuck] = await Promise.all([
      sql<{ selected_plan: string | null; free_plan: boolean | null; firms: number; mrr: number; paid: number }[]>`
        select f.selected_plan, coalesce(f.free_plan, false) as free_plan, count(*)::int as firms,
               coalesce(sum(f.mrr_inr) filter (where ${sql.unsafe(PAID_NOW)}), 0)::int as mrr,
               (count(*) filter (where ${sql.unsafe(PAID_NOW)}))::int as paid
        from firms f where f.status = 'active'
        group by f.selected_plan, coalesce(f.free_plan, false)
        order by mrr desc, firms desc`,
      sql<{ id: string; name: string; selected_plan: string | null; custom_plan_name: string | null; renews_at: Date }[]>`
        select f.id, f.name, f.selected_plan, f.custom_plan_name, f.renews_at from firms f
        where f.status = 'active' and f.plan_status = 'active' and not coalesce(f.free_plan, false)
          and f.renews_at > now() and f.renews_at <= now() + interval '7 days'
        order by f.renews_at limit 100`,
      sql<{ id: string; name: string; selected_plan: string | null; created_at: Date; owner_email: string | null }[]>`
        select f.id, f.name, f.selected_plan, f.created_at,
               (select u.email from users u where u.firm_id = f.id order by u.created_at limit 1) as owner_email
        from firms f
        where f.status = 'active' and f.plan_status = 'trial' and not coalesce(f.free_plan, false)
          and f.selected_plan in ('advocate', 'chambers', 'law_firm')
          and f.created_at < now() - interval '30 minutes'
          and not exists (select 1 from billing_events e where e.firm_id = f.id and e.kind in ('subscription_active', 'renewed', 'plan_changed'))
        order by f.created_at desc limit 100`,
    ]);
    const mrrInr = mix.reduce((n, r) => n + r.mrr, 0);
    return {
      mrrInr,
      arrInr: mrrInr * 12,
      planMix: mix.map((r) => ({ plan: r.free_plan ? 'free_launch' : r.selected_plan ?? 'none', label: planName(r.selected_plan, null, r.free_plan), firms: r.firms, paidFirms: r.paid, mrrInr: r.mrr })),
      endingSoon: ending.map((r) => ({ firmId: r.id, name: r.name, plan: planName(r.selected_plan, r.custom_plan_name, false), renewsAt: r.renews_at.toISOString() })),
      stuckSignups: stuck.map((r) => ({ firmId: r.id, name: r.name, plan: planName(r.selected_plan, null, false), createdAt: r.created_at.toISOString(), ownerEmail: r.owner_email })),
    };
  },

  async payments(firmId: string): Promise<AdminFirmPayments> {
    const sql = db();
    if (!sql) return { events: [], invoices: [] };
    const [events, invoices] = await Promise.all([
      sql<{ id: string; kind: string; plan: string | null; cycle: string | null; amount_paise: string | null; amount_inr: number | null; provider: string; provider_ref: string | null; note: string | null; created_at: Date }[]>`
        select id, kind, plan, cycle, amount_paise, amount_inr, provider, provider_ref, note, created_at
        from billing_events where firm_id = ${firmId}::uuid order by created_at desc limit 100`,
      subscriptionInvoiceService.listForFirm(firmId),
    ]);
    return {
      events: events.map((e) => ({
        id: e.id, kind: e.kind, plan: e.plan, cycle: e.cycle, provider: e.provider, providerRef: e.provider_ref, note: e.note,
        amountInr: e.amount_paise != null ? Number(e.amount_paise) / 100 : e.amount_inr, createdAt: e.created_at.toISOString(),
      })),
      invoices,
    };
  },

  /** Newest first, 50 a page; `before` = createdAt of the last row seen. */
  async ledger(firmId: string, before?: string): Promise<AdminFirmLedgerPage> {
    const sql = db();
    if (!sql) return { items: [], next: null };
    const cursor = before ? new Date(before) : null;
    if (cursor && Number.isNaN(cursor.getTime())) throw new BadRequestError('Bad cursor');
    const rows = await sql<{ id: string; action: string; credits: string; kind: string; user_name: string | null; created_at: Date }[]>`
      select l.id, l.action, l.credits, l.kind, u.name as user_name, l.created_at
      from credit_ledger l left join users u on u.id = l.user_id
      where l.firm_id = ${firmId}::uuid and (${cursor}::timestamptz is null or l.created_at < ${cursor})
      order by l.created_at desc limit 51`;
    const page = rows.slice(0, 50);
    return {
      items: page.map((r) => ({ id: r.id, action: r.action, credits: Number(r.credits), kind: r.kind, userName: r.user_name, createdAt: r.created_at.toISOString() })),
      next: rows.length > 50 ? page[page.length - 1]!.created_at.toISOString() : null,
    };
  },

  /** Free extension by whole months, so the credit month keeps its day and
   *  no extra plan grant is created. Not for suspended firms. */
  async extend(firmId: string, months: number, reason: string, actor: { id: string; email: string }): Promise<{ renewsAt: string }> {
    const sql = db();
    if (!sql) throw new HttpError(503, 'Database not configured');
    const out = await sql.begin(async (tx) => {
      const [f] = await tx<{ status: string; plan_status: string | null; renews_at: Date | null; free_plan: boolean | null }[]>`
        select status, plan_status, renews_at, free_plan from firms where id = ${firmId}::uuid for update`;
      if (!f) return null;
      if (f.status !== 'active') throw new BadRequestError('Reactivate the firm before extending its plan.', { code: 'firm_suspended' });
      if (f.free_plan || f.plan_status !== 'active' || !f.renews_at) {
        throw new BadRequestError('Only an active paid plan can be extended. Use a custom plan instead.', { code: 'not_extendable' });
      }
      let end = new Date(f.renews_at);
      for (let i = 0; i < months; i++) end = addPeriod(end, 'monthly');
      await tx`update firms set renews_at = ${end} where id = ${firmId}::uuid`;
      return { before: new Date(f.renews_at), end };
    });
    if (!out) throw new NotFoundError('Firm not found');
    invalidatePlanStatusCache();
    await auditService.write({ actorUserId: actor.id, actorEmail: actor.email, action: 'firm.plan.extend', targetType: 'firm', targetId: firmId,
      payload: { months, reason, from: out.before.toISOString(), to: out.end.toISOString() } });
    return { renewsAt: out.end.toISOString() };
  },
};
