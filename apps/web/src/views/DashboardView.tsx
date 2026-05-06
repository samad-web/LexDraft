import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useDashboard } from '@/hooks/useDashboard';
import { PillNav } from '@/components/PillNav';
import type { Alert, DocumentRecord, Hearing } from '@lexdraft/types';

type SectionId = 'today' | 'matters' | 'register' | 'practice';

interface DashboardViewProps {
  onNav: (view: string) => void;
}

const RAIL_ITEMS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: 'today',    label: 'Today' },
  { id: 'matters',  label: 'Matters' },
  { id: 'register', label: 'Register' },
  { id: 'practice', label: 'Practice' },
];

export function DashboardView({ onNav }: DashboardViewProps) {
  const [section, setSection] = useState<SectionId>('today');
  const { data, isLoading, isError, error } = useDashboard();

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });

  const firstName = (data?.user.name ?? '').split(' ')[0] ?? '';
  const greeting = firstName ? `Good morning, ${firstName}.` : 'Good morning.';
  const hearingCount = data?.hearings.length ?? 0;
  const alertCount = data?.alerts.length ?? 0;
  const lede = hearingCount === 0 && alertCount === 0
    ? 'Nothing on the bench today. A clean slate to draft, review, or open new matters.'
    : `${hearingCount} ${hearingCount === 1 ? 'hearing' : 'hearings'} listed today` +
      (alertCount > 0 ? `; ${alertCount} ${alertCount === 1 ? 'notice' : 'notices'} awaiting attention.` : '.');

  return (
    <div className="col stagger" style={{ gap: 0 }}>
      {/* MASTHEAD */}
      <div style={{ paddingBottom: 24, borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
            CHAMBERS DASHBOARD
          </span>
          <span className="spacer" />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
            {dateStr.toUpperCase()}
          </span>
        </div>
        <h1 className="display-lg" style={{ color: 'var(--text-primary)' }}>
          {greeting}
        </h1>
        <p className="lede" style={{ marginTop: 14, maxWidth: 760 }}>
          {lede}
        </p>
      </div>

      {/* SECTION RAIL */}
      <div style={{ paddingTop: 20, paddingBottom: 20, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <PillNav
          items={RAIL_ITEMS}
          value={section}
          onChange={setSection}
          ariaLabel="Dashboard sections"
        />
      </div>

      {isLoading && (
        <div className="card" style={{ marginTop: 16 }}>
          <span className="muted">Loading dashboard…</span>
        </div>
      )}
      {isError && (
        <div className="card" style={{ marginTop: 16, borderColor: 'var(--danger)' }}>
          <div className="heading-sm" style={{ marginBottom: 6 }}>Couldn’t load dashboard</div>
          <p className="body-sm muted">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      )}

      {data && section === 'today' && (
        <TodaySection
          hearings={data.hearings}
          alerts={data.alerts}
          recentDocs={data.recentDocs}
          stats={data.stats}
          onNav={onNav}
        />
      )}
      {data && section === 'matters'  && <MattersSection  onNav={onNav} />}
      {data && section === 'register' && <RegisterSection onNav={onNav} recentDocs={data.recentDocs} />}
      {data && section === 'practice' && <PracticeSection />}
    </div>
  );
}

/* ---------------------------------------------------------------- TODAY */

interface TodayProps {
  hearings: Hearing[];
  alerts: Alert[];
  recentDocs: DocumentRecord[];
  stats: { activeMatters: number; clients: number; unread: number; revenueFY: string };
  onNav: (view: string) => void;
}

function TodaySection({ hearings, alerts, recentDocs, stats, onNav }: TodayProps) {
  return (
    <>
      {/* PRIMARY ACTION */}
      <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        <div
          className="dash-primary"
          style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 48, alignItems: 'flex-start' }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>§ I — Today’s work</div>
            <h2 className="display-md" style={{ marginBottom: 16 }}>
              Begin a draft. <span style={{ color: 'var(--text-secondary)' }}>Or open one already started.</span>
            </h2>
            <p className="body-lg muted" style={{ maxWidth: 520, marginBottom: 28 }}>
              Indian-format document templates tuned to procedure. Speak the matter and the brief — a first draft will arrive in seconds.
            </p>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-lg" onClick={() => onNav('draft')}>
                Draft a new document <Icon name="arrow" size={14} />
              </button>
              <button type="button" className="btn btn-lg" onClick={() => onNav('review')}>
                Review a contract
              </button>
            </div>
          </div>

          {/* DRAFTS IN PROGRESS — empty state until persisted drafts exist */}
          <div>
            <div
              className="row"
              style={{
                marginBottom: 12,
                paddingBottom: 12,
                borderBottom: '1px solid var(--border-default)',
              }}
            >
              <span className="eyebrow">Drafts in progress</span>
              <span className="spacer" />
            </div>
            <p className="body-md muted" style={{ padding: '12px 0' }}>
              No drafts yet. Start one from the <a href="#" onClick={(e) => { e.preventDefault(); onNav('draft'); }}>Draft</a> tab and it will appear here.
            </p>
          </div>
        </div>
      </section>

      {/* TODAY'S CAUSE LIST */}
      <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        <SectionHeader number="§ II" title="Today’s cause list" trailing={`${hearings.length} LISTED`} />
        {hearings.length === 0 ? (
          <p className="body-md muted">No hearings scheduled.</p>
        ) : (
          <div className="col" style={{ gap: 0 }}>
            {hearings.map((h, i) => {
              const isNext = i === 0;
              return (
                <div
                  key={h.id ?? `${h.time}-${i}`}
                  className="hearing-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr auto',
                    gap: 28,
                    alignItems: 'center',
                    padding: '24px 0',
                    borderBottom: i < hearings.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    background: isNext ? 'var(--bg-surface-2)' : 'transparent',
                    margin: isNext ? '0 -24px' : 0,
                    paddingLeft: isNext ? 24 : 0,
                    paddingRight: isNext ? 24 : 0,
                    borderRadius: isNext ? 'var(--radius-lg)' : 0,
                  }}
                >
                  <div style={{ borderRight: '1px solid var(--border-subtle)', paddingRight: 20 }}>
                    <div className="display-md tabular" style={{ color: 'var(--text-primary)' }}>{h.time}</div>
                    <div className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)', marginTop: 4 }}>
                      HOURS · IST
                    </div>
                  </div>
                  <div>
                    {isNext && (
                      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                        <span className="dot dot-cobalt" />
                        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--info)', fontWeight: 600 }}>
                          NEXT
                        </span>
                      </div>
                    )}
                    <div className="heading-lg" style={{ marginBottom: 4 }}>
                      <em className="case-name">{h.case}</em>
                    </div>
                    <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                      <span className="body-sm">{h.purpose}</span>
                      <span style={{ width: 3, height: 3, background: 'var(--text-tertiary)', borderRadius: '50%' }} />
                      <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                        {h.court.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn" onClick={() => onNav('draft')}>Prepare brief</button>
                    <button type="button" className="btn btn-primary" onClick={() => onNav('cases')}>Open matter</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* TWO COLUMNS — Notices + Limitation */}
      <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="dash-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48 }}>
          <div>
            <SubHeader number="§ III" title="Notices to the bench" />
            {alerts.length === 0 ? (
              <p className="body-md muted">No outstanding notices.</p>
            ) : (
              <div className="col" style={{ gap: 0 }}>
                {alerts.map((a, i) => (
                  <div
                    key={a.id ?? i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 16,
                      padding: '16px 0',
                      borderBottom: i < alerts.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                    }}
                  >
                    <div
                      style={{
                        width: 32, height: 32,
                        border: '1px solid var(--border-default)',
                        color: 'var(--text-secondary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 500,
                        flexShrink: 0,
                        borderRadius: 'var(--radius-full)',
                      }}
                    >
                      !
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="heading-sm" style={{ marginBottom: 2 }}>{a.text}</div>
                      <div className="body-sm muted">{a.detail}</div>
                    </div>
                    <button type="button" className="btn btn-sm" onClick={() => onNav('cases')}>Open</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <div className="eyebrow">§ IV</div>
              <h3 className="heading-lg" style={{ marginLeft: 12 }}>Limitation index</h3>
            </div>
            <p className="body-md muted">
              No limitation data yet. Once matters are open and dated, the index will populate here.
            </p>
          </div>
        </div>
      </section>

      {/* DOCUMENT REGISTER */}
      <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
          <div className="eyebrow">§ V</div>
          <h2 className="heading-xl" style={{ marginLeft: 16 }}>Document register</h2>
          <span className="spacer" />
          <a
            href="/app/documents"
            onClick={(e) => { e.preventDefault(); onNav('documents'); }}
          >
            All entries
          </a>
        </div>
        {recentDocs.length === 0 ? (
          <p className="body-md muted">No documents yet.</p>
        ) : (
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>№</th>
                  <th>Title</th>
                  <th>Form</th>
                  <th>Matter</th>
                  <th style={{ textAlign: 'right' }}>Modified</th>
                </tr>
              </thead>
              <tbody>
                {recentDocs.map((d, i) => (
                  <tr key={d.id ?? i} onClick={() => onNav('documents')} style={{ cursor: 'pointer' }}>
                    <td className="mono tabular" style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {String(i + 1).padStart(3, '0')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Icon name="file" size={14} />
                        <span style={{ fontWeight: 500 }}>{d.name}</span>
                      </div>
                    </td>
                    <td><span className="badge">{d.type.toUpperCase()}</span></td>
                    <td className="muted"><em className="case-name">{d.case}</em></td>
                    <td className="mono tabular" style={{ textAlign: 'right', color: 'var(--text-tertiary)', fontSize: 12 }}>
                      {d.updated}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* MASTHEAD STATS */}
      <section style={{ padding: '32px 0' }}>
        <div className="stat-row">
          <StatCell n={String(stats.activeMatters)} label="Active matters" />
          <StatCell n={String(stats.clients)}       label="Clients of record" />
          <StatCell n={String(stats.unread)}        label="Open notices" />
          <StatCell n={stats.revenueFY}             label="Revenue · FY" />
        </div>
      </section>

      <style>{`
        @media (max-width: 900px) {
          .dash-primary { grid-template-columns: 1fr !important; gap: 32px !important; }
          .dash-2col    { grid-template-columns: 1fr !important; gap: 32px !important; }
          .hearing-row  { grid-template-columns: 1fr !important; gap: 16px !important; margin: 0 !important; padding-left: 0 !important; padding-right: 0 !important; background: transparent !important; }
          .hearing-row > div:first-child { border-right: none !important; padding-right: 0 !important; }
        }
      `}</style>
    </>
  );
}

/* ---------- Inline helpers (Today section) ---------- */

function SectionHeader({ number, title, trailing }: { number: string; title: string; trailing?: string }) {
  return (
    <div className="row" style={{ alignItems: 'flex-end', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
      <div className="eyebrow">{number}</div>
      <h2 className="heading-xl" style={{ marginLeft: 16 }}>{title}</h2>
      <span className="spacer" />
      {trailing && (
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
          {trailing}
        </span>
      )}
    </div>
  );
}

function SubHeader({ number, title }: { number: string; title: string }) {
  return (
    <div className="row" style={{ alignItems: 'flex-end', marginBottom: 20, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
      <div className="eyebrow">{number}</div>
      <h3 className="heading-lg" style={{ marginLeft: 12 }}>{title}</h3>
    </div>
  );
}

function StatCell({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div className="display-md tabular" style={{ marginBottom: 8, color: 'var(--text-primary)' }}>{n}</div>
      <div className="eyebrow">{label}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- MATTERS */

function MattersSection({ onNav }: { onNav: (view: string) => void }) {
  return (
    <section style={{ padding: '32px 0' }}>
      <div className="row" style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-xl">Active matters</h2>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => onNav('cases')}>
          Open a new matter
        </button>
      </div>
      <p className="body-md muted">
        Open the <a href="#" onClick={(e) => { e.preventDefault(); onNav('cases'); }}>Cases</a> tab to add and review matters. Active ones will surface here.
      </p>
    </section>
  );
}

/* ---------------------------------------------------------------- REGISTER */

function RegisterSection({ onNav, recentDocs }: { onNav: (view: string) => void; recentDocs: DocumentRecord[] }) {
  return (
    <section style={{ padding: '32px 0' }}>
      <div className="row" style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-xl">Document register</h2>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => onNav('draft')}>
          Begin new draft
        </button>
      </div>
      {recentDocs.length === 0 ? (
        <p className="body-md muted">
          No documents yet. Drafts will appear here once you generate or upload them.
        </p>
      ) : (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 56 }}>№</th>
                <th>Title</th>
                <th>Form</th>
                <th>Matter</th>
                <th style={{ textAlign: 'right' }}>Modified</th>
              </tr>
            </thead>
            <tbody>
              {recentDocs.map((d, i) => (
                <tr key={`${d.name}-${i}`} onClick={() => onNav('documents')} style={{ cursor: 'pointer' }}>
                  <td className="mono tabular" style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                    {String(i + 1).padStart(3, '0')}
                  </td>
                  <td style={{ fontWeight: 500 }}>{d.name}</td>
                  <td><span className="badge">{d.type.toUpperCase()}</span></td>
                  <td className="muted"><em className="case-name">{d.case}</em></td>
                  <td className="mono tabular" style={{ textAlign: 'right', color: 'var(--text-tertiary)', fontSize: 12 }}>
                    {d.updated}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- PRACTICE */

function PracticeSection() {
  return (
    <section style={{ padding: '32px 0' }}>
      <div className="row" style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-xl">Practice health</h2>
      </div>
      <p className="body-md muted">
        Practice health metrics will populate as you accumulate matters, billing entries, and limitation events.
      </p>
    </section>
  );
}
