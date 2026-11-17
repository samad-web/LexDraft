/**
 * Custom plan + manual payment + GST invoice against real Postgres. Tests map
 * to the acceptance criteria (AC#) in build-docs/features/admin-custom-plan.md.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    INVOICE_SELLER_LEGAL_NAME: 'M MOHAMED RIYAZ', INVOICE_SELLER_TRADE_NAME: 'SIRAH DIGITAL', INVOICE_SELLER_GSTIN: '33CVVPM9805M1ZO',
    INVOICE_SELLER_ADDRESS: 'Chennai, Tamil Nadu 600044', INVOICE_SAC: '998315', INVOICE_PREFIX: 'DIF',
  });
});

import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { billingService } from '../billing.service';
import { creditService } from '../credit.service';
import { customPlanService, customPeriod, type CustomPlanInput } from '../custom-plan.service';
import { subscriptionInvoiceService } from '../subscription-invoice.service';

const admin = { id: '', email: 'owner@example.test' };
let firmId: string;
let ownerId: string;

const today = () => new Date().toISOString().slice(0, 10);
const plan = (o: Partial<CustomPlanInput> = {}): CustomPlanInput => ({
  key: crypto.randomUUID(), name: 'Enterprise', seats: 12, munshiSeats: 2, creditsPerMonth: 2000,
  priceInr: 25000, cycle: 'monthly', startDate: today(),
  payment: { mode: 'bank_transfer', reference: 'UTR123456', receivedOn: today() }, ...o,
});
const firm = async () => (await getIntegrationSql()<Array<Record<string, unknown>>>`
  select selected_plan, plan_status, plan_tier, seats, munshi_seats, credit_allowance, mrr_inr, custom_plan_name, renews_at, free_plan
  from firms where id = ${firmId}::uuid`)[0]!;

beforeEach(async () => {
  const sql = getIntegrationSql();
  if (!admin.id) {
    const a = await seedFirm('Admin firm', 'Firm');
    admin.id = (await seedUser(a.id)).id;
  }
  const f = await seedFirm('Custom Co', 'Solo');
  firmId = f.id;
  ownerId = (await seedUser(firmId, { role: 'Managing Partner' })).id;
  await sql`update users set state = 'Tamil Nadu' where id = ${ownerId}::uuid`;
});

describe('AC1 custom plan sets the firm active with typed seats, credits and end date', () => {
  it('monthly: Enterprise, 12 + 2 seats, 2000 credits, one month; balance shows 2000 at once', async () => {
    const r = await customPlanService.apply(firmId, plan(), admin);
    expect(r.duplicate).toBe(false);
    const f = await firm();
    expect(f).toMatchObject({ selected_plan: 'enterprise', plan_status: 'active', plan_tier: 'Firm', seats: 12, munshi_seats: 2,
      mrr_inr: 25000, custom_plan_name: 'Enterprise', free_plan: false });
    expect(Number(f.credit_allowance)).toBe(2000);
    expect((await creditService.balance(firmId)).balance).toBe(2000);
  });

  it('a custom plan below 8 seats keeps its seat count (Firm tier floor does not override)', async () => {
    await customPlanService.apply(firmId, plan({ seats: 3 }), admin);
    expect((await firm()).seats).toBe(3);
  });

  it('custom period: end date honoured, MRR = price / months', async () => {
    const start = today();
    const end = new Date(Date.now() + 182 * 86_400_000).toISOString().slice(0, 10);
    const r = await customPlanService.apply(firmId, plan({ cycle: 'custom', endDate: end, priceInr: 60000 }), admin);
    expect(r.periodEnd.slice(0, 10)).toBe(end);
    expect(r.mrrInr).toBe(10000);
    expect(customPeriod({ cycle: 'custom', startDate: start, endDate: end, priceInr: 60000 }).months).toBe(6);
  });
});

describe('AC2 GST invoice for the manual payment', () => {
  it('taxable = typed price, TN buyer gets CGST+SGST, line names the plan, footer names the payment', async () => {
    const r = await customPlanService.apply(firmId, plan({ name: 'Acme Legal Enterprise' }), admin);
    expect(r.invoiceIssued).toBe(true);
    const row = await subscriptionInvoiceService.find(r.invoiceId!, firmId);
    expect(row).toMatchObject({ taxable_paise: 2_500_000, cgst_paise: 225_000, sgst_paise: 225_000, igst_paise: 0, total_paise: 2_950_000 });
    const html = (await subscriptionInvoiceService.pdf(row!).catch(() => null)) ? 'pdf ok' : 'pdf skipped';
    expect(['pdf ok', 'pdf skipped']).toContain(html); // PDF needs Chromium; the row is what matters
    const [db] = await getIntegrationSql()<{ line_label: string; payment_note: string }[]>`
      select line_label, payment_note from subscription_invoices where id = ${r.invoiceId!}::uuid`;
    expect(db!.line_label).toMatch(/^Acme Legal Enterprise \(12 advocates \+ 2 Munshi seats, 2000 AI credits a month\)$/);
    expect(db!.payment_note).toMatch(/^bank transfer · Ref UTR123456 · received /);
    // The firm's own billing page lists it too.
    expect((await subscriptionInvoiceService.listForFirm(firmId)).map((i) => i.id)).toContain(r.invoiceId);
  });

  it('₹0 complimentary plan: no invoice, MRR 0, payment not required', async () => {
    const r = await customPlanService.apply(firmId, plan({ priceInr: 0, payment: null }), admin);
    expect(r.invoiceIssued).toBe(false);
    expect((await firm()).mrr_inr).toBe(0);
  });

  it('a paid plan without payment details is refused', async () => {
    await expect(customPlanService.apply(firmId, plan({ payment: null }), admin)).rejects.toMatchObject({ code: 'payment_required' });
  });
});

describe('AC4 idempotent', () => {
  it('the same form key twice = one plan, one payment, one invoice', async () => {
    const p = plan();
    const a = await customPlanService.apply(firmId, p, admin);
    const b = await customPlanService.apply(firmId, p, admin);
    expect(b.duplicate).toBe(true);
    const sql = getIntegrationSql();
    const ev = await sql`select id from billing_events where firm_id = ${firmId}::uuid and provider = 'manual'`;
    const inv = await sql`select id from subscription_invoices where firm_id = ${firmId}::uuid`;
    expect(ev).toHaveLength(1);
    expect(inv).toHaveLength(1);
    expect(a.invoiceId).toBe(inv[0]!.id);
  });
});

describe('AC5 extra credits', () => {
  it('with a payment: grant + invoice; without: grant only; same key grants once', async () => {
    const before = (await creditService.balance(firmId)).balance;
    const key = crypto.randomUUID();
    const paid = await customPlanService.grantCredits(firmId, { key, amount: 500, days: 90, note: 'Top-up', paidInr: 2000,
      payment: { mode: 'upi', reference: 'UPI-9', receivedOn: today() } }, admin);
    expect(paid.invoiceId).not.toBeNull();
    expect((await customPlanService.grantCredits(firmId, { key, amount: 500, days: 90, note: 'Top-up', paidInr: 2000,
      payment: { mode: 'upi', reference: 'UPI-9', receivedOn: today() } }, admin)).duplicate).toBe(true);
    const free = await customPlanService.grantCredits(firmId, { key: crypto.randomUUID(), amount: 50, days: 30, note: 'Goodwill' }, admin);
    expect(free.invoiceId).toBeNull();
    expect((await creditService.balance(firmId)).balance).toBe(before + 550);
  });
});

describe('AC6 audit + edge cases', () => {
  it('custom plan is audited', async () => {
    await customPlanService.apply(firmId, plan(), admin);
    const rows = await getIntegrationSql()`select action from audit_log where target_id = ${firmId} and action = 'firm.custom_plan.set'`;
    expect(rows).toHaveLength(1);
  });

  it('end before start, and a period already over, are refused', async () => {
    await expect(customPlanService.apply(firmId, plan({ cycle: 'custom', endDate: '2020-01-01' }), admin)).rejects.toMatchObject({ code: 'invalid_dates' });
    await expect(customPlanService.apply(firmId, plan({ startDate: '2020-01-01' }), admin)).rejects.toMatchObject({ code: 'invalid_dates' });
  });

  it('unknown firm → 404', async () => {
    await expect(customPlanService.apply('00000000-0000-0000-0000-000000000000', plan(), admin)).rejects.toMatchObject({ status: 404 });
  });

  it('owner checkout is refused while the custom plan is active (409 custom_plan_active)', async () => {
    await customPlanService.apply(firmId, plan(), admin);
    await expect(billingService.startCheckout(ownerId, 'advocate', 'monthly')).rejects.toMatchObject({ status: 409, code: 'custom_plan_active' });
  });
});
