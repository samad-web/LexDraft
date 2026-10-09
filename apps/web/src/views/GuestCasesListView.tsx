/**
 * Co-Counsel list - cases another firm has handed to the current user via
 * a cross-firm handover (co-counsel.service.ts::case_guest_grants). Distinct
 * from CasesListView: these are read-only matters this user doesn't own,
 * shown separately so they're never confused with the advocate's own caseload.
 */

import { useNavigate } from 'react-router-dom';
import { EmptyState, ErrorState, Icon, Skeleton } from '@lexdraft/ui';
import { useGuestCases } from '@/hooks/useCoCounsel';

export function GuestCasesListView() {
  const navigate = useNavigate();
  const { data: cases = [], isLoading, isError } = useGuestCases();

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Cross-firm handovers</div>
        <h1 className="heading-xl">Co-Counsel</h1>
        <p className="body-sm muted" style={{ marginTop: 6 }}>
          Matters other advocates have handed to you. You have read-only access - hearings, shared
          notes, and documents - for exactly these cases.
        </p>
      </div>

      {isLoading && (
        <div className="col" style={{ gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="card" style={{ padding: 20 }}>
              <Skeleton width={220} height={16} />
              <Skeleton width={140} height={12} style={{ marginTop: 10 }} />
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
        <div className="col" style={{ gap: 12 }}>
          {cases.map((c) => (
            <div
              key={c.caseId}
              className="card card-hover"
              style={{ padding: 20, cursor: 'pointer' }}
              onClick={() => navigate(`/app/co-counsel/${c.caseId}`)}
            >
              <div className="row" style={{ gap: 10, marginBottom: 6 }}>
                <span className="badge badge-cobalt">{c.cnr}</span>
                <span className="spacer" />
                <span className="body-xs muted">From {c.grantedBy}</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{c.title}</div>
              <div className="body-sm muted">
                {c.court} · {c.stage}
                {c.nextHearing ? ` · Next hearing ${c.nextHearing}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
