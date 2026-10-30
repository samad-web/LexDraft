import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon, ErrorState, EmptyState, Skeleton } from '@lexdraft/ui';
import { FAB } from '@/components/FAB';
import { PageHeader } from '@/components/PageHeader';
import { useDeleteWithUndo } from '@/hooks/useDeleteWithUndo';
import { api } from '@/lib/api';
import type { Clause } from '@lexdraft/types';
import { useClauses, useIncrementClauseUses } from '@/hooks/useClauses';
import { useUIStore } from '@/store/ui';
import { NewClauseModal } from '@/components/NewClauseModal';
import { ImportClausesModal } from '@/components/ImportClausesModal';
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
  const qc = useQueryClient();
  const deleteWithUndo = useDeleteWithUndo();

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

  const handleDelete = (clause: Clause) => {
    deleteWithUndo({
      toastText: `Deleted "${clause.title}"`,
      errorText: 'Could not delete clause',
      optimisticRemove: () => {
        const prev = qc.getQueryData<Clause[]>(['clauses']);
        if (prev) qc.setQueryData<Clause[]>(['clauses'], prev.filter((c) => c.id !== clause.id));
      },
      restore: () => {
        const cur = qc.getQueryData<Clause[]>(['clauses']);
        if (!cur) return;
        const idx = clauses.findIndex((c) => c.id === clause.id);
        const restored = [...cur];
        if (idx >= 0 && idx <= restored.length) restored.splice(idx, 0, clause);
        else restored.push(clause);
        qc.setQueryData<Clause[]>(['clauses'], restored);
      },
      commit: () => api.delete<void>(`/clauses/${clause.id}`),
    });
  };

  return (
    <div className="col stagger ai-clauses" style={{ gap: 24 }}>
      <PageHeader
        title="Clause Bank"
        description="Your firm's approved clause language, grouped by category. Copy into any draft."
        meta={`${clauses.length} ${clauses.length === 1 ? 'clause' : 'clauses'} · ${grouped.size} ${grouped.size === 1 ? 'category' : 'categories'}`}
        actions={<>
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
        </>}
      />

      {isError && (
        <ErrorState
          icon="clauses"
          title="Couldn't load clauses"
          description="Check your connection and try again."
        />
      )}

      <div className="ai-clauses-grid">
        <aside className="ai-clauses-rail" aria-label="Clause categories">
          <div className="ai-eyebrow ai-clauses-rail-head">Categories</div>
          <div className="ai-clauses-cats" role="list">
            {categories.map((cat) => {
              const isActive = cat === activeCategory;
              const count = grouped.get(cat)?.length ?? 0;
              return (
                <button
                  key={cat}
                  type="button"
                  role="listitem"
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => setActiveCategory(cat)}
                  className={`ai-clauses-cat${isActive ? ' is-active' : ''}${count === 0 ? ' is-empty' : ''}`}
                >
                  <span className="ai-clauses-cat-name">{cat}</span>
                  <span className="ai-clauses-cat-count">{count}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="col" style={{ gap: 18, minWidth: 0 }}>
          <div className="ai-section-head">
            <h2 className="ai-section-title">{activeCategory}</h2>
            <span className="ai-section-meta">
              {activeClauses.length} {activeClauses.length === 1 ? 'clause' : 'clauses'}
            </span>
          </div>

          {isLoading ? (
            <div className="ai-clauses-cards" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="ai-clause-card">
                  <Skeleton width="62%" height={16} />
                  <Skeleton width="100%" height={12} />
                  <Skeleton width="84%" height={12} />
                </div>
              ))}
            </div>
          ) : activeClauses.length === 0 ? (
            <EmptyState
              icon="clauses"
              title="No clauses yet"
              description={`This category is empty. Add a firm-approved ${activeCategory.toLowerCase()} clause to start building this section of the bank.`}
              action={
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setNewOpen(true)}
                >
                  <Icon name="plus" size={14} /> Add first clause
                </button>
              }
            />
          ) : (
            <div className="ai-clauses-cards">
              {pager.slice.map((clause) => {
                const isCopied = copiedId === clause.id;
                const body = clause.body?.trim() ?? '';
                const desc = clause.description?.trim() ?? '';
                // Preview the clause text itself, unless it only repeats the description.
                const showBody = body.length > 0 && (desc === '' || !body.endsWith(desc));
                return (
                  <article key={clause.id} className="ai-clause-card">
                    <h3 className="ai-clause-title">{clause.title}</h3>
                    <p className="ai-clause-desc">{clause.description || <em>(no description)</em>}</p>
                    {showBody && <blockquote className="ai-clause-body">{body}</blockquote>}
                    <div className="ai-clause-foot">
                      <span className="ai-clause-uses">
                        <strong>{clause.uses.toLocaleString('en-IN')}</strong> {clause.uses === 1 ? 'use' : 'uses'}
                      </span>
                      <span className="spacer" />
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost ai-icon-btn"
                        onClick={() => { void handleDelete(clause); }}
                        aria-label={`Delete ${clause.title}`}
                        title="Delete clause"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm${isCopied ? ' is-done' : ''}`}
                        onClick={() => { void handleCopy(clause); }}
                        aria-label={`Copy ${clause.title}`}
                      >
                        <Icon name={isCopied ? 'check' : 'documents'} size={12} />
                        {isCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </article>
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
    </div>
  );
}
