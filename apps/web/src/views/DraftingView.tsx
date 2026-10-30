import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Icon } from '@lexdraft/ui';
import type { DraftRequest, AutoDraftResponse } from '@lexdraft/types';
import { useStreamDraft, useAutoDraft, type LlmProvider } from '@/hooks/useDrafting';
import { Field } from '@/components/DraftField';
import { DraftPromptPanel } from '@/components/DraftPromptPanel';
import { PageHeader } from '@/components/PageHeader';
import { DraftPipelinePanel } from '@/components/DraftPipelinePanel';
import { DraftChatPanel } from '@/components/DraftChatPanel';
import { DraftCasePicker } from '@/components/DraftCasePicker';
import { type DraftCaseContext } from '@/lib/draft-case-context';
import { DraftMissingFields } from '@/components/DraftMissingFields';
import { DraftBotModal } from '@/components/engine/DraftBotModal';
import type { IntakeState } from '@lexdraft/types';
import { useEngineStatus } from '@/hooks/useEngineDraft';
import { useCaseNotes } from '@/hooks/useCaseNotes';
import { useCaseDocumentText, useCreateDocument } from '@/hooks/useDocuments';
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
import { LiveDetailsPanel, missingDetailCount } from '@/components/engine/LiveDetailsPanel';
import { DraftRevisePanel } from '@/components/DraftRevisePanel';
import { LawSidePanel } from '@/components/LawSidePanel';
import type { BlankForm } from '@/hooks/useFormatLibrary';
import { MyDraftsModal } from '@/components/MyDraftsModal';
import { FormatPickerModal } from '@/components/FormatPickerModal';
import { LetterheadPicker } from '@/components/letterhead/LetterheadPicker';
import { exportPdf, exportDocx } from '@/lib/export-doc';
import { canEmbedPdf } from '@/lib/pdf-embed';
// pdf.js is only needed where the browser can't show the PDF itself.
const PdfPages = lazy(() => import('@/components/PdfPages').then((m) => ({ default: m.PdfPages })));
import { resolveLetterhead } from '@/lib/letterhead-resolve';
import type { DocTemplate } from '@/lib/doc-templates';
import { useDraft, useSaveDraft } from '@/hooks/useDrafts';
import type { SavedDraft } from '@lexdraft/types';
import {
  DOC_SCHEMAS,
  DOC_TYPE_GROUPS,
  getSchema,
  type DocSchema,
} from '@/lib/doc-schemas';
import { resolveDocSchemas } from '@/lib/form-gen/resolve';
import {
  renderDraftBlocks,
  collectOpenItems,
  hasOpenItems,
  emphasizeLegalTerms,
  type OpenItems,
} from '@/lib/draft-blocks';
import { ZoomPane } from '@/components/ZoomPane';

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

/** Engine blocks -> editor HTML that looks like the printed document: one <p> per
 *  line, keeping the paragraph's alignment and bold. The text is the same as the
 *  plain-text view, so edits still map back onto the .docx line for line. */
function blocksToHtml(blocks: ReadonlyArray<{ text: string; align?: string; bold?: boolean }>): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return blocks
    .map((b) => {
      const style = b.align && b.align !== 'left' ? ` style="text-align:${b.align}"` : '';
      const text = esc(b.text);
      return `<p${style}>${b.bold ? `<strong>${text}</strong>` : text}</p>`;
    })
    .join('');
}

/** The smallest line range [start, end] of `before` that, replaced by
 *  `paragraphs`, turns it into `after` — the shared head and tail are trimmed off.
 *  A pure insertion or deletion absorbs one neighbouring line so the range and its
 *  replacement are never empty (the engine splice needs both). null = no change. */
function changedRange(before: string[], after: string[]): { start: number; end: number; paragraphs: string[] } | null {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p += 1;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s += 1;
  let start = p;
  let end = before.length - 1 - s;
  let paragraphs = after.slice(p, after.length - s);
  if (end < start && paragraphs.length === 0) return null;
  if (end < start || paragraphs.length === 0) {
    if (start > 0) {
      start -= 1;
      paragraphs = [before[start]!, ...paragraphs];
      end = Math.max(end, start);
    } else if (end + 1 < before.length) {
      end += 1;
      paragraphs = [...paragraphs, before[end]!];
    } else {
      return null;
    }
  }
  return { start, end, paragraphs };
}

/** The edited document as display paragraphs — one per <p>/<div>/<li>, each
 *  <br> a line — the same blocks the engine render was shown as. */
function editedParagraphs(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  const out: string[] = [];
  const push = (text: string) => {
    for (const line of text.replace(/\u00a0/g, ' ').split('\n')) {
      if (line.trim()) out.push(line.replace(/\s+$/, ''));
    }
  };
  doc.body.childNodes.forEach((node) => push(node.textContent ?? ''));
  return out;
}

export function DraftingView() {
  const [docType, setDocType] = useState<string>(DEFAULT_DOC);
  // Engine-routed path (Phase 2, flagged): available only to allowlisted users
  // and only for mapped document types (s.138 to start).
  const engineStatus = useEngineStatus();
  const [lang, setLang] = useState<Language>('EN');
  const [outputLang, setOutputLang] = useState<Language>('EN');
  const [tone, setTone] = useState<Tone>('Professional');
  const [provider, setProvider] = useState<LlmProvider>('xai');
  const [outputProvider, setOutputProvider] = useState<LlmProvider>('xai');
  const [allValues, setAllValues] = useState<ValuesByDoc>(() => seedDefaults());
  // Brief entry mode for MANUAL drafting only. The default experience is the
  // one-box auto flow (see `manualMode`); these modes ('form' field entry,
  // 'prompt' dictation into the form, 'grounded' pipeline for a pre-picked doc)
  // only apply once the advocate opts into manual control.
  const [briefMode, setBriefMode] = useState<'form' | 'prompt' | 'grounded'>('form');
  // The drafting screen is AGENT-ONLY: a single "Describe the matter" box. The
  // advocate describes the matter in plain language and the agent decides the
  // document type, resolves the law, and drafts it — there is no doc-type
  // picker or field form to fill by hand. `manualMode` is retained as a hard
  // `false` so the legacy manual-form JSX below is compiled out at runtime
  // without having to be deleted.
  //
  // FLAGGED (2026-10 UI/UX audit): this keeps ~250 lines of manual-form JSX
  // (including the DocTypePicker component further down) permanently
  // unreachable. Reviewed with the user, who chose to leave it as-is rather
  // than delete now — revisit explicitly before deleting: confirm with the
  // user whether the manual-entry flow is coming back, or safe to remove for
  // real, before touching this block.
  const manualMode = false as const;
  // Agent mode: run the grounded plan→draft→review→refine pipeline instead of a
  // single-shot generation. Defaults on — it produces more filing-ready drafts.
  const [agentMode, setAgentMode] = useState(true);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [showMobileForm, setShowMobileForm] = useState(false);
  const [stageMode, setStageMode] = useState(false);
  // "Back to brief" with a draft on screen: the composer comes back (its prompt
  // refilled from the draft's API transcript) while the draft is kept, so the
  // advocate can tweak the brief and redraft, or go back to the draft unchanged.
  const [briefOpen, setBriefOpen] = useState(false);
  useEffect(() => { if (stageMode) setBriefOpen(false); }, [stageMode]);
  const [isEditing, setIsEditing] = useState(false);
  const [editedHtml, setEditedHtml] = useState<string | null>(null);
  // The engine draft's formatted HTML, paired with the text it was built from: used
  // for the editor/preview only while the draft text is still that text.
  const [engineView, setEngineView] = useState<{ text: string; html: string } | null>(null);
  const [draftDate, setDraftDate] = useState<string>(todayIso());
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'PDF' | 'DOCX' | null>(null);
  // Letterhead choice for the client-side (working-copy) exports, surfaced as an
  // inline control in the toolbar next to the download buttons so the advocate
  // decides with/without letterhead BEFORE the download dialog opens.
  //   undefined → use effective default   null → no letterhead   string → specific id
  // DEFAULT null (no letterhead): a filed pleading — a s.138 complaint, an
  // affidavit — carries its own formal cause-title and must NOT be stamped with a
  // personal advocate letterhead by default (that produced the "Aarav Sharma /
  // Junior Advocate" header on complaint exports). The advocate can still opt in
  // to a letterhead via the inline picker for correspondence-style documents.
  const [letterheadChoice, setLetterheadChoice] = useState<string | null | undefined>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [formatsOpen, setFormatsOpen] = useState(false);
  // Variant chosen in the forms library (e.g. LAWE "Property" = warrant of possession).
  const [formatPreset, setFormatPreset] = useState<Record<string, string> | null>(null);
  // The format's name as picked in the library (a LAWE title may differ from the
  // engine format that drafts it), shown on the drafting card.
  const [formatTitle, setFormatTitle] = useState<string | null>(null);
  // The intake state behind the current engine draft — drives the live
  // Missing-details panel (null for model drafts / no draft).
  const [engineSession, setEngineSession] = useState<IntakeState | null>(null);
  // True once the advocate explicitly chose a format (Formats picker). Until then
  // the conversation AUTO-DETECTS the document type from their description.
  const [formatPicked, setFormatPicked] = useState(false);
  // The format the engine conversation is ACTUALLY drafting (picked, or auto-
  // detected inside the intake panel). Null until the first turn settles it — the
  // banner stays neutral until then instead of showing a stale default.
  const [activeEngineLabel, setActiveEngineLabel] = useState<string | null>(null);

  // Navigation context. Declared before the modal state below because that
  // state's initial value depends on whether we arrived with a case attached.
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as
    | { caseContext?: CaseContext; researchCitation?: ResearchCitation; draftId?: string }
    | null;

  // DraftBot-style one-shot modal: content in → document out, no fact sheet.
  // Auto-open when we arrived via "Draft for this case" so the advocate lands
  // straight in the prompt (with the case already loaded) instead of having to
  // click "Start drafting" first.
  const [draftBotOpen, setDraftBotOpen] = useState<boolean>(!!navState?.caseContext);
  const [myDraftsOpen, setMyDraftsOpen] = useState(false);
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  // The engine-rendered .docx (base64) for the CURRENT engine draft, if any. This is
  // the FILING-grade copy (real Word file, selectable text, correct margins) the
  // engine produced — distinct from the rasterised client-side "working copy" export.
  // Captured from the intake draft; null for model-only drafts (which have no engine .docx).
  const [engineDocxBase64, setEngineDocxBase64] = useState<string | null>(null);
  // A blob: URL of the engine .docx rendered to PDF, shown in the preview pane so
  // WHAT THE ADVOCATE SEES IS the filing PDF (pixel-identical, printable) — not the
  // flat plain-text blocks. Generated up-front when the engine draft loads (so the
  // Download PDF button is instant too). Null while converting / for model-only
  // drafts (which fall back to the HTML text preview). `previewPdfPending` drives a
  // "preparing preview" state.
  const [previewPdfUrl, setPreviewPdfUrl] = useState<string | null>(null);
  const [previewPdfPending, setPreviewPdfPending] = useState(false);
  // IPC/CrPC/Evidence-Act → BNS/BNSS/BSA conversions applied to this draft, so the
  // advocate can SEE which legacy sections were mapped to the in-force 2023 Sanhita
  // sections (the draft already cites the new ones). Empty when nothing was mapped.
  const [bnsConcordance, setBnsConcordance] = useState<
    Array<{ old: string; new: string; toAct: string; change: string }>
  >([]);
  // A COMPANION document the engine produced alongside the main draft — e.g. the
  // proof affidavit derived from a s.138 complaint. Its label + filing-grade .docx,
  // held so the advocate can download it as its own Word file (the affidavit body
  // is also appended into the preview below the complaint). Null for single-doc drafts.
  const [companionDoc, setCompanionDoc] = useState<{ label: string; docxBase64: string | null } | null>(null);
  const saveMutation = useSaveDraft();
  const createDocument = useCreateDocument();
  // Set true just before stream.seed() to suppress the effect that clears
  // edits when stream.data.text changes - loading a draft must preserve them.
  const skipResetOnSeedRef = useRef(false);

  const [caseContext, setCaseContext] = useState<CaseContext | null>(navState?.caseContext ?? null);
  const [researchCitation, setResearchCitation] = useState<ResearchCitation | null>(
    navState?.researchCitation ?? null,
  );
  // Drafting from a case opens an optional context channel: any case notes
  // the user can see are folded into the LLM user message. Default ON; the
  // banner gives the user a one-click way to skip them per-generation.
  const [includeNotes, setIncludeNotes] = useState<boolean>(true);
  const { data: caseNotesList } = useCaseNotes(caseContext?.id ?? null);
  // The case's uploaded documents, extracted to text (OCR for scans), so the
  // engine reads the matter's papers - not just typed notes.
  const { data: caseDocText } = useCaseDocumentText(caseContext?.title ?? null);
  const usableNotesCount = useMemo(
    () => (caseNotesList ?? []).filter((n) => n.body.trim().length > 0).length,
    [caseNotesList],
  );

  const stream = useStreamDraft();
  const autoDraft = useAutoDraft();
  const showToast = useUIStore((s) => s.showToast);
  // Resolve schemas through the form-generation resolver: for doc types whose generated
  // form is ENABLED (flags.ts / VITE_FORMGEN_DOCTYPES), this returns the engine-generated
  // schema under the engine label; every other doc type is DOC_SCHEMAS unchanged. With no
  // flag on, this is a pure no-op, so existing doc types are untouched.
  const resolvedSchemas = useMemo(() => resolveDocSchemas(), []);
  const schema: DocSchema = useMemo(
    () => resolvedSchemas[docType] ?? getSchema(docType),
    [resolvedSchemas, docType],
  );

  // True when the engine-routed card is the PRIMARY input for this doc (flag on
  // for this user AND the doc is one the engine handles — today, s.138 only).
  // When true, the general model auto-draft chat is demoted to a collapsed
  // fallback so the advocate sees one clear input, not two competing boxes.
  // Also on while the draft on screen came from the engine: its detected label
  // (a firm's own format, say) may not be in the built-in list, and the brief
  // must reopen in the same composer it was typed in.
  const engineActive = Boolean(
    engineStatus.data?.enabled
      && (engineStatus.data.docLabels.includes(docType) || engineSession?.docLabel === docType),
  );
  const values = allValues[docType] ?? {};

  // Single source of truth for the document's title/type used by export,
  // mailto, and the on-screen label. Once a draft exists in the preview,
  // `stream.data.docType` holds the type actually seeded/generated (auto-triage
  // detection, grounded pipeline, loaded draft, or single-shot req.docType) —
  // which can diverge from the `docType` picker state. Prefer it so the
  // exported/emailed title matches the drafted document; fall back to the
  // picker state only when there is no active draft. This fixes a bail
  // application being stamped with a stale "Notice u/s 138 NI Act" title.
  const activeDocType = stream.data?.docType ?? docType;

  // Open items (Step 9): unfilled placeholders / sections-to-verify / advisories
  // surfaced as a SEPARATE checklist, never written into the exportable body.
  // Captured on accept from a pipeline; null falls back to a live placeholder
  // scan of the current draft text (see effectiveOpenItems below).
  const [openItems, setOpenItems] = useState<OpenItems | null>(null);

  // Case attached to the current draft (its court/CNR/parties feed the agent).
  // Seed it from an incoming case context (e.g. "Draft for this case" from the
  // case page) so the draft is attached to that matter from the start: the
  // agent gets the case particulars, and the finished draft files back to this
  // matter's Documents tab without the user re-picking the case.
  const [draftCase, setDraftCase] = useState<DraftCaseContext | null>(
    navState?.caseContext
      ? {
          id: navState.caseContext.id,
          title: navState.caseContext.title,
          court: navState.caseContext.court ?? '',
          cnr: navState.caseContext.cnr ?? '',
          client: navState.caseContext.client ?? '',
          type: navState.caseContext.type ?? '',
        }
      : null,
  );

  // `draftCase` (DraftCaseContext) feeds the brief preamble; `caseContext`
  // (the older, slightly wider CaseContext) is what the case-notes and
  // case-document-text hooks key on below. Picking a case in DraftCasePicker
  // needs to drive both so notes/docs for that matter actually reach the
  // engine instead of silently staying empty.
  const selectDraftCase = (ctx: DraftCaseContext | null) => {
    setDraftCase(ctx);
    setCaseContext(ctx);
  };

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

  // Prompt-mode "Generate now": skip the required-field block on purpose so the
  // advocate gets a first draft (with gaps) straight from the dictated brief.
  // The post-generation completion panel then surfaces the missing fields.
  const generateNow = () => {
    setError(null);
    setDraftDate(todayIso());
    setDateModalOpen(true);
  };

  // Load a completed model draft (AutoDraftResponse) into the preview. Shared by
  // the DraftChatPanel accept and the DRAFT-NOW one-shot path.
  const acceptModelDraft = (result: AutoDraftResponse): boolean => {
    const blocks = result.pipeline?.draft ?? {};
    const body = renderDraftBlocks(blocks);
    if (!body.trim()) return false;
    const detected = result.triage.docType;
    setDocType(detected);
    // A model-only draft has no engine-rendered .docx — clear any prior one so a
    // stale filing copy from an earlier engine draft can't be downloaded here.
    setEngineDocxBase64(null);
    setCompanionDoc(null);
    const p = result.pipeline;
    setOpenItems(
      collectOpenItems({
        bodyText: body,
        verifyPlaceholders: p?.verify?.placeholders_remaining ?? [],
        needsClarification: p?.facts?.needs_clarification ?? [],
        advisories: p?.advisories ?? [],
        toVerify: (p?.sections ?? [])
          .filter((s) => !s.verified)
          .map((s) => `${s.citation} (${s.offenceName}, counsel to confirm)`),
      }),
    );
    stream.reset();
    skipResetOnSeedRef.current = true;
    stream.seed({ docType: detected, text: body, generatedAt: new Date().toISOString() });
    setStageMode(true);
    showToast({ type: 'sage', text: 'Draft loaded into preview' });
    return true;
  };

  // Load the ENGINE's drafted IntakeState into the preview (from the DraftBot
  // modal). The engine returns either a generated draft (blocks) or a refusal
  // (a legal finding) — surface each honestly. NO fact sheet; the advocate edits
  // the document text and its [placeholders] directly.
  // Draft first, then ask: after each new draft, what it still needs opens in a
  // popup on the right (the rail card holds the same fields once it's closed).
  const [askOpen, setAskOpen] = useState(false);
  useEffect(() => {
    if (!askOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAskOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askOpen]);

  const acceptEngineDraft = (s: IntakeState, opts: { live?: boolean } = {}) => {
    if (s.status === 'refused' && s.refusal) {
      const msg = s.refusal.reason || 'The engine can’t draft this as it stands.';
      setError(msg);
      showToast({ type: 'vermillion', text: 'The engine flagged a legal issue. See the note.' });
      return;
    }
    if (s.status !== 'generated' || !s.draft) {
      // Still gathering: the engine needs something it truly can't infer. Surface
      // the first question so the advocate knows what to add, then re-open.
      const q = s.questions?.[0]?.question;
      setError(q ? `One more thing needed: ${q}` : 'The engine needs a little more to draft this.');
      showToast({ type: 'amber', text: 'A required detail is missing: add it and draft again.' });
      return;
    }
    const detected = s.docLabel;
    setEngineSession(s);
    if (!opts.live) setAskOpen(missingDetailCount(s) > 0 || (s.draftNotes?.length ?? 0) > 0);
    setDocType(detected);
    // The new engine draft supersedes any earlier hand edits (a live update only
    // runs once the advocate has unlocked, i.e. discarded, their edits).
    setEditedHtml(null);
    setIsEditing(false);
    const primaryBody = s.draft.blocks.map((b) => b.text).join('\n\n');
    if (!primaryBody.trim()) return;
    setActiveEngineLabel(detected);
    // Keep the engine's filing-grade .docx so the advocate can download the real
    // Word file (not just the rasterised working copy). Null-safe: absent on older
    // engine responses, in which case only the working-copy export is offered.
    setEngineDocxBase64(s.draft.docxBase64 ?? null);

    // A companion document (e.g. the proof affidavit paired with a s.138 complaint):
    // append its body below the primary draft under a clear divider so both are
    // visible and export together in the working copy, and hold its filing-grade
    // .docx so it can be downloaded as its own Word file. Absent for single-doc drafts.
    const companion = s.companionDraft ?? null;
    const companionBody = companion?.blocks.map((b) => b.text).join('\n\n').trim() ?? '';
    if (companion && companionBody) {
      setCompanionDoc({ label: companion.docLabel, docxBase64: companion.docxBase64 ?? null });
    } else {
      setCompanionDoc(null);
    }
    const body = companionBody
      ? `${primaryBody}\n\n\n──────────────────────────────\n${companion!.docLabel.toUpperCase()}\n──────────────────────────────\n\n${companionBody}`
      : primaryBody;
    // Editor shows the document's own layout (single-document drafts).
    setEngineView(companionBody ? null : { text: body, html: blocksToHtml(s.draft.blocks) });

    // Open items = the [placeholder] gaps left in the body (scanned live), plus
    // the engine's points to address before filing (an AI-drafted fallback).
    setOpenItems(collectOpenItems({ bodyText: body, ...(s.draftNotes?.length ? { advisories: s.draftNotes } : {}) }));
    // BNS/BNSS/BSA conversions applied to this draft (legacy → in-force sections).
    setBnsConcordance(s.bnsConcordance ?? []);
    stream.reset();
    skipResetOnSeedRef.current = true;
    stream.seed({ docType: detected, text: body, generatedAt: new Date().toISOString() });
    setStageMode(true);
    setError(null);
    // A live update from the Missing-details panel: no "draft ready" toasts.
    if (opts.live) return;
    showToast({
      type: 'sage',
      text: companion && companionBody
        ? 'Complaint + proof affidavit ready. Review and edit below'
        : 'Draft ready. Review and edit below',
    });
    if ((s.bnsConcordance ?? []).length) {
      showToast({
        type: 'sage',
        text: `Applied ${s.bnsConcordance!.length} BNS/BNSS conversion${s.bnsConcordance!.length === 1 ? '' : 's'}: legacy sections mapped to the 2023 Sanhitas.`,
      });
    }
  };

  // A format's BLANK form, opened in the editor (forms library "Word"): the
  // advocate fills it in by hand, then downloads Word / PDF from the Export card.
  // No intake behind it, so no live Missing-details panel.
  const openBlankInEditor = (title: string, blank: BlankForm) => {
    const body = blank.blocks.map((b) => b.text).join('\n\n');
    if (!body.trim()) {
      showToast({ type: 'amber', text: 'That blank form came back empty.' });
      return;
    }
    setEngineSession(null);
    setDocType(title);
    setActiveEngineLabel(title);
    setEngineDocxBase64(blank.docxBase64);
    setCompanionDoc(null);
    setCurrentDraftId(null);
    setBnsConcordance([]);
    setOpenItems(collectOpenItems({ bodyText: body }));
    stream.reset();
    skipResetOnSeedRef.current = true;
    stream.seed({ docType: title, text: body, generatedAt: new Date().toISOString() });
    setStageMode(true);
    setError(null);
    // Straight into Edit, so the advocate can type into the blank lines — laid out
    // as the form prints (centred headings, bold titles).
    const html = blocksToHtml(blank.blocks);
    setEngineView({ text: body, html });
    setEditedHtml(html);
    setIsEditing(true);
    showToast({ type: 'sage', text: `${title}: blank form open. Type into it, then download.` });
  };

  // DRAFT NOW (DraftBot-style): the advocate has given content; draft the WHOLE
  // document immediately from it (the model one-shot path — full doc, [placeholders]
  // for genuine gaps), skipping the engine question loop entirely.
  //
  // FLAGGED (2026-10 UI/UX audit): this function (and the `autoDraft` mutation
  // it's the only caller of) has no call sites anywhere in this file — no
  // button, modal, or chat handler invokes it today. Reviewed with the user,
  // who chose to leave it as-is. Before deleting, confirm whether this is a
  // half-wired feature waiting on a UI affordance, or genuinely abandoned.
  const handleDraftNow = async (content: string) => {
    if (!content.trim()) return;
    setError(null);
    try {
      // Prefer an explicit doc type so the auto path never stalls at the
      // confirm-before-draft gate (which returns pipeline:null and would look
      // like nothing happened). Use the picked format, else the engine's
      // auto-detected label if the conversation settled one.
      const knownDoc = formatPicked ? docType : activeEngineLabel;
      const result = await autoDraft.mutateAsync({
        brief: content,
        ...(provider ? { provider } : {}),
        ...(knownDoc ? { docTypeOverride: knownDoc } : {}),
      });
      // needsConfirmation / empty pipeline → no body was produced. Say so
      // explicitly instead of silently doing nothing.
      if (result.needsConfirmation || !result.pipeline) {
        const guess = result.triage?.docType;
        const msg = guess
          ? `I read this as a ${guess}, but I’m not fully sure. Name the document explicitly in your description (e.g. “draft a ${guess}”) and try again.`
          : 'I couldn’t confidently tell which document this is. Name it in your description (e.g. “a s.138 notice”, “a plaint”) and try again.';
        setError(msg);
        showToast({ type: 'amber', text: msg });
        return;
      }
      const loaded = acceptModelDraft(result);
      if (!loaded) {
        const msg = 'The draft came back empty. Add a little more detail (or attach the document) and try again.';
        setError(msg);
        showToast({ type: 'amber', text: msg });
      }
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not draft from that. Try adding a little more detail.';
      setError(msg);
      showToast({ type: 'vermillion', text: msg });
    }
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
    // Drop any captured pipeline open-items; a fresh single-shot generation
    // falls back to a live placeholder scan of the new draft.
    setOpenItems(null);
    setEngineSession(null);
    // A model-stream draft has no engine .docx: drop the previous one so the
    // preview, PDF and Word download can't serve the OLD document.
    setEngineDocxBase64(null);
    setCompanionDoc(null);
    const fields: Record<string, string> = {};
    schema.sections.forEach((sec) =>
      sec.fields.forEach((f) => {
        const v = values[f.key];
        if (v !== undefined && v.toString().trim()) fields[f.key] = v;
      }),
    );
    void stream.generate(
      {
        docType,
        language: lang,
        tone,
        fields,
        draftDate: date,
        provider,
        ...(caseContext?.id ? { caseId: caseContext.id, includeNotes } : {}),
      },
      { agent: agentMode },
    );
  };

  const reset = () => {
    setBriefOpen(false);
    setAllValues((av) => ({ ...av, [docType]: {} }));
    stream.reset();
    setError(null);
    setCurrentDraftId(null);
    setEditedHtml(null);
    setIsEditing(false);
    setStageMode(false);
    setOpenItems(null);
    setEngineDocxBase64(null);
    setCompanionDoc(null);
    setEngineSession(null);
    setFormatPreset(null);
    setFormatTitle(null);
    // Back to the empty state; the next matter starts from the DraftBot modal.
    setDraftBotOpen(false);
  };

  const output = stream.text;
  const streaming = stream.isStreaming;
  const hasOutput = Boolean(output) || streaming;
  // Formatted (engine layout) when available for this exact text, else plain.
  const baseHtml = engineView && engineView.text === output ? engineView.html : plainTextToHtml(output);
  const displayHtml = editedHtml ?? baseHtml;
  // The body actually shown in the read-only preview and sent to export: the
  // same HTML, but with the legally-salient words BOLDED so every drafting path
  // reads like a filed document (Times New Roman is enforced by .court-prose /
  // the export stylesheet). We skip the emphasis pass while streaming (partial
  // tokens) and when the advocate is hand-editing (their edits are authoritative).
  const previewHtml = useMemo(
    () => (editedHtml || streaming ? displayHtml : emphasizeLegalTerms(displayHtml)),
    [displayHtml, editedHtml, streaming],
  );
  const outputLangCode = LANG_HTML[outputLang];
  // Once the advocate edits the draft locally, the engine .docx (and its rendered
  // PDF) no longer reflect what they see, so the preview must switch back to the
  // editable HTML view — otherwise their edits would be invisible behind a stale PDF.
  // Opening Edit seeds editedHtml with the draft itself; only count it as an edit
  // once the text actually differs — else the preview and exports would leave the
  // filing PDF for the rasterised copy without the advocate changing a word.
  const hasLocalEdits = useMemo(
    () => editedHtml !== null
      && editedParagraphs(editedHtml).join('\n') !== editedParagraphs(plainTextToHtml(output)).join('\n'),
    [editedHtml, output],
  );
  // The draft as display blocks — what Redraft edits and what Related law searches.
  const draftParagraphs = useMemo(() => editedParagraphs(displayHtml), [displayHtml]);

  // PREVIEW == FILING PDF. When the engine produced a .docx for this draft, render
  // it to PDF once (server-side LibreOffice) and show that PDF in the preview pane,
  // so the preview is pixel-identical to the downloaded Word/PDF (centred headings,
  // tables, alignment) instead of the flat text blocks. Generated up-front here (not
  // on a button click), and cached as a blob: URL, so the Download PDF button is
  // instant too. Re-runs whenever the engine .docx changes; skips model-only drafts.
  useEffect(() => {
    // Revoke any previous object URL and reset before (re)generating.
    setPreviewPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (!engineDocxBase64) {
      setPreviewPdfPending(false);
      return;
    }
    let cancelled = false;
    setPreviewPdfPending(true);
    (async () => {
      try {
        const blob = await api.postBlob('/drafting/engine/docx-to-pdf', {
          docxBase64: engineDocxBase64,
          fileName: `${activeDocType}-preview`,
        });
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPreviewPdfUrl(url);
      } catch {
        // Conversion unavailable — leave previewPdfUrl null so the pane falls back
        // to the HTML text preview (still shows the content, just not the PDF).
        if (!cancelled) setPreviewPdfUrl(null);
      } finally {
        if (!cancelled) setPreviewPdfPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineDocxBase64]);

  // The open items to show below the preview: the captured set from an accepted
  // pipeline draft when present, otherwise a live scan of the current draft text
  // for bracketed placeholders. Derived-only — never fed back into the body.
  // Placeholders always come from the text on screen: a set captured when the
  // draft arrived goes stale the moment a Redraft or hand edit fills a gap.
  const effectiveOpenItems = useMemo<OpenItems>(() => {
    const live = collectOpenItems({ bodyText: htmlToPlainText(displayHtml) });
    return openItems ? { ...openItems, placeholders: live.placeholders } : live;
  }, [openItems, displayHtml]);

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

  // Download a filing-grade .docx (the real Word file the engine rendered —
  // selectable text, correct margins) from its base64. Shared by the main draft
  // and any companion document (e.g. the paired proof affidavit).
  const downloadDocxBase64 = (base64: string, titleForFile: string) => {
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${titleForFile.replace(/[^\w.-]+/g, '_')}-${draftDate}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick so the download has committed to the object URL.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      showToast({ type: 'sage', text: 'Filing .docx downloaded' });
    } catch {
      showToast({ type: 'cobalt', text: 'Could not prepare the .docx download' });
    }
  };

  // The main draft's filing copy; the client-side PDF/DOCX buttons below are
  // only a rasterised working copy.
  /** The engine .docx with the advocate's hand edits written back into its own
   *  paragraphs (court layout kept). null when there's nothing to merge, or when
   *  paragraphs were added/removed — callers then use the generic export. */
  const editedEngineDocx = async (): Promise<string | null> => {
    if (!engineDocxBase64 || editedHtml === null) return null;
    try {
      const out = await api.post<{ matched: boolean; docxBase64?: string }>('/drafting/engine/apply-edits', {
        docxBase64: engineDocxBase64,
        paragraphs: editedParagraphs(editedHtml),
      });
      return out.matched && out.docxBase64 ? out.docxBase64 : null;
    } catch {
      return null;
    }
  };

  const downloadEngineDocx = async () => {
    if (!engineDocxBase64) return;
    if (hasLocalEdits) {
      const merged = await editedEngineDocx();
      if (merged) {
        downloadDocxBase64(merged, activeDocType);
        showToast({ type: 'sage', text: 'Word file prepared with your edits' });
        return;
      }
      showToast({ type: 'amber', text: 'Paragraphs were added or removed, so this Word copy uses a simplified layout.' });
      triggerExport('DOCX');
      return;
    }
    downloadDocxBase64(engineDocxBase64, activeDocType);
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
          // File the draft against the attached matter (if any) so it appears
          // in that case's Documents tab, not just the global "My drafts".
          ...(draftCase ? { matter: draftCase.title } : {}),
        },
      },
      {
        onSuccess: (saved) => {
          setCurrentDraftId(saved.id);
          showToast({ type: 'sage', text: currentDraftId ? 'Draft updated' : 'Draft saved' });
          // Also file the filing-grade engine .docx into the CASE's Documents
          // section (the `documents` table, keyed by case_label) so a generated
          // draft appears alongside the case's other documents — not only under
          // "My drafts". Best-effort: a failure here never blocks the draft save.
          void saveDraftToCaseDocuments();
        },
        onError: (e) => {
          const msg = e instanceof Error ? e.message : 'Could not save draft';
          showToast({ type: 'cobalt', text: msg });
        },
      },
    );
  };

  /** File the engine's filing-grade .docx (the complaint, and its companion
   *  affidavit if any) into the attached case's Documents section. Each row is
   *  linked by `case: draftCase.title` (the documents table keys on case_label),
   *  which is what CaseDocumentsPanel reads. Only runs when a matter is attached
   *  and the engine produced a .docx; downloads-only drafts are unaffected. */
  const saveDraftToCaseDocuments = async () => {
    if (!draftCase?.title) return; // no case attached — nothing to file against
    const today = new Date().toISOString().slice(0, 10);
    const toSave: Array<{ label: string; b64: string }> = [];
    if (engineDocxBase64) toSave.push({ label: activeDocType, b64: engineDocxBase64 });
    if (companionDoc?.docxBase64) {
      toSave.push({ label: companionDoc.label, b64: companionDoc.docxBase64 });
    }
    if (toSave.length === 0) return; // no filing-grade .docx to file
    for (const doc of toSave) {
      const fileName = `${doc.label} - ${draftCase.title} (${today}).docx`;
      try {
        await createDocument.mutateAsync({
          name: doc.label,
          type: doc.label,
          case: draftCase.title,
          updated: 'just now',
          fileName,
          fileMime:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          fileSize: Math.floor((doc.b64.length * 3) / 4),
          fileBase64: doc.b64,
        });
      } catch {
        showToast({
          type: 'amber',
          text: `Saved the draft, but couldn't file "${doc.label}" into the case Documents.`,
        });
      }
    }
    showToast({ type: 'sage', text: 'Filed into the case Documents section.' });
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
    setEngineSession(null); // a saved draft has no live intake behind it
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
    const sc = resolvedSchemas[docType] ?? DOC_SCHEMAS[docType];
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

  // When a companion (proof affidavit) is present its body is appended to the
  // preview below a divider (see the seed logic above). For SEPARATE PDF exports
  // we split the preview back into the complaint half and the affidavit half on
  // that same divider, so "Download complaint PDF" and "Download affidavit PDF"
  // each render only their own document. The divider line is a run of box-drawing
  // dashes; we split on the first such divider block.
  const splitCompanion = (html: string): { primary: string; companion: string | null } => {
    // The seeded body puts the companion (affidavit) after a divider block — a
    // run of "─" box-drawing chars plus the doc heading — separated by a blank
    // line, so plainTextToHtml renders that divider as its OWN <p> block. Split on
    // <p> boundaries (never mid-tag), drop the divider block, and keep the rest as
    // the companion. Falls back to no-split when no divider is present.
    const blocks = html.split(/(?=<p)/i); // keep each "<p…>…</p>" as one chunk
    const dividerIdx = blocks.findIndex((b) => /─{6,}/.test(b));
    if (dividerIdx < 0) return { primary: html, companion: null };
    const primary = blocks.slice(0, dividerIdx).join('').trim();
    // Everything after the divider block is the companion; the divider block
    // itself (dashes + heading) is dropped so the affidavit starts at its title.
    const companion = blocks.slice(dividerIdx + 1).join('').trim();
    return { primary: primary || html, companion: companion || null };
  };

  /** Export ONE document's HTML to a rasterised working-copy PDF, honouring the
   *  inline letterhead choice. Shared by the complaint and affidavit PDF buttons. */
  const downloadPdfOf = async (bodyHtml: string, title: string, docxBase64In?: string | null) => {
    let docxBase64 = docxBase64In ?? null;
    // PREFER the engine .docx -> PDF (LibreOffice) so the PDF is IDENTICAL to the
    // formatted filing .docx — tables, backing sheet, exact font/alignment. The
    // client-side HTML rasterisation flattens that layout, so it's only the
    // fallback (when there's no engine .docx, or the server render is unavailable).
    // After hand edits, render the PDF from the engine .docx WITH the edits merged
    // in (same court layout); fall back to the HTML copy only if that's impossible.
    if (docxBase64 && hasLocalEdits && docxBase64 === engineDocxBase64) {
      const merged = await editedEngineDocx();
      docxBase64 = merged;
      if (!merged) showToast({ type: 'amber', text: 'Paragraphs were added or removed, so this PDF uses a simplified layout.' });
    }
    if (docxBase64) {
      // INSTANT PATH: the preview pane already rendered THIS engine .docx to a PDF
      // blob (previewPdfUrl). Reuse it directly — no second server round-trip, so
      // the Download PDF button fires immediately instead of waiting on LibreOffice.
      if (!hasLocalEdits && docxBase64 === engineDocxBase64 && previewPdfUrl) {
        const a = document.createElement('a');
        a.href = previewPdfUrl;
        a.download = `${title.replace(/[^\w.-]+/g, '_')}-${draftDate}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast({ type: 'sage', text: `${title} PDF prepared` });
        return;
      }
      try {
        const blob = await api.postBlob('/drafting/engine/docx-to-pdf', {
          docxBase64,
          fileName: `${title}-${draftDate}`,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title.replace(/[^\w.-]+/g, '_')}-${draftDate}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        showToast({ type: 'sage', text: `${title} PDF prepared` });
        return;
      } catch {
        // Server render unavailable (e.g. LibreOffice not installed) — fall back to
        // the rasterised HTML PDF below so the advocate still gets *something*.
        showToast({ type: 'amber', text: 'Filing-grade PDF unavailable: using a rasterised copy.' });
      }
    }
    if (!bodyHtml.trim()) return;
    const letterhead =
      letterheadChoice === undefined ? undefined
      : letterheadChoice === null   ? null
      : await resolveLetterhead(letterheadChoice);
    try {
      // advocate: null — a pleading signs off with its own "Counsel for the
      // Complainant / Complainant" block from the engine template; do not append
      // the signed-in user's personal signature block on top of it.
      await exportPdf({ title, bodyHtml, dated: draftDate, letterhead, advocate: null });
      showToast({ type: 'sage', text: `${title} PDF prepared` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PDF export failed';
      showToast({ type: 'cobalt', text: msg });
    }
  };

  const performExport = async (choice: string | null | undefined) => {
    const fmt = exportFormat;
    if (!fmt) return;
    // FILING-GRADE FIRST. When the engine produced a formatted .docx for this
    // draft, that IS the real filing artifact (exact court format — tables,
    // backing sheet, alignment, fonts). The client-side HTML rasterisation
    // (exportPdf/exportDocx from previewHtml) flattens all that into a generic
    // left-aligned layout with a synthetic title/"Dated:" banner — which is wrong
    // for the advocate court forms. So if we have the engine .docx, export FROM it
    // (PDF via LibreOffice, or the .docx itself for Word), exactly like the
    // "Download PDF" button does. Only fall through to the HTML export when there
    // is no engine .docx (model-only drafts) or the server render is unavailable.
    // After hand edits, export from the engine .docx WITH the edits merged in;
    // only if paragraphs were added/removed fall through to the HTML export.
    const exportDocxB64 = hasLocalEdits ? await editedEngineDocx() : engineDocxBase64;
    if (exportDocxB64) {
      if (fmt === 'DOCX') {
        downloadDocxBase64(exportDocxB64, activeDocType);
        showToast({ type: 'sage', text: `${fmt} prepared` });
        return;
      }
      if (fmt === 'PDF') {
        // INSTANT PATH — reuse the preview's already-rendered PDF blob (see above).
        if (previewPdfUrl && !hasLocalEdits) {
          const a = document.createElement('a');
          a.href = previewPdfUrl;
          a.download = `${activeDocType.replace(/[^\w.-]+/g, '_')}-${draftDate}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          showToast({ type: 'sage', text: `${fmt} prepared` });
          return;
        }
        try {
          const blob = await api.postBlob('/drafting/engine/docx-to-pdf', {
            docxBase64: exportDocxB64,
            fileName: `${activeDocType}-${draftDate}`,
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${activeDocType.replace(/[^\w.-]+/g, '_')}-${draftDate}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 0);
          showToast({ type: 'sage', text: `${fmt} prepared` });
          return;
        } catch {
          // Server render unavailable — fall through to the rasterised HTML export
          // so the advocate still gets something.
          showToast({ type: 'amber', text: 'Filing-grade PDF unavailable: using a rasterised copy.' });
        }
      }
    }
    // Resolve the picker's choice into something exportPdf can consume:
    //   undefined → leave undefined, exportPdf auto-fetches effective default
    //   null      → explicit "no letterhead"
    //   string    → fetch that specific letterhead + its logo
    const letterhead =
      choice === undefined ? undefined
      : choice === null   ? null
      : await resolveLetterhead(choice);
    const payload = {
      title: activeDocType,
      bodyHtml: previewHtml,
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
      <PageHeader
        title="Draft"
        description={
          // Once a draft exists the workspace header names the document, so the
          // page header stays short instead of repeating it.
          hasOutput
            ? undefined
            : 'Describe what you need. The drafting engine writes the whole document, ready to edit and export.'
        }
        actions={<>
          {/* Format picking is no longer required — the engine auto-detects the
              document type from the prompt/case content. "Formats" is kept only
              as an optional override for the rare case the advocate wants to force
              a specific format, tucked behind Templates. */}
          <button
            className="btn"
            type="button"
            onClick={() => setMyDraftsOpen(true)}
          >
            <Icon name="documents" size={14} /> My drafts
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => setFormatsOpen(true)}
            title="Every format: draft it from the case, or download it blank as an editable Word form"
          >
            <Icon name="documents" size={14} /> Formats
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => setTemplatesOpen(true)}
          >
            <Icon name="file" size={14} /> Templates
          </button>
          {/* Nothing to clear on the empty composer - only offer it once there's a draft. */}
          {(hasOutput || stageMode) && (
            <button
              className="btn"
              type="button"
              onClick={reset}
              disabled={streaming}
              title="Clear the brief fields and the generated draft"
            >
              <Icon name="close" size={14} /> New draft
            </button>
          )}
        </>}
      >
        {incomingDraftId && incomingDraft.isLoading && (
          <p className="body-sm muted" style={{ margin: 0 }}>
            Loading draft<span className="blink" />
          </p>
        )}
      </PageHeader>

      {/* ONE composed card: pick the matter, then draft — no separate "Start
          drafting" click-through. Case selection drives both `draftCase` (the
          brief preamble the engine reads) and `caseContext` (which pulls in
          that matter's notes and uploaded-document text into the form below).
          Hidden once a draft is already staged/out so the preview isn't
          buried. */}
      {((!stageMode && !hasOutput) || briefOpen) && (
        <div className="dc-layout">
          <div className="dc-main">
          {briefOpen && (
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              style={{ alignSelf: 'flex-start', marginBottom: 12 }}
              onClick={() => setStageMode(true)}
              title="Return to the draft without changing it"
            >
              <Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} /> Back to draft
            </button>
          )}
          {engineActive ? (
            <DraftBotModal
              inline
              open={draftBotOpen}
              onClose={() => setDraftBotOpen(false)}
              docLabel={formatPicked ? docType : null}
              preset={formatPreset}
              selectedTitle={formatTitle}
              onChangeFormat={() => setFormatsOpen(true)}
              onClearFormat={() => {
                setFormatPicked(false);
                setFormatPreset(null);
                setFormatTitle(null);
                setActiveEngineLabel(null);
              }}
              onActiveLabel={setActiveEngineLabel}
              activeLabel={activeEngineLabel}
              onDrafted={acceptEngineDraft}
              restoreFrom={engineSession}
              caseContext={draftCase}
              caseNotes={[
                // Typed / dictated notes on the matter.
                ...(caseNotesList ?? [])
                  .filter((n) => n.body.trim().length > 0)
                  .map((n) => n.body),
                // Text extracted from the case's uploaded documents, labelled so the
                // engine knows what each block is (e.g. the cheque, the notice).
                ...(caseDocText?.items ?? []).map((d) => `Document "${d.name}":\n${d.text}`),
              ]}
              unreadableDocs={caseDocText?.unreadable ?? []}
            />
          ) : (
            <DraftChatPanel
              provider={provider}
              caseContext={draftCase}
              onUseDraft={acceptModelDraft}
            />
          )}
          </div>
          <aside className="dc-rail">
            <DraftCasePicker
              selected={draftCase}
              onSelect={selectDraftCase}
              onOpenCase={(id) => navigate(`/app/cases/${id}`)}
              readSummary={draftCase ? {
                notes: (caseNotesList ?? []).filter((n) => n.body.trim().length > 0).length,
                documents: caseDocText?.items?.length ?? 0,
                unreadable: caseDocText?.unreadable?.length ?? 0,
              } : undefined}
            />
            <section className="dc-card">
              <div className="dc-eyebrow">How it works</div>
              <ol className="dc-steps">
                <li><span>1</span><div><strong>Describe</strong> the document and the facts, or attach the papers.</div></li>
                <li><span>2</span><div><strong>The engine drafts</strong> the complete document in the right format.</div></li>
                <li><span>3</span><div><strong>Review</strong>: fill any <code>[placeholder]</code>, edit, then export to Word or PDF.</div></li>
              </ol>
            </section>
          </aside>
        </div>
      )}

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

      {/* Duplicates the DraftCasePicker's own selected-matter chip while it's
          visible (pre-draft), so only shown once a draft is staged/out and
          the picker above has disappeared — keeps the attached matter
          visible while reviewing/editing the generated document. */}
      {caseContext && (stageMode || hasOutput) && (
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


      {manualMode && schema.description && (
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

      {/* The grid (form + preview) renders for manual drafting, or once a draft
          exists (accepted-from-chat draft seeds stageMode/hasOutput). In the
          initial auto state only the DraftChatPanel above is shown. */}
      {(manualMode || stageMode || hasOutput) && (
      <div
        className={`draft-grid${stageMode ? ' draft-grid--stage' : ''}${!manualMode ? ' draft-grid--solo' : ''}`}
      >
        {/* Form column — manual drafting only. In auto mode the advocate never
            sees the doc-type picker or the field form. */}
        {manualMode && (
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
          <div style={{ padding: '10px 18px 0' }}>
            <PillNav
              items={[
                { id: 'form', label: 'Fill form' },
                { id: 'prompt', label: 'Dictate brief' },
                { id: 'grounded', label: 'Grounded (BNS/BNSS)', title: 'Grounded pipeline for the doc type picked above.' },
              ]}
              value={briefMode}
              onChange={setBriefMode}
              ariaLabel="Brief entry mode"
            />
          </div>
          {briefMode === 'grounded' ? (
            <div style={{ padding: '14px 18px 18px' }}>
              <DraftPipelinePanel
                docType={docType}
                forum={schema.category}
                provider={provider}
                onAccept={(blocks, result) => {
                  // Fold the grounded draft's blocks into the preview: map keys
                  // to forum-convention headings (no "CAUSETITLE" leak), then
                  // seed the stream so the advocate can edit/export normally.
                  const body = renderDraftBlocks(blocks);
                  if (!body.trim()) return;
                  // Step 9: surface open items as a separate checklist, not in body.
                  setOpenItems(
                    collectOpenItems({
                      bodyText: body,
                      verifyPlaceholders: result?.verify?.placeholders_remaining ?? [],
                      needsClarification: result?.facts?.needs_clarification ?? [],
                      advisories: result?.advisories ?? [],
                      toVerify: (result?.sections ?? [])
                        .filter((s) => !s.verified)
                        .map((s) => `${s.citation} (${s.offenceName}, counsel to confirm)`),
                    }),
                  );
                  stream.reset();
                  skipResetOnSeedRef.current = true;
                  stream.seed({
                    docType,
                    text: body,
                    generatedAt: new Date().toISOString(),
                  });
                  setStageMode(true);
                  showToast({ type: 'sage', text: 'Grounded draft loaded into preview' });
                }}
              />
            </div>
          ) : briefMode === 'prompt' ? (
            <DraftPromptPanel
              docType={docType}
              schema={schema}
              provider={provider}
              onExtracted={(vals) => {
                // Replace the doc's values with the extracted set (dropping the
                // sample defaults) so missing-field detection is exact. But if
                // nothing was extracted (AI off / unrecognised), keep the
                // defaults so switching to the form behaves normally.
                if (Object.keys(vals).length > 0) {
                  setAllValues((av) => ({ ...av, [docType]: vals }));
                }
              }}
              onGenerateNow={generateNow}
              onSwitchToForm={() => setBriefMode('form')}
            />
          ) : (
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
          )}

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
              <div>
                <label className="label">Drafting engine</label>
                <PillNav
                  items={[
                    { id: 'agent', label: 'Agent', title: 'Grounded pipeline: plans the format, drafts, self-reviews against the required structure, then refines before returning.' },
                    { id: 'single', label: 'Single-shot', title: 'One-pass generation. Faster and cheaper; less structural checking.' },
                  ]}
                  value={agentMode ? 'agent' : 'single'}
                  onChange={(v) => setAgentMode(v === 'agent')}
                  ariaLabel="Drafting engine"
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
                  Agent picks the correct format for {docType}, drafts it, then reviews the draft against the required structure and statutory ingredients before returning.
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
        )}

        {/* Document workspace: the document owns the main column; everything you
            DO with it (export, letterhead, filing checklist, Sanhita, share) sits
            in a labelled side rail, in the order it's used. */}
        <div className={`draft-preview-wrap dw${hasOutput && !streaming ? ' dw--rail' : ''}`} style={briefOpen ? { display: 'none' } : undefined}>
          <div className="dw-main">
          {(stageMode || hasOutput) && (
            <div className="dw-head">
              {stageMode && (
                <button className="btn btn-sm btn-ghost dw-back" type="button" onClick={() => { setStageMode(false); if (hasOutput) setBriefOpen(true); }} title="Return to brief">
                  <Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} /> Back to brief
                </button>
              )}
              <div className="dw-title-wrap">
                <div className="dw-title">{activeDocType}</div>
                <div className="dw-meta">
                  {schema.category} · {LANGUAGES.find((l) => l[0] === outputLang)?.[1] ?? outputLang}
                  {streaming ? (
                    <span className="dw-status is-busy" aria-live="polite">
                      <span className="dw-dot" />
                      {stream.stage ? stream.stage.label : 'Generating'}
                      {stream.stage?.detail ? ` · ${stream.stage.detail}` : ''}
                    </span>
                  ) : hasOutput ? (
                    <span className="dw-status">
                      {currentDraftId ? (hasLocalEdits ? 'Edited · not saved' : 'Saved to My drafts') : 'Not saved yet'}
                    </span>
                  ) : null}
                </div>
              </div>
              {hasOutput && !streaming && (
                <div className="dw-head-actions">
                  <div className="dc-seg" role="tablist" aria-label="View">
                    <button
                      type="button" role="tab" aria-selected={!isEditing} className={!isEditing ? 'is-on' : ''}
                      onClick={() => setIsEditing(false)}
                    >
                      <Icon name="eye" size={13} /> Preview
                    </button>
                    <button
                      type="button" role="tab" aria-selected={isEditing} className={isEditing ? 'is-on' : ''}
                      onClick={() => {
                        if (editedHtml === null) setEditedHtml(baseHtml);
                        setIsEditing(true);
                      }}
                    >
                      <Icon name="edit" size={13} /> Edit
                    </button>
                  </div>
                  {!isEditing && hasLocalEdits && (
                    <button
                      className="btn btn-sm btn-ghost" type="button"
                      title="Discard manual edits and restore the generated draft"
                      onClick={() => setEditedHtml(null)}
                    >
                      Revert edits
                    </button>
                  )}
                  <button className="btn btn-sm" type="button" onClick={handleSave} disabled={saveMutation.isPending}>
                    <Icon name="check" size={13} /> {saveMutation.isPending ? 'Saving…' : currentDraftId ? 'Update draft' : 'Save draft'}
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Phone toggle for the manual brief form - only exists in manual mode. */}
          {manualMode && (
            <button
              className="btn btn-block draft-mobile-edit"
              onClick={() => setShowMobileForm((s) => !s)}
              style={{ display: 'none' }}
            >
              <Icon name="file" size={14} />{' '}
              {showMobileForm ? 'Close brief' : `Edit brief · ${completion}%`}
            </button>
          )}
          {/* Model-path drafts only. An engine draft's gaps are filled through the
              engine (LiveDetailsPanel in the rail); this panel's Regenerate re-drafts
              through the model stream and would leave the engine .docx stale. */}
          {output && !streaming && !engineDocxBase64 && !engineSession && (
            <DraftMissingFields
              schema={schema}
              values={values}
              setField={setField}
              onRegenerate={() => runGeneration(draftDate)}
              busy={streaming}
            />
          )}

          <div className="dw-paper-wrap draft-preview-card">
            {!output && !streaming && (
              <div key={docType} className="draft-empty-anim" style={{ padding: '40px 48px' }}>
                <EmptyState docType={docType} completion={completion} onGenerate={generate} />
              </div>
            )}
            {/* PREVIEW == FILING PDF. When the engine .docx has been rendered to a
                PDF (previewPdfUrl), show THAT so what the advocate sees is exactly
                the printable document. While it converts, or during streaming, or
                after local edits, show the HTML preview so the pane is never blank. */}
            {hasOutput && !isEditing && previewPdfUrl && !streaming && !hasLocalEdits && (
              canEmbedPdf() ? (
                <iframe
                  key={previewPdfUrl}
                  title="Document preview"
                  src={`${previewPdfUrl}#toolbar=1&navpanes=0&view=FitH`}
                  className="dw-pdf"
                />
              ) : (
                // No built-in PDF viewer (Android app / mobile browsers): draw the pages.
                <Suspense fallback={<div className="dw-pending">Preparing the formatted preview…</div>}>
                  <ZoomPane label="Document">
                  <PdfPages
                    key={previewPdfUrl}
                    url={previewPdfUrl}
                    className="dw-pdf-pages"
                    aria-label="Document preview"
                    fallback={(
                      <div
                        className="court-prose court-prose-paper"
                        lang={outputLangCode}
                        dir="ltr"
                        style={{ margin: '0 auto' }}
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    )}
                  />
                  </ZoomPane>
                </Suspense>
              )
            )}
            {/* The HTML text view only when there is no formatted PDF coming: while the
                engine .docx converts (a few seconds) show the pending state instead, so
                the advocate never sees a differently laid-out copy flash first. */}
            {hasOutput && !isEditing && (!previewPdfUrl || hasLocalEdits || streaming)
              && !(previewPdfPending && !hasLocalEdits && !streaming) && (
              <ZoomPane label="Document">
                <div
                  className="court-prose court-prose-paper"
                  lang={outputLangCode}
                  dir="ltr"
                  style={{ margin: '0 auto' }}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </ZoomPane>
            )}
            {hasOutput && !isEditing && !previewPdfUrl && !hasLocalEdits && previewPdfPending && !streaming && (
              <div className="dw-pending">Preparing the formatted preview…</div>
            )}
            {hasOutput && !isEditing && streaming && <span className="blink" />}
            {hasOutput && isEditing && !streaming && (
              <div className="dw-editor">
                <RichTextEditor value={displayHtml} onChange={setEditedHtml} autoFocus lang={outputLangCode} />
              </div>
            )}
          </div>
          </div>

          {hasOutput && !streaming && (
            <aside className="dw-rail">
              {/* EXPORT */}
              <section className="dc-card">
                <div className="dc-eyebrow">Export</div>
                {engineDocxBase64 ? (
                  <button className="btn btn-primary dw-wide" type="button" onClick={downloadEngineDocx}
                    title="Engine-rendered Microsoft Word document: selectable text, correct court margins">
                    <Icon name="download" size={15} /> {companionDoc ? 'Complaint · Word' : 'Download Word'}
                  </button>
                ) : null}
                {companionDoc?.docxBase64 && (
                  <button className="btn btn-primary dw-wide" type="button"
                    onClick={() => downloadDocxBase64(companionDoc.docxBase64!, companionDoc.label)}>
                    <Icon name="download" size={15} /> {companionDoc.label} · Word
                  </button>
                )}
                <div className="dw-btn-row">
                  {!companionDoc ? (
                    <button className="btn" type="button"
                      title={engineDocxBase64 ? 'Same court format as the Word file' : 'Working copy only, not a filing copy'}
                      onClick={() => {
                        if (engineDocxBase64) void downloadPdfOf(previewHtml, activeDocType, engineDocxBase64);
                        else triggerExport('PDF');
                      }}>
                      <Icon name="download" size={14} /> {engineDocxBase64 ? 'PDF' : 'PDF (working)'}
                    </button>
                  ) : (
                    <>
                      <button className="btn" type="button" title="Complaint as PDF (working copy)"
                        onClick={() => { const { primary } = splitCompanion(previewHtml); void downloadPdfOf(primary, activeDocType, engineDocxBase64); }}>
                        <Icon name="download" size={14} /> Complaint PDF
                      </button>
                      <button className="btn" type="button" title={`${companionDoc.label} as PDF (working copy)`}
                        onClick={() => { const { companion } = splitCompanion(previewHtml); if (companion) void downloadPdfOf(companion, companionDoc.label, companionDoc.docxBase64); }}>
                        <Icon name="download" size={14} /> {companionDoc.label} PDF
                      </button>
                    </>
                  )}
                  {!engineActive && (
                    <button className="btn" type="button" title="DOCX working copy, not a filing copy" onClick={() => triggerExport('DOCX')}>
                      <Icon name="download" size={14} /> Word (working)
                    </button>
                  )}
                  <button className="btn" type="button" title="Copy the draft text to the clipboard"
                    onClick={() => {
                      void navigator.clipboard?.writeText(htmlToPlainText(displayHtml));
                      showToast({ type: 'sage', text: 'Draft copied to clipboard' });
                    }}>
                    <Icon name="file" size={14} /> Copy text
                  </button>
                </div>
                <p className="dc-card-text">
                  {engineDocxBase64
                    ? 'Court-ready: selectable text and correct margins. The PDF is the same format.'
                    : 'Working copy, not for filing: fixed margins and non-selectable text. A filing copy comes only from engine drafts.'}
                </p>
              </section>

              {/* REDRAFT — one-line instruction, proposed edits accepted by the advocate */}
              {!isEditing && (
                <DraftRevisePanel
                  docType={activeDocType}
                  paragraphs={draftParagraphs}
                  onAccept={async (paras, layoutKept) => {
                    // Engine draft, untouched by hand: write the changed lines INTO the
                    // .docx and make that the draft, so the formatted preview, PDF and
                    // Word download all show the redraft in the court layout.
                    const range = changedRange(draftParagraphs, paras);
                    if (range && engineDocxBase64 && !hasLocalEdits && !companionDoc) {
                      try {
                        const out = await api.post<{
                          matched: boolean; docxBase64?: string;
                          blocks?: Array<{ text: string; align?: string; bold?: boolean }>;
                        }>('/drafting/engine/splice-lines', { docxBase64: engineDocxBase64, ...range });
                        if (out.matched && out.docxBase64) {
                          // Text + layout re-read from the updated .docx, so the editor
                          // shows exactly what the PDF prints.
                          const text = out.blocks?.length ? out.blocks.map((b) => b.text).join('\n\n') : paras.join('\n\n');
                          setEngineView(out.blocks?.length ? { text, html: blocksToHtml(out.blocks) } : null);
                          skipResetOnSeedRef.current = true;
                          stream.seed({ docType: activeDocType, text, generatedAt: new Date().toISOString() });
                          setEditedHtml(null);
                          setEngineDocxBase64(out.docxBase64);
                          showToast({ type: 'sage', text: 'Redraft applied' });
                          return;
                        }
                      } catch {
                        // Fall through to the editor-only copy below.
                      }
                    }
                    // One <p> per line, so editedParagraphs() reads back the same
                    // blocks and the engine .docx write-back still lines up.
                    setEditedHtml(plainTextToHtml(paras.join('\n\n')));
                    showToast({
                      type: layoutKept ? 'sage' : 'amber',
                      text: layoutKept ? 'Redraft applied' : 'Redraft applied · Word download will use a simplified layout',
                    });
                  }}
                />
              )}

              {/* RELATED LAW — grounded statute hits from the laws corpus. The panel
                  searches the trailing ~800 chars, so lead with the doc type and the
                  opening (facts) paragraphs rather than the signature block. */}
              <LawSidePanel
                context={`${activeDocType}. ${draftParagraphs.slice(0, 15).join(' ')}`.slice(0, 800)}
                title="Related law"
                k={5}
                debounceMs={800}
              />

              {/* LETTERHEAD */}
              <section className="dc-card">
                <div className="dc-eyebrow">Letterhead</div>
                <LetterheadPicker label="" value={letterheadChoice} onChange={setLetterheadChoice} className="dw-letterhead" />
              </section>

              {/* MISSING DETAILS — live: typing re-drafts the document (in the
                  popup while it's open, here once it's closed) */}
              {engineSession && engineSession.status === 'generated' && !askOpen && (
                <LiveDetailsPanel
                  state={engineSession}
                  manual={engineSession.draftedBy === 'ai'}
                  locked={hasLocalEdits}
                  onUnlock={() => setEditedHtml(null)}
                  onUpdated={(s) => acceptEngineDraft(s, { live: true })}
                  language={outputLang}
                />
              )}

              {/* ASK AFTER DRAFTING — the questions as a popup on the right. */}
              {engineSession && engineSession.status === 'generated' && askOpen && (
                <aside className="dw-ask-pop" role="dialog" aria-label="Details to complete">
                  <div className="dw-ask-pop-head">
                    <div>
                      <div className="dc-eyebrow">Your draft is ready</div>
                      <div className="dw-ask-pop-title">
                        {missingDetailCount(engineSession) > 0
                          ? `Fill ${missingDetailCount(engineSession)} detail${missingDetailCount(engineSession) === 1 ? '' : 's'} to complete it`
                          : 'Check these points'}
                      </div>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAskOpen(false)} aria-label="Close">
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                  {(engineSession.draftNotes?.length ?? 0) > 0 && (
                    <ul className="dw-ask-pop-notes">
                      {engineSession.draftNotes!.map((n) => <li key={n}>{n}</li>)}
                    </ul>
                  )}
                  <LiveDetailsPanel
                    state={engineSession}
                    manual={engineSession.draftedBy === 'ai'}
                    locked={hasLocalEdits}
                    onUnlock={() => setEditedHtml(null)}
                    onUpdated={(s) => acceptEngineDraft(s, { live: true })}
                    language={outputLang}
                  />
                  <button type="button" className="btn btn-sm" onClick={() => setAskOpen(false)}>
                    Later, show the draft
                  </button>
                </aside>
              )}
              {engineSession && engineSession.status === 'generated' && !askOpen && missingDetailCount(engineSession) > 0 && (
                <button type="button" className="dw-ask-reopen" onClick={() => setAskOpen(true)}>
                  {missingDetailCount(engineSession)} detail{missingDetailCount(engineSession) === 1 ? '' : 's'} to complete
                </button>
              )}

              {/* BEFORE FILING */}
              {hasOpenItems(effectiveOpenItems) && (
                <section className="dc-card">
                  <div className="dw-card-head">
                    <div className="dc-eyebrow">Before filing</div>
                    <span className="dw-count">
                      {effectiveOpenItems.placeholders.length + effectiveOpenItems.toVerify.length + effectiveOpenItems.advisories.length}
                    </span>
                  </div>
                  {effectiveOpenItems.placeholders.length > 0 && (
                    <div className="dw-group">
                      <div className="dw-group-title">Placeholders to fill</div>
                      <ul className="dw-items">{effectiveOpenItems.placeholders.map((p) => <li key={p}>{p}</li>)}</ul>
                    </div>
                  )}
                  {effectiveOpenItems.toVerify.length > 0 && (
                    <div className="dw-group">
                      <div className="dw-group-title">Sections to verify</div>
                      <ul className="dw-items">{effectiveOpenItems.toVerify.map((s) => <li key={s}>{s}</li>)}</ul>
                    </div>
                  )}
                  {effectiveOpenItems.advisories.length > 0 && (
                    <div className="dw-group">
                      <div className="dw-group-title">Confirm before filing</div>
                      <ul className="dw-items">{effectiveOpenItems.advisories.map((a) => <li key={a}>{a}</li>)}</ul>
                    </div>
                  )}
                  <p className="dc-card-text">Kept here, not in the document, so nothing incomplete is filed by accident.</p>
                </section>
              )}

              {/* SANHITA 2023 */}
              {(bnsConcordance.length > 0 || staleChips.length > 0) && (
                <section className="dc-card">
                  <div className="dc-eyebrow">Sanhita 2023 (BNS / BNSS / BSA)</div>
                  {bnsConcordance.length > 0 && (
                    <div className="dw-group">
                      <div className="dw-group-title">Applied · {bnsConcordance.length}</div>
                      <ul className="dw-items dw-items--plain">
                        {bnsConcordance.map((e) => (
                          <li key={e.old}>
                            <span className="dw-old">{e.old}</span> → <strong>{e.new}</strong>
                            {e.change && e.change !== 'Renumbered only' && <span className="dw-note"> · {e.change}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {staleChips.length > 0 && (
                    <div className="dw-group">
                      <div className="dw-group-title">Old references found · {staleChips.length}</div>
                      <div className="dw-chips">
                        {staleChips.map((chip) => (
                          <button
                            key={chip.key}
                            type="button"
                            className="dw-replace"
                            onClick={() => applySanhitaReplacement(chip)}
                            title={/unverified/i.test(chip.substantiveChange)
                              ? 'Mapping marked UNVERIFIED - counsel review required'
                              : chip.substantiveChange || 'Renumbered only'}
                          >
                            <span className="mono">{chip.fromAct} §{chip.fromSection}</span>
                            <span>→</span>
                            <span className="mono"><strong>{chip.toAct} §{chip.toSection}</strong></span>
                            {chip.count > 1 && <span className="dw-note">×{chip.count}</span>}
                            <span className="dw-replace-cta">Replace</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="dc-card-text">Suggested mappings are plausibility-grade; verify against the bare Act.</p>
                </section>
              )}

              {/* SHARE */}
              <section className="dc-card">
                <div className="dc-eyebrow">Share</div>
                <button
                  className="btn dw-wide"
                  type="button"
                  title="Email this draft to the client for review"
                  onClick={() => {
                    const subject = `${activeDocType} - ${draftDate}`;
                    const text = htmlToPlainText(displayHtml);
                    const body = `Dear Sir/Madam,\n\nPlease find below the draft of the ${activeDocType.toLowerCase()} for your review.\n\n---\n\n${text}\n\n---\n\nKindly revert with your comments.\n\nRegards,`;
                    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                    showToast({ type: 'sage', text: 'Mail client opened with draft attached' });
                  }}
                >
                  <Icon name="mail" size={14} /> Email to client for review
                </button>
              </section>
            </aside>
          )}
        </div>
      </div>
      )}

      <style>{`
        /* Inline letterhead picker in the download toolbar. Kept compact and
           label-beside-select so it reads as one control among the buttons
           rather than a full-width form row. */
        .draft-inline-letterhead {
          flex-direction: row !important;
          align-items: center;
          gap: 6px !important;
        }
        .draft-inline-letterhead > .label {
          white-space: nowrap;
          color: var(--text-tertiary);
        }
        .draft-inline-letterhead select {
          min-width: 0 !important;
          width: auto;
          padding-top: 6px;
          padding-bottom: 6px;
        }
        /* STICKY TOP TOOLBAR — the document action tools, pinned to the top of the
           preview column so they stay reachable while scrolling the draft. */
        .draft-toolbar {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 10px;
          margin-bottom: 12px;
          position: sticky;
          top: 8px;
          z-index: 20;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle, rgba(0,0,0,0.08));
          border-radius: 10px;
          box-shadow: var(--shadow-popover);
        }
        .draft-toolbar .spacer { flex: 1 1 auto; }
        .draft-toolbar__sep {
          width: 1px;
          align-self: stretch;
          margin: 2px 2px;
          background: var(--border-subtle, rgba(0,0,0,0.12));
        }
        .draft-toolbar__label { white-space: nowrap; }
        /* Icon-only button: square, centered glyph, tooltip via title=. */
        .btn.btn-icon {
          padding: 8px;
          width: 36px;
          height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .draft-grid {
          display: grid;
          grid-template-columns: minmax(0, 42fr) minmax(0, 58fr);
          gap: 16px;
          transition:
            grid-template-columns 620ms cubic-bezier(0.32, 0.72, 0, 1),
            gap 420ms cubic-bezier(0.32, 0.72, 0, 1);
        }
        /* Auto mode: no form column is rendered, so the grid must be a single
           full-width column — otherwise the lone preview lands in the narrow
           first track and the document collapses to a one-word-wide sliver. */
        .draft-grid--solo {
          grid-template-columns: minmax(0, 1fr);
          gap: 0;
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
          /* Auto mode renders NO form column, so the grid carries both --solo
             and --stage. The two-column --stage rule above would otherwise win
             by source order and drop the lone preview into the second track
             while the phantom first track squeezes it to a one-word sliver.
             Force solo back to a single full-width column at desktop width. */
          .draft-grid--solo,
          .draft-grid--solo.draft-grid--stage {
            grid-template-columns: minmax(0, 1fr);
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
        initialChoice={letterheadChoice}
        onCancel={() => setExportFormat(null)}
        onConfirm={(choice) => {
          // Keep the toolbar control in sync with any change made in the dialog.
          setLetterheadChoice(choice);
          void performExport(choice);
        }}
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

      {/* Choose WHICH engine format to draft — the full engine catalogue (DPC
          pleadings/deeds + TN court forms). Picking one sets the document type,
          which activates the Engine-Routed card for it. */}
      <FormatPickerModal
        open={formatsOpen}
        current={docType}
        onClose={() => setFormatsOpen(false)}
        onOpenBlank={openBlankInEditor}
        onPick={(label, preset, title) => {
          // A draft is on screen: the drafting card is hidden behind it. Starting
          // the new format means leaving that draft, so ask first.
          if (hasOutput || stageMode) {
            if (!window.confirm(`Start a new draft with "${title ?? label}"? The draft on screen will be closed (save it to My drafts first if you need it).`)) return;
            reset();
          }
          setDocType(label);
          setFormatPicked(true);
          setFormatPreset(preset ?? null);
          setFormatTitle(title ?? label);
          window.scrollTo({ top: 0, behavior: 'smooth' });
          setActiveEngineLabel(label);
          // Picking a format opens the DraftBot modal primed for that format.
          setDraftBotOpen(true);
        }}
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

// `Field` (the per-type input) now lives in components/DraftField.tsx so it can
// be shared with the post-generation completion panel (DraftMissingFields).

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
