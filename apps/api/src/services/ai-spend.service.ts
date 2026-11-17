/**
 * AI spend guard (build-docs/features/admin-ai-spend-guard.md).
 *
 * - Month-to-date spend: Anthropic's own figure (Usage and Cost Analytics API,
 *   needs ANTHROPIC_ADMIN_KEY) next to DifAi's estimate from ai_token_usage.
 * - Monthly budget + alert thresholds; hourly check notifies superadmins once
 *   per threshold per month and can auto-pause AI at 100% (off by default).
 * - Platform pause switch (enforced in lib/ai-pause).
 * Topping up Anthropic credit is not possible by API: it stays in the Console.
 */
import { db } from '../db/client';
import { env } from '../env';
import { setPlatformPausedCache } from '../lib/ai-pause';
import { USD_INR } from '../lib/ai-pricing';
import { logger } from '../logger';
import { aiUsageReportService } from './ai-usage-report.service';
import { auditService } from './audit.service';
import { emailService } from './email.service';
import { notificationsStore } from './notifications.service';

export interface AiSpendSettings {
  /** Monthly AI budget in USD; null = no budget, no alerts. */
  budgetUsd: number | null;
  /** Alert at these % of budget (ascending, 1-200). */
  alertPcts: number[];
  /** Pause AI for everyone when spend reaches 100% of the budget. */
  autopause: boolean;
}

export interface AiSpend extends AiSpendSettings {
  monthStart: string;
  paused: boolean;
  /** Anthropic's own month-to-date figure; null without an admin key or on error. */
  provider: { usd: number; asOf: string | null } | null;
  providerError: string | null;
  estimate: { usd: number; inr: number };
  /** % of budget used (provider figure when known, else estimate); null without a budget. */
  usedPct: number | null;
}

const DEFAULTS: AiSpendSettings = { budgetUsd: null, alertPcts: [80, 100], autopause: false };
const PROVIDER_TTL_MS = 15 * 60_000;
let providerCache: { key: string; at: number; value: { usd: number; asOf: string | null } } | null = null;

/** First instant of the current UTC month (Anthropic bills by UTC month). */
export function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function readSetting<T>(key: string): Promise<T | null> {
  const sql = db();
  if (!sql) return null;
  const [r] = await sql<{ value: T }[]>`select value from platform_settings where key = ${key}`;
  return r?.value ?? null;
}

async function writeSetting(key: string, value: unknown, actorId: string | null): Promise<void> {
  const sql = db();
  if (!sql) return;
  await sql`
    insert into platform_settings (key, value, updated_at, updated_by)
    values (${key}, ${sql.json(value as never)}, now(), ${actorId})
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`;
}

/** Sum of an Anthropic cost response, in USD. Amounts are decimal strings in cents. */
export function anthropicCostUsd(body: { data?: Array<{ cost?: { amount?: string } }> }): number {
  // Integer micro-cents (6 decimals) to avoid float drift across rows.
  let micro = 0n;
  for (const row of body.data ?? []) {
    const amt = row.cost?.amount;
    if (typeof amt !== 'string' || !/^\d+(\.\d{1,6})?$/.test(amt)) continue;
    const [whole, frac = ''] = amt.split('.');
    micro += BigInt(whole!) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
  }
  return Number(micro) / 1_000_000 / 100;
}

async function fetchAnthropicMonthUsd(start: Date): Promise<{ usd: number; asOf: string | null }> {
  const key = env.ANTHROPIC_ADMIN_KEY;
  const cacheKey = start.toISOString();
  if (providerCache && providerCache.key === cacheKey && Date.now() - providerCache.at < PROVIDER_TTL_MS) return providerCache.value;
  const url = `https://api.anthropic.com/v1/organizations/analytics/cost?starting_at=${encodeURIComponent(start.toISOString().replace('.000Z', 'Z'))}`;
  const res = await fetch(url, {
    headers: {
      'x-api-key': key,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'analytics-usage-cost-2026-08-24',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Anthropic cost API ${res.status}`);
  const body = await res.json() as { data?: Array<{ cost?: { amount?: string } }>; data_refreshed_at?: string | null };
  const value = { usd: Math.round(anthropicCostUsd(body) * 100) / 100, asOf: body.data_refreshed_at ?? null };
  providerCache = { key: cacheKey, at: Date.now(), value };
  return value;
}

export const aiSpendService = {
  async settings(): Promise<AiSpendSettings> {
    const s = await readSetting<Partial<AiSpendSettings>>('ai_spend');
    return { ...DEFAULTS, ...(s ?? {}) };
  },

  async spend(now = new Date()): Promise<AiSpend> {
    const start = monthStartUtc(now);
    const [settings, paused, est] = await Promise.all([
      aiSpendService.settings(),
      readSetting<boolean>('ai_paused'),
      // Window = the whole UTC month: ending at `now` (ms) would drop rows written
      // in the same millisecond (Postgres stores µs).
      aiUsageReportService.summary(start, new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))),
    ]);
    let provider: AiSpend['provider'] = null;
    let providerError: string | null = null;
    if (env.ANTHROPIC_ADMIN_KEY) {
      try { provider = await fetchAnthropicMonthUsd(start); } catch (err) {
        providerError = 'Could not read Anthropic spend';
        logger.warn({ err }, 'ai spend: Anthropic cost API failed');
        if (providerCache?.key === start.toISOString()) provider = providerCache.value; // last known figure
      }
    } else {
      providerError = 'Anthropic admin key not set';
    }
    const usd = provider ? Math.max(provider.usd, 0) : est.estCostUsd;
    return {
      ...settings,
      monthStart: start.toISOString(),
      paused: paused === true,
      provider,
      providerError,
      estimate: { usd: est.estCostUsd, inr: est.estCostInr },
      usedPct: settings.budgetUsd ? Math.round((usd / settings.budgetUsd) * 1000) / 10 : null,
    };
  },

  async updateSettings(patch: Partial<AiSpendSettings>, actor: { id: string; email: string }): Promise<AiSpend> {
    const next = { ...(await aiSpendService.settings()), ...patch };
    next.alertPcts = [...new Set(next.alertPcts)].sort((a, b) => a - b);
    await writeSetting('ai_spend', next, actor.id);
    await auditService.write({ actorUserId: actor.id, actorEmail: actor.email, action: 'platform.ai_spend.settings', targetType: 'platform', targetId: null, payload: next });
    return aiSpendService.spend();
  },

  async setPaused(paused: boolean, actor: { id: string | null; email: string | null }, reason: string): Promise<void> {
    await writeSetting('ai_paused', paused, actor.id);
    setPlatformPausedCache(paused);
    await auditService.write({ actorUserId: actor.id, actorEmail: actor.email ?? 'system', action: paused ? 'platform.ai.paused' : 'platform.ai.resumed', targetType: 'platform', targetId: null, payload: { reason } });
  },

  async setFirmPaused(firmId: string, paused: boolean, actor: { id: string; email: string }): Promise<boolean> {
    const sql = db();
    if (!sql) return false;
    const rows = await sql`update firms set ai_paused = ${paused} where id = ${firmId}::uuid returning id`;
    if (!rows.length) return false;
    await auditService.write({ actorUserId: actor.id, actorEmail: actor.email, action: paused ? 'firm.ai.paused' : 'firm.ai.resumed', targetType: 'firm', targetId: firmId, payload: {} });
    return true;
  },

  /** Hourly job: alert superadmins once per threshold per month; optional auto-pause. */
  async checkBudget(now = new Date()): Promise<{ sent: number[] }> {
    const sql = db();
    if (!sql) return { sent: [] };
    const s = await aiSpendService.spend(now);
    if (!s.budgetUsd || s.usedPct == null) return { sent: [] };
    const month = s.monthStart.slice(0, 7);
    const state = (await readSetting<{ month: string; sent: number[] }>('ai_budget_alerts')) ?? { month, sent: [] };
    const already = state.month === month ? state.sent : [];
    const due = s.alertPcts.filter((p) => s.usedPct! >= p && !already.includes(p));
    if (!due.length) return { sent: [] };
    // Record first so a failing email can't cause a repeat every hour.
    await writeSetting('ai_budget_alerts', { month, sent: [...already, ...due] }, null);
    const top = Math.max(...due);
    const spentUsd = s.provider ? s.provider.usd : s.estimate.usd;
    const title = `AI spend at ${s.usedPct}% of the monthly budget`;
    const body = `$${spentUsd.toFixed(2)} (≈ ₹${Math.round(spentUsd * USD_INR).toLocaleString('en-IN')}) of $${s.budgetUsd} this month${s.provider ? '' : ' (DifAi estimate)'}.`;
    const admins = await sql<{ id: string; firm_id: string | null; email: string | null }[]>`
      select id, firm_id, email from users where is_superadmin and status = 'active'`;
    for (const a of admins) {
      if (a.firm_id) {
        await notificationsStore.create({ firmId: a.firm_id, userId: a.id, tone: top >= 100 ? 'vermillion' : 'amber', icon: 'alert', title, body, view: 'admin', dedupeKey: `ai-budget:${month}:${top}` });
      }
      if (a.email && a.email.includes('@')) {
        await emailService.send({ to: a.email, subject: `DifAi: ${title}`, body: `${body}\n\nTop up or change the budget: Anthropic Console → Billing, and /admin → AI usage.` }).catch(() => false);
      }
    }
    if (s.autopause && s.usedPct >= 100 && !s.paused) {
      await aiSpendService.setPaused(true, { id: null, email: null }, `auto-pause at ${s.usedPct}% of budget`);
    }
    return { sent: due };
  },
};
