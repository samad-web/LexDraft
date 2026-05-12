import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { Expense, ExpenseStatus } from '@lexdraft/types';
import { useUIStore } from '@/store/ui';
import { useExpenses } from '@/hooks/useExpenses';
import { NewExpenseModal } from '@/components/NewExpenseModal';
import { exportPdf, escapeReportHtml } from '@/lib/export-doc';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';
import { apiClient } from '@/lib/api';

interface BadgeMeta { label: string; cls: string }
const STATUS_BADGE: Record<ExpenseStatus, BadgeMeta> = {
  pending: { label: 'Pending', cls: 'badge-amber' },
  approved: { label: 'Approved', cls: 'badge-cobalt' },
  billed: { label: 'Billed', cls: 'badge-sage' },
};
const FALLBACK_BADGE: BadgeMeta = { label: 'Unknown', cls: 'badge' };

function formatINR(value: number): string {
  return `₹${value.toLocaleString('en-IN')}`;
}

export function ExpensesView() {
  const showToast = useUIStore((s) => s.showToast);
  const [modalOpen, setModalOpen] = useState(false);
  const { data: rows = [], isLoading, isError } = useExpenses();
  const pager = usePagination(rows);

  const stats = useMemo(() => {
    const monthTotal = rows.reduce((sum, r) => sum + r.amountInr, 0);
    const reimbursable = rows.filter((r) => r.reimbursable).reduce((s, r) => s + r.amountInr, 0);
    const billable = rows.filter((r) => r.billable).reduce((s, r) => s + r.amountInr, 0);
    const unallocated = rows.filter((r) => r.status === 'pending').reduce((s, r) => s + r.amountInr, 0);
    return { monthTotal, reimbursable, billable, unallocated };
  }, [rows]);

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Disbursements ledger</div>
          <h1 className="heading-xl">Expenses</h1>
        </div>
        <span className="spacer" />
        <button
          className="btn"
          type="button"
          onClick={async () => {
            // GST / Tally-compatible CSV via /api/exports/expenses.csv.
            // The view has no category filter today, so we don't pass a
            // `type` param — when one is added, mirror its value here.
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
            }
          }}
        >
          <Icon name="download" size={14} /> Download CSV
        </button>
        <button
          className="btn"
          type="button"
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
            }
          }}
        >
          <Icon name="download" size={14} /> Export
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => setModalOpen(true)}
        >
          <Icon name="plus" size={14} /> Log expense
        </button>
      </div>
      <NewExpenseModal open={modalOpen} onClose={() => setModalOpen(false)} />

      <div className="stat-row">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>This month</div>
          <div className="heading-xl tabular">{formatINR(stats.monthTotal)}</div>
          <div className="body-sm muted">{rows.length} entries</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Reimbursable</div>
          <div className="heading-xl tabular">{formatINR(stats.reimbursable)}</div>
          <div className="body-sm muted">Owed back to fee earners</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Billable</div>
          <div className="heading-xl tabular">{formatINR(stats.billable)}</div>
          <div className="body-sm muted">To pass through to clients</div>
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Unallocated</div>
          <div className="heading-xl tabular">{formatINR(stats.unallocated)}</div>
          <div className="body-sm muted">Pending review</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {isLoading ? (
          <div className="col" style={{ padding: 'var(--space-9)', alignItems: 'center' }}>
            <span className="muted">Loading expenses<span className="blink" /></span>
          </div>
        ) : isError ? (
          <div className="col" style={{ padding: 'var(--space-9)', alignItems: 'center' }}>
            <span style={{ color: 'var(--danger)' }}>Couldn’t load expenses.</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="col" style={{ padding: 'var(--space-9)', alignItems: 'center', gap: 6 }}>
            <div className="heading-sm">No disbursements logged</div>
            <p className="body-sm muted">Use “Log expense” to add the first entry.</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
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
                    <td className="mono muted tabular">{row.date}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{row.description}</div>
                      <div className="body-xs muted mono">{row.expenseNo}</div>
                    </td>
                    <td className="muted">{row.category}</td>
                    <td>
                      <em className="case-name">{row.caseLabel}</em>
                    </td>
                    <td className="mono tabular" style={{ textAlign: 'right', fontWeight: 500 }}>
                      {formatINR(row.amountInr)}
                    </td>
                    <td>
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    </td>
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
