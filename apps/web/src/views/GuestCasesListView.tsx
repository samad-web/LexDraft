/**
 * Co-Counsel list - cases another firm has handed to the current user via
 * a cross-firm handover (co-counsel.service.ts::case_guest_grants). Distinct
 * from CasesListView: these are read-only matters this user doesn't own,
 * shown separately so they're never confused with the advocate's own caseload.
 * Styles: .cs-* (globals.css + styles/chambers/case.css).
 */

import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, Icon, Skeleton } from '@lexdraft/ui';
import { useGuestCases } from '@/hooks/useCoCounsel';
import { PageHeader } from '@/components/PageHeader';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function GuestCasesListView() {
  const navigate = useNavigate();
  const { data: cases = [], isLoading, isError } = useGuestCases();
  const today = todayIso();

  return (
    <div className="col stagger cs">
      <PageHeader
        title="Co-Counsel"
        description="Matters other advocates have handed to you, with read-only access."
        meta={!isLoading && !isError ? `${cases.length} ${cases.length === 1 ? 'matter' : 'matters'}` : undefined}
      />

      {isLoading && (
        <div className="cs-list-card" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ padding: '18px 8px' }}>
              <Skeleton width={260} height={16} />
              <Skeleton width={160} height={12} style={{ marginTop: 10 }} />
            </div>
          ))}
        </div>
      )}

      {isError && (
        <ErrorState
          title="Couldn't load your co-counsel matters"
          description="Check your connection and try again."
        />
      )}

      {!isLoading && !isError && cases.length === 0 && (
        <EmptyState
          icon="cases"
          title="No matters handed to you yet"
          description="When another advocate can't attend a hearing and hands off their case to you, it will appear here."
        />
      )}

      {!isLoading && !isError && cases.length > 0 && (
        <div className="cs-list-card">
          <div className="cs-section-head">
            <span>Handed to you</span>
            <span className="cs-section-count">{cases.length}</span>
          </div>
          <ul className="cs-rows">
            {cases.map((c) => {
              const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(c.nextHearing ?? '');
              const isToday = c.nextHearing?.slice(0, 10) === today;
              const open = () => navigate(`/app/co-counsel/${c.caseId}`);
              const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
              };
              return (
                <li key={c.caseId}>
                  <div className="cs-row cs-grow" role="link" tabIndex={0} onClick={open} onKeyDown={onKey}>
                    <span className={`adv-dateblock cs-dateblock${isToday ? ' is-today' : ''}`} aria-hidden="true">
                      {m ? (
                        <>
                          <span className="adv-dateblock-m">{MONTHS[+m[2]! - 1]}</span>
                          <span className="adv-dateblock-d">{+m[3]!}</span>
                        </>
                      ) : <span className="adv-dateblock-d">–</span>}
                    </span>
                    <span className="cs-row-main">
                      <span className="cs-row-title"><em className="case-name">{c.title}</em></span>
                      <span className="cs-row-sub">{[c.court, c.stage].filter(Boolean).join(' · ')}</span>
                      <span className="cs-row-tags">
                        {c.cnr && <span className="cs-tag mono">{c.cnr}</span>}
                        <span className="cs-tag">Read-only</span>
                      </span>
                      <span className="cs-row-meta">
                        <span className="cs-when-inline">From {c.grantedBy}</span>
                      </span>
                    </span>
                    <span className="cs-col">
                      <span className="cs-count" style={{ display: 'block' }}>Handed over by</span>
                      <span className="cs-row-sub" style={{ display: 'block', marginTop: 3 }}>{c.grantedBy}</span>
                    </span>
                    <span className="cs-col cs-col-when">
                      <span className="cs-when">{c.nextHearing ? (isToday ? 'Today' : 'Next hearing') : 'No date'}</span>
                      {c.nextHearing && <span className="cs-when-date mono">{c.nextHearing}</span>}
                    </span>
                    <span className="cs-row-end"><Icon name="chevron" size={16} className="adv-chev" /></span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
