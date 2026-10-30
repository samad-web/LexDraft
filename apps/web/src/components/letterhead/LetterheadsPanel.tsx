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
    <div className="fm-lh">
      {/* Effective default banner */}
      {data?.effectiveDefault && (
        <div className="fm-lh-default">
          <span className="fm-eyebrow">Active default</span>
          <span className="fm-lh-default-name">{data.effectiveDefault.name}</span>
          <span className="fm-lh-default-note">
            {data.effectiveDefault.ownerUserId ? 'Personal' : 'Firm'} · applied to your exports automatically
          </span>
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
    <section className="fm-lh-section">
      <div className="fm-lh-head">
        <div>
          <h2 className="fm-panel-title" style={{ margin: 0 }}>{title}</h2>
          <p className="fm-panel-sub">{subtitle}</p>
        </div>
        <button className="btn btn-sm" type="button" onClick={onCreate}>
          <Icon name="plus" size={14} /> New letterhead
        </button>
      </div>

      {loading && <div className="fm-status-sub">Loading…</div>}

      {!loading && items.length === 0 && (
        <div className="fm-lh-empty">{emptyText}</div>
      )}

      {!loading && items.length > 0 && (
        <div className="fm-lh-grid">
          {items.map((l) => (
            <LetterheadCard key={l.id} letterhead={l} onEdit={() => onEdit(l.id)} />
          ))}
        </div>
      )}
    </section>
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
    <div className="fm-lh-card">
      {/* Mini preview - letterheads with a logo show a placeholder until the
          GET URL resolves; the editor renders the live logo via useLogoUrl. */}
      <div className="fm-lh-paper">
        <LetterheadPreview
          templateKey={letterhead.templateKey}
          fields={letterhead.fields}
          logoUrl={null}
          scaleToWidth={240}
        />
      </div>

      <div className="fm-lh-meta">
        <div className="fm-lh-name">
          {letterhead.name}
          {letterhead.isDefault && <span className="fm-pill is-solid">Default</span>}
        </div>
        <div className="fm-lh-tpl">{letterhead.templateKey.replace(/-/g, ' ')}</div>
      </div>

      <div className="fm-lh-actions">
        <button className="btn btn-ghost btn-sm" onClick={onEdit}>
          <Icon name="edit" size={13} /> Edit
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
              className="btn btn-danger btn-sm is-end"
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
            className="btn btn-ghost btn-sm is-end"
            onClick={() => setConfirmingDelete(true)}
            aria-label={`Delete ${letterhead.name}`}
            title="Delete"
          >
            <Icon name="trash" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
