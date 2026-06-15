import { useState } from 'react';
import { Select, Skeleton } from '@lexdraft/ui';
import type { DocumentTemplate, TemplateScope } from '@lexdraft/types';
import {
  useCreateTemplate, useDeleteTemplate, useTemplates, useUpdateTemplate,
} from '../queries';
import { useConfirm } from '@/components/ConfirmDialog';
import { useUIStore } from '@/store/ui';
import { Pagination } from '@/components/Pagination';
import { usePagination } from '@/hooks/usePagination';

export function TemplatesView() {
  const [scope, setScope] = useState<TemplateScope | ''>('');
  const { data: templates = [], isLoading } = useTemplates(scope || undefined);
  const pager = usePagination(templates);
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const del = useDeleteTemplate();
  const confirm = useConfirm();
  const showToast = useUIStore((s) => s.showToast);

  const requestDelete = async (template: DocumentTemplate) => {
    const ok = await confirm({
      title: `Delete template "${template.name}"?`,
      message: 'This template will be removed from the platform library.',
      confirmLabel: 'Delete template',
      danger: true,
    });
    if (ok) {
      del.mutate(template.id, {
        onError: (err) => showToast({
          type: 'vermillion',
          text: (err as Error)?.message || `Couldn’t delete ${template.name}`,
        }),
      });
    }
  };

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Templates</div>
          <h1 className="display-md">Document templates · {templates.length}</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>+ New template</button>
      </header>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ width: 220 }}>
          <Select
            value={scope}
            onChange={(v) => setScope(v as TemplateScope | '')}
            options={[
              { value: '', label: 'All scopes' },
              { value: 'platform', label: 'Platform-wide' },
              { value: 'firm', label: 'Firm-scoped' },
            ]}
          />
        </div>
      </div>

      {isLoading ? (
        <table className="tbl" aria-busy="true">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 180 }}>Slug</th>
              <th style={{ width: 130 }}>Scope</th>
              <th style={{ width: 200 }}>Updated</th>
              <th style={{ width: 200, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, i) => (
              <tr key={`sk-${i}`}>
                <td><Skeleton width={160} height={14} /></td>
                <td><Skeleton width={140} height={12} /></td>
                <td><Skeleton width={80} height={20} radius="pill" /></td>
                <td><Skeleton width={150} height={12} /></td>
                <td style={{ textAlign: 'right' }}><Skeleton width={120} height={24} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th style={{ width: 180 }}>Slug</th>
              <th style={{ width: 130 }}>Scope</th>
              <th style={{ width: 200 }}>Updated</th>
              <th style={{ width: 200, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pager.slice.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="mono" style={{ fontSize: 12 }}>{t.slug}</td>
                <td><span className="badge">{t.scope}</span></td>
                <td className="mono" style={{ fontSize: 12 }}>{new Date(t.updatedAt).toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'inline-flex', gap: 6 }}>
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(t)}>Edit</button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                      onClick={() => { void requestDelete(t); }}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {templates.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 32 }}>No templates.</td></tr>
            )}
          </tbody>
        </table>
      )}
      {!isLoading && templates.length > 0 && (
        <Pagination
          page={pager.page}
          totalPages={pager.totalPages}
          total={pager.total}
          pageSize={pager.pageSize}
          onChange={pager.setPage}
        />
      )}

      {editing && <EditTemplateModal template={editing} onClose={() => setEditing(null)} />}
      {creating && <CreateTemplateModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateTemplateModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [scope, setScope] = useState<TemplateScope>('platform');
  const [firmId, setFirmId] = useState('');
  const [body, setBody] = useState('');
  const create = useCreateTemplate();
  const showToast = useUIStore((s) => s.showToast);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await create.mutateAsync({
        name, slug, scope, body,
        firmId: scope === 'firm' ? firmId : null,
      });
      onClose();
    } catch (err) {
      showToast({
        type: 'vermillion',
        text: (err as Error)?.message || 'Couldn’t create template',
      });
    }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="eyebrow">New template</div>
        <h3 className="display" style={{ fontSize: 22, fontWeight: 600 }}>Create document template</h3>
        <Field label="NAME"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        <Field label="SLUG (a-z, 0-9, dashes)"><input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} pattern="[a-z0-9-]+" required /></Field>
        <Field label="SCOPE">
          <Select
            value={scope}
            onChange={(v) => setScope(v as TemplateScope)}
            options={[
              { value: 'platform', label: 'Platform-wide' },
              { value: 'firm', label: 'Firm-scoped' },
            ]}
          />
        </Field>
        {scope === 'firm' && (
          <Field label="FIRM ID (UUID)"><input className="input" value={firmId} onChange={(e) => setFirmId(e.target.value)} required /></Field>
        )}
        <Field label="BODY (Markdown)">
          <textarea className="input" rows={10} value={body} onChange={(e) => setBody(e.target.value)} required />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create template'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditTemplateModal({ template, onClose }: { template: DocumentTemplate; onClose: () => void }) {
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const update = useUpdateTemplate();
  const showToast = useUIStore((s) => s.showToast);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await update.mutateAsync({ id: template.id, patch: { name, body } });
      onClose();
    } catch (err) {
      showToast({
        type: 'vermillion',
        text: (err as Error)?.message || 'Couldn’t save template',
      });
    }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="eyebrow">Edit template</div>
        <h3 className="display" style={{ fontSize: 22, fontWeight: 600 }}>{template.slug}</h3>
        <Field label="NAME"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="BODY (Markdown)">
          <textarea className="input" rows={14} value={body} onChange={(e) => setBody(e.target.value)} required />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      role="dialog"
      style={{
        position: 'fixed', inset: 0, background: 'var(--scrim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-base)', border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)', padding: 28, width: 600, maxHeight: '80vh', overflow: 'auto',
        }}
      >
        {children}
      </div>
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
