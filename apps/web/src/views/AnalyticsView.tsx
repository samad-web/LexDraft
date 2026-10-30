import { useMemo } from 'react';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import { useAnalytics } from '@/hooks/useAnalytics';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { PageHeader } from '@/components/PageHeader';

const ANALYTICS_DESC = 'Key practice numbers: matters by stage and revenue by month.';

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
        { label: 'Active matters', value: '-', delta: '', positive: true },
        { label: 'Billable hours (MTD)', value: '-', delta: '', positive: true },
        { label: 'Revenue YTD', value: '-', delta: '', positive: true },
        { label: 'Win rate', value: '-', delta: '', positive: true },
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
      <div className="col stagger fm-view fm-analytics">
        <PageHeader title="Firm Analytics" description={ANALYTICS_DESC} />
        <ErrorState
          title="Couldn't load analytics"
          description="Check your connection and retry. If the issue persists, the metrics service may be offline."
        />
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="col stagger fm-view fm-analytics">
        <PageHeader title="Firm Analytics" description={ANALYTICS_DESC} />
        <div className="fm-kpis">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="fm-kpi" style={{ gap: 12 }}>
              <Skeleton width={120} height={12} />
              <Skeleton width={88} height={34} />
            </div>
          ))}
        </div>
        <div className="fm-grid-2">
          <div className="fm-panel"><Skeleton width="100%" height={220} /></div>
          <div className="fm-panel"><Skeleton width="100%" height={220} /></div>
        </div>
      </div>
    );
  }
  if (!data || (KPIS.every((k) => k.value === '-' || k.value === '0') && STAGES.length === 0 && REVENUE.length === 0)) {
    return (
      <div className="col stagger fm-view fm-analytics">
        <PageHeader title="Firm Analytics" description={ANALYTICS_DESC} />
        <EmptyState
          icon="analytics"
          title="No analytics yet"
          description="Once you log matters, hearings, and invoices, this view will show your practice trends."
        />
      </div>
    );
  }

  return (
    <div className="col stagger fm-view fm-analytics">
      <PageHeader
        title="Firm Analytics"
        description={ANALYTICS_DESC}
        actions={
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
        }
      />

      <div className="fm-kpis">
        {KPIS.map((k) => (
          <div key={k.label} className="fm-kpi">
            <span className="fm-kpi-label">{k.label}</span>
            <span className="fm-kpi-value">{k.value}</span>
            {k.delta && <span className="fm-kpi-hint">{k.delta}</span>}
          </div>
        ))}
      </div>

      <div className="fm-grid-2 is-stretch">
        <div className="fm-panel">
          <div className="fm-panel-head">
            <div>
              <div className="fm-eyebrow">Pipeline</div>
              <h2 className="fm-panel-title">Matters by stage</h2>
              <p className="fm-panel-sub">{totalMatters} active matters across the pipeline</p>
            </div>
          </div>
          {STAGES.length === 0 ? (
            <p className="fm-quiet">No stage data yet.</p>
          ) : (
            <div className="fm-stage-list">
              {STAGES.map((stage) => {
                const pct = (stage.count / stageMax) * 100;
                const isPeak = stage.count === stageMax;
                return (
                  <div key={stage.label} className="fm-stage">
                    <span className="fm-stage-label" style={isPeak ? { color: 'var(--text-primary)', fontWeight: 600 } : undefined}>
                      {stage.label}
                    </span>
                    <div className={`fm-bar${isPeak ? '' : ' is-soft'}`} aria-hidden>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <span className="fm-stage-count">{stage.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="fm-panel">
          <div className="fm-panel-head">
            <div>
              <div className="fm-eyebrow">Revenue · ₹ lakh</div>
              <h2 className="fm-panel-title">Revenue by month</h2>
              <p className="fm-panel-sub">
                {peak ? `Trailing 12 months · peak ₹${peak.value}L in ${peak.label}` : 'No revenue logged yet.'}
              </p>
            </div>
          </div>
          {peak && (
            <div style={{ width: '100%', overflow: 'hidden' }}>
              <svg
                className="fm-chart"
                viewBox={`0 0 ${sparkW} ${sparkH}`}
                width="100%"
                height={sparkH}
                role="img"
                aria-label="Revenue by month sparkline"
              >
                {[0.33, 0.66].map((t) => (
                  <line
                    key={t}
                    x1={0}
                    x2={sparkW}
                    y1={sparkH * t}
                    y2={sparkH * t}
                    stroke="var(--border-subtle)"
                    strokeWidth={1}
                    strokeDasharray="2 4"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                <line
                  x1={0}
                  x2={sparkW}
                  y1={sparkH - 12}
                  y2={sparkH - 12}
                  stroke="var(--border-default)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <path d={spark.area} fill="var(--bg-surface-2)" />
                <path
                  d={spark.line}
                  fill="none"
                  stroke="var(--text-primary)"
                  strokeWidth={1.75}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {spark.points.map((p) => {
                  const isPeak = p.value === peak.value;
                  return (
                    <circle
                      key={p.label}
                      cx={p.x}
                      cy={p.y}
                      r={isPeak ? 4.5 : 2.5}
                      fill={isPeak ? 'var(--text-primary)' : 'var(--bg-surface)'}
                      stroke="var(--text-primary)"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
              </svg>
              <div className="fm-chart-cap">
                {spark.points.map((p) => (
                  <span key={p.label} className={p.value === peak.value ? 'is-peak' : undefined}>
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
