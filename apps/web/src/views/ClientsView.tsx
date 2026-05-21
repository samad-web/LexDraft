import { Fragment, useMemo, useState } from 'react';
import { Icon, EmptyState, ErrorState } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import { useSavedFilter } from '@/hooks/useSavedFilter';
import type { Case, Client, ClientType, ClientStatus } from '@lexdraft/types';
import { useClients, useDeleteClient } from '@/hooks/useClients';
import { useCases } from '@/hooks/useCases';
import { NewClientModal } from '@/components/NewClientModal';
import { Gate } from '@/components/Gate';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { useAlert, useConfirm } from '@/components/ConfirmDialog';
import { useUIStore } from '@/store/ui';
import {
  useEnableClientPortal,
  useDisableClientPortal,
  useRegenerateClientPortalPassword,
} from '@/hooks/usePortalAdmin';

interface ClientRow extends Client {
  initials: string;
}

type FilterId = 'all' | ClientType;
const FILTER_IDS: ReadonlyArray<FilterId> = ['all', 'Individual', 'Corporate', 'Govt'];

interface FilterOption {
  id: FilterId;
  label: string;
}

const FILTERS: ReadonlyArray<FilterOption> = [
  { id: 'all',        label: 'All' },
  { id: 'Individual', label: 'Individual' },
  { id: 'Corporate',  label: 'Corporate' },
  { id: 'Govt',       label: 'Govt' },
];

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');
}

const STATUS_BADGE: Record<ClientStatus, { label: string; cls: string }> = {
  active:   { label: 'ACTIVE',   cls: 'badge-sage'    },
  prospect: { label: 'PROSPECT', cls: 'badge-cobalt'  },
  inactive: { label: 'INACTIVE', cls: 'badge-cream'   },
};

export function ClientsView() {
  const [filter, setFilter] = useSavedFilter<FilterId>('clients.filter', 'all', (raw) =>
    typeof raw === 'string' && (FILTER_IDS as ReadonlyArray<string>).includes(raw) ? (raw as FilterId) : null,
  );
  const [q, setQ] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  /** Set when the user clicks Edit on a row — drives the same modal in
   *  edit mode. `null` means "create" mode. */
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const { data: clients = [], isLoading, isError } = useClients();
  // Fetch all the firm's cases up-front so the expandable matters row
  // renders instantly on click. The list is bounded by firm size, and
  // TanStack Query caches it across visits, so the extra call is cheap.
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const cases = useCases();
  const enable = useEnableClientPortal();
  const disable = useDisableClientPortal();
  const regenerate = useRegenerateClientPortalPassword();
  const remove = useDeleteClient();
  const showToast = useUIStore((s) => s.showToast);
  const alertDialog = useAlert();
  const confirmDialog = useConfirm();
  const [busyClientId, setBusyClientId] = useState<string | null>(null);

  function openEdit(client: Client): void {
    setEditingClient(client);
    setModalOpen(true);
  }

  function closeModal(): void {
    setModalOpen(false);
    // Defer clearing the edit context until the close animation finishes
    // so the title doesn't flash from "Edit …" to "Add a client" mid-fade.
    window.setTimeout(() => setEditingClient(null), 180);
  }

  async function onDelete(client: Client): Promise<void> {
    const ok = await confirmDialog({
      title: `Delete ${client.name}?`,
      message:
        client.mattersOpen > 0
          ? `This client has ${client.mattersOpen} open matter${client.mattersOpen === 1 ? '' : 's'}. Their matters won't be deleted, but the link between cases and this client record will break. This can't be undone.`
          : 'This removes the client from your register. Cases that mention them by name stay where they are. This cannot be undone.',
      confirmLabel: 'Delete client',
      danger: true,
    });
    if (!ok) return;
    setBusyClientId(client.id);
    try {
      await remove.mutateAsync(client.id);
      showToast({ type: 'sage', text: `Client "${client.name}" deleted` });
    } catch (e) {
      await alertDialog({
        title: 'Could not delete client',
        message: (e as Error).message,
        tone: 'danger',
      });
    } finally {
      setBusyClientId(null);
    }
  }

  function toggleExpand(clientId: string): void {
    setExpandedClientId((cur) => (cur === clientId ? null : clientId));
  }

  async function onEnable(client: ClientRow): Promise<void> {
    setBusyClientId(client.id);
    try {
      const res = await enable.mutateAsync(client.id);
      if (res.password) {
        await alertDialog({
          title: 'Portal enabled · share these sign-in credentials',
          message:
            `Share these credentials with ${client.name} so they can sign in to their dashboard.\n\n`
            + `Email: ${client.email ?? '(no email on file)'}\n`
            + `Password: ${res.password}\n\n`
            + `This is a default password — note it down or share it now. `
            + `You can reset it any time from this page.`,
          tone: 'success',
        });
      } else {
        await alertDialog({
          title: 'Portal enabled',
          message: 'The client can now sign in. Use "Reset password" to generate a fresh password to share.',
          tone: 'success',
        });
      }
    } catch (e) {
      await alertDialog({
        title: 'Could not enable the portal',
        message:
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? (e as Error).message,
        tone: 'danger',
      });
    } finally {
      setBusyClientId(null);
    }
  }

  async function onDisable(clientId: string): Promise<void> {
    const ok = await confirmDialog({
      title: 'Disable portal access?',
      message: 'Active sessions for this client will be revoked.',
      confirmLabel: 'Disable',
      danger: true,
    });
    if (!ok) return;
    setBusyClientId(clientId);
    try { await disable.mutateAsync(clientId); }
    catch (e) {
      await alertDialog({
        title: 'Could not disable the portal',
        message: (e as Error).message,
        tone: 'danger',
      });
    }
    finally { setBusyClientId(null); }
  }

  async function onRegeneratePassword(client: ClientRow): Promise<void> {
    setBusyClientId(client.id);
    try {
      const res = await regenerate.mutateAsync(client.id);
      if (res.password) {
        await alertDialog({
          title: 'New password generated',
          message:
            `Share this fresh password with ${client.name} — the previous one no longer works.\n\n`
            + `Email: ${client.email ?? '(no email on file)'}\n`
            + `Password: ${res.password}`,
          tone: 'success',
        });
      } else {
        await alertDialog({
          title: 'Password reset',
          message: 'The previous password has been invalidated.',
          tone: 'success',
        });
      }
    } catch (e) {
      await alertDialog({
        title: 'Could not reset the password',
        message:
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? (e as Error).message,
        tone: 'danger',
      });
    } finally {
      setBusyClientId(null);
    }
  }

  const rows = useMemo<ClientRow[]>(
    () => clients.map((c) => ({ ...c, initials: initialsOf(c.name) })),
    [clients],
  );

  const visible = useMemo<ReadonlyArray<ClientRow>>(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (filter !== 'all' && c.type !== filter) return false;
      if (needle && !c.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [filter, q, rows]);

  const pager = usePagination(visible);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Register of clients</div>
        <h1 className="heading-xl">Clients</h1>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 360 }}>
          <input
            type="search"
            className="input"
            style={{ paddingLeft: 36 }}
            placeholder="Search by client name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search clients"
          />
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-tertiary)',
              display: 'inline-flex',
            }}
          >
            <Icon name="search" size={14} />
          </span>
        </div>
        <span className="spacer" />
        <Gate feature="client.create">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModalOpen(true)}
          >
            <Icon name="plus" size={14} /> Add client
          </button>
        </Gate>
      </div>
      <NewClientModal open={modalOpen} onClose={closeModal} existing={editingClient} />
      <Gate feature="client.create">
        <FAB ariaLabel="Add client" onClick={() => setModalOpen(true)}>
          <Icon name="plus" size={22} />
        </FAB>
      </Gate>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`chip ${filter === f.id ? 'active' : ''}`}
            aria-pressed={filter === f.id}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Client</th>
              <th>Type</th>
              <th>Matters open</th>
              <th>Last contact</th>
              <th>Status</th>
              <th>Portal</th>
              <th aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7}>
                  <div className="col" style={{ padding: '28px 8px', alignItems: 'center' }}>
                    <span className="muted">Loading clients<span className="blink" /></span>
                  </div>
                </td>
              </tr>
            )}
            {isError && !isLoading && (
              <tr>
                <td colSpan={7}>
                  <ErrorState
                    variant="inline"
                    title="Couldn't load clients"
                    description="Check your connection and try again."
                  />
                </td>
              </tr>
            )}
            {!isLoading && !isError && visible.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState
                    variant="inline"
                    title={rows.length === 0 ? 'No clients yet' : 'No clients match'}
                    description={
                      rows.length === 0
                        ? 'Add your first client to populate the register.'
                        : 'Try a different search or filter.'
                    }
                  />
                </td>
              </tr>
            )}
            {pager.slice.map((c) => {
              const badge = STATUS_BADGE[c.status];
              const isExpanded = expandedClientId === c.id;
              // Match cases by client name — the schema relates them via
              // the freeform `cases.client` string, not an FK. Lower-case
              // compare to absorb stray casing differences between the
              // two tables (entered by different forms over time).
              const clientMatters = (cases.data ?? []).filter(
                (m) => m.client.trim().toLowerCase() === c.name.trim().toLowerCase(),
              );
              return (
                <Fragment key={c.id}>
                  <tr>
                    <td>
                      <div className="row" style={{ gap: 12 }}>
                        <span className="avatar" aria-hidden="true">{c.initials}</span>
                        <div>
                          <div style={{ fontWeight: 500 }}>{c.name}</div>
                          <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                            {c.id.toUpperCase()}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><span className="badge badge-cobalt">{c.type.toUpperCase()}</span></td>
                    <td>
                      {/* Click-to-expand. Shows the count, plus a chevron
                          and (when expanded) the matter list inline. We
                          surface the cases.data count when available so
                          the live join number doesn't drift from the
                          cached `mattersOpen` (which is open-only). */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(c.id)}
                        className="btn btn-ghost btn-sm"
                        aria-expanded={isExpanded}
                        aria-controls={`matters-${c.id}`}
                        title={isExpanded ? 'Hide matters' : 'Show matters'}
                        style={{ padding: '0 var(--space-2)', gap: 6 }}
                      >
                        <span className="mono tabular">
                          {cases.isLoading ? c.mattersOpen : clientMatters.length}
                        </span>
                        <Icon name={isExpanded ? 'chevronD' : 'chevron'} size={12} />
                      </button>
                    </td>
                    <td className="mono tabular muted">{c.lastContact}</td>
                    <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                    <td>
                      {c.portalEnabled ? (
                        <Gate feature="client.create">
                          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                            <span className="badge badge-sage">ENABLED</span>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={busyClientId === c.id}
                              onClick={() => onRegeneratePassword(c)}
                              title="Generate a fresh password"
                            >
                              Reset password
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              disabled={busyClientId === c.id}
                              onClick={() => onDisable(c.id)}
                              title="Revoke portal access"
                            >
                              Disable
                            </button>
                          </div>
                        </Gate>
                      ) : (
                        <Gate feature="client.create">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            disabled={busyClientId === c.id || !c.email}
                            onClick={() => onEnable(c)}
                            title={!c.email ? 'Add a contact email first' : 'Enable portal access'}
                          >
                            Enable
                          </button>
                        </Gate>
                      )}
                    </td>
                    <td>
                      <Gate feature="client.create">
                        <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyClientId === c.id}
                            onClick={() => openEdit(c)}
                            title="Edit client"
                            aria-label={`Edit ${c.name}`}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyClientId === c.id}
                            onClick={() => void onDelete(c)}
                            title="Delete client"
                            aria-label={`Delete ${c.name}`}
                            style={{ color: 'var(--danger)' }}
                          >
                            Delete
                          </button>
                        </div>
                      </Gate>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr id={`matters-${c.id}`}>
                      <td colSpan={7} style={{ background: 'var(--bg-surface-2)', padding: 0 }}>
                        <ClientMattersPanel
                          loading={cases.isLoading}
                          error={cases.isError}
                          matters={clientMatters}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination
        page={pager.page}
        totalPages={pager.totalPages}
        total={pager.total}
        pageSize={pager.pageSize}
        onChange={pager.setPage}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClientMattersPanel
//
// Inline list of the matters a client is on, rendered under the client's row
// when the user expands them. We deliberately keep this surface small —
// title, court, stage, status, next hearing — so it reads like a quick
// reference, not a second cases table.
// ---------------------------------------------------------------------------

const CASE_STATUS_BADGE: Record<string, string> = {
  Active:   'badge-sage',
  Pending:  'badge-cobalt',
  Closed:   'badge-cream',
  Archived: 'badge-cream',
};

function ClientMattersPanel(props: {
  loading: boolean;
  error: boolean;
  matters: ReadonlyArray<Case>;
}): JSX.Element {
  if (props.loading) {
    return (
      <div className="muted body-sm" style={{ padding: '16px 20px' }}>
        Loading matters…
      </div>
    );
  }
  if (props.error) {
    return (
      <div className="body-sm" style={{ padding: '16px 20px', color: 'var(--danger)' }}>
        Could not load matters. Reload to retry.
      </div>
    );
  }
  if (props.matters.length === 0) {
    return (
      <div className="muted body-sm" style={{ padding: '16px 20px' }}>
        No matters on file for this client yet.
      </div>
    );
  }
  return (
    <div style={{ padding: '12px 16px 16px' }}>
      <div
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: '0.12em',
          color: 'var(--text-tertiary)',
          marginBottom: 10,
        }}
      >
        MATTERS · {props.matters.length}
      </div>
      <div className="stack-2" style={{ fontSize: 13 }}>
        <div className="clients-row clients-row-head hide-mobile" aria-hidden>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-tertiary)' }}>TITLE</div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-tertiary)' }}>COURT</div>
          <div className="mono clients-cell-hide-tablet" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-tertiary)' }}>STAGE</div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-tertiary)' }}>STATUS</div>
          <div className="mono clients-cell-hide-tablet" style={{ fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-tertiary)' }}>NEXT HEARING</div>
        </div>
        {props.matters.map((m) => (
          <div key={m.id} className="clients-row">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.title}
              </div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                {m.cnr}
              </div>
            </div>
            <div className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.court || '—'}
            </div>
            <div className="muted clients-cell-hide-tablet" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.stage || '—'}
            </div>
            <div>
              <span className={`badge ${CASE_STATUS_BADGE[m.status] ?? 'badge-cream'}`}>
                {m.status.toUpperCase()}
              </span>
            </div>
            <div className="mono tabular muted clients-cell-hide-tablet">{m.next || '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
