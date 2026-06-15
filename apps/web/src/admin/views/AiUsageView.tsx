import { useState } from 'react';
import type {
  AiUsageByFeature,
  AiUsageByFirm,
  AiUsageFeature,
  AiUsageTrendPoint,
} from '@lexdraft/types';
import { useAiUsage } from '../queries';

// Human labels for the feature enum stored in ai_token_usage.feature.
const FEATURE_LABELS: Record<AiUsageFeature, string> = {
  drafting: 'Drafting',
  matter_chat: 'Matter chat',
  diary_assistant: 'Diary assistant',
  draft_extract: 'Field extraction',
  matter_intel: 'Matter intel',
  mock_arguments: 'Mock arguments',
  review: 'Contract review',
  title_report: 'Title reports',
  laws_search: 'Laws search',
};

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatInr(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
}

export function AiUsageView() {
  const [days, setDays] = useState<number>(30);
  const { data, isLoading } = useAiUsage(days);

  return (
    <div className="col stagger" style={{ gap: 28 }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Platform AI</div>
          <h1 className="display-md">AI token usage</h1>
        </div>
        <span className="spacer" />
        <div className="row" style={{ gap: 4 }}>
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              className={`btn btn-sm${days === r.days ? '' : ' btn-ghost'}`}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <div className="muted">Loading AI usage…</div>
      ) : (
        <>
          <div className="grid-auto-sm" style={{ gap: 20 }}>
            <StatCard
              label="Total tokens"
              value={formatTokens(data.totals.totalTokens)}
              sub={`${formatTokens(data.totals.tokensIn)} in · ${formatTokens(data.totals.tokensOut)} out`}
            />
            <StatCard
              label="Input tokens"
              value={formatTokens(data.totals.tokensIn)}
              sub="Prompt + context"
            />
            <StatCard
              label="Output tokens"
              value={formatTokens(data.totals.tokensOut)}
              sub="Generated"
            />
            <StatCard
              label="Cost"
              value={formatInr(data.totals.estCostInr)}
              sub={`≈ ${formatUsd(data.totals.estCostUsd)} · list price`}
            />
          </div>

          <TrendChart points={data.trend} />

          <div className="grid-auto" style={{ gap: 20 }}>
            <FeatureTable rows={data.byFeature} />
            <FirmTable rows={data.byFirm} />
          </div>

          <div className="body-sm muted">
            Cost is computed from the exact tokens each call used — including prompt-cache
            reads (~0.1×) and writes (~1.25×) — priced at published per-model list rates and
            converted at a fixed USD→INR rate. This matches your provider bill except for any
            private enterprise discount, which no API exposes.
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card" style={{ padding: 'var(--space-6)' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>
      <div className="display-md tabular" style={{ marginBottom: 6 }}>{value}</div>
      <div className="body-sm muted">{sub}</div>
    </div>
  );
}

/** Lightweight inline-SVG area chart of daily total tokens — avoids pulling in
 *  a charting dependency for a single sparkline. */
function TrendChart({ points }: { points: AiUsageTrendPoint[] }) {
  const W = 720;
  const H = 160;
  const PAD = 8;

  const totals = points.map((p) => p.tokensIn + p.tokensOut);
  const max = Math.max(1, ...totals);

  let body: React.ReactNode;
  if (points.length === 0) {
    body = (
      <div className="muted" style={{ padding: 'var(--space-7)', textAlign: 'center' }}>
        No AI usage recorded in this window yet.
      </div>
    );
  } else {
    const stepX = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
    const x = (i: number) => PAD + stepX * i;
    const y = (v: number) => PAD + (H - PAD * 2) * (1 - v / max);
    const line = totals.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
    body = (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Daily token usage">
        <path d={area} fill="var(--accent-soft, rgba(193,67,38,0.12))" stroke="none" />
        <path d={line} fill="none" stroke="var(--accent, #c14326)" strokeWidth={2} />
      </svg>
    );
  }

  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        className="row"
        style={{ padding: 'var(--space-5) var(--space-6)', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)' }}
      >
        <h2 className="heading-lg">Daily tokens</h2>
        <span className="spacer" />
        {points.length > 0 && (
          <span className="mono body-sm muted">
            {points[0]!.day} → {points[points.length - 1]!.day}
          </span>
        )}
      </div>
      <div style={{ padding: 'var(--space-5) var(--space-6)' }}>{body}</div>
    </section>
  );
}

function FeatureTable({ rows }: { rows: AiUsageByFeature[] }) {
  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="row" style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="heading-lg">By feature</h2>
      </div>
      {rows.length === 0 ? (
        <div className="muted" style={{ padding: 'var(--space-7)', textAlign: 'center' }}>No usage.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Feature</th>
              <th style={{ textAlign: 'right' }}>Tokens</th>
              <th style={{ textAlign: 'right' }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.feature}>
                <td>{FEATURE_LABELS[r.feature] ?? r.feature}</td>
                <td className="tabular" style={{ textAlign: 'right' }}>{formatTokens(r.totalTokens)}</td>
                <td className="tabular" style={{ textAlign: 'right' }}>{formatUsd(r.estCostUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function FirmTable({ rows }: { rows: AiUsageByFirm[] }) {
  const top = rows.slice(0, 15);
  return (
    <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="row" style={{ padding: 'var(--space-5) var(--space-6)', borderBottom: '1px solid var(--border-subtle)' }}>
        <h2 className="heading-lg">Top firms</h2>
      </div>
      {top.length === 0 ? (
        <div className="muted" style={{ padding: 'var(--space-7)', textAlign: 'center' }}>No usage.</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Firm</th>
              <th style={{ textAlign: 'right' }}>Tokens</th>
              <th style={{ textAlign: 'right' }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.firmId ?? 'none'}>
                <td>{r.firmName}</td>
                <td className="tabular" style={{ textAlign: 'right' }}>{formatTokens(r.totalTokens)}</td>
                <td className="tabular" style={{ textAlign: 'right' }}>{formatUsd(r.estCostUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
