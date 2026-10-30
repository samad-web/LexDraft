import { useMemo, useState } from 'react';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import type { Expense, ExpenseStatus } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useExpenses } from '@/hooks/useExpenses';
import { NewExpenseModal } from '@/components/NewExpenseModal';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { Gate } from '@/components/Gate';
import { PageHeader, PageSearch } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { apiClient } from '@/lib/api';
import { useSavedFilter } from '@/hooks/useSavedFilter';

interface BadgeMeta { label: string; cls: string }
const STATUS_BADGE: Record<ExpenseStatus, BadgeMeta> = {
  pending: { label: 'Pending', cls: 'cm-pill cm-pill--ink' },
  approved: { label: 'Approved', cls: 'cm-pill cm-pill--line' },
  billed: { label: 'Billed', cls: 'cm-pill cm-pill--soft' },
};
const FALLBACK_BADGE: BadgeMeta = { label: 'Unknown', cls: 'cm-pill cm-pill--soft' };

/** "2026-10-28" -> "28 Oct 2026". */
function formatDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

type FilterId = 'all' | ExpenseStatus;
const FILTER_IDS: ReadonlyArray<FilterId> = ['all', 'pending', 'approved', 'billed'];
interface FilterOption { id: FilterId; label: string }
const FILTERS: ReadonlyArray<FilterOption> = [
  { id: 'all',      label: 'All'      },
  { id: 'pending',  label: 'Pending'  },
  { id: 'approved', label: 'Approved' },
  { id: 'billed',   label: 'Billed'   },
];

function formatINR(value: number): string {
  return `₹${value.toLocaleString('en-IN')}`;
}

export function ExpensesView() {
  const showToast = useUIStore((s) => s.showToast);
  const [modalOpen, setModalOpen] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [filter, setFilter] = useSavedFilter<FilterId>('expenses.filter', 'all', (raw) =>
    typeof raw === 'string' && (FILTER_IDS as ReadonlyArray<string>).includes(raw) ? (raw as FilterId) : null,
  );
  const [q, setQ] = useState<string>('');
  const { data: rows = [], isLoading, isError } = useExpenses();
  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (
        needle
        && !r.description.toLowerCase().includes(needle)
        && !r.category.toLowerCase().includes(needle)
        && !r.expenseNo.toLowerCase().includes(needle)
      ) return false;
      if (filter !== 'all' && r.status !== filter) return false;
      return true;
    });
  }, [rows, filter, q]);
  const pager = usePagination(filteredRows);

  const stats = useMemo(() => {
    const monthTotal = rows.reduce((sum, r) => sum + r.amountInr, 0);
    const reimbursable = rows.filter((r) => r.reimbursable).reduce((s, r) => s + r.amountInr, 0);
    const billable = rows.filter((r) => r.billable).reduce((s, r) => s + r.amountInr, 0);
    const unallocated = rows.filter((r) => r.status === 'pending').reduce((s, r) => s + r.amountInr, 0);
    return { monthTotal, reimbursable, billable, unallocated };
  }, [rows]);

  return (
    <div className="col stagger cm-expenses" style={{ gap: 24 }}>
      <PageHeader
        title="Expenses"
        description="Log disbursements against matters and see what is billable or reimbursable."
        actions={<>
        <button
          className="btn"
          type="button"
          disabled={exportingCsv}
          onClick={async () => {
            // GST / Tally-compatible CSV via /api/exports/expenses.csv.
            // The view has no category filter today, so we don't pass a
            // `type` param - when one is added, mirror its value here.
            setExportingCsv(true);
            try {
              const resp = await apiClient.get('/api/exports/expenses.csv', {
                responseType: 'blob',
              });
              const blob = resp.data instanceof Blob
                ? resp.data
                : new Blob([String(resp.data)], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `lexdraft-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (err) {
              showToast({
                type: 'cobalt',
                text: err instanceof Error ? err.message : 'CSV export failed',
              });
            } finally {
              setExportingCsv(false);
            }
          }}
        >
          <Icon name="download" size={14} /> {exportingCsv ? 'Exporting…' : 'Download CSV'}
        </button>
        <button
          className="btn"
          type="button"
          disabled={exportingPdf}
          onClick={async () => {
            if (!rows.length) {
              showToast({ type: 'amber', text: 'No expenses to export' });
              return;
            }
            const today = new Date().toISOString().slice(0, 10);
            const tableRows = rows
              .map((row: Expense) => {
                const badge = STATUS_BADGE[row.status] ?? FALLBACK_BADGE;
                return `<tr>
                  <td>${escapeReportHtml(row.date)}</td>
                  <td>${escapeReportHtml(row.expenseNo)}</td>
                  <td>${escapeReportHtml(row.description)}</td>
                  <td>${escapeReportHtml(row.category)}</td>
                  <td>${escapeReportHtml(row.caseLabel)}</td>
                  <td class="num">${formatINR(row.amountInr)}</td>
                  <td>${badge.label}</td>
                </tr>`;
              })
              .join('');
            const totals = `
              <table style="width:auto;margin-top:18px;">
                <tbody>
                  <tr><th>Period total</th><td class="num">${formatINR(stats.monthTotal)}</td></tr>
                  <tr><th>Reimbursable</th><td class="num">${formatINR(stats.reimbursable)}</td></tr>
                  <tr><th>Billable</th><td class="num">${formatINR(stats.billable)}</td></tr>
                  <tr><th>Unallocated</th><td class="num">${formatINR(stats.unallocated)}</td></tr>
                </tbody>
              </table>`;
            const html = `
              <p>${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}</p>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ref</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Matter</th>
                    <th class="num">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>${tableRows}</tbody>
              </table>
              ${totals}
            `;
            setExportingPdf(true);
            try {
              await exportPdf({
                title: 'Expenses ledger',
                bodyHtml: html,
                dated: today,
                disclaimerHtml: null,
                orientation: 'landscape',
              });
            } catch (err) {
              showToast({ type: 'cobalt', text: err instanceof Error ? err.message : 'Export failed' });
            } finally {
              setExportingPdf(false);
            }
          }}
        >
          <Icon name="download" size={14} /> {exportingPdf ? 'Exporting…' : 'Export'}
        </button>
        <Gate feature="billing.expense">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setModalOpen(true)}
          >
            <Icon name="plus" size={14} /> Log expense
          </button>
        </Gate>
        </>}
      />
      <NewExpenseModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <Gate feature="billing.expense">
        <FAB ariaLabel="Log expense" onClick={() => setModalOpen(true)}>
          <Icon name="plus" size={22} />
        </FAB>
      </Gate>

      <div className="cm-kpis" aria-label="Expenses summary">
        <div className="cm-kpi">
          <div className="cm-kpi-label">This month</div>
          <div className="cm-kpi-value">{formatINR(stats.monthTotal)}</div>
          <div className="cm-kpi-note">{rows.length} entries</div>
        </div>
        <div className="cm-kpi">
          <div className="cm-kpi-label">Reimbursable</div>
          <div className="cm-kpi-value">{formatINR(stats.reimbursable)}</div>
          <div className="cm-kpi-note">Owed back to fee earners</div>
        </div>
        <div className="cm-kpi">
          <div className="cm-kpi-label">Billable</div>
          <div className="cm-kpi-value">{formatINR(stats.billable)}</div>
          <div className="cm-kpi-note">To pass through to clients</div>
        </div>
        <div className="cm-kpi">
          <div className="cm-kpi-label">Unallocated</div>
          <div className="cm-kpi-value">{formatINR(stats.unallocated)}</div>
          <div className="cm-kpi-note">Pending review</div>
        </div>
      </div>

      <div className="cm-toolbar">
        <div className="cm-filters" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`chip ${filter === f.id ? 'active' : ''}`}
              aria-pressed={filter === f.id}
            >
              {f.label}
              {rows.length > 0 && (
                <span className="cm-chip-count">
                  {f.id === 'all' ? rows.length : rows.filter((r) => r.status === f.id).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <PageSearch
          value={q}
          onChange={setQ}
          placeholder="Search by description, category, or expense no.…"
          label="Search expenses"
        />
      </div>

      <div className="card cm-table-card" style={{ padding: 0 }}>
        {isLoading ? (
          <div className="col" style={{ padding: 24, gap: 12 }} aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} width="100%" height={40} />)}
          </div>
        ) : isError ? (
          <ErrorState
            icon="expenses"
            title="Couldn't load expenses"
            description="Check your connection and try again."
          />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon="expenses"
            title={rows.length === 0 ? 'No disbursements logged' : 'No expenses match'}
            description={
              rows.length === 0
                ? 'Track court fees, travel, and other case-related costs. Approved expenses flow into the next invoice.'
                : 'Try a different search or filter.'
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Description</th>
                <th>Date</th>
                <th>Category</th>
                <th>Matter</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {pager.slice.map((row: Expense) => {
                const badge = STATUS_BADGE[row.status] ?? FALLBACK_BADGE;
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="cm-expense-desc">{row.description}</div>
                      <div className="mono cm-expense-ref">{row.expenseNo}</div>
                      {(row.billable || row.reimbursable) && (
                        <div className="cm-flags">
                          {row.billable && <span className="cm-flag">Billable</span>}
                          {row.reimbursable && <span className="cm-flag">Reimbursable</span>}
                        </div>
                      )}
                    </td>
                    <td className="cm-date-cell">{formatDay(row.date)}</td>
                    <td className="cm-muted-cell">{row.category}</td>
                    <td className="cm-muted-cell">
                      {row.caseLabel ? <em className="case-name">{row.caseLabel}</em> : '—'}
                    </td>
                    <td className="cm-num cm-amount">{formatINR(row.amountInr)}</td>
                    <td><span className={badge.cls}>{badge.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {!isLoading && !isError && (
          <Pagination
            page={pager.page}
            totalPages={pager.totalPages}
            total={pager.total}
            pageSize={pager.pageSize}
            onChange={pager.setPage}
          />
        )}
      </div>
    </div>
  );
}
