import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import type { SavedDraft } from '@lexdraft/types';
import { useSavedDrafts, useDeleteDraft } from '@/hooks/useDrafts';
import { useUIStore } from '@/store/ui';

interface MyDraftsModalProps {
  open: boolean;
  onCancel: () => void;
  onLoad: (draft: SavedDraft) => void;
  currentDraftId: string | null;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((now - then) / 60000);
  if (Number.isNaN(diffMin)) return iso.slice(0, 10);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return iso.slice(0, 10);
}

export function MyDraftsModal({ open, onCancel, onLoad, currentDraftId }: MyDraftsModalProps) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const { data: drafts = [], isLoading, isError } = useSavedDrafts();
  const remove = useDeleteDraft();
  const showToast = useUIStore((s) => s.showToast);

  if (!open) return null;

  const handleDelete = (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    remove.mutate(id, {
      onSuccess: () => {
        setConfirmDelete(null);
        showToast({ type: 'sage', text: 'Draft deleted' });
      },
      onError: () => {
        setConfirmDelete(null);
        showToast({ type: 'cobalt', text: 'Could not delete draft' });
      },
    });
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="my-drafts-title"
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
          width: 'min(720px, 100%)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Saved drafts</div>
            <h3 id="my-drafts-title" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              My drafts
            </h3>
            <p className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
              Click a draft to load its brief and body back into the editor.
            </p>
          </div>
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
          {isLoading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              Loading drafts<span className="blink" />
            </div>
          )}
          {isError && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--danger)' }}>
              Couldn't load drafts.
            </div>
          )}
          {!isLoading && !isError && drafts.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
                No saved drafts yet
              </div>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                Click <strong>Save</strong> on any generated draft to keep it here.
              </p>
            </div>
          )}
          {drafts.map((d) => {
            const isActive = d.id === currentDraftId;
            const isConfirming = confirmDelete === d.id;
            return (
              <div
                key={d.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border-default)',
                  background: isActive ? 'var(--bg-surface-2)' : 'transparent',
                }}
              >
                <button
                  type="button"
                  onClick={() => onLoad(d)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    background: 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                      {d.title}
                    </span>
                    {isActive && (
                      <span
                        className="mono"
                        style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--border-default)', borderRadius: 4, color: 'var(--text-tertiary)' }}
                      >
                        OPEN
                      </span>
                    )}
                  </div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '0.04em' }}
                  >
                    {d.docType.toUpperCase()} · {d.language} · {formatRelative(d.updatedAt)}
                  </div>
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => handleDelete(d.id)}
                  disabled={remove.isPending}
                  title={isConfirming ? 'Click again to confirm' : 'Delete draft'}
                  style={isConfirming ? { color: 'var(--danger)' } : undefined}
                >
                  <Icon name="close" size={12} /> {isConfirming ? 'Confirm' : 'Delete'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn" onClick={onCancel}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
