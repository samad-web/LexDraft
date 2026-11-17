/**
 * End-to-end account creation against real Postgres and real HTTP routes:
 * Google -> WhatsApp OTP -> sign-up (+ Terms) -> /onboarding -> Razorpay order
 * -> signed payment.captured webhook -> plan applied -> app opens.
 * Docs: paid-signup-gate.md, pricing-v5.md, manual-renewal.md, terms-consent.md,
 * seat-enforcement.md, invoice-whatsapp.md, credits-not-pages.md.
 *
 * External services are stubbed: Google ID-token check, WhatsApp (Wasi),
 * Razorpay REST (fetch), pg-boss jobs, email MX check. Nothing leaves the box.
 *
 * Acceptance tests for build-docs/features/signup-hardening.md (F1-F7): each
 * describe names the finding it covers.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    RAZORPAY_KEY_ID: 'rzp_test_signupflow', RAZORPAY_KEY_SECRET: 'rzp-secret-signupflow', RAZORPAY_WEBHOOK_SECRET: 'whsec-signupflow',
    INVOICE_SELLER_LEGAL_NAME: 'M MOHAMED RIYAZ', INVOICE_SELLER_TRADE_NAME: 'SIRAH DIGITAL', INVOICE_SELLER_GSTIN: '33CVVPM9805M1ZO',
    INVOICE_SELLER_ADDRESS: 'Chennai, Tamil Nadu 600044', INVOICE_SAC: '998315', INVOICE_PREFIX: 'DIF',
    WEB_PUBLIC_BASE_URL: 'https://difai.example', GOOGLE_CLIENT_IDS: 'test-client',
  });
});
const otp = vi.hoisted(() => ({ last: new Map<string, string>() }));
const queued = vi.hoisted(() => ({ jobs: [] as Array<{ name: string; data: unknown }> }));
vi.mock('../../services/whatsapp.service', () => ({
  whatsappService: {
    sendOtp: async (phone: string, code: string) => { otp.last.set(phone, code); },
    sendTemplate: async () => undefined,
  },
}));
vi.mock('../../services/jobs.service', () => ({
  jobs: {
    enqueue: async (name: string, data: unknown) => { queued.jobs.push({ name, data }); return 'job'; },
    register: () => undefined,
    start: async () => undefined,
  },
}));
// "cred:<sub>:<email>" stands in for a Google ID token.
vi.mock('../../lib/google-id-token', () => ({
  verifyGoogleIdToken: async (c: string) => {
    const [, sub, email] = c.split(':');
    return { sub, email, name: 'Asha Rao', emailVerified: true };
  },
}));
vi.mock('../../lib/email-check', async (orig) => ({ ...(await orig<object>()), assertDeliverableEmail: async () => undefined }));

import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../env';
import { getIntegrationSql } from '../../__tests__/integration-db';
import { authRouter } from '../auth.routes';
import { onboardingRouter } from '../onboarding.routes';
import { billingRouter } from '../billing.routes';
import { invitationsRouter } from '../invitations.routes';
import { meDpdpRouter } from '../me-dpdp.routes';
import { TERMS_VERSION } from '../../lib/legal';
import { requireAuth } from '../../middleware/auth';
import { requireActivePlan } from '../../middleware/requireActivePlan';
import { errorHandler } from '../../middleware/error';
import { authService } from '../../services/auth.service';
import { creditService } from '../../services/credit.service';
import { paymentsEnabled } from '../../services/billing.service';
import { invalidatePlanStatusCache } from '../../services/plan-status.service';
import { invalidatePermissionsCache } from '../../services/permissions.service';

const sql = () => getIntegrationSql();
const realFetch = globalThis.fetch;
const orders = new Map<string, { amount: number; notes: Record<string, string> }>();

let server: Server;
let base = '';
beforeAll(async () => {
  // Razorpay REST is answered here; everything else (our own server) is real.
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith('https://api.razorpay.com/')) return realFetch(url, init);
    const path = u.replace('https://api.razorpay.com/v1', '');
    if (path === '/orders' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { amount: number; notes: Record<string, string> };
      const id = `order_${crypto.randomBytes(7).toString('hex')}`;
      orders.set(id, { amount: body.amount, notes: body.notes });
      return new Response(JSON.stringify({ id, amount: body.amount }), { status: 200 });
    }
    const m = /^\/orders\/(order_\w+)$/.exec(path);
    if (m && orders.has(m[1]!)) return new Response(JSON.stringify(orders.get(m[1]!)), { status: 200 });
    return new Response('{"error":{"description":"not stubbed"}}', { status: 400 });
  });
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = buf; } }));
  app.use('/auth', authRouter);
  app.use('/onboarding', requireAuth, onboardingRouter);
  app.use('/billing', billingRouter);
  app.use('/invitations', invitationsRouter);
  app.use('/me/dpdp', requireAuth, meDpdpRouter);
  // Stands in for every feature route (same middleware chain as routes/index.ts).
  app.get('/app-probe', requireAuth, requireActivePlan, (_req, res) => { res.json({ ok: true }); });
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => { queued.jobs.length = 0; invalidatePlanStatusCache(); invalidatePermissionsCache(); });

async function call(method: string, path: string, body?: unknown, tok?: string, headers: Record<string, string> = {}) {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const probe = (tok: string) => { invalidatePlanStatusCache(); return call('GET', '/app-probe', undefined, tok); };

/** Razorpay-signed payment.captured for one of our orders. */
async function capture(orderId: string, opts: { eventId?: string; paymentId?: string } = {}) {
  const o = orders.get(orderId)!;
  const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: {
    id: opts.paymentId ?? `pay_${crypto.randomBytes(7).toString('hex')}`, order_id: orderId, amount: o.amount, status: 'captured' } } } });
  const sig = crypto.createHmac('sha256', 'whsec-signupflow').update(raw).digest('hex');
  return call('POST', '/billing/webhook', raw, undefined, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': opts.eventId ?? `evt_${crypto.randomBytes(6).toString('hex')}` });
}
const orderIdOf = (checkoutUrl: string) => /\/api\/billing\/pay\/(order_\w+)$/.exec(checkoutUrl)![1]!;

/** Google sign-up token with a verified phone, as /auth/signup/otp/verify returns. */
const verifiedToken = (sub: string, email: string, phone: string) => jwt.sign(
  { purpose: 'google-signup', google: { sub, email, name: 'Asha Rao' }, phone }, `${env.JWT_SECRET}:google-signup`, { expiresIn: '10m' });
async function serviceSignup(n: number, role: 'solo' | 'group' | 'firm') {
  const email = `owner${n}@signupflow.test`;
  const r = await authService.googleSignUp({ signupToken: verifiedToken(`g-${n}`, email, `+9198765${String(10000 + n).slice(-5)}`), password: 'longenough1', role } as never);
  return { ...r, email };
}
async function firmOf(userId: string) {
  const [f] = await sql()<any[]>`select f.*, u.role, u.onboarded_at from firms f join users u on u.firm_id = f.id where u.id = ${userId}::uuid`;
  return f;
}

describe('sign-up -> onboarding -> payment -> app (Advocate)', () => {
  it('runs end to end through the HTTP routes with the documented state at every step', async () => {
    expect(paymentsEnabled()).toBe(true);
    const phone = '+919876500001';
    // 1. Google: unknown account -> sign-up token.
    const g = await call('POST', '/auth/google', { credential: 'cred:g-flow1:asha.flow@signupflow.test', intent: 'signup' });
    expect(g.status).toBe(200);
    expect(g.json.signupRequired).toBe(true);
    // Sign-up before the phone is verified is refused.
    const early = await call('POST', '/auth/google/sign-up', { signupToken: g.json.signupToken, password: 'longenough1', role: 'solo', acceptTerms: true });
    expect(early.status).toBe(401);
    // 2. WhatsApp OTP.
    const sent = await call('POST', '/auth/signup/otp/send', { signupToken: g.json.signupToken, phone: '9876500001' });
    expect(sent.status).toBe(200);
    const wrong = await call('POST', '/auth/signup/otp/verify', { signupToken: g.json.signupToken, challengeId: sent.json.challengeId, code: otp.last.get(phone) === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(401);
    const ver = await call('POST', '/auth/signup/otp/verify', { signupToken: g.json.signupToken, challengeId: sent.json.challengeId, code: otp.last.get(phone) });
    expect(ver.status).toBe(200);
    // 3. Terms are required by the server.
    const noTerms = await call('POST', '/auth/google/sign-up', { signupToken: ver.json.signupToken, password: 'longenough1', role: 'solo' });
    expect(noTerms.status).toBe(400);
    const su = await call('POST', '/auth/google/sign-up', { signupToken: ver.json.signupToken, password: 'longenough1', role: 'solo', acceptTerms: true, intent: 'paid', plan: 'law_firm' });
    expect(su.status).toBe(201);
    expect(su.json.user.needsOnboarding).toBe(true);
    expect(su.json.user.needsTermsAcceptance).toBeFalsy();
    const tok = su.json.token as string;
    const userId = su.json.user.id as string;
    const [u] = await sql()<any[]>`select phone, phone_verified_at, role from users where id = ${userId}::uuid`;
    expect(u.phone).toBe(phone);
    expect(u.phone_verified_at).not.toBeNull();
    const [consent] = await sql()<any[]>`select count(*)::int as n from consent_log where user_id = ${userId}::uuid and consent_type = 'terms_privacy' and granted`;
    expect(consent.n).toBe(1);
    let f = await firmOf(userId);
    // F2/F7: every new firm is Solo, 1 seat, no trial clock, not free, not onboarded.
    expect(f).toMatchObject({ plan_status: 'trial', plan_tier: 'Solo', seats: 1, free_plan: false, trial_ends_at: null, onboarded_at: null });
    // 4. App closed before onboarding.
    expect((await probe(tok)).json.code).toBe('onboarding_required');
    // 5. Onboarding: plan pick -> one Razorpay order for the exact price.
    const ob = await call('POST', '/onboarding/complete', { plan: 'advocate', cycle: 'monthly' }, tok);
    expect(ob.status).toBe(200);
    expect(ob.json.checkoutUrl).toMatch(/\/api\/billing\/pay\/order_/);
    const orderId = orderIdOf(ob.json.checkoutUrl);
    expect(orders.get(orderId)!.amount).toBe(82482);
    expect(orders.get(orderId)!.notes).toMatchObject({ kind: 'plan', plan: 'advocate', cycle: 'monthly', seats: '1', munshi: '0' });
    f = await firmOf(userId);
    expect(f.plan_status).toBe('trial');
    expect(f.role).toBe('Solo Advocate');
    const windowMin = (new Date(f.trial_ends_at).getTime() - Date.now()) / 60_000;
    expect(windowMin).toBeGreaterThan(28);
    expect(windowMin).toBeLessThanOrEqual(30);
    // Within the 30-minute window the app answers, but no AI credits until paid.
    const inWindow = await probe(tok);
    expect(inWindow.status).toBe(200);
    expect((await creditService.balance(f.id)).balance).toBe(0);
    expect((await call('POST', '/onboarding/complete', { plan: 'advocate' }, tok)).status).toBe(400); // no second onboarding
    // 6. Webhook applies the plan.
    const paymentId = `pay_${crypto.randomBytes(7).toString('hex')}`;
    const wh = await capture(orderId, { paymentId, eventId: 'evt_flow1' });
    expect(wh.status).toBe(200);
    f = await firmOf(userId);
    expect(f).toMatchObject({ plan_status: 'active', plan_tier: 'Solo', seats: 1, munshi_seats: 0, selected_plan: 'advocate', billing_cycle: 'monthly', free_plan: false, mrr_inr: 699 });
    expect(f.trial_ends_at).toBeNull();
    const days = (new Date(f.renews_at).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(27);
    expect(days).toBeLessThan(32);
    const [inv] = await sql()<any[]>`select count(*)::int as n, max(total_paise) as total, max(taxable_paise) as taxable from subscription_invoices where firm_id = ${f.id}::uuid`;
    expect(inv).toMatchObject({ n: 1, total: 82482, taxable: 69900 });
    expect(queued.jobs.filter((j) => j.name === 'invoice.whatsapp')).toHaveLength(1);
    // 7. Credits appear on first use; app open.
    expect((await creditService.balance(f.id))).toMatchObject({ balance: 150, allowance: 150 });
    expect((await probe(tok)).status).toBe(200);
    const st = await call('GET', '/billing', undefined, tok);
    expect(st.json.current.subscribed).toBe(true);
    // 8. Redelivery: nothing changes.
    const renewsAt = new Date(f.renews_at).getTime();
    expect((await capture(orderId, { paymentId, eventId: 'evt_flow1' })).status).toBe(200);
    expect((await capture(orderId, { paymentId, eventId: 'evt_flow1_retry_new_id' })).status).toBe(200);
    const after = await firmOf(userId);
    expect(new Date(after.renews_at).getTime()).toBe(renewsAt);
    const [ev] = await sql()<any[]>`select count(*)::int as n from billing_events where firm_id = ${f.id}::uuid and kind in ('subscription_active','renewed','plan_changed')`;
    expect(ev.n).toBe(1);
    const [inv2] = await sql()<any[]>`select count(*)::int as n from subscription_invoices where firm_id = ${f.id}::uuid`;
    expect(inv2.n).toBe(1);
  });

  it('a payment of the wrong amount is not applied', async () => {
    const r = await serviceSignup(2, 'solo');
    const ob = await call('POST', '/onboarding/complete', { plan: 'advocate', cycle: 'monthly' }, r.token);
    const orderId = orderIdOf(ob.json.checkoutUrl);
    orders.get(orderId)!.amount = 100; // tampered
    expect((await capture(orderId)).status).toBe(200);
    expect((await firmOf(r.user.id)).plan_status).toBe('trial');
  });
});

describe('plan -> seats / credits / tier / role (pricing v5 table 1)', () => {
  it.each([
    ['chambers', 'annual', 2, 3, 350, 'Practice', 'Managing Partner'],
    ['law_firm', 'monthly', 1, 8, 750, 'Firm', 'Managing Partner'],
  ] as const)('%s %s + %i Munshi', async (plan, cycle, munshi, seats, credits, tier, role) => {
    const r = await serviceSignup(plan === 'chambers' ? 3 : 4, 'solo');
    const noFirm = await call('POST', '/onboarding/complete', { plan, cycle, munshi }, r.token);
    expect(noFirm.status).toBe(400); // firm name required for a team plan
    const ob = await call('POST', '/onboarding/complete', { plan, cycle, munshi, firm: `Rao ${plan}` }, r.token);
    expect(ob.status).toBe(200);
    // F7: nothing unlocked before the payment: Solo tier, 1 seat.
    expect(await firmOf(r.user.id)).toMatchObject({ plan_tier: 'Solo', seats: 1, plan_status: 'trial' });
    const orderId = orderIdOf(ob.json.checkoutUrl);
    expect((await capture(orderId)).status).toBe(200);
    const f = await firmOf(r.user.id);
    expect(f).toMatchObject({ plan_status: 'active', plan_tier: tier, seats, munshi_seats: munshi, selected_plan: plan, role, name: `Rao ${plan}` });
    expect((await creditService.balance(f.id)).allowance).toBe(credits);
  });
});

describe('30-minute payment window', () => {
  it('expired window: app 402, sign-in 402 with a renew token, renew checkout works, a late payment still activates', async () => {
    const r = await serviceSignup(5, 'solo');
    const ob = await call('POST', '/onboarding/complete', { plan: 'advocate', cycle: 'monthly' }, r.token);
    const firstOrder = orderIdOf(ob.json.checkoutUrl);
    await sql()`update firms set trial_ends_at = now() - interval '1 minute' where id = ${(await firmOf(r.user.id)).id}::uuid`;
    const p = await probe(r.token);
    expect(p.status).toBe(402);
    expect(p.json.code).toBe('trial_expired');
    const si = await call('POST', '/auth/sign-in', { email: r.email, password: 'longenough1' });
    expect(si.status).toBe(402);
    const renewToken = si.json.details?.renewToken ?? si.json.renewToken;
    expect(typeof renewToken).toBe('string');
    const rc = await call('POST', '/billing/renew-checkout', { renewToken, plan: 'advocate', cycle: 'monthly' });
    expect(rc.status).toBe(200);
    // The first order is paid late (UPI delay): it still activates.
    expect((await capture(firstOrder)).status).toBe(200);
    expect((await firmOf(r.user.id)).plan_status).toBe('active');
    expect((await probe(r.token)).status).toBe(200);
  });
});

describe('F1: abandoned or out-of-order sign-ups never pay twice', () => {
  it('a never-onboarded account signs in (no 402 renew screen) and is sent to onboarding, even with an old expired trial', async () => {
    const r = await serviceSignup(6, 'group');
    const firmId = (await firmOf(r.user.id)).id;
    // Shape an account made before this fix had: Firm tier, 8 seats, 14-day trial now over.
    await sql()`update firms set plan_tier = 'Firm', seats = 8, trial_ends_at = now() - interval '1 day' where id = ${firmId}::uuid`;
    const si = await call('POST', '/auth/sign-in', { email: r.email, password: 'longenough1' });
    expect(si.status).toBe(200);
    expect(si.json.user.needsOnboarding).toBe(true);
    expect((await probe(si.json.token)).json.code).toBe('onboarding_required');
    const ob = await call('POST', '/onboarding/complete', { plan: 'chambers', cycle: 'monthly', firm: 'Rao Chambers' }, si.json.token);
    expect(ob.status).toBe(200);
    expect(await firmOf(r.user.id)).toMatchObject({ plan_tier: 'Solo', seats: 1, plan_status: 'trial' });
    expect((await capture(orderIdOf(ob.json.checkoutUrl))).status).toBe(200);
    expect(await firmOf(r.user.id)).toMatchObject({ plan_status: 'active', plan_tier: 'Practice', seats: 3, name: 'Rao Chambers' });
    expect((await probe(si.json.token)).status).toBe(200);
  });

  it('a payment applied before onboarding opens the app (onboarded_at set); a later onboarding call keeps the paid plan and opens no checkout', async () => {
    const r = await serviceSignup(12, 'solo');
    // Paid straight from Plan & Billing (API) without onboarding.
    const co = await call('POST', '/billing/checkout', { plan: 'advocate', cycle: 'monthly' }, r.token);
    expect(co.status).toBe(200);
    expect((await capture(orderIdOf(co.json.checkoutUrl))).status).toBe(200);
    const f = await firmOf(r.user.id);
    expect(f.plan_status).toBe('active');
    expect(f.onboarded_at).not.toBeNull();
    expect((await probe(r.token)).status).toBe(200);
    // An account paid before this fix but still not onboarded: onboarding saves details only.
    await sql()`update users set onboarded_at = null where id = ${r.user.id}::uuid`;
    const before = orders.size;
    const ob = await call('POST', '/onboarding/complete', { plan: 'advocate', cycle: 'monthly', city: 'Chennai' }, r.token);
    expect(ob.status).toBe(200);
    expect(ob.json.checkoutUrl).toBeUndefined();
    expect(orders.size).toBe(before);
    expect(await firmOf(r.user.id)).toMatchObject({ plan_status: 'active', selected_plan: 'advocate', seats: 1 });
    expect((await probe(r.token)).status).toBe(200);
  });
});

describe('F2: members only on a set-up, paid firm', () => {
  it('an unpaid (not onboarded) owner cannot invite: 402 plan_required, nothing created', async () => {
    const r = await serviceSignup(7, 'group');
    const inv = await call('POST', '/invitations', { email: 'junior7@signupflow.test', role: 'Associate' }, r.token);
    expect(inv.status).toBe(402);
    expect(inv.json.code).toBe('plan_required');
    const [n] = await sql()<any[]>`select count(*)::int as n from invitations where lower(email) = 'junior7@signupflow.test'`;
    expect(n.n).toBe(0);
  });

  it('inside the 30-minute payment window (onboarded, unpaid) inviting is still refused', async () => {
    const r = await serviceSignup(13, 'group');
    await call('POST', '/onboarding/complete', { plan: 'law_firm', cycle: 'monthly', firm: 'Rao LLP' }, r.token);
    invalidatePermissionsCache();
    const inv = await call('POST', '/invitations', { email: 'junior13@signupflow.test', role: 'Associate' }, r.token);
    expect(inv.status).toBe(402);
    expect(inv.json.code).toBe('plan_required');
    expect((await sql()<any[]>`select count(*)::int as n from invitations where lower(email) = 'junior13@signupflow.test'`)[0].n).toBe(0);
  });

  it('after paying Chambers the owner invites; an invite is refused at acceptance once the plan has lapsed', async () => {
    const r = await serviceSignup(14, 'group');
    const ob = await call('POST', '/onboarding/complete', { plan: 'chambers', cycle: 'monthly', firm: 'Rao & Co' }, r.token);
    await capture(orderIdOf(ob.json.checkoutUrl));
    invalidatePermissionsCache();
    const inv = await call('POST', '/invitations', { email: 'junior14@signupflow.test', role: 'Associate' }, r.token);
    expect(inv.status).toBe(201);
    await sql()`update firms set renews_at = now() - interval '3 days' where id = ${(await firmOf(r.user.id)).id}::uuid`;
    const acc = await call('POST', `/invitations/by-token/${inv.json.token}/accept`, {
      name: 'Junior', signupToken: verifiedToken('g-junior14', 'junior14@signupflow.test', '+919876599014') });
    expect(acc.status).toBe(402);
    expect(acc.json.code).toBe('plan_required');
  });

  it('a pre-onboarding firm has no AI credits', async () => {
    const r = await serviceSignup(11, 'group');
    expect((await creditService.balance((await firmOf(r.user.id)).id)).balance).toBe(0);
  });
});

describe('F3: new accounts are Google only; Google never links a password account by email', () => {
  it('the email + password sign-up routes are gone', async () => {
    expect((await call('POST', '/auth/signup/email/start', { name: 'V', email: 'v@signupflow.test', phone: '9876500008' })).status).toBe(404);
    expect((await call('POST', '/auth/signup/email/complete', {})).status).toBe(404);
  });

  it('Google sign-in to an email that has a password account and no Google link -> 409 google_link_required, nothing linked', async () => {
    const r = await serviceSignup(15, 'solo');
    // Legacy password-only account: no Google link.
    await sql()`update users set google_sub = null where id = ${r.user.id}::uuid`;
    const g = await call('POST', '/auth/google', { credential: `cred:g-other15:${r.email}`, intent: 'signin' });
    expect(g.status).toBe(409);
    expect(g.json.code).toBe('google_link_required');
    expect(JSON.stringify(g.json)).toMatch(/Sign in with your password, then connect Google from Settings/);
    expect((await sql()<any[]>`select google_sub from users where id = ${r.user.id}::uuid`)[0].google_sub).toBeNull();
  });

  it('Settings "Connect Google": signed in, same email only; then Google sign-in works', async () => {
    const r = await serviceSignup(16, 'solo');
    await sql()`update users set google_sub = null where id = ${r.user.id}::uuid`;
    const wrong = await call('POST', '/auth/google/connect', { credential: 'cred:g-new16:someone.else@signupflow.test' }, r.token);
    expect(wrong.status).toBe(400);
    expect(wrong.json.code).toBe('google_email_mismatch');
    expect((await call('POST', '/auth/google/connect', { credential: `cred:g-new16:${r.email}` })).status).toBe(401);
    const ok = await call('POST', '/auth/google/connect', { credential: `cred:g-new16:${r.email}` }, r.token);
    expect(ok.status).toBe(200);
    expect((await sql()<any[]>`select google_sub from users where id = ${r.user.id}::uuid`)[0].google_sub).toBe('g-new16');
    const g = await call('POST', '/auth/google', { credential: `cred:g-new16:${r.email}`, intent: 'signin' });
    expect(g.status).toBe(200);
    expect(typeof g.json.token).toBe('string');
    // A Google account already linked to another DifAi account cannot be connected again.
    const r2 = await serviceSignup(17, 'solo');
    const taken = await call('POST', '/auth/google/connect', { credential: `cred:g-new16:${r2.email}` }, r2.token);
    expect(taken.status).toBe(409);
  });
});

describe('F4: webhook delivered twice at the same moment', () => {
  it('same payment, same or different event ids, in parallel: one activation, one invoice, one period', async () => {
    const r = await serviceSignup(9, 'solo');
    const ob = await call('POST', '/onboarding/complete', { plan: 'advocate', cycle: 'monthly' }, r.token);
    const orderId = orderIdOf(ob.json.checkoutUrl);
    const paymentId = `pay_${crypto.randomBytes(7).toString('hex')}`;
    await capture(orderId, { paymentId, eventId: 'evt_par_first' });
    const firmId = (await firmOf(r.user.id)).id;
    const renewsAt = new Date((await firmOf(r.user.id)).renews_at).getTime();
    const res = await Promise.all([
      capture(orderId, { paymentId, eventId: 'evt_par_a' }),
      capture(orderId, { paymentId, eventId: 'evt_par_b' }),
    ]);
    expect(res.map((x) => x.status)).toEqual([200, 200]);
    expect(new Date((await firmOf(r.user.id)).renews_at).getTime()).toBe(renewsAt);
    const [inv] = await sql()<any[]>`select count(*)::int as n from subscription_invoices where firm_id = ${firmId}::uuid`;
    expect(inv.n).toBe(1);
  });

  it('a renewal payment arriving twice in parallel under different event ids adds one period', async () => {
    const r = await serviceSignup(10, 'solo');
    const ob = await call('POST', '/onboarding/complete', { plan: 'advocate', cycle: 'monthly' }, r.token);
    await capture(orderIdOf(ob.json.checkoutUrl));
    const before = new Date((await firmOf(r.user.id)).renews_at);
    const rc = await call('POST', '/billing/checkout', { plan: 'advocate', cycle: 'monthly' }, r.token);
    const orderId = orderIdOf(rc.json.checkoutUrl);
    const paymentId = `pay_${crypto.randomBytes(7).toString('hex')}`;
    const res = await Promise.all([
      capture(orderId, { paymentId, eventId: 'evt_dup_a' }),
      capture(orderId, { paymentId, eventId: 'evt_dup_b' }),
    ]);
    expect(res.map((x) => x.status)).toEqual([200, 200]);
    const after = new Date((await firmOf(r.user.id)).renews_at);
    const months = (after.getUTCFullYear() - before.getUTCFullYear()) * 12 + after.getUTCMonth() - before.getUTCMonth();
    expect(months).toBe(1);
    const [ev] = await sql()<any[]>`select count(*)::int as n from billing_events where provider_ref = ${paymentId}`;
    expect(ev.n).toBe(1);
  });
});

describe('F5: no silent free plan when online payment is off', () => {
  it('onboarding with a paid plan -> 503 payments_disabled, nothing changed; a free-launch account still onboards free', async () => {
    const keep = env.razorpay.keyId;
    (env.razorpay as { keyId: string }).keyId = '';
    try {
      expect(paymentsEnabled()).toBe(false);
      const r = await serviceSignup(18, 'solo');
      const ob = await call('POST', '/onboarding/complete', { plan: 'advocate', cycle: 'monthly' }, r.token);
      expect(ob.status).toBe(503);
      expect(ob.json.code).toBe('payments_disabled');
      expect(await firmOf(r.user.id)).toMatchObject({ free_plan: false, free_launch: false, onboarded_at: null });
      // An account that already has the free launch plan keeps working.
      const r2 = await serviceSignup(19, 'solo');
      await sql()`update firms set free_launch = true where id = ${(await firmOf(r2.user.id)).id}::uuid`;
      const ob2 = await call('POST', '/onboarding/complete', { plan: 'free' }, r2.token);
      expect(ob2.status).toBe(200);
      expect(await firmOf(r2.user.id)).toMatchObject({ free_plan: true, plan_status: 'trial' });
      expect((await probe(r2.token)).status).toBe(200);
    } finally {
      (env.razorpay as { keyId: string }).keyId = keep;
    }
  });
});

describe('F6: Terms consent enforced by the server', () => {
  it('declined consent -> 403 terms_required on app routes; /auth/me and the consent endpoint stay open; agreeing reopens', async () => {
    const r = await serviceSignup(20, 'solo');
    const ob = await call('POST', '/onboarding/complete', { plan: 'advocate', cycle: 'monthly' }, r.token);
    await capture(orderIdOf(ob.json.checkoutUrl));
    expect((await probe(r.token)).status).toBe(200);
    const decline = await call('POST', '/me/dpdp/consent', { consentType: 'terms_privacy', consentVersion: TERMS_VERSION, granted: false }, r.token);
    expect(decline.status).toBe(201);
    const p = await probe(r.token);
    expect(p.status).toBe(403);
    expect(p.json.code).toBe('terms_required');
    const me = await call('GET', '/auth/me', undefined, r.token);
    expect(me.status).toBe(200);
    expect(me.json.user.needsTermsAcceptance).toBe(true);
    expect((await call('POST', '/me/dpdp/consent', { consentType: 'terms_privacy', consentVersion: TERMS_VERSION, granted: true }, r.token)).status).toBe(201);
    expect((await probe(r.token)).status).toBe(200);
  });

  it('an account with no consent row at all is refused too', async () => {
    const r = await serviceSignup(21, 'solo');
    const ob = await call('POST', '/onboarding/complete', { plan: 'advocate', cycle: 'monthly' }, r.token);
    await capture(orderIdOf(ob.json.checkoutUrl));
    await sql()`delete from consent_log where user_id = ${r.user.id}::uuid`;
    expect((await probe(r.token)).json.code).toBe('terms_required');
  });
});
