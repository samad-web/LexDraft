import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Icon, EmptyState, ErrorState, Skeleton } from '@lexdraft/ui';
import {
  useCreateEngagementTemplate,
  useDeleteEngagementTemplate,
  useEngagementTemplates,
  useUpdateEngagementTemplate,
  type EngagementTemplate,
} from '@/hooks/useEngagement';
import { useUIStore } from '@/store/ui';
import { Modal, Field } from '@/components/Modal';
import { useConfirm } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';

/**
 * Engagement-letter template library - Firm-tier surface. Lists every
 * template owned by the firm, grouped by matter type, and offers CRUD plus a
 * "make default" toggle. The actual letter generation happens from the case
 * detail page (CaseDetailView); this view exists so firm admins can author
 * the standard scope/fee language once and reuse it.
 *
 * Matter types are free-text - same convention as the existing clause bank.
 * The list of "common" matter types is suggested but never enforced.
 */

const SUGGESTED_MATTER_TYPES: ReadonlyArray<string> = [
  'Civil litigation',
  'Criminal defence',
  'Corporate advisory',
  'Family law',
  'Real estate',
  'Employment',
  'Intellectual property',
  'Tax & regulatory',
  'Arbitration',
];

interface DraftForm {
  matterType: string;
  scopeClauses: string;
  feeClauses: string;
  retainerInr: string;
  notes: string;
  isDefault: boolean;
}

const EMPTY_FORM: DraftForm = {
  matterType: '',
  scopeClauses: '',
  feeClauses: '',
  retainerInr: '',
  notes: '',
  isDefault: false,
};

interface TemplatePayload {
  matterType: string;
  scopeClauses: string;
  feeClauses: string;
  retainerInr: number | null;
  notes: string | null;
  isDefault: boolean;
}

function formToPayload(form: DraftForm): TemplatePayload {
  const trimmedRetainer = form.retainerInr.trim();
  const parsedRetainer = trimmedRetainer === '' ? null : Math.max(0, Math.round(Number(trimmedRetainer)));
  return {
    matterType: form.matterType.trim(),
    scopeClauses: form.scopeClauses.trim(),
    feeClauses: form.feeClauses.trim(),
    retainerInr: parsedRetainer !== null && Number.isFinite(parsedRetainer) ? parsedRetainer : null,
    notes: form.notes.trim() === '' ? null : form.notes.trim(),
    isDefault: form.isDefault,
  };
}

function templateToForm(t: EngagementTemplate): DraftForm {
  return {
    matterType: t.matterType,
    scopeClauses: t.scopeClauses,
    feeClauses: t.feeClauses,
    retainerInr: t.retainerInr === null ? '' : String(t.retainerInr),
    notes: t.notes ?? '',
    isDefault: t.isDefault,
  };
}

function formatInr(value: number | null): string {
  if (value === null || value === undefined) return '-';
  return `₹${new Intl.NumberFormat('en-IN').format(value)}`;
}

function readErrorMessage(err: unknown, fallback: string): string {
  return (
    (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error ??
    (err as Error)?.message ??
    fallback
  );
}

export function EngagementTemplatesView() {
  const { data, isLoading, isError } = useEngagementTemplates();
  const showToast = useUIStore((s) => s.showToast);
  const confirm = useConfirm();

  const create = useCreateEngagementTemplate();
  const update = useUpdateEngagementTemplate();

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const total = data?.items.length ?? 0;

  const [editing, setEditing] = useState<EngagementTemplate | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const handleCreate = async (payload: TemplatePayload) => {
    await create.mutateAsync(payload);
  };

  const handleUpdate = (id: string) => async (payload: TemplatePayload) => {
    await update.mutateAsync({ id, patch: payload });
  };

  return (
    <div className="col stagger cm-engage" style={{ gap: 24 }}>
      <PageHeader
        title="Engagement Letters"
        description="Standard scope and fee wording per matter type, filled in when a matter opens."
        meta={`${total} ${total === 1 ? 'template' : 'templates'} · ${groups.length} ${groups.length === 1 ? 'matter type' : 'matter types'}`}
        actions={
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => setNewOpen(true)}
          >
            <Icon name="plus" size={14} /> New template
          </button>
        }
      />

      {isError && (
        <ErrorState
          title="Couldn't load engagement templates"
          description="Check your connection and try again."
        />
      )}

      {isLoading ? (
        <div className="col" style={{ gap: 12 }} aria-busy="true">
          <Skeleton width={220} height={22} />
          <div className="cm-tpl-grid">
            <Skeleton width="100%" height={220} />
            <Skeleton width="100%" height={220} />
          </div>
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon="documents"
          title="No engagement templates yet"
          description="Add your first template to standardise the language your firm uses for new engagements. You can mark one as default per matter type: the default is what 'Generate engagement letter' on a matter picks up automatically."
          action={
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setNewOpen(true)}
            >
              <Icon name="plus" size={14} /> Add first template
            </button>
          }
        />
      ) : (
        <div className="col" style={{ gap: 36 }}>
          {groups.map((group) => (
            <section key={group.matterType} className="col" style={{ gap: 16 }}>
              <div className="cm-group-head">
                <h2 className="cm-group-title">{group.matterType}</h2>
                <span className="cm-label">
                  {group.templates.length} {group.templates.length === 1 ? 'template' : 'templates'}
                </span>
              </div>
              <div className="cm-tpl-grid">
                {group.templates.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    onEdit={() => setEditing(t)}
                    confirm={confirm}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <TemplateModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New engagement template"
        eyebrow="Firm-approved language"
        submitLabel="Create template"
        initial={EMPTY_FORM}
        onSubmit={handleCreate}
        toast={showToast}
      />

      {editing && (
        <TemplateModal
          open={true}
          onClose={() => setEditing(null)}
          title={`Edit · ${editing.matterType}`}
          eyebrow="Engagement template"
          submitLabel="Save changes"
          initial={templateToForm(editing)}
          onSubmit={handleUpdate(editing.id)}
          toast={showToast}
        />
      )}
    </div>
  );
}

/* ---------- Cards ---------- */

interface TemplateCardProps {
  template: EngagementTemplate;
  onEdit: () => void;
  confirm: ReturnType<typeof useConfirm>;
}

function TemplateCard({ template, onEdit, confirm }: TemplateCardProps) {
  const del = useDeleteEngagementTemplate();
  const update = useUpdateEngagementTemplate();
  const showToast = useUIStore((s) => s.showToast);

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete this template?',
      message: `"${template.matterType}" template will be removed permanently.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(template.id);
      showToast({ type: 'sage', text: 'Template deleted' });
    } catch (err) {
      showToast({ type: 'vermillion', text: readErrorMessage(err, 'Could not delete template') });
    }
  };

  const handleMakeDefault = async () => {
    try {
      await update.mutateAsync({ id: template.id, patch: { isDefault: true } });
      showToast({ type: 'sage', text: 'Default updated' });
    } catch (err) {
      showToast({ type: 'vermillion', text: readErrorMessage(err, 'Could not update template') });
    }
  };

  return (
    <article className={`card card-hover cm-tpl${template.isDefault ? ' is-default' : ''}`}>
      <div className="cm-tpl-top">
        <div style={{ minWidth: 0 }}>
          {template.isDefault && (
            <span className="cm-pill cm-pill--ink" style={{ marginBottom: 10 }}>
              <Icon name="check" size={11} /> Default
            </span>
          )}
          <div className="cm-tpl-name">{template.matterType}</div>
          {template.notes && <p className="cm-tpl-notes">{template.notes}</p>}
        </div>
        <div className="cm-tpl-fee">
          <div className="cm-label">Retainer</div>
          <div className="cm-tpl-fee-v">{formatInr(template.retainerInr)}</div>
        </div>
      </div>
      <div>
        <div className="cm-label">Scope preview</div>
        <p className="cm-tpl-quote">{template.scopeClauses}</p>
      </div>
      {template.feeClauses && (
        <div>
          <div className="cm-label">Fees</div>
          <p className="cm-tpl-quote cm-tpl-quote--fee">{template.feeClauses}</p>
        </div>
      )}
      <div className="cm-tpl-foot">
        {template.isDefault ? (
          <span className="cm-tpl-default-note"><Icon name="check" size={12} /> Used for new matters</span>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => { void handleMakeDefault(); }}
            disabled={update.isPending}
            title="Mark this as the default for this matter type"
          >
            <Icon name="check" size={12} /> Make default
          </button>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => { void handleDelete(); }}
          title="Delete template"
          aria-label="Delete template"
        >
          <Icon name="trash" size={12} /> Delete
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={onEdit}
        >
          <Icon name="edit" size={12} /> Edit
        </button>
      </div>
    </article>
  );
}

/* ---------- Modal ---------- */

interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow: string;
  submitLabel: string;
  initial: DraftForm;
  onSubmit: (payload: TemplatePayload) => Promise<void>;
  toast: (toast: { type: 'sage' | 'cobalt' | 'amber' | 'vermillion'; text: string }) => void;
}

function TemplateModal({
  open,
  onClose,
  title,
  eyebrow,
  submitLabel,
  initial,
  onSubmit,
  toast,
}: TemplateModalProps) {
  const [form, setForm] = useState<DraftForm>(initial);
  const [submitting, setSubmitting] = useState(false);

  // Reset internal state when the modal re-opens (e.g. switching between
  // editing one template and then opening a fresh "New template" flow).
  useEffect(() => {
    if (open) setForm(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const payload = formToPayload(form);
    if (!payload.matterType || !payload.scopeClauses || !payload.feeClauses) {
      toast({ type: 'vermillion', text: 'Matter type, scope and fee clauses are required' });
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(payload);
      toast({ type: 'sage', text: 'Template saved' });
      onClose();
    } catch (err) {
      toast({ type: 'vermillion', text: readErrorMessage(err, 'Failed to save template') });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      eyebrow={eyebrow}
      width={760}
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Saving…' : submitLabel}
          </button>
        </>
      }
    >
      <Field label="MATTER TYPE *">
        <input
          className="input"
          list="engagement-matter-types"
          value={form.matterType}
          onChange={(e) => setForm((f) => ({ ...f, matterType: e.target.value }))}
          placeholder="e.g. Civil litigation"
          required
          autoFocus
        />
        <datalist id="engagement-matter-types">
          {SUGGESTED_MATTER_TYPES.map((m) => <option key={m} value={m} />)}
        </datalist>
      </Field>

      <Field label="SCOPE OF ENGAGEMENT *">
        <textarea
          className="input"
          value={form.scopeClauses}
          onChange={(e) => setForm((f) => ({ ...f, scopeClauses: e.target.value }))}
          rows={6}
          required
          placeholder={
            "Define what the firm will and won't do for the client. Supports placeholders: {{matter.title}}, {{matter.cnr}}, {{matter.court}}, {{client.name}}."
          }
        />
      </Field>

      <Field label="FEES AND PAYMENT TERMS *">
        <textarea
          className="input"
          value={form.feeClauses}
          onChange={(e) => setForm((f) => ({ ...f, feeClauses: e.target.value }))}
          rows={6}
          required
          placeholder={
            'Hourly rates, billing cadence, payment terms. {{retainer.inr}} interpolates the retainer.'
          }
        />
      </Field>

      <div className="grid-2" style={{ gap: 12 }}>
        <Field label="DEFAULT RETAINER (INR)">
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            value={form.retainerInr}
            onChange={(e) => setForm((f) => ({ ...f, retainerInr: e.target.value }))}
            placeholder="e.g. 100000"
          />
        </Field>
        <Field label="NOTES (INTERNAL)">
          <input
            className="input"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Optional - visible only to firm staff"
          />
        </Field>
      </div>

      <label className="cm-tpl-form-check">
        <input
          type="checkbox"
          checked={form.isDefault}
          onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
        />
        Use as default template for this matter type
      </label>
    </Modal>
  );
}
