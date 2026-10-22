import { lazy, Suspense, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorState, Icon, Skeleton } from '@lexdraft/ui';
import { PageHeader } from '@/components/PageHeader';
import { MoreMenu } from '@/components/MoreMenu';
import { CaseBillingTab, CaseFilingsTab, CaseHearingsTab, CaseWorkTab, belongsToMatter } from '@/components/case/CaseTabs';
import { useCan } from '@/hooks/useFirmAdmin';
import {
  useCase,
  useCases,
  useCaseTimeline,
  useSyncCaseFromEcourts,
  useCaseActs,
  useCaseParties,
  type CaseWithPipeline,
  type EcourtsSyncResult,
} from '@/hooks/useCases';
import type { MatterTimelineEvent } from '@lexdraft/types';
import { PipelineBuilder } from '@/components/pipeline/PipelineBuilder';
import { NewHearingModal } from '@/components/NewHearingModal';
import { NewTaskModal } from '@/components/NewTaskModal';
import { NewDocumentModal } from '@/components/NewDocumentModal';
import { CaseDocumentsPanel } from '@/components/CaseDocumentsPanel';
import { CaseNotesPanel } from '@/components/CaseNotesPanel';
import { CaseLeadHandover } from '@/components/CaseLeadHandover';
import { MatterIntelPanel } from '@/components/matter-intel/MatterIntelPanel';
import { CopyButton } from '@/components/CopyButton';
import { EcourtsLinkCard } from '@/components/ecourts/EcourtsLinkCard';
import { EcourtsCaseSnapshot } from '@/components/ecourts/EcourtsCaseSnapshot';
import { Modal } from '@/components/Modal';
import { useUpdateMatterVisibility } from '@/hooks/usePortalAdmin';
import { useGenerateEngagementLetter } from '@/hooks/useEngagement';
import { useTaskBoard } from '@/hooks/useTasks';
import { useUIStore } from '@/store/ui';
import { useHasTeamChat } from '@/hooks/useTeamChat';
import { MatterDiscussionPanel } from '@/components/team-chat/MatterDiscussionPanel';

// The full eCourts Case History lives in the eCourts view's bundle; load it
// only when the tab is opened.
const EcourtsCaseRecord = lazy(() => import('@/views/EcourtsView').then((m) => ({ default: m.EcourtsCaseRecord })));

// The case page is the hub for one matter: everything about it is one tab
// away. `?tab=<id>` deep-links (the case-create flow lands on documents).
const CASE_TABS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'ecourts',      label: 'eCourts' },
  { id: 'hearings',     label: 'Hearings' },
  { id: 'documents',    label: 'Documents' },
  { id: 'filings',      label: 'Filings & Applications' },
  { id: 'work',         label: 'Tasks & Deadlines' },
  { id: 'billing',      label: 'Billing' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'discussion',   label: 'Discussion' },
] as const;
type CaseTab = (typeof CASE_TABS)[number]['id'];
const isCaseTab = (t: string | null): t is CaseTab => CASE_TABS.some((x) => x.id === t);

export function CaseDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useCase(id);
  const timeline = useCaseTimeline(id);
  const parties = useCaseParties(id);
  const acts = useCaseActs(id);
  const taskBoard = useTaskBoard();
  const [docOpen, setDocOpen] = useState(false);
  const [hearingOpen, setHearingOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [engagementLetter, setEngagementLetter] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTabState] = useState<CaseTab>(isCaseTab(urlTab) ? urlTab : 'overview');
  // Keep the tab in the URL so refresh / back / shared links land on it.
  const setActiveTab = (t: CaseTab) => {
    setActiveTabState(t);
    const next = new URLSearchParams(searchParams);
    if (t === 'overview') next.delete('tab'); else next.set('tab', t);
    setSearchParams(next, { replace: true });
  };
  const hasTeamChat = useHasTeamChat();
  const canBill = useCan('billing.view');
  const canDraft = useCan('drafting.ai');
  const updateVisibility = useUpdateMatterVisibility();
  const generateLetter = useGenerateEngagementLetter();
  const showToast = useUIStore((s) => s.showToast);
  const syncFromEcourts = useSyncCaseFromEcourts();
  // The sync mutation returns a rich diff payload we want to show *after* the
  // case row finishes updating — stash it in local state so the modal stays
  // mounted independent of the mutation lifecycle.
  const [ecourtsSyncResult, setEcourtsSyncResult] = useState<EcourtsSyncResult | null>(null);

  // ---- "Connect matters" flow (eCourts status strip -> filtered matters list
  // -> here with ?focus=ecourts&from=ecourts). Jump to the connection card,
  // and once linked offer the next unconnected matter or go back to eCourts.
  const focusEcourts = searchParams.get('focus') === 'ecourts';
  const fromEcourts = searchParams.get('from') === 'ecourts';
  const [linkedJustNow, setLinkedJustNow] = useState<'linked' | 'pending' | null>(null);
  const remaining = useCases({ ecourts: 'attention' }, { enabled: fromEcourts });
  const nextToConnect = remaining.data?.find((m) => m.id !== id) ?? null;

  // Navigating to the next matter reuses this component - reset per matter.
  useEffect(() => { setLinkedJustNow(null); }, [id]);

  useEffect(() => {
    if (!focusEcourts || !data) return;
    setActiveTabState('overview');
    const t = window.setTimeout(() => {
      document.getElementById('ecourts-connection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => window.clearTimeout(t);
  }, [focusEcourts, data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nothing left to connect -> back to the eCourts page automatically.
  useEffect(() => {
    if (!linkedJustNow || !fromEcourts || remaining.isFetching || !remaining.data || nextToConnect) return;
    showToast({ type: 'sage', text: 'All matters are connected to eCourts.' });
    const t = window.setTimeout(() => navigate('/app/ecourts'), 1500);
    return () => window.clearTimeout(t);
  }, [linkedJustNow, fromEcourts, remaining.isFetching, remaining.data, nextToConnect]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = fromEcourts
    ? { label: 'Matters to connect', to: '/app/cases?ecourts=attention' }
    : { label: 'Cases', to: '/app/cases' };

  if (isLoading) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <PageHeader back={back} title={<Skeleton width={320} height={28} />} />
        <div className="card"><span className="muted">Loading matter…</span></div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <PageHeader back={back} title="Matter" />
        <ErrorState
          title="Couldn’t load matter"
          description={error instanceof Error ? error.message : 'The matter could not be found.'}
        />
      </div>
    );
  }

  const c: CaseWithPipeline = data;

  // Tasks are stored firm-wide. Linked ones carry caseId (migration 0089);
  // older/unmatched ones only their matter title, matched case-insensitively.
  const caseTasks = Object.values(taskBoard.data ?? {})
    .flat()
    .filter((t) => belongsToMatter({ caseId: t.caseId, label: t.case }, { id: c.id, title: c.title }));

  const handleGenerateEngagement = async (): Promise<void> => {
    try {
      const result = await generateLetter.mutateAsync({ caseId: c.id });
      setEngagementLetter(result.text);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not generate engagement letter';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const handleSyncFromEcourts = async (): Promise<void> => {
    try {
      const result = await syncFromEcourts.mutateAsync({ id: c.id });
      setEcourtsSyncResult(result);
      const n = Object.keys(result.sync.changes).length;
      const h = result.sync.hearingsReplaced;
      const a = result.sync.actsReplaced;
      const p = result.sync.partiesReplaced;
      showToast({
        type: 'sage',
        text: n > 0 || h > 0 || a > 0 || p > 0
          ? `Synced from eCourts: ${n} field${n === 1 ? '' : 's'}, ${h} hearing${h === 1 ? '' : 's'}, ${p} part${p === 1 ? 'y' : 'ies'}, ${a} act${a === 1 ? '' : 's'}`
          : 'Already up to date with eCourts',
      });
    } catch (err) {
      const e = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
      const msg = e?.response?.data?.error ?? (err as Error).message ?? 'Could not sync from eCourts';
      // 503 = eCourts itself is down. Not the advocate's mistake, and the
      // scheduled runs will catch it up - say so in amber, not red.
      showToast({ type: e?.response?.status === 503 ? 'amber' : 'vermillion', text: msg });
    }
  };

  const hasRealCnr = /^[A-Za-z]{4}[A-Za-z0-9]{12}$/.test((c.cnr ?? '').trim());

  const openDraft = () => navigate('/app/draft', {
    state: {
      caseContext: {
        id: c.id,
        title: c.title,
        cnr: c.cnr,
        court: c.court,
        client: c.client,
        type: c.type,
        stage: c.stage,
      },
    },
  });

  const hearingCount = (timeline.data ?? []).filter((e) => e.kind === 'hearing').length;
  const openTasks = caseTasks.filter((t) => t.column !== 'done').length;
  const ecourtsCourt = c.ecourtsCourtTier ?? 'DC';
  const tabs = CASE_TABS.filter((t) =>
    (t.id !== 'discussion' || hasTeamChat) && (t.id !== 'billing' || canBill) && (t.id !== 'ecourts' || hasRealCnr));
  const tabCount: Partial<Record<CaseTab, number>> = { hearings: hearingCount, work: openTasks };
  // A deep link to a tab this user can't see (e.g. ?tab=billing) falls back.
  const current: CaseTab = tabs.some((t) => t.id === activeTab) ? activeTab : 'overview';

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <PageHeader
        back={back}
        title={<em className="case-name">{c.title}</em>}
        description={<>{c.court} · For {c.client}</>}
        actions={<>
          <MoreMenu
            items={[
              ...(canDraft ? [{ label: 'Draft for this matter', icon: 'draft' as const, onSelect: openDraft, title: 'Its details and notes are pulled in as context' }] : []),
              { label: 'Upload document', icon: 'upload', onSelect: () => setDocOpen(true) },
              { label: 'Add pending', icon: 'tasks', onSelect: () => setTaskOpen(true) },
              {
                label: 'Prepare eFiling',
                icon: 'efiling',
                onSelect: () => navigate(`/app/efiling?case=${encodeURIComponent(c.id)}`),
                title: 'Prepare a filing for the eCourts eFiling portal and track it until the court registers it',
              },
              {
                label: generateLetter.isPending ? 'Generating engagement letter…' : 'Generate engagement letter',
                icon: 'mail',
                onSelect: () => { void handleGenerateEngagement(); },
                disabled: generateLetter.isPending,
                title: "Uses the firm's default template for this matter type",
              },
            ]}
          />
          <button
            type="button"
            className="btn"
            onClick={() => { void handleSyncFromEcourts(); }}
            disabled={syncFromEcourts.isPending || !hasRealCnr}
            title={hasRealCnr
              ? 'Pull latest case status, hearings, and orders from the eCourts gateway'
              : 'Link this matter to eCourts first (see the eCourts connection card in Overview)'}
          >
            <Icon name="ecourts" size={14} />{' '}
            {syncFromEcourts.isPending ? 'Syncing…' : 'Sync eCourts'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setHearingOpen(true)}
          >
            <Icon name="plus" size={14} /> Hearing
          </button>
        </>}
      >
        <span className="badge badge-sage">{c.status.toUpperCase()}</span>
        <span className="badge badge-cobalt">{String(c.type).toUpperCase()}</span>
        <span className="body-sm muted">CNR <CopyButton value={c.cnr} /></span>
        <span className="body-sm" style={{ color: c.next ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
          Next date: <strong className="mono tabular">{c.next || 'not posted'}</strong>
        </span>
        <label
          className="row"
          style={{ gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}
          title="When enabled, this matter is visible in the client portal."
        >
          <input
            type="checkbox"
            checked={!!c.visibleToClient}
            disabled={!c.id || updateVisibility.isPending}
            onChange={(e) => updateVisibility.mutate({
              id: c.id, visibleToClient: e.target.checked,
            })}
          />
          Visible to client
        </label>
      </PageHeader>

      {/* Tab strip */}
      <div className="matter-intel-tabs case-tabs" role="tablist" aria-label="Matter sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={current === t.id}
            className={`matter-intel-tab${current === t.id ? ' is-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
            {tabCount[t.id] ? <span className="case-tab-count">{tabCount[t.id]}</span> : null}
          </button>
        ))}
      </div>

      {current === 'discussion' && hasTeamChat && (
        <MatterDiscussionPanel caseId={c.id} />
      )}

      {current === 'hearings' && (
        <CaseHearingsTab
          timeline={timeline.data}
          isLoading={timeline.isLoading}
          onAddHearing={() => setHearingOpen(true)}
        />
      )}

      {current === 'ecourts' && hasRealCnr && (
        <Suspense fallback={<div className="card"><span className="muted">Loading eCourts record…</span></div>}>
          <EcourtsCaseRecord cnr={c.cnr.trim().toUpperCase()} court={ecourtsCourt} />
        </Suspense>
      )}

      {current === 'filings' && <CaseFilingsTab caseId={c.id} />}

      {current === 'work' && (
        <CaseWorkTab
          caseId={c.id}
          title={c.title}
          cnr={c.cnr}
          tasks={caseTasks}
          tasksLoading={taskBoard.isLoading}
          onAddTask={() => setTaskOpen(true)}
        />
      )}

      {current === 'billing' && canBill && <CaseBillingTab caseId={c.id} title={c.title} client={c.client} />}

      {current === 'documents' && <CaseDocumentsPanel matterTitle={c.title} />}

      {current === 'intelligence' && (
        <MatterIntelPanel caseId={c.id} matterTitle={c.title} />
      )}

      {current === 'overview' && (
      <>
      {/* BODY - two columns */}
      <div className="case-body split-2-wide" style={{ gap: 24 }}>
        {/* LEFT */}
        <div className="col" style={{ gap: 24 }}>
          {/* eCourts first: a linked matter opens on its live court status. */}
          {hasRealCnr ? (
            <EcourtsCaseSnapshot cnr={c.cnr.trim().toUpperCase()} court={ecourtsCourt} onOpenRecord={() => setActiveTab('ecourts')} />
          ) : (
            <div className="card row" style={{ gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div className="col" style={{ gap: 2 }}>
                <span className="heading-sm">Not connected to eCourts</span>
                <span className="body-sm muted">Add the real CNR (or case number) and LexDraft brings in its status, hearings, orders and parties.</span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => document.getElementById('ecourts-connection')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                Connect to eCourts
              </button>
            </div>
          )}

          {/* PIPELINE BUILDER — this matter's own branching pipeline graph.
              Stages, branches and conditions are per-case (migration 0054). */}
          <div className="card">
            <PipelineBuilder caseId={c.id} />
          </div>

          {/* Case meta */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Matter</div>
            <h2 className="heading-md" style={{ marginBottom: 12 }}>Particulars</h2>
            <div className="grid-2" style={{ gap: 16 }}>
              <MetaItem label="CNR"        value={c.cnr}         mono copyable />
              <MetaItem label="Court"      value={c.court} />
              <MetaItem label="Stage"      value={String(c.stage)} />
              <MetaItem label="Status"     value={c.status} />
              <MetaItem label="Client"     value={c.client} />
              <MetaItem label="Next date"  value={c.next}        mono />
              {c.judge && <MetaItem label="Bench" value={c.judge} />}
              {c.filingNo && <MetaItem label="Filing No." value={c.filingNo} mono copyable />}
              {c.firNo && (
                <MetaItem
                  label="FIR"
                  value={`${c.firNo}/${c.firYear ?? ''}${c.firDetails ? ` · ${c.firDetails.split('^').filter(Boolean).join(' · ')}` : ''}`}
                />
              )}
              {c.ecourtsSyncedAt && (
                <MetaItem
                  label="Last eCourts sync"
                  value={new Date(c.ecourtsSyncedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                />
              )}
            </div>
          </div>

          {/* eCourts connection - status + link a manual / unfound matter. */}
          {linkedJustNow && fromEcourts ? (
            <div className="card row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap', borderColor: 'var(--success, var(--border))' }} role="status">
              <span className={`dot ${linkedJustNow === 'linked' ? 'dot-sage' : 'dot-amber'}`} style={{ flexShrink: 0 }} />
              <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                <div className="heading-sm">
                  {linkedJustNow === 'linked' ? 'Connected to eCourts' : 'CNR saved. Connects when eCourts is back'}
                </div>
                <p className="body-sm muted">
                  {remaining.isFetching
                    ? 'Checking what is left to connect…'
                    : nextToConnect
                      ? `${remaining.data?.filter((m) => m.id !== c.id).length ?? 0} more to connect. Next: ${nextToConnect.title}`
                      : 'Every live matter is connected. Taking you back to eCourts…'}
                </p>
              </div>
              {nextToConnect ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => navigate(`/app/cases/${nextToConnect.id}?focus=ecourts&from=ecourts`)}
                >
                  Next matter →
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/app/ecourts')}>
                Back to eCourts
              </button>
            </div>
          ) : null}
          <EcourtsLinkCard
            key={`${c.id}:${c.ecourtsLinkStatus ?? ''}`}
            c={c}
            onLinked={(s) => setLinkedJustNow(s)}
          />

          {/* Lead advocate + handover (case_assignments). */}
          <CaseLeadHandover caseId={c.id} caseTitle={c.title} />

          {/* Acts & sections — populated by the eCourts sync (case_acts table). */}
          {(acts.data?.length ?? 0) > 0 && (
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Statute</div>
              <h2 className="heading-md" style={{ marginBottom: 12 }}>Acts & sections</h2>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {acts.data!.map((a) => (
                  <span key={a.id} className="badge" style={{ fontFamily: 'var(--font-mono)' }}>
                    {a.actName} §{a.section}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Timeline — stage transitions, hearings, documents, notes,
              merged newest-first from /api/cases/:id/timeline. */}
          <div>
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <h2 className="heading-lg">Matter diary</h2>
              <span className="spacer" />
              <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                {timeline.data?.length ?? 0} ENTRIES
              </span>
            </div>
            {timeline.isLoading ? (
              <p className="body-md muted">Loading diary…</p>
            ) : timeline.isError ? (
              <p className="body-sm" style={{ color: 'var(--danger)' }}>
                Could not load diary. {(timeline.error as Error)?.message ?? ''}
              </p>
            ) : (timeline.data?.length ?? 0) === 0 ? (
              <p className="body-md muted">
                No diary entries yet. Stage moves, next dates, filings and notes will appear here.
              </p>
            ) : (
              <div className="col" style={{ gap: 10 }}>
                {timeline.data!.map((e) => (
                  <TimelineRow key={e.id} event={e} />
                ))}
              </div>
            )}
          </div>

          {/* Parties — populated by the eCourts sync (case_parties table).
              Falls back to a hint when the matter has never been synced. */}
          <div>
            <div className="row" style={{ alignItems: 'flex-end', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border-default)' }}>
              <h2 className="heading-lg">Parties</h2>
              <span className="spacer" />
              {(parties.data?.length ?? 0) > 0 && (
                <span className="mono" style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}>
                  {parties.data!.length} ON RECORD
                </span>
              )}
            </div>
            {parties.isLoading ? (
              <p className="body-md muted">Loading parties…</p>
            ) : (parties.data?.length ?? 0) === 0 ? (
              <p className="body-md muted">
                No parties on record. Click <strong>Sync from eCourts</strong> in the header to import them, or add manually when the matter file is opened.
              </p>
            ) : (
              <div className="grid-2">
                {parties.data!.map((p) => (
                  <div key={p.id} className="card" style={{ padding: 20 }}>
                    <div className="eyebrow" style={{ marginBottom: 6, textTransform: 'uppercase' }}>{p.side}</div>
                    <div className="heading-md" style={{ marginBottom: 4 }}>{p.partyName}</div>
                    {p.roleLabel && (
                      <div className="body-sm muted" style={{ marginBottom: 12 }}>{p.roleLabel}</div>
                    )}
                    {p.advocateName && (
                      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)' }}>
                        COUNSEL: {p.advocateName}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes - typed memos or uploaded files; AI drafting can pull these
              in as context when generating documents for this matter. */}
          <CaseNotesPanel caseId={c.id} matterTitle={c.title} />
        </div>

        {/* RIGHT */}
        <div className="col" style={{ gap: 24 }}>
          {/* Next date — when the matter is next posted on the cause-list. */}
          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Next date</div>
            {c.next ? (
              <div className="mono tabular" style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
                {c.next}
              </div>
            ) : (
              <p className="body-md muted" style={{ marginBottom: 16 }}>Not posted to a date yet.</p>
            )}
            {canDraft && (
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn btn-primary btn-block" onClick={openDraft}>
                  Prepare brief
                </button>
              </div>
            )}
          </div>

          {/* At a glance - one line per hub tab, each jumping to it. */}
          <div className="card">
            <div className="heading-md" style={{ marginBottom: 8 }}>At a glance</div>
            <ul className="dash-list">
              <GlanceRow label="Hearings on record" value={String(hearingCount)} onOpen={() => setActiveTab('hearings')} />
              <GlanceRow
                label="Open pendings"
                value={taskBoard.isLoading ? '…' : String(openTasks)}
                onOpen={() => setActiveTab('work')}
              />
              <GlanceRow label="Filings & applications" value="View" onOpen={() => setActiveTab('filings')} />
              {canBill && <GlanceRow label="Invoices & expenses" value="View" onOpen={() => setActiveTab('billing')} />}
            </ul>
          </div>

          {/* Recent documents have moved to the unified Timeline (left
              column) which streams document uploads alongside hearings and
              stage moves. A dedicated card here would duplicate that. */}
        </div>
      </div>
      </>
      )}

      <EngagementLetterPreview
        text={engagementLetter}
        caseTitle={c.title}
        onClose={() => setEngagementLetter(null)}
      />

      <EcourtsSyncResultModal
        result={ecourtsSyncResult}
        onClose={() => setEcourtsSyncResult(null)}
      />

      <NewDocumentModal open={docOpen} onClose={() => setDocOpen(false)} defaultCase={c.title} />
      <NewHearingModal
        open={hearingOpen}
        onClose={() => setHearingOpen(false)}
        defaultCase={c.title}
        defaultCaseId={c.id}
        defaultCourt={c.court}
        defaultDate={c.next || undefined}
      />
      <NewTaskModal
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        defaultCase={c.title}
        lockCase
      />

    </div>
  );
}

/* ---------- Inline helpers ---------- */

function GlanceRow({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="dash-row" onClick={onOpen}>
        <span className="dash-row-main"><span className="body-sm">{label}</span></span>
        <span className="mono tabular body-sm">{value}</span>
        <Icon name="chevron" size={14} />
      </button>
    </li>
  );
}

function MetaItem({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** When true, render the value as a CopyButton so advocates can grab
   *  long identifiers (CNR, file numbers) without a select-all gesture. */
  copyable?: boolean;
}) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div className={mono && !copyable ? 'mono tabular' : ''} style={{ fontSize: 14, color: 'var(--text-primary)' }}>
        {copyable ? <CopyButton value={value} mono={mono} /> : value}
      </div>
    </div>
  );
}

/**
 * Preview modal for a freshly generated engagement letter.
 *
 * The shared `DocumentViewerModal` is wired to fetch its body from the
 * documents / drafts API by id; a generated-on-the-fly letter has no id, so
 * we render it through the generic `Modal` chrome instead. Same affordances -
 * scrollable preview, close, copy to clipboard - without coupling the
 * generated text to the persistence layer.
 */
function EngagementLetterPreview({
  text,
  caseTitle,
  onClose,
}: {
  text: string | null;
  caseTitle: string;
  onClose: () => void;
}) {
  const showToast = useUIStore((s) => s.showToast);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    if (!text) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      showToast({ type: 'sage', text: 'Engagement letter copied' });
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      showToast({ type: 'vermillion', text: 'Could not copy letter' });
    }
  };

  return (
    <Modal
      open={text !== null}
      onClose={onClose}
      title="Engagement letter"
      eyebrow={caseTitle}
      description="Generated from the firm's default template for this matter type. Review carefully before sending."
      width={920}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { void handleCopy(); }}>
            <Icon name={copied ? 'check' : 'documents'} size={12} />{' '}
            {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
        </>
      }
    >
      <pre
        style={{
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: 20,
          margin: 0,
          minHeight: 320,
          maxHeight: '60vh',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'var(--font-serif, Georgia, serif)',
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--text-primary)',
        }}
      >
        {text ?? ''}
      </pre>
    </Modal>
  );
}

function EcourtsSyncResultModal({
  result,
  onClose,
}: {
  result: EcourtsSyncResult | null;
  onClose: () => void;
}) {
  if (!result) return null;
  const { sync } = result;
  const changeEntries = Object.entries(sync.changes);
  return (
    <Modal
      open
      onClose={onClose}
      title="eCourts sync complete"
      eyebrow={result.title}
      description={
        sync.sideDetected
          ? `Detected your firm represents the ${sync.sideDetected}.`
          : 'Could not auto-detect which side your firm represents, so disposition mapping was skipped. Set the client name to match the petitioner or respondent and try again.'
      }
      width={720}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
      }
    >
      <div className="col stagger" style={{ gap: 20 }}>
        <SummaryRow
          label="FIELDS UPDATED"
          value={String(changeEntries.length)}
          detail={changeEntries.length === 0 ? 'Already up to date' : undefined}
        />
        <SummaryRow
          label="HEARINGS REPLACED"
          value={String(sync.hearingsReplaced)}
          detail="The full hearing history was re-imported from eCourts."
        />
        <SummaryRow
          label="ACTS / SECTIONS"
          value={String(sync.actsReplaced)}
          detail={sync.actsReplaced > 0 ? 'Refreshed from the court record.' : undefined}
        />
        <SummaryRow
          label="PARTIES"
          value={String(sync.partiesReplaced)}
          detail={sync.partiesReplaced > 0 ? 'Petitioner / respondent + extras imported.' : undefined}
        />

        {changeEntries.length > 0 && (
          <div className="col" style={{ gap: 8 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
              CHANGES
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Field</th>
                  <th>Was</th>
                  <th>Now</th>
                </tr>
              </thead>
              <tbody>
                {changeEntries.map(([field, { from, to }]) => (
                  <tr key={field}>
                    <td className="mono" style={{ fontSize: 12 }}>{field}</td>
                    <td className="body-sm muted">{fmtValue(from)}</td>
                    <td className="body-sm">{fmtValue(to)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(sync.surfaceOnly.transfers.length > 0
          || sync.surfaceOnly.finalOrders + sync.surfaceOnly.interimOrders > 0) && (
          <div className="col" style={{ gap: 8 }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
              ADDITIONAL DATA (NOT YET STORED)
            </div>
            <p className="body-sm muted">
              eCourts returned these too; LexDraft doesn't have columns for them yet. They'll appear in the eCourts gateway view in full.
            </p>
            <ul className="col" style={{ gap: 6, paddingLeft: 18, fontSize: 13 }}>
              {sync.surfaceOnly.transfers.length > 0
                && <li>{sync.surfaceOnly.transfers.length} court transfer{sync.surfaceOnly.transfers.length === 1 ? '' : 's'} recorded</li>}
              {sync.surfaceOnly.finalOrders + sync.surfaceOnly.interimOrders > 0
                && <li>{sync.surfaceOnly.finalOrders} final + {sync.surfaceOnly.interimOrders} interim order PDFs available in the eCourts view</li>}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SummaryRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="row" style={{ alignItems: 'baseline', gap: 16 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)', minWidth: 160 }}>{label}</span>
      <span className="heading-md tabular">{value}</span>
      {detail && <span className="body-sm muted">{detail}</span>}
    </div>
  );
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Not set';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function kindToColor(kind: MatterTimelineEvent['kind']): string {
  switch (kind) {
    case 'stage':       return 'var(--success, #2f7d32)';
    case 'hearing':     return 'var(--info, #2563eb)';
    case 'document':    return 'var(--warning, #b45309)';
    case 'application': return 'var(--accent, #7c3aed)';
    case 'note':        return 'var(--border-default)';
    default:            return 'var(--border-default)';
  }
}

function kindLabel(kind: MatterTimelineEvent['kind']): string {
  switch (kind) {
    case 'stage':       return 'STAGE';
    case 'hearing':     return 'HEARING';
    case 'document':    return 'DOCUMENT';
    case 'application': return 'APPLICATION';
    case 'note':        return 'NOTE';
    default:            return 'ENTRY';
  }
}

function TimelineRow({ event }: { event: MatterTimelineEvent }) {
  const date = event.at ? event.at.slice(0, 10) : '';
  return (
    <div
      className="card"
      style={{ padding: 18, borderLeft: `3px solid ${kindToColor(event.kind)}` }}
    >
      <div className="row" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div
          className="mono tabular"
          style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--text-tertiary)', minWidth: 92, paddingTop: 2 }}
        >
          {date}
        </div>
        <div style={{ flex: 1 }}>
          <div className="row" style={{ gap: 8, marginBottom: 4, alignItems: 'baseline' }}>
            <span
              className="mono"
              style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--text-tertiary)' }}
            >
              {kindLabel(event.kind)}
            </span>
            {event.actorName && (
              <span className="body-sm muted">· {event.actorName}</span>
            )}
          </div>
          <div className="heading-sm" style={{ marginBottom: event.body ? 4 : 0 }}>{event.title}</div>
          {event.body && <div className="body-sm muted">{event.body}</div>}
        </div>
      </div>
    </div>
  );
}
