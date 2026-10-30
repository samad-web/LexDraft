/**
 * Read-only case page for a cross-firm co-counsel guest - the counterpart to
 * CaseDetailView, but deliberately a separate component: it consumes only
 * the guest-scoped /co-counsel/guest-cases/:caseId bundle (summary, hearings,
 * shared notes, document metadata), never the firm-scoped case hooks that
 * CaseDetailView uses. No edit affordances in Phase 1 - see co-counsel
 * handover plan for the Phase 2 write-access scope.
 * Styles: .cs-* (globals.css + styles/chambers/case.css).
 */

import { Link, useParams } from 'react-router-dom';
import { EmptyState, ErrorState, Icon, Skeleton } from '@lexdraft/ui';
import { useGuestCaseDetail } from '@/hooks/useCoCounsel';
import { PageHeader } from '@/components/PageHeader';

const BACK = { label: 'Co-Counsel', to: '/app/co-counsel' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function GuestNextDate({ next }: { next: string | null }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(next ?? '');
  if (!m) {
    return (
      <div className="cs-next is-empty">
        <div className="adv-eyebrow">Next hearing</div>
        <div className="cs-next-none">Not posted</div>
      </div>
    );
  }
  const [, y, mo, d] = m;
  const date = new Date(+y!, +mo! - 1, +d!);
  const now = new Date();
  const days = Math.round((date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
  const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' : days > 0 ? `In ${days} days` : `${-days} days ago`;
  return (
    <div className={`cs-next${days === 0 ? ' is-today' : ''}`} style={{ gridArea: 'next' }}>
      <div className="adv-eyebrow">Next hearing</div>
      <div className="cs-next-day">
        <span className="cs-next-d">{+d!}</span>
        <span className="cs-next-my">{MONTHS[+mo! - 1]} {y}</span>
      </div>
      <div className="cs-next-when">{WEEKDAYS[date.getDay()]} · <strong>{when}</strong></div>
    </div>
  );
}

export function GuestCaseDetailView() {
  const { caseId } = useParams<{ caseId: string }>();
  const { data, isLoading, isError } = useGuestCaseDetail(caseId);

  if (isLoading) {
    return (
      <div className="col cs" aria-busy="true">
        <section className="cs-hero cs-loading-hero" aria-label="Loading matter">
          <Skeleton width={160} height={11} />
          <Skeleton width="58%" height={32} />
          <Skeleton width="40%" height={14} />
        </section>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="col cs">
        <PageHeader title="Co-Counsel matter" back={BACK} />
        <ErrorState
          title="Can't open this matter"
          description="This handover may have been revoked, or the link is no longer valid."
        />
      </div>
    );
  }

  const { summary, hearings, notes, documents } = data;

  return (
    <div className="col stagger cs">
      <section className="cs-hero cs-guest-hero" aria-labelledby="guest-case-title">
        <div className="cs-hero-main">
          <Link to={BACK.to} className="adv-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
            <Icon name="chevron" size={12} style={{ transform: 'rotate(180deg)' }} /> {BACK.label}
          </Link>
          <div className="adv-eyebrow">Co-counsel matter · {summary.status}</div>
          <h1 id="guest-case-title" className="cs-hero-title"><em className="case-name">{summary.title}</em></h1>
          <p className="cs-hero-sub">
            Court: <strong>{summary.court}</strong>
            <span className="cs-hero-dot">·</span>
            Stage: <strong>{summary.stage}</strong>
          </p>
          <div className="cs-hero-tags">
            {summary.cnr && <span className="cs-hero-cnr">CNR <span className="mono">{summary.cnr}</span></span>}
            <span className="adv-pill">Handed to you by <strong>{summary.grantedBy}</strong></span>
          </div>
        </div>
        <GuestNextDate next={summary.nextHearing} />
      </section>

      <div className="cs-guest-note" role="note">
        <Icon name="shield" size={16} />
        <span>
          You have read-only access to this matter. You can view hearings, shared notes, and
          document names, but can&rsquo;t edit anything here yet.
        </span>
      </div>

      <div className="cs-guest-grid">
        <section className="card is-wide">
          <div className="cs-card-head">
            <div className="cs-card-titles"><h2 className="cs-card-title">Hearings</h2></div>
            <span className="cs-count">{hearings.length} on record</span>
          </div>
          {hearings.length === 0 ? (
            <p className="cs-muted">No hearings recorded yet.</p>
          ) : (
            <ul className="cs-lines">
              {hearings.map((h) => {
                const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(h.date ?? '');
                return (
                  <li key={h.id} className="cs-line">
                    <span className={`adv-dateblock${h.status === 'today' ? ' is-today' : ''}`} aria-hidden="true">
                      {m ? (
                        <>
                          <span className="adv-dateblock-m">{MONTHS[+m[2]! - 1]}</span>
                          <span className="adv-dateblock-d">{+m[3]!}</span>
                        </>
                      ) : <span className="adv-dateblock-d">–</span>}
                    </span>
                    <span className="cs-line-main">
                      <span className="cs-line-title">{h.purpose}</span>
                      <span className="cs-line-sub">
                        {h.date ?? 'No date'}{h.time ? ` · ${h.time}` : ''} · {h.court}
                      </span>
                    </span>
                    <span className="cs-line-end">
                      <span className={`cs-status ${h.status === 'today' ? 'is-ink' : h.status === 'upcoming' ? 'is-strong' : 'is-quiet'}`}>
                        {h.status === 'today' ? 'Today' : h.status === 'upcoming' ? 'Upcoming' : 'Past'}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="cs-card-head">
            <div className="cs-card-titles"><h2 className="cs-card-title">Documents</h2></div>
            <span className="cs-count">{documents.length}</span>
          </div>
          {documents.length === 0 ? (
            <p className="cs-muted">No documents shared yet.</p>
          ) : (
            <ul className="cs-lines">
              {documents.map((d) => (
                <li key={d.id} className="cs-line">
                  <span className="cs-line-icon" aria-hidden="true"><Icon name="documents" size={14} /></span>
                  <span className="cs-line-main">
                    <span className="cs-line-title">{d.name}</span>
                    <span className="cs-line-sub">{[d.type, d.updated].filter(Boolean).join(' · ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="cs-card-head">
            <div className="cs-card-titles"><h2 className="cs-card-title">Shared notes</h2></div>
            <span className="cs-count">{notes.length}</span>
          </div>
          {notes.length === 0 ? (
            <EmptyState
              variant="inline"
              icon="members"
              title="No shared notes"
              description="Private working notes from the referring firm aren't visible here - only notes they've marked as shared."
            />
          ) : (
            <div>
              {notes.map((n) => (
                <div key={n.id} className="cs-guest-noteitem">
                  {n.title && <div className="cs-note-title">{n.title}</div>}
                  <p>{n.body}</p>
                  <div className="cs-note-meta">
                    <strong>{n.authorName}</strong> · {new Date(n.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
