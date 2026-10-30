import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import { LawSidePanel } from '@/components/LawSidePanel';
import { PageHeader } from '@/components/PageHeader';
import {
  useAssignableUsers,
  useCreateReview,
  useCreateReviewComment,
  useDeleteReview,
  useDeleteReviewComment,
  useReview,
  useReviewComments,
  useReviews,
  useExtractContractText,
  useUpdateReviewComment,
  useUpdateReviewLifecycle,
  type ContractReview,
  type ContractReviewFinding,
  type ReviewComment,
  type ReviewDecision,
  type ReviewPerspective,
  type ReviewSeverity,
} from '@/hooks/useReview';
import { extractDocumentText, UnsupportedFileError } from '@/lib/extract-doc-text';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';

type ResultTab =
  | 'critical' // groups Critical + High
  | 'moderate'
  | 'missing'
  | 'negotiable'
  | 'standard';

const PERSPECTIVES: ReadonlyArray<ReviewPerspective> = [
  'Client',
  'Vendor',
  'Employer',
  'Employee',
  'Landlord',
  'Tenant',
  'Company',
];

type StatusToken = 'success' | 'warning' | 'danger' | 'info';

const SEVERITY_TOKEN: Record<ReviewSeverity, StatusToken> = {
  Critical: 'danger',
  High: 'danger',
  Moderate: 'warning',
  Missing: 'info',
  Negotiable: 'info',
  Standard: 'success',
};

// Strictly black & white: severity is carried by weight, never colour.
// Ink-filled = most serious, outline = moderate, dashed = absent/open, plain = fine.
const TOKEN_TO_BADGE: Record<StatusToken, string> = {
  danger: 'ai-pill ai-pill--solid',
  warning: 'ai-pill ai-pill--outline',
  info: 'ai-pill ai-pill--dashed',
  success: 'ai-pill',
};

function StepHead({ n, title, done, children }: { n: number; title: string; done?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`ai-step-head${done ? ' is-done' : ''}`}>
      <span className="ai-step-num" aria-hidden>{done ? <Icon name="check" size={13} /> : n}</span>
      <div className="ai-step-text">
        <span className="ai-eyebrow">Step {n} of 3</span>
        <h2 className="ai-step-title">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function bucketOf(sev: ReviewSeverity): ResultTab {
  if (sev === 'Critical' || sev === 'High') return 'critical';
  if (sev === 'Moderate') return 'moderate';
  if (sev === 'Missing') return 'missing';
  if (sev === 'Negotiable') return 'negotiable';
  return 'standard';
}

interface IndexedFinding {
  finding: ContractReviewFinding;
  /** Position in the original findings[] array - the key used to anchor
   *  per-finding comments on the server. */
  index: number;
}

function groupFindings(findings: ContractReviewFinding[]): Record<ResultTab, IndexedFinding[]> {
  const out: Record<ResultTab, IndexedFinding[]> = {
    critical: [],
    moderate: [],
    missing: [],
    negotiable: [],
    standard: [],
  };
  findings.forEach((finding, index) => {
    out[bucketOf(finding.severity)].push({ finding, index });
  });
  return out;
}

function riskLabel(score: number | null): { token: StatusToken; label: string } {
  if (score === null) return { token: 'info', label: 'PENDING' };
  if (score >= 70) return { token: 'danger', label: 'HIGH RISK' };
  if (score >= 40) return { token: 'warning', label: 'MODERATE RISK' };
  return { token: 'success', label: 'LOW RISK' };
}

function decisionMeta(d: ReviewDecision | null): { token: StatusToken; label: string } {
  if (d === 'approved') return { token: 'success', label: 'APPROVED' };
  if (d === 'changes_requested') return { token: 'danger', label: 'CHANGES REQUESTED' };
  if (d === 'pending') return { token: 'warning', label: 'IN REVIEW' };
  return { token: 'info', label: 'NEEDS REVIEWER' };
}

export function ContractReviewView() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [perspective, setPerspective] = useState<ReviewPerspective | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>('critical');
  const [redlineMode, setRedlineMode] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState('');
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [parseHint, setParseHint] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link: `/app/review?id=…` hydrates straight to step 3 with the
  // referenced review pre-selected. The queue view links here that way.
  useEffect(() => {
    const idParam = searchParams.get('id');
    if (idParam && idParam !== activeReviewId) {
      setActiveReviewId(idParam);
      setStep(3);
    }
    // We only want this to react to URL changes, not to local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const showToast = useUIStore((s) => s.showToast);
  const createReview = useCreateReview();
  const extractDocument = useExtractContractText();
  const deleteReview = useDeleteReview();
  const reviewsQuery = useReviews();
  // After a fresh create, prefer the local result; otherwise hydrate from
  // the detail endpoint so deep-links / history clicks rehydrate the panel.
  const detailQuery = useReview(activeReviewId);
  const active: ContractReview | null =
    (detailQuery.data as ContractReview | undefined) ?? null;

  // When the user types into the paste box, that's effectively the same as
  // a file selection - promote to step 2 so the perspective picker appears.
  useEffect(() => {
    if (sourceText.trim().length > 200 && step === 1) setStep(2);
  }, [sourceText, step]);

  // Minimum characters we treat as "real" extracted content. A scanned /
  // image-only PDF has no text layer, so the in-browser pdfjs pass returns
  // roughly nothing - below this threshold we hand the raw file to the server
  // for an OCR pass instead of dead-ending on the "paste text" hint.
  const MIN_USABLE_CHARS = 50;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setParseHint('Extracting text…');
    try {
      // First try the fast, private, in-browser extraction (text-layer PDFs,
      // DOCX, plain text).
      let text = '';
      try {
        text = await extractDocumentText(file);
      } catch (err) {
        // UnsupportedFileError from the browser extractor isn't fatal for PDFs
        // - fall through to the server OCR attempt below. Re-throw anything
        // else (e.g. a genuinely corrupt file) to the outer catch.
        if (!(err instanceof UnsupportedFileError)) throw err;
      }

      // Scanned PDF (or any file the browser couldn't read): rasterise + OCR
      // on the server. This is the path that fixes an attached scanned offer
      // letter producing the "paste at least a few paragraphs" popup.
      if (text.trim().length < MIN_USABLE_CHARS) {
        setParseHint('No text layer found. Running OCR on the scanned document…');
        const result = await extractDocument.mutateAsync(file);
        text = result.text;
      }

      setSourceText(text);
      setParseHint(null);
      // A readable file is the same signal as a paste: advance to the
      // perspective picker so the user's next click runs the analysis.
      if (step < 2) setStep(2);
    } catch (err) {
      setParseHint(null);
      setFileName(null);
      showToast({
        type: 'vermillion',
        text: err instanceof Error ? err.message : 'Could not read file',
      });
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    void handleFile(e.dataTransfer?.files?.[0]);
  };
  const onBrowse = (e: ChangeEvent<HTMLInputElement>) => {
    void handleFile(e.target.files?.[0] ?? undefined);
  };

  const analyze = async () => {
    if (!perspective) return;
    // Safety net only. A dropped file now populates sourceText via
    // extraction/OCR before we ever reach here, so this fires only when the
    // user landed on step 2 with an genuinely empty paste box.
    if (sourceText.trim().length < 50) {
      showToast({
        type: 'amber',
        text: fileName
          ? 'We couldn’t read enough text from that file. Paste the contract text to continue.'
          : 'Paste at least a few paragraphs of contract text first.',
      });
      return;
    }
    setStep(3);
    try {
      const created = await createReview.mutateAsync({
        perspective,
        sourceText: sourceText,
        ...(fileName ? { sourceFilename: fileName } : {}),
      });
      setActiveReviewId(created.id);
      setResultTab('critical');
      if (created.status === 'failed') {
        showToast({
          type: 'vermillion',
          text: created.errorMessage ?? 'Review failed',
        });
      } else if (created.provider === 'none') {
        showToast({
          type: 'cobalt',
          text: 'Demonstration only - no LLM provider configured. Findings shown are illustrative.',
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Review request failed';
      showToast({ type: 'vermillion', text: message });
    }
  };

  const reset = () => {
    setStep(1);
    setPerspective(null);
    setFileName(null);
    setSourceText('');
    setActiveReviewId(null);
    setParseHint(null);
  };

  const openHistory = (id: string) => {
    setActiveReviewId(id);
    setStep(3);
  };

  const removeReview = async (id: string) => {
    try {
      await deleteReview.mutateAsync(id);
      if (activeReviewId === id) reset();
      showToast({ type: 'sage', text: 'Review removed' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not remove review';
      showToast({ type: 'vermillion', text: message });
    }
  };

  const findings = active ? groupFindings(active.findings) : null;
  const tabs: ReadonlyArray<{ id: ResultTab; label: string; count: number; token: StatusToken }> =
    findings
      ? [
          { id: 'critical', label: 'Critical & High', count: findings.critical.length, token: 'danger' },
          { id: 'moderate', label: 'Moderate', count: findings.moderate.length, token: 'warning' },
          { id: 'missing', label: 'Missing', count: findings.missing.length, token: 'info' },
          { id: 'negotiable', label: 'Negotiable', count: findings.negotiable.length, token: 'info' },
          { id: 'standard', label: 'Standard', count: findings.standard.length, token: 'success' },
        ]
      : [];

  const isAnalyzing = createReview.isPending || active?.status === 'analyzing';
  const isFailed = active?.status === 'failed';
  const score = active?.riskScore ?? null;
  const risk = riskLabel(score);


  return (
    <div
      style={{ gap: 24 }}
      className={sourceText.trim() ? 'ai-review contract-review-layout split-2' : 'ai-review contract-review-layout'}
    >
    <div className="col stagger" style={{ gap: 28, minWidth: 0 }}>
      <PageHeader
        title="Contract Review"
        description="Upload a contract, choose your side, and get a clause-by-clause risk score."
        actions={step === 3 ? (
          <button className="btn" onClick={reset}>
            <Icon name="plus" size={14} /> New review
          </button>
        ) : undefined}
      />

      {/* Step 1 - upload / paste */}
      {step < 3 && (
        <section className="ai-panel ai-review-step">
          <StepHead n={1} title="Upload contract" done={step >= 2}>
            {fileName && (
              <span className="ai-file-chip" title={fileName}>
                <Icon name="file" size={12} /> <span>{fileName}</span>
              </span>
            )}
          </StepHead>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className={`ai-drop${fileName ? ' has-file' : ''}`}
          >
            <span className="ai-drop-icon" aria-hidden><Icon name="upload" size={20} /></span>
            <div className="ai-drop-title">
              {fileName ?? 'Drop a contract here'}
            </div>
            <p className="ai-drop-hint">
              {fileName
                ? 'Drop another to replace, or edit the text in the box below'
                : 'PDF, DOCX, or plain text - extracted in your browser, never uploaded as-is'}
            </p>
            <label className="btn">
              Browse files
              <input
                type="file"
                hidden
                accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={onBrowse}
              />
            </label>
          </div>
          {parseHint && (
            <div className="ai-note" role="status" aria-live="polite">
              <span className="lex-spinner" aria-hidden />
              <span>{parseHint}</span>
            </div>
          )}
          <label className="ai-field">
            <span className="field-label">Or paste contract text</span>
            <textarea
              className="input ai-review-text"
              rows={10}
              value={sourceText}
              placeholder="Paste the contract body here. The model reads up to ~120KB; longer documents are truncated."
              onChange={(e) => setSourceText(e.target.value)}
            />
            <span className="ai-field-meta">
              {sourceText.length.toLocaleString()} chars
            </span>
          </label>
        </section>
      )}

      {/* Step 2 - perspective */}
      {step >= 2 && step < 3 && (
        <section className="ai-panel ai-review-step">
          <StepHead n={2} title="Whose side are you on?" done={!!perspective} />
          <div className="ai-choices" role="group" aria-label="Perspective">
            {PERSPECTIVES.map((p) => {
              const activeOpt = perspective === p;
              return (
                <button
                  key={p}
                  type="button"
                  className={`ai-choice${activeOpt ? ' is-active' : ''}`}
                  aria-pressed={activeOpt}
                  onClick={() => setPerspective(p)}
                >
                  <span className="ai-choice-kicker">Represent</span>
                  <span className="ai-choice-title">{p}</span>
                </button>
              );
            })}
          </div>
          {perspective && (
            <div className="ai-review-go">
              <button
                className="btn btn-primary btn-lg"
                onClick={analyze}
                disabled={createReview.isPending || extractDocument.isPending}
              >
                {extractDocument.isPending
                  ? 'Reading document…'
                  : createReview.isPending
                    ? 'Sending…'
                    : 'Analyze contract'}{' '}
                <Icon name="arrow" size={14} />
              </button>
              <span className="ai-review-go-note">
                Reviewing for the <strong>{perspective}</strong> under Indian law.
              </span>
            </div>
          )}
        </section>
      )}

      {/* Step 3 - results */}
      {step === 3 && (
        <div className="col" style={{ gap: 20 }}>
          <StepHead n={3} title={active ? `Results · ${active.perspective} perspective` : 'Results'} />

          {isAnalyzing && (
            <div className="ai-state" role="status" aria-live="polite">
              <span className="lex-spinner lex-spinner-lg" aria-hidden />
              <div className="ai-state-title">
                Analyzing<span className="blink" />
              </div>
              <p className="ai-state-body">
                The model is reading the contract and cross-referencing Indian law. This usually
                takes 10-30 seconds.
              </p>
            </div>
          )}

          {isFailed && active && (
            <div className="ai-state ai-state--alert" role="alert">
              <span className="ai-state-icon" aria-hidden><Icon name="flag" size={18} /></span>
              <div className="ai-state-title">Review failed</div>
              <p className="ai-state-body">
                {active.errorMessage ?? 'The analyzer returned an error.'}
              </p>
              <button className="btn" onClick={reset}>
                Start a new review
              </button>
            </div>
          )}

          {!isAnalyzing && active && active.status === 'completed' && findings && (
            <>
              {active.provider === 'none' && (
                <div className="ai-note">
                  <Icon name="flag" size={14} />
                  <span>
                    Demonstration only - no LLM provider configured on this server. The findings
                    below are illustrative.
                  </span>
                </div>
              )}

              <div className="ai-panel ai-risk">
                <div className="ai-risk-gauge">
                  <RiskGauge score={score ?? 0} />
                  <div className="ai-risk-num">
                    <span className="ai-figure">{score ?? '-'}</span>
                    <small>/ 100</small>
                  </div>
                </div>
                <div className="ai-risk-body">
                  <div className="ai-risk-top">
                    <span className="ai-eyebrow">Risk score</span>
                    <span className={`badge ${TOKEN_TO_BADGE[risk.token]}`}>{risk.label}</span>
                  </div>
                  <h3 className="ai-risk-title">{active.title}</h3>
                  {active.summary && (
                    <p className="ai-risk-summary">
                      {active.summary}
                    </p>
                  )}
                  <dl className="ai-risk-counts">
                    {tabs.map((t) => (
                      <div key={t.id}>
                        <dt>{t.label}</dt>
                        <dd>{t.count}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>

              <WorkflowStrip review={active} />

              <div className="ai-tabbar">
                <div className="ai-tabs" role="tablist" aria-label="Findings by severity">
                  {tabs.map((t) => {
                    const isActive = resultTab === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`ai-tab${isActive ? ' is-active' : ''}`}
                        onClick={() => setResultTab(t.id)}
                      >
                        {t.label}
                        <span className="ai-tab-count">{t.count}</span>
                      </button>
                    );
                  })}
                </div>
                {/* Card vs redline toggle. Redline mode lays each finding out
                    as before/after columns so the rewrite is comparable at a
                    glance - the card view keeps the comment threads & details. */}
                <div className="ai-seg ai-seg--sm" role="group" aria-label="View">
                  <button type="button" className={!redlineMode ? 'active' : ''} aria-pressed={!redlineMode} onClick={() => setRedlineMode(false)}>
                    Cards
                  </button>
                  <button type="button" className={redlineMode ? 'active' : ''} aria-pressed={redlineMode} onClick={() => setRedlineMode(true)}>
                    Redline
                  </button>
                </div>
              </div>

              <div className="col" style={{ gap: 12 }}>
                {findings[resultTab].length === 0 ? (
                  <div className="ai-empty-line">
                    No findings in this bucket.
                  </div>
                ) : redlineMode ? (
                  findings[resultTab].map(({ finding, index }) => (
                    <RedlineRow
                      key={`redline-${finding.title}-${index}`}
                      finding={finding}
                    />
                  ))
                ) : (
                  findings[resultTab].map(({ finding, index }) => (
                    <ClauseCard
                      key={`${finding.title}-${index}`}
                      finding={finding}
                      findingIndex={index}
                      reviewId={active.id}
                    />
                  ))
                )}
              </div>

              <ReviewDiscussion reviewId={active.id} />
            </>
          )}
        </div>
      )}

      {/* Prior reviews - collapsed when running, expanded otherwise */}
      <HistoryPanel
        items={reviewsQuery.data?.items ?? []}
        loading={reviewsQuery.isLoading}
        activeId={activeReviewId}
        onOpen={openHistory}
        onRemove={removeReview}
      />
    </div>
    {sourceText.trim() && (
      <LawSidePanel
        context={sourceText}
        title="Related authorities"
        k={6}
        debounceMs={800}
      />
    )}
    </div>
  );
}

interface HistoryPanelProps {
  items: Array<{
    id: string;
    title: string;
    perspective: ReviewPerspective;
    status: 'pending' | 'analyzing' | 'completed' | 'failed';
    riskScore: number | null;
    createdAt: string;
  }>;
  loading: boolean;
  activeId: string | null;
  onOpen: (id: string) => void;
  onRemove: (id: string) => Promise<void>;
}

function HistoryPanel({ items, loading, activeId, onOpen, onRemove }: HistoryPanelProps) {
  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section className="col" style={{ gap: 12 }}>
      <div className="ai-section-head">
        <h2 className="ai-section-title ai-section-title--sm">Prior reviews</h2>
        <span className="ai-section-meta">{Math.min(items.length, 10)} most recent</span>
      </div>
      <div className="ai-list">
        {items.slice(0, 10).map((r) => {
          const risk = riskLabel(r.riskScore);
          const isActive = r.id === activeId;
          return (
            <div
              key={r.id}
              className={`ai-list-row ai-history-row${isActive ? ' is-active' : ''}`}
            >
              <button
                type="button"
                className="ai-history-open"
                onClick={() => onOpen(r.id)}
              >
                <span className="ai-list-title">{r.title}</span>
                <span className="ai-list-meta">
                  {r.perspective} · {new Date(r.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </button>
              <span className="ai-history-score">
                {r.status === 'completed'
                  ? <><strong>{r.riskScore ?? '-'}</strong><small>/100</small></>
                  : <small>{r.status.toUpperCase()}</small>}
              </span>
              <span className={`badge ${TOKEN_TO_BADGE[risk.token]}`}>{risk.label}</span>
              <button
                className="btn btn-ghost btn-sm ai-icon-btn"
                onClick={() => void onRemove(r.id)}
                title="Remove this review"
                aria-label={`Remove ${r.title}`}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RiskGauge({ score }: { score: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  return (
    <svg
      width="160"
      height="160"
      viewBox="0 0 160 160"
      style={{ transform: 'rotate(-90deg)' }}
      aria-label={`Risk score ${score} of 100`}
    >
      <circle cx="80" cy="80" r={r} fill="none" stroke="var(--border-subtle)" strokeWidth="8" />
      <circle
        cx="80"
        cy="80"
        r={r}
        fill="none"
        stroke="var(--text-primary)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 1.2s ease-out' }}
      />
    </svg>
  );
}

// ============================================================================
// Redline row - side-by-side before/after for a single finding
// ============================================================================
// Designed as a complement to the card view, not a replacement: it skips
// the comments / redline-toggle affordances so each row stays comparable
// and prints reasonably. Findings of kind "Missing" don't have a left-hand
// excerpt - we render the right column full-width with a "MISSING CLAUSE"
// marker so the reader doesn't have to hunt for context.

function RedlineRow({ finding }: { finding: ContractReviewFinding }) {
  const token = SEVERITY_TOKEN[finding.severity];
  const badgeClass = TOKEN_TO_BADGE[token];
  const hasExcerpt = !!finding.excerpt && finding.excerpt.trim().length > 0;

  return (
    <div className={`ai-finding ai-finding--${token} redline-row`}>
      <div className="ai-finding-top">
        <span className={`badge ${badgeClass}`}>{finding.severity.toUpperCase()}</span>
        {finding.law && <span className="ai-law">{finding.law}</span>}
      </div>
      <h3 className="ai-finding-title">{finding.title}</h3>
      <div className={`redline-cols${hasExcerpt ? ' redline-cols-2' : ''}`} style={{ gap: 12 }}>
        {hasExcerpt && (
          <div>
            <div className="ai-eyebrow" style={{ marginBottom: 6 }}>Original</div>
            <blockquote className="ai-quote ai-quote--struck">
              {finding.excerpt}
            </blockquote>
          </div>
        )}
        <div>
          <div className="ai-eyebrow" style={{ marginBottom: 6 }}>
            {hasExcerpt ? 'Suggested rewrite' : 'Missing clause - add'}
          </div>
          <div className="ai-rewrite">
            {finding.suggestion || '-'}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ClauseCardProps {
  finding: ContractReviewFinding;
  findingIndex: number;
  reviewId: string;
}

function ClauseCard({ finding, findingIndex, reviewId }: ClauseCardProps) {
  const [open, setOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const token = SEVERITY_TOKEN[finding.severity];
  const badgeClass = TOKEN_TO_BADGE[token];
  // We fetch comments lazily - only when the user expands the thread for
  // this finding - to avoid loading hundreds of comments on a long review.
  const commentsQuery = useReviewComments(commentsOpen ? reviewId : null);
  const findingComments = useMemo(
    () =>
      (commentsQuery.data?.items ?? []).filter(
        (c) => c.findingIndex === findingIndex,
      ),
    [commentsQuery.data, findingIndex],
  );
  const visibleCount = findingComments.filter((c) => !c.isDeleted).length;

  return (
    <article className={`ai-finding ai-finding--${token}`}>
      <div className="ai-finding-top">
        <span className={`badge ${badgeClass}`}>{finding.severity.toUpperCase()}</span>
        {finding.law && <span className="ai-law">{finding.law}</span>}
      </div>
      <h3 className="ai-finding-title">
        {finding.title}
      </h3>
      {finding.excerpt && (
        <blockquote className="ai-quote">
          {finding.excerpt}
        </blockquote>
      )}
      <div className="ai-finding-actions">
        {finding.suggestion && (
          <button
            className={`ai-disclose${open ? ' is-open' : ''}`}
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <Icon name={open ? 'chevronD' : 'chevron'} size={14} /> Suggested redline
          </button>
        )}
        <button
          className={`ai-disclose${commentsOpen ? ' is-open' : ''}`}
          onClick={() => setCommentsOpen((v) => !v)}
          aria-expanded={commentsOpen}
        >
          <Icon name={commentsOpen ? 'chevronD' : 'chevron'} size={14} /> Comments
          {visibleCount > 0 && (
            <span className="ai-tab-count">{visibleCount}</span>
          )}
        </button>
      </div>
      {open && finding.suggestion && (
        <div className="ai-rewrite">
          {finding.suggestion}
        </div>
      )}
      {commentsOpen && (
        <div className="ai-finding-thread">
          <CommentThread
            reviewId={reviewId}
            findingIndex={findingIndex}
            comments={findingComments}
            loading={commentsQuery.isLoading}
          />
        </div>
      )}
    </article>
  );
}

// ============================================================================
// Workflow strip - assignee picker + decision actions
// ============================================================================

function WorkflowStrip({ review }: { review: ContractReview }) {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const showToast = useUIStore((s) => s.showToast);
  const usersQuery = useAssignableUsers();
  const update = useUpdateReviewLifecycle();

  const isAssignee = !!currentUserId && review.assignedTo?.id === currentUserId;
  const canDecide = isAssignee || !review.assignedTo;
  const meta = decisionMeta(review.decision);

  const handleAssign = async (userId: string) => {
    try {
      await update.mutateAsync({
        id: review.id,
        patch: { assignedTo: userId || null },
      });
      showToast({ type: 'sage', text: userId ? 'Reviewer assigned' : 'Reviewer cleared' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not assign reviewer';
      showToast({ type: 'vermillion', text: message });
    }
  };

  const handleDecision = async (decision: ReviewDecision | null) => {
    try {
      await update.mutateAsync({ id: review.id, patch: { decision } });
      showToast({
        type: 'sage',
        text:
          decision === 'approved'
            ? 'Review approved'
            : decision === 'changes_requested'
              ? 'Changes requested'
              : 'Decision cleared',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not record decision';
      showToast({ type: 'vermillion', text: message });
    }
  };

  return (
    <div className="ai-workflow">
      <div className="ai-workflow-status">
        <span className="ai-eyebrow">Decision</span>
        <span className={`badge ${TOKEN_TO_BADGE[meta.token]}`}>{meta.label}</span>
      </div>

      <label className="ai-workflow-reviewer">
        <span className="ai-eyebrow">Reviewer</span>
        <select
          className="input"
          value={review.assignedTo?.id ?? ''}
          onChange={(e) => void handleAssign(e.target.value)}
          disabled={update.isPending || usersQuery.isLoading}
        >
          <option value="">Unassigned</option>
          {(usersQuery.data?.items ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name || u.email} {u.id === currentUserId ? '(you)' : ''}
            </option>
          ))}
        </select>
        {review.decidedBy && review.decidedAt && (
          <span className="ai-workflow-decided">
            Decided by {review.decidedBy.name || review.decidedBy.email} ·{' '}
            {new Date(review.decidedAt).toLocaleString()}
          </span>
        )}
      </label>

      <div className="ai-workflow-actions">
        {review.decision === 'approved' || review.decision === 'changes_requested' ? (
          <button
            className="btn btn-sm"
            disabled={update.isPending || !canDecide}
            onClick={() => void handleDecision(null)}
            title={canDecide ? 'Re-open this review' : 'Only the assignee can re-open'}
          >
            Re-open
          </button>
        ) : (
          <>
            <button
              className="btn btn-sm"
              disabled={update.isPending || !canDecide}
              onClick={() => void handleDecision('changes_requested')}
              title={canDecide ? 'Send back with changes' : 'Only the assignee can decide'}
            >
              Request changes
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={update.isPending || !canDecide}
              onClick={() => void handleDecision('approved')}
              title={canDecide ? 'Approve this review' : 'Only the assignee can approve'}
            >
              <Icon name="check" size={13} /> Approve
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Review-level discussion - top-level comments at the bottom of the page
// ============================================================================

function ReviewDiscussion({ reviewId }: { reviewId: string }) {
  const commentsQuery = useReviewComments(reviewId);
  const topLevel = useMemo(
    () => (commentsQuery.data?.items ?? []).filter((c) => c.findingIndex === null),
    [commentsQuery.data],
  );
  const visibleCount = topLevel.filter((c) => !c.isDeleted).length;

  return (
    <section className="ai-panel ai-discussion">
      <div className="ai-section-head">
        <h2 className="ai-section-title ai-section-title--sm">Discussion</h2>
        {visibleCount > 0 && (
          <span className="ai-section-meta">
            {visibleCount} comment{visibleCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <CommentThread
        reviewId={reviewId}
        findingIndex={null}
        comments={topLevel}
        loading={commentsQuery.isLoading}
      />
    </section>
  );
}

// ============================================================================
// Comment thread - shared between per-finding and review-level
// ============================================================================

interface CommentThreadProps {
  reviewId: string;
  /** null = review-level. Otherwise the position in findings[]. */
  findingIndex: number | null;
  comments: ReviewComment[];
  loading: boolean;
}

function CommentThread({ reviewId, findingIndex, comments, loading }: CommentThreadProps) {
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const showToast = useUIStore((s) => s.showToast);
  const createComment = useCreateReviewComment(reviewId);
  const updateComment = useUpdateReviewComment(reviewId);
  const deleteComment = useDeleteReviewComment(reviewId);
  const [body, setBody] = useState('');

  // Build a parent → children index. Single-level threading is the spec; we
  // render replies inline under their parent. Deeper nesting collapses.
  const childrenMap = useMemo(() => {
    const m = new Map<string, ReviewComment[]>();
    for (const c of comments) {
      if (c.parentCommentId) {
        const arr = m.get(c.parentCommentId) ?? [];
        arr.push(c);
        m.set(c.parentCommentId, arr);
      }
    }
    return m;
  }, [comments]);
  const roots = comments.filter((c) => !c.parentCommentId);

  const handleAdd = async () => {
    if (!body.trim()) return;
    try {
      await createComment.mutateAsync({
        body: body.trim(),
        ...(findingIndex !== null ? { findingIndex } : {}),
      });
      setBody('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not post comment';
      showToast({ type: 'vermillion', text: message });
    }
  };

  return (
    <div className="ai-thread">
      {loading && (
        <div className="ai-thread-note">Loading…</div>
      )}
      {!loading && roots.length === 0 && (
        <div className="ai-thread-note">No comments yet.</div>
      )}
      {roots.map((c) => (
        <CommentNode
          key={c.id}
          comment={c}
          replies={childrenMap.get(c.id) ?? []}
          reviewId={reviewId}
          currentUserId={currentUserId}
          onEdit={async (id, next) => {
            try {
              await updateComment.mutateAsync({ commentId: id, body: next });
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Could not edit';
              showToast({ type: 'vermillion', text: message });
            }
          }}
          onDelete={async (id) => {
            try {
              await deleteComment.mutateAsync(id);
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Could not delete';
              showToast({ type: 'vermillion', text: message });
            }
          }}
        />
      ))}
      <div className="ai-composer-row">
        <input
          className="input"
          placeholder={findingIndex === null ? 'Add a comment…' : 'Reply to this clause…'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void handleAdd();
          }}
        />
        <button
          className="btn"
          onClick={() => void handleAdd()}
          disabled={!body.trim() || createComment.isPending}
        >
          {createComment.isPending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}

interface CommentNodeProps {
  comment: ReviewComment;
  replies: ReviewComment[];
  reviewId: string;
  currentUserId: string | null;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

function CommentNode({ comment, replies, currentUserId, onEdit, onDelete }: CommentNodeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const isAuthor = !!currentUserId && comment.author?.id === currentUserId;
  const ts = new Date(comment.createdAt).toLocaleString();
  const edited = comment.updatedAt !== comment.createdAt;
  const authorName = comment.author?.name || comment.author?.email || 'Unknown';

  return (
    <div className="ai-comment">
      <span className="ai-comment-avatar" aria-hidden>{initialsOf(authorName)}</span>
      <div className="ai-comment-main">
        <div className="ai-comment-head">
          <strong>{authorName}</strong>
          <span className="ai-comment-time">
            {ts}
            {edited && !comment.isDeleted && ' · edited'}
          </span>
          <span className="spacer" style={{ flex: 1 }} />
          {isAuthor && !comment.isDeleted && (
            <span className="ai-comment-tools">
              <button
                type="button"
                onClick={() => {
                  setEditing((v) => !v);
                  setDraft(comment.body);
                }}
              >
                {editing ? 'Cancel' : 'Edit'}
              </button>
              <button
                type="button"
                onClick={() => void onDelete(comment.id)}
              >
                Delete
              </button>
            </span>
          )}
        </div>
        {comment.isDeleted ? (
          <div className="ai-comment-body is-removed">
            (comment removed)
          </div>
        ) : editing ? (
          <div className="col" style={{ gap: 6, marginTop: 8 }}>
            <textarea
              className="input"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="row" style={{ gap: 6 }}>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  if (!draft.trim()) return;
                  await onEdit(comment.id, draft.trim());
                  setEditing(false);
                }}
                disabled={!draft.trim()}
              >
                Save
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="ai-comment-body">
            {comment.body}
          </div>
        )}
        {replies.length > 0 && (
          <div className="ai-comment-replies">
            {replies.map((r) => (
              <CommentNode
                key={r.id}
                comment={r}
                replies={[]}
                reviewId={comment.reviewId}
                currentUserId={currentUserId}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
