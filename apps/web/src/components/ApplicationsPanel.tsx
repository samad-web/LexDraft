import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { CaseApplication, ApplicationStatus } from '@lexdraft/types';
import { useCaseApplications, useDeleteApplication } from '@/hooks/useCaseApplications';
import { useUIStore } from '@/store/ui';
import { NewApplicationModal, APPLICATION_KIND_LABELS, APPLICATION_STATUS_LABELS } from './NewApplicationModal';

/** Status -> ink treatment (strictly monochrome): filled once the court has
 *  ruled in our favour, outlined while open, quiet once closed otherwise. */
function statusClass(status: ApplicationStatus): string {
  switch (status) {
    case 'allowed':   return 'is-ink';
    case 'pending':   return 'is-strong is-dashed';
    case 'dismissed': return 'is-strong';
    case 'disposed':
    case 'withdrawn':
    default:          return 'is-quiet';
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
    <section>
      <div className="cs-apps-head">
        <div className="cs-card-titles">
          <h2 className="cs-card-title">Applications</h2>
          <p className="cs-card-sub">Interim applications, appeals, execution, review or bail, each with its own status.</p>
        </div>
        {items.length > 0 && <span className="cs-count">{items.length} on record</span>}
        <button type="button" className="btn btn-sm" onClick={openNew}>
          <Icon name="plus" size={12} /> Add application
        </button>
      </div>

      {apps.isLoading ? (
        <p className="cs-muted">Loading applications…</p>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="cs-muted">
            No applications on record. Track interim applications, appeals, execution, review or bail here, each with its own status.
          </p>
        </div>
      ) : (
        <div className="cs-apps">
          {items.map((a) => (
            <article key={a.id} className="card cs-app">
              <div className="cs-app-top">
                <span className="cs-app-kind">{APPLICATION_KIND_LABELS[a.kind]}</span>
                <span className={`cs-status ${statusClass(a.status)}`}>{APPLICATION_STATUS_LABELS[a.status]}</span>
                <span className="cs-app-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(a)} aria-label="Edit application">
                    Edit
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm"
                          disabled={del.isPending} onClick={() => remove(a)} aria-label="Remove application">
                    Remove
                  </button>
                </span>
              </div>
              <h3 className="cs-app-title">{a.label || APPLICATION_KIND_LABELS[a.kind]}</h3>
              {a.appType && <div className="cs-app-type">{a.appType}</div>}
              {(a.filedOn || a.orderOn || !a.visibleToPortal) && (
                <div className="cs-app-dates">
                  {a.filedOn && <span>Filed <strong>{a.filedOn}</strong></span>}
                  {a.orderOn && <span>Order <strong>{a.orderOn}</strong></span>}
                  {!a.visibleToPortal && <span>Internal · not on client portal</span>}
                </div>
              )}
              {a.notes && <p className="cs-app-notes">{a.notes}</p>}
            </article>
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
    </section>
  );
}
