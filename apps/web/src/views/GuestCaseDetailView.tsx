/**
 * Read-only case page for a cross-firm co-counsel guest - the counterpart to
 * CaseDetailView, but deliberately a separate component: it consumes only
 * the guest-scoped /co-counsel/guest-cases/:caseId bundle (summary, hearings,
 * shared notes, document metadata), never the firm-scoped case hooks that
 * CaseDetailView uses. No edit affordances in Phase 1 - see co-counsel
 * handover plan for the Phase 2 write-access scope.
 */

import { useNavigate, useParams } from 'react-router-dom';
import { EmptyState, ErrorState, Icon, Skeleton } from '@lexdraft/ui';
import { useGuestCaseDetail } from '@/hooks/useCoCounsel';

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="btn btn-ghost" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
      <Icon name="chevron" size={14} style={{ transform: 'scaleX(-1)' }} /> Co-Counsel
    </button>
  );
}

export function GuestCaseDetailView() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useGuestCaseDetail(caseId);

  if (isLoading) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <BackButton onBack={() => navigate('/app/co-counsel')} />
        <Skeleton width={320} height={24} />
        <Skeleton width={200} height={14} />
        <div className="card" style={{ padding: 20, marginTop: 8 }}>
          <Skeleton width="100%" height={80} />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <BackButton onBack={() => navigate('/app/co-counsel')} />
        <ErrorState
          title="Can't open this matter"
          description="This handover may have been revoked, or the link is no longer valid."
        />
      </div>
    );
  }

  const { summary, hearings, notes, documents } = data;

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <BackButton onBack={() => navigate('/app/co-counsel')} />

      <div>
        <div className="row" style={{ gap: 10, marginBottom: 8 }}>
          <span className="badge badge-cobalt">{summary.cnr}</span>
          <span className="badge">{summary.status}</span>
          <span className="spacer" />
          <span className="body-xs muted">Handed to you by {summary.grantedBy}</span>
        </div>
        <h1 className="heading-xl">{summary.title}</h1>
        <p className="body-sm muted" style={{ marginTop: 6 }}>
          {summary.court} · {summary.stage}
          {summary.nextHearing ? ` · Next hearing ${summary.nextHearing}` : ''}
        </p>
      </div>

      <div
        className="card"
        style={{ padding: 16, background: 'var(--bg-surface-2)', display: 'flex', gap: 10, alignItems: 'center' }}
      >
        <Icon name="shield" size={16} />
        <span className="body-sm">
          You have read-only access to this matter. You can view hearings, shared notes, and
          document names, but can&rsquo;t edit anything here yet.
        </span>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <Icon name="calendar" size={16} />
          <h2 className="heading-md" style={{ marginLeft: 8 }}>Hearings</h2>
          <span className="spacer" />
          <span className="mono body-sm muted">{hearings.length}</span>
        </div>
        {hearings.length === 0 ? (
          <p className="body-sm muted">No hearings recorded yet.</p>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            {hearings.map((h) => (
              <div
                key={h.id}
                className="row"
                style={{ padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-base)', gap: 12 }}
              >
                <span className={`badge ${h.status === 'today' ? 'badge-amber' : h.status === 'past' ? 'badge' : 'badge-cobalt'}`}>
                  {h.status}
                </span>
                <span className="mono body-sm tabular">{h.date ?? 'No date'} · {h.time}</span>
                <span className="body-sm">{h.purpose}</span>
                <span className="spacer" />
                <span className="body-xs muted">{h.court}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <Icon name="documents" size={16} />
          <h2 className="heading-md" style={{ marginLeft: 8 }}>Documents</h2>
          <span className="spacer" />
          <span className="mono body-sm muted">{documents.length}</span>
        </div>
        {documents.length === 0 ? (
          <p className="body-sm muted">No documents shared yet.</p>
        ) : (
          <div className="col" style={{ gap: 8 }}>
            {documents.map((d) => (
              <div key={d.id} className="row" style={{ gap: 10, padding: '8px 0' }}>
                <Icon name="documents" size={14} />
                <span className="body-sm">{d.name}</span>
                <span className="body-xs muted">{d.type}</span>
                <span className="spacer" />
                <span className="body-xs muted">{d.updated}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <Icon name="members" size={16} />
          <h2 className="heading-md" style={{ marginLeft: 8 }}>Shared notes</h2>
          <span className="spacer" />
          <span className="mono body-sm muted">{notes.length}</span>
        </div>
        {notes.length === 0 ? (
          <EmptyState
            variant="inline"
            icon="members"
            title="No shared notes"
            description="Private working notes from the referring firm aren't visible here - only notes they've marked as shared."
          />
        ) : (
          <div className="col" style={{ gap: 14 }}>
            {notes.map((n) => (
              <div key={n.id} style={{ paddingLeft: 12, borderLeft: '2px solid var(--border-default)' }}>
                {n.title && <div className="body-sm" style={{ fontWeight: 500, marginBottom: 4 }}>{n.title}</div>}
                <p className="body-sm" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{n.body}</p>
                <div className="body-xs muted" style={{ marginTop: 6 }}>
                  {n.authorName} · {new Date(n.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
