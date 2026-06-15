import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { CaseApplication, ApplicationStatus } from '@lexdraft/types';
import { useCaseApplications, useDeleteApplication } from '@/hooks/useCaseApplications';
import { useUIStore } from '@/store/ui';
import { NewApplicationModal, APPLICATION_KIND_LABELS, APPLICATION_STATUS_LABELS } from './NewApplicationModal';

/** Status → accent colour for the pill. */
function statusColor(status: ApplicationStatus): string {
  switch (status) {
    case 'allowed':   return 'var(--success, #2f7d32)';
    case 'dismissed': return 'var(--danger, #b3261e)';
    case 'disposed':  return 'var(--info, #2563eb)';
    case 'withdrawn': return 'var(--text-tertiary)';
    case 'pending':
    default:          return 'var(--warning, #b45309)';
  }
}

export function ApplicationsPanel({ caseId }: { caseId: string }) {
  const apps = useCaseApplications(caseId);
  const del = useDeleteApplication(caseId);
  const showToast = useUIStore((s) => s.showToast);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CaseApplication | null>(null);

  const items = apps.data ?? [];

  function openNew() { setEditing(null); setModalOpen(true); }
  function openEdit(a: CaseApplication) { setEditing(a); setModalOpen(true); }

  function remove(a: CaseApplication) {
    del.mutate(a.id, {
      onSuccess: () => showToast({ type: 'sage', text: 'Application removed' }),
      onError: (e) => {
        const msg = (e as { response?: { data?: { error?: string } }; message?: string })
          ?.response?.data?.error ?? (e as Error).message ?? 'Could not remove application';
        showToast({ type: 'vermillion', text: msg });
      },
    });
  }

  return (
    <div>
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
        <h2 className="heading-lg">Applications</h2>
        <span className="spacer" />
        {items.length > 0 && (
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)', marginRight: 12 }}>
            {items.length} ON RECORD
          </span>
        )}
        <button type="button" className="btn btn-sm" onClick={openNew}>
          <Icon name="plus" size={12} /> Add application
        </button>
      </div>

      {apps.isLoading ? (
        <p className="body-md muted">Loading applications…</p>
      ) : items.length === 0 ? (
        <p className="body-md muted">
          No applications on record. Track interim applications, appeals, execution, review or bail here — each with its own status.
        </p>
      ) : (
        <div className="grid-2">
          {items.map((a) => (
            <div key={a.id} className="card" style={{ padding: 18 }}>
              <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <span className="badge">{APPLICATION_KIND_LABELS[a.kind]}</span>
                <span
                  className="mono"
                  style={{
                    fontSize: 10, letterSpacing: '0.14em', fontWeight: 600,
                    padding: '2px 8px', borderRadius: 'var(--radius-full)',
                    color: statusColor(a.status),
                    border: `1px solid ${statusColor(a.status)}`,
                  }}
                >
                  {APPLICATION_STATUS_LABELS[a.status].toUpperCase()}
                </span>
                <span className="spacer" />
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => openEdit(a)} aria-label="Edit application">
                  Edit
                </button>
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: 'var(--danger)' }}
                        disabled={del.isPending} onClick={() => remove(a)} aria-label="Remove application">
                  Remove
                </button>
              </div>
              <div className="heading-md" style={{ marginBottom: 4 }}>
                {a.label || APPLICATION_KIND_LABELS[a.kind]}
              </div>
              {a.appType && <div className="body-sm muted" style={{ marginBottom: 8 }}>{a.appType}</div>}
              <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                {a.filedOn && (
                  <span className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-tertiary)' }}>
                    FILED {a.filedOn}
                  </span>
                )}
                {a.orderOn && (
                  <span className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-tertiary)' }}>
                    ORDER {a.orderOn}
                  </span>
                )}
                {!a.visibleToPortal && (
                  <span className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-tertiary)' }}>
                    INTERNAL
                  </span>
                )}
              </div>
              {a.notes && <p className="body-sm" style={{ marginTop: 10, color: 'var(--text-secondary)' }}>{a.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <NewApplicationModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          caseId={caseId}
          existing={editing}
        />
      )}
    </div>
  );
}
