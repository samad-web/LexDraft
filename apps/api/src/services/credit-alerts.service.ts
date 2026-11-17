/**
 * Low-credit warnings (build-docs/features/credits-not-pages.md): when a firm's
 * pool drops to <= 20% of the month's allowance, and when it reaches 0, the
 * owner gets one bell notice and one WhatsApp (template WHATSAPP_CREDITS_TEMPLATE,
 * empty = bell only) per level per plan month. Best-effort: never throws.
 */
import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { creditService } from './credit.service';
import { notificationsStore } from './notifications.service';
import { whatsappService } from './whatsapp.service';

export type LowLevel = '20' | '0';

/** Which warning applies, if any (balance and allowance in credits). */
export function lowLevel(balance: number, allowance: number): LowLevel | null {
  if (balance <= 0) return '0';
  if (allowance > 0 && balance <= allowance * 0.2) return '20';
  return null;
}

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : 'your next plan date');

export const creditAlerts = {
  /** Check one firm after a charge. Returns the level sent, or null. */
  async check(firmId: string | null): Promise<LowLevel | null> {
    const sql = db();
    if (!sql || !firmId) return null;
    try {
      const b = await creditService.balance(firmId);
      if (b.unlimited) return null;
      const level = lowLevel(b.balance, b.allowance);
      if (!level) return null;
      const [owner] = await sql<{ id: string; name: string; phone: string | null }[]>`
        select id, name, phone from users
        where firm_id = ${firmId}::uuid and role in ('Solo Advocate', 'Managing Partner') and status = 'active'
        order by created_at limit 1`;
      if (!owner) return null;
      const dedupeKey = `credits-low:${b.resetsAt ?? 'none'}:${level}`;
      const [seen] = await sql`select 1 from notifications where user_id = ${owner.id}::uuid and dedupe_key = ${dedupeKey} limit 1`;
      if (seen) return null; // once per level per plan month
      const left = Math.max(0, b.balance);
      await notificationsStore.create({
        firmId, userId: owner.id, tone: level === '0' ? 'vermillion' : 'amber', icon: 'alert', view: 'billing', dedupeKey,
        title: level === '0' ? 'AI credits are over' : `AI credits running low: ${left} left`,
        body: level === '0'
          ? `Buy credits in Plan & Billing to keep drafting. Plan credits renew on ${day(b.resetsAt)}.`
          : `${left} of ${b.allowance} credits left this month. Buy credits in Plan & Billing to avoid a break.`,
      });
      const template = env.WHATSAPP_CREDITS_TEMPLATE.trim();
      if (template && owner.phone) {
        await whatsappService.sendTemplate(owner.phone, template, {
          customer_name: owner.name.slice(0, 60) || 'there',
          credits_left: String(left),
          renew_date: day(b.resetsAt),
        }).catch((err: unknown) => logger.warn({ err, firmId }, 'low-credit WhatsApp not sent'));
      }
      return level;
    } catch (err) {
      logger.warn({ err, firmId }, 'low-credit check failed');
      return null;
    }
  },
};
