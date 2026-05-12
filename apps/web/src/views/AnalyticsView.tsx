import { useMemo } from 'react';
import { Icon } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { useAnalytics } from '@/hooks/useAnalytics';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';

interface Kpi {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
}

interface StageBar {
  label: string;
  count: number;
}

interface MonthPoint {
  label: string;
  value: number;
}

function formatLakh(inr: number): string {
  if (inr >= 10_000_000) return `₹${(inr / 10_000_000).toFixed(2)} Cr`;
  if (inr >= 100_000)    return `₹${(inr / 100_000).toFixed(2)} L`;
  return `₹${inr.toLocaleString('en-IN')}`;
}

interface SparklinePath {
  line: string;
  area: string;
  points: { x: number; y: number; value: number; label: string }[];
}

function buildSparkline(data: MonthPoint[], width: number, height: number): SparklinePath {
  const first = data[0];
  if (!first) {
    return { line: '', area: '', points: [] };
  }
  const padX = 8;
  const padY = 12;
  const max = Math.max(...data.map((p) => p.value));
  const min = Math.min(...data.map((p) => p.value));
  const range = Math.max(1, max - min);
  const stepX = (width - padX * 2) / Math.max(1, data.length - 1);
  const points = data.map((p, i) => {
    const x = padX + stepX * i;
    const y = padY + (1 - (p.value - min) / range) * (height - padY * 2);
    return { x, y, value: p.value, label: p.label };
  });
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1] ?? points[0] ?? { x: padX, y: height - padY };
  const start = points[0] ?? { x: padX, y: height - padY };
  const area = `${line} L ${last.x.toFixed(1)} ${height - padY} L ${start.x.toFixed(1)} ${height - padY} Z`;
  return { line, area, points };
}

export function AnalyticsView() {
  const showToast = useUIStore((s) => s.showToast);
  const { data, isLoading, isError } = useAnalytics();
  const sparkW = 520;
  const sparkH = 180;

  const STAGES: StageBar[] = data?.stages ?? [];
  const REVENUE: MonthPoint[] = data?.monthlyRevenue ?? [];
  const KPIS: Kpi[] = useMemo(() => {
    if (!data) {
      return [
        { label: 'Active matters', value: '—', delta: '', positive: true },
        { label: 'Billable hours (MTD)', value: '—', delta: '', positive: true },
        { label: 'Revenue YTD', value: '—', delta: '', positive: true },
        { label: 'Win rate', value: '—', delta: '', positive: true },
      ];
    }
    return [
      { label: 'Active matters',      value: String(data.kpis.activeMatters),    delta: '', positive: true },
      { label: 'Billable hours (MTD)', value: String(data.kpis.billableHoursMonth), delta: '', positive: true },
      { label: 'Revenue YTD',         value: formatLakh(data.kpis.revenueYtdInr), delta: '', positive: true },
      { label: 'Win rate',            value: `${data.kpis.winRatePct}%`,          delta: '', positive: true },
    ];
  }, [data]);

  const spark = useMemo(() => buildSparkline(REVENUE, sparkW, sparkH), [REVENUE]);
  const stageMax = useMemo(() => (STAGES.length === 0 ? 1 : Math.max(...STAGES.map((s) => s.count))), [STAGES]);
  const totalMatters = useMemo(() => STAGES.reduce((s, x) => s + x.count, 0), [STAGES]);
  const peak = useMemo<MonthPoint | null>(
    () => REVENUE.length === 0 ? null : REVENUE.reduce<MonthPoint>((a, b) => (b.value > a.value ? b : a), REVENUE[0]!),
    [REVENUE],
  );

  if (isError) {
    return (
      <div className="card" style={{ borderColor: 'var(--danger)' }}>
        <div className="heading-sm" style={{ marginBottom: 6 }}>Couldn’t load analytics</div>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="card">
        <span className="muted">Loading analytics<span className="blink" /></span>
      </div>
    );
  }

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Practice metrics</div>
          <h1 className="heading-xl">Analytics</h1>
        </div>
        <span className="spacer" />
        <button
          className="btn"
          type="button"
          onClick={async () => {
            if (!data) {
              showToast({ type: 'amber', text: 'Analytics still loading' });
              return;
            }
            const today = new Date().toISOString().slice(0, 10);
            const kpiRows = KPIS.map(
              (k) => `<tr><td>${escapeReportHtml(k.label)}</td><td class="num">${escapeReportHtml(k.value)}</td></tr>`,
            ).join('');
            const stageRows = STAGES.map(
              (s) => `<tr><td>${escapeReportHtml(s.label)}</td><td class="num">${s.count}</td></tr>`,
            ).join('') || '<tr><td colspan="2">No stage data.</td></tr>';
            const revenueRows = REVENUE.map(
              (r) => `<tr><td>${escapeReportHtml(r.label)}</td><td class="num">₹${r.value.toLocaleString('en-IN')} L</td></tr>`,
            ).join('') || '<tr><td colspan="2">No revenue data.</td></tr>';
            const html = `
              <h2>Key metrics</h2>
              <table><thead><tr><th>Metric</th><th class="num">Value</th></tr></thead><tbody>${kpiRows}</tbody></table>
              <h2>Matters by stage</h2>
              <table><thead><tr><th>Stage</th><th class="num">Count</th></tr></thead><tbody>${stageRows}</tbody></table>
              <h2>Revenue by month</h2>
              <table><thead><tr><th>Month</th><th class="num">Revenue</th></tr></thead><tbody>${revenueRows}</tbody></table>
            `;
            try {
              await exportPdf({
                title: 'Practice analytics',
                bodyHtml: html,
                dated: today,
                disclaimerHtml: null,
              });
            } catch (err) {
              showToast({ type: 'cobalt', text: err instanceof Error ? err.message : 'PDF export failed' });
            }
          }}
        >
          <Icon name="download" size={14} /> Export PDF
        </button>
      </div>

      <div className="stat-row">
        {KPIS.map((k) => (
          <div key={k.label}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>{k.label}</div>
            <div className="heading-xl tabular">{k.value}</div>
            {k.delta && (
              <div className="body-sm" style={{ color: k.positive ? 'var(--success)' : 'var(--danger)' }}>
                {k.delta}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ gap: 16 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="row">
            <div>
              <div className="heading-md">Matters by stage</div>
              <div className="body-sm muted">{totalMatters} active matters across the pipeline</div>
            </div>
          </div>
          {STAGES.length === 0 ? (
            <p className="body-sm muted">No stage data yet.</p>
          ) : (
            <div className="col" style={{ gap: 12 }}>
              {STAGES.map((stage) => {
                const pct = (stage.count / stageMax) * 100;
                const isPeak = stage.count === stageMax;
                return (
                  <div key={stage.label} className="col" style={{ gap: 6 }}>
                    <div className="row">
                      <span className="body-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                        {stage.label}
                      </span>
                      <span className="spacer" />
                      <span className="mono body-xs muted tabular">{stage.count}</span>
                    </div>
                    <div
                      style={{
                        position: 'relative',
                        height: 8,
                        background: 'var(--bg-surface-2)',
                        borderRadius: 'var(--radius-full)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: isPeak ? 'var(--info)' : 'var(--text-primary)',
                          borderRadius: 'var(--radius-full)',
                          transition: 'width 240ms ease',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="row">
            <div>
              <div className="heading-md">Revenue by month</div>
              <div className="body-sm muted">
                {peak ? `Trailing 12 months · peak ₹${peak.value}L in ${peak.label}` : 'No revenue logged yet.'}
              </div>
            </div>
          </div>
          {peak && (
            <div style={{ width: '100%', overflow: 'hidden' }}>
              <svg
                viewBox={`0 0 ${sparkW} ${sparkH}`}
                width="100%"
                height={sparkH}
                role="img"
                aria-label="Revenue by month sparkline"
              >
                <defs>
                  <linearGradient id="sparkArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--text-primary)" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="var(--text-primary)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line
                  x1={0}
                  x2={sparkW}
                  y1={sparkH - 12}
                  y2={sparkH - 12}
                  stroke="var(--border-subtle)"
                  strokeWidth={1}
                />
                <path d={spark.area} fill="url(#sparkArea)" />
                <path
                  d={spark.line}
                  fill="none"
                  stroke="var(--text-primary)"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {spark.points.map((p) => {
                  const isPeak = p.value === peak.value;
                  return (
                    <circle
                      key={p.label}
                      cx={p.x}
                      cy={p.y}
                      r={isPeak ? 4 : 2}
                      fill={isPeak ? 'var(--info)' : 'var(--text-primary)'}
                      stroke="var(--bg-surface)"
                      strokeWidth={1}
                    />
                  );
                })}
              </svg>
              <div className="row" style={{ marginTop: 8, gap: 0 }}>
                {spark.points.map((p) => (
                  <span
                    key={p.label}
                    className="mono body-xs muted"
                    style={{ flex: 1, textAlign: 'center' }}
                  >
                    {p.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
