import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { DatePicker, Icon, Select } from '@lexdraft/ui';
import type { DraftRequest } from '@lexdraft/types';
import { useStreamDraft, type LlmProvider } from '@/hooks/useDrafting';
import { useCaseNotes } from '@/hooks/useCaseNotes';
import { useUIStore } from '@/store/ui';
import { api } from '@/lib/api';
import { PillNav } from '@/components/PillNav';
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
import { resolveLetterhead } from '@/lib/letterhead-resolve';
import type { DocTemplate } from '@/lib/doc-templates';
import { useDraft, useSaveDraft } from '@/hooks/useDrafts';
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

const LANG_HTML: Record<Language, string> = {
  EN: 'en',
  HI: 'hi',
  TA: 'ta',
};

const TONES: ReadonlyArray<Tone> = ['Professional', 'Firm', 'Urgent', 'Conciliatory'];

const PROVIDERS: ReadonlyArray<readonly [LlmProvider, string]> = [
  ['xai', 'Grok (xAI)'],
  ['anthropic', 'Claude (Anthropic)'],
];

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
  const [outputLang, setOutputLang] = useState<Language>('EN');
  const [tone, setTone] = useState<Tone>('Professional');
  const [provider, setProvider] = useState<LlmProvider>('xai');
  const [outputProvider, setOutputProvider] = useState<LlmProvider>('xai');
  const [allValues, setAllValues] = useState<ValuesByDoc>(() => seedDefaults());
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [showMobileForm, setShowMobileForm] = useState(false);
  const [stageMode, setStageMode] = useState(false);
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
  // edits when stream.data.text changes - loading a draft must preserve them.
  const skipResetOnSeedRef = useRef(false);

  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as
    | { caseContext?: CaseContext; researchCitation?: ResearchCitation; draftId?: string }
    | null;
  const [caseContext, setCaseContext] = useState<CaseContext | null>(navState?.caseContext ?? null);
  const [researchCitation, setResearchCitation] = useState<ResearchCitation | null>(
    navState?.researchCitation ?? null,
  );
  // Drafting from a case opens an optional context channel: any case notes
  // the user can see are folded into the LLM user message. Default ON; the
  // banner gives the user a one-click way to skip them per-generation.
  const [includeNotes, setIncludeNotes] = useState<boolean>(true);
  const { data: caseNotesList } = useCaseNotes(caseContext?.id ?? null);
  const usableNotesCount = useMemo(
    () => (caseNotesList ?? []).filter((n) => n.body.trim().length > 0).length,
    [caseNotesList],
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

  // Step 2: user confirmed the date - kick off the stream.
  const runGeneration = (date: string) => {
    setDraftDate(date);
    setDateModalOpen(false);
    setEditedHtml(null);
    setIsEditing(false);
    setOutputLang(lang);
    setOutputProvider(provider);
    setStageMode(true);
    setShowMobileForm(false);
    const fields: Record<string, string> = {};
    schema.sections.forEach((sec) =>
      sec.fields.forEach((f) => {
        const v = values[f.key];
        if (v !== undefined && v.toString().trim()) fields[f.key] = v;
      }),
    );
    void stream.generate({
      docType,
      language: lang,
      tone,
      fields,
      draftDate: date,
      provider,
      ...(caseContext?.id ? { caseId: caseContext.id, includeNotes } : {}),
    });
  };

  const reset = () => {
    setAllValues((av) => ({ ...av, [docType]: {} }));
    stream.reset();
    setError(null);
    setCurrentDraftId(null);
    setEditedHtml(null);
    setIsEditing(false);
    setStageMode(false);
  };

  const output = stream.text;
  const streaming = stream.isStreaming;
  const hasOutput = Boolean(output) || streaming;
  const displayHtml = editedHtml ?? plainTextToHtml(output);
  const outputLangCode = LANG_HTML[outputLang];

  // Sanhita stale-IPC scan: when generation finishes (or a draft is loaded),
  // POST the body to /api/sanhita/scan and surface chips for any matches that
  // map to a BNS / BNSS / BSA replacement. The scan is fire-and-forget - if
  // it fails we silently swallow rather than blocking the drafting flow.
  const scanMutation = useMutation({
    mutationFn: (text: string) =>
      api.post<{
        found: Array<{ match: string; index: number; length: number; fromAct: string; fromSection: string }>;
        suggestions: Array<{
          match: string;
          index: number;
          length: number;
          fromAct: string;
          fromSection: string;
          mapping: {
            fromAct: string; fromSection: string; fromTitle: string;
            toAct: string; toSection: string; toTitle: string;
            substantiveChange: string; notes: string;
          } | null;
        }>;
      }>('/sanhita/scan', { text }),
  });

  // Re-scan whenever the rendered output settles: stream.data.text is the
  // committed body, isStreaming flips to false at the end. We use displayHtml
  // when the user has manually edited so they see warnings for their edits
  // too - but we strip tags first because the scanner expects plain text.
  const scanInputText = useMemo(() => {
    if (streaming) return '';
    if (editedHtml) return htmlToPlainText(editedHtml);
    return output ?? '';
  }, [streaming, editedHtml, output]);

  useEffect(() => {
    if (!scanInputText.trim()) {
      scanMutation.reset();
      return;
    }
    scanMutation.mutate(scanInputText);
    // We intentionally exclude scanMutation from deps - including it would
    // loop because mutate() updates the mutation's identity references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanInputText]);

  // De-duplicate suggestions by the (fromAct, fromSection) pair so the user
  // sees one chip per stale reference even if it appears many times in the
  // draft. Only surface chips that have a known replacement.
  const staleChips = useMemo(() => {
    const data = scanMutation.data;
    if (!data) return [];
    const seen = new Set<string>();
    const out: Array<{
      key: string;
      fromAct: string;
      fromSection: string;
      toAct: string;
      toSection: string;
      substantiveChange: string;
      count: number;
    }> = [];
    for (const s of data.suggestions) {
      if (!s.mapping) continue;
      const key = `${s.fromAct}-${s.fromSection}`;
      const existing = out.find((o) => o.key === key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        fromAct: s.fromAct,
        fromSection: s.fromSection,
        toAct: s.mapping.toAct,
        toSection: s.mapping.toSection,
        substantiveChange: s.mapping.substantiveChange,
        count: 1,
      });
    }
    return out;
  }, [scanMutation.data]);

  // Apply a replacement: switch every "<fromAct> §<fromSection>" occurrence
  // in the current draft body to "<toAct> §<toSection>". We operate on the
  // plain-text output and re-render via setEditedHtml so the user can keep
  // editing afterwards. The replacement is intentionally string-based, not
  // regex-on-the-server, so the user can see exactly what's about to change.
  const applySanhitaReplacement = (chip: { fromAct: string; fromSection: string; toAct: string; toSection: string }) => {
    const sourceText = editedHtml ? htmlToPlainText(editedHtml) : output ?? '';
    if (!sourceText) return;
    // Be permissive about the match: "Sec. 302 IPC", "Section 302 IPC", "u/s 302 IPC", "302 IPC", "IPC 302".
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sec = escape(chip.fromSection);
    const actAlias =
      chip.fromAct === 'IPC' ? '(?:IPC|I\\.P\\.C\\.|Indian Penal Code|Penal Code(?:,?\\s*1860)?)'
      : chip.fromAct === 'CrPC' ? '(?:Cr\\.?P\\.?C\\.?|CrPC|Code of Criminal Procedure(?:,?\\s*1973)?)'
      : '(?:IEA|Indian Evidence Act(?:,?\\s*1872)?|Evidence Act(?:,?\\s*1872)?)';
    // Order A: "Sec. 302 IPC" / "Section 302 of the IPC"
    const orderA = new RegExp(
      `(?:(?:u\\/s|under\\s+section|sec(?:tion)?\\.?|s\\.?|§)\\s*)?${sec}\\s*(?:of\\s+(?:the\\s+)?)?${actAlias}`,
      'gi',
    );
    // Order B: "IPC Sec. 302" / "IPC §302"
    const orderB = new RegExp(`${actAlias}[\\s,]*(?:sec(?:tion)?\\.?|s\\.?|§)?\\s*${sec}`, 'gi');
    const replacement = `${chip.toAct} §${chip.toSection}`;
    let next = sourceText.replace(orderA, replacement);
    next = next.replace(orderB, replacement);
    if (next === sourceText) {
      showToast({ type: 'amber', text: `No textual match for §${chip.fromSection} ${chip.fromAct}` });
      return;
    }
    setEditedHtml(plainTextToHtml(next));
    setIsEditing(false);
    showToast({ type: 'sage', text: `Replaced ${chip.fromAct} §${chip.fromSection} → ${chip.toAct} §${chip.toSection}` });
  };

  // If the output disappears (manual reset, draft cleared), drop the stage so
  // the brief returns to side-by-side mode.
  useEffect(() => {
    if (!hasOutput) setStageMode(false);
  }, [hasOutput]);

  // Surface stream-level errors to the UI.
  useEffect(() => {
    if (stream.error) setError(stream.error);
  }, [stream.error]);

  // Drop pending edits whenever a new generation finishes - but skip when the
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

  // Auto-load a draft when the view is opened via /app/draft with
  // `state.draftId` (e.g. the "Edit" button in the Documents registry).
  // The ref guards against re-running on every re-render — we want to
  // seed exactly once per navigation.
  const autoLoadedDraftIdRef = useRef<string | null>(null);
  const incomingDraftId =
    navState?.draftId && navState.draftId !== autoLoadedDraftIdRef.current
      ? navState.draftId
      : null;
  const incomingDraft = useDraft(incomingDraftId);

  const handleLoadDraft = (d: SavedDraft) => {
    setDocType(d.docType);
    setLang(d.language);
    setOutputLang(d.language);
    setTone((d.tone as Tone) ?? 'Professional');
    setAllValues((av) => ({ ...av, [d.docType]: { ...d.fields } }));
    setDraftDate(d.draftDate ?? todayIso());
    setEditedHtml(d.editedHtml || null);
    setIsEditing(false);
    setCurrentDraftId(d.id);
    setMyDraftsOpen(false);
    setStageMode(true);
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

  useEffect(() => {
    if (!incomingDraftId || !incomingDraft.data) return;
    autoLoadedDraftIdRef.current = incomingDraftId;
    handleLoadDraft(incomingDraft.data);
    // Clear the navigation state so a manual refresh of /app/draft doesn't
    // reload the same draft.
    navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingDraftId, incomingDraft.data]);

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

  const performExport = async (letterheadChoice: string | null | undefined) => {
    const fmt = exportFormat;
    if (!fmt) return;
    // Resolve the picker's choice into something exportPdf can consume:
    //   undefined → leave undefined, exportPdf auto-fetches effective default
    //   null      → explicit "no letterhead"
    //   string    → fetch that specific letterhead + its logo
    const letterhead =
      letterheadChoice === undefined ? undefined
      : letterheadChoice === null   ? null
      : await resolveLetterhead(letterheadChoice);
    const payload = {
      title: docType,
      bodyHtml: displayHtml,
      dated: draftDate,
      letterhead,
    };
    try {
      if (fmt === 'PDF') await exportPdf(payload);
      else await exportDocx(payload);
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
          <div
            key={docType}
            className="mono draft-doctype-label"
            style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
          >
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
        <button
          className="btn"
          type="button"
          onClick={reset}
          disabled={streaming}
          title="Clear the brief fields and the generated draft"
        >
          <Icon name="close" size={14} /> Clear
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

      {caseContext && usableNotesCount > 0 && (
        <div
          className="card"
          style={{
            padding: '12px 16px',
            borderLeft: `3px solid ${includeNotes ? 'var(--success, #059669)' : 'var(--border-strong)'}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Icon name="draft" size={16} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
              CASE NOTES
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
              {usableNotesCount} {usableNotesCount === 1 ? 'note' : 'notes'} from this matter.{' '}
              {includeNotes
                ? 'These will be folded into the AI prompt as context.'
                : 'Notes will be ignored for this generation.'}
            </div>
          </div>
          <label
            className="row"
            style={{
              gap: 8,
              alignItems: 'center',
              fontSize: 13,
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={includeNotes}
              onChange={(e) => setIncludeNotes(e.target.checked)}
              aria-label="Include case notes as AI context"
            />
            Include notes
          </label>
        </div>
      )}

      <DocTypePicker docType={docType} onPick={setDocType} />

      {schema.description && (
        <div
          key={docType}
          className="card draft-schema-desc"
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
        className={`draft-grid${stageMode ? ' draft-grid--stage' : ''}`}
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
          aria-hidden={stageMode || undefined}
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
            <button className="btn btn-sm" onClick={reset} title="Clear all fields">
              Clear
            </button>
          </div>
          <div key={docType} className="draft-sections-anim">
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
          </div>

          <Section
            title="Options"
            open={!!openSections[`${docType}::Options`]}
            onToggle={() => toggleSection('Options')}
            meta=""
          >
            <div className="col" style={{ gap: 14 }}>
              <div>
                <label className="label">Language</label>
                <PillNav
                  items={LANGUAGES.map(([l, lbl]) => ({ id: l, label: lbl }))}
                  value={lang}
                  onChange={setLang}
                  ariaLabel="Draft language"
                />
              </div>
              <div>
                <label className="label">Tone</label>
                <PillNav
                  items={TONES.map((t) => ({ id: t, label: t }))}
                  value={tone}
                  onChange={setTone}
                  ariaLabel="Draft tone"
                />
              </div>
              <div>
                <label className="label">Model</label>
                <PillNav
                  items={PROVIDERS.map(([p, lbl]) => ({
                    id: p,
                    label: lbl,
                    title:
                      p === 'xai'
                        ? 'Generate with xAI Grok (set XAI_MODEL in apps/api/.env)'
                        : 'Generate with Anthropic Claude (set ANTHROPIC_MODEL in apps/api/.env)',
                  }))}
                  value={provider}
                  onChange={setProvider}
                  ariaLabel="LLM provider"
                />
                <div
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    color: 'var(--text-tertiary)',
                    marginTop: 8,
                  }}
                >
                  Generate the same brief with each to compare drafts side-by-side via My drafts.
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
        <div className="col draft-preview-wrap" style={{ gap: 12 }}>
          {stageMode && hasOutput && (
            <div className="row draft-stage-bar" style={{ gap: 8, alignItems: 'center' }}>
              <button
                className="btn btn-sm"
                type="button"
                onClick={() => setStageMode(false)}
                title="Return to brief"
              >
                ← Brief
              </button>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  letterSpacing: '0.16em',
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                }}
              >
                {schema.category} · {LANGUAGES.find((l) => l[0] === outputLang)?.[1] ?? outputLang}
                {' · '}
                {PROVIDERS.find((p) => p[0] === outputProvider)?.[1] ?? outputProvider}
              </span>
              {streaming && (
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    color: 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--info)',
                    }}
                  />
                  Generating
                </span>
              )}
            </div>
          )}
          <button
            className="btn btn-block draft-mobile-edit"
            onClick={() => setShowMobileForm((s) => !s)}
            style={{ display: 'none' }}
          >
            <Icon name="file" size={14} />{' '}
            {showMobileForm ? 'Close brief' : `Edit brief · ${completion}%`}
          </button>
          <div
            className="card draft-preview-card"
            style={{
              padding: 0,
              minHeight: 600,
              position: 'relative',
              background: 'var(--bg-surface-2)',
            }}
          >
            {!output && !streaming && (
              <div key={docType} className="draft-empty-anim" style={{ padding: '40px 48px' }}>
                <EmptyState docType={docType} completion={completion} onGenerate={generate} />
              </div>
            )}
            {hasOutput && !isEditing && (
              <div
                className="court-prose court-prose-paper"
                lang={outputLangCode}
                dir="ltr"
                style={{ margin: '24px auto' }}
                dangerouslySetInnerHTML={{ __html: displayHtml }}
              />
            )}
            {hasOutput && !isEditing && streaming && <span className="blink" />}
            {hasOutput && isEditing && !streaming && (
              <RichTextEditor
                value={displayHtml}
                onChange={setEditedHtml}
                autoFocus
                lang={outputLangCode}
              />
            )}
          </div>

          {hasOutput && !streaming && staleChips.length > 0 && (
            <div
              className="card"
              style={{
                padding: '10px 14px',
                background: 'rgba(180, 83, 9, 0.06)',
                borderLeft: '3px solid var(--warning)',
              }}
            >
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  color: 'var(--text-tertiary)',
                  marginBottom: 8,
                }}
              >
                STALE STATUTE REFERENCES · {staleChips.length}
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {staleChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className="chip"
                    onClick={() => applySanhitaReplacement(chip)}
                    title={
                      /unverified/i.test(chip.substantiveChange)
                        ? 'Mapping marked UNVERIFIED - counsel review required'
                        : chip.substantiveChange || 'Renumbered only'
                    }
                    style={{ fontSize: 12 }}
                  >
                    <span className="mono" style={{ marginRight: 6 }}>
                      {chip.fromAct} §{chip.fromSection}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>→</span>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      Replace with {chip.toAct} §{chip.toSection}
                    </span>
                    {chip.count > 1 && (
                      <span
                        className="mono"
                        style={{ marginLeft: 6, color: 'var(--text-tertiary)' }}
                      >
                        ×{chip.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div
                className="body-xs muted"
                style={{ marginTop: 8 }}
              >
                Indian criminal law was renumbered by the Bharatiya Nyaya / Nagarik Suraksha / Sakshya Sanhitas (2023).
                Suggested replacements are plausibility-grade - verify against the bare Act before relying on them.
              </div>
            </div>
          )}

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
                  onClick={() => {
                    const subject = `${docType} - ${draftDate}`;
                    const text = htmlToPlainText(displayHtml);
                    const body = `Dear Sir/Madam,\n\nPlease find below the draft of the ${docType.toLowerCase()} for your review.\n\n---\n\n${text}\n\n---\n\nKindly revert with your comments.\n\nRegards,`;
                    const href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                    window.location.href = href;
                    showToast({ type: 'sage', text: 'Mail client opened with draft attached' });
                  }}
                >
                  <Icon name="arrow" size={14} /> Share with client
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .draft-grid {
          display: grid;
          grid-template-columns: minmax(0, 42fr) minmax(0, 58fr);
          gap: 16px;
          transition:
            grid-template-columns 620ms cubic-bezier(0.32, 0.72, 0, 1),
            gap 420ms cubic-bezier(0.32, 0.72, 0, 1);
        }
        .draft-form {
          transition:
            opacity 320ms ease 220ms,
            transform 520ms cubic-bezier(0.32, 0.72, 0, 1) 100ms,
            visibility 0s linear 0ms;
        }
        .draft-preview-wrap {
          width: 100%;
          max-width: 100%;
          margin: 0 auto;
          transition: max-width 620ms cubic-bezier(0.32, 0.72, 0, 1);
        }
        .draft-preview-card {
          transition:
            box-shadow 480ms ease,
            transform 520ms cubic-bezier(0.32, 0.72, 0, 1);
        }
        .draft-stage-bar {
          opacity: 0;
          transform: translateY(-4px);
          transition:
            opacity 280ms ease 240ms,
            transform 320ms cubic-bezier(0.32, 0.72, 0, 1) 240ms;
        }
        .draft-grid--stage .draft-stage-bar {
          opacity: 1;
          transform: none;
        }

        @media (min-width: 1024px) {
          .draft-grid--stage {
            grid-template-columns: minmax(0, 0fr) minmax(0, 1fr);
            gap: 0;
          }
          .draft-grid--stage .draft-form {
            opacity: 0;
            transform: translateX(-24px) scale(0.98);
            pointer-events: none;
            visibility: hidden;
            transition:
              opacity 260ms ease,
              transform 460ms cubic-bezier(0.32, 0.72, 0, 1),
              visibility 0s linear 620ms;
          }
          .draft-grid--stage .draft-preview-wrap {
            max-width: 1080px;
          }
          .draft-grid--stage .draft-preview-card {
            box-shadow: 0 14px 40px rgba(10, 10, 10, 0.06);
          }
        }

        @media (max-width: 1023px) {
          .draft-grid,
          .draft-grid--stage { grid-template-columns: 1fr !important; gap: 16px !important; }
          .draft-form { position: static !important; max-height: none !important; }
          .draft-mobile-edit { display: inline-flex !important; }
          .draft-form { display: none; }
          .draft-form.show { display: block; }
          .draft-stage-bar { display: none !important; }
        }

        @keyframes draftFadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes draftFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .doc-chip-row {
          animation: draftFadeSlideIn 260ms cubic-bezier(0.32, 0.72, 0, 1);
        }
        .doc-chip {
          transition:
            background 200ms cubic-bezier(0.32, 0.72, 0, 1),
            color 200ms cubic-bezier(0.32, 0.72, 0, 1),
            border-color 200ms cubic-bezier(0.32, 0.72, 0, 1),
            transform 240ms cubic-bezier(0.32, 0.72, 0, 1);
        }
        .doc-chip.active {
          transform: translateY(-1px);
        }
        .draft-doctype-label {
          animation: draftFadeIn 240ms cubic-bezier(0.32, 0.72, 0, 1);
        }
        .draft-schema-desc {
          animation: draftFadeSlideIn 320ms cubic-bezier(0.32, 0.72, 0, 1);
        }
        .draft-sections-anim {
          animation: draftFadeSlideIn 360ms cubic-bezier(0.32, 0.72, 0, 1);
        }
        .draft-empty-anim {
          animation: draftFadeSlideIn 320ms cubic-bezier(0.32, 0.72, 0, 1);
        }

        @media (prefers-reduced-motion: reduce) {
          .draft-grid,
          .draft-form,
          .draft-preview-wrap,
          .draft-preview-card,
          .draft-stage-bar { transition: none !important; }
          .doc-chip-row,
          .doc-chip,
          .draft-doctype-label,
          .draft-schema-desc,
          .draft-sections-anim,
          .draft-empty-anim { animation: none !important; transition: none !important; }
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
      <div
        key={activeTab}
        className="doc-chip-row"
        style={{ padding: 14 }}
      >
        <PillNav
          items={active.items.map((t) => ({ id: t, label: t }))}
          value={docType}
          onChange={onPick}
          ariaLabel={`${active.group} document types`}
          wrap
        />
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
          background: 'var(--text-primary)',
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
          placeholder="- Select -"
          options={[
            { value: '', label: '- Select -' },
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
      ? 'Fill in the brief on the left. Each field maps to a specific element of the document - the more precise you are, the more grounded the draft.'
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
