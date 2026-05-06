import { useMemo, useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { DOC_TEMPLATES, type DocTemplate } from '@/lib/doc-templates';

interface DocTemplatesModalProps {
  open: boolean;
  currentDocType: string;
  onCancel: () => void;
  /** Caller switches doc type (if needed) and applies the field values. */
  onApply: (template: DocTemplate) => void;
  /** Reset the current doc type's brief to schema defaults. */
  onResetCurrent: () => void;
}

export function DocTemplatesModal({
  open,
  currentDocType,
  onCancel,
  onApply,
  onResetCurrent,
}: DocTemplatesModalProps) {
  const [filter, setFilter] = useState<'current' | 'all'>('current');

  const visible = useMemo(() => {
    if (filter === 'current') return DOC_TEMPLATES.filter((t) => t.docType === currentDocType);
    return DOC_TEMPLATES;
  }, [filter, currentDocType]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="templates-title"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          width: 'min(640px, 100%)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Brief library</div>
            <h3 id="templates-title" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              Pick a template
            </h3>
            <p className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
              Loads a realistic example brief into the form. Edit before generating.
            </p>
          </div>
        </div>

        <div className="row" style={{ gap: 6 }}>
          <button
            className={`chip${filter === 'current' ? ' active' : ''}`}
            onClick={() => setFilter('current')}
          >
            For this doc type
          </button>
          <button
            className={`chip${filter === 'all' ? ' active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All templates
          </button>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            border: '1px solid var(--border-default)',
            borderRadius: 8,
            background: 'var(--bg-surface)',
          }}
        >
          {visible.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              No templates yet for <em>{currentDocType}</em>. Switch to “All templates” to browse.
            </div>
          ) : (
            visible.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onApply(t)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px 14px',
                  background: 'transparent',
                  borderBottom: '1px solid var(--border-default)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {t.label}
                  </span>
                  <span className="spacer" />
                  <span className="mono" style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                    {t.docType.toUpperCase()}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                  {t.summary}
                </p>
              </button>
            ))
          )}
        </div>

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn btn-ghost" onClick={onResetCurrent}>
            <Icon name="close" size={12} /> Reset current brief
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
