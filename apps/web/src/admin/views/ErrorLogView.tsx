import { useMemo, useState } from 'react';
import { Select } from '@lexdraft/ui';
import { CopyButton } from '@/components/CopyButton';
import { Pagination } from '@/components/Pagination';
import {
  useErrorLogList,
  useErrorLogDetail,
  useErrorLogStats,
  useResolveError,
  useUnresolveError,
  type ErrorLogListItem,
} from '../hooks/useErrorLog';

/**
 * SuperAdmin viewer over the `error_log` table. Layout follows AuditLogView
 * - filter strip on top, table below, click-row → side drawer for the full
 * stack trace + a resolve workflow.
 *
 * The list lives at the "all-resolved-or-not" view by default with an
 * "Unresolved" pill pre-selected; that's the operator's primary working
 * surface (incident triage).
 */

type ResolvedTab = 'unresolved' | 'resolved' | 'all';

const STATUS_OPTIONS = [
  { value: '',    label: 'All statuses' },
  { value: '500', label: '500 Internal Error' },
  { value: '502', label: '502 Bad Gateway' },
  { value: '503', label: '503 Service Unavailable' },
  { value: '504', label: '504 Gateway Timeout' },
  { value: '403', label: '403 Forbidden' },
  { value: '422', label: '422 Unprocessable' },
  { value: '429', label: '429 Rate Limited' },
];

// Default window for the stats strip - "last 7 days". The operator can't
// change this from the UI yet; keeping it fixed avoids the analytics rabbit
// hole. If a wider window is needed, edit here.
function defaultStatsRange(): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { since: since.toISOString(), until: until.toISOString() };
}

function statusToneClass(status: number, resolved: boolean): string {
  if (resolved) return '';
  if (status >= 500) return 'errlog-row-danger';
  if (status === 403 || status === 422 || status === 429) return 'errlog-row-warning';
  return '';
}

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : '-';
}

export function ErrorLogView() {
  const [tab, setTab] = useState<ResolvedTab>('unresolved');
  const [status, setStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const listQuery = useErrorLogList({
    status: status ? Number(status) : undefined,
    resolved: tab === 'all' ? 'all' : tab === 'resolved' ? 'true' : 'false',
    limit: pageSize,
    offset,
  });

  const statsRange = useMemo(defaultStatsRange, []);
  const statsQuery = useErrorLogStats(statsRange);

  const items   = listQuery.data?.items ?? [];
  const total   = listQuery.data?.total ?? 0;
  const stats   = statsQuery.data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const topPath  = stats?.byPath[0];
  const topError = stats?.byErrorName[0];

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <header>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Internal error tracking</div>
        <h1 className="display-md">Error log · {total.toLocaleString()}</h1>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          5xx errors and a curated subset of 4xx (403, 422, 429). Stats below cover the last 7 days.
        </div>
      </header>

      {/* ---- stats strip ----------------------------------------------- */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}
      >
        <StatCard label="Errors (7d)" value={stats?.totalCount.toLocaleString() ?? '-'} />
        <StatCard
          label="Unresolved"
          value={stats?.unresolvedCount.toLocaleString() ?? '-'}
          tone={stats && stats.unresolvedCount > 0 ? 'danger' : undefined}
        />
        <StatCard
          label="Top path"
          value={topPath ? topPath.path : '-'}
          sub={topPath ? `${topPath.count} hits` : undefined}
          mono
        />
        <StatCard
          label="Top error class"
          value={topError ? topError.name : '-'}
          sub={topError ? `${topError.count} hits` : undefined}
          mono
        />
      </div>

      {/* ---- filters --------------------------------------------------- */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div role="tablist" style={{ display: 'inline-flex', gap: 4 }}>
          {(['unresolved', 'resolved', 'all'] as ResolvedTab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`btn btn-sm${tab === t ? ' btn-primary' : ''}`}
              onClick={() => { setTab(t); setPage(1); }}
              style={{ textTransform: 'capitalize' }}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ width: 220 }}>
          <Select
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={STATUS_OPTIONS}
          />
        </div>
      </div>

      {/* ---- table ----------------------------------------------------- */}
      {listQuery.isLoading ? (
        <div className="muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="card" style={{ padding: 'var(--space-7)', textAlign: 'center' }}>
          <div className="muted">No errors match the current filters.</div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 180 }}>When</th>
                <th style={{ width: 70 }}>Status</th>
                <th>Route</th>
                <th style={{ width: 140 }}>Error</th>
                <th style={{ width: 200 }}>User</th>
                <th style={{ width: 140 }}>Firm</th>
                <th style={{ width: 130 }}>Request</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <ErrorRow
                  key={row.id}
                  row={row}
                  selected={selectedId === row.id}
                  onSelect={() => setSelectedId(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          onChange={setPage}
        />
      )}

      {selectedId && (
        <ErrorDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}

      {/* Inline styles - kept here to avoid a new CSS file. The tone
          classes use existing semantic tokens from tokens.css. */}
      <style>{`
        .errlog-row-danger  { background: var(--danger-bg); }
        .errlog-row-warning { background: var(--warning-bg); }
        .errlog-row { cursor: pointer; }
        .errlog-row:hover { background: var(--bg-surface-2); }
      `}</style>
    </div>
  );
}

// ---------- row -------------------------------------------------------------

function ErrorRow({
  row,
  selected,
  onSelect,
}: {
  row: ErrorLogListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const toneClass = statusToneClass(row.status, !!row.resolvedAt);
  return (
    <tr
      className={`errlog-row ${toneClass}`}
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
    >
      <td className="mono" style={{ fontSize: 12 }}>
        {new Date(row.occurredAt).toLocaleString()}
      </td>
      <td className="mono tabular" style={{ fontWeight: 600 }}>{row.status}</td>
      <td className="mono" style={{ fontSize: 12 }}>
        <span className="badge" style={{ marginRight: 6 }}>{row.method}</span>
        {row.path}
      </td>
      <td className="mono" style={{ fontSize: 12 }}>{row.errorName}</td>
      <td style={{ fontSize: 13 }}>{row.userEmail ?? <span className="muted">-</span>}</td>
      <td style={{ fontSize: 13 }}>{row.firmName ?? <span className="muted">-</span>}</td>
      <td onClick={(e) => e.stopPropagation()}>
        {row.requestId ? (
          <CopyButton value={row.requestId} label={shortId(row.requestId)} />
        ) : <span className="muted">-</span>}
      </td>
    </tr>
  );
}

// ---------- drawer ----------------------------------------------------------

function ErrorDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useErrorLogDetail(id);
  const resolveMut = useResolveError();
  const unresolveMut = useUnresolveError();
  const [note, setNote] = useState('');

  const isResolved = !!data?.resolvedAt;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,10,10,0.4)',
        zIndex: 50,
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(720px, 100vw)',
          background: 'var(--bg-base)',
          borderLeft: '1px solid var(--border-subtle)',
          overflow: 'auto',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div className="eyebrow">Error detail</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
              {id.slice(0, 8)}
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>
        </header>

        {isLoading || !data ? (
          <div className="muted">Loading…</div>
        ) : (
          <>
            <section>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, fontSize: 13 }}>
                <div className="muted">When</div>
                <div className="mono">{new Date(data.occurredAt).toLocaleString()}</div>
                <div className="muted">Status</div>
                <div className="mono tabular">{data.status}</div>
                <div className="muted">Route</div>
                <div className="mono">{data.method} {data.path}</div>
                <div className="muted">Error</div>
                <div className="mono">{data.errorName}: {data.errorMessage}</div>
                <div className="muted">User</div>
                <div>{data.userEmail ?? '-'}{data.userName ? ` · ${data.userName}` : ''}</div>
                <div className="muted">Firm</div>
                <div>{data.firmName ?? '-'}</div>
                <div className="muted">Request id</div>
                <div>{data.requestId ? <CopyButton value={data.requestId} /> : '-'}</div>
                <div className="muted">IP</div>
                <div className="mono">{data.ip ?? '-'}</div>
                <div className="muted">User agent</div>
                <div className="mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>{data.userAgent ?? '-'}</div>
              </div>
            </section>

            <section>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Stack trace</div>
              <pre
                style={{
                  background: 'var(--bg-surface-2)',
                  padding: 12,
                  borderRadius: 'var(--radius-sm, 4px)',
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 320,
                  overflow: 'auto',
                  margin: 0,
                }}
              >
                {data.errorStack ?? '(no stack)'}
              </pre>
            </section>

            <section>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Context</div>
              <pre
                style={{
                  background: 'var(--bg-surface-2)',
                  padding: 12,
                  borderRadius: 'var(--radius-sm, 4px)',
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 240,
                  overflow: 'auto',
                  margin: 0,
                }}
              >
                {data.context ? JSON.stringify(data.context, null, 2) : '(none)'}
              </pre>
            </section>

            <section style={{ marginTop: 'auto' }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Resolution</div>
              {isResolved ? (
                <div className="col" style={{ gap: 8 }}>
                  <div className="muted" style={{ fontSize: 13 }}>
                    Resolved at {data.resolvedAt ? new Date(data.resolvedAt).toLocaleString() : '-'}
                    {data.resolutionNote ? ` · ${data.resolutionNote}` : ''}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={unresolveMut.isPending}
                    onClick={() => unresolveMut.mutate(id)}
                  >
                    {unresolveMut.isPending ? 'Reopening…' : 'Reopen'}
                  </button>
                </div>
              ) : (
                <div className="col" style={{ gap: 8 }}>
                  <textarea
                    className="input"
                    placeholder="Optional resolution note (e.g. 'Fixed in PR #214', 'Won't fix - third-party API flake')"
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={resolveMut.isPending}
                    onClick={() => resolveMut.mutate({ id, note: note.trim() || undefined })}
                  >
                    {resolveMut.isPending ? 'Marking…' : 'Mark resolved'}
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

// ---------- stat card -------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  mono,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  tone?: 'danger';
}) {
  return (
    <div
      className="card"
      style={{
        padding: 'var(--space-4)',
        background: tone === 'danger' ? 'var(--danger-bg)' : undefined,
      }}
    >
      <div className="eyebrow" style={{ fontSize: 11 }}>{label}</div>
      <div
        className={mono ? 'mono' : ''}
        style={{
          fontSize: mono ? 14 : 24,
          fontWeight: 600,
          marginTop: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
      {sub && (
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>
      )}
    </div>
  );
}
