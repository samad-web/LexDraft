import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import { casesForClient } from '@/lib/client-case-link';
import { useSavedFilter } from '@/hooks/useSavedFilter';
import type { Case, Client, ClientType, ClientStatus } from '@lexdraft/types';
import { useClients, useDeleteClient } from '@/hooks/useClients';
import { useCases } from '@/hooks/useCases';
import { NewClientModal } from '@/components/NewClientModal';
import { Gate } from '@/components/Gate';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { PageHeader, PageSearch } from '@/components/PageHeader';
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

// Monochrome status pills: active = ink, prospect = outline, inactive = soft.
const STATUS_BADGE: Record<ClientStatus, { label: string; cls: string }> = {
  active:   { label: 'Active',   cls: 'cm-pill cm-pill--ink'  },
  prospect: { label: 'Prospect', cls: 'cm-pill cm-pill--line' },
  inactive: { label: 'Inactive', cls: 'cm-pill cm-pill--soft' },
};

/** "2026-10-28" -> "28 Oct 2026"; anything unparseable is shown as-is. */
function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function ClientsView() {
  const navigate = useNavigate();
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
            + `This is a default password, so note it down or share it now. `
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
            `Share this fresh password with ${client.name}. The previous one no longer works.\n\n`
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

  // Register summary - display only, computed from the list already loaded.
  const summary = useMemo(() => {
    let active = 0;
    let open = 0;
    let portal = 0;
    for (const c of rows) {
      if (c.status === 'active') active += 1;
      open += c.mattersOpen || 0;
      if (c.portalEnabled) portal += 1;
    }
    return { total: rows.length, active, open, portal };
  }, [rows]);

  const countFor = (id: FilterId): number =>
    id === 'all' ? rows.length : rows.filter((c) => c.type === id).length;

  return (
    <div className="col stagger cm-clients" style={{ gap: 24 }}>
      <PageHeader
        title="Clients"
        description="Your client register, with open matters and client portal access."
        actions={
          <Gate feature="client.create">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setModalOpen(true)}
            >
              <Icon name="plus" size={14} /> Add client
            </button>
          </Gate>
        }
      />
      <NewClientModal open={modalOpen} onClose={closeModal} existing={editingClient} />
      <Gate feature="client.create">
        <FAB ariaLabel="Add client" onClick={() => setModalOpen(true)}>
          <Icon name="plus" size={22} />
        </FAB>
      </Gate>

      {!isLoading && !isError && rows.length > 0 && (
        <div className="cm-kpis" aria-label="Register summary">
          <div className="cm-kpi">
            <div className="cm-kpi-label">Clients</div>
            <div className="cm-kpi-value">{summary.total}</div>
            <div className="cm-kpi-note">On the register</div>
          </div>
          <div className="cm-kpi">
            <div className="cm-kpi-label">Active</div>
            <div className="cm-kpi-value">{summary.active}</div>
            <div className="cm-kpi-note">Currently instructing</div>
          </div>
          <div className="cm-kpi">
            <div className="cm-kpi-label">Open matters</div>
            <div className="cm-kpi-value">{summary.open}</div>
            <div className="cm-kpi-note">Across all clients</div>
          </div>
          <div className="cm-kpi">
            <div className="cm-kpi-label">Portal access</div>
            <div className="cm-kpi-value">{summary.portal}</div>
            <div className="cm-kpi-note">Clients who can sign in</div>
          </div>
        </div>
      )}

      <div className="cm-toolbar">
        <div className="cm-filters" role="group" aria-label="Filter by client type">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`chip ${filter === f.id ? 'active' : ''}`}
              aria-pressed={filter === f.id}
            >
              {f.label}
              {rows.length > 0 && <span className="cm-chip-count">{countFor(f.id)}</span>}
            </button>
          ))}
        </div>
        <PageSearch
          value={q}
          onChange={setQ}
          placeholder="Search by client name…"
          label="Search clients"
        />
      </div>

      <div className="card cm-table-card">
        <table className="tbl clients-tbl cm-clients-tbl">
          <thead>
            <tr>
              <th>Client</th>
              <th className="col-hide-tablet">Type</th>
              <th className="col-hide-mobile">Matters</th>
              <th className="col-hide-tablet">Last contact</th>
              <th>Status</th>
              <th className="col-hide-mobile">Portal</th>
              <th aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 5 }, (_, i) => (
              <tr key={`sk-${i}`} aria-busy="true" className="cm-skel-row">
                <td>
                  <div className="row" style={{ gap: 12 }}>
                    <Skeleton width={38} height={38} radius="pill" />
                    <div className="col" style={{ gap: 6 }}>
                      <Skeleton width={160} height={14} />
                      <Skeleton width={120} height={11} />
                    </div>
                  </div>
                </td>
                <td className="col-hide-tablet"><Skeleton width={70} height={12} /></td>
                <td className="col-hide-mobile"><Skeleton width={30} height={12} /></td>
                <td className="col-hide-tablet"><Skeleton width={80} height={12} /></td>
                <td><Skeleton width={60} height={22} radius="pill" /></td>
                <td className="col-hide-mobile"><Skeleton width={70} height={28} /></td>
                <td />
              </tr>
            ))}
            {isError && !isLoading && (
              <tr>
                <td colSpan={7} data-span="all">
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
                <td colSpan={7} data-span="all">
                  <div className="cm-empty">
                    <EmptyState
                      variant="inline"
                      title={rows.length === 0 ? 'No clients yet' : 'No clients match'}
                      description={
                        rows.length === 0
                          ? 'Add your first client to populate the register.'
                          : 'Try a different search or filter.'
                      }
                    />
                  </div>
                </td>
              </tr>
            )}
            {pager.slice.map((c) => {
              const badge = STATUS_BADGE[c.status];
              const isExpanded = expandedClientId === c.id;
              // Match cases by client name — the schema relates them via the
              // freeform `cases.client` string, not an FK. Uses the shared
              // normaliser so this count matches the client detail page.
              const clientMatters = casesForClient(cases.data ?? [], c);
              return (
                <Fragment key={c.id}>
                  <tr className={isExpanded ? 'cm-row-open' : undefined}>
                    <td>
                      <div className="cm-who">
                        <span className="cm-avatar" aria-hidden="true">{c.initials}</span>
                        <div style={{ minWidth: 0 }}>
                          <button
                            type="button"
                            className="cm-name-btn"
                            onClick={() => navigate(`/app/clients/${c.id}`)}
                            title={`Open ${c.name}`}
                          >
                            {c.name}
                          </button>
                          {/* Subtitle: the client's contact email — what an
                              advocate actually needs at a glance. Never the
                              internal record id. Falls back to a neutral hint
                              when no email is on file. */}
                          <div className={`cm-sub${c.email ? '' : ' is-missing'}`}>
                            {c.email || 'No contact email on file'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="col-hide-tablet cm-muted-cell">{c.type}</td>
                    <td className="col-hide-mobile">
                      {/* Click-to-expand. Shows the count, plus a chevron
                          and (when expanded) the matter list inline. We
                          surface the cases.data count when available so
                          the live join number doesn't drift from the
                          cached `mattersOpen` (which is open-only). */}
                      <button
                        type="button"
                        onClick={() => toggleExpand(c.id)}
                        className="cm-count-btn"
                        aria-expanded={isExpanded}
                        aria-controls={`matters-${c.id}`}
                        title={isExpanded ? 'Hide matters' : 'Show matters'}
                      >
                        <span className="tabular">
                          {cases.isLoading ? (
                            <span className="muted" aria-label="Loading matter count">···</span>
                          ) : (
                            clientMatters.length
                          )}
                        </span>
                        <Icon name={isExpanded ? 'chevronD' : 'chevron'} size={12} />
                      </button>
                    </td>
                    <td className="col-hide-tablet cm-date-cell">{formatDay(c.lastContact)}</td>
                    <td><span className={badge.cls}>{badge.label}</span></td>
                    <td className="col-hide-mobile">
                      {c.portalEnabled ? (
                        <Gate feature="client.create">
                          <div className="cm-portal">
                            <span className="cm-portal-on"><Icon name="check" size={12} /> Enabled</span>
                            <span className="cm-portal-actions">
                              <button
                                type="button"
                                className="cm-link-btn"
                                disabled={busyClientId === c.id}
                                onClick={() => onRegeneratePassword(c)}
                                title="Generate a fresh password"
                              >
                                Reset password
                              </button>
                              <span aria-hidden className="cm-dot-sep">·</span>
                              <button
                                type="button"
                                className="cm-link-btn"
                                disabled={busyClientId === c.id}
                                onClick={() => onDisable(c.id)}
                                title="Revoke portal access"
                              >
                                Disable
                              </button>
                            </span>
                          </div>
                        </Gate>
                      ) : (
                        <Gate feature="client.create">
                          <div className="col" style={{ gap: 4, alignItems: 'flex-start' }}>
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={busyClientId === c.id || !c.email}
                              onClick={() => onEnable(c)}
                              title={!c.email ? 'Add a contact email first' : 'Enable portal access'}
                            >
                              <Icon name="key" size={12} /> Enable
                            </button>
                            {!c.email && (
                              <span className="cm-hint">Add a contact email first</span>
                            )}
                          </div>
                        </Gate>
                      )}
                    </td>
                    <td>
                      <Gate feature="client.create">
                        <div className="cm-row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyClientId === c.id}
                            onClick={() => openEdit(c)}
                            title="Edit client"
                            aria-label={`Edit ${c.name}`}
                          >
                            <Icon name="edit" size={13} /> <span className="cm-act-label">Edit</span>
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busyClientId === c.id}
                            onClick={() => void onDelete(c)}
                            title="Delete client"
                            aria-label={`Delete ${c.name}`}
                          >
                            <Icon name="trash" size={13} /> <span className="cm-act-label">Delete</span>
                          </button>
                        </div>
                      </Gate>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr id={`matters-${c.id}`} className="cm-matters-row">
                      <td colSpan={7} data-span="all">
                        <ClientMattersPanel
                          loading={cases.isLoading}
                          error={cases.isError}
                          matters={clientMatters}
                          onOpenMatter={(m) => navigate(`/app/cases/${m.id}`)}
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
  Active:   'cm-pill cm-pill--ink',
  Pending:  'cm-pill cm-pill--line',
  Closed:   'cm-pill cm-pill--soft',
  Archived: 'cm-pill cm-pill--soft',
};

function ClientMattersPanel(props: {
  loading: boolean;
  error: boolean;
  matters: ReadonlyArray<Case>;
  onOpenMatter: (m: Case) => void;
}): JSX.Element {
  if (props.loading) {
    return <div className="cm-matters-note">Loading matters…</div>;
  }
  if (props.error) {
    return <div className="cm-matters-note">Could not load matters. Reload to retry.</div>;
  }
  if (props.matters.length === 0) {
    return <div className="cm-matters-note">No matters on file for this client yet.</div>;
  }
  return (
    <div className="cm-matters">
      <div className="cm-label">Matters · {props.matters.length}</div>
      <div className="cm-matters-list">
        <div className="clients-row clients-row-head hide-mobile" aria-hidden>
          <div>Title</div>
          <div>Court</div>
          <div className="clients-cell-hide-tablet">Stage</div>
          <div>Status</div>
          <div className="clients-cell-hide-tablet">Next hearing</div>
        </div>
        {props.matters.map((m) => (
          <div
            key={m.id}
            className="clients-row cm-matter"
            onClick={() => props.onOpenMatter(m)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onOpenMatter(m); } }}
            title="Open case"
          >
            <div style={{ minWidth: 0 }}>
              <div className="cm-matter-title">{m.title}</div>
              <div className="mono cm-matter-cnr">{m.cnr}</div>
            </div>
            <div className="cm-ellipsis cm-muted-cell">{m.court || '—'}</div>
            <div className="cm-ellipsis cm-muted-cell clients-cell-hide-tablet">{m.stage || '—'}</div>
            <div>
              <span className={CASE_STATUS_BADGE[m.status] ?? 'cm-pill cm-pill--soft'}>{m.status}</span>
            </div>
            <div className="tabular cm-muted-cell clients-cell-hide-tablet">{formatDay(m.next)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
