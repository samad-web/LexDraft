import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Select, type SelectOption } from '@lexdraft/ui';
import { useCases } from '@/hooks/useCases';
import {
  streamTurn,
  useCaseSummary,
  useConcludeMockArgSession,
  useCreateMockArgSession,
  useMockArgSession,
  useMockArgSessions,
  useRerunMockArgReview,
  useUploadMatterFile,
  type CreateSessionInput,
  type MaCitation,
  type MaImprovement,
  type MaInputMode,
  type MaJudgePersona,
  type MaMatterSummary,
  type MaRole,
  type MaSessionWithTurns,
  type MaTurn,
  type MaTurnRating,
} from '@/hooks/useMockArguments';
import {
  getTextOnlyChoice,
  useBrowserCapabilities,
} from '@/hooks/useBrowserCapabilities';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { useTextToSpeech } from '@/hooks/useTextToSpeech';
import { BrowserGate } from '@/components/mock-arguments/BrowserGate';
import { exportMockArgumentSessionPdf } from '@/lib/mock-argument-pdf';
import {
  LANGUAGES,
  findLanguage,
  type LanguageOption,
} from '@/lib/languages';
import { useAuthStore } from '@/store/auth';

// =============================================================================
// MockArgumentsView
//
// Stages: landing → setup → live → review.
//
// Visual polish lives in the .ma-* CSS classes appended to globals.css. The
// view stays monochrome (black-on-white surfaces, status only in tiny dots)
// to match the rest of the LexDraft surface; the one exception is the mic
// "hot" state, which uses --danger because users expect a red signal when a
// microphone is actively recording.
// =============================================================================

type Stage =
  | { kind: 'landing' }
  | { kind: 'setup' }
  // Read-only confirmation screen the user lands on when re-entering an
  // existing active session — shows what they were arguing, in what
  // language, etc., so a quick "is this the right session?" check happens
  // before the mic comes back online.
  | { kind: 'details'; sessionId: string }
  | { kind: 'live'; sessionId: string }
  | { kind: 'review'; sessionId: string };

const ROLES: Array<{ value: MaRole; label: string }> = [
  { value: 'petitioner',  label: 'Petitioner' },
  { value: 'respondent',  label: 'Respondent' },
  { value: 'prosecution', label: 'Prosecution' },
  { value: 'defense',     label: 'Defense' },
  { value: 'appellant',   label: 'Appellant' },
  { value: 'appellee',    label: 'Appellee' },
];

const PERSONAS: Array<{ value: MaJudgePersona; label: string; desc: string }> = [
  { value: 'neutral',  label: 'Neutral',  desc: 'Firm but fair. Probes the weakest assumption.' },
  { value: 'strict',   label: 'Strict',   desc: 'Terse, impatient. Demands precise citations.' },
  { value: 'socratic', label: 'Socratic', desc: 'Pointed questions before stating position.' },
];

const DURATIONS: Array<{ value: number | null; label: string }> = [
  { value: 5 * 60,  label: '5 min' },
  { value: 10 * 60, label: '10 min' },
  { value: 15 * 60, label: '15 min' },
  { value: null,    label: 'Open-ended' },
];

const EMPTY_SUMMARY: MaMatterSummary = {
  title: '',
  court: null,
  parties: { petitioner: null, respondent: null },
  facts: [],
  issues: [],
  applicableStatutes: [],
  priorJudgments: [],
};

// ---------------------------------------------------------------------------

export function MockArgumentsView(): JSX.Element {
  const [stage, setStage] = useState<Stage>({ kind: 'landing' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {stage.kind === 'landing' && (
        <Landing
          onStart={() => setStage({ kind: 'setup' })}
          onResume={(id) => setStage({ kind: 'details', sessionId: id })}
          onReview={(id) => setStage({ kind: 'review', sessionId: id })}
        />
      )}
      {stage.kind === 'setup' && (
        <Setup
          onCancel={() => setStage({ kind: 'landing' })}
          onCreated={(id) => setStage({ kind: 'live', sessionId: id })}
        />
      )}
      {stage.kind === 'details' && (
        <SessionDetails
          sessionId={stage.sessionId}
          onBack={() => setStage({ kind: 'landing' })}
          onContinue={(id) => setStage({ kind: 'live', sessionId: id })}
        />
      )}
      {stage.kind === 'live' && (
        <Live
          sessionId={stage.sessionId}
          onConcluded={(id) => setStage({ kind: 'review', sessionId: id })}
          onAbandon={() => setStage({ kind: 'landing' })}
        />
      )}
      {stage.kind === 'review' && (
        <Review
          sessionId={stage.sessionId}
          onBack={() => setStage({ kind: 'landing' })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

function Landing(props: {
  onStart: () => void;
  onResume: (sessionId: string) => void;
  onReview: (sessionId: string) => void;
}): JSX.Element {
  const sessions = useMockArgSessions();
  const items = sessions.data?.items ?? [];
  const caps = useBrowserCapabilities();
  // The BrowserGate's "Continue in text-only mode" button persists the
  // choice in localStorage. If the user has already accepted it we don't
  // render the gate again — `gateDismissed` mirrors that state.
  const [gateDismissed, setGateDismissed] = useState(() => getTextOnlyChoice());

  const concluded = items.filter((s) => s.status === 'concluded' && s.overallScore != null);
  const avgScore = concluded.length === 0
    ? null
    : Math.round(concluded.reduce((sum, s) => sum + (s.overallScore ?? 0), 0) / concluded.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {!gateDismissed && (
        <BrowserGate caps={caps} onTextOnly={() => setGateDismissed(true)} />
      )}

      {/* Hero card */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Practice · oral advocacy</div>
            <h1 className="heading-xl" style={{ margin: 'var(--space-2) 0 var(--space-2)' }}>
              Mock Arguments
            </h1>
            <p className="lede" style={{ margin: 0, maxWidth: 640 }}>
              Argue against an AI opposing counsel grounded in your case facts and the Indian
              law corpus. Pick a saved matter or upload a brief, choose your side, and the
              court is in session.
            </p>
          </div>
          <button className="btn btn-primary btn-lg" onClick={props.onStart}>
            <Icon name="plus" /> New session
          </button>
        </div>

        {/* Compact stats strip — only shown once the user has finished one. */}
        {(items.length > 0 || avgScore != null) && (
          <div
            className="row"
            style={{
              gap: 'var(--space-7)',
              padding: 'var(--space-4) 0 0',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <StatBlock label="Sessions" value={String(items.length)} />
            <StatBlock label="Concluded" value={String(concluded.length)} />
            <StatBlock
              label="Avg score"
              value={avgScore == null ? '—' : `${avgScore}/100`}
            />
          </div>
        )}
      </div>

      {/* Past sessions */}
      <div>
        <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Past sessions</div>
        {sessions.isLoading && (
          <div className="muted body-sm">Loading…</div>
        )}
        {!sessions.isLoading && items.length === 0 && (
          <div className="ma-empty">
            <div className="heading-sm" style={{ marginBottom: 'var(--space-2)' }}>
              No sessions yet
            </div>
            <div className="body-sm muted">
              Start your first practice to argue against opposing counsel.
            </div>
          </div>
        )}
        {items.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {items.map((s) => {
              const onClick = (): void => {
                if (s.status === 'active') props.onResume(s.id);
                else if (s.status === 'concluded') props.onReview(s.id);
              };
              return (
                <div
                  key={s.id}
                  className="ma-session-row"
                  onClick={onClick}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onClick();
                    }
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    {/* Headline = the advocate who prepared the session.
                        Matter title slides under it as the subtitle so
                        sessions stay distinguishable when one advocate has
                        several rows for the same case. Falls back to the
                        matter when the user join produced no name. */}
                    <div className="heading-sm" style={{ marginBottom: 'var(--space-1)' }}>
                      {s.preparedByName || s.matterTitle}
                    </div>
                    <div className="body-sm muted" style={{ marginBottom: 'var(--space-1)' }}>
                      {s.preparedByName ? s.matterTitle : null}
                    </div>
                    <div className="body-xs">
                      {ROLES.find((r) => r.value === s.role)?.label} · {s.judgePersona} ·{' '}
                      {findLanguage(s.languageCode).englishName} ·{' '}
                      {s.turnCount} turn{s.turnCount === 1 ? '' : 's'} ·{' '}
                      {new Date(s.startedAt).toLocaleDateString()}{' '}
                      {new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
                    {s.overallScore != null && (
                      <span className="badge badge-sage">
                        {Math.round(s.overallScore)}/100
                      </span>
                    )}
                    {s.status === 'active' && (
                      <span className="badge badge-cobalt">Active</span>
                    )}
                    {s.status === 'concluded' && (
                      <span className="badge">Concluded</span>
                    )}
                    {s.status === 'abandoned' && (
                      <span className="badge badge-amber">Abandoned</span>
                    )}
                    <Icon name="chevron" className="muted" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBlock(props: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="heading-lg" style={{ marginBottom: 'var(--space-1)' }}>{props.value}</div>
      <div className="eyebrow">{props.label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function Setup(props: {
  onCancel: () => void;
  onCreated: (sessionId: string) => void;
}): JSX.Element {
  const caps = useBrowserCapabilities();
  const textOnlyChosen = getTextOnlyChoice();
  // Default input mode: voice when Web Speech is available AND the user
  // hasn't dismissed the gate into text-only. The user can still override
  // either way from the chip group below.
  const defaultInputMode: MaInputMode = caps.speechFullSupport && !textOnlyChosen ? 'voice' : 'text';

  const profileDefaultLanguage = useAuthStore(
    (s) => s.user?.defaultLanguageCode ?? 'en-IN',
  );

  const [tab, setTab] = useState<'case' | 'upload'>('case');
  const [caseId, setCaseId] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [summary, setSummary] = useState<MaMatterSummary>(EMPTY_SUMMARY);
  const [confirmed, setConfirmed] = useState(false);
  const [role, setRole] = useState<MaRole>('petitioner');
  const [inputMode, setInputMode] = useState<MaInputMode>(defaultInputMode);
  const [persona, setPersona] = useState<MaJudgePersona>('neutral');
  const [duration, setDuration] = useState<number | null>(10 * 60);
  // Per-session language: pre-fills from the user's profile default but is
  // editable here for one-off overrides (e.g. an English-default user
  // wants to practise a single Tamil session). The chosen code travels
  // through createSession into the prompt builder and the STT/TTS locale.
  const [languageCode, setLanguageCode] = useState<string>(profileDefaultLanguage);

  const cases = useCases();
  const summaryFromCase = useCaseSummary();
  const uploadFile = useUploadMatterFile();
  const createSession = useCreateMockArgSession();
  // Hidden native file input. The visible trigger is a styled .input-shaped
  // button that opens the OS picker via fileInputRef.current.click(); this
  // keeps the upload control visually consistent with the dropdowns below.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);

  const canStart = confirmed && summary.title.trim().length > 0 && (caseId || uploadId);

  function pickCase(id: string): void {
    setCaseId(id);
    setUploadId(null);
    setConfirmed(false);
    summaryFromCase.mutate(id, {
      onSuccess: (s) => setSummary(s),
    });
  }

  function pickFile(file: File): void {
    setCaseId(null);
    setConfirmed(false);
    setPickedFileName(file.name);
    uploadFile.mutate(file, {
      onSuccess: (u) => {
        setUploadId(u.id);
        setSummary(u.summary);
      },
    });
  }

  // Selected language metadata — drives the voice-mode gate below and the
  // input-mode auto-downgrade for no-voice languages.
  const language: LanguageOption = findLanguage(languageCode);
  const langSupportsVoice = language.voiceSupport !== 'none';
  // When the user picks a language without Web Speech support, voice mode
  // is no longer meaningful. Snap input mode to text so they're not staring
  // at a mic button that can't fire. (User can still flip back if they
  // re-pick a voice-supported language later.)
  useEffect(() => {
    if (!langSupportsVoice && inputMode === 'voice') {
      setInputMode('text');
    }
  }, [langSupportsVoice, inputMode]);

  async function startSession(): Promise<void> {
    const input: CreateSessionInput = {
      matterSummary: summary,
      role,
      judgePersona: persona,
      plannedDurationSeconds: duration,
      inputMode,
      languageCode,
      ...(caseId ? { caseId } : {}),
      ...(uploadId ? { uploadId } : {}),
    };
    const session = await createSession.mutateAsync(input);
    props.onCreated(session.id);
  }

  const hasSource = !!(caseId || uploadId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Header */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">Step · session setup</div>
          <h2 className="heading-xl" style={{ margin: 'var(--space-2) 0 0' }}>
            New mock argument
          </h2>
        </div>
        <button className="btn btn-ghost" onClick={props.onCancel}>
          <Icon name="close" /> Cancel
        </button>
      </div>

      {/* Source picker */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="eyebrow">1 · Choose a matter</div>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <button
            className={`chip ${tab === 'case' ? 'active' : ''}`}
            onClick={() => setTab('case')}
            type="button"
          >
            Pick existing case
          </button>
          <button
            className={`chip ${tab === 'upload' ? 'active' : ''}`}
            onClick={() => setTab('upload')}
            type="button"
          >
            Upload PDF / DOCX
          </button>
        </div>

        {tab === 'case' && (
          <div>
            <Select
              value={caseId ?? ''}
              placeholder={
                cases.isLoading       ? 'Loading cases…'
                : cases.isError       ? 'Could not load cases'
                : (cases.data ?? []).length === 0 ? 'No cases yet — switch to Upload'
                :                       'Select a case…'
              }
              disabled={cases.isLoading || cases.isError || (cases.data ?? []).length === 0}
              onChange={(v) => v && pickCase(v)}
              options={(cases.data ?? []).map((c) => ({
                value: c.id,
                label: `${c.title} · ${c.client}`,
              }))}
            />
            {cases.isError && (
              <div className="body-sm" style={{ marginTop: 'var(--space-2)', color: 'var(--danger)' }}>
                {(cases.error as Error)?.message ?? 'Could not load cases. Check your connection and reload.'}
              </div>
            )}
            {!cases.isLoading && !cases.isError && (cases.data ?? []).length === 0 && (
              <div className="body-sm muted" style={{ marginTop: 'var(--space-2)' }}>
                You don't have any cases saved yet. Add one from Matters, or upload a brief instead.
              </div>
            )}
            {summaryFromCase.isPending && (
              <div
                className="card"
                role="status"
                aria-live="polite"
                style={{
                  marginTop: 'var(--space-3)',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                }}
              >
                <span className="lex-spinner lex-spinner-lg" aria-hidden />
                <div>
                  <div className="heading-sm" style={{ marginBottom: 2 }}>Summarising matter…</div>
                  <div className="body-xs muted">
                    Reading the matter file and asking the AI to draft a summary. This can take 10–20 seconds.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'upload' && (
          <div>
            {/* Hidden native input; the styled trigger above is what the user
                interacts with. Keeps the upload control visually aligned
                with the case and language dropdowns (same .input footprint,
                same border, same height). */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickFile(f);
              }}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="input"
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                background: 'var(--bg-surface)',
                color: pickedFileName ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {pickedFileName ?? 'Choose a document…'}
              </span>
              <span
                className="mono"
                style={{
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  color: 'var(--text-tertiary)',
                  marginLeft: 'var(--space-3)',
                  flexShrink: 0,
                }}
              >
                {pickedFileName ? 'CHANGE' : 'BROWSE'}
              </span>
            </button>
            <div className="body-xs" style={{ marginTop: 'var(--space-2)' }}>
              PDF, DOCX, TXT, or Markdown · up to 12 MB
            </div>
            {uploadFile.isPending && (
              <div
                className="card"
                role="status"
                aria-live="polite"
                style={{
                  marginTop: 'var(--space-3)',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                }}
              >
                <span className="lex-spinner lex-spinner-lg" aria-hidden />
                <div>
                  <div className="heading-sm" style={{ marginBottom: 2 }}>Extracting and summarising…</div>
                  <div className="body-xs muted">
                    Parsing the document and building the matter summary. This can take 15–45 seconds for longer PDFs.
                  </div>
                </div>
              </div>
            )}
            {uploadFile.isError && (
              <div className="body-sm" style={{ marginTop: 'var(--space-2)', color: 'var(--danger)' }}>
                Upload failed: {(uploadFile.error as Error)?.message ?? 'unknown error'}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Matter summary editor */}
      {hasSource && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="eyebrow">2 · Confirm matter summary</div>
          <div className="body-sm muted">
            This summary is pinned to every turn's prompt. Edit anything that's off — facts you'd
            cite, the issues at stake, the statutes in play.
          </div>
          <SummaryEditor summary={summary} onChange={setSummary} />
        </div>
      )}

      {/* Role / persona / duration / input mode */}
      {hasSource && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <div className="eyebrow">3 · Configure</div>

          <div>
            <div className="label">Your role</div>
            <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={`chip ${role === r.value ? 'active' : ''}`}
                  onClick={() => setRole(r.value)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="label">Judge persona</div>
            <div className="facts-grid-3" style={{ marginTop: 'var(--space-2)' }}>
              {PERSONAS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPersona(p.value)}
                  style={{
                    textAlign: 'left',
                    padding: 'var(--space-4)',
                    border: '1px solid',
                    borderColor: persona === p.value ? 'var(--text-primary)' : 'var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    background: persona === p.value ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
                    cursor: 'pointer',
                  }}
                >
                  <div className="heading-sm" style={{ marginBottom: 'var(--space-1)' }}>{p.label}</div>
                  <div className="body-xs" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                    {p.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="row" style={{ gap: 'var(--space-7)', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 240px' }}>
              <div className="label">Session length</div>
              <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
                {DURATIONS.map((d) => (
                  <button
                    key={d.label}
                    type="button"
                    className={`chip ${duration === d.value ? 'active' : ''}`}
                    onClick={() => setDuration(d.value)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: '1 1 240px' }}>
              <div className="label">Input mode</div>
              <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <button
                  type="button"
                  className={`chip ${inputMode === 'voice' ? 'active' : ''}`}
                  disabled={!caps.speechFullSupport || !langSupportsVoice}
                  onClick={() => setInputMode('voice')}
                  title={
                    !caps.speechFullSupport
                      ? 'Browser does not support Web Speech'
                      : !langSupportsVoice
                      ? `No reliable voice support for ${language.englishName} — practise in text mode`
                      : undefined
                  }
                >
                  Voice
                </button>
                <button
                  type="button"
                  className={`chip ${inputMode === 'text' ? 'active' : ''}`}
                  onClick={() => setInputMode('text')}
                >
                  Text only
                </button>
              </div>
            </div>
          </div>

          <LanguagePicker
            value={languageCode}
            onChange={setLanguageCode}
            profileDefault={profileDefaultLanguage}
          />
        </div>
      )}

      {/* Confirm + start */}
      {hasSource && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <label className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span className="body-sm">
              I've reviewed the matter summary and it's accurate enough to argue against.
            </span>
          </label>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <button className="btn btn-ghost" onClick={props.onCancel}>Cancel</button>
            <button
              className="btn btn-primary btn-lg"
              disabled={!canStart || createSession.isPending}
              onClick={() => { void startSession(); }}
            >
              {createSession.isPending ? 'Starting…' : 'Start session'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryEditor(props: {
  summary: MaMatterSummary;
  onChange: (s: MaMatterSummary) => void;
}): JSX.Element {
  const { summary, onChange } = props;
  const setField = <K extends keyof MaMatterSummary>(k: K, v: MaMatterSummary[K]): void =>
    onChange({ ...summary, [k]: v });

  const renderList = (
    label: string,
    field: 'facts' | 'issues' | 'applicableStatutes' | 'priorJudgments',
    placeholder: string,
  ): JSX.Element => (
    <div>
      <div className="label">{label}</div>
      <textarea
        className="input"
        value={summary[field].join('\n')}
        onChange={(e) => setField(field, e.target.value.split('\n').filter(Boolean))}
        rows={4}
        placeholder={placeholder}
        style={{ marginTop: 'var(--space-2)', resize: 'vertical', fontFamily: 'inherit' }}
      />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div className="facts-aside">
        <div>
          <div className="label">Title</div>
          <input
            className="input"
            value={summary.title}
            onChange={(e) => setField('title', e.target.value)}
            style={{ marginTop: 'var(--space-2)' }}
          />
        </div>
        <div>
          <div className="label">Court</div>
          <input
            className="input"
            value={summary.court ?? ''}
            onChange={(e) => setField('court', e.target.value || null)}
            placeholder="e.g. Delhi High Court"
            style={{ marginTop: 'var(--space-2)' }}
          />
        </div>
      </div>
      <div className="facts-grid-2">
        <div>
          <div className="label">Petitioner</div>
          <input
            className="input"
            value={summary.parties.petitioner ?? ''}
            onChange={(e) => setField('parties', { ...summary.parties, petitioner: e.target.value || null })}
            style={{ marginTop: 'var(--space-2)' }}
          />
        </div>
        <div>
          <div className="label">Respondent</div>
          <input
            className="input"
            value={summary.parties.respondent ?? ''}
            onChange={(e) => setField('parties', { ...summary.parties, respondent: e.target.value || null })}
            style={{ marginTop: 'var(--space-2)' }}
          />
        </div>
      </div>
      <div className="facts-grid-2">
        {renderList('Facts', 'facts', 'One per line')}
        {renderList('Issues', 'issues', 'One per line')}
      </div>
      <div className="facts-grid-2">
        {renderList('Applicable statutes', 'applicableStatutes', 'e.g. BNS s.103')}
        {renderList('Prior judgments', 'priorJudgments', 'Case name + citation')}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LanguagePicker
//
// Drop-down for the per-session language. Surfaces the 22 8th-Schedule
// languages plus English, grouped roughly by usage band so a Tamil-speaking
// advocate isn't scrolling past Bodo and Santali to find their language.
// Each option shows the English name + native script + a voice-support badge
// so the user knows up-front whether they can talk to the AI or must type.
// The currently-active profile default is marked "Default" so the user can
// see at a glance which row matches their account preference.
// ---------------------------------------------------------------------------

const LANGUAGE_GROUPS: ReadonlyArray<{ label: string; codes: ReadonlyArray<string> }> = [
  { label: 'Default',         codes: ['en-IN', 'hi-IN'] },
  { label: 'South Indian',    codes: ['ta-IN', 'te-IN', 'kn-IN', 'ml-IN'] },
  { label: 'Other widely-spoken', codes: ['bn-IN', 'mr-IN', 'gu-IN', 'pa-IN', 'ur-IN', 'or-IN', 'as-IN', 'ne-NP'] },
  { label: 'Text-only (no voice)', codes: ['sa-IN', 'mai-IN', 'kok-IN', 'ks-IN', 'sd-IN', 'doi-IN', 'mni-IN', 'brx-IN', 'sat-IN'] },
];

function LanguagePicker(props: {
  value: string;
  onChange: (code: string) => void;
  profileDefault: string;
}): JSX.Element {
  const { value, onChange, profileDefault } = props;
  const active = findLanguage(value);
  const isDefault = value === profileDefault;
  // Flatten the grouped catalogue into the Select's option shape. Group
  // labels become disabled separator rows so the visual grouping survives
  // (South Indian etc.) without dropping into native <optgroup>, which
  // doesn't render inside the custom Select.
  const options: SelectOption[] = LANGUAGE_GROUPS.flatMap((grp) => [
    { value: `__group:${grp.label}`, label: grp.label.toUpperCase(), disabled: true },
    ...grp.codes.map((code) => {
      const l = findLanguage(code);
      const hint = l.voiceSupport === 'full'    ? 'VOICE'
                 : l.voiceSupport === 'partial' ? 'VOICE·PARTIAL'
                 :                                'TEXT';
      return {
        value: code,
        label: `${l.englishName} (${l.nativeName})`,
        hint,
      } satisfies SelectOption;
    }),
  ]);
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="label">Language</div>
        {!isDefault && (
          <button
            type="button"
            onClick={() => onChange(profileDefault)}
            className="body-xs"
            style={{
              all: 'unset',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              textDecoration: 'underline',
              textDecorationStyle: 'dotted',
            }}
            title="Reset to your account default"
          >
            Use default ({findLanguage(profileDefault).englishName})
          </button>
        )}
      </div>
      <div style={{ marginTop: 'var(--space-2)' }}>
        <Select
          value={value}
          onChange={(v) => onChange(v)}
          options={options}
        />
      </div>
      <div className="body-xs muted" style={{ marginTop: 'var(--space-2)' }}>
        The opposing counsel will argue in {active.englishName}, and the review will be written in it too.
        {active.voiceSupport === 'none' && ' Voice input is disabled for this language — practise in text mode.'}
        {active.voiceSupport === 'partial' && ' Voice input may be inconsistent depending on your browser.'}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionDetails
//
// Read-only confirmation step shown when the user re-enters an existing
// active session from the landing list. The purpose is intentionally small:
// remind them what they were arguing, in what posture, in what language —
// then let them either continue into the live mic view or back out. We
// fetch the full session (matter summary + turn count) so the user can
// glance at their facts / issues before the court resumes.
// ---------------------------------------------------------------------------

function SessionDetails(props: {
  sessionId: string;
  onBack: () => void;
  onContinue: (sessionId: string) => void;
}): JSX.Element {
  const session = useMockArgSession(props.sessionId);
  const s = session.data;
  if (session.isLoading || !s) {
    return (
      <div className="card">
        <div className="muted body-sm">Loading session…</div>
      </div>
    );
  }
  const language = findLanguage(s.languageCode);
  const userTurns = s.turns.filter((t) => t.speaker === 'user').length;
  const aiTurns   = s.turns.filter((t) => t.speaker === 'ai').length;
  const lastTurn  = s.turns[s.turns.length - 1] ?? null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Header */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">Resume · session details</div>
          <h2 className="heading-xl" style={{ margin: 'var(--space-2) 0 0' }}>
            {s.matterSummary.title || 'Untitled matter'}
          </h2>
        </div>
        <button className="btn btn-ghost" onClick={props.onBack}>
          <Icon name="close" /> Back
        </button>
      </div>

      {/* Top facts strip */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="eyebrow">At a glance</div>
        <div className="grid-auto-sm">
          <DetailField label="Your role" value={ROLES.find((r) => r.value === s.role)?.label ?? s.role} />
          <DetailField label="Judge persona" value={s.judgePersona} />
          <DetailField label="Language" value={`${language.englishName} (${language.nativeName})`} />
          <DetailField label="Input mode" value={s.inputMode === 'voice' ? 'Voice' : 'Text only'} />
          <DetailField
            label="Started"
            value={`${new Date(s.startedAt).toLocaleDateString()} · ${new Date(s.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
          />
          <DetailField
            label="Turns so far"
            value={`${userTurns} yours · ${aiTurns} opposing`}
          />
        </div>
      </div>

      {/* Matter summary preview */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div className="eyebrow">Matter</div>
        <div className="facts-grid-2">
          {s.matterSummary.court && (
            <DetailField label="Court" value={s.matterSummary.court} />
          )}
          {s.matterSummary.parties.petitioner && (
            <DetailField label="Petitioner" value={s.matterSummary.parties.petitioner} />
          )}
          {s.matterSummary.parties.respondent && (
            <DetailField label="Respondent" value={s.matterSummary.parties.respondent} />
          )}
        </div>
        {s.matterSummary.facts.length > 0 && (
          <BulletList label="Facts" items={s.matterSummary.facts} />
        )}
        {s.matterSummary.issues.length > 0 && (
          <BulletList label="Issues" items={s.matterSummary.issues} />
        )}
        {s.matterSummary.applicableStatutes.length > 0 && (
          <BulletList label="Applicable statutes" items={s.matterSummary.applicableStatutes} />
        )}
        {s.matterSummary.priorJudgments.length > 0 && (
          <BulletList label="Prior authorities" items={s.matterSummary.priorJudgments} />
        )}
      </div>

      {/* Most recent turn preview — helps the user re-orient before they
          tap the mic and have to remember where they left off. */}
      {lastTurn && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="eyebrow">Last exchange</div>
          <div className="body-xs muted">
            {lastTurn.speaker === 'user' ? 'You said' : 'Opposing counsel said'}
          </div>
          <div
            className="body-sm"
            style={{
              whiteSpace: 'pre-wrap',
              maxHeight: 180,
              overflowY: 'auto',
              padding: 'var(--space-3)',
              background: 'var(--bg-surface-2)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            {lastTurn.transcript}
          </div>
        </div>
      )}

      {/* Continue / back */}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
        <button className="btn btn-ghost" onClick={props.onBack}>Back</button>
        <button
          className="btn btn-primary btn-lg"
          onClick={() => props.onContinue(s.id)}
        >
          Continue session
        </button>
      </div>
    </div>
  );
}

function DetailField(props: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="label">{props.label}</div>
      <div className="body-sm" style={{ marginTop: 'var(--space-1)' }}>
        {props.value}
      </div>
    </div>
  );
}

function BulletList(props: { label: string; items: string[] }): JSX.Element {
  return (
    <div>
      <div className="label" style={{ marginBottom: 'var(--space-2)' }}>{props.label}</div>
      <ul style={{ margin: 0, paddingLeft: 'var(--space-5)' }}>
        {props.items.map((item, i) => (
          <li key={i} className="body-sm" style={{ marginBottom: 'var(--space-1)' }}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live session
// ---------------------------------------------------------------------------

function Live(props: {
  sessionId: string;
  onConcluded: (sessionId: string) => void;
  onAbandon: () => void;
}): JSX.Element {
  const session = useMockArgSession(props.sessionId);
  const conclude = useConcludeMockArgSession();
  const caps = useBrowserCapabilities();
  // Locale that drives STT recognition and TTS voice selection. Read off
  // the session row (which was pinned at setup); falls back to en-IN so
  // sessions persisted before migration 0039 still have a sane locale.
  const sessionLang = session.data?.languageCode ?? 'en-IN';
  const stt = useSpeechToText();
  const tts = useTextToSpeech({ lang: sessionLang });

  const [localTurns, setLocalTurns] = useState<MaTurn[]>([]);
  const [streamingText, setStreamingText] = useState<string>('');
  const [streamingCitations, setStreamingCitations] = useState<MaCitation[]>([]);
  const [draft, setDraft] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [reconnect, setReconnect] = useState<{ attempt: number; delayMs: number } | null>(null);
  const [pendingVoiceDraft, setPendingVoiceDraft] = useState<string | null>(null);
  /** Surfaced after the mic stops with nothing captured. Cleared the next
   *  time the user starts listening so it doesn't stick around forever. */
  const [emptyCapture, setEmptyCapture] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  // Reset the local buffer whenever the server-canonical turn list refetches —
  // drops streamed previews that are now durably persisted.
  useEffect(() => {
    if (session.data) {
      setLocalTurns([]);
      setStreamingText('');
    }
  }, [session.data?.id, session.data?.turns.length]);

  // Cancel any in-flight voice when the user leaves the view.
  //
  // The previous version had `[tts, stt]` as the dep array — but those
  // hooks return a fresh object on every render, so this effect's cleanup
  // re-ran on every re-render and called `stt.cancel()` before the user
  // could see anything. We read the latest references through refs and
  // run cleanup ONLY on unmount with an empty dep array.
  const ttsRef = useRef(tts);
  const sttRef = useRef(stt);
  ttsRef.current = tts;
  sttRef.current = stt;
  useEffect(() => {
    return (): void => {
      ttsRef.current.cancelAll();
      sttRef.current.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turns = useMemo(() => {
    const base = session.data?.turns ?? [];
    return [...base, ...localTurns];
  }, [session.data?.turns, localTurns]);

  // Keep the transcript pinned to the bottom as new turns / deltas arrive.
  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns.length, streamingText]);

  const voiceMode = session.data?.inputMode === 'voice' && caps.speechFullSupport;

  async function submitTranscript(transcript: string): Promise<void> {
    const text = transcript.trim();
    if (!text || isStreaming) return;
    setDraft('');
    setPendingVoiceDraft(null);
    setIsStreaming(true);
    setStreamError(null);
    setStreamingText('');
    setStreamingCitations([]);
    setReconnect(null);

    // Optimistic render — the user's bubble appears immediately, before the
    // SSE round-trip's `user_turn` frame arrives. Otherwise there's a
    // noticeable lag between clicking submit and seeing the message land in
    // the transcript, which feels broken on slow networks. The placeholder
    // is replaced by the canonical row when the server frame arrives; if
    // the request fails outright it stays so the user can see what they
    // sent.
    const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticTurn: MaTurn = {
      id: optimisticId,
      sessionId: props.sessionId,
      turnNumber: (session.data?.turns.length ?? 0) + localTurns.length + 1,
      speaker: 'user',
      transcript: text,
      citations: null,
      rating: null,
      createdAt: new Date().toISOString(),
    };
    setLocalTurns((prev) => [...prev, optimisticTurn]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamTurn(props.sessionId, text, {
        onUserTurn: (t) => {
          // Replace the optimistic placeholder in-place so the bubble
          // doesn't jump or duplicate.
          setLocalTurns((prev) => prev.map((p) => (p.id === optimisticId ? t : p)));
        },
        onCitations: (c) => setStreamingCitations(c),
        onDelta: (chunk) => {
          setStreamingText((prev) => prev + chunk);
          // Only speak when the OS actually has a voice for the session
          // language. Otherwise Chrome would silently skip the foreign
          // script and pronounce only the embedded digits/ASCII — sounds
          // like the AI is reading citation numbers ("260/242") instead
          // of the sentence. Suppressing here is friendlier than the
          // garble; the user still sees the transcript scroll.
          if (voiceMode && tts.voiceAvailable) tts.append(chunk);
        },
        onAiTurn: (t) => {
          setLocalTurns((prev) => [...prev, t]);
          setStreamingText('');
          if (voiceMode && tts.voiceAvailable) tts.flush();
        },
        onError: (msg) => setStreamError(msg),
        onReconnecting: (attempt, delayMs) => setReconnect({ attempt, delayMs }),
      }, controller.signal);
    } finally {
      setIsStreaming(false);
      setReconnect(null);
      abortRef.current = null;
      void session.refetch();
    }
  }

  async function startListening(): Promise<void> {
    if (tts.speaking) tts.cancelAll();
    // Intentionally do NOT clear pendingVoiceDraft. A "tap Speak → tap
    // Stop & review → tap Speak again" cycle means the advocate is
    // continuing the same turn after a breath, not starting over —
    // wiping the preview would erase everything they already dictated.
    // We reset the recogniser internals only, then append the new
    // capture to the existing draft on stop.
    setEmptyCapture(false);
    stt.reset();
    // Pass the session's locale so the recogniser dictates in the right
    // language. Defaults to en-IN if the session is from before 0039.
    await stt.start({ lang: sessionLang });
  }

  async function stopListening(): Promise<void> {
    const captured = await stt.stop();
    const trimmed = captured.trim();
    if (trimmed) {
      // Functional setter so concurrent re-renders don't clobber the
      // accumulated draft. Single space between segments — the underlying
      // recogniser already capitalises sentence starts.
      setPendingVoiceDraft((prev) =>
        prev && prev.trim() ? `${prev.trim()} ${trimmed}` : trimmed,
      );
      setEmptyCapture(false);
    } else {
      // Spec §5: STT empty / silent → don't submit, show "We didn't catch that".
      // The banner stays until the next start() clears it. We deliberately
      // do NOT wipe the existing draft here: an empty mic stop on a
      // session that already had captured text is "I paused but didn't
      // add anything", not "discard my previous turn".
      setEmptyCapture(true);
    }
  }

  async function handleConclude(): Promise<void> {
    // Flush whatever the user has captured but not yet sent, otherwise the
    // review pass would score against a transcript that's missing the
    // advocate's last point. Three sources to drain, in order of priority:
    //   1. Live mic — `stt.stop()` commits the audio buffer (`cancel()` would
    //      discard it). We replace `pending` with the freshly-captured
    //      text so the post-stop draft is what gets submitted.
    //   2. pendingVoiceDraft — text the user already finished dictating
    //      and was about to (but hadn't yet) tapped Send on.
    //   3. The text-mode draft input, same idea.
    let pending = pendingVoiceDraft?.trim() ?? draft.trim();
    if (stt.listening) {
      const captured = await stt.stop();
      const trimmed = captured.trim();
      if (trimmed) pending = trimmed;
    }
    if (pending && !isStreaming) {
      // submitTranscript awaits the full SSE round-trip, so by the time it
      // resolves the user turn is durably persisted and the AI's reply (if
      // it streamed at all) is too. The review pass below reads from disk,
      // so anything that landed is on record.
      await submitTranscript(pending);
    }
    if (abortRef.current) abortRef.current.abort();
    tts.cancelAll();
    stt.cancel();
    const updated = await conclude.mutateAsync(props.sessionId);
    props.onConcluded(updated.id);
  }

  async function handleStepAway(): Promise<void> {
    if (abortRef.current) abortRef.current.abort();
    tts.cancelAll();
    stt.cancel();
    props.onAbandon();
  }

  if (session.isLoading || !session.data) {
    return <div className="muted body-md" style={{ padding: 'var(--space-5)' }}>Loading session…</div>;
  }

  const s = session.data;

  return (
    <div className="workspace-2">
      {/* Main panel */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minHeight: 540, padding: 0, overflow: 'hidden' }}>
        {/* Header */}
        <div
          className="row"
          style={{
            justifyContent: 'space-between', alignItems: 'flex-start',
            padding: 'var(--space-5) var(--space-6) 0',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">Live session</div>
            <h2 className="heading-lg" style={{ margin: 'var(--space-1) 0 var(--space-1)' }}>
              {s.matterSummary.title || 'Untitled matter'}
            </h2>
            <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span className="badge">{ROLES.find((r) => r.value === s.role)?.label}</span>
              <span className="badge">Judge · {s.judgePersona}</span>
              <span className="badge">{voiceMode ? 'Voice' : 'Text'}</span>
              <span className="badge">{findLanguage(s.languageCode).englishName}</span>
            </div>
          </div>
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <button className="btn" onClick={() => { void handleStepAway(); }}>
              Pause
            </button>
            <button
              className="btn btn-primary"
              onClick={() => { void handleConclude(); }}
              disabled={conclude.isPending}
            >
              {conclude.isPending ? (
                <><span className="lex-spinner" aria-hidden /> Reviewing…</>
              ) : 'Conclude & review'}
            </button>
          </div>
        </div>

        {reconnect && (
          <div
            style={{
              margin: '0 var(--space-6)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--warning-bg)',
              color: 'var(--warning)',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            <span className="ma-rec-dot" style={{ background: 'var(--warning)' }} />
            Reconnecting… (attempt {reconnect.attempt} of 3)
          </div>
        )}

        {/* No-voice notice. Voice mode is on and the session language is
            something the OS has no installed voice for (common for Tamil,
            Telugu, Malayalam on stock Windows). We suppress TTS so the
            user doesn't hear digit-only garble; this banner tells them
            why opposing counsel is silent and how to fix it. */}
        {voiceMode && !tts.voiceAvailable && (
          <div
            style={{
              margin: '0 var(--space-6)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--warning-bg)',
              color: 'var(--text-primary)',
              fontSize: 12,
              border: '1px solid var(--warning)',
            }}
          >
            <strong>No {findLanguage(s.languageCode).englishName} voice installed.</strong>{' '}
            <span className="muted">
              Opposing counsel's replies appear as text only — install a {findLanguage(s.languageCode).englishName} system voice (Windows: Settings → Time &amp; Language → Speech → Add voices) and refresh to enable speech.
            </span>
          </div>
        )}

        {/* Transcript scroll area */}
        <div
          ref={transcriptScrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'var(--space-2) var(--space-6) var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
          }}
        >
          {turns.length === 0 && !isStreaming && (
            <div className="ma-empty" style={{ margin: 'var(--space-5) 0' }}>
              <div className="heading-sm" style={{ marginBottom: 'var(--space-2)' }}>The bench is ready</div>
              <div className="body-sm muted">
                Open with your first argument. Speak as you would in court — opening statement,
                statute, prayer.
              </div>
            </div>
          )}
          {turns.map((t) => <TurnBubble key={t.id} turn={t} />)}
          {/* Two streaming-state cases:
              - Pre-first-token: AI is "thinking" — server has the request
                but hasn't streamed anything yet. Show a skeleton bubble
                with animated dots so the user knows the round-trip is in
                flight (otherwise the screen looks frozen).
              - Tokens arriving: replace skeleton with the live transcript. */}
          {isStreaming && !streamingText && <ThinkingBubble />}
          {isStreaming && streamingText && (
            <TurnBubble
              turn={{
                id: 'streaming',
                sessionId: s.id,
                turnNumber: -1,
                speaker: 'ai',
                transcript: streamingText,
                citations: streamingCitations,
                rating: null,
                createdAt: new Date().toISOString(),
              }}
              streaming
            />
          )}
          {streamError && (
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--danger-bg)',
                color: 'var(--danger)',
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
              }}
            >
              <Icon name="close" />
              <div style={{ flex: 1 }}>Stream error: {streamError}</div>
              <button className="btn btn-sm" onClick={() => setStreamError(null)}>Dismiss</button>
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: 'var(--space-4) var(--space-6) var(--space-5)' }}>
          {voiceMode ? (
            <VoiceComposer
              stt={stt}
              tts={tts}
              isStreaming={isStreaming}
              pendingVoiceDraft={pendingVoiceDraft}
              emptyCapture={emptyCapture}
              onDismissEmpty={() => setEmptyCapture(false)}
              onDraftChange={setPendingVoiceDraft}
              onStartListening={() => { void startListening(); }}
              onStopListening={() => { void stopListening(); }}
              onSubmit={(text) => { void submitTranscript(text); }}
            />
          ) : (
            <TextComposer
              draft={draft}
              onChange={setDraft}
              isStreaming={isStreaming}
              onSubmit={() => { void submitTranscript(draft); }}
            />
          )}
        </div>
      </div>

      {/* Context panel */}
      <ContextPanel session={s} latestCitations={streamingCitations} />
    </div>
  );
}

// ---- Composers -------------------------------------------------------------

function TextComposer(props: {
  draft: string;
  onChange: (s: string) => void;
  isStreaming: boolean;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <div>
      <textarea
        className="input"
        value={props.draft}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Type your argument and submit — opposing counsel will reply."
        rows={4}
        style={{ resize: 'vertical', fontFamily: 'inherit', minHeight: 88 }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            props.onSubmit();
          }
        }}
      />
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 'var(--space-3)' }}>
        <span className="body-xs">
          <span className="kbd">⌘/Ctrl ↵</span> to submit
        </span>
        <button
          className="btn btn-primary"
          disabled={!props.draft.trim() || props.isStreaming}
          onClick={props.onSubmit}
        >
          {props.isStreaming ? 'Opposing counsel is speaking…' : 'Submit turn'}
        </button>
      </div>
    </div>
  );
}

interface VoiceComposerProps {
  stt: ReturnType<typeof useSpeechToText>;
  tts: ReturnType<typeof useTextToSpeech>;
  isStreaming: boolean;
  pendingVoiceDraft: string | null;
  emptyCapture: boolean;
  onDismissEmpty: () => void;
  onDraftChange: (s: string | null) => void;
  onStartListening: () => void;
  onStopListening: () => void;
  onSubmit: (text: string) => void;
}

/** Human-readable explanation of an STT error code. The Web Speech API
 *  surfaces a small enumerated set; we cover the ones the user can
 *  actually act on. */
function explainSttError(code: string): { title: string; hint: string } {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        title: 'Microphone permission was denied',
        hint: 'Click the lock / camera icon in the address bar, set Microphone to Allow, then refresh.',
      };
    case 'audio-capture':
      return {
        title: 'No microphone detected',
        hint: 'Plug one in or pick a different default input device in your OS settings.',
      };
    case 'network':
      return {
        title: 'Speech service unreachable',
        hint: 'Chrome\'s recognition runs server-side. Check your connection and try again.',
      };
    case 'aborted':
      return {
        title: 'Recognition was cancelled',
        hint: 'Tap the mic again to resume.',
      };
    default:
      return {
        title: `Microphone error (${code})`,
        hint: 'Tap the mic to try again, or switch to text-only from Setup.',
      };
  }
}

function VoiceComposer(props: VoiceComposerProps): JSX.Element {
  const { stt, tts } = props;
  const showEditor = props.pendingVoiceDraft !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Live partial transcript while the mic is hot. The status row breaks
          down each stage (mic open → speech detected → text appearing) so it
          is obvious to the user where they are in the pipeline. */}
      {stt.listening && (
        <div className="ma-listening">
          <div
            className="body-xs"
            style={{
              marginBottom: 'var(--space-2)',
              display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span className="ma-rec-dot" /> Listening
            </span>
            <span className="muted" style={{ letterSpacing: 0, textTransform: 'none', fontWeight: 400 }}>
              {stt.audioActive ? 'mic on' : 'opening mic…'}
              {' · '}
              {stt.speechDetected ? 'speech detected' : 'silence'}
            </span>
          </div>
          {stt.combined
            ? <span style={{ whiteSpace: 'pre-wrap' }}>{stt.combined}</span>
            : <span className="muted">
                {stt.audioActive
                  ? 'Speak now — your words will appear here.'
                  : 'Waiting for the microphone to come online…'}
              </span>}
        </div>
      )}

      {/* Edit-before-send box */}
      {showEditor && (
        <div>
          <div className="label" style={{ marginBottom: 'var(--space-2)' }}>
            Edit before sending <span className="muted" style={{ fontWeight: 400, textTransform: 'none' }}>· legal terms get mistranscribed</span>
          </div>
          <textarea
            className="input"
            value={props.pendingVoiceDraft ?? ''}
            onChange={(e) => props.onDraftChange(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => props.onDraftChange(null)}>Discard</button>
            <button
              className="btn btn-primary"
              disabled={!(props.pendingVoiceDraft?.trim()) || props.isStreaming}
              onClick={() => {
                if (props.pendingVoiceDraft) props.onSubmit(props.pendingVoiceDraft);
              }}
            >
              {props.isStreaming ? 'Opposing counsel is speaking…' : 'Submit turn'}
            </button>
          </div>
        </div>
      )}

      {/* "We didn't catch that" — fires when stop yielded no transcript and
          no error was surfaced. Common causes: spoke too softly, mic muted in
          OS, language mismatch. Dismissed by next start() or X. */}
      {props.emptyCapture && !stt.listening && !showEditor && (
        <div
          role="status"
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--warning-bg)',
            color: 'var(--warning)',
            fontSize: 13,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ flex: 1 }}>
            <strong>We didn't catch that.</strong>{' '}
            Tap the mic and try again — speak closer to the microphone, or check that the right
            input device is selected in your OS settings.
          </div>
          <button
            className="btn btn-sm btn-ghost"
            onClick={props.onDismissEmpty}
            aria-label="Dismiss"
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      {stt.error && stt.error !== 'no-speech' && (() => {
        const { title, hint } = explainSttError(stt.error);
        return (
          <div
            role="alert"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--danger-bg)',
              color: 'var(--danger)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 600 }}>{title}</div>
            <div style={{ marginTop: 4 }}>{hint}</div>
          </div>
        );
      })()}

      {/* Mic + TTS controls */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <button
          type="button"
          className={`ma-mic ${stt.listening ? 'ma-mic-hot' : ''}`}
          onClick={() => {
            if (stt.listening) props.onStopListening();
            else props.onStartListening();
          }}
          disabled={props.isStreaming && !tts.speaking}
          title={tts.speaking ? 'Tap to interrupt — cuts opposing counsel off' : 'Tap and hold the floor'}
        >
          <Icon name={stt.listening ? 'micOff' : 'mic'} size={18} />
          {stt.listening
            ? 'Stop & review'
            : tts.speaking
              ? 'Interrupt'
              : 'Tap to speak'}
        </button>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          {tts.speaking && !tts.paused && (
            <button className="btn btn-sm" onClick={tts.pause}>Pause voice</button>
          )}
          {tts.paused && (
            <button className="btn btn-sm" onClick={tts.resume}>Resume voice</button>
          )}
          {tts.speaking && (
            <button className="btn btn-sm" onClick={tts.skip}>Skip</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Chat bubble -----------------------------------------------------------

// Skeleton bubble shown after Submit, before the AI's first token arrives.
// Visually matches the AI turn bubble so the layout doesn't jump when the
// real transcript replaces it. The animated dots tell the user the server
// is working — silence here would feel like a frozen submit.
function ThinkingBubble(): JSX.Element {
  return (
    <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'flex-start' }}>
      <div className="ma-avatar ma-avatar-ai" aria-hidden>OC</div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: 'min(640px, 100%)', gap: 'var(--space-2)' }}>
        <div className="ma-bubble-meta">
          Opposing counsel
          <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font-sans)' }}>
            · thinking
          </span>
        </div>
        <div
          className="ma-bubble ma-bubble-streaming"
          role="status"
          aria-live="polite"
          aria-label="Opposing counsel is thinking"
        >
          <span className="ma-thinking-dots" aria-hidden>
            <span /><span /><span />
          </span>
        </div>
      </div>
    </div>
  );
}

function TurnBubble(props: { turn: MaTurn; streaming?: boolean }): JSX.Element {
  const t = props.turn;
  const isUser = t.speaker === 'user';
  const [showSources, setShowSources] = useState(false);

  // Avatar pair on the bubble row: user on the right, AI on the left.
  // The row order swaps via flex-direction to make this work without two
  // different layouts.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isUser ? 'row-reverse' : 'row',
        gap: 'var(--space-3)',
        alignItems: 'flex-start',
      }}
    >
      <div className={`ma-avatar ${isUser ? '' : 'ma-avatar-ai'}`} aria-hidden>
        {isUser ? 'YOU' : 'OC'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, maxWidth: 'min(640px, 100%)', gap: 'var(--space-2)' }}>
        <div className="ma-bubble-meta">
          {isUser ? 'You' : 'Opposing counsel'}
          {props.streaming && (
            <span className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font-sans)' }}>
              · streaming
            </span>
          )}
        </div>
        <div
          className={[
            'ma-bubble',
            isUser ? 'ma-bubble-user' : '',
            props.streaming ? 'ma-bubble-streaming' : '',
          ].filter(Boolean).join(' ')}
        >
          {t.transcript}
        </div>
        {!isUser && t.citations && t.citations.length > 0 && (
          <div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setShowSources((v) => !v)}
              style={{ padding: '0 var(--space-3)' }}
            >
              <Icon name={showSources ? 'chevronD' : 'chevron'} />
              {showSources ? 'Hide' : 'Show'} {t.citations.length} source{t.citations.length === 1 ? '' : 's'}
            </button>
            {showSources && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'var(--space-2)',
                  marginTop: 'var(--space-2)',
                }}
              >
                {t.citations.map((c, i) => <CitationChip key={i} c={c} />)}
              </div>
            )}
          </div>
        )}
        {/* Per-turn rating, only present on user turns after conclude */}
        {isUser && t.rating && <InlineRating rating={t.rating} />}
      </div>
    </div>
  );
}

function CitationChip(props: { c: MaCitation }): JSX.Element {
  const { c } = props;
  const head = c.citation ?? `${c.actTitle ?? 'Act'} § ${c.sectionNumber ?? '?'}`;
  return (
    <span className="ma-cite" title={c.sectionHeading ?? undefined}>
      {head}
      {c.jurisdiction === 'State' && c.state && (
        <span className="muted" style={{ fontFamily: 'inherit' }}>· {c.state}</span>
      )}
    </span>
  );
}

function InlineRating(props: { rating: MaTurnRating }): JSX.Element {
  const r = props.rating;
  return (
    <div
      style={{
        padding: 'var(--space-2) var(--space-3)',
        background: 'var(--bg-surface-2)',
        borderRadius: 'var(--radius-sm)',
        marginTop: 'var(--space-1)',
      }}
    >
      <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <RatingTag label="Legal" v={r.legalSoundness} />
        <RatingTag label="Citations" v={r.citationUse} />
        <RatingTag label="Structure" v={r.structure} />
        <RatingTag label="Persuasive" v={r.persuasiveness} />
        <RatingTag label="Responsive" v={r.responsiveness} />
      </div>
      {r.comment && (
        <div className="body-xs" style={{ marginTop: 'var(--space-1)', textTransform: 'none', letterSpacing: 0, fontStyle: 'italic', fontWeight: 400 }}>
          "{r.comment}"
        </div>
      )}
    </div>
  );
}

function RatingTag(props: { label: string; v: number }): JSX.Element {
  return (
    <span className="body-xs" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
      <span className="mono" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{props.v.toFixed(1)}</span>{' '}
      <span className="muted">{props.label}</span>
    </span>
  );
}

// ---- Context panel ---------------------------------------------------------

function ContextPanel(props: {
  session: MaSessionWithTurns;
  latestCitations: MaCitation[];
}): JSX.Element {
  const s = props.session.matterSummary;
  return (
    <div
      className="card"
      style={{
        position: 'sticky', top: 'var(--space-5)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
      }}
    >
      <div>
        <div className="eyebrow">Case context</div>
        <div className="heading-md" style={{ marginTop: 'var(--space-1)' }}>{s.title || 'Untitled'}</div>
        {s.court && <div className="body-xs">{s.court}</div>}
      </div>

      {(s.parties.petitioner || s.parties.respondent) && (
        <PanelBlock label="Parties">
          {s.parties.petitioner && (
            <div className="body-sm">
              <span className="muted">Petitioner · </span>{s.parties.petitioner}
            </div>
          )}
          {s.parties.respondent && (
            <div className="body-sm">
              <span className="muted">Respondent · </span>{s.parties.respondent}
            </div>
          )}
        </PanelBlock>
      )}

      {s.issues.length > 0 && (
        <PanelBlock label="Issues">
          <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {s.issues.map((it, i) => <li key={i} className="body-sm">{it}</li>)}
          </ul>
        </PanelBlock>
      )}

      {s.applicableStatutes.length > 0 && (
        <PanelBlock label="Statutes">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {s.applicableStatutes.map((it, i) => (
              <span key={i} className="ma-cite">{it}</span>
            ))}
          </div>
        </PanelBlock>
      )}

      {props.latestCitations.length > 0 && (
        <PanelBlock label="Just retrieved">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {props.latestCitations.slice(0, 4).map((c, i) => (
              <span key={i} className="ma-cite">
                {c.citation ?? `${c.actTitle ?? 'Act'} § ${c.sectionNumber ?? '?'}`}
              </span>
            ))}
          </div>
        </PanelBlock>
      )}
    </div>
  );
}

function PanelBlock(props: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>{props.label}</div>
      {props.children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

function Review(props: { sessionId: string; onBack: () => void }): JSX.Element {
  const session = useMockArgSession(props.sessionId);
  const rerun = useRerunMockArgReview();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [rerunError, setRerunError] = useState<string | null>(null);

  if (session.isLoading || !session.data) {
    return <div className="muted body-md" style={{ padding: 'var(--space-5)' }}>Loading review…</div>;
  }
  const s = session.data;
  const r = s.review;
  const userTurnsWithRating = s.turns.filter((t) => t.speaker === 'user' && t.rating);
  const canRerun = s.status === 'concluded';

  async function downloadPdf(): Promise<void> {
    if (!session.data) return;
    setExporting(true);
    setExportError(null);
    try {
      await exportMockArgumentSessionPdf(session.data);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'PDF export failed');
    } finally {
      setExporting(false);
    }
  }

  async function handleRerun(): Promise<void> {
    setRerunError(null);
    try {
      await rerun.mutateAsync(props.sessionId);
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : 'Re-run failed');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Header */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="eyebrow">Session review</div>
          <h2 className="heading-xl" style={{ margin: 'var(--space-2) 0 var(--space-1)' }}>
            {s.matterSummary.title}
          </h2>
          <div className="body-xs">
            {new Date(s.startedAt).toLocaleDateString()} ·{' '}
            {s.turns.length} turn{s.turns.length === 1 ? '' : 's'}
            {r && (
              <> · last reviewed {new Date(r.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
            )}
          </div>
        </div>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          {canRerun && (
            <button
              className="btn"
              onClick={() => { void handleRerun(); }}
              disabled={rerun.isPending}
              title="Re-score this session with a fresh LLM pass. Useful when the prior review was incomplete."
            >
              <Icon name="more" />
              {rerun.isPending ? 'Re-running…' : 'Re-run review'}
            </button>
          )}
          <button
            className="btn"
            onClick={() => { void downloadPdf(); }}
            disabled={exporting}
          >
            <Icon name="download" />
            {exporting ? 'Preparing…' : 'Download PDF'}
          </button>
          <button className="btn btn-ghost" onClick={props.onBack}>
            <Icon name="arrow" /> Back
          </button>
        </div>
      </div>

      {exportError && (
        <div
          className="body-sm"
          style={{ color: 'var(--danger)', padding: 'var(--space-3)', background: 'var(--danger-bg)', borderRadius: 'var(--radius-sm)' }}
        >
          PDF export failed: {exportError}
        </div>
      )}

      {rerunError && (
        <div
          className="body-sm"
          style={{ color: 'var(--danger)', padding: 'var(--space-3)', background: 'var(--danger-bg)', borderRadius: 'var(--radius-sm)' }}
        >
          Re-run failed: {rerunError}
        </div>
      )}

      {!r && (
        <div className="card">
          <div className="body-md muted">No review has been generated yet for this session.</div>
        </div>
      )}

      {r && (() => {
        const dims = [
          r.rubric.legalSoundness, r.rubric.citationUse, r.rubric.structure,
          r.rubric.persuasiveness, r.rubric.responsiveness,
        ];
        const allZero = dims.every((d) => d === 0) && r.rubric.overall === 0;
        if (!allZero) return null;
        return (
          <div
            role="status"
            style={{
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--warning-bg)',
              color: 'var(--warning)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}
          >
            <div style={{ fontSize: 13, lineHeight: 1.55 }}>
              <strong>Scores didn't parse from this run.</strong>{' '}
              The qualitative review below is real, but the LLM didn't return numeric scores in a
              shape we could read. Click <em>Re-run review</em> above to try again, or expand the
              raw response so the team can see the exact shape and extend the parser.
            </div>
            {r.llmRawResponse ? (
              <details style={{ fontSize: 12 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                  View raw LLM response ({r.llmRawResponse.length.toLocaleString()} chars)
                </summary>
                <pre
                  style={{
                    marginTop: 'var(--space-2)',
                    padding: 'var(--space-3)',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontSize: 11,
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 400,
                    overflow: 'auto',
                  }}
                >
                  {r.llmRawResponse}
                </pre>
              </details>
            ) : (
              <div className="body-xs" style={{ color: 'var(--warning)', opacity: 0.85 }}>
                Raw response wasn't captured for this row — re-run the review to populate it (column
                added in migration 0037).
              </div>
            )}
          </div>
        );
      })()}

      {r && (
        <>
          {/* Hero: donut + qualitative summary */}
          <div className="card facts-meta" style={{ alignItems: 'center' }}>
            <div className="ma-score-donut" style={{ ['--pct' as never]: r.rubric.overall }}>
              <div className="ma-score-value">
                <span className="ma-score-num">{Math.round(r.rubric.overall)}</span>
                <span className="ma-score-of">/ 100</span>
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 'var(--space-2)' }}>Overall</div>
              <div className="body-md" style={{ lineHeight: 1.55 }}>
                {r.qualitativeSummary || 'No qualitative summary generated.'}
              </div>
            </div>
          </div>

          {/* Rubric bars */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>Rubric</div>
            <div className="facts-grid-2" style={{ gap: 'var(--space-5) var(--space-7)' }}>
              <RubricBar label="Legal soundness" score={r.rubric.legalSoundness} />
              <RubricBar label="Citation use"    score={r.rubric.citationUse} />
              <RubricBar label="Structure"       score={r.rubric.structure} />
              <RubricBar label="Persuasiveness"  score={r.rubric.persuasiveness} />
              <RubricBar label="Responsiveness"  score={r.rubric.responsiveness} />
            </div>
          </div>

          {/* Strengths / weaknesses */}
          <div className="facts-grid-2" style={{ gap: 'var(--space-5)' }}>
            <ListCard title="Strengths" items={r.strengths} dot="sage" />
            <ListCard title="Weaknesses" items={r.weaknesses} dot="vermillion" />
          </div>

          {/* Where to improve — concrete rewrites with score lift */}
          {r.improvements.length > 0 && (
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--space-3)' }}>
                <div>
                  <div className="eyebrow">Where to improve</div>
                  <div className="body-sm muted" style={{ marginTop: 'var(--space-1)' }}>
                    Concrete rewrites for your weakest turns. Argue this way next time and the
                    estimated overall score lifts by the value shown.
                  </div>
                </div>
                <div className="row" style={{ gap: 'var(--space-2)', alignItems: 'baseline' }}>
                  <span className="heading-lg">
                    +{r.improvements.reduce((sum, imp) => sum + imp.projectedLift, 0)}
                  </span>
                  <span className="body-xs">total lift</span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {r.improvements.map((imp, i) => (
                  <ImprovementCard key={i} improvement={imp} />
                ))}
              </div>
            </div>
          )}

          {/* Missed arguments */}
          {r.missedArguments.length > 0 && (
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
                Arguments a strong advocate would have raised
              </div>
              <ul style={{ paddingLeft: 'var(--space-4)', margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {r.missedArguments.map((m, i) => (
                  <li key={i}>
                    <div className="body-md" style={{ fontWeight: 500 }}>{m.point}</div>
                    {(m.statute || m.judgment) && (
                      <div className="body-xs" style={{ marginTop: 'var(--space-1)' }}>
                        {m.statute ?? ''} {m.judgment ? `· ${m.judgment}` : ''}
                      </div>
                    )}
                    {m.why && <div className="body-sm" style={{ marginTop: 'var(--space-1)' }}>{m.why}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Study list */}
          {r.studyList.length > 0 && (
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
                Read before your next session
              </div>
              <ul style={{ paddingLeft: 'var(--space-4)', margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {r.studyList.map((it, i) => (
                  <li key={i}>
                    <div className="body-md" style={{ fontWeight: 500 }}>{it.title}</div>
                    {it.citation && (
                      <div className="body-xs" style={{ marginTop: 'var(--space-1)' }}>{it.citation}</div>
                    )}
                    {it.why && <div className="body-sm" style={{ marginTop: 'var(--space-1)' }}>{it.why}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Per-turn breakdown */}
          {userTurnsWithRating.length > 0 && (
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>
                Turn-by-turn breakdown
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {userTurnsWithRating.map((t) => (
                  <TurnRatingCard key={t.id} turn={t} rating={t.rating!} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RubricBar(props: { label: string; score: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (props.score / 5) * 100));
  return (
    <div>
      <div className="ma-rubric-row">
        <div className="ma-rubric-label">{props.label}</div>
        <div className="ma-rubric-score">{props.score.toFixed(1)}</div>
      </div>
      <div className="ma-rubric-bar"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function ListCard(props: { title: string; items: string[]; dot: 'sage' | 'vermillion' }): JSX.Element {
  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 'var(--space-3)' }}>{props.title}</div>
      {props.items.length === 0 ? (
        <div className="body-sm muted">None recorded.</div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {props.items.map((s, i) => (
            <li key={i} className="body-md" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
              <span className={`dot dot-${props.dot}`} style={{ marginTop: 8, flexShrink: 0 }} />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TurnRatingCard(props: { turn: MaTurn; rating: MaTurnRating }): JSX.Element {
  const { turn, rating } = props;
  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div className="eyebrow">Turn {turn.turnNumber}</div>
        {rating.comment && (
          <div className="body-xs" style={{ maxWidth: '70%', textAlign: 'right', textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontStyle: 'italic' }}>
            "{rating.comment}"
          </div>
        )}
      </div>
      <div className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>
        {turn.transcript.length > 400 ? `${turn.transcript.slice(0, 400)}…` : turn.transcript}
      </div>
      <div className="facts-grid-5">
        <MiniRubric label="Legal" v={rating.legalSoundness} />
        <MiniRubric label="Citations" v={rating.citationUse} />
        <MiniRubric label="Structure" v={rating.structure} />
        <MiniRubric label="Persuasive" v={rating.persuasiveness} />
        <MiniRubric label="Responsive" v={rating.responsiveness} />
      </div>
    </div>
  );
}

function MiniRubric(props: { label: string; v: number }): JSX.Element {
  const pct = Math.max(0, Math.min(100, (props.v / 5) * 100));
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-1)' }}>
        <div className="body-xs">{props.label}</div>
        <div className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{props.v.toFixed(1)}</div>
      </div>
      <div className="ma-rubric-bar"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** A single "Where to improve" card — turn header on top, dims chips +
 *  projected lift on the right, then two stacked boxes (You said /
 *  Stronger). Stacked rather than side-by-side so long quotes stay
 *  readable on narrow viewports. */
const DIM_LABELS: Record<string, string> = {
  legalSoundness: 'Legal soundness',
  citationUse: 'Citation use',
  structure: 'Structure',
  persuasiveness: 'Persuasiveness',
  responsiveness: 'Responsiveness',
};

function ImprovementCard(props: { improvement: MaImprovement }): JSX.Element {
  const imp = props.improvement;
  return (
    <div
      style={{
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="eyebrow">Turn {imp.turnNumber}</span>
          {imp.weakDimensions.map((d) => (
            <span key={d} className="badge">{DIM_LABELS[d] ?? d}</span>
          ))}
        </div>
        {imp.projectedLift > 0 && (
          <span className="badge badge-sage" style={{ fontVariantNumeric: 'tabular-nums' }}>
            +{imp.projectedLift} pts
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-1)' }}>You said</div>
          <div
            style={{
              padding: 'var(--space-3)',
              background: 'var(--bg-surface-2)',
              borderLeft: '3px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 13,
              lineHeight: 1.5,
              fontStyle: 'italic',
              color: 'var(--text-secondary)',
              whiteSpace: 'pre-wrap',
            }}
          >
            "{imp.currentExcerpt}"
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 'var(--space-1)' }}>Stronger version</div>
          <div
            style={{
              padding: 'var(--space-3)',
              background: 'var(--success-bg)',
              borderLeft: '3px solid var(--success)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 14,
              lineHeight: 1.55,
              color: 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {imp.betterVersion}
          </div>
        </div>
      </div>

      {imp.rationale && (
        <div className="body-sm muted" style={{ fontStyle: 'italic' }}>
          {imp.rationale}
        </div>
      )}
    </div>
  );
}
