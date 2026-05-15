import { useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '@lexdraft/ui';
import {
  useAssignableUsers,
  useCreateReview,
  useCreateReviewComment,
  useDeleteReview,
  useDeleteReviewComment,
  useReview,
  useReviewComments,
  useReviews,
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

const TOKEN_TO_BADGE: Record<StatusToken, string> = {
  danger: 'badge-vermillion',
  warning: 'badge-amber',
  info: 'badge-cobalt',
  success: 'badge-sage',
};

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

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setParseHint('Extracting text…');
    try {
      const text = await extractDocumentText(file);
      setSourceText(text);
      setParseHint(null);
      if (step < 2) setStep(2);
    } catch (err) {
      if (err instanceof UnsupportedFileError) {
        setParseHint(err.message);
        if (step < 2) setStep(2);
        return;
      }
      setParseHint(null);
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
    if (sourceText.trim().length < 50) {
      showToast({
        type: 'amber',
        text: 'Paste at least a few paragraphs of contract text first.',
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
    <div className="col stagger" style={{ gap: 24 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 className="heading-xl" style={{ marginBottom: 4 }}>
            Contract Review
          </h1>
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            UPLOAD · CHOOSE PERSPECTIVE · GET RISK SCORE
          </div>
        </div>
        {step === 3 && (
          <button className="btn btn-ghost" onClick={reset}>
            <Icon name="plus" size={14} /> New review
          </button>
        )}
      </div>

      {/* Step 1 - upload / paste */}
      {step < 3 && (
        <div className="col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 12 }}>
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: step >= 1 ? 'var(--text-primary)' : 'var(--text-tertiary)',
              }}
            >
              STEP 01
            </span>
            <div className="heading-lg">Upload contract</div>
            {fileName && <span className="badge badge-sage">{fileName}</span>}
          </div>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            style={{
              border: '2px dashed var(--border-strong)',
              borderRadius: 'var(--radius-lg)',
              padding: 32,
              textAlign: 'center',
              background: fileName ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
              cursor: 'pointer',
              transition: 'all 150ms',
            }}
          >
            <Icon name="upload" size={32} className="muted" />
            <div className="heading-lg" style={{ marginTop: 12, marginBottom: 4 }}>
              {fileName ?? 'Drop a contract here'}
            </div>
            <p className="body-md muted" style={{ marginBottom: 16 }}>
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
            <div
              className="card"
              style={{
                background: 'var(--info-bg, var(--bg-surface-2))',
                borderLeft: '3px solid var(--info)',
                padding: 12,
                fontSize: 13,
              }}
            >
              {parseHint}
            </div>
          )}
          <label className="col" style={{ gap: 6 }}>
            <span className="label">Or paste contract text</span>
            <textarea
              className="input"
              rows={10}
              value={sourceText}
              placeholder="Paste the contract body here. The model reads up to ~120KB; longer documents are truncated."
              onChange={(e) => setSourceText(e.target.value)}
              style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, lineHeight: 1.5 }}
            />
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {sourceText.length.toLocaleString()} chars
            </div>
          </label>
        </div>
      )}

      {/* Step 2 - perspective */}
      {step >= 2 && step < 3 && (
        <div className="col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-primary)' }}>
              STEP 02
            </span>
            <div className="heading-lg">Whose side are you on?</div>
          </div>
          <div className="grid-4">
            {PERSPECTIVES.map((p) => {
              const activeOpt = perspective === p;
              return (
                <button
                  key={p}
                  className="card card-hover"
                  onClick={() => setPerspective(p)}
                  style={{
                    padding: 22,
                    textAlign: 'center',
                    background: activeOpt ? 'var(--text-primary)' : 'var(--bg-surface)',
                    color: activeOpt ? 'var(--bg-base)' : 'var(--text-primary)',
                    borderColor: activeOpt ? 'var(--text-primary)' : 'var(--border-default)',
                    cursor: 'pointer',
                  }}
                >
                  <div className="heading-md" style={{ color: 'inherit', marginBottom: 4 }}>
                    {p}
                  </div>
                  <div className="mono" style={{ fontSize: 10, opacity: 0.6 }}>
                    REPRESENT
                  </div>
                </button>
              );
            })}
          </div>
          {perspective && (
            <button
              className="btn btn-primary btn-lg"
              onClick={analyze}
              disabled={createReview.isPending}
              style={{ alignSelf: 'flex-start' }}
            >
              {createReview.isPending ? 'Sending…' : 'Analyze contract'}{' '}
              <Icon name="arrow" size={14} />
            </button>
          )}
        </div>
      )}

      {/* Step 3 - results */}
      {step === 3 && (
        <div className="col" style={{ gap: 20 }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-primary)' }}>
              STEP 03
            </span>
            <div className="heading-lg">
              Results
              {active && ` · ${active.perspective} perspective`}
            </div>
          </div>

          {isAnalyzing && (
            <div className="card" style={{ padding: 60, textAlign: 'center' }}>
              <div className="heading-lg" style={{ marginBottom: 8 }}>
                Analyzing
                <span className="blink" />
              </div>
              <p className="body-md muted">
                The model is reading the contract and cross-referencing Indian law. This usually
                takes 10-30 seconds.
              </p>
            </div>
          )}

          {isFailed && active && (
            <div
              className="card"
              style={{
                borderLeft: '3px solid var(--danger)',
                padding: 20,
              }}
            >
              <div className="heading-md" style={{ marginBottom: 6 }}>
                Review failed
              </div>
              <p className="body-sm muted" style={{ marginBottom: 12 }}>
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
                <div
                  className="card"
                  style={{
                    background: 'var(--bg-surface-2)',
                    borderLeft: '3px solid var(--warning)',
                    padding: 12,
                    fontSize: 13,
                  }}
                >
                  Demonstration only - no LLM provider configured on this server. The findings
                  below are illustrative.
                </div>
              )}

              <div
                className="card results-head"
                style={{
                  padding: 32,
                  display: 'grid',
                  gridTemplateColumns: '200px 1fr',
                  gap: 32,
                  alignItems: 'center',
                }}
              >
                <RiskGauge score={score ?? 0} />
                <div>
                  <div
                    className="mono"
                    style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}
                  >
                    RISK SCORE
                  </div>
                  <div
                    className="row"
                    style={{ alignItems: 'baseline', gap: 8, marginBottom: 14 }}
                  >
                    <span className="mono tabular" style={{ fontSize: 64, fontWeight: 400 }}>
                      {score ?? '-'}
                    </span>
                    <span
                      className="mono"
                      style={{ fontSize: 16, color: 'var(--text-tertiary)' }}
                    >
                      /100
                    </span>
                    <span className={`badge ${TOKEN_TO_BADGE[risk.token]}`} style={{ marginLeft: 8 }}>
                      {risk.label}
                    </span>
                  </div>
                  {active.summary && (
                    <p className="body-md" style={{ lineHeight: 1.6 }}>
                      {active.summary}
                    </p>
                  )}
                </div>
              </div>

              <div
                style={{
                  borderBottom: '1px solid var(--border-default)',
                  overflowX: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div className="row" style={{ gap: 0, minWidth: 'min-content' }}>
                  {tabs.map((t) => {
                    const isActive = resultTab === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setResultTab(t.id)}
                        style={{
                          padding: '14px 16px',
                          fontSize: 13,
                          fontWeight: 500,
                          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                          background: 'transparent',
                          border: 0,
                          borderBottom: `2px solid ${
                            isActive ? 'var(--text-primary)' : 'transparent'
                          }`,
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                        }}
                      >
                        {t.label}{' '}
                        <span
                          className="mono"
                          style={{
                            marginLeft: 6,
                            color: `var(--${t.token})`,
                            fontSize: 11,
                          }}
                        >
                          {t.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* Card vs redline toggle. Redline mode lays each finding out
                    as before/after columns so the rewrite is comparable at a
                    glance - the card view keeps the comment threads & details. */}
                <div
                  className="row"
                  style={{
                    gap: 0,
                    padding: 2,
                    background: 'var(--bg-surface-2)',
                    borderRadius: 'var(--radius-md)',
                    marginRight: 4,
                  }}
                >
                  <button
                    onClick={() => setRedlineMode(false)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: !redlineMode ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      background: !redlineMode ? 'var(--bg-surface)' : 'transparent',
                      border: 0,
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    Cards
                  </button>
                  <button
                    onClick={() => setRedlineMode(true)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 500,
                      color: redlineMode ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      background: redlineMode ? 'var(--bg-surface)' : 'transparent',
                      border: 0,
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                    }}
                  >
                    Redline
                  </button>
                </div>
              </div>

              <WorkflowStrip review={active} />

              <div className="col" style={{ gap: 12 }}>
                {findings[resultTab].length === 0 ? (
                  <div className="card" style={{ padding: 20, color: 'var(--text-tertiary)' }}>
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

          <style>{`@media (max-width: 767px) { .results-head { grid-template-columns: 1fr !important; text-align: center; } }`}</style>
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
    <div className="col" style={{ gap: 12 }}>
      <div className="heading-md">Prior reviews</div>
      <div className="col" style={{ gap: 8 }}>
        {items.slice(0, 10).map((r) => {
          const risk = riskLabel(r.riskScore);
          const isActive = r.id === activeId;
          return (
            <div
              key={r.id}
              className="card"
              style={{
                padding: 14,
                borderLeft: isActive
                  ? '3px solid var(--text-primary)'
                  : '3px solid transparent',
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <button
                onClick={() => onOpen(r.id)}
                style={{
                  background: 'transparent',
                  border: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <div style={{ fontWeight: 500, marginBottom: 2 }}>{r.title}</div>
                <div
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--text-tertiary)' }}
                >
                  {r.perspective.toUpperCase()} · {new Date(r.createdAt).toLocaleString()}
                </div>
              </button>
              <span className="mono" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                {r.status === 'completed' ? `${r.riskScore ?? '-'}/100` : r.status.toUpperCase()}
              </span>
              <span className={`badge ${TOKEN_TO_BADGE[risk.token]}`}>{risk.label}</span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void onRemove(r.id)}
                title="Remove this review"
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RiskGauge({ score }: { score: number }) {
  const r = 70;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - score / 100);
  const stroke =
    score < 40 ? 'var(--success)' : score < 70 ? 'var(--warning)' : 'var(--danger)';
  return (
    <svg
      width="160"
      height="160"
      viewBox="0 0 160 160"
      style={{ transform: 'rotate(-90deg)' }}
      aria-label={`Risk score ${score} of 100`}
    >
      <circle cx="80" cy="80" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="6" />
      <circle
        cx="80"
        cy="80"
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="6"
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
    <div
      className="card redline-row"
      style={{
        borderLeft: `3px solid var(--${token})`,
        padding: 16,
        display: 'grid',
        gap: 12,
      }}
    >
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className={`badge ${badgeClass}`}>{finding.severity.toUpperCase()}</span>
        {finding.law && <span className="badge">{finding.law}</span>}
        <span className="heading-md" style={{ fontWeight: 500 }}>
          {finding.title}
        </span>
      </div>
      <div
        className="redline-cols"
        style={{
          display: 'grid',
          gridTemplateColumns: hasExcerpt ? '1fr 1fr' : '1fr',
          gap: 12,
        }}
      >
        {hasExcerpt && (
          <div>
            <div
              className="mono"
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary)',
                marginBottom: 6,
              }}
            >
              ORIGINAL
            </div>
            <blockquote
              className="mono"
              style={{
                background: 'var(--bg-surface-2)',
                padding: 12,
                fontSize: 12,
                lineHeight: 1.6,
                borderLeft: '2px solid var(--danger)',
                borderRadius: 'var(--radius-sm)',
                margin: 0,
                whiteSpace: 'pre-wrap',
                textDecoration: 'line-through',
                textDecorationColor: 'var(--danger)',
                textDecorationThickness: '1px',
                opacity: 0.85,
              }}
            >
              {finding.excerpt}
            </blockquote>
          </div>
        )}
        <div>
          <div
            className="mono"
            style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 6 }}
          >
            {hasExcerpt ? 'SUGGESTED REWRITE' : 'MISSING CLAUSE - ADD'}
          </div>
          <div
            className="body-sm"
            style={{
              background: 'var(--success-bg, var(--bg-surface-2))',
              padding: 12,
              fontSize: 13,
              lineHeight: 1.6,
              borderLeft: '2px solid var(--success)',
              borderRadius: 'var(--radius-sm)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {finding.suggestion || '-'}
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 767px) { .redline-cols { grid-template-columns: 1fr !important; } }`}</style>
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
    <div className="card" style={{ borderLeft: `3px solid var(--${token})`, padding: 20 }}>
      <div className="row" style={{ marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
        <span className={`badge ${badgeClass}`}>{finding.severity.toUpperCase()}</span>
        {finding.law && <span className="badge">{finding.law}</span>}
        <span className="spacer" />
      </div>
      <div className="heading-md" style={{ marginBottom: 10 }}>
        {finding.title}
      </div>
      {finding.excerpt && (
        <blockquote
          className="mono"
          style={{
            background: 'var(--bg-surface-2)',
            padding: 12,
            fontSize: 12,
            lineHeight: 1.6,
            borderLeft: '2px solid var(--border-strong)',
            borderRadius: 'var(--radius-sm)',
            marginBottom: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          {finding.excerpt}
        </blockquote>
      )}
      <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
        {finding.suggestion && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setOpen(!open)}
            style={{ padding: 0 }}
          >
            <Icon name={open ? 'chevronD' : 'chevron'} size={14} /> Suggested redline
          </button>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setCommentsOpen((v) => !v)}
          style={{ padding: 0 }}
        >
          <Icon name={commentsOpen ? 'chevronD' : 'chevron'} size={14} /> Comments
          {visibleCount > 0 && (
            <span className="mono" style={{ marginLeft: 6, color: 'var(--text-tertiary)' }}>
              ({visibleCount})
            </span>
          )}
        </button>
      </div>
      {open && finding.suggestion && (
        <div
          className="body-sm"
          style={{
            background: 'var(--success-bg)',
            color: 'var(--text-primary)',
            padding: 14,
            lineHeight: 1.6,
            marginTop: 10,
            borderLeft: '2px solid var(--success)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {finding.suggestion}
        </div>
      )}
      {commentsOpen && (
        <div style={{ marginTop: 12 }}>
          <CommentThread
            reviewId={reviewId}
            findingIndex={findingIndex}
            comments={findingComments}
            loading={commentsQuery.isLoading}
          />
        </div>
      )}
    </div>
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
    <div
      className="card"
      style={{
        padding: 16,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gap: 16,
        alignItems: 'center',
      }}
    >
      <span className={`badge ${TOKEN_TO_BADGE[meta.token]}`}>{meta.label}</span>

      <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          REVIEWER
        </span>
        <select
          className="input"
          value={review.assignedTo?.id ?? ''}
          onChange={(e) => void handleAssign(e.target.value)}
          disabled={update.isPending || usersQuery.isLoading}
          style={{ minWidth: 220 }}
        >
          <option value="">Unassigned</option>
          {(usersQuery.data?.items ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name || u.email} {u.id === currentUserId ? '(you)' : ''}
            </option>
          ))}
        </select>
        {review.decidedBy && review.decidedAt && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            decided by {review.decidedBy.name || review.decidedBy.email} ·{' '}
            {new Date(review.decidedAt).toLocaleString()}
          </span>
        )}
      </div>

      <div className="row" style={{ gap: 8 }}>
        {review.decision === 'approved' || review.decision === 'changes_requested' ? (
          <button
            className="btn btn-ghost btn-sm"
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
              Approve
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
    <div className="col" style={{ gap: 12, marginTop: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <div className="heading-md">Discussion</div>
        {visibleCount > 0 && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
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
    </div>
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
    <div className="col" style={{ gap: 8 }}>
      {loading && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          Loading…
        </div>
      )}
      {!loading && roots.length === 0 && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          No comments yet.
        </div>
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
      <div className="row" style={{ gap: 8, marginTop: 4 }}>
        <input
          className="input"
          placeholder={findingIndex === null ? 'Add a comment…' : 'Reply to this clause…'}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void handleAdd();
          }}
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-sm"
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

function CommentNode({ comment, replies, currentUserId, onEdit, onDelete }: CommentNodeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const isAuthor = !!currentUserId && comment.author?.id === currentUserId;
  const ts = new Date(comment.createdAt).toLocaleString();
  const edited = comment.updatedAt !== comment.createdAt;

  return (
    <div className="card" style={{ padding: 12, background: 'var(--bg-surface-2)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
        <strong style={{ fontSize: 13 }}>
          {comment.author?.name || comment.author?.email || 'Unknown'}
        </strong>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          {ts}
          {edited && !comment.isDeleted && ' · edited'}
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        {isAuthor && !comment.isDeleted && (
          <>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setEditing((v) => !v);
                setDraft(comment.body);
              }}
              style={{ padding: 0 }}
            >
              {editing ? 'Cancel' : 'Edit'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void onDelete(comment.id)}
              style={{ padding: 0 }}
            >
              Delete
            </button>
          </>
        )}
      </div>
      {comment.isDeleted ? (
        <div className="body-sm" style={{ marginTop: 6, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
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
        <div className="body-sm" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
          {comment.body}
        </div>
      )}
      {replies.length > 0 && (
        <div className="col" style={{ gap: 6, marginTop: 8, marginLeft: 16 }}>
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
  );
}
