/**
 * "Plan active" and renewal reminders on WhatsApp
 * (build-docs/features/app-handoff-and-renewal-reminders.md).
 *
 * Same Wasi sender and template call as the GST invoice (invoice-whatsapp).
 * Goes only to the account owner's OTP-verified WhatsApp number. A template
 * env left empty = that message is off (logged, never an error).
 */
import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { isPaidPlan, PLANS } from '../lib/plans';
import { day } from './invoice-whatsapp.service';
import { whatsappService } from './whatsapp.service';

export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=in.sirahdigital.difai';
const billingUrl = () => `${env.webPublicBaseUrl.replace(/\/$/, '')}/app/billing`;
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export type PlanActiveResult = 'sent' | 'off' | 'not_plan' | 'inactive' | 'no_phone' | 'already_sent' | 'missing';
export type ReminderKind = 'd7' | 'd1' | 'd0';

/** The account owner, only with an OTP-verified WhatsApp number; never a superadmin. */
async function owner(firmId: string): Promise<{ email: string; phone: string } | null> {
  const [o] = await db()!<{ email: string; phone: string }[]>`
    select u.email, u.phone from users u
    where u.firm_id = ${firmId}::uuid and u.role in ('Solo Advocate', 'Managing Partner')
      and u.phone is not null and u.phone_verified_at is not null and not u.is_superadmin
    order by u.created_at limit 1`;
  return o ?? null;
}

/** Reminder for this many IST calendar days left: 7..2 (catches a missed run), 1, 0. */
export function reminderKind(daysLeft: number): ReminderKind | null {
  if (daysLeft === 0) return 'd0';
  if (daysLeft === 1) return 'd1';
  return daysLeft >= 2 && daysLeft <= 7 ? 'd7' : null;
}

export const planWhatsappService = {
  /** "Your plan is active" after a plan payment (its invoice). Once per payment. */
  async sendPlanActive(invoiceId: string): Promise<PlanActiveResult> {
    const sql = db();
    if (!sql) return 'off';
    const template = env.WHATSAPP_PLAN_ACTIVE_TEMPLATE.trim();
    if (!template) return 'off';
    const [inv] = await sql<{ firm_id: string; plan: string; sent: Date | null; plan_status: string | null; renews_at: Date | null; is_demo: boolean }[]>`
      select i.firm_id, i.plan, i.plan_active_wa_sent_at as sent, f.plan_status, f.renews_at, f.is_demo
      from subscription_invoices i join firms f on f.id = i.firm_id where i.id = ${invoiceId}::uuid`;
    if (!inv) return 'missing';
    if (!isPaidPlan(inv.plan)) return 'not_plan'; // Brief Packs, credits, custom (enterprise) plans
    if (inv.sent) return 'already_sent';
    if (inv.plan_status !== 'active' || !inv.renews_at || inv.is_demo) return 'inactive';
    const o = await owner(inv.firm_id);
    if (!o) {
      await sql`update subscription_invoices set plan_active_wa_error = 'No verified WhatsApp number on the account' where id = ${invoiceId}::uuid`;
      return 'no_phone';
    }
    // Claim first: a parallel run (retry, redelivery) finds it taken and sends nothing.
    const [claimed] = await sql`update subscription_invoices set plan_active_wa_sent_at = now(), plan_active_wa_error = null
      where id = ${invoiceId}::uuid and plan_active_wa_sent_at is null returning id`;
    if (!claimed) return 'already_sent';
    try {
      await whatsappService.sendTemplate(o.phone, template, {
        plan_name: PLANS[inv.plan].name, end_date: day(new Date(inv.renews_at)), app_link: PLAY_STORE_URL, account_email: o.email,
      });
    } catch (err) {
      await sql`update subscription_invoices set plan_active_wa_sent_at = null, plan_active_wa_error = ${reason(err)} where id = ${invoiceId}::uuid`;
      throw err; // the job retries
    }
    logger.info({ invoiceId }, 'plan active message sent on WhatsApp');
    return 'sent';
  },

  /** Daily (10:00 IST): 7 days before, 1 day before and on the day renews_at ends.
   *  One per firm + period + kind; a renewal moves renews_at, so nothing is due. */
  async sendRenewalReminders(): Promise<{ sent: number; failed: number }> {
    const sql = db();
    const template = env.WHATSAPP_RENEWAL_TEMPLATE.trim();
    if (!sql || !template) return { sent: 0, failed: 0 };
    const due = await sql<{ id: string; selected_plan: string; renews_at: Date; days_left: number }[]>`
      select f.id, f.selected_plan, f.renews_at,
        ((f.renews_at at time zone 'Asia/Kolkata')::date - (now() at time zone 'Asia/Kolkata')::date)::int as days_left
      from firms f
      where f.plan_status = 'active' and f.renews_at is not null
        and not coalesce(f.free_plan, false) and not coalesce(f.free_launch, false) and not coalesce(f.is_demo, false)
        and f.selected_plan in ('advocate', 'chambers', 'law_firm')
        and f.razorpay_subscription_id is null -- old Autopay plans renew on their own
        and (f.renews_at at time zone 'Asia/Kolkata')::date - (now() at time zone 'Asia/Kolkata')::date between 0 and 7
        and not exists (select 1 from users s where s.firm_id = f.id and s.is_superadmin)`;
    let sent = 0;
    let failed = 0;
    for (const f of due) {
      const kind = reminderKind(f.days_left);
      if (!kind || !isPaidPlan(f.selected_plan)) continue;
      const o = await owner(f.id);
      if (!o) continue;
      const [claimed] = await sql`insert into plan_renewal_reminders (firm_id, period_end, kind, sent_to)
        values (${f.id}::uuid, ${f.renews_at}, ${kind}, ${o.phone}) on conflict do nothing returning firm_id`;
      if (!claimed) continue;
      try {
        await whatsappService.sendTemplate(o.phone, template, {
          plan_name: PLANS[f.selected_plan].name, end_date: day(new Date(f.renews_at)), renew_link: billingUrl(),
        });
        sent++;
      } catch (err) {
        // Release the claim so a later run in the window can try again.
        await sql`delete from plan_renewal_reminders where firm_id = ${f.id}::uuid and period_end = ${f.renews_at} and kind = ${kind}`;
        logger.error({ firmId: f.id, kind, err: reason(err) }, 'renewal reminder not sent on WhatsApp');
        failed++;
      }
    }
    return { sent, failed };
  },
};
