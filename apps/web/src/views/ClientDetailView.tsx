import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import type { Case, Client, ClientStatus, DocumentRecord } from '@lexdraft/types';
import { useClients } from '@/hooks/useClients';
import { useCases } from '@/hooks/useCases';
import { useDocuments, useDeleteDocument } from '@/hooks/useDocuments';
import { casesForClient, normalizeClientName } from '@/lib/client-case-link';
import { NewDocumentModal } from '@/components/NewDocumentModal';
import { NewCaseModal } from '@/components/NewCaseModal';
import { Gate } from '@/components/Gate';
import { useConfirm } from '@/components/ConfirmDialog';
import { useUIStore } from '@/store/ui';
import { PageHeader } from '@/components/PageHeader';

// =============================================================================
// ClientDetailView - /app/clients/:id
//
// The client register (ClientsView) only listed clients with an inline
// expander. This is the dedicated destination: the client's profile plus
// every matter linked to them, each row opening the case detail. Matters are
// joined by normalised name via casesForClient() - the same helper the list
// uses, so the two surfaces never disagree on the count.
// =============================================================================

const STATUS_BADGE: Record<ClientStatus, { label: string; cls: string }> = {
  active:   { label: 'Active',   cls: 'cm-pill cm-pill--ink'  },
  prospect: { label: 'Prospect', cls: 'cm-pill cm-pill--line' },
  inactive: { label: 'Inactive', cls: 'cm-pill cm-pill--soft' },
};

const CASE_STATUS_BADGE: Record<string, string> = {
  Active:   'cm-pill cm-pill--ink',
  Pending:  'cm-pill cm-pill--line',
  Closed:   'cm-pill cm-pill--soft',
  Archived: 'cm-pill cm-pill--soft',
};

/** "2026-10-28" -> "28 Oct 2026"; free text (e.g. "just now") is shown as-is. */
function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('');
}

export function ClientDetailView(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: clients = [], isLoading, isError } = useClients();
  const cases = useCases();

  const client = useMemo<Client | undefined>(
    () => clients.find((c) => c.id === id),
    [clients, id],
  );

  const matters = useMemo<Case[]>(
    () => (client ? casesForClient(cases.data ?? [], client) : []),
    [cases.data, client],
  );

  // Per-client documents = every document filed against one of this client's
  // cases. Documents relate to a case by the `case` label string, so we match
  // a document's label against the set of this client's case titles (both
  // normalised, so casing/spacing differences don't drop a match).
  const documents = useDocuments();
  const deleteDocument = useDeleteDocument();
  const confirm = useConfirm();
  const showToast = useUIStore((s) => s.showToast);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  // The document row currently being deleted, so its button shows a spinner and
  // can't be double-fired. Cleared on success/error.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Delete a document (real uploaded file) after a confirm. Drafts have their
  // own delete path elsewhere, so this is gated to kind !== 'draft' at render.
  const handleDelete = async (d: DocumentRecord) => {
    if (!d.id) return;
    const ok = await confirm({
      title: 'Delete document?',
      message: `"${d.name}" will be permanently removed, including any attached file. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setDeletingId(d.id);
    deleteDocument.mutate(d.id, {
      onSuccess: () => {
        setDeletingId(null);
        showToast({ type: 'sage', text: `Deleted "${d.name}"` });
      },
      onError: (e) => {
        setDeletingId(null);
        const msg = e instanceof Error ? e.message : 'Could not delete the document';
        showToast({ type: 'vermillion', text: msg });
      },
    });
  };

  const clientDocs = useMemo<DocumentRecord[]>(() => {
    const titleKeys = new Set(matters.map((m) => normalizeClientName(m.title)));
    if (titleKeys.size === 0) return [];
    return (documents.data ?? []).filter((d) => {
      const label = normalizeClientName(d.case);
      return label !== '' && titleKeys.has(label);
    });
  }, [documents.data, matters]);

  // The upload modal files a document against a case label. Default to the
  // client's most recent matter; if they have none, the button is hidden.
  const defaultCaseLabel = matters[0]?.title ?? '';

  if (isLoading) {
    return (
      <div className="col cm-client" style={{ gap: 24 }} aria-busy="true">
        <div className="cm-profile">
          <div className="cm-hero">
            <Skeleton width={64} height={64} radius="pill" />
            <div className="col" style={{ gap: 10, flex: 1 }}>
              <Skeleton width="45%" height={28} />
              <Skeleton width="30%" height={14} />
            </div>
          </div>
        </div>
        <Skeleton width="100%" height={220} />
      </div>
    );
  }
  if (isError) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorState title="Couldn't load this client" description="Check your connection and try again." />
      </div>
    );
  }
  if (!client) {
    return (
      <div className="col stagger" style={{ gap: 20, padding: 8 }}>
        <PageHeader title="Client" back={{ label: 'Clients', to: '/app/clients' }} />
        <EmptyState icon="clients" title="Client not found" description="This client may have been deleted." />
      </div>
    );
  }

  const badge = STATUS_BADGE[client.status];
  const nextHearing = matters
    .map((m) => m.next)
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}/.test(d))
    .sort()
    .find((d) => d.slice(0, 10) >= new Date().toISOString().slice(0, 10));

  return (
    <div className="col stagger cm-client" style={{ gap: 24 }}>
      <PageHeader
        title={client.name}
        description="Client profile, linked cases and their documents."
        back={{ label: 'Clients', to: '/app/clients' }}
      />

      {/* Profile: monogram, name, status, then the key facts as figures. */}
      <section className="cm-profile" aria-label="Client profile">
        <div className="cm-hero">
          <span className="cm-avatar cm-avatar--lg" aria-hidden="true">{initialsOf(client.name)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="cm-label">{client.type} client</div>
            <div className="cm-hero-meta">
              <span className={badge.cls}>{badge.label}</span>
              {client.portalEnabled && (
                <span className="cm-pill cm-pill--line"><Icon name="check" size={11} /> Portal enabled</span>
              )}
              {client.email ? (
                <a className="cm-hero-mail" href={`mailto:${client.email}`}>
                  <Icon name="mail" size={13} /> {client.email}
                </a>
              ) : (
                <span className="cm-hero-mail">No contact email on file</span>
              )}
            </div>
          </div>
        </div>
        <div className="cm-kpis">
          <Fact label="Open matters" value={String(client.mattersOpen)} note="Live for this client" />
          <Fact label="Total matters" value={String(matters.length)} note="Linked by client name" />
          <Fact label="Documents" value={String(clientDocs.length)} note="Across their cases" />
          <Fact
            label="Last contact"
            value={formatDay(client.lastContact)}
            note={nextHearing ? `Next hearing ${formatDay(nextHearing)}` : 'No hearing listed'}
            text
          />
        </div>
      </section>

      {/* Matters */}
      <section className="card cm-section">
        <div className="cm-card-head">
          <h2 className="cm-card-title">Cases</h2>
          <span className="cm-label">
            {matters.length} {matters.length === 1 ? 'matter' : 'matters'}
          </span>
          <div className="cm-card-head-actions">
            <Gate feature="matter.create">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setNewCaseOpen(true)}>
                <Icon name="plus" size={12} /> New case
              </button>
            </Gate>
          </div>
        </div>

        {cases.isLoading ? (
          <div className="cm-section-state col" style={{ gap: 10 }}>
            <Skeleton width="100%" height={44} />
            <Skeleton width="100%" height={44} />
          </div>
        ) : cases.isError ? (
          <p className="cm-section-state body-sm">Could not load cases. Reload to retry.</p>
        ) : matters.length === 0 ? (
          <div className="cm-section-state">
            <EmptyState
              variant="inline"
              title="No cases on file for this client yet"
              description="Use “New case” above to open a matter for this client. It'll be prefilled with their name, and you can add the case content and files right there."
            />
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th className="col-hide-mobile">Court</th>
                <th className="col-hide-tablet">Stage</th>
                <th>Status</th>
                <th className="col-hide-tablet">Next hearing</th>
              </tr>
            </thead>
            <tbody>
              {matters.map((m) => (
                <tr
                  key={m.id}
                  className="cm-row-link"
                  onClick={() => navigate(`/app/cases/${m.id}`)}
                  title="Open case"
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/app/cases/${m.id}`); } }}
                >
                  <td>
                    <div className="cm-row-title">{m.title}</div>
                    <div className="mono cm-row-cnr">{m.cnr}</div>
                  </td>
                  <td className="cm-muted-cell col-hide-mobile">{m.court || '—'}</td>
                  <td className="cm-muted-cell col-hide-tablet">{m.stage || '—'}</td>
                  <td>
                    <span className={CASE_STATUS_BADGE[m.status] ?? 'cm-pill cm-pill--soft'}>{m.status}</span>
                  </td>
                  <td className="cm-date-cell col-hide-tablet">{formatDay(m.next)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Documents - aggregated across the client's cases */}
      <section className="card cm-section">
        <div className="cm-card-head">
          <h2 className="cm-card-title">Documents</h2>
          <span className="cm-label">
            {clientDocs.length} {clientDocs.length === 1 ? 'file' : 'files'}
          </span>
          {defaultCaseLabel && (
            <div className="cm-card-head-actions">
              <button type="button" className="btn btn-sm" onClick={() => setUploadOpen(true)}>
                <Icon name="upload" size={12} /> Upload
              </button>
            </div>
          )}
        </div>

        {documents.isLoading ? (
          <div className="cm-section-state col" style={{ gap: 10 }}>
            <Skeleton width="100%" height={44} />
          </div>
        ) : matters.length === 0 ? (
          <div className="cm-section-state col" style={{ gap: 12, alignItems: 'flex-start' }}>
            <EmptyState
              variant="inline"
              title="No documents yet"
              description="Documents attach to this client's cases. Open a case for this client first, then its files show up here."
            />
            <Gate feature="matter.create">
              <button type="button" className="btn btn-sm" onClick={() => setNewCaseOpen(true)}>
                <Icon name="plus" size={12} /> New case for this client
              </button>
            </Gate>
          </div>
        ) : clientDocs.length === 0 ? (
          <div className="cm-section-state">
            <EmptyState
              variant="inline"
              title="No documents on this client's cases yet"
              description="Use Upload to file the client's papers against one of their cases."
            />
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Document</th>
                <th className="col-hide-tablet">Type</th>
                <th className="col-hide-mobile">Case</th>
                <th className="col-hide-tablet">Updated</th>
                <th style={{ width: 44, textAlign: 'right' }} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {clientDocs.map((d) => (
                <tr key={d.id ?? `${d.name}-${d.case}`}>
                  <td>
                    <div className="cm-doc">
                      <span className="cm-doc-icon" aria-hidden>
                        <Icon name={d.kind === 'draft' ? 'draft' : 'documents'} size={14} />
                      </span>
                      <span className="cm-row-title">{d.name}</span>
                    </div>
                  </td>
                  <td className="col-hide-tablet"><span className="cm-pill cm-pill--soft">{d.type}</span></td>
                  <td className="cm-muted-cell col-hide-mobile"><em className="case-name">{d.case}</em></td>
                  <td className="cm-date-cell col-hide-tablet">{formatDay(d.updated)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {/* Drafts are deleted from the drafting surface, not here —
                        this row's delete only targets uploaded documents. */}
                    {d.kind !== 'draft' && d.id && (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        title={deletingId === d.id ? 'Deleting…' : `Delete ${d.name}`}
                        aria-label={`Delete ${d.name}`}
                        disabled={deletingId === d.id}
                        onClick={() => handleDelete(d)}
                        style={deletingId === d.id ? { opacity: 0.5 } : undefined}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {defaultCaseLabel && (
        <NewDocumentModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          defaultCase={defaultCaseLabel}
        />
      )}

      {/* Open a matter for this client - prefilled with their name so the
          advocate can add case content + files without retyping who it's for. */}
      <NewCaseModal
        open={newCaseOpen}
        onClose={() => setNewCaseOpen(false)}
        prefill={{ client: client.name }}
      />
    </div>
  );
}

function Fact({ label, value, note, text }: { label: string; value: string; note?: string; text?: boolean }): JSX.Element {
  return (
    <div className="cm-kpi">
      <div className="cm-kpi-label">{label}</div>
      <div className={`cm-kpi-value${text ? ' is-text' : ''}`}>{value}</div>
      {note && <div className="cm-kpi-note">{note}</div>}
    </div>
  );
}
