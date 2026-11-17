/**
 * GST invoice on WhatsApp after payment, against real Postgres. Tests map to
 * the acceptance criteria (AC#) in build-docs/features/invoice-whatsapp.md.
 * The Wasi call is mocked: no real WhatsApp message is sent.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    INVOICE_SELLER_LEGAL_NAME: 'M MOHAMED RIYAZ', INVOICE_SELLER_TRADE_NAME: 'SIRAH DIGITAL', INVOICE_SELLER_GSTIN: '33CVVPM9805M1ZO',
    INVOICE_SELLER_ADDRESS: 'Chennai, Tamil Nadu 600044', INVOICE_SAC: '998315', INVOICE_PREFIX: 'DIF',
    WHATSAPP_INVOICE_TEMPLATE: 'difai_invoice', WEB_PUBLIC_BASE_URL: 'https://difai.example',
  });
});
const wa = vi.hoisted(() => ({ calls: [] as Array<{ phone: string; template: string; params: Record<string, string> }>, fail: false }));
vi.mock('../whatsapp.service', () => ({
  whatsappService: {
    sendOtp: async () => undefined,
    sendTemplate: async (phone: string, template: string, params: Record<string, string>) => {
      if (wa.fail) throw new Error('Wasi 400: template not approved');
      wa.calls.push({ phone, template, params });
    },
  },
}));

import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { invoiceWhatsappService } from '../invoice-whatsapp.service';
import { subscriptionInvoiceService } from '../subscription-invoice.service';

let firmId: string;
let ownerId: string;

async function issue(): Promise<string> {
  const id = await subscriptionInvoiceService.issueForPayment({
    firmId, paymentId: `pay_${crypto.randomUUID()}`, amountPaise: 82482, taxablePaise: 69900, subscriptionId: null,
    plan: 'advocate', cycle: 'monthly', seats: 1, periodStart: new Date(), periodEnd: new Date(Date.now() + 30 * 86_400_000),
  });
  return id!;
}
const row = async (id: string) => (await getIntegrationSql()<Array<{ whatsapp_sent_at: Date | null; whatsapp_to: string | null; whatsapp_error: string | null }>>`
  select whatsapp_sent_at, whatsapp_to, whatsapp_error from subscription_invoices where id = ${id}::uuid`)[0]!;

beforeEach(async () => {
  wa.calls.length = 0;
  wa.fail = false;
  firmId = (await seedFirm('WA firm', 'Solo')).id;
  ownerId = (await seedUser(firmId, { role: 'Solo Advocate' })).id;
  await getIntegrationSql()`update users set phone = '+918754200000', phone_verified_at = now(), state = 'Tamil Nadu', name = 'Asha Rao' where id = ${ownerId}::uuid`;
});

describe('AC1 one message with the invoice to the owner', () => {
  it('issuing an invoice sends difai_invoice once, with number, amount, date and a link; recorded on the invoice', async () => {
    const id = await issue();
    await invoiceWhatsappService.send(id); // the job's handler (pg-boss may also have run it in memory mode)
    expect(wa.calls).toHaveLength(1);
    const c = wa.calls[0]!;
    expect(c).toMatchObject({ phone: '+918754200000', template: 'difai_invoice' });
    expect(c.params).toMatchObject({ customer_name: 'Asha Rao', invoice_amount: 'Rs. 824.82' });
    expect(c.params.invoice_number).toMatch(/^DIF\/\d{2}-\d{2}\/\d{6}$/);
    expect(c.params.invoice_link).toMatch(/^https:\/\/difai\.example\/api\/i\/[A-Za-z0-9_-]{32}$/);
    const r = await row(id);
    expect(r.whatsapp_sent_at).not.toBeNull();
    expect(r.whatsapp_to).toBe('+918754200000');
    // A second run (job retry / redelivery) doesn't send again.
    expect(await invoiceWhatsappService.send(id)).toBe('already_sent');
    expect(wa.calls).toHaveLength(1);
  });
});

describe('AC2 the payment never depends on WhatsApp', () => {
  it('a WhatsApp failure still leaves the invoice issued; the error is kept and the job is told to retry', async () => {
    wa.fail = true;
    const id = await issue();
    expect(id).toBeTruthy();
    await expect(invoiceWhatsappService.send(id)).rejects.toThrow(/not approved/);
    expect((await row(id)).whatsapp_error).toMatch(/not approved/);
    wa.fail = false;
    expect(await invoiceWhatsappService.send(id)).toBe('sent');
    expect((await row(id)).whatsapp_error).toBeNull();
  });
});

describe('AC3 no number', () => {
  it('owner without a WhatsApp number: nothing sent, reason recorded', async () => {
    await getIntegrationSql()`update users set phone = null where id = ${ownerId}::uuid`;
    const id = await issue();
    wa.calls.length = 0;
    expect(await invoiceWhatsappService.send(id)).toBe('no_phone');
    expect(wa.calls).toHaveLength(0);
    expect((await row(id)).whatsapp_error).toMatch(/No verified WhatsApp number/);
  });

  it('signup-hardening F7: a number that was never OTP-verified is not used', async () => {
    await getIntegrationSql()`update users set phone_verified_at = null where id = ${ownerId}::uuid`;
    const id = await issue();
    wa.calls.length = 0;
    expect(await invoiceWhatsappService.send(id)).toBe('no_phone');
    expect(wa.calls).toHaveLength(0);
  });
});

describe('AC4 the link', () => {
  it('opens only that invoice, only while live; bad or expired tokens resolve to nothing', async () => {
    const id = await issue();
    const url = await invoiceWhatsappService.createLink(id);
    const token = url.split('/').pop()!;
    expect(await invoiceWhatsappService.resolve(token)).toBe(id);
    expect(await invoiceWhatsappService.resolve('x'.repeat(32))).toBeNull();
    expect(await invoiceWhatsappService.resolve('../../etc')).toBeNull();
    await getIntegrationSql()`update invoice_links set expires_at = now() - interval '1 minute' where invoice_id = ${id}::uuid`;
    expect(await invoiceWhatsappService.resolve(token)).toBeNull();
    // Only the hash is stored.
    const [l] = await getIntegrationSql()<{ token_hash: string }[]>`select token_hash from invoice_links where invoice_id = ${id}::uuid limit 1`;
    expect(l!.token_hash).not.toContain(token);
  });
});

describe('AC5 admin resend', () => {
  it('force resends an already-sent invoice', async () => {
    const id = await issue();
    await invoiceWhatsappService.send(id);
    const before = wa.calls.length;
    expect(await invoiceWhatsappService.send(id, true)).toBe('sent');
    expect(wa.calls.length).toBe(before + 1);
    expect(await invoiceWhatsappService.send('00000000-0000-0000-0000-000000000000', true)).toBe('missing');
  });
});
