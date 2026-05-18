import { useMemo, useState } from 'react';
import { Icon, EmptyState, ErrorState } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import { useSavedFilter } from '@/hooks/useSavedFilter';
import type { Client, ClientType, ClientStatus } from '@lexdraft/types';
import { useClients } from '@/hooks/useClients';
import { NewClientModal } from '@/components/NewClientModal';
import { Gate } from '@/components/Gate';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import {
  useEnableClientPortal,
  useDisableClientPortal,
  useResendClientPortalLink,
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
  const { data: clients = [], isLoading, isError } = useClients();
  const enable = useEnableClientPortal();
  const disable = useDisableClientPortal();
  const resend = useResendClientPortalLink();
  const [busyClientId, setBusyClientId] = useState<string | null>(null);

  async function onEnable(clientId: string): Promise<void> {
    setBusyClientId(clientId);
    try {
      const res = await enable.mutateAsync(clientId);
      if (res.devMagicLink) {
        window.alert(`Portal enabled. Dev magic link:\n${res.devMagicLink}`);
      }
    } catch (e) {
      window.alert((e as Error).message ?? 'Could not enable the portal.');
    } finally {
      setBusyClientId(null);
    }
  }

  async function onDisable(clientId: string): Promise<void> {
    if (!window.confirm('Disable portal access for this client? Active sessions will be revoked.')) return;
    setBusyClientId(clientId);
    try { await disable.mutateAsync(clientId); }
    catch (e) { window.alert((e as Error).message ?? 'Could not disable the portal.'); }
    finally { setBusyClientId(null); }
  }

  async function onResend(clientId: string): Promise<void> {
    setBusyClientId(clientId);
    try {
      const res = await resend.mutateAsync(clientId);
      if (res.devMagicLink) {
        window.alert(`Sent. Dev magic link:\n${res.devMagicLink}`);
      }
    } catch (e) {
      window.alert((e as Error).message ?? 'Could not resend the link.');
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
      <NewClientModal open={modalOpen} onClose={() => setModalOpen(false)} />
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
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6}>
                  <div className="col" style={{ padding: '28px 8px', alignItems: 'center' }}>
                    <span className="muted">Loading clients<span className="blink" /></span>
                  </div>
                </td>
              </tr>
            )}
            {isError && !isLoading && (
              <tr>
                <td colSpan={6}>
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
                <td colSpan={6}>
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
              return (
                <tr key={c.id}>
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
                  <td className="mono tabular">{c.mattersOpen}</td>
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
                            onClick={() => onResend(c.id)}
                            title="Resend magic link"
                          >
                            Resend
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
                          onClick={() => onEnable(c.id)}
                          title={!c.email ? 'Add a contact email first' : 'Enable portal access'}
                        >
                          Enable
                        </button>
                      </Gate>
                    )}
                  </td>
                </tr>
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
