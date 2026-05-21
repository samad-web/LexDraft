import { useState } from 'react';
import { Icon } from '@lexdraft/ui';
import { useUIStore } from '@/store/ui';
import {
  useDeleteLetterhead,
  useLetterheads,
  useUpdateLetterhead,
  type Letterhead,
} from '@/hooks/useLetterheads';
import { LetterheadEditor, type LetterheadEditorMode } from './LetterheadEditor';
import { LetterheadPreview } from './LetterheadPreview';

/**
 * Settings → Letterhead panel.
 *
 * Two sections: Firm letterheads (shared) and Personal letterheads (only
 * me). Each section lists cards with a mini preview + name + default
 * badge + edit / delete actions. The "New letterhead" CTA in each section
 * pre-fills the scope.
 */
export function LetterheadsPanel() {
  const { data, isLoading } = useLetterheads();
  const [editorMode, setEditorMode] = useState<LetterheadEditorMode | null>(null);

  const firmItems = data?.firmItems ?? [];
  const personalItems = data?.personalItems ?? [];

  return (
    <div className="col" style={{ gap: 28 }}>
      {/* Effective default banner */}
      {data?.effectiveDefault && (
        <div
          className="card"
          style={{
            padding: 14,
            background: 'var(--bg-surface-2)',
            borderLeft: '3px solid var(--text-primary)',
          }}
        >
          <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <span
              className="mono"
              style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
            >
              ACTIVE DEFAULT
            </span>
            <strong>{data.effectiveDefault.name}</strong>
            <span className="body-sm muted">
              · {data.effectiveDefault.ownerUserId ? 'Personal' : 'Firm'} ·{' '}
              applied to your exports automatically
            </span>
          </div>
        </div>
      )}

      <Section
        title="Firm letterheads"
        subtitle="Shared with every member of the firm. The firm default is what new exports auto-use."
        items={firmItems}
        loading={isLoading}
        onCreate={() => setEditorMode({ kind: 'create', defaultScope: 'firm' })}
        onEdit={(id) => setEditorMode({ kind: 'edit', id })}
        emptyText="No firm letterheads yet. Create one to brand every member's exports."
      />

      <Section
        title="Personal letterheads"
        subtitle="Private to you. A personal default overrides the firm default on your own exports."
        items={personalItems}
        loading={isLoading}
        onCreate={() => setEditorMode({ kind: 'create', defaultScope: 'personal' })}
        onEdit={(id) => setEditorMode({ kind: 'edit', id })}
        emptyText="No personal letterheads. Create one if you'd like different stationery from the firm's."
      />

      {editorMode && (
        <LetterheadEditor
          open={!!editorMode}
          mode={editorMode}
          onClose={() => setEditorMode(null)}
        />
      )}
    </div>
  );
}

// ---------- Section ---------------------------------------------------------

interface SectionProps {
  title: string;
  subtitle: string;
  items: Letterhead[];
  loading: boolean;
  onCreate: () => void;
  onEdit: (id: string) => void;
  emptyText: string;
}

function Section({
  title,
  subtitle,
  items,
  loading,
  onCreate,
  onEdit,
  emptyText,
}: SectionProps) {
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="heading-md" style={{ marginBottom: 2 }}>
            {title}
          </div>
          <div className="body-sm muted">{subtitle}</div>
        </div>
        <button className="btn btn-sm" type="button" onClick={onCreate}>
          <Icon name="plus" size={14} /> New letterhead
        </button>
      </div>

      {loading && (
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          Loading…
        </div>
      )}

      {!loading && items.length === 0 && (
        <div
          className="card"
          style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}
        >
          {emptyText}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="grid-auto-lg" style={{ gap: 12 }}>
          {items.map((l) => (
            <LetterheadCard key={l.id} letterhead={l} onEdit={() => onEdit(l.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Single card -----------------------------------------------------

function LetterheadCard({
  letterhead,
  onEdit,
}: {
  letterhead: Letterhead;
  onEdit: () => void;
}) {
  const update = useUpdateLetterhead();
  const remove = useDeleteLetterhead();
  const showToast = useUIStore((s) => s.showToast);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleMakeDefault = async () => {
    try {
      await update.mutateAsync({
        id: letterhead.id,
        patch: { isDefault: true },
      });
      showToast({ type: 'sage', text: 'Default updated' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update default';
      showToast({ type: 'vermillion', text: message });
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync(letterhead.id);
      showToast({ type: 'sage', text: 'Letterhead deleted' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not delete';
      showToast({ type: 'vermillion', text: message });
    }
  };

  return (
    <div
      className="card"
      style={{
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Mini preview - letterheads with a logo show a placeholder until the
          GET URL resolves; the editor renders the live logo via useLogoUrl. */}
      <LetterheadPreview
        templateKey={letterhead.templateKey}
        fields={letterhead.fields}
        logoUrl={null}
        scaleToWidth={260}
      />

      <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
        <strong style={{ fontSize: 13 }}>{letterhead.name}</strong>
        {letterhead.isDefault && (
          <span
            className="badge badge-sage"
            style={{ fontSize: 10, padding: '2px 6px' }}
          >
            DEFAULT
          </span>
        )}
      </div>

      <div
        className="mono"
        style={{ fontSize: 10, color: 'var(--text-tertiary)' }}
      >
        {letterhead.templateKey.replace(/-/g, ' ').toUpperCase()}
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={onEdit}>
          Edit
        </button>
        {!letterhead.isDefault && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void handleMakeDefault()}
            disabled={update.isPending}
          >
            Set default
          </button>
        )}
        {confirmingDelete ? (
          <>
            <button
              className="btn btn-oxblood btn-sm"
              onClick={() => void handleDelete()}
              disabled={remove.isPending}
            >
              Confirm
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setConfirmingDelete(true)}
            style={{ color: 'var(--danger)', marginLeft: 'auto' }}
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
