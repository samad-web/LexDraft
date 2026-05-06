import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import type { Client, ClientType, ClientStatus } from '@lexdraft/types';
import { useClients } from '@/hooks/useClients';
import { NewClientModal } from '@/components/NewClientModal';

interface ClientRow extends Client {
  initials: string;
}

type FilterId = 'all' | ClientType;

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
  const [filter, setFilter] = useState<FilterId>('all');
  const [q, setQ] = useState<string>('');
  const [modalOpen, setModalOpen] = useState(false);
  const navigate = useNavigate();
  const { data: clients = [], isLoading, isError } = useClients();

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
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setModalOpen(true)}
        >
          <Icon name="plus" size={14} /> Add client
        </button>
      </div>
      <NewClientModal open={modalOpen} onClose={() => setModalOpen(false)} />

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
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5}>
                  <div className="col" style={{ padding: '28px 8px', alignItems: 'center' }}>
                    <span className="muted">Loading clients<span className="blink" /></span>
                  </div>
                </td>
              </tr>
            )}
            {isError && !isLoading && (
              <tr>
                <td colSpan={5}>
                  <div className="col" style={{ padding: '28px 8px', alignItems: 'center', gap: 6 }}>
                    <div className="heading-sm" style={{ color: 'var(--danger)' }}>Couldn’t load clients</div>
                  </div>
                </td>
              </tr>
            )}
            {!isLoading && !isError && visible.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <div className="col" style={{ padding: '28px 8px', alignItems: 'center', gap: 6 }}>
                    <div className="heading-sm">No clients yet</div>
                    <p className="body-sm muted">{rows.length === 0 ? 'Add your first client to populate the register.' : 'Try a different search or filter.'}</p>
                  </div>
                </td>
              </tr>
            )}
            {visible.map((c) => {
              const badge = STATUS_BADGE[c.status];
              return (
                <tr
                  key={c.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate('/app/clients')}
                >
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
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
