import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from 'react';
import { Icon } from '@lexdraft/ui';
import type { User } from '@lexdraft/types';
import { Modal } from '@/components/Modal';
import { useUIStore } from '@/store/ui';
import { useAuthStore } from '@/store/auth';
import {
  useCreateLetterhead,
  useLetterhead,
  useLogoUrl,
  useUpdateLetterhead,
  useUploadLetterheadLogo,
  type Letterhead,
  type LetterheadFields,
  type LetterheadTemplateKey,
} from '@/hooks/useLetterheads';
import { LETTERHEAD_TEMPLATES, getTemplate } from '@/lib/letterhead-templates';
import { LetterheadPreview } from './LetterheadPreview';

/**
 * Letterhead designer.
 *
 * Three panels stacked vertically (on narrow screens) or laid out as
 * template-strip → form/preview split (on wide screens):
 *   1. Template strip - clickable cards, one per layout
 *   2. Slot form - text fields the chosen template uses, plus the logo
 *      uploader + scope/default toggles
 *   3. Live preview - the LetterheadPreview component, re-rendering on
 *      every field/template change
 *
 * Save flow:
 *   - "create" mode: POST /letterheads → close modal
 *   - "edit" mode: PATCH /letterheads/:id → close modal
 *   - Logo upload: when a new file is picked, runs the presigned PUT
 *     immediately so the resulting storage key is on hand before save.
 *     If the user cancels, the orphan key is harmless - the storage
 *     driver garbage-collects it eventually (TODO once that worker exists).
 */

export type LetterheadEditorMode =
  | { kind: 'create'; defaultScope: 'firm' | 'personal' }
  | { kind: 'edit'; id: string };

interface LetterheadEditorProps {
  open: boolean;
  mode: LetterheadEditorMode;
  onClose: () => void;
}

const SUPPORTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function LetterheadEditor({ open, mode, onClose }: LetterheadEditorProps) {
  const showToast = useUIStore((s) => s.showToast);
  const create = useCreateLetterhead();
  const update = useUpdateLetterhead();
  const uploadLogo = useUploadLetterheadLogo();
  // Auth user is the source of truth for auto-population. The fields the
  // advocate gave us at sign-up (firm name, email, enrolment, primary court,
  // practice areas) seed the letterhead so they don't have to type them
  // again. Solo advocates get the most aggressive defaults - name, scope and
  // is-default are pre-set so they can save without filling anything in.
  const authUser = useAuthStore((s) => s.user);
  const isSolo = authUser?.plan === 'Solo';

  // In edit mode we need to hydrate from the server. We don't bother fetching
  // the logo URL until the existing letterhead loads (`hasLogo` gate).
  const existingId = mode.kind === 'edit' ? mode.id : null;
  const existingQuery = useLetterhead(existingId);
  const existing = existingQuery.data ?? null;

  // Local form state. Initial values are seeded from the chosen template's
  // defaults in create mode, or from the loaded letterhead in edit mode.
  const [templateKey, setTemplateKey] = useState<LetterheadTemplateKey>('classic-centered');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'firm' | 'personal'>(
    mode.kind === 'create' ? mode.defaultScope : 'firm',
  );
  const [isDefault, setIsDefault] = useState(false);
  const [fields, setFields] = useState<LetterheadFields>({});
  const [logoKey, setLogoKey] = useState<string | null>(null);
  // While the upload is in flight we have a freshly-picked logo but no key
  // yet. Keep the data URL so the preview shows the new image immediately
  // rather than waiting for the round trip.
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  // Hydrate when editing an existing letterhead.
  useEffect(() => {
    if (mode.kind === 'edit' && existing) {
      setTemplateKey(existing.templateKey);
      setName(existing.name);
      setScope(existing.ownerUserId ? 'personal' : 'firm');
      setIsDefault(existing.isDefault);
      setFields(existing.fields ?? {});
      setLogoKey(existing.logoKey);
      setLogoPreviewUrl(null);
    }
  }, [mode.kind, existing]);

  // Reset on re-open in create mode - seed with first template's defaults,
  // then layer the signup-provided profile data on top so the form is already
  // filled in. For solo advocates we also auto-suggest a name and turn on
  // the default-flag so they can save without touching anything.
  useEffect(() => {
    if (!open || mode.kind !== 'create') return;
    const first = LETTERHEAD_TEMPLATES[0]!;
    setTemplateKey(first.key);
    setName(isSolo && authUser?.name ? `${authUser.name}'s letterhead` : '');
    setScope(mode.defaultScope);
    setIsDefault(isSolo);
    setFields(seedFieldsFromUser(authUser, first.defaultFields));
    setLogoKey(null);
    setLogoPreviewUrl(null);
  }, [open, mode.kind, mode.kind === 'create' ? mode.defaultScope : null, authUser, isSolo]);

  // For the preview we prefer the freshly-picked local URL; otherwise we
  // fetch the saved logo via its letterhead id (only meaningful in edit mode).
  const savedLogoUrl = useLogoUrl(existingId, !!logoKey);
  const previewLogoUrl = logoPreviewUrl ?? savedLogoUrl.data ?? null;

  const tpl = getTemplate(templateKey);

  // Picking a fresh template should rewrite slot defaults that the user
  // hasn't filled in yet, but preserve anything they've explicitly typed.
  const handlePickTemplate = (key: LetterheadTemplateKey) => {
    setTemplateKey(key);
    if (mode.kind === 'create') {
      const next = getTemplate(key).defaultFields;
      setFields((cur) => ({ ...next, ...stripEmpty(cur) }));
    }
  };

  const updateField = (k: keyof LetterheadFields, v: string) => {
    setFields((cur) => ({ ...cur, [k]: v }));
  };

  const handleLogoFile = async (file: File | undefined) => {
    if (!file) return;
    if (!SUPPORTED_LOGO_TYPES.includes(file.type)) {
      showToast({
        type: 'amber',
        text: 'Unsupported logo format. Use PNG, JPG, SVG, or WebP.',
      });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      showToast({ type: 'amber', text: 'Logo must be smaller than 2 MB.' });
      return;
    }
    // Local preview ASAP, then upload in the background.
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setLogoPreviewUrl(reader.result);
    };
    reader.readAsDataURL(file);
    try {
      const key = await uploadLogo.mutateAsync(file);
      setLogoKey(key);
    } catch (err) {
      setLogoPreviewUrl(null);
      const message = err instanceof Error ? err.message : 'Logo upload failed';
      showToast({ type: 'vermillion', text: message });
    }
  };

  const onBrowse = (e: ChangeEvent<HTMLInputElement>) => {
    void handleLogoFile(e.target.files?.[0] ?? undefined);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    void handleLogoFile(e.dataTransfer?.files?.[0]);
  };

  const handleRemoveLogo = () => {
    setLogoKey(null);
    setLogoPreviewUrl(null);
  };

  const canSave = name.trim().length > 0 && !create.isPending && !update.isPending;

  const handleSave = async () => {
    if (!canSave) return;
    try {
      if (mode.kind === 'create') {
        await create.mutateAsync({
          scope,
          name: name.trim(),
          templateKey,
          fields: stripEmpty(fields),
          logoKey,
          isDefault,
        });
        showToast({ type: 'sage', text: 'Letterhead created' });
      } else {
        await update.mutateAsync({
          id: mode.id,
          patch: {
            name: name.trim(),
            templateKey,
            fields: stripEmpty(fields),
            logoKey,
            isDefault,
          },
        });
        showToast({ type: 'sage', text: 'Letterhead updated' });
      }
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save letterhead';
      showToast({ type: 'vermillion', text: message });
    }
  };

  // Which slot fields to render. The template definitions don't carry an
  // explicit "supported fields" list - instead we surface every slot in
  // the editor; templates that ignore a slot just won't render it. This
  // keeps the editor simple and lets users move between templates without
  // losing typed values.
  const slotInputs = useMemo(() => buildSlotInputs(fields, updateField), [fields]);
  void slotInputs; // referenced in JSX below via direct call; useMemo just memoises updateField identity

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode.kind === 'create' ? 'New letterhead' : 'Edit letterhead'}
      width={960}
    >
      <div className="col" style={{ gap: 20 }}>
        {mode.kind === 'edit' && existingQuery.isLoading && (
          <div className="mono" style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
            Loading…
          </div>
        )}

        {/* Preview - hero block at the top, spans full modal width */}
        <div className="col" style={{ gap: 8 }}>
          <div className="label">Preview</div>
          <div
            className="letterhead-preview-wrap"
            style={{
              display: 'flex',
              justifyContent: 'center',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              padding: 16,
              overflow: 'auto',
            }}
          >
            <LetterheadPreview
              templateKey={templateKey}
              fields={fields}
              logoUrl={previewLogoUrl}
              scaleToWidth={860}
            />
          </div>
        </div>

        {/* Template chips - compact horizontal cards below the preview */}
        <div className="col" style={{ gap: 8 }}>
          <div className="label">Template</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 6,
            }}
          >
            {LETTERHEAD_TEMPLATES.map((t) => {
              const active = t.key === templateKey;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => handlePickTemplate(t.key)}
                  title={t.description}
                  className="card card-hover"
                  style={{
                    padding: '8px 10px',
                    textAlign: 'left',
                    background: active ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
                    borderColor: active ? 'var(--text-primary)' : 'var(--border-default)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Form fields */}
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="label">Letterhead name (internal)</span>
            <input
              className="input"
              value={name}
              placeholder="e.g. Court filings"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          {/* Scope toggle - only meaningful when the user belongs to a multi-
              person firm. Solo advocates have no firm/personal distinction, so
              we hide it entirely and let the caller's defaultScope stand. */}
          {!isSolo && (
            <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
              <label className="row" style={{ gap: 6, fontSize: 13 }}>
                <input
                  type="radio"
                  checked={scope === 'firm'}
                  onChange={() => setScope('firm')}
                />
                Shared with firm
              </label>
              <label className="row" style={{ gap: 6, fontSize: 13 }}>
                <input
                  type="radio"
                  checked={scope === 'personal'}
                  onChange={() => setScope('personal')}
                />
                Personal (only me)
              </label>
            </div>
          )}

          <label className="row" style={{ gap: 6, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
            />
            {isSolo
              ? 'Set as default'
              : `Set as default for ${scope === 'firm' ? 'firm' : 'me'}`}
          </label>

          <hr className="hairline" style={{ margin: '8px 0' }} />

          {/* Logo dropzone */}
          <div className="col" style={{ gap: 6 }}>
            <span className="label">Logo</span>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              style={{
                border: '1px dashed var(--border-strong)',
                borderRadius: 'var(--radius-md)',
                padding: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'var(--bg-surface)',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  background: 'var(--bg-surface-2)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  flex: '0 0 auto',
                }}
              >
                {previewLogoUrl ? (
                  <img
                    src={previewLogoUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <Icon name="upload" size={20} className="muted" />
                )}
              </div>
              <div style={{ flex: 1, fontSize: 12, color: 'var(--text-tertiary)' }}>
                {previewLogoUrl
                  ? 'Drop a new image to replace, or remove below.'
                  : 'Drop a PNG, JPG, SVG, or WebP (max 2 MB).'}
              </div>
              <div className="col" style={{ gap: 4 }}>
                <label className="btn btn-sm">
                  {previewLogoUrl ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    hidden
                    accept={SUPPORTED_LOGO_TYPES.join(',')}
                    onChange={onBrowse}
                  />
                </label>
                {(logoKey || previewLogoUrl) && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleRemoveLogo}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {uploadLogo.isPending && (
              <div
                className="mono"
                style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
              >
                Uploading…
              </div>
            )}
          </div>

          <hr className="hairline" style={{ margin: '8px 0' }} />

          {/* Slot fields - paired into 2-col rows on wide screens for tighter
              vertical rhythm now that we have the full modal width. */}
          <div
            className="letterhead-slot-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            <Slot
              label="Firm name"
              value={fields.firmName}
              onChange={(v) => updateField('firmName', v)}
            />
            <Slot
              label="Tagline / subtitle"
              value={fields.tagline}
              onChange={(v) => updateField('tagline', v)}
            />
            <div style={{ gridColumn: '1 / -1' }}>
              <AddressLines
                value={fields.addressLines}
                onChange={(lines) => setFields((cur) => ({ ...cur, addressLines: lines }))}
              />
            </div>
            <Slot
              label="Phone"
              value={fields.phone}
              onChange={(v) => updateField('phone', v)}
            />
            <Slot
              label="Email"
              value={fields.email}
              onChange={(v) => updateField('email', v)}
            />
            <Slot
              label="Website"
              value={fields.website}
              onChange={(v) => updateField('website', v)}
            />
            <Slot
              label="Registration / Enrolment no."
              value={fields.regNumber}
              onChange={(v) => updateField('regNumber', v)}
            />
            <div style={{ gridColumn: '1 / -1' }}>
              <Slot
                label="Footer text"
                value={fields.footerText}
                onChange={(v) => updateField('footerText', v)}
              />
            </div>
            {tpl.key === 'modern-accent' && (
              <label className="col" style={{ gap: 4, maxWidth: 200 }}>
                <span className="label">Accent colour</span>
                <input
                  type="color"
                  className="input"
                  value={fields.accentColor ?? '#2c5282'}
                  onChange={(e) => updateField('accentColor', e.target.value)}
                  style={{ padding: 4, height: 36 }}
                />
              </label>
            )}
          </div>
        </div>

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={!canSave}
          >
            {create.isPending || update.isPending
              ? 'Saving…'
              : mode.kind === 'create' ? 'Create letterhead' : 'Save changes'}
          </button>
        </div>

        <style>{`@media (max-width: 768px) { .letterhead-slot-grid { grid-template-columns: 1fr !important; } }`}</style>
      </div>
    </Modal>
  );
}

// ---------- Slot helpers ----------------------------------------------------

interface SlotProps {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  style?: React.CSSProperties;
}

function Slot({ label, value, onChange, style }: SlotProps) {
  return (
    <label className="col" style={{ gap: 4, ...style }}>
      <span className="label">{label}</span>
      <input
        className="input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function AddressLines({
  value,
  onChange,
}: {
  value: string[] | undefined;
  onChange: (lines: string[]) => void;
}) {
  // Render the multi-line address as a single textarea - much less ceremony
  // than per-line inputs and lets the user newline-separate at their pace.
  const text = (value ?? []).join('\n');
  return (
    <label className="col" style={{ gap: 4 }}>
      <span className="label">Address (one line per row)</span>
      <textarea
        className="input"
        rows={3}
        value={text}
        onChange={(e) => onChange(e.target.value.split('\n'))}
        style={{ height: 'auto', minHeight: 60 }}
      />
    </label>
  );
}

// Build a list of inputs - placeholder for the useMemo dance; the actual
// rendering happens inline in JSX above so each component can read fields
// directly without prop drilling.
function buildSlotInputs(
  _fields: LetterheadFields,
  _onChange: (k: keyof LetterheadFields, v: string) => void,
): null {
  void _fields; void _onChange;
  return null;
}

/** Drop empty/whitespace-only fields before sending to the server. Keeps
 *  the stored JSON small and lets templates fall through to their "field
 *  absent" branches cleanly. */
function stripEmpty(fields: LetterheadFields): LetterheadFields {
  const out: LetterheadFields = {};
  for (const [k, v] of Object.entries(fields) as [keyof LetterheadFields, unknown][]) {
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed) (out as Record<string, unknown>)[k] = trimmed;
    } else if (Array.isArray(v)) {
      const cleaned = v.map((s) => String(s).trim()).filter(Boolean);
      if (cleaned.length > 0) (out as Record<string, unknown>)[k] = cleaned;
    }
  }
  return out;
}

/** Merge the signup-provided profile data onto a template's default slots so
 *  the create-mode form opens already populated. Signup values override the
 *  template's placeholder defaults - the user can still edit any slot, but
 *  for the common case (solo advocate accepting the prefill) no typing is
 *  required to save a usable letterhead. */
function seedFieldsFromUser(
  user: User | null,
  templateDefaults: LetterheadFields,
): LetterheadFields {
  const seeded: LetterheadFields = { ...templateDefaults };
  if (!user) return seeded;
  // Firm name: prefer the firm/chambers name the user gave us. Fall back to
  // the practitioner's full name for a solo advocate who skipped chambers.
  const firmName = user.firm?.trim() || (user.plan === 'Solo' ? user.name : '');
  if (firmName) seeded.firmName = firmName;
  if (user.email) seeded.email = user.email;
  if (user.enrolment) seeded.regNumber = user.enrolment;
  if (user.practiceAreas) seeded.tagline = user.practiceAreas;
  if (user.primaryCourt) seeded.footerText = `Practising before ${user.primaryCourt}`;
  return seeded;
}

/** Surface for parents that want to render a saved letterhead as a card. */
export function letterheadScopeLabel(l: Letterhead): string {
  return l.ownerUserId === null ? 'Firm' : 'Personal';
}
