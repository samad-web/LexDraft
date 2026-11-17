/**
 * "Plan active" + renewal reminders on WhatsApp, against real Postgres. Tests
 * map to the acceptance criteria (AC#) in
 * build-docs/features/app-handoff-and-renewal-reminders.md.
 * The Wasi call is mocked: no real WhatsApp message is sent.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    INVOICE_SELLER_LEGAL_NAME: 'M MOHAMED RIYAZ', INVOICE_SELLER_TRADE_NAME: 'SIRAH DIGITAL', INVOICE_SELLER_GSTIN: '33CVVPM9805M1ZO',
    INVOICE_SELLER_ADDRESS: 'Chennai, Tamil Nadu 600044', INVOICE_SAC: '998315', INVOICE_PREFIX: 'DIF',
    WHATSAPP_PLAN_ACTIVE_TEMPLATE: 'difai_plan_active', WHATSAPP_RENEWAL_TEMPLATE: 'difai_plan_renewal',
    WEB_PUBLIC_BASE_URL: 'https://difai.example',
  });
});
const wa = vi.hoisted(() => ({ calls: [] as Array<{ phone: string; template: string; params: Record<string, string> }>, fail: false }));
vi.mock('../whatsapp.service', () => ({
  whatsappService: {
    sendOtp: async () => undefined,
    sendTemplate: async (phone: string, template: string, params: Record<string, string>) => {
      if (wa.fail) throw new Error('Wasi 400: template paused');
      wa.calls.push({ phone, template, params });
    },
  },
}));

import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../env';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { seedFirm, seedUser } from '../../__tests__/integration-fixtures';
import { PLAY_STORE_URL, planWhatsappService } from '../plan-whatsapp.service';
import { subscriptionInvoiceService } from '../subscription-invoice.service';

const PHONE = '+918754200001';
const DAY = 86_400_000;
let firmId: string;
let ownerId: string;
let ownerEmail: string;
const sql = () => getIntegrationSql();
const active = () => wa.calls.filter((c) => c.template === 'difai_plan_active');
const reminders = () => wa.calls.filter((c) => c.template === 'difai_plan_renewal' && c.phone === PHONE);

/** The firm on a paid plan ending in `days` (IST noon, so the day count is exact). */
async function paidUntil(days: number, plan = 'advocate') {
  const end = new Date(Date.now() + days * DAY);
  const ist = new Date(end.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  await sql()`update firms set plan_status = 'active', free_plan = false, free_launch = false, is_demo = false,
    selected_plan = ${plan}, renews_at = ${`${ist}T12:00:00+05:30`}::timestamptz, razorpay_subscription_id = null where id = ${firmId}::uuid`;
}

async function issue(plan = 'advocate', cycle = 'monthly'): Promise<string> {
  const pack = plan.startsWith('pack_');
  const id = await subscriptionInvoiceService.issueForPayment({
    firmId, paymentId: `pay_${crypto.randomUUID()}`, amountPaise: pack ? 50622 : 82482, taxablePaise: pack ? 42900 : 69900, subscriptionId: null,
    plan, cycle, seats: pack ? 0 : 1, periodStart: pack ? null : new Date(), periodEnd: pack ? null : new Date(Date.now() + 30 * DAY),
  });
  return id!;
}

beforeEach(async () => {
  wa.calls.length = 0;
  wa.fail = false;
  env.WHATSAPP_PLAN_ACTIVE_TEMPLATE = 'difai_plan_active';
  env.WHATSAPP_RENEWAL_TEMPLATE = 'difai_plan_renewal';
  // Only this file's firm may have the test number, so reminder counts are exact.
  await sql()`update users set phone = null where phone = ${PHONE}`;
  firmId = (await seedFirm('Plan WA firm', 'Solo')).id;
  const u = await seedUser(firmId, { role: 'Solo Advocate' });
  ownerId = u.id;
  ownerEmail = u.email;
  await sql()`update users set phone = ${PHONE}, phone_verified_at = now(), state = 'Tamil Nadu' where id = ${ownerId}::uuid`;
  await paidUntil(30);
});

describe('AC2 "plan active" message after a plan payment', () => {
  it('sends plan name, end date, Play link and the sign-in email to the verified number, once per payment', async () => {
    const id = await issue();
    const r = await planWhatsappService.sendPlanActive(id); // the job's handler (may already have run inline)
    expect(['sent', 'already_sent']).toContain(r);
    expect(active()).toHaveLength(1);
    expect(active()[0]).toMatchObject({ phone: PHONE });
    expect(active()[0]!.params).toMatchObject({ plan_name: 'Advocate', app_link: PLAY_STORE_URL, account_email: ownerEmail });
    expect(active()[0]!.params.end_date).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}$/);
    // Retry / redelivery: nothing more.
    expect(await planWhatsappService.sendPlanActive(id)).toBe('already_sent');
    expect(active()).toHaveLength(1);
    // A second plan payment (renewal) gets its own message.
    const id2 = await issue();
    await planWhatsappService.sendPlanActive(id2);
    expect(active()).toHaveLength(2);
  });

  it('not for Brief Packs', async () => {
    const id = await issue('pack_25', 'one-time');
    expect(await planWhatsappService.sendPlanActive(id)).toBe('not_plan');
    expect(active()).toHaveLength(0);
  });

  it('a send failure is recorded, never breaks the invoice, and a retry sends it', async () => {
    wa.fail = true;
    const id = await issue();
    expect(id).toBeTruthy();
    await expect(planWhatsappService.sendPlanActive(id)).rejects.toThrow(/paused/);
    const [row] = await sql()<{ plan_active_wa_sent_at: Date | null; plan_active_wa_error: string | null }[]>`
      select plan_active_wa_sent_at, plan_active_wa_error from subscription_invoices where id = ${id}::uuid`;
    expect(row!.plan_active_wa_sent_at).toBeNull();
    expect(row!.plan_active_wa_error).toMatch(/paused/);
    wa.fail = false;
    expect(await planWhatsappService.sendPlanActive(id)).toBe('sent');
    expect(active()).toHaveLength(1);
  });

  it('no verified number: nothing sent, reason recorded', async () => {
    await sql()`update users set phone_verified_at = null where id = ${ownerId}::uuid`;
    const id = await issue();
    wa.calls.length = 0;
    expect(await planWhatsappService.sendPlanActive(id)).toBe('no_phone');
    expect(active()).toHaveLength(0);
  });

  it('template not configured: off, no send, no error', async () => {
    env.WHATSAPP_PLAN_ACTIVE_TEMPLATE = '';
    const id = await issue();
    expect(await planWhatsappService.sendPlanActive(id)).toBe('off');
    expect(active()).toHaveLength(0);
  });
});

describe('AC3 renewal reminders', () => {
  it.each([[7, 'd7'], [1, 'd1'], [0, 'd0']])('%i days left: one reminder (%s), never twice in the same period', async (days, kind) => {
    await paidUntil(days, 'chambers');
    await planWhatsappService.sendRenewalReminders();
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]!.params).toMatchObject({ plan_name: 'Chambers', renew_link: 'https://difai.example/app/billing' });
    const [r] = await sql()<{ kind: string }[]>`select kind from plan_renewal_reminders where firm_id = ${firmId}::uuid`;
    expect(r!.kind).toBe(kind);
    await planWhatsappService.sendRenewalReminders();
    expect(reminders()).toHaveLength(1);
  });

  it('not outside the window (8 days left, ended yesterday)', async () => {
    await paidUntil(8);
    await planWhatsappService.sendRenewalReminders();
    await paidUntil(-1);
    await planWhatsappService.sendRenewalReminders();
    expect(reminders()).toHaveLength(0);
  });

  it('skipped once renewed: renews_at moved later', async () => {
    await paidUntil(7);
    await planWhatsappService.sendRenewalReminders();
    expect(reminders()).toHaveLength(1);
    await paidUntil(37); // paid again: a new period, nothing due yet
    await planWhatsappService.sendRenewalReminders();
    expect(reminders()).toHaveLength(1);
  });

  it('skipped for free-launch, demo, enterprise custom, Autopay, superadmin and unverified-number firms', async () => {
    const cases = [
      () => sql()`update firms set free_launch = true where id = ${firmId}::uuid`,
      () => sql()`update firms set is_demo = true where id = ${firmId}::uuid`,
      () => sql()`update firms set selected_plan = 'enterprise' where id = ${firmId}::uuid`,
      () => sql()`update firms set razorpay_subscription_id = 'sub_test' where id = ${firmId}::uuid`,
      () => sql()`update users set is_superadmin = true where id = ${ownerId}::uuid`,
      () => sql()`update users set phone_verified_at = null where id = ${ownerId}::uuid`,
    ];
    for (const change of cases) {
      await paidUntil(1);
      await sql()`update users set is_superadmin = false, phone_verified_at = now() where id = ${ownerId}::uuid`;
      await change();
      await planWhatsappService.sendRenewalReminders();
    }
    expect(reminders()).toHaveLength(0);
  });

  it('a failed send is not recorded, so a later run can retry; template off sends nothing', async () => {
    await paidUntil(5);
    wa.fail = true;
    expect((await planWhatsappService.sendRenewalReminders()).failed).toBeGreaterThanOrEqual(1);
    wa.fail = false;
    await planWhatsappService.sendRenewalReminders();
    expect(reminders()).toHaveLength(1);
    env.WHATSAPP_RENEWAL_TEMPLATE = '';
    await paidUntil(1);
    expect(await planWhatsappService.sendRenewalReminders()).toEqual({ sent: 0, failed: 0 });
  });
});
