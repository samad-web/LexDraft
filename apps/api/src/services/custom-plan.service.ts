/**
 * Custom (Enterprise) plans and paid credit top-ups recorded by the superadmin
 * against an offline payment (build-docs/features/admin-custom-plan.md).
 *
 * One transaction sets the plan and logs the payment (idempotent on the
 * form's key); then DifAi's GST invoice is issued on the same path as Razorpay
 * payments (exact 18% check kept). Nothing here talks to Razorpay.
 */
import { BadRequestError, HttpError, NotFoundError } from '../lib/errors';
import { db } from '../db/client';
import { auditService } from './audit.service';
import { addPeriod } from './billing.service';
import { creditService } from './credit.service';
import { invalidatePermissionsCache } from './permissions.service';
import { invalidatePlanStatusCache } from './plan-status.service';
import { subscriptionInvoiceService } from './subscription-invoice.service';

export type PaymentMode = 'upi' | 'bank_transfer' | 'cheque' | 'cash';
const MODE_LABEL: Record<PaymentMode, string> = { upi: 'UPI', bank_transfer: 'bank transfer', cheque: 'cheque', cash: 'cash' };

export interface ManualPayment { mode: PaymentMode; reference: string; receivedOn: string }

export interface CustomPlanInput {
  /** Form-generated uuid: a double submit records one plan, one payment, one invoice. */
  key: string;
  name: string;
  seats: number;
  munshiSeats: number;
  creditsPerMonth: number;
  /** Whole rupees for the whole period, GST excluded. 0 = complimentary. */
  priceInr: number;
  cycle: 'monthly' | 'annual' | 'custom';
  startDate: string; // YYYY-MM-DD
  endDate?: string;  // YYYY-MM-DD, custom cycle only
  payment: ManualPayment | null;
}

export interface CustomPlanResult {
  firmId: string; periodStart: string; periodEnd: string; mrrInr: number;
  invoiceId: string | null; invoiceIssued: boolean; duplicate: boolean;
}

const DAY = 86_400_000;
const utcDay = (s: string) => new Date(`${s}T00:00:00Z`);

export function paymentNote(p: ManualPayment): string {
  return `${MODE_LABEL[p.mode]} · Ref ${p.reference.trim()} · received ${p.receivedOn}`;
}

/** Period end and MRR (ex-GST rupees a month) for a custom plan. */
export function customPeriod(i: Pick<CustomPlanInput, 'cycle' | 'startDate' | 'endDate' | 'priceInr'>): { start: Date; end: Date; months: number; mrrInr: number } {
  const start = utcDay(i.startDate);
  if (Number.isNaN(start.getTime())) throw new BadRequestError('Start date is not a date.', { code: 'invalid_dates' });
  let end: Date;
  if (i.cycle === 'custom') {
    if (!i.endDate) throw new BadRequestError('Choose an end date for a custom period.', { code: 'invalid_dates' });
    end = utcDay(i.endDate);
    if (Number.isNaN(end.getTime()) || end.getTime() - start.getTime() < DAY) {
      throw new BadRequestError('The end date must be after the start date.', { code: 'invalid_dates' });
    }
    if (end.getTime() - start.getTime() > 3 * 366 * DAY) throw new BadRequestError('A custom period can be at most 3 years.', { code: 'invalid_dates' });
  } else {
    end = addPeriod(start, i.cycle);
  }
  if (end.getTime() <= Date.now()) throw new BadRequestError('That period has already ended.', { code: 'invalid_dates' });
  const months = i.cycle === 'monthly' ? 1 : i.cycle === 'annual' ? 12 : Math.max(1, Math.round((end.getTime() - start.getTime()) / (30.4375 * DAY)));
  return { start, end, months, mrrInr: Math.round(i.priceInr / months) };
}

export const customPlanService = {
  async apply(firmId: string, i: CustomPlanInput, actor: { id: string; email: string }): Promise<CustomPlanResult> {
    const sql = db();
    if (!sql) throw new HttpError(503, 'Database not configured');
    if (i.priceInr > 0 && !i.payment) throw new BadRequestError('Record how the payment was made.', { code: 'payment_required' });
    const p = customPeriod(i);
    const ref = `manual:${i.key}`;
    const name = i.name.trim();
    const totalPaise = i.priceInr * 118; // price + 18% GST, in paise (whole rupees => exact)
    const note = i.payment ? paymentNote(i.payment) : 'complimentary';

    const out = await sql.begin(async (tx) => {
      const [seen] = await tx<{ id: string }[]>`select id from billing_events where provider_ref = ${ref} limit 1`;
      if (seen) return 'duplicate' as const;
      const [f] = await tx<{ status: string; plan_status: string | null; renews_at: Date | null }[]>`
        select status, plan_status, renews_at from firms where id = ${firmId}::uuid for update`;
      if (!f) return 'missing' as const;
      const wasActive = f.plan_status === 'active' && !!f.renews_at && new Date(f.renews_at) > new Date();
      await tx`
        update firms set
          plan_tier = 'Firm'::firm_plan_tier, plan_status = 'active', free_plan = false, trial_ends_at = null,
          renews_at = ${p.end}, billing_cycle = ${i.cycle === 'monthly' ? 'monthly' : 'annual'},
          selected_plan = 'enterprise', custom_plan_name = ${name}, mrr_inr = ${p.mrrInr},
          munshi_seats = ${i.munshiSeats}, credit_allowance = ${i.creditsPerMonth},
          razorpay_subscription_id = null
        where id = ${firmId}::uuid`;
      // Seats in their own update: the seat-floor trigger raises seats to the
      // tier's floor (Firm = 8) only when the tier changes; a bare seats update
      // is kept as typed (0113), so an Enterprise deal can be any size.
      await tx`update firms set seats = ${i.seats} where id = ${firmId}::uuid`;
      await tx`
        insert into billing_events (firm_id, user_id, kind, plan, cycle, amount_inr, amount_paise, provider, provider_ref, note)
        values (${firmId}::uuid, ${actor.id}::uuid, ${wasActive ? 'plan_changed' : 'subscription_active'}, 'enterprise', ${i.cycle},
          ${Math.round(totalPaise / 100)}, ${totalPaise}, 'manual', ${ref}, ${note})`;
      return 'ok' as const;
    });
    if (out === 'missing') throw new NotFoundError('Firm not found');
    if (out === 'duplicate') {
      return { firmId, periodStart: p.start.toISOString(), periodEnd: p.end.toISOString(), mrrInr: p.mrrInr, invoiceId: null, invoiceIssued: false, duplicate: true };
    }
    invalidatePlanStatusCache();
    invalidatePermissionsCache();
    await creditService.balance(firmId); // opens this cycle's grant at the new allowance

    let invoiceId: string | null = null;
    if (i.priceInr > 0) {
      const adv = `${i.seats} advocate${i.seats === 1 ? '' : 's'}`;
      const mun = i.munshiSeats > 0 ? ` + ${i.munshiSeats} Munshi seat${i.munshiSeats === 1 ? '' : 's'}` : '';
      invoiceId = await subscriptionInvoiceService.issueForPayment({
        firmId, paymentId: ref, amountPaise: totalPaise, taxablePaise: i.priceInr * 100, subscriptionId: null,
        plan: 'enterprise', cycle: i.cycle, seats: i.seats, munshi: i.munshiSeats, periodStart: p.start, periodEnd: p.end,
        lineLabel: `${name} (${adv}${mun}, ${i.creditsPerMonth} AI credits a month)`, paymentNote: note,
      });
    }
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email, action: 'firm.custom_plan.set', targetType: 'firm', targetId: firmId,
      payload: { ...i, periodEnd: p.end.toISOString(), mrrInr: p.mrrInr, invoiceId },
    });
    return { firmId, periodStart: p.start.toISOString(), periodEnd: p.end.toISOString(), mrrInr: p.mrrInr, invoiceId, invoiceIssued: invoiceId != null, duplicate: false };
  },

  /** Admin credit grant, optionally sold for an offline payment (then invoiced). */
  async grantCredits(firmId: string, g: { key: string; amount: number; days: number; note: string; paidInr?: number; payment?: ManualPayment },
    actor: { id: string; email: string }): Promise<{ invoiceId: string | null; duplicate: boolean }> {
    const sql = db();
    if (!sql) throw new HttpError(503, 'Database not configured');
    const paid = (g.paidInr ?? 0) > 0;
    if (paid && !g.payment) throw new BadRequestError('Record how the payment was made.', { code: 'payment_required' });
    const [f] = await sql<{ id: string }[]>`select id from firms where id = ${firmId}::uuid`;
    if (!f) throw new NotFoundError('Firm not found');
    const ref = `admin:${g.key}`;
    const granted = await creditService.addGrant({
      firmId, source: 'admin', amount: g.amount, ref, note: g.note, createdBy: actor.id,
      expiresAt: new Date(Date.now() + g.days * DAY),
    });
    if (!granted) return { invoiceId: null, duplicate: true };
    let invoiceId: string | null = null;
    if (paid) {
      const totalPaise = g.paidInr! * 118;
      const note = paymentNote(g.payment!);
      await sql`
        insert into billing_events (firm_id, user_id, kind, plan, cycle, amount_inr, amount_paise, provider, provider_ref, note)
        values (${firmId}::uuid, ${actor.id}::uuid, 'pack_bought', 'credits', 'one-time', ${Math.round(totalPaise / 100)}, ${totalPaise}, 'manual', ${`manual:${g.key}`}, ${note})
        on conflict do nothing`;
      invoiceId = await subscriptionInvoiceService.issueForPayment({
        firmId, paymentId: `manual:${g.key}`, amountPaise: totalPaise, taxablePaise: g.paidInr! * 100, subscriptionId: null,
        plan: 'credits', cycle: 'one-time', seats: 0, periodStart: null, periodEnd: null,
        lineLabel: `${g.amount} AI credits (valid ${g.days} days)`, paymentNote: note,
      });
    }
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email, action: 'firm.credits.grant', targetType: 'firm', targetId: firmId,
      payload: { amount: g.amount, days: g.days, note: g.note, ref, paidInr: g.paidInr ?? 0, payment: g.payment ?? null, invoiceId },
    });
    return { invoiceId, duplicate: false };
  },
};
