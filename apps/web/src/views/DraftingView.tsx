import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DatePicker, Icon, Select } from '@lexdraft/ui';
import type { DraftRequest } from '@lexdraft/types';
import { useStreamDraft } from '@/hooks/useDrafting';
import { useUIStore } from '@/store/ui';
import {
  RichTextEditor,
  plainTextToHtml,
  htmlToPlainText,
} from '@/components/RichTextEditor';
import { DateConfirmModal } from '@/components/DateConfirmModal';
import { AIDisclaimerModal } from '@/components/AIDisclaimerModal';
import { DocTemplatesModal } from '@/components/DocTemplatesModal';
import { MyDraftsModal } from '@/components/MyDraftsModal';
import { exportPdf, exportDocx } from '@/lib/export-doc';
import type { DocTemplate } from '@/lib/doc-templates';
import { useSaveDraft } from '@/hooks/useDrafts';
import type { SavedDraft } from '@lexdraft/types';
import {
  DOC_SCHEMAS,
  DOC_TYPE_GROUPS,
  getSchema,
  type DocField,
  type DocSchema,
} from '@/lib/doc-schemas';

const DEFAULT_DOC = 'Notice u/s 138 NI Act';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface CaseContext {
  id: string;
  title: string;
  cnr?: string;
  court?: string;
  client?: string;
  type?: string;
  stage?: string;
}

interface ResearchCitation {
  query: string;
  answer: string;
  citationText: string;
}

type Language = DraftRequest['language'];
type Tone = DraftRequest['tone'];

const LANGUAGES: ReadonlyArray<readonly [Language, string]> = [
  ['EN', 'English'],
  ['HI', 'हिंदी'],
  ['TA', 'தமிழ்'],
];

const TONES: ReadonlyArray<Tone> = ['Professional', 'Firm', 'Urgent', 'Conciliatory'];

type ValuesByDoc = Record<string, Record<string, string>>;

function seedDefaults(): ValuesByDoc {
  const seed: ValuesByDoc = {};
  for (const [type, sc] of Object.entries(DOC_SCHEMAS)) {
    const values: Record<string, string> = {};
    sc.sections.forEach((sec) =>
      sec.fields.forEach((f) => {
        if (f.default !== undefined) values[f.key] = f.default;
      }),
    );
    seed[type] = values;
  }
  return seed;
}

export function DraftingView() {
  const [docType, setDocType] = useState<string>(DEFAULT_DOC);
  const [lang, setLang] = useState<Language>('EN');
  const [tone, setTone] = useState<Tone>('Professional');
  const [allValues, setAllValues] = useState<ValuesByDoc>(() => seedDefaults());
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [showMobileForm, setShowMobileForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedHtml, setEditedHtml] = useState<string | null>(null);
  const [draftDate, setDraftDate] = useState<string>(todayIso());
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'PDF' | 'DOCX' | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [myDraftsOpen, setMyDraftsOpen] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const saveMutation = useSaveDraft();
  // Set true just before stream.seed() to suppress the effect that clears
  // edits when stream.data.text changes — loading a draft must preserve them.
  const skipResetOnSeedRef = useRef(false);

  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as
    | { caseContext?: CaseContext; researchCitation?: ResearchCitation }
    | null;
  const [caseContext, setCaseContext] = useState<CaseContext | null>(navState?.caseContext ?? null);
  const [researchCitation, setResearchCitation] = useState<ResearchCitation | null>(
    navState?.researchCitation ?? null,
  );

  const stream = useStreamDraft();
  const showToast = useUIStore((s) => s.showToast);
  const schema: DocSchema = useMemo(() => getSchema(docType), [docType]);
  const values = allValues[docType] ?? {};

  // Open the first section by default whenever the schema changes.
  useEffect(() => {
    setOpenSections((prev) => {
      const next = { ...prev };
      schema.sections.forEach((s, i) => {
        const key = `${docType}::${s.title}`;
        if (!(key in next)) next[key] = i === 0;
      });
      return next;
    });
  }, [docType, schema]);

  const setField = (key: string, val: string) => {
    setAllValues((av) => ({ ...av, [docType]: { ...(av[docType] ?? {}), [key]: val } }));
  };

  const toggleSection = (title: string) => {
    const key = `${docType}::${title}`;
    setOpenSections((s) => ({ ...s, [key]: !s[key] }));
  };

  const fieldsValid = (): boolean => {
    for (const sec of schema.sections) {
      for (const f of sec.fields) {
        if (f.required && !(values[f.key] ?? '').toString().trim()) return false;
      }
    }
    return true;
  };

  const completion: number = (() => {
    let total = 0;
    let filled = 0;
    schema.sections.forEach((sec) =>
      sec.fields.forEach((f) => {
        total += 1;
        if ((values[f.key] ?? '').toString().trim()) filled += 1;
      }),
    );
    return total ? Math.round((filled / total) * 100) : 0;
  })();

  // Step 1: validate the brief and open the date-confirm modal.
  const generate = () => {
    if (!fieldsValid()) {
      setError('Please complete all required fields (marked with *).');
      const next: Record<string, boolean> = {};
      schema.sections.forEach((s) => {
        next[`${docType}::${s.title}`] = true;
      });
      setOpenSections((prev) => ({ ...prev, ...next }));
      return;
    }
    setError(null);
    setDraftDate(todayIso());
    setDateModalOpen(true);
  };

  // Step 2: user confirmed the date — kick off the stream.
  const runGeneration = (date: string) => {
    setDraftDate(date);
    setDateModalOpen(false);
    setEditedHtml(null);
    setIsEditing(false);
    const fields: Record<string, string> = {};
    schema.sections.forEach((sec) =>
      sec.fields.forEach((f) => {
        const v = values[f.key];
        if (v !== undefined && v.toString().trim()) fields[f.key] = v;
      }),
    );
    void stream.generate({ docType, language: lang, tone, fields, draftDate: date });
  };

  const reset = () => {
    setAllValues((av) => ({ ...av, [docType]: {} }));
    stream.reset();
    setError(null);
    setCurrentDraftId(null);
    setEditedHtml(null);
    setIsEditing(false);
  };

  const output = stream.text;
  const streaming = stream.isStreaming;
  const hasOutput = Boolean(output) || streaming;
  const displayHtml = editedHtml ?? plainTextToHtml(output);

  // Surface stream-level errors to the UI.
  useEffect(() => {
    if (stream.error) setError(stream.error);
  }, [stream.error]);

  // Drop pending edits whenever a new generation finishes — but skip when the
  // change was caused by loading a saved draft (we want those edits preserved).
  useEffect(() => {
    if (!stream.data?.text) return;
    if (skipResetOnSeedRef.current) {
      skipResetOnSeedRef.current = false;
      return;
    }
    setEditedHtml(null);
    setIsEditing(false);
  }, [stream.data?.text]);

  // When a case context is supplied (from Prepare brief), opportunistically
  // pre-fill any field whose key matches a case attribute. This is best-effort:
  // schemas vary, so we try a small fuzzy map and silently skip misses.
  useEffect(() => {
    if (!caseContext) return;
    const map: Array<[RegExp, string | undefined]> = [
      [/(^|_)court(_|$)|jurisdiction/i, caseContext.court],
      [/(^|_)cnr($|_)|case_no|matter_no/i, caseContext.cnr],
      [/client|petitioner_name|plaintiff_name|complainant_name|sender_name/i, caseContext.client],
      [/case_title|matter_title/i, caseContext.title],
    ];
    setAllValues((av) => {
      const cur = { ...(av[docType] ?? {}) };
      let changed = false;
      for (const sec of schema.sections) {
        for (const f of sec.fields) {
          const existing = cur[f.key];
          if (existing && existing.trim()) continue;
          for (const [rx, val] of map) {
            if (val && rx.test(f.key)) {
              cur[f.key] = val;
              changed = true;
              break;
            }
          }
        }
      }
      if (!changed) return av;
      return { ...av, [docType]: cur };
    });
  }, [caseContext, docType, schema]);

  const triggerExport = (fmt: 'PDF' | 'DOCX') => {
    if (!hasOutput || streaming) return;
    setExportFormat(fmt);
  };

  const applyTemplate = (t: DocTemplate) => {
    setDocType(t.docType);
    setAllValues((av) => ({ ...av, [t.docType]: { ...t.fields } }));
    setTemplatesOpen(false);
    showToast({ type: 'sage', text: `Loaded template: ${t.label}` });
  };

  const handleSave = () => {
    if (!output) {
      showToast({ type: 'amber', text: 'Generate a draft first' });
      return;
    }
    if (streaming) {
      showToast({ type: 'amber', text: 'Wait until streaming finishes' });
      return;
    }
    const fields: Record<string, string> = {};
    schema.sections.forEach((sec) =>
      sec.fields.forEach((f) => {
        const v = values[f.key];
        if (v !== undefined && v.toString().trim()) fields[f.key] = v;
      }),
    );
    const editedHtmlValue = editedHtml ?? plainTextToHtml(output);
    const bodyText = editedHtml ? htmlToPlainText(editedHtml) : output;
    saveMutation.mutate(
      {
        id: currentDraftId,
        body: {
          docType,
          language: lang,
          tone,
          fields,
          editedHtml: editedHtmlValue,
          bodyText,
          draftDate,
        },
      },
      {
        onSuccess: (saved) => {
          setCurrentDraftId(saved.id);
          showToast({ type: 'sage', text: currentDraftId ? 'Draft updated' : 'Draft saved' });
        },
        onError: (e) => {
          const msg = e instanceof Error ? e.message : 'Could not save draft';
          showToast({ type: 'cobalt', text: msg });
        },
      },
    );
  };

  const handleLoadDraft = (d: SavedDraft) => {
    setDocType(d.docType);
    setLang(d.language);
    setTone((d.tone as Tone) ?? 'Professional');
    setAllValues((av) => ({ ...av, [d.docType]: { ...d.fields } }));
    setDraftDate(d.draftDate ?? todayIso());
    setEditedHtml(d.editedHtml || null);
    setIsEditing(false);
    setCurrentDraftId(d.id);
    setMyDraftsOpen(false);
    // Seed the stream display with the saved body so the preview renders
    // immediately without needing a re-generation.
    stream.reset();
    skipResetOnSeedRef.current = true;
    stream.seed({
      docType: d.docType,
      text: d.bodyText,
      generatedAt: d.updatedAt,
    });
    showToast({ type: 'sage', text: `Loaded: ${d.title}` });
  };

  const resetCurrentBrief = () => {
    const sc = DOC_SCHEMAS[docType];
    if (!sc) return;
    const defaults: Record<string, string> = {};
    sc.sections.forEach((s) =>
      s.fields.forEach((f) => {
        if (f.default !== undefined) defaults[f.key] = f.default;
      }),
    );
    setAllValues((av) => ({ ...av, [docType]: defaults }));
    setTemplatesOpen(false);
    showToast({ type: 'sage', text: 'Brief reset to default values' });
  };

  const performExport = () => {
    const fmt = exportFormat;
    if (!fmt) return;
    const payload = {
      title: docType,
      bodyHtml: displayHtml,
      dated: draftDate,
    };
    try {
      if (fmt === 'PDF') exportPdf(payload);
      else exportDocx(payload);
      showToast({ type: 'sage', text: `${fmt} prepared` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : `${fmt} export failed`;
      showToast({ type: 'cobalt', text: msg });
    } finally {
      setExportFormat(null);
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="heading-xl" style={{ marginBottom: 4 }}>
            Draft
          </h1>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {docType.toUpperCase()} · {schema.category.toUpperCase()}
          </div>
        </div>
        <span className="spacer" />
        <button
          className="btn"
          type="button"
          onClick={() => setTemplatesOpen(true)}
        >
          Templates
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => setMyDraftsOpen(true)}
        >
          My drafts
        </button>
      </div>

      {researchCitation && (
        <div
          className="card"
          style={{
            padding: '12px 16px',
            borderLeft: '3px solid var(--info)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Icon name="research" size={16} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
              RESEARCH CONTEXT
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>
              {researchCitation.query}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {researchCitation.citationText || 'No citations attached.'}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              if (!researchCitation.citationText) {
                showToast({ type: 'amber', text: 'No citations to append' });
                return;
              }
              const targetSec = schema.sections.find((s) => s.fields.some((f) => f.type === 'textarea'));
              const targetField = targetSec?.fields.find((f) => f.type === 'textarea');
              if (!targetField) {
                void navigator.clipboard?.writeText(researchCitation.citationText);
                showToast({ type: 'sage', text: 'Citations copied to clipboard' });
                return;
              }
              const existing = (allValues[docType]?.[targetField.key] ?? '').trim();
              const cite = `Authority: ${researchCitation.citationText}`;
              const next = existing ? `${existing}\n\n${cite}` : cite;
              setAllValues((av) => ({
                ...av,
                [docType]: { ...(av[docType] ?? {}), [targetField.key]: next },
              }));
              showToast({ type: 'sage', text: `Added to "${targetField.label}"` });
            }}
          >
            Append to brief
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setResearchCitation(null)}
            title="Dismiss research context"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {caseContext && (
        <div
          className="card"
          style={{
            padding: '12px 16px',
            borderLeft: '3px solid var(--info)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Icon name="cases" size={16} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
              DRAFTING FOR MATTER
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
              {caseContext.title}
              {caseContext.court ? ` · ${caseContext.court}` : ''}
              {caseContext.cnr ? ` · ${caseContext.cnr}` : ''}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => navigate(`/app/cases/${caseContext.id}`)}
          >
            Open case
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setCaseContext(null)}
            title="Clear case context"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      <DocTypePicker docType={docType} onPick={setDocType} />

      {schema.description && (
        <div
          className="card"
          style={{
            padding: '12px 18px',
            background: 'var(--bg-surface-2)',
            borderLeft: '3px solid var(--border-strong)',
          }}
        >
          <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <Icon name="flag" size={14} />
            <p
              style={{
                fontSize: 13,
                lineHeight: 1.55,
                color: 'var(--text-primary)',
                margin: 0,
                flex: 1,
              }}
            >
              {schema.description}
            </p>
            <span
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--text-tertiary)',
                letterSpacing: '0.16em',
                whiteSpace: 'nowrap',
              }}
            >
              {completion}% COMPLETE
            </span>
          </div>
        </div>
      )}

      <div
        className="draft-grid"
        style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 42fr) minmax(0, 58fr)', gap: 16 }}
      >
        {/* Form column */}
        <div
          className={`card draft-form${showMobileForm ? ' show' : ''}`}
          style={{
            padding: 0,
            alignSelf: 'flex-start',
            position: 'sticky',
            top: 72,
            maxHeight: 'calc(100vh - 96px)',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              padding: '16px 18px',
              borderBottom: '1px solid var(--border-default)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span
              className="mono"
              style={{
                fontSize: 11,
                letterSpacing: '0.18em',
                color: 'var(--text-tertiary)',
                flex: 1,
              }}
            >
              BRIEF
            </span>
            <CompletionBar percent={completion} />
            <button className="btn btn-ghost btn-sm" onClick={reset} title="Clear all fields">
              Clear
            </button>
          </div>
          {schema.sections.map((sec) => {
            const open = !!openSections[`${docType}::${sec.title}`];
            const sectionFilled = sec.fields.filter((f) =>
              (values[f.key] ?? '').toString().trim(),
            ).length;
            const sectionTotal = sec.fields.length;
            return (
              <Section
                key={sec.title}
                title={sec.title}
                open={open}
                onToggle={() => toggleSection(sec.title)}
                meta={`${sectionFilled}/${sectionTotal}`}
              >
                <div className="col" style={{ gap: 14 }}>
                  {sec.fields.map((f) => (
                    <Field
                      key={f.key}
                      field={f}
                      value={values[f.key] ?? ''}
                      onChange={(v) => setField(f.key, v)}
                    />
                  ))}
                </div>
              </Section>
            );
          })}

          <Section
            title="Options"
            open={!!openSections[`${docType}::Options`]}
            onToggle={() => toggleSection('Options')}
            meta=""
          >
            <div className="col" style={{ gap: 14 }}>
              <div>
                <label className="label">Language</label>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {LANGUAGES.map(([l, lbl]) => (
                    <button
                      key={l}
                      className={`chip${lang === l ? ' active' : ''}`}
                      onClick={() => setLang(l)}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="label">Tone</label>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {TONES.map((t) => (
                    <button
                      key={t}
                      className={`chip${tone === t ? ' active' : ''}`}
                      onClick={() => setTone(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <div
            style={{
              padding: 16,
              borderTop: '1px solid var(--border-default)',
              background: 'var(--bg-surface-2)',
              position: 'sticky',
              bottom: 0,
            }}
          >
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={generate}
              disabled={streaming}
            >
              {streaming ? (
                <>
                  Generating
                  <span className="blink" />
                </>
              ) : (
                <>Generate {docType}</>
              )}
            </button>
            {error && (
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: 'var(--danger)',
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Preview column */}
        <div className="col" style={{ gap: 12 }}>
          <button
            className="btn btn-block draft-mobile-edit"
            onClick={() => setShowMobileForm((s) => !s)}
            style={{ display: 'none' }}
          >
            <Icon name="file" size={14} />{' '}
            {showMobileForm ? 'Close brief' : `Edit brief · ${completion}%`}
          </button>
          <div
            className="card"
            style={{
              padding: '40px 48px',
              minHeight: 600,
              fontFamily: 'var(--font-sans)',
              fontSize: 15,
              lineHeight: 1.7,
              position: 'relative',
            }}
          >
            {!output && !streaming && (
              <EmptyState docType={docType} completion={completion} onGenerate={generate} />
            )}
            {hasOutput && !isEditing && (
              <div
                className="rt-content"
                dangerouslySetInnerHTML={{ __html: displayHtml }}
              />
            )}
            {hasOutput && !isEditing && streaming && <span className="blink" />}
            {hasOutput && isEditing && !streaming && (
              <RichTextEditor
                value={displayHtml}
                onChange={setEditedHtml}
                autoFocus
              />
            )}
          </div>

          {hasOutput && !streaming && (
            <div
              className="card"
              style={{
                padding: 12,
                position: 'sticky',
                bottom: 12,
                background: 'var(--bg-surface)',
                boxShadow: 'var(--shadow-popover)',
              }}
            >
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button
                  className={`btn${isEditing ? ' btn-primary' : ''}`}
                  type="button"
                  onClick={() => {
                    if (!isEditing && editedHtml === null) setEditedHtml(plainTextToHtml(output));
                    setIsEditing((v) => !v);
                  }}
                >
                  <Icon name={isEditing ? 'check' : 'file'} size={14} />{' '}
                  {isEditing ? 'Done editing' : 'Edit'}
                </button>
                {!isEditing && editedHtml !== null && (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setEditedHtml(null)}
                    title="Discard manual edits and restore the generated draft"
                  >
                    <Icon name="close" size={14} /> Revert
                  </button>
                )}
                <button
                  className="btn"
                  type="button"
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                >
                  <Icon name="check" size={14} />{' '}
                  {saveMutation.isPending
                    ? 'Saving…'
                    : currentDraftId
                      ? 'Update'
                      : 'Save'}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => triggerExport('PDF')}
                >
                  <Icon name="download" size={14} /> PDF
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => triggerExport('DOCX')}
                >
                  <Icon name="download" size={14} /> DOCX
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(htmlToPlainText(displayHtml));
                    showToast({ type: 'sage', text: 'Draft copied to clipboard' });
                  }}
                >
                  <Icon name="file" size={14} /> Copy
                </button>
                <span className="spacer" />
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => showToast({ type: 'sage', text: 'Shared with client' })}
                >
                  <Icon name="arrow" size={14} /> Share with client
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 1023px) {
          .draft-grid { grid-template-columns: 1fr !important; }
          .draft-form { position: static !important; max-height: none !important; }
          .draft-mobile-edit { display: inline-flex !important; }
          .draft-form { display: none; }
          .draft-form.show { display: block; }
        }
      `}</style>

      <DateConfirmModal
        open={dateModalOpen}
        initial={draftDate}
        onCancel={() => setDateModalOpen(false)}
        onConfirm={runGeneration}
      />

      <AIDisclaimerModal
        open={exportFormat !== null}
        format={exportFormat}
        onCancel={() => setExportFormat(null)}
        onConfirm={performExport}
      />

      <DocTemplatesModal
        open={templatesOpen}
        currentDocType={docType}
        onCancel={() => setTemplatesOpen(false)}
        onApply={applyTemplate}
        onResetCurrent={resetCurrentBrief}
      />

      <MyDraftsModal
        open={myDraftsOpen}
        onCancel={() => setMyDraftsOpen(false)}
        onLoad={handleLoadDraft}
        currentDraftId={currentDraftId}
      />
    </div>
  );
}

interface DocTypePickerProps {
  docType: string;
  onPick: (t: string) => void;
}

function DocTypePicker({ docType, onPick }: DocTypePickerProps) {
  const groupForDocType = useMemo(
    () => DOC_TYPE_GROUPS.find((g) => g.items.includes(docType))?.group ?? DOC_TYPE_GROUPS[0]!.group,
    [docType],
  );
  const [activeTab, setActiveTab] = useState<string>(groupForDocType);

  // Jump the tab when the docType changes to one in another group.
  useEffect(() => {
    setActiveTab(groupForDocType);
  }, [groupForDocType]);

  const active = DOC_TYPE_GROUPS.find((g) => g.group === activeTab) ?? DOC_TYPE_GROUPS[0]!;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          overflowX: 'auto',
          borderBottom: '1px solid var(--border-default)',
          padding: '6px 8px',
          gap: 4,
        }}
      >
        {DOC_TYPE_GROUPS.map((g) => {
          const isActive = activeTab === g.group;
          return (
            <button
              key={g.group}
              type="button"
              className="mono"
              onClick={() => setActiveTab(g.group)}
              style={{
                fontSize: 10,
                letterSpacing: '0.18em',
                padding: '8px 12px',
                background: isActive ? 'var(--bg-elevated)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border: 0,
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontWeight: isActive ? 600 : 400,
                transition: 'background 120ms, color 120ms',
              }}
            >
              {g.group.toUpperCase()}
            </button>
          );
        })}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', padding: 14, alignItems: 'flex-start' }}>
        {active.items.map((t) => (
          <button
            key={t}
            className={`chip${docType === t ? ' active' : ''}`}
            onClick={() => onPick(t)}
            style={{ fontSize: 12 }}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function CompletionBar({ percent }: { percent: number }) {
  return (
    <div
      title={`${percent}% complete`}
      style={{
        width: 80,
        height: 4,
        background: 'var(--border-subtle)',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          width: `${percent}%`,
          height: '100%',
          background: percent === 100 ? 'var(--success)' : 'var(--text-primary)',
          transition: 'width 0.3s',
        }}
      />
    </div>
  );
}

interface SectionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  meta: string;
}

function Section({ title, open, onToggle, children, meta }: SectionProps) {
  return (
    <div style={{ borderBottom: '1px solid var(--border-default)' }}>
      <button
        onClick={onToggle}
        className="row"
        style={{
          width: '100%',
          padding: '14px 18px',
          fontSize: 12,
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: 'var(--text-secondary)',
          minHeight: 44,
          background: 'transparent',
          border: 0,
        }}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>{title}</span>
        {meta && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: 'var(--text-tertiary)',
              opacity: 0.85,
              marginRight: 8,
            }}
          >
            {meta}
          </span>
        )}
        <Icon name={open ? 'chevronD' : 'chevron'} size={14} />
      </button>
      {open && <div style={{ padding: '0 18px 18px' }}>{children}</div>}
    </div>
  );
}

interface FieldProps {
  field: DocField;
  value: string;
  onChange: (v: string) => void;
}

function Field({ field, value, onChange }: FieldProps) {
  const { label, type, placeholder, options, required, optional, rows } = field;
  const labelEl = (
    <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span>{label}</span>
      {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      {optional && (
        <span
          className="mono"
          style={{
            fontSize: 9,
            color: 'var(--text-tertiary)',
            opacity: 0.85,
            fontWeight: 400,
          }}
        >
          OPTIONAL
        </span>
      )}
    </label>
  );

  if (type === 'textarea') {
    return (
      <div>
        {labelEl}
        <textarea
          className="input"
          rows={rows ?? 3}
          value={value}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
    );
  }
  if (type === 'select') {
    return (
      <div>
        {labelEl}
        <Select
          value={value}
          onChange={onChange}
          placeholder="— Select —"
          options={[
            { value: '', label: '— Select —' },
            ...(options ?? []).map((o) => ({ value: o, label: o })),
          ]}
        />
      </div>
    );
  }
  if (type === 'date') {
    return (
      <div>
        {labelEl}
        <DatePicker value={value} onChange={onChange} />
      </div>
    );
  }
  if (type === 'number') {
    return (
      <div>
        {labelEl}
        <input
          type="number"
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>
    );
  }
  if (type === 'currency') {
    return (
      <div>
        {labelEl}
        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 13,
              pointerEvents: 'none',
            }}
          >
            ₹
          </span>
          <input
            type="text"
            inputMode="numeric"
            className="input"
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={placeholder}
            style={{ paddingLeft: 28 }}
          />
        </div>
      </div>
    );
  }
  return (
    <div>
      {labelEl}
      <input
        type="text"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

interface EmptyStateProps {
  docType: string;
  completion: number;
  onGenerate: () => void;
}

function EmptyState({ docType, completion, onGenerate }: EmptyStateProps) {
  const message =
    completion === 0
      ? 'Fill in the brief on the left. Each field maps to a specific element of the document — the more precise you are, the more grounded the draft.'
      : completion < 100
        ? `Brief is ${completion}% complete. You can generate now, or fill more fields for a tighter draft.`
        : 'Brief is complete. Click Generate to compose the document.';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 500,
        color: 'var(--text-secondary)',
        textAlign: 'center',
        padding: 32,
      }}
    >
      <svg
        width="72"
        height="72"
        viewBox="0 0 72 72"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        style={{ marginBottom: 22, opacity: 0.4 }}
      >
        <rect x="14" y="6" width="44" height="60" />
        <path d="M22 18h28M22 26h28M22 34h22M22 42h26M22 50h18M22 58h14" />
        <circle cx="56" cy="58" r="8" stroke="var(--border-strong)" strokeWidth="1.5" />
      </svg>
      <div className="heading-lg" style={{ color: 'var(--text-primary)', marginBottom: 8 }}>
        {docType}
      </div>
      <p
        className="body-md muted"
        style={{ maxWidth: 380, marginBottom: 20 }}
      >
        {message}
      </p>
      <button className="btn btn-primary" onClick={onGenerate}>
        Generate {docType} <Icon name="arrow" size={14} />
      </button>
    </div>
  );
}
