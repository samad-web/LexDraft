import { useMemo, useState } from 'react';
import { Icon, ErrorState } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import type { Clause } from '@lexdraft/types';
import { useClauses, useDeleteClause, useIncrementClauseUses } from '@/hooks/useClauses';
import { useUIStore } from '@/store/ui';
import { NewClauseModal } from '@/components/NewClauseModal';
import { ImportClausesModal } from '@/components/ImportClausesModal';
import { useConfirm } from '@/components/ConfirmDialog';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

const FALLBACK_CATEGORIES = [
  'Indemnity',
  'Limitation of Liability',
  'Termination',
  'Confidentiality',
  'Governing Law',
  'Dispute Resolution',
  'Force Majeure',
  'Data Protection',
] as const;

export function ClausesView() {
  const { data: clauses = [], isLoading, isError } = useClauses();
  const [activeCategory, setActiveCategory] = useState<string>(FALLBACK_CATEGORIES[0]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const showToast = useUIStore((s) => s.showToast);
  const incUses = useIncrementClauseUses();
  const del = useDeleteClause();
  const confirm = useConfirm();

  // Union of fallback categories ∪ categories present in actual data, in
  // insertion order with fallbacks first so the UI stays familiar.
  const categories = useMemo<string[]>(() => {
    const seen = new Set<string>(FALLBACK_CATEGORIES);
    for (const c of clauses) seen.add(c.category);
    return Array.from(seen);
  }, [clauses]);

  const grouped = useMemo<Map<string, Clause[]>>(() => {
    const m = new Map<string, Clause[]>();
    for (const c of clauses) {
      const arr = m.get(c.category) ?? [];
      arr.push(c);
      m.set(c.category, arr);
    }
    return m;
  }, [clauses]);

  const activeClauses = grouped.get(activeCategory) ?? [];
  const pager = usePagination(activeClauses);

  const handleCopy = async (clause: Clause): Promise<void> => {
    const text = clause.body || `${clause.title}\n\n${clause.description}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      showToast({ type: 'sage', text: 'Clause copied' });
      void incUses.mutateAsync(clause.id).catch(() => undefined);
    } catch {
      showToast({ type: 'vermillion', text: 'Could not copy clause' });
    }
    setCopiedId(clause.id);
    window.setTimeout(() => setCopiedId((cur) => (cur === clause.id ? null : cur)), 1400);
  };

  const handleDelete = async (clause: Clause) => {
    const ok = await confirm({
      title: `Delete "${clause.title}"?`,
      message: 'This clause will be removed from the bank.',
      confirmLabel: 'Delete clause',
      danger: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(clause.id);
      showToast({ type: 'sage', text: 'Clause deleted' });
    } catch {
      showToast({ type: 'vermillion', text: 'Could not delete clause' });
    }
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Clause bank · firm-approved language</div>
          <h1 className="heading-xl">Clauses</h1>
          <div className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)', marginTop: 4 }}>
            {clauses.length} {clauses.length === 1 ? 'CLAUSE' : 'CLAUSES'} · {grouped.size} {grouped.size === 1 ? 'CATEGORY' : 'CATEGORIES'}
          </div>
        </div>
        <span className="spacer" />
        <button
          className="btn"
          type="button"
          onClick={() => setImportOpen(true)}
        >
          <Icon name="upload" size={14} /> Import
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => setNewOpen(true)}
        >
          <Icon name="plus" size={14} /> New clause
        </button>
      </div>

      {isError && (
        <ErrorState
          icon="clauses"
          title="Couldn't load clauses"
          description="Check your connection and try again."
        />
      )}

      <div
        className="clauses-grid"
        style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 24 }}
      >
        <aside
          className="col"
          style={{
            gap: 4,
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-4)',
            alignSelf: 'flex-start',
          }}
        >
          <div className="eyebrow" style={{ padding: '8px 12px' }}>Categories</div>
          {categories.map((cat) => {
            const isActive = cat === activeCategory;
            const count = grouped.get(cat)?.length ?? 0;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className="row"
                style={{
                  padding: '10px 12px',
                  textAlign: 'left',
                  border: '1px solid transparent',
                  background: isActive ? 'var(--bg-surface)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: isActive ? 500 : 400,
                  fontSize: 14,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-md)',
                  gap: 10,
                  width: '100%',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <Icon name="clauses" size={14} />
                <span>{cat}</span>
                <span className="spacer" />
                <span className="mono body-xs muted tabular">{count}</span>
              </button>
            );
          })}
        </aside>

        <div className="col" style={{ gap: 16 }}>
          <div>
            <div className="heading-md">{activeCategory}</div>
            <div className="body-sm muted">
              {activeClauses.length} {activeClauses.length === 1 ? 'clause' : 'clauses'} in this category
            </div>
          </div>

          {isLoading ? (
            <div className="card muted" style={{ padding: 24, textAlign: 'center' }}>
              Loading clauses…
            </div>
          ) : activeClauses.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-9)' }}>
              <Icon name="clauses" size={24} className="muted" />
              <div className="heading-sm" style={{ marginTop: 12, marginBottom: 4 }}>No clauses yet</div>
              <p className="body-sm muted" style={{ maxWidth: 360, margin: '0 auto', marginBottom: 16 }}>
                This category is empty. Add a firm-approved {activeCategory.toLowerCase()} clause to start
                building this section of the bank.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setNewOpen(true)}
              >
                <Icon name="plus" size={14} /> Add first clause
              </button>
            </div>
          ) : (
            <div className="grid-2" style={{ gap: 16 }}>
              {pager.slice.map((clause) => {
                const isCopied = copiedId === clause.id;
                return (
                  <div key={clause.id} className="card card-hover" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div className="heading-sm">{clause.title}</div>
                    <p className="body-sm muted" style={{ flex: 1 }}>{clause.description || <em>(no description)</em>}</p>
                    <div className="row rule-top" style={{ paddingTop: 12, gap: 8 }}>
                      <span className="mono body-xs muted tabular">{clause.uses.toLocaleString('en-IN')} uses</span>
                      <span className="spacer" />
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => { void handleDelete(clause); }}
                        aria-label={`Delete ${clause.title}`}
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <Icon name="close" size={11} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => { void handleCopy(clause); }}
                        aria-label={`Copy ${clause.title}`}
                      >
                        <Icon name={isCopied ? 'check' : 'documents'} size={12} />
                        {isCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {activeClauses.length > 0 && (
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

      <NewClauseModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        categories={categories}
        defaultCategory={activeCategory}
      />
      <ImportClausesModal open={importOpen} onClose={() => setImportOpen(false)} />
      <FAB ariaLabel="New clause" onClick={() => setNewOpen(true)}>
        <Icon name="plus" size={22} />
      </FAB>

      <style>{`
        @media (max-width: 900px) { .clauses-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}
