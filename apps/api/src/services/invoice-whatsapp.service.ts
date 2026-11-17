/**
 * Send the GST invoice on WhatsApp after payment (build-docs/features/invoice-whatsapp.md).
 *
 * Same sender as the sign-up OTP (Wasi Hub), Utility template `difai_invoice`
 * (WHATSAPP_INVOICE_TEMPLATE; empty = off). Wasi can't attach a per-message PDF
 * yet, so the message carries a 7-day, unguessable link to that one invoice's
 * PDF. Runs as a job: payment and invoice never wait on WhatsApp.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/client';
import { env } from '../env';
import { logger } from '../logger';
import { whatsappService } from './whatsapp.service';

export const INVOICE_LINK_DAYS = 7;
export const hashInvoiceToken = (t: string) => createHash('sha256').update(t).digest('hex');
const inr = (paise: number) => `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

export type InvoiceWhatsappResult = 'sent' | 'off' | 'no_phone' | 'already_sent' | 'missing';

/** Same owner the invoice is billed to (subscription-invoice.service buyer query). */
async function ownerPhone(firmId: string): Promise<{ name: string; phone: string | null } | null> {
  const sql = db()!;
  const [o] = await sql<{ name: string; phone: string | null }[]>`
    select u.name, u.phone from users u
    where u.firm_id = ${firmId}::uuid and u.role in ('Solo Advocate', 'Managing Partner')
    order by u.created_at limit 1`;
  return o ?? null;
}

export const invoiceWhatsappService = {
  /** A fresh link to this invoice's PDF; returns the public URL. */
  async createLink(invoiceId: string): Promise<string> {
    const sql = db()!;
    const token = randomBytes(24).toString('base64url');
    await sql`insert into invoice_links (token_hash, invoice_id, expires_at)
      values (${hashInvoiceToken(token)}, ${invoiceId}::uuid, now() + make_interval(days => ${INVOICE_LINK_DAYS}))`;
    return `${env.webPublicBaseUrl.replace(/\/$/, '')}/api/i/${token}`;
  },

  /** The invoice id behind a live token, or null (unknown / expired). */
  async resolve(token: string): Promise<string | null> {
    const sql = db();
    if (!sql || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
    const [r] = await sql<{ invoice_id: string }[]>`
      select invoice_id from invoice_links where token_hash = ${hashInvoiceToken(token)} and expires_at > now()`;
    return r?.invoice_id ?? null;
  },

  /** Send one invoice. `force` = admin resend. Records sent / error on the invoice. */
  async send(invoiceId: string, force = false): Promise<InvoiceWhatsappResult> {
    const sql = db();
    if (!sql) return 'off';
    const template = env.WHATSAPP_INVOICE_TEMPLATE.trim();
    if (!template) return 'off';
    const [inv] = await sql<{ id: string; firm_id: string; invoice_no: string; total_paise: number; issued_at: Date; whatsapp_sent_at: Date | null; buyer: { name?: string } }[]>`
      select id, firm_id, invoice_no, total_paise, issued_at, whatsapp_sent_at, buyer from subscription_invoices where id = ${invoiceId}::uuid`;
    if (!inv) return 'missing';
    if (inv.whatsapp_sent_at && !force) return 'already_sent';
    const owner = await ownerPhone(inv.firm_id);
    if (!owner?.phone) {
      await sql`update subscription_invoices set whatsapp_error = 'No verified WhatsApp number on the account' where id = ${invoiceId}::uuid`;
      return 'no_phone';
    }
    const link = await invoiceWhatsappService.createLink(invoiceId);
    try {
      await whatsappService.sendTemplate(owner.phone, template, {
        customer_name: (inv.buyer?.name || owner.name || 'there').slice(0, 60),
        invoice_number: inv.invoice_no,
        invoice_amount: inr(inv.total_paise),
        invoice_date: day(new Date(inv.issued_at)),
        invoice_link: link,
      });
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      await sql`update subscription_invoices set whatsapp_error = ${reason} where id = ${invoiceId}::uuid`;
      throw err; // the job retries
    }
    await sql`update subscription_invoices set whatsapp_sent_at = now(), whatsapp_to = ${owner.phone}, whatsapp_error = null
      where id = ${invoiceId}::uuid`;
    logger.info({ invoiceId, invoiceNo: inv.invoice_no }, 'invoice sent on WhatsApp');
    return 'sent';
  },
};
