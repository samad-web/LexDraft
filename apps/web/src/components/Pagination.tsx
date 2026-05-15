import { useMemo } from 'react';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  /** Hide entirely when there's only one page. Default true. */
  hideOnSinglePage?: boolean;
  /** Optional label shown left of the controls (e.g. "Showing X of Y"). */
  showSummary?: boolean;
}

/**
 * Compact pagination controls used at the bottom of every list table.
 * Page numbers collapse around the current page when the count is large
 * (1 … 4 5 *6* 7 8 … 12) so the bar never grows beyond a single line.
 *
 * Self-hides on single-page lists by default - reduces visual noise on
 * empty/short datasets without needing a wrapper conditional in every
 * caller.
 */
export function Pagination(props: PaginationProps) {
  const { page, totalPages, total, pageSize, onChange } = props;
  const hideOnSinglePage = props.hideOnSinglePage ?? true;

  const numbers = useMemo(() => collapseNumbers(page, totalPages), [page, totalPages]);

  if (hideOnSinglePage && totalPages <= 1) return null;

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 0',
        flexWrap: 'wrap',
      }}
    >
      {props.showSummary !== false && (
        <span className="muted" style={{ fontSize: 13 }}>
          {total === 0 ? '0 results' : `Showing ${start}-${end} of ${total}`}
        </span>
      )}
      <div role="group" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          Prev
        </button>
        {numbers.map((n, i) =>
          n === '…' ? (
            <span key={`gap-${i}`} className="muted" style={{ padding: '0 6px' }} aria-hidden>…</span>
          ) : (
            <button
              key={n}
              type="button"
              className={`btn btn-sm${n === page ? ' btn-primary' : ''}`}
              onClick={() => onChange(n)}
              aria-current={n === page ? 'page' : undefined}
              aria-label={`Page ${n}`}
            >
              {n}
            </button>
          ),
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </nav>
  );
}

/**
 * Produce a compact list of page numbers with `…` gaps. Always includes the
 * first and last page; shows the two pages either side of the current.
 */
function collapseNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: Array<number | '…'> = [1];
  const left = Math.max(2, current - 2);
  const right = Math.min(total - 1, current + 2);
  if (left > 2) out.push('…');
  for (let n = left; n <= right; n += 1) out.push(n);
  if (right < total - 1) out.push('…');
  out.push(total);
  return out;
}
