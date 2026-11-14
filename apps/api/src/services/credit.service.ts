import crypto from 'node:crypto';
import type { TransactionSql } from 'postgres';
import type { CreditBalance } from '@lexdraft/types';
import { db } from '../db/client';
import { HttpError } from '../lib/errors';
import { FREE_PLAN_ENDS_AT } from '../lib/free-plan';
import { draftCredits, FREE_LAUNCH_CREDITS, WORDS_PER_CREDIT, type CreditAction } from '../lib/credit-costs';
import { isPaidPlan, MUNSHI_ROLES, PLANS } from '../lib/plans';
import { logger } from '../logger';

// =============================================================================
// AI credits (build-docs/features/ai-credits.md, migration 0108).
//
// A firm has one shared pool: this month's plan grant (created lazily, no
// cron), Brief Packs and admin grants. Spends take from the soonest-expiring
// grant first, under row locks, so two tabs can never overspend. Every spend
// has a unique ref_key: a retried charge never counts twice, and a refund
// gives back exactly what that spend took.
// Amounts move in half credits; the code works in integer halves.
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Tx = TransactionSql<{}>;

export interface CreditCtx { firmId: string | null; userId: string | null }

const halves = (credits: number) => Math.round(credits * 2);
const fromHalves = (h: number) => h / 2;

export class CreditsExhaustedError extends HttpError {
  constructor(details: { balance: number; needed: number; resetsAt: string | null }) {
    super(402, `This needs ${details.needed} credit${details.needed === 1 ? '' : 's'} and ${details.balance} ${details.balance === 1 ? 'is' : 'are'} left.`, {
      code: 'credits_exhausted', details,
    });
  }
}

interface FirmRow {
  plan_tier: 'Solo' | 'Practice' | 'Firm' | null; plan_status: string | null; free_plan: boolean | null;
  selected_plan: string | null; seats: number | null; renews_at: Date | null; trial_ends_at: Date | null;
}

/** Monthly credits for the firm's plan as it stands now (munshi seats get none). */
export function allowanceFor(f: FirmRow, now = new Date()): number {
  if (f.free_plan) return now < FREE_PLAN_ENDS_AT ? FREE_LAUNCH_CREDITS : 0;
  const seats = Math.max(1, f.seats ?? 1);
  if (f.plan_status === 'active') {
    if (isPaidPlan(f.selected_plan)) {
      const p = PLANS[f.selected_plan];
      return p.pages * (p.perAdvocate ? seats : 1);
    }
    // Accounts from before pricing v4 (and custom Partners firms).
    if (f.plan_tier === 'Solo') return PLANS.vakalat.pages;
    if (f.plan_tier === 'Practice') return PLANS.associates.pages * seats;
    if (f.plan_tier === 'Firm') return PLANS.brief.pages * seats;
    return 0;
  }
  // A pre-v4 14-day trial still running. A v4 sign-up that hasn't paid yet
  // (selected a paid plan, no subscription) gets nothing until the webhook.
  if (f.plan_status === 'trial' && !isPaidPlan(f.selected_plan) && f.trial_ends_at && f.trial_ends_at > now) {
    return FREE_LAUNCH_CREDITS;
  }
  return 0;
}

/** This month's window. Anchored to the renewal day when there is one (also
 *  for yearly plans: credits are monthly), else the calendar month (UTC). */
export function cycleBounds(renewsAt: Date | null, now = new Date()): { start: Date; end: Date } {
  if (!renewsAt) {
    return {
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    };
  }
  const at = (monthsBack: number) => {
    const d = new Date(renewsAt);
    d.setUTCMonth(d.getUTCMonth() - monthsBack);
    return d;
  };
  // Walk back from the renewal date (or forward past it) to the window holding now.
  let k = 0;
  if (renewsAt <= now) {
    while (at(-(k + 1)) <= now && k < 1200) k++;
    return { start: at(-k), end: at(-(k + 1)) };
  }
  while (at(k + 1) > now && k < 1200) k++;
  return { start: at(k + 1), end: at(k) };
}

async function loadFirm(q: Tx, firmId: string, lock = false): Promise<FirmRow | null> {
  const [f] = lock
    ? await q<FirmRow[]>`select plan_tier, plan_status, free_plan, selected_plan, seats, renews_at, trial_ends_at from firms where id = ${firmId}::uuid for update`
    : await q<FirmRow[]>`select plan_tier, plan_status, free_plan, selected_plan, seats, renews_at, trial_ends_at from firms where id = ${firmId}::uuid`;
  return f ?? null;
}

/** Creates (or tops up after an upgrade) this cycle's plan grant. A downgrade
 *  keeps the bigger grant until the cycle ends. Runs inside `tx`. */
async function ensurePlanGrant(tx: Tx, firmId: string, f: FirmRow, now = new Date()): Promise<{ start: Date; end: Date }> {
  const cycle = cycleBounds(f.renews_at, now);
  const allowance = allowanceFor(f, now);
  const ref = `plan:${firmId}:${cycle.start.toISOString()}`;
  await tx`
    insert into credit_grants (firm_id, source, amount, remaining, cycle_start, expires_at, ref)
    values (${firmId}::uuid, 'plan', ${allowance}, ${allowance}, ${cycle.start}, ${cycle.end}, ${ref})
    on conflict (ref) do update set
      remaining = credit_grants.remaining + greatest(excluded.amount - credit_grants.amount, 0),
      amount = greatest(credit_grants.amount, excluded.amount)`;
  return cycle;
}

interface GrantRow { id: string; remaining: string | number }

/** Takes up to `wantHalves` from the firm's live grants (soonest expiry first;
 *  Brief Packs last because they expire latest). Returns what it took. */
async function take(tx: Tx, firmId: string, wantHalves: number): Promise<{ took: number; allocations: Array<{ grant: string; amount: number }> }> {
  const grants = await tx<GrantRow[]>`
    select id, remaining from credit_grants
    where firm_id = ${firmId}::uuid and remaining > 0 and expires_at > now()
    order by expires_at, created_at
    for update`;
  let left = wantHalves;
  const allocations: Array<{ grant: string; amount: number }> = [];
  for (const g of grants) {
    if (left <= 0) break;
    const use = Math.min(left, halves(Number(g.remaining)));
    if (use <= 0) continue;
    await tx`update credit_grants set remaining = remaining - ${fromHalves(use)} where id = ${g.id}::uuid`;
    allocations.push({ grant: g.id, amount: fromHalves(use) });
    left -= use;
  }
  return { took: wantHalves - left, allocations };
}

async function availableHalves(tx: Tx, firmId: string): Promise<number> {
  const [r] = await tx<{ n: string | number | null }[]>`
    select coalesce(sum(remaining), 0) as n from credit_grants
    where firm_id = ${firmId}::uuid and expires_at > now()`;
  return halves(Number(r?.n ?? 0));
}

async function writeSpend(tx: Tx, ctx: CreditCtx, action: string, refKey: string, credits: number,
  allocations: Array<{ grant: string; amount: number }>, meta: Record<string, unknown> = {}): Promise<void> {
  await tx`
    insert into credit_ledger (firm_id, user_id, action, credits, kind, ref_key, allocations, meta)
    values (${ctx.firmId}::uuid, ${ctx.userId}, ${action}, ${credits}, 'spend', ${refKey},
            ${tx.json(allocations as never)}, ${tx.json(meta as never)})`;
}

export interface Charge { refKey: string; credits: number; refund: () => Promise<void> }

/** A Munshi (clerk) seat has no AI: refuse before any model call or charge. */
async function assertNotMunshi(ctx: CreditCtx): Promise<void> {
  const sql = db();
  if (!sql || !ctx.userId) return;
  const [u] = await sql<{ role: string | null }[]>`select role from users where id = ${ctx.userId}::uuid`;
  if (u && MUNSHI_ROLES.includes(u.role ?? '')) {
    throw new HttpError(403, 'Munshi seats do not include AI features.', { code: 'munshi_no_ai' });
  }
}
const noCharge = (refKey: string): Charge => ({ refKey, credits: 0, refund: async () => undefined });

export const creditService = {
  /** Balance, this month's allowance and when it resets. */
  async balance(firmId: string | null): Promise<CreditBalance> {
    const sql = db();
    if (!sql || !firmId) {
      return { balance: 0, allowance: 0, usedThisCycle: 0, topup: 0, resetsAt: null, unlimited: !sql };
    }
    const now = new Date();
    return sql.begin(async (tx) => {
      const f = await loadFirm(tx, firmId);
      if (!f) return { balance: 0, allowance: 0, usedThisCycle: 0, topup: 0, resetsAt: null, unlimited: false };
      const cycle = await ensurePlanGrant(tx, firmId, f, now);
      const [r] = await tx<{ total: string; plan_amount: string; plan_left: string; topup: string }[]>`
        select coalesce(sum(remaining) filter (where expires_at > now()), 0) as total,
               coalesce(sum(amount) filter (where source = 'plan' and cycle_start = ${cycle.start}), 0) as plan_amount,
               coalesce(sum(remaining) filter (where source = 'plan' and cycle_start = ${cycle.start}), 0) as plan_left,
               coalesce(sum(remaining) filter (where source <> 'plan' and expires_at > now()), 0) as topup
        from credit_grants where firm_id = ${firmId}::uuid`;
      return {
        balance: Number(r?.total ?? 0),
        allowance: Number(r?.plan_amount ?? 0),
        usedThisCycle: Number(r?.plan_amount ?? 0) - Number(r?.plan_left ?? 0),
        topup: Number(r?.topup ?? 0),
        resetsAt: cycle.end.toISOString(),
        unlimited: false,
      };
    });
  },

  /** Takes a fixed cost now, or throws 402 credits_exhausted (nothing taken).
   *  Call `refund()` if the AI call then fails. */
  async charge(ctx: CreditCtx, action: CreditAction, credits: number, refKey = `${action}:${crypto.randomUUID()}`,
    meta: Record<string, unknown> = {}): Promise<Charge> {
    const sql = db();
    if (!sql) return noCharge(refKey); // demo mode: no metering
    if (!ctx.firmId) throw new CreditsExhaustedError({ balance: 0, needed: credits, resetsAt: null });
    await assertNotMunshi(ctx);
    const want = halves(credits);
    const firmId = ctx.firmId;
    const out = await sql.begin(async (tx) => {
      const [seen] = await tx<{ id: string }[]>`select id from credit_ledger where ref_key = ${refKey}`;
      if (seen) return { ok: true as const };
      const f = await loadFirm(tx, firmId, true);
      if (!f) return { ok: false as const, balance: 0, resetsAt: null };
      const cycle = await ensurePlanGrant(tx, firmId, f);
      const have = await availableHalves(tx, firmId);
      if (have < want) return { ok: false as const, balance: fromHalves(have), resetsAt: cycle.end.toISOString() };
      const { allocations } = await take(tx, firmId, want);
      await writeSpend(tx, ctx, action, refKey, credits, allocations, meta);
      return { ok: true as const };
    });
    if (!out.ok) throw new CreditsExhaustedError({ balance: out.balance, needed: credits, resetsAt: out.resetsAt });
    return { refKey, credits, refund: () => creditService.refund(refKey) };
  },

  /** Charge `credits`, run `fn`, and give the credits back if `fn` throws. */
  async withCredits<T>(ctx: CreditCtx, action: CreditAction, credits: number, fn: () => Promise<T>,
    meta: Record<string, unknown> = {}): Promise<T> {
    const c = await creditService.charge(ctx, action, credits, undefined, meta);
    try {
      return await fn();
    } catch (err) {
      await c.refund().catch((e) => logger.error({ err: e, refKey: c.refKey }, 'credit refund failed'));
      throw err;
    }
  },

  /** Throws 402 unless at least `credits` are available. Takes nothing. */
  async assertAvailable(ctx: CreditCtx, credits: number): Promise<void> {
    const sql = db();
    if (!sql) return;
    await assertNotMunshi(ctx);
    const b = await creditService.balance(ctx.firmId);
    if (halves(b.balance) < halves(credits)) {
      throw new CreditsExhaustedError({ balance: b.balance, needed: credits, resetsAt: b.resetsAt });
    }
  },

  /** Gives back what a spend took (to the same grants). Idempotent. */
  async refund(refKey: string): Promise<void> {
    const sql = db();
    if (!sql) return;
    await sql.begin(async (tx) => {
      const [s] = await tx<Array<{ firm_id: string; user_id: string | null; action: string; credits: string; allocations: Array<{ grant: string; amount: number }> }>>`
        select firm_id, user_id, action, credits, allocations from credit_ledger where ref_key = ${refKey} and kind = 'spend' for update`;
      if (!s) return;
      const [done] = await tx<{ id: string }[]>`select id from credit_ledger where ref_key = ${`refund:${refKey}`}`;
      if (done) return;
      for (const a of s.allocations ?? []) {
        await tx`update credit_grants set remaining = least(amount, remaining + ${a.amount}) where id = ${a.grant}::uuid`;
      }
      await tx`
        insert into credit_ledger (firm_id, user_id, action, credits, kind, ref_key, allocations)
        values (${s.firm_id}::uuid, ${s.user_id}, ${s.action}, ${-Number(s.credits)}, 'refund', ${`refund:${refKey}`}, ${tx.json(s.allocations as never)})`;
    });
  },

  /**
   * A drafted document's pages. Charges what the draft needs beyond what this
   * draft (`draftKey`) already paid, as far as the balance goes. Pages never
   * get charged twice: re-rendering the same draft is free, and only growth
   * past the paid pages costs. Returns the words the reader may see; the rest
   * is locked until `unlock`.
   */
  async meterDraft(ctx: CreditCtx, draftKey: string, words: number, payload: unknown = null): Promise<DraftMeter> {
    const sql = db();
    const needed = draftCredits(words);
    if (!sql) return { paidWords: Number.POSITIVE_INFINITY, lockedCredits: 0, paid: needed, needed };
    if (!ctx.firmId) return { paidWords: 0, lockedCredits: needed, paid: 0, needed };
    const firmId = ctx.firmId;
    return sql.begin(async (tx) => {
      const f = await loadFirm(tx, firmId, true);
      if (f) await ensurePlanGrant(tx, firmId, f);
      await tx`
        insert into metered_drafts (ref_key, firm_id, user_id) values (${draftKey}, ${firmId}::uuid, ${ctx.userId})
        on conflict (ref_key) do nothing`;
      const [m] = await tx<{ paid: string; firm_id: string }[]>`
        select paid, firm_id from metered_drafts where ref_key = ${draftKey} for update`;
      if (m && m.firm_id !== firmId) throw new HttpError(404, 'Draft not found');
      let paidH = halves(Number(m?.paid ?? 0));
      const gap = halves(needed) - paidH;
      if (gap > 0) {
        const { took, allocations } = await take(tx, firmId, gap);
        if (took > 0) {
          const newPaid = paidH + took;
          await writeSpend(tx, ctx, 'draft', `${draftKey}@${newPaid}`, fromHalves(took), allocations, { words });
          paidH = newPaid;
        }
      }
      // The hidden full text is kept only while something is locked.
      const keep = paidH < halves(needed) && payload !== null;
      await tx`
        update metered_drafts set needed = ${needed}, paid = ${fromHalves(paidH)}, total_words = ${words},
          payload = ${keep ? tx.json(payload as never) : null}, updated_at = now()
        where ref_key = ${draftKey}`;
      const paid = fromHalves(paidH);
      return {
        paid, needed,
        paidWords: paid >= needed ? Number.POSITIVE_INFINITY : paid * WORDS_PER_CREDIT,
        lockedCredits: Math.max(0, needed - paid),
      };
    });
  },

  /** Pays the locked rest of a draft (all or nothing). 402 when it can't. */
  async unlock(ctx: CreditCtx, draftKey: string): Promise<{ payload: unknown; paid: number }> {
    const sql = db();
    if (!sql || !ctx.firmId) throw new HttpError(404, 'Draft not found');
    const firmId = ctx.firmId;
    const out = await sql.begin(async (tx) => {
      const [m] = await tx<{ paid: string; needed: string; firm_id: string; payload: unknown; total_words: number }[]>`
        select paid, needed, firm_id, payload, total_words from metered_drafts where ref_key = ${draftKey} for update`;
      if (!m || m.firm_id !== firmId) return { status: 'missing' as const };
      const gap = halves(Number(m.needed)) - halves(Number(m.paid));
      if (gap <= 0) return { status: 'ok' as const, payload: m.payload, paid: Number(m.paid) };
      const f = await loadFirm(tx, firmId, true);
      const cycle = f ? await ensurePlanGrant(tx, firmId, f) : null;
      const have = await availableHalves(tx, firmId);
      if (have < gap) return { status: 'short' as const, balance: fromHalves(have), needed: fromHalves(gap), resetsAt: cycle?.end.toISOString() ?? null };
      const { allocations } = await take(tx, firmId, gap);
      const paid = Number(m.needed);
      await writeSpend(tx, ctx, 'draft', `${draftKey}@${halves(paid)}`, fromHalves(gap), allocations, { words: m.total_words, unlock: true });
      await tx`update metered_drafts set paid = ${paid}, updated_at = now() where ref_key = ${draftKey}`;
      return { status: 'ok' as const, payload: m.payload, paid };
    });
    if (out.status === 'missing') throw new HttpError(404, 'Draft not found');
    if (out.status === 'short') throw new CreditsExhaustedError({ balance: out.balance, needed: out.needed, resetsAt: out.resetsAt });
    return { payload: out.payload, paid: out.paid };
  },

  /** Brief Pack / admin grant. Idempotent on `ref`. */
  async addGrant(g: { firmId: string; source: 'topup' | 'admin'; amount: number; ref: string; expiresAt: Date; note?: string | null; createdBy?: string | null }): Promise<boolean> {
    const sql = db();
    if (!sql) return false;
    const rows = await sql<{ id: string }[]>`
      insert into credit_grants (firm_id, source, amount, remaining, expires_at, ref, note, created_by)
      values (${g.firmId}::uuid, ${g.source}, ${g.amount}, ${g.amount}, ${g.expiresAt}, ${g.ref}, ${g.note ?? null}, ${g.createdBy ?? null})
      on conflict (ref) do nothing returning id`;
    return rows.length > 0;
  },
};

export interface DraftMeter {
  /** Credits this draft has paid / needs in total. */
  paid: number;
  needed: number;
  /** Words the reader may see (Infinity = the whole draft). */
  paidWords: number;
  /** Credits still needed to unlock the rest (0 = nothing locked). */
  lockedCredits: number;
}
