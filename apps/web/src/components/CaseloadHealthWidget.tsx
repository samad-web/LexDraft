import { useCaseloadHealth, type CaseloadHealthBand, type CaseloadHealthSignal } from '@/hooks/useCaseloadHealth';

/**
 * Caseload-health widget for the Solo dashboard. Renders:
 *
 *   - a horizontal score bar (0-100), tinted by band
 *   - the band label (Healthy / Stretched / Overloaded)
 *   - up to 3 most-severe signals as chips
 *   - 1-2 short recommendation lines
 *
 * The widget is self-contained: it owns its own data fetch via
 * `useCaseloadHealth`, swallows loading & error states gracefully, and
 * renders nothing when the assess endpoint is forbidden (403 - feature
 * gated off for this user) so it never gets in the way.
 *
 * Visual language uses the global tokens: --success / --warning / --danger
 * for the three bands. No new colour names.
 */

const SEV_RANK: Record<CaseloadHealthSignal['severity'], number> = {
  critical: 0, warning: 1, info: 2,
};

const BAND_LABEL: Record<CaseloadHealthBand, string> = {
  healthy:    'Healthy',
  stretched:  'Stretched',
  overloaded: 'Overloaded',
};

function bandColor(band: CaseloadHealthBand): string {
  if (band === 'healthy')   return 'var(--success)';
  if (band === 'stretched') return 'var(--warning)';
  return 'var(--danger)';
}

function bandBg(band: CaseloadHealthBand): string {
  if (band === 'healthy')   return 'var(--success-bg)';
  if (band === 'stretched') return 'var(--warning-bg)';
  return 'var(--danger-bg)';
}

function severityColor(sev: CaseloadHealthSignal['severity']): string {
  if (sev === 'critical') return 'var(--danger)';
  if (sev === 'warning')  return 'var(--warning)';
  return 'var(--text-tertiary)';
}

function severityBg(sev: CaseloadHealthSignal['severity']): string {
  if (sev === 'critical') return 'var(--danger-bg)';
  if (sev === 'warning')  return 'var(--warning-bg)';
  return 'transparent';
}

export function CaseloadHealthWidget(): JSX.Element | null {
  const { data, isLoading, isError } = useCaseloadHealth();

  // Silent fail: a 403 (feature gated off) or transient network error
  // shouldn't ever block the rest of the dashboard. The widget is
  // additive, not load-bearing.
  if (isError) return null;

  if (isLoading || !data) {
    return (
      <section
        className="card"
        style={{
          padding: 20,
          borderColor: 'var(--border-default)',
        }}
        aria-busy="true"
        aria-label="Caseload health, loading"
      >
        <div className="eyebrow" style={{ marginBottom: 8 }}>Caseload health</div>
        <p className="body-sm muted">Reading the chambers pulse<span className="blink" /></p>
      </section>
    );
  }

  const score = Math.max(0, Math.min(100, Math.round(data.score)));
  const band = data.band;
  const accent = bandColor(band);
  const accentBg = bandBg(band);

  // Pick up to 3 signals, heaviest first. Stable secondary sort by value
  // so the order is deterministic across renders with the same data.
  const topSignals = [...data.signals]
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.value - a.value)
    .slice(0, 3);

  const recs = data.recommendations.slice(0, 2);

  return (
    <section
      className="card"
      aria-label="Caseload health summary"
      style={{
        padding: 20,
        borderColor: 'var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Caseload health</div>
          <div className="body-sm muted">A burnout-risk read on the chambers.</div>
        </div>
        <span className="spacer" />
        <span
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: '0.18em',
            color: accent,
            padding: '4px 10px',
            borderRadius: 'var(--radius-full)',
            background: accentBg,
            border: `1px solid ${accent}`,
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          {BAND_LABEL[band]}
        </span>
      </div>

      {/* Score bar */}
      <div>
        <div
          className="row"
          style={{ alignItems: 'baseline', marginBottom: 6 }}
          aria-label={`Health score ${score} of 100`}
        >
          <span
            className="display-md tabular mono"
            style={{ color: accent, lineHeight: 1 }}
          >
            {score}
          </span>
          <span className="muted body-sm" style={{ marginLeft: 6 }}>/ 100</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={score}
          style={{
            width: '100%',
            height: 8,
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-full)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${score}%`,
              height: '100%',
              background: accent,
              transition: 'width 200ms ease-out',
            }}
          />
        </div>
      </div>

      {/* Signals */}
      {topSignals.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {topSignals.map((s) => (
            <span
              key={s.key}
              title={s.message}
              aria-label={s.message}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px',
                fontSize: 12,
                lineHeight: 1.4,
                borderRadius: 'var(--radius-full)',
                background: severityBg(s.severity),
                color: severityColor(s.severity),
                border: `1px solid ${severityColor(s.severity)}`,
                fontWeight: 500,
              }}
            >
              <span style={{ fontWeight: 600 }}>{s.label}</span>
              <span className="mono tabular" style={{ opacity: 0.85 }}>{s.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Recommendations */}
      {recs.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)' }}>
          {recs.map((line, i) => (
            <li key={i} className="body-sm" style={{ marginBottom: 4 }}>
              {line}
            </li>
          ))}
        </ul>
      )}

      {topSignals.length === 0 && recs.length === 0 && (
        <p className="body-sm muted" style={{ margin: 0 }}>
          Nothing to flag. The chambers is running clean - keep it that way.
        </p>
      )}
    </section>
  );
}
