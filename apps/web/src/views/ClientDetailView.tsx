import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon, EmptyState, ErrorState } from '@lexdraft/ui';
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
  active:   { label: 'ACTIVE',   cls: 'badge-sage'   },
  prospect: { label: 'PROSPECT', cls: 'badge-cobalt' },
  inactive: { label: 'INACTIVE', cls: 'badge-cream'  },
};

const CASE_STATUS_BADGE: Record<string, string> = {
  Active:   'badge-sage',
  Pending:  'badge-cobalt',
  Closed:   'badge-cream',
  Archived: 'badge-cream',
};

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
    return <div className="muted" style={{ padding: 24 }}>Loading client…</div>;
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/app/clients')} style={{ alignSelf: 'flex-start' }}>
          <Icon name="arrow" size={14} /> Back to clients
        </button>
        <EmptyState title="Client not found" description="This client may have been deleted." />
      </div>
    );
  }

  const badge = STATUS_BADGE[client.status];

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/app/clients')} style={{ alignSelf: 'flex-start' }}>
        <Icon name="arrow" size={14} /> Back to clients
      </button>

      {/* Header */}
      <div className="row" style={{ gap: 16, alignItems: 'center' }}>
        <span className="avatar" aria-hidden="true" style={{ width: 48, height: 48, fontSize: 18 }}>
          {initialsOf(client.name)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Client</div>
          <h1 className="heading-xl" style={{ marginBottom: 6 }}>{client.name}</h1>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="badge badge-cobalt">{client.type.toUpperCase()}</span>
            <span className={`badge ${badge.cls}`}>{badge.label}</span>
            {client.portalEnabled && <span className="badge badge-sage">PORTAL ENABLED</span>}
          </div>
        </div>
      </div>

      {/* Contact facts */}
      <div className="card">
        <div className="grid-auto-sm" style={{ gap: 20 }}>
          <Fact label="EMAIL" value={client.email || '—'} />
          <Fact label="LAST CONTACT" value={client.lastContact || '—'} mono />
          <Fact label="OPEN MATTERS" value={String(client.mattersOpen)} mono />
          <Fact label="TOTAL MATTERS" value={String(matters.length)} mono />
        </div>
      </div>

      {/* Matters */}
      <div className="card">
        <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
          <h2 className="heading-md">Cases</h2>
          <span className="spacer" />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginRight: 12 }}>
            {matters.length} {matters.length === 1 ? 'MATTER' : 'MATTERS'}
          </span>
          <Gate feature="matter.create">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setNewCaseOpen(true)}>
              <Icon name="plus" size={12} /> New case
            </button>
          </Gate>
        </div>

        {cases.isLoading ? (
          <p className="body-sm muted">Loading cases…</p>
        ) : cases.isError ? (
          <p className="body-sm" style={{ color: 'var(--danger)' }}>Could not load cases. Reload to retry.</p>
        ) : matters.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No cases on file for this client yet"
            description="Use “New case” above to open a matter for this client. It'll be prefilled with their name, and you can add the case content and files right there."
          />
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
                  onClick={() => navigate(`/app/cases/${m.id}`)}
                  style={{ cursor: 'pointer' }}
                  title="Open case"
                  tabIndex={0}
                  role="button"
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/app/cases/${m.id}`); } }}
                >
                  <td>
                    <div style={{ fontWeight: 500 }}>{m.title}</div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{m.cnr}</div>
                  </td>
                  <td className="muted col-hide-mobile">{m.court || '—'}</td>
                  <td className="muted col-hide-tablet">{m.stage || '—'}</td>
                  <td>
                    <span className={`badge ${CASE_STATUS_BADGE[m.status] ?? 'badge-cream'}`}>
                      {m.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="mono tabular muted col-hide-tablet">{m.next || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Documents - aggregated across the client's cases */}
      <div className="card">
        <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
          <h2 className="heading-md">Documents</h2>
          <span className="spacer" />
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginRight: 12 }}>
            {clientDocs.length} {clientDocs.length === 1 ? 'FILE' : 'FILES'}
          </span>
          {defaultCaseLabel && (
            <button type="button" className="btn btn-sm" onClick={() => setUploadOpen(true)}>
              <Icon name="upload" size={12} /> Upload
            </button>
          )}
        </div>

        {documents.isLoading ? (
          <p className="body-sm muted">Loading documents…</p>
        ) : matters.length === 0 ? (
          <div className="col" style={{ gap: 12, alignItems: 'flex-start' }}>
            <EmptyState
              variant="inline"
              title="No documents yet"
              description="Documents attach to this client's cases. Open a case for this client first, then its files show up here."
            />
            <Gate feature="matter.create">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setNewCaseOpen(true)}>
                <Icon name="plus" size={12} /> New case for this client
              </button>
            </Gate>
          </div>
        ) : clientDocs.length === 0 ? (
          <EmptyState
            variant="inline"
            title="No documents on this client's cases yet"
            description="Use Upload to file the client's papers against one of their cases."
          />
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
                    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <Icon name={d.kind === 'draft' ? 'draft' : 'documents'} size={14} />
                      <span style={{ fontWeight: 500 }}>{d.name}</span>
                    </div>
                  </td>
                  <td className="col-hide-tablet"><span className="badge">{d.type}</span></td>
                  <td className="muted col-hide-mobile">{d.case}</td>
                  <td className="mono tabular muted col-hide-tablet">{d.updated}</td>
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
      </div>

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

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div>
      <div className="mono" style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-tertiary)', marginBottom: 6 }}>
        {label}
      </div>
      <div className={mono ? 'mono tabular' : ''} style={{ fontSize: 14, color: 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}
