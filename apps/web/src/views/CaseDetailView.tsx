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
import { NewHearingModal } from '@/components/NewHearingModal';
import { EditCaseModal } from '@/components/EditCaseModal';
import { NewTaskModal } from '@/components/NewTaskModal';
import { NewDocumentModal } from '@/components/NewDocumentModal';
import { CaseDocumentsPanel } from '@/components/CaseDocumentsPanel';
import { CaseNotesPanel } from '@/components/CaseNotesPanel';
import { CaseCoCounselTab } from '@/components/case/CaseCoCounselTab';
import { MatterIntelPanel } from '@/components/matter-intel/MatterIntelPanel';
import { CopyButton } from '@/components/CopyButton';
import { EcourtsLinkCard } from '@/components/ecourts/EcourtsLinkCard';
import { EcourtsCaseSnapshot } from '@/components/ecourts/EcourtsCaseSnapshot';
import { linkStatusDisplay } from '@/components/ecourts/linkStatus';
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
  { id: 'cocounsel',    label: 'Co-Counsel' },
  { id: 'ecourts',      label: 'eCourts' },
  { id: 'hearings',     label: 'Hearings' },
  { id: 'documents',    label: 'Documents' },
  { id: 'filings',      label: 'Filings' },
  { id: 'work',         label: 'Tasks' },
  { id: 'billing',      label: 'Billing' },
  { id: 'intelligence', label: 'AI insights' },
  { id: 'discussion',   label: 'Team chat' },
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
  const [editOpen, setEditOpen] = useState(false);
  const [diaryAll, setDiaryAll] = useState(false);
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
      <div className="col cs" aria-busy="true">
        <section className="cs-hero cs-loading-hero" aria-label="Loading matter">
          <Skeleton width={160} height={11} />
          <Skeleton width="62%" height={34} />
          <Skeleton width="44%" height={14} />
          <span className="cs-muted">Loading matter…</span>
        </section>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="col cs">
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
    <div className="col stagger cs">
      {/* HERO - who, where, what stage, and when it is next in court. */}
      <section className="cs-hero" aria-labelledby="case-hero-title">
        <div className="cs-hero-main">
          <div className="adv-eyebrow">{String(c.type)} matter · {c.status}</div>
          <h1 id="case-hero-title" className="cs-hero-title"><em className="case-name">{c.title}</em></h1>
          <p className="cs-hero-sub">
            {c.client ? <>Client: <strong>{c.client}</strong></> : <span className="cs-missing">No client added</span>}
            <span className="cs-hero-dot">·</span>
            {c.court ? <>Court: <strong>{c.court}</strong></> : <span className="cs-missing">No court added</span>}
            {(!c.client || !c.court) && (
              <button type="button" className="adv-link cs-hero-fill" onClick={() => setEditOpen(true)}>Add details</button>
            )}
          </p>
          <div className="cs-hero-tags">
            <span className="adv-pill">Stage: <strong>{String(c.stage)}</strong></span>
            {hasRealCnr ? (
              <>
                <span className="cs-hero-cnr">CNR <CopyButton value={c.cnr.toUpperCase()} mono /></span>
                <span className={`badge ${linkStatusDisplay(c.ecourtsLinkStatus).badge}`}>{linkStatusDisplay(c.ecourtsLinkStatus).label}</span>
              </>
            ) : (
              <span className="adv-pill">Not linked to eCourts</span>
            )}
            <label className="cs-hero-toggle" title="When enabled, this matter is visible in the client portal.">
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
          </div>
        </div>

        <NextDatePanel next={c.next} onAdd={() => setHearingOpen(true)} />

        <div className="cs-hero-actions">
          {hasRealCnr && (
            <button
              type="button"
              className="btn"
              onClick={() => { void handleSyncFromEcourts(); }}
              disabled={syncFromEcourts.isPending}
              title="Bring in the latest status, hearings and orders from eCourts"
            >
              <Icon name="ecourts" size={14} />{' '}
              {syncFromEcourts.isPending ? 'Updating…' : 'Update from eCourts'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setEditOpen(true)}>
            <Icon name="edit" size={14} /> Edit details
          </button>
          <MoreMenu
            items={[
              ...(canDraft ? [{ label: 'Draft a document with AI', icon: 'draft' as const, onSelect: openDraft, title: 'The case details and notes are used automatically' }] : []),
              { label: 'Upload a document', icon: 'upload', onSelect: () => setDocOpen(true) },
              { label: 'Add a task', icon: 'tasks', onSelect: () => setTaskOpen(true) },
              {
                label: 'File online (eFiling)',
                icon: 'efiling',
                onSelect: () => navigate(`/app/efiling?case=${encodeURIComponent(c.id)}`),
                title: 'Prepare a filing for the eCourts eFiling portal and track it until the court registers it',
              },
              {
                label: generateLetter.isPending ? 'Preparing engagement letter…' : 'Engagement letter for client',
                icon: 'mail',
                onSelect: () => { void handleGenerateEngagement(); },
                disabled: generateLetter.isPending,
                title: "Uses the firm's default template for this matter type",
              },
            ]}
            label="More actions"
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setHearingOpen(true)}
          >
            <Icon name="plus" size={14} /> Add hearing date
          </button>
        </div>
      </section>

      {/* Tab strip */}
      <div className="matter-intel-tabs case-tabs cs-tabs" role="tablist" aria-label="Matter sections">
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

      {current === 'cocounsel' && <CaseCoCounselTab caseId={c.id} caseTitle={c.title} />}

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
      <div className="cs-ov">
        {/* MAIN - live court status, the facts, and what happened. */}
        <div className="cs-ov-main">
          {linkedJustNow && fromEcourts ? (
            <div className="cs-banner" role="status">
              <span className="cs-banner-icon"><Icon name={linkedJustNow === 'linked' ? 'check' : 'limitation'} size={16} /></span>
              <div className="cs-banner-text">
                <div className="cs-banner-title">
                  {linkedJustNow === 'linked' ? 'Connected to eCourts' : 'CNR saved. Connects when eCourts is back'}
                </div>
                <p>
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

          {/* eCourts first: a linked matter opens on its live court status;
              an unlinked one on the card that links it (CNR or case number). */}
          {hasRealCnr ? (
            <EcourtsCaseSnapshot cnr={c.cnr.trim().toUpperCase()} court={ecourtsCourt} onOpenRecord={() => setActiveTab('ecourts')} />
          ) : (
            <EcourtsLinkCard
              key={`${c.id}:${c.ecourtsLinkStatus ?? ''}`}
              c={c}
              onLinked={(s) => setLinkedJustNow(s)}
            />
          )}

          {/* Notes - the case facts and working notes; AI drafting pulls these in. */}
          <CaseNotesPanel caseId={c.id} matterTitle={c.title} />

          {/* Matter diary - newest first, the latest five unless expanded. */}
          <div className="card">
            <div className="cs-card-head">
              <div className="cs-card-titles">
                <h2 className="cs-card-title">Case history</h2>
                <p className="cs-card-sub">Every hearing, stage change, filing and note, newest first.</p>
              </div>
              <span className="cs-count">
                {timeline.data?.length ?? 0} {(timeline.data?.length ?? 0) === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            {timeline.isLoading ? (
              <p className="cs-muted">Loading diary…</p>
            ) : timeline.isError ? (
              <p className="cs-muted">Could not load diary. {(timeline.error as Error)?.message ?? ''}</p>
            ) : (timeline.data?.length ?? 0) === 0 ? (
              <p className="cs-muted">Nothing yet. Every hearing, stage change, filing and note is recorded here automatically.</p>
            ) : (
              <>
                <ul className="cs-diary">
                  {(diaryAll ? timeline.data! : timeline.data!.slice(0, 5)).map((e) => (
                    <TimelineRow key={e.id} event={e} />
                  ))}
                </ul>
                {timeline.data!.length > 5 && (
                  <button type="button" className="adv-link cs-diary-more" onClick={() => setDiaryAll((v) => !v)}>
                    {diaryAll ? 'Show latest only' : `Show all ${timeline.data!.length} entries`}
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* SIDE - quick actions and the matter's particulars. */}
        <aside className="cs-ov-side">
          <div className="card cs-quick-card">
            <div className="cs-card-head"><h2 className="cs-card-title">What would you like to do?</h2></div>
            <div className="cs-quick">
              {canDraft && (
                <button type="button" className="btn btn-primary" onClick={openDraft}>
                  <Icon name="draft" size={14} /> Draft a document with AI
                </button>
              )}
              <button type="button" className="btn" onClick={() => setHearingOpen(true)}>
                <Icon name="calendar" size={14} /> Add a hearing date
              </button>
              <button type="button" className="btn" onClick={() => setDocOpen(true)}>
                <Icon name="upload" size={14} /> Upload a document
              </button>
              <button type="button" className="btn" onClick={() => setTaskOpen(true)}>
                <Icon name="tasks" size={14} /> Add a task
              </button>
            </div>
          </div>

          {/* At a glance - one line per hub tab, each jumping to it. */}
          <div className="card">
            <div className="cs-card-head" style={{ marginBottom: 4 }}><h2 className="cs-card-title">In this case</h2></div>
            <ul className="cs-glance">
              <GlanceRow label="Hearings" value={String(hearingCount)} onOpen={() => setActiveTab('hearings')} />
              <GlanceRow
                label="Open tasks"
                value={taskBoard.isLoading ? '…' : String(openTasks)}
                onOpen={() => setActiveTab('work')}
              />
              <GlanceRow label="Filings & applications" value="" onOpen={() => setActiveTab('filings')} />
              {canBill && <GlanceRow label="Fees & expenses" value="" onOpen={() => setActiveTab('billing')} />}
            </ul>
          </div>

          {/* Parties + acts - populated by the eCourts sync. */}
          <div className="card">
            <div className="cs-card-head" style={{ marginBottom: 6 }}>
              <div className="cs-card-titles"><h2 className="cs-card-title">Parties</h2></div>
              {(parties.data?.length ?? 0) > 0 && (
                <span className="cs-count">{parties.data!.length} on record</span>
              )}
            </div>
            {parties.isLoading ? (
              <p className="cs-muted">Loading parties…</p>
            ) : (parties.data?.length ?? 0) === 0 ? (
              <p className="cs-muted">
                {hasRealCnr ? 'None on record yet. Sync eCourts to import them.' : 'Imported from eCourts once the CNR is added.'}
              </p>
            ) : (
              <ul className="cs-parties">
                {parties.data!.map((p) => (
                  <li key={p.id}>
                    <span className="adv-eyebrow">{p.side}</span>
                    <span className="cs-party-name">{p.partyName}</span>
                    {(p.roleLabel || p.advocateName) && (
                      <span className="cs-line-sub">
                        {[p.roleLabel, p.advocateName ? `Counsel: ${p.advocateName}` : ''].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {(acts.data?.length ?? 0) > 0 && (
              <div className="cs-acts" aria-label="Acts and sections">
                {acts.data!.map((a) => (
                  <span key={a.id} className="cs-act">
                    <strong>§ {a.section}</strong> {a.actName}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Linked matters: connection status + change CNR live down here. */}
          {hasRealCnr && (
            <EcourtsLinkCard
              key={`${c.id}:${c.ecourtsLinkStatus ?? ''}`}
              c={c}
              onLinked={(s) => setLinkedJustNow(s)}
            />
          )}
        </aside>
      </div>
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
      <EditCaseModal open={editOpen} onClose={() => setEditOpen(false)} c={c} />
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
      <button type="button" onClick={onOpen}>
        <span className="cs-glance-label">{label}</span>
        {value && <span className="cs-glance-value">{value}</span>}
        <Icon name="chevron" size={14} />
      </button>
    </li>
  );
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The hero's date panel: big day, weekday and how far away it is. */
function NextDatePanel({ next, onAdd }: { next: string; onAdd: () => void }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(next ?? '');
  if (!m) {
    return (
      <div className="cs-next is-empty">
        <div className="adv-eyebrow">Next date</div>
        <div className="cs-next-none">Not posted</div>
        <button type="button" className="adv-link" onClick={onAdd}>Add hearing date →</button>
      </div>
    );
  }
  const [, y, mo, d] = m;
  const date = new Date(+y!, +mo! - 1, +d!);
  const now = new Date();
  const days = Math.round((date.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
  const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday'
    : days > 0 ? `In ${days} days` : `${-days} days ago · post the next date`;
  return (
    <div className={`cs-next${days === 0 ? ' is-today' : ''}`}>
      <div className="adv-eyebrow">Next date</div>
      <div className="cs-next-day">
        <span className="cs-next-d">{+d!}</span>
        <span className="cs-next-my">{MONTHS_SHORT[+mo! - 1]} {y}</span>
      </div>
      <div className="cs-next-when">{WEEKDAYS[date.getDay()]} · <strong>{when}</strong></div>
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
      <pre className="cs-letter">
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
      <div className="cs-sync">
        <div className="cs-sync-figs">
          <SummaryRow
            label="Fields updated"
            value={String(changeEntries.length)}
            detail={changeEntries.length === 0 ? 'Already up to date' : undefined}
          />
          <SummaryRow
            label="Hearings replaced"
            value={String(sync.hearingsReplaced)}
            detail="The full hearing history was re-imported from eCourts."
          />
          <SummaryRow
            label="Acts / sections"
            value={String(sync.actsReplaced)}
            detail={sync.actsReplaced > 0 ? 'Refreshed from the court record.' : undefined}
          />
          <SummaryRow
            label="Parties"
            value={String(sync.partiesReplaced)}
            detail={sync.partiesReplaced > 0 ? 'Petitioner / respondent + extras imported.' : undefined}
          />
        </div>

        {changeEntries.length > 0 && (
          <div className="col" style={{ gap: 8 }}>
            <div className="cs-count">Changes</div>
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
            <div className="cs-count">Additional data (not yet stored)</div>
            <p className="body-sm muted">
              eCourts returned these too; DifAi doesn't have columns for them yet. They'll appear in the eCourts gateway view in full.
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
    <div className="cs-sync-fig">
      <span className="cs-count">{label}</span>
      <span className="cs-figure">{value}</span>
      {detail && <p>{detail}</p>}
    </div>
  );
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'Not set';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
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
  const date = event.at
    ? new Date(event.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  return (
    <li className="cs-diary-row">
      <time className="cs-diary-date" dateTime={event.at ? event.at.slice(0, 10) : undefined}>{date}</time>
      <span className="cs-diary-body">
        <span className="cs-diary-kind">
          {kindLabel(event.kind)}{event.actorName ? ` · ${event.actorName}` : ''}
        </span>
        <span className="cs-diary-title">{event.title}</span>
        {event.body && <span className="cs-line-sub">{event.body}</span>}
      </span>
    </li>
  );
}
