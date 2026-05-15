import { useState, type FormEvent } from 'react';
import { Select } from '@lexdraft/ui';
import { useCreateClause } from '@/hooks/useClauses';
import { useUIStore } from '@/store/ui';

interface NewClauseModalProps {
  open: boolean;
  onClose: () => void;
  /** Existing categories from the bank (free-text; user may add a new one). */
  categories: ReadonlyArray<string>;
  /** Pre-fill if the user opened the modal from a specific category. */
  defaultCategory?: string;
}

const NEW_CAT_VALUE = '__new__';

export function NewClauseModal({ open, onClose, categories, defaultCategory }: NewClauseModalProps) {
  const create = useCreateClause();
  const showToast = useUIStore((s) => s.showToast);

  const [categoryChoice, setCategoryChoice] = useState<string>(defaultCategory ?? categories[0] ?? NEW_CAT_VALUE);
  const [newCategory, setNewCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');

  if (!open) return null;

  const isNew = categoryChoice === NEW_CAT_VALUE;
  const finalCategory = (isNew ? newCategory : categoryChoice).trim();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!finalCategory) {
      showToast({ type: 'vermillion', text: 'Pick or name a category' });
      return;
    }
    try {
      await create.mutateAsync({
        category: finalCategory,
        title: title.trim(),
        description: description.trim(),
        body: body.trim(),
      });
      showToast({ type: 'sage', text: `Clause "${title}" added` });
      // reset
      setTitle(''); setDescription(''); setBody(''); setNewCategory('');
      onClose();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error
        ?? (err as Error).message ?? 'Failed to create clause';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-clause-title"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          padding: 28,
          width: 'min(640px, 100%)',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>New clause</div>
          <h3 id="new-clause-title" className="display" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Add to clause bank
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
            Categories are free-text. Pick an existing one or create a new section.
          </p>
        </div>

        <Field label="CATEGORY *">
          <Select
            value={categoryChoice}
            onChange={setCategoryChoice}
            options={[
              ...categories.map((c) => ({ value: c, label: c })),
              { value: NEW_CAT_VALUE, label: '+ New category…' },
            ]}
          />
        </Field>

        {isNew && (
          <Field label="NEW CATEGORY NAME *">
            <input
              className="input"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="e.g. Force Majeure"
              autoFocus
              required
            />
          </Field>
        )}

        <Field label="TITLE *">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Mutual Indemnity (Standard)"
            required
            autoFocus={!isNew}
          />
        </Field>

        <Field label="DESCRIPTION">
          <textarea
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One-line summary shown on the clause card."
            rows={2}
          />
        </Field>

        <Field label="BODY *">
          <textarea
            className="input"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="The full clause text - what gets pasted into a draft."
            rows={8}
            required
          />
        </Field>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add clause'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{label}</span>
      {children}
    </label>
  );
}
