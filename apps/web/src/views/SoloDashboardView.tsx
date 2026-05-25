import { useState } from 'react';
import { Icon, Skeleton } from '@lexdraft/ui';
import { useDashboard } from '@/hooks/useDashboard';
import { useLimitations } from '@/hooks/useLimitations';
import { PillNav } from '@/components/PillNav';
import { DashboardEmptyState, type DashboardEmptyStateStep } from '@/components/DashboardEmptyState';
import { CaseloadHealthWidget } from '@/components/CaseloadHealthWidget';
import { MonthCalendarModal } from '@/components/MonthCalendarModal';
import { greetingFor } from '@/lib/greeting';
import { CaptureLeadCta } from '@/components/CaptureLeadCta';
import type { Alert, DocumentRecord, Hearing } from '@lexdraft/types';

type SectionId = 'today' | 'matters' | 'register' | 'practice';

interface SoloDashboardViewProps {
  onNav: (view: string) => void;
}

const RAIL_ITEMS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: 'today',    label: 'Today' },
  { id: 'matters',  label: 'Matters' },
  { id: 'register', label: 'Register' },
  { id: 'practice', label: 'Practice' },
];

export function SoloDashboardView({ onNav }: SoloDashboardViewProps) {
  const [section, setSection] = useState<SectionId>('today');
  // Lift calendar modal state to the outer component so the "Full calendar"
  // button can live next to the PillNav (always visible) rather than being
  // hidden inside the §II cause-list section.
  const [calendarOpen, setCalendarOpen] = useState(false);
  const { data, isLoading, isError, error } = useDashboard();
  // Limitations aren't part of /dashboard yet; pull from the dedicated endpoint
  // purely so the onboarding checklist can mark step 4 complete once one
  // exists. Cheap call - runs only on the dashboard view and gets cached.
  const limitationsQuery = useLimitations();

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });

  const firstName = (data?.user.name ?? '').split(' ')[0] ?? '';
  const greeting = greetingFor(firstName);
  const hearingCount = data?.hearings.length ?? 0;
  const alertCount = data?.alerts.length ?? 0;
  // Personal-dashboard tone: never sound hollow. With no hearings or
  // notices, frame the day as space for craft rather than absence of work.
  const lede = hearingCount === 0 && alertCount === 0
    ? 'A clear day for drafting, review, and the long thinking your matters deserve.'
    : `${hearingCount} ${hearingCount === 1 ? 'hearing' : 'hearings'} listed today` +
      (alertCount > 0 ? `; ${alertCount} ${alertCount === 1 ? 'notice' : 'notices'} awaiting attention.` : '.');

  // Empty-state detection: brand-new firm with no clients, matters, hearings,
  // or documents yet. Recent docs is a proxy for "any documents" - the Solo
  // dashboard summary doesn't carry a total count but the recent-N feed is
  // always non-empty when any docs exist (see firm.service.ts behaviour).
  const isEmptyChambers = Boolean(
    data &&
    (data.stats.activeMatters ?? 0) === 0 &&
    data.hearings.length === 0 &&
    data.recentDocs.length === 0 &&
    (data.stats.clients ?? 0) === 0,
  );

  const limitationCount = limitationsQuery.data?.length ?? 0;
  const emptyStateSteps: DashboardEmptyStateStep[] = data
    ? [
        {
          label: 'Add your first client',
          hint: 'Build a client of record. Matters and invoices hang off this.',
          link: '/app/clients',
          linkLabel: 'Add client',
          completed: (data.stats.clients ?? 0) > 0,
        },
        {
          label: 'Open your first matter',
          hint: 'Every hearing, document, and limitation belongs to a matter.',
          link: '/app/cases',
          linkLabel: 'Open matter',
          completed: (data.stats.activeMatters ?? 0) > 0,
        },
        {
          label: 'Generate a draft document',
          hint: 'Pick a template, speak the matter, get a first cut in seconds.',
          link: '/app/draft',
          linkLabel: 'Begin draft',
          completed: data.recentDocs.length > 0,
        },
        {
          label: 'Set a limitation period',
          hint: 'Track filing deadlines from day one so nothing slips.',
          link: '/app/limitation',
          linkLabel: 'Add limitation',
          completed: limitationCount > 0,
        },
      ]
    : [];

  return (
    <div className="col stagger" style={{ gap: 0 }}>
      {/* MASTHEAD */}
      <div style={{ paddingBottom: 24, borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
            CHAMBERS DASHBOARD · SOLO
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

      {data && isEmptyChambers && (
        <div style={{ paddingTop: 24 }}>
          <DashboardEmptyState
            plan="Solo"
            firstName={firstName}
            steps={emptyStateSteps}
          />
        </div>
      )}

      {/*
        Caseload-health widget - sits between the empty-state panel and
        the existing rail/widgets. Self-gated by the `caseload.health`
        feature; when the user lacks it, the underlying fetch errors and
        the widget renders nothing.
      */}
      {data && !isEmptyChambers && (
        <div style={{ paddingTop: 24, paddingBottom: 4 }}>
          <CaseloadHealthWidget />
        </div>
      )}

      {/* Calendar CTA - dedicated card row, unmissable. */}
      <div style={{ paddingTop: 24 }}>
        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '18px 22px',
            background: 'var(--bg-surface-2)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Month at a glance</div>
            <div className="heading-md" style={{ marginBottom: 2 }}>Cause-list calendar</div>
            <p className="body-sm muted" style={{ margin: 0 }}>
              Every matter posted for the month, day by day. Jump between months and drill into any day's listing.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => setCalendarOpen(true)}
            aria-label="Open full month calendar"
          >
            <Icon name="calendar" size={16} /> Open calendar
          </button>
        </div>
      </div>

      <div style={{ paddingTop: 20, paddingBottom: 20 }}>
        <PillNav
          items={RAIL_ITEMS}
          value={section}
          onChange={setSection}
          ariaLabel="Dashboard sections"
        />
      </div>
      <MonthCalendarModal open={calendarOpen} onClose={() => setCalendarOpen(false)} />

      {isLoading && (
        <div className="col" style={{ marginTop: 16, gap: 16 }} aria-busy="true" aria-label="Loading dashboard">
          <div className="grid-auto">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Skeleton width="50%" height={11} />
                <Skeleton width="35%" height={28} />
                <Skeleton width="70%" height={11} />
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton width="30%" height={14} />
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skeleton width="75%" height={13} />
                <Skeleton width="45%" height={11} />
              </div>
            ))}
          </div>
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
      {data && section === 'practice' && <PracticeSection onNav={onNav} />}
    </div>
  );
}

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
      <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
        {/* §I header + CTAs. The legacy "Drafts in progress" side panel
            lived in a 2-col layout; it only ever showed a "No drafts yet"
            placeholder because draft inventory isn't fetched here. On a
            personal Solo dashboard that empty-slot framing reads as a
            hollow inbox, so the layout is now single-column with the
            primary CTAs leading the section. */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>§ I - Today’s work</div>
          <h2 className="display-md" style={{ marginBottom: 16 }}>
            Begin a draft. <span style={{ color: 'var(--text-secondary)' }}>Or open one already started.</span>
          </h2>
          <p className="body-lg muted" style={{ maxWidth: 520, marginBottom: 28 }}>
            Indian-format document templates tuned to procedure. Speak the matter and the brief - a first draft will arrive in seconds.
          </p>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => onNav('draft')}>
              Draft a new document <Icon name="arrow" size={14} />
            </button>
            <button type="button" className="btn btn-lg" onClick={() => onNav('review')}>
              Review a contract
            </button>
            <CaptureLeadCta variant="prominent" />
          </div>
        </div>
      </section>

      {/* §II Cause list. Hidden entirely on a clear day — a "No hearings
          scheduled" placeholder reads like a blank inbox on the personal
          Solo dashboard. The masthead lede already speaks to a clear day. */}
      {hearings.length > 0 && (
        <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <SectionHeader number="§ II" title="Today’s cause list" trailing={`${hearings.length} LISTED`} />
          <div className="col" style={{ gap: 0 }}>
            {hearings.map((h, i) => {
              const isNext = i === 0;
              return (
                <div
                  key={h.id ?? `${h.time}-${i}`}
                  className="hearing-row"
                  style={{
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
        </section>
      )}

      {/* §III Notices. Renders only when there are real notices to act
          on. The legacy §IV "Limitation index" column is removed from
          this row — it never had data wired in, so it was always a
          placeholder ("No limitation data yet"), which is exactly the
          hollow framing the personal Solo view should avoid. */}
      {alerts.length > 0 && (
        <section style={{ padding: '40px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <SubHeader number="§ III" title="Notices to the bench" />
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
        </section>
      )}

      {/* §V Document register. Hidden when no documents — the primary
          "Draft a new document" CTA in §I and the Documents tab cover
          the start-from-scratch path; an empty register on the personal
          Solo dashboard would read as a hollow row of zeros. */}
      {recentDocs.length > 0 && (
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
        </section>
      )}

      <section style={{ padding: '32px 0' }}>
        <div className="stat-row">
          <StatCell n={String(stats.activeMatters)} label="Active matters" />
          <StatCell n={String(stats.clients)}       label="Clients of record" />
          <StatCell n={String(stats.unread)}        label="Open notices" />
          <StatCell n={stats.revenueFY}             label="Revenue · FY" />
        </div>
      </section>

      <section style={{ padding: '24px 0 40px' }}>
        <div
          className="card upgrade-cta"
          style={{
            background: 'var(--bg-surface-2)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Growing the chamber?</div>
            <div className="heading-md" style={{ marginBottom: 4 }}>Add a co-advocate with the Practice plan</div>
            <p className="body-sm muted" style={{ maxWidth: 520 }}>
              Two to eight seats, shared matters, member roster, and ten times the AI drafts each month. Move up any time - your existing matters and templates carry over.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => onNav('settings')}>
            See Practice plan
          </button>
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

function MattersSection({ onNav }: { onNav: (view: string) => void }) {
  // Tab body for the "Matters" pill. Matters live on the Cases page; this
  // tab is a launchpad rather than a redundant list. The previous body
  // read as an empty-state placeholder, which is the framing the Solo
  // dashboard should avoid.
  return (
    <section style={{ padding: '32px 0' }}>
      <div className="row" style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-xl">Active matters</h2>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={() => onNav('cases')}>
          Open a new matter
        </button>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-lg" onClick={() => onNav('cases')}>
          Open the matters register →
        </button>
        <button type="button" className="btn btn-lg btn-ghost" onClick={() => onNav('calendar')}>
          View the cause-list calendar
        </button>
      </div>
    </section>
  );
}

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
        // No "No documents yet" copy — the primary CTA above already
        // tells the user how to start, and a placeholder line here would
        // read as a hollow inbox on a personal dashboard.
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-lg" onClick={() => onNav('draft')}>
            Begin your first draft →
          </button>
          <button type="button" className="btn btn-lg btn-ghost" onClick={() => onNav('documents')}>
            Browse all documents
          </button>
        </div>
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

function PracticeSection({ onNav }: { onNav: (view: string) => void }) {
  // Practice tab body. Real practice-health metrics live behind plan
  // tiers that aggregate across team members; for Solo, the personal
  // dashboard surfaces them directly inside the relevant tools
  // (Limitation index, Cases, Invoices). Linking to those is more
  // useful than a placeholder line about future data.
  const go = (view: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    onNav(view);
  };
  return (
    <section style={{ padding: '32px 0' }}>
      <div className="row" style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-xl">Practice health</h2>
      </div>
      <p className="body-md muted" style={{ maxWidth: 540 }}>
        Limitation tracking, billing health, and matter throughput live with the tools that own them:
      </p>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
        <a className="btn btn-lg" href="/app/limitation" onClick={go('limitation')}>Limitation index</a>
        <a className="btn btn-lg" href="/app/invoices" onClick={go('invoices')}>Billing &amp; invoices</a>
        <a className="btn btn-lg" href="/app/cases" onClick={go('cases')}>Matters register</a>
      </div>
    </section>
  );
}
