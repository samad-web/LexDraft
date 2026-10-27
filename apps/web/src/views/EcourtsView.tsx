import { useState, useRef, useEffect, useImperativeHandle, forwardRef, Fragment, type FormEvent } from 'react';
import { Icon, type IconName } from '@lexdraft/ui';
import QRCode from 'qrcode';
import {
  useEcourtsCnr, useDownloadOrderPdf, useAddEcourtsCaseToMatters,
  useEcourtsIaBusiness, useEcourtsAppellateInfo,
  useEcourtsBusinessNotes, useSaveEcourtsBusinessNote,
  useStartCnrLiveSession, useOpenLiveCnrLookup, useRefreshCnrCaptcha, useSubmitCnrCaptcha,
  type EcourtsCaseHistory, type EcourtsHearing, type EcourtsOrder, type Court,
  useEcourtsBusiness, orderDateOf,
} from '@/hooks/useEcourts';
import { useCases } from '@/hooks/useCases';
import { useUIStore } from '@/store/ui';
import { EcourtsWebSearchPanel } from '@/components/ecourts/EcourtsWebSearchPanel';
import { NewHearingModal } from '@/components/NewHearingModal';
import { EMPTY_SCOPE, useEcourtsCourtStore } from '@/store/ecourtsCourt';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppSearchScreen } from '@/components/ecourts/app/AppSearchScreen';
import { CourtCauseListScreen } from '@/components/ecourts/app/CourtCauseListScreen';
import { BackArrow, KvTable, SectionBar, StateDistrictBar } from '@/components/ecourts/app/AppUi';
import { EcourtsMenu } from '@/components/ecourts/app/EcourtsMenu';
import { PageHeader } from '@/components/PageHeader';
import { PillNav } from '@/components/PillNav';
import { MyCasesPanel, useTodaysCasesCount } from '@/components/ecourts/MyCasesPanel';
import { PreTrialPanel } from '@/components/ecourts/PreTrialPanel';
import { QrScanButton } from '@/components/ecourts/QrScanButton';
import { ECOURTS_LANGUAGE_OPTIONS, L, useEcourtsT, type EcourtsLanguage } from '@/hooks/useEcourtsLabels';

// =============================================================================
// EcourtsView
//
// Live data from the eCourts Services backend, entirely in-app - no external
// redirects. Case Status (CNR) is the reliable, verified-working path. The
// other search modes (case number / party / advocate / FIR / filing number /
// act / cause list / caveat) all call the real /api/ecourts/search/* routes
// directly, scoped to a court the advocate picks: State -> District are
// reliable dropdowns; the Court complex/establishment CODE is a required
// text field (not a dropdown - the establishment-directory lookup that would
// populate one is blocked server-side by eCourts for automated callers,
// verified exhaustively). The code is REQUIRED, not optional - without it
// eCourts searches zero establishments and replies with a response that reads
// exactly like "no matching cases" but actually means "searched nothing"
// (verified live: the identical query with a real code returns real cases).
// Each form surfaces the real backend result or a clear, honest error.
// =============================================================================

// eCourts CNRs are 16 chars: 2 letters (state) + 2 letters (district) + 2
// alphanumeric (establishment, e.g. `0B` for Alandur JM) + 6 digits (serial)
// + 4 digits (year). Real-world examples:
//   KLER010001682023  — Kerala, Ernakulam, est 01
//   TNCG0B0011172024  — Tamil Nadu, Chengalpattu, est 0B
// We accept a permissive shape: 4 letters then 12 alphanumeric. Anything
// stricter rejects valid CNRs like TNCG0B…
const CNR_RE = /^[A-Za-z]{4}[A-Za-z0-9]{12}$/;

// ---------------------------------------------------------------------------
// Layout - mirrors the official eCourts Services app
//
// Advocates already know the eCourts app, so this screen follows its
// structure and wording (from the app's own bundle and the eCommittee's
// user manual) instead of inventing a new one:
//
//   District Court | High Court          (the app's top switch)
//   CNR · Case Status · Causelist · My Cases   (the app's main tabs)
//   Case Status -> tiles in the app's order: Case Number, Party Name,
//     Filing Number, FIR Number, Advocate, Act, Case Type, Caveat - then the
//     website-only Court Orders and Process Details
//   Causelist -> Cause List, Advocate's Cause List (as on the website)
//   Case History (CaseCard) -> the app's sections, order and labels
//
// Colours stay DifAI's monochrome design system; only structure, order
// and labels follow the app.
// ---------------------------------------------------------------------------

type AppTab = 'cnr' | 'status' | 'causelist' | 'mycases';

type SearchKey =
  | 'case-number' | 'party' | 'party-status' | 'filing' | 'fir'
  | 'advocate' | 'advocate-name' | 'advocate-bar' | 'act' | 'case-type' | 'caveat' | 'pretrial'
  | 'orders' | 'process'
  | 'cause-list' | 'cause-list-web' | 'advocate-causelist' | 'advocate-causelist-web';

interface Tile {
  key: SearchKey;
  label: string;
  /** eCourts app label id - the tile's name in the chosen language. */
  labelId?: number;
  icon: IconName;
  captcha?: boolean;
}

/** Case Status tiles, in the eCourts app's order and wording. */
const STATUS_TILES: ReadonlyArray<Tile> = [
  { key: 'case-number', label: 'Case Number', labelId: L.caseNumber, icon: 'file' },
  { key: 'party', label: 'Party Name', labelId: L.partyName, icon: 'clients' },
  { key: 'filing', label: 'Filing Number', labelId: L.filingNumber, icon: 'documents' },
  { key: 'fir', label: 'FIR Number', labelId: L.firNumber, icon: 'flag' },
  { key: 'advocate', label: 'Advocate', labelId: L.advocate, icon: 'members' },
  { key: 'act', label: 'Act', labelId: L.act, icon: 'gavel', captcha: true },
  { key: 'case-type', label: 'Case Type', labelId: L.caseType, icon: 'cases' },
  { key: 'caveat', label: 'Caveat', labelId: L.caveat, icon: 'shield' },
  { key: 'pretrial', label: 'Pre Trial Application', labelId: L.preTrial, icon: 'flag' },
];

/** On the eCourts website (not the app) - after the app's tiles. */
const WEBSITE_TILES: ReadonlyArray<Tile> = [
  { key: 'orders', label: 'Court Orders', labelId: L.courtOrders, icon: 'gavel' },
  { key: 'process', label: 'Process Details', labelId: L.processes, icon: 'mail', captcha: true },
];

const CAUSELIST_TILES: ReadonlyArray<Tile> = [
  { key: 'cause-list', label: 'Cause List', labelId: L.causeList, icon: 'causelist' },
  { key: 'advocate-causelist', label: 'Advocate\'s Cause List', icon: 'members' },
];

const CAUSELIST_KEYS = new Set<SearchKey>(['cause-list', 'cause-list-web', 'advocate-causelist', 'advocate-causelist-web']);
const ALL_KEYS = new Set<string>([
  ...STATUS_TILES, ...WEBSITE_TILES, ...CAUSELIST_TILES,
].map((t) => t.key).concat(['party-status', 'advocate-name', 'advocate-bar', 'cause-list-web', 'advocate-causelist-web']));

/** Variants keep their parent tile's name in the back link. */
const PARENT_LABEL: Partial<Record<SearchKey, string>> = {
  'party-status': 'Party Name',
  'advocate-name': 'Advocate',
  'advocate-bar': 'Advocate',
  'cause-list-web': 'Cause List',
};

export function EcourtsView() {
  const [params, setParams] = useSearchParams();
  const openCnr = params.get('cnr') ?? undefined;
  const rawSearch = params.get('search');
  const search: SearchKey | null = rawSearch && ALL_KEYS.has(rawSearch) ? (rawSearch as SearchKey) : null;
  const rawTab = params.get('tab');
  const tab: AppTab = openCnr
    ? 'cnr'
    : search
      ? (CAUSELIST_KEYS.has(search) ? 'causelist' : 'status')
      : rawTab === 'status' || rawTab === 'causelist' || rawTab === 'mycases' ? rawTab : 'cnr';

  // District Court | High Court - one switch for every search, like the app.
  const scope = useEcourtsCourtStore((s) => s.scope);
  const setScope = useEcourtsCourtStore((s) => s.setScope);
  const setTier = (court: Court) => {
    if (court !== scope.court) setScope({ ...EMPTY_SCOPE, court });
  };

  const todaysCount = useTodaysCasesCount();
  // The eCourts app's languages and its own labels for them.
  const { t, language, setLanguage, loading: labelsLoading } = useEcourtsT();

  const goTab = (t: AppTab) => setParams(t === 'cnr' ? new URLSearchParams() : new URLSearchParams({ tab: t }));
  const goSearch = (key: SearchKey) => setParams(new URLSearchParams({ search: key }));
  const back = () => goTab(tab);
  const viewCnr = (cnr: string) => setParams(new URLSearchParams({ cnr }));

  const tabs: ReadonlyArray<{ id: AppTab; label: string }> = [
    { id: 'cnr', label: language === 'english' ? 'CNR' : t(L.cnrNumber, 'CNR') },
    { id: 'status', label: t(L.caseStatus, 'Case Status') },
    { id: 'causelist', label: t(L.causeList, 'Causelist') },
    // The app shows a count badge on My Cases; here: cases listed today.
    { id: 'mycases', label: `${t(L.myCases, 'My Cases')}${todaysCount > 0 ? ` (${todaysCount})` : ''}` },
  ];

  return (
    <div className="col stagger" style={{ gap: 20 }}>
      <PageHeader
        title="eCourts Services"
        description="Case status, cause lists and orders from every district and high court, laid out like the eCourts app."
      />

      <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* The app's ☰ menu, then its District Court | High Court switch. */}
        <EcourtsMenu onMyCases={() => goTab('mycases')} />
        <div className="row" role="radiogroup" aria-label="Court" style={{ gap: 0, border: '1px solid var(--border)', borderRadius: 999, padding: 3 }}>
          {(['DC', 'HC'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={scope.court === c}
              className={`btn btn-sm${scope.court === c ? ' btn-primary' : ' btn-ghost'}`}
              style={{ borderRadius: 999 }}
              onClick={() => setTier(c)}
            >
              {c === 'DC' ? t(L.districtCourt, 'District Court') : t(L.highCourt, 'High Court')}
            </button>
          ))}
        </div>
        <label className="row" style={{ gap: 8, alignItems: 'center' }}>
          <span className="body-sm muted">{t(L.language, 'Language')}{labelsLoading ? '…' : ''}</span>
          <select
            className="input"
            style={{ width: 'auto', minWidth: 130 }}
            value={language}
            onChange={(e) => setLanguage(e.target.value as EcourtsLanguage)}
            aria-label="eCourts language"
          >
            {ECOURTS_LANGUAGE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
      </div>

      {/* Scrolls sideways on narrow phones instead of overflowing the page. */}
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <PillNav items={tabs} value={tab} onChange={goTab} ariaLabel="eCourts Services" />
      </div>

      {/* Searches remount when the court tier flips so they pick it up. */}
      <section aria-label={tabs.find((t) => t.id === tab)?.label} key={scope.court} style={{ minWidth: 0 }}>
        {tab === 'cnr' ? (
          <div className="col" style={{ gap: 24 }}>
            <CaseStatusTab key={openCnr ?? ''} initialCnr={openCnr} court={scope.court} />
            {!openCnr ? <CnrHowTo onCaseStatus={() => goTab('status')} /> : null}
          </div>
        ) : null}

        {/* As in the app: State | District sit on top of Case Status and
            Causelist and apply to every search under them. */}
        {tab === 'status' || tab === 'causelist' ? (
          <div style={{ marginBottom: 16 }}><StateDistrictBar /></div>
        ) : null}

        {tab === 'status' && !search ? (
          <div className="col" style={{ gap: 20 }}>
            <TileGrid tiles={STATUS_TILES} onPick={goSearch} />
            <div className="col" style={{ gap: 8 }}>
              <div className="eyebrow">From the eCourts website</div>
              <TileGrid tiles={WEBSITE_TILES} onPick={goSearch} />
            </div>
          </div>
        ) : null}

        {tab === 'causelist' && !search ? <TileGrid tiles={CAUSELIST_TILES} onPick={goSearch} /> : null}

        {tab === 'mycases' ? <MyCasesPanel /> : null}

        {search ? (
          <div className="col" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 10, alignItems: 'center' }}>
              <BackArrow onClick={back} />
              <span className="body-md muted">{tab === 'causelist' ? t(L.causeList, 'Causelist') : t(L.caseStatus, 'Case Status')}</span>
            </div>
            <SearchBody search={search} goSearch={goSearch} viewCnr={viewCnr} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Two-column icon tiles, like the app's Case Status grid. */
function TileGrid({ tiles, onPick }: { tiles: ReadonlyArray<Tile>; onPick: (k: SearchKey) => void }) {
  const { t } = useEcourtsT();
  return (
    // At most 4 columns (desktop) and 2 on phones, so the app's tile pairs -
    // Case Number | Party Name, Filing | FIR, Advocate | Act, Case Type |
    // Caveat - stay side by side as advocates know them.
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(max(140px, calc((100% - 36px) / 4)), 1fr))', gap: 12 }}>
      {tiles.map((tile) => (
        <button
          key={tile.key}
          type="button"
          className="card"
          onClick={() => onPick(tile.key)}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 8, padding: '18px 10px', cursor: 'pointer', textAlign: 'center', color: 'inherit',
            minHeight: 112,
          }}
        >
          <Icon name={tile.icon} size={28} />
          <span className="body-md" style={{ fontWeight: 600 }}>{tile.labelId ? t(tile.labelId, tile.label) : tile.label}</span>
          {tile.captcha ? <span className="badge badge-amber" style={{ fontSize: 10 }}>Captcha</span> : null}
        </button>
      ))}
    </div>
  );
}

/** The search form for a tile (and its website variants). */
function SearchBody({ search, goSearch, viewCnr }: { search: SearchKey; goSearch: (k: SearchKey) => void; viewCnr: (cnr: string) => void }) {
  const court = useEcourtsCourtStore((s) => s.scope.court);
  // Case History opens in place over the results (back returns to them).
  const renderCase = (cnr: string, onBack: () => void) => <CaseHistoryScreen cnr={cnr} court={court} onBack={onBack} />;
  switch (search) {
    case 'case-number': return <AppSearchScreen key="case-number" mode="case-number" renderCase={renderCase} />;
    case 'filing': return <AppSearchScreen key="filing" mode="filing" renderCase={renderCase} />;
    case 'fir': return <AppSearchScreen key="fir" mode="fir" renderCase={renderCase} />;
    case 'caveat': return <AppSearchScreen key="caveat" mode="caveat" renderCase={renderCase} />;
    case 'party': return <AppSearchScreen key="party" mode="party" renderCase={renderCase} />;
    case 'advocate': return <AppSearchScreen key="advocate" mode="advocate" renderCase={renderCase} />;
    case 'cause-list':
      return (
        <CauseListWithCase
          court={court}
          extra={(
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => goSearch('cause-list-web')}>
              Cause list from the eCourts website (captcha) →
            </button>
          )}
        />
      );
    case 'party-status':
      return (
        <WebVariant onBack={() => goSearch('party')} backLabel={PARENT_LABEL['party-status']!}>
          <EcourtsWebSearchPanel key="party-status" sections={['party-status']} title="Party Name: Pending or Disposed" onOpenCnr={viewCnr} />
        </WebVariant>
      );
    case 'advocate-name':
    case 'advocate-bar':
      return (
        <WebVariant onBack={() => goSearch('advocate')} backLabel="Advocate">
          <EcourtsWebSearchPanel key={search} sections={['advocate-bar', 'advocate-name']} initialSection={search} title="Advocate" onOpenCnr={viewCnr} />
        </WebVariant>
      );
    case 'cause-list-web':
      return (
        <WebVariant onBack={() => goSearch('cause-list')} backLabel="Cause List">
          <EcourtsWebSearchPanel key="cause-list-web" sections={['cause-list']} title="Cause List (Civil / Criminal)" onOpenCnr={viewCnr} />
        </WebVariant>
      );
    // Instant (eCourts app service). Bar-code lookups only work on the
    // website, so that variant stays one link away.
    case 'advocate-causelist':
      return (
        <AppSearchScreen
          key="advocate-causelist"
          mode="advocate-causelist"
          renderCase={renderCase}
          related={[{ label: 'By Bar Code (captcha)', onClick: () => goSearch('advocate-causelist-web') }]}
        />
      );
    case 'advocate-causelist-web':
      return (
        <WebVariant onBack={() => goSearch('advocate-causelist')} backLabel="Advocate's Cause List">
          <EcourtsWebSearchPanel key="advocate-causelist-web" sections={['advocate-causelist']} title="Advocate's Cause List by Bar Code" onOpenCnr={viewCnr} />
        </WebVariant>
      );
    case 'act': return <EcourtsWebSearchPanel key="act" sections={['act']} title="Act" onOpenCnr={viewCnr} />;
    case 'case-type': return <AppSearchScreen key="case-type" mode="case-type" renderCase={renderCase} />;
    case 'pretrial': return <PreTrialPanel onOpenCnr={viewCnr} />;
    case 'orders':
      return (
        <EcourtsWebSearchPanel
          key="orders"
          sections={['orders-party', 'orders-case', 'orders-date', 'orders-court']}
          title="Court Orders"
          intro="Search by Party Name is instant. The others go through the eCourts website."
          onOpenCnr={viewCnr}
        />
      );
    case 'process': return <EcourtsWebSearchPanel key="process" sections={['process']} title="Process Details" onOpenCnr={viewCnr} />;
    default: return null;
  }
}

/** The app's "How to" panel under the CNR box, plus the CNR format. */
function CnrHowTo({ onCaseStatus }: { onCaseStatus: () => void }) {
  // Steps b-d and g are the eCourts app's own "How to" text (in the chosen
  // language); step a is DifAI's, since here the court switch is on top.
  const { t, language } = useEcourtsT();
  return (
    <div className="card col" style={{ gap: 12 }}>
      <div className="heading-sm">{t(L.howTo, 'How to')}</div>
      <div className="body-sm col" style={{ gap: 6 }}>
        {/* The app numbers its steps in the chosen script (b. / ஆ. / ...);
            this first, DifAI-only step stays unnumbered outside English. */}
        <div>{language === 'english' ? 'a. Choose District Court or High Court above.' : `${t(L.districtCourt, 'District Court')} / ${t(L.highCourt, 'High Court')} ↑`}</div>
        <div>{t(L.howToB, 'b. If you know the CNR Number of the case, enter the 16-character CNR without any hyphen or space.')}</div>
        <div>{t(L.howToC, 'c. On clicking Search, the current status and the entire history of the case will be shown.')}</div>
        <div>
          {t(L.howToD, 'd. If you don\'t know the CNR, search by Case Number, Party Name, Advocate, Filing Number and more under Case Status.')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 4px' }} onClick={onCaseStatus}>{t(L.caseStatus, 'Case Status')} →</button>
        </div>
        <div>{t(L.howToG, 'e. Cases you add to My Cases can be seen any time under My Cases.')}</div>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <div className="eyebrow">CNR Number format (16 characters)</div>
        <div className="mono body-sm" style={{ letterSpacing: '0.06em' }}>
          TN SA 05 000470 2017
        </div>
        <div className="body-sm muted">
          State code (2) · District code (2) · Establishment code (2) · Case number (6) · Filing year (4)
        </div>
      </div>
    </div>
  );
}

/** A variant of a search, with a clear way back to the main version. */
function WebVariant({ onBack, backLabel, children }: { onBack: () => void; backLabel: string; children: React.ReactNode }) {
  return (
    <div className="col" style={{ gap: 12 }}>
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onBack}>
        ← Back to {backLabel} (instant search)
      </button>
      {children}
    </div>
  );
}

/** The app's Case History screen for one CNR, with its back arrow. */
function CaseHistoryScreen({ cnr, court, onBack }: { cnr: string; court: Court; onBack: () => void }) {
  const { data, isLoading, isError, isNotFound, error, queued, meta } = useEcourtsCnr(cnr, court);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [cnr]);
  return (
    <div className="col" style={{ gap: 12 }}>
      {!data ? <BackArrow onClick={onBack} /> : null}
      {isLoading ? <LoadingCard cnr={cnr} /> : null}
      {queued ? <QueuedCard cnr={cnr} message={queued} /> : null}
      {isError && !isNotFound ? <ErrorCard error={error} /> : null}
      {data ? <StoredNote meta={meta} /> : null}
      {data ? <div className="card"><CaseCard h={data} court={court} onBack={onBack} /></div> : null}
      {!isLoading && !queued && (isNotFound || (!isError && !data)) ? (
        <div className="card"><p className="body-md muted">eCourts did not return a record for this CNR.</p></div>
      ) : null}
    </div>
  );
}

/** Cause List screen; a case number opens Case History over the list. */
function CauseListWithCase({ court, extra }: { court: Court; extra?: React.ReactNode }) {
  const [cnr, setCnr] = useState<string | null>(null);
  return (
    <>
      {cnr ? <CaseHistoryScreen cnr={cnr} court={court} onBack={() => setCnr(null)} /> : null}
      <div style={{ display: cnr ? 'none' : undefined }}>
        <CourtCauseListScreen onOpenCase={setCnr} extra={extra} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Case Status tab — live CNR lookup (verified working against the backend).
// ---------------------------------------------------------------------------

function CaseStatusTab({ initialCnr, court }: { initialCnr?: string; court: Court }) {
  // Two pieces of state because the input is a draft until "Look up" lands —
  // we only want to fire the query against the *submitted* CNR, not on every
  // keystroke. `initialCnr` (from "View case" elsewhere) looks up straight away.
  const [draft, setDraft] = useState<string>(initialCnr ?? '');
  const [submittedCnr, setSubmittedCnr] = useState<string>(initialCnr ?? '');
  const { t } = useEcourtsT();
  // The tier comes from the page's District Court | High Court switch.

  const { data: history, isLoading, isError, isNotFound, error, queued, meta } = useEcourtsCnr(submittedCnr, court);

  const draftIsValid = CNR_RE.test(draft.trim().toUpperCase());

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleaned = draft.trim().toUpperCase();
    if (!CNR_RE.test(cleaned)) return;
    setSubmittedCnr(cleaned);
  };

  // As in the app, the Case History replaces the CNR box; back returns to it.
  if (submittedCnr && history) {
    return (
      <div className="col" style={{ gap: 12 }}>
        <StoredNote meta={meta} />
        <div className="card">
          <CaseCard h={history} court={court} onBack={() => setSubmittedCnr('')} />
        </div>
      </div>
    );
  }

  return (
    <div className="col stagger" style={{ gap: 24 }}>
      <form onSubmit={onSubmit} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon name="search" size={18} />
        <input
          className="input"
          style={{ flex: 1, minWidth: 240, height: 48, fontSize: 16, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
          placeholder={t(L.enterCnr, 'Enter 16 digit CNR number')}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[\s-]/g, ''))}
          aria-label="CNR Number"
          maxLength={16}
        />
        <button type="submit" className="btn btn-primary btn-lg" disabled={!draftIsValid}>
          {t(L.search, 'Search')} <Icon name="arrow" size={14} />
        </button>
        {/* The app's "Scan QR Code": eCourts prints a CNR QR code on case
            papers and orders. */}
        <QrScanButton onCnr={(cnr) => { setDraft(cnr); setSubmittedCnr(cnr); }} />
      </form>

      {!draftIsValid && draft.length > 0 && (
        <div className="body-sm muted" style={{ paddingLeft: 4 }}>
          CNR must be exactly 16 characters (4 letters followed by 12 alphanumeric).
        </div>
      )}

      {/* Only the very first fetch shows a loader - a stored copy renders
          straight away and background refreshes don't flash anything. */}
      {isLoading ? <LoadingCard cnr={submittedCnr} /> : null}
      {queued ? <QueuedCard cnr={submittedCnr} message={queued} /> : null}

      {/* A 404 ("no case found for this CNR") is an expected, well-formed
          answer, not a failure - it gets the dedicated amber card below.
          The red ErrorCard is reserved for genuine transport/server
          failures (5xx, network errors). */}
      {!isLoading && isError && !isNotFound ? <ErrorCard error={error} /> : null}

      {submittedCnr && !isLoading && !queued && (isNotFound || (!isError && !history)) ? (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <div className="row" style={{ gap: 12 }}>
            <span className="dot dot-amber" />
            <div>
              <div className="heading-sm" style={{ marginBottom: 4 }}>No case found</div>
              <p className="body-sm muted">The eCourts backend did not return a record for this CNR.</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingCard({ cnr }: { cnr: string }) {
  return (
    <div className="card">
      <div className="row" style={{ gap: 12 }}>
        <span className="dot dot-amber" />
        <div>
          <div className="heading-sm" style={{ marginBottom: 4 }}>Getting {cnr} from eCourts…</div>
          <p className="body-sm muted">
            First time opening this case, so it comes straight from eCourts (usually 5 to 15 seconds).
            DifAI keeps a copy, so next time it opens instantly.
          </p>
        </div>
      </div>
    </div>
  );
}

/** eCourts was down/busy and nothing is stored yet: the server queued the
 *  fetch (retrying with backoff) - say so plainly instead of spinning. */
function QueuedCard({ cnr, message }: { cnr: string; message: string }) {
  return (
    <div className="card" style={{ borderColor: 'var(--warning)' }}>
      <div className="row" style={{ gap: 12 }}>
        <span className="dot dot-amber" />
        <div>
          <div className="heading-sm" style={{ marginBottom: 4 }}>Waiting for eCourts: {cnr}</div>
          <p className="body-sm muted">{message} This page also checks again every 20 seconds.</p>
        </div>
      </div>
    </div>
  );
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/** Where the shown case came from and how fresh it is. */
function StoredNote({ meta }: { meta: { fetchedAt: string; stale: boolean; refreshing: boolean } | null }) {
  if (!meta) return null;
  return (
    <div className="row" style={{ gap: 8, alignItems: 'center' }}>
      <span className={`dot ${meta.refreshing ? 'dot-cobalt' : 'dot-sage'}`} />
      <span className="body-sm muted">
        Updated from eCourts {ago(meta.fetchedAt)}
        {meta.refreshing ? ' · getting the latest in the background' : ''}
      </span>
    </div>
  );
}

function ErrorCard({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  return (
    <div className="card" style={{ borderColor: 'var(--vermillion)' }}>
      <div className="row" style={{ gap: 12 }}>
        <span className="dot dot-vermillion" />
        <div>
          <div className="heading-sm" style={{ marginBottom: 4 }}>Lookup failed</div>
          <p className="body-sm muted">{msg}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The full eCourts record of one CNR inside a matter's own page (case page >
 * eCourts tab): the stored copy opens instantly and refreshes in the
 * background. No back arrow or "Add Case" - it already is the matter.
 */
export function EcourtsCaseRecord({ cnr, court }: { cnr: string; court: Court }) {
  const { data, isLoading, isError, isNotFound, error, queued, meta } = useEcourtsCnr(cnr, court);
  return (
    <div className="col" style={{ gap: 12 }}>
      {isLoading ? <LoadingCard cnr={cnr} /> : null}
      {queued ? <QueuedCard cnr={cnr} message={queued} /> : null}
      {isError && !isNotFound ? <ErrorCard error={error} /> : null}
      {data ? <StoredNote meta={meta} /> : null}
      {data ? <div className="card"><CaseCard h={data} court={court} embedded /></div> : null}
      {!isLoading && !queued && (isNotFound || (!isError && !data)) ? (
        <div className="card"><p className="body-md muted">eCourts did not return a record for {cnr}{court === 'HC' ? ' in the High Court' : ' in the District Courts'}.</p></div>
      ) : null}
    </div>
  );
}

function CaseCard({ h, court, onAdded, onBack, embedded }: { h: EcourtsCaseHistory; court: Court; onAdded?: () => void; onBack?: () => void; embedded?: boolean }) {
  const disposed = Boolean(h.date_of_decision && h.disp_name);
  const { t, language } = useEcourtsT();
  const navigate = useNavigate();
  const addToCases = useAddEcourtsCaseToMatters();
  const showToast = useUIStore((s) => s.showToast);
  const { data: myCases } = useCases();
  const inMyCases = myCases?.find((c) => (c.cnr ?? '').trim().toUpperCase() === h.cino.toUpperCase());
  const [added, setAdded] = useState(false);
  // One LiveBusinessInline instance per case; the Daily Status purpose and
  // every hearing row trigger the same one.
  const liveBusinessRef = useRef<LiveBusinessInlineHandle>(null);

  const [hearingOpen, setHearingOpen] = useState(false);
  // Must match useAddEcourtsCaseToMatters' title construction exactly - the
  // hearing modal resolves a matter by title string.
  const caseTitle = `${h.petName || h.pet_name || 'Unknown'} v. ${h.resName || h.res_name || 'Unknown'}`;

  const handleAdd = async () => {
    try {
      await addToCases.mutateAsync({ history: h, court });
      setAdded(true);
      showToast({ type: 'sage', text: 'Added to My Cases and synced from eCourts' });
      onAdded?.();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not add to My Cases';
      if (msg.toLowerCase().includes('already in your matters')) setAdded(true);
      showToast({ type: 'vermillion', text: msg });
    }
  };

  const andJoin = (a: string, aId: number, b: string, bId: number) =>
    language === 'english' ? `${a} and ${b}` : `${t(aId, a)} ${t(L.and, 'and')} ${t(bId, b)}`;
  const interim = h.interimOrder ?? [];
  const finals = h.finalOrder ?? [];

  // Case History exactly as the eCourts app lays it out: back arrow and
  // Add Case on top, "Case History" + court name, then one collapsible bar
  // per section (Case Details open first).
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', display: embedded ? 'none' : undefined }}>
        {onBack ? <BackArrow onClick={onBack} /> : <span />}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {inMyCases ? (
            <button type="button" className="btn" onClick={() => navigate(`/app/cases/${inMyCases.id}?focus=ecourts&from=ecourts`)}>
              <Icon name="check" size={14} /> In {t(L.myCases, 'My Cases')} · Open
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => { void handleAdd(); }} disabled={addToCases.isPending || added}>
              {added ? <><Icon name="check" size={14} /> Added</> : addToCases.isPending ? <>Adding…</> : <>{t(L.addCase, 'Add Case')} <Icon name="plus" size={14} /></>}
            </button>
          )}
          {added || inMyCases ? (
            <button type="button" className="btn" onClick={() => setHearingOpen(true)} title="Add a hearing, deadline or reminder for this matter">
              <Icon name="calendar" size={14} /> Add hearing
            </button>
          ) : null}
        </div>
      </div>

      <div className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 2, margin: '4px 0 6px' }}>
        <h2 className="heading-lg">{t(L.caseHistory, 'Case History')}</h2>
        <span className="body-md">{h.court_name}</span>
      </div>

      <HistorySection title={t(L.caseDetails, 'Case Details')} defaultOpen>
        <KvTable rows={[
          [t(L.caseType, 'Case Type'), String(h.type_name ?? '')],
          [t(L.filingNumber, 'Filing Number'), h.filing_no || (h.fil_no ? `${h.fil_no}/${h.fil_year}` : '')],
          [t(L.filingDate, 'Filing Date'), dmy(h.date_of_filing)],
          [t(L.registrationNumber, 'Registration Number'), h.reg_no ? `${h.reg_no}/${h.reg_year}` : ''],
          [t(L.registrationDate, 'Registration Date'), dmy(h.dt_regis)],
          [t(L.cnrNumber, 'CNR Number'), <span className="mono">{h.cino}</span>],
        ]} />
      </HistorySection>

      <HistorySection title={t(L.caseStatus, 'Case Status')}>
        <KvTable rows={[
          [t(L.firstHearingDate, 'First Hearing Date'), dmy(h.date_first_list)],
          disposed
            ? [t(L.decisionDate, 'Decision Date'), dmy(h.date_of_decision)]
            : [t(L.nextHearingDate, 'Next Hearing Date'), dmy(h.date_next_list) || 'Next date is not given'],
          disposed
            ? [t(L.caseStatus, 'Case Status'), 'CASE DISPOSED']
            : [t(L.caseStage, 'Case Stage'), h.purpose_name || ''],
          ...(disposed ? [[t(L.natureOfDisposal, 'Nature of Disposal'), h.disp_name || ''] as const] : []),
          [language === 'english' ? 'Court Number and Judge' : `${t(L.courtNumber, 'Court Number')} ${t(L.and, 'and')} ${t(L.judge, 'Judge')}`, h.desgname || ''],
        ]} />
      </HistorySection>

      <HistorySection title={t(L.qrCode, 'QR Code')}>
        <CaseQrCode cnr={h.cino} />
      </HistorySection>

      <HistorySection title={andJoin('Petitioner', L.petitioner, 'Advocate', L.advocate)}>
        <PartyList main={h.petName || h.pet_name} advocate={h.pet_adv} extras={h.ex_pet_namelegal} />
      </HistorySection>

      <HistorySection title={andJoin('Respondent', L.respondent, 'Advocate', L.advocate)}>
        <PartyList main={h.resName || h.res_name} advocate={h.res_adv} extras={h.ex_res_namelegal} />
      </HistorySection>

      {h.act && h.act.length > 0 ? (
        <HistorySection title={t(L.acts, 'Acts')}>
          <table className="tbl">
            <thead><tr><th>{t(L.underActs, 'Under Act(s)')}</th><th>{t(L.underSections, 'Under Section(s)')}</th></tr></thead>
            <tbody>
              {h.act.map((a, i) => (
                <tr key={i}>
                  <td>{a.actCodeName.trim().replace(/\\$/, '')}</td>
                  <td>{a.actSectionName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </HistorySection>
      ) : null}

      {h.fir_no ? (
        <HistorySection title={t(L.firDetails, 'FIR Details')}>
          <KvTable rows={[
            ...(h.fir_details ? h.fir_details.split('^').filter(Boolean).slice(0, 1).map((ps) => [t(L.policeStation, 'Police Station'), ps] as const) : []),
            [t(L.firNumber, 'FIR Number'), String(h.fir_no)],
            [t(L.year, 'Year'), String(h.fir_year ?? '')],
          ]} />
        </HistorySection>
      ) : null}

      {h.historyOfCaseHearing && h.historyOfCaseHearing.length > 0 ? (
        <HistorySection title="History of Case Hearing">
          <HearingsTable
            hearings={h.historyOfCaseHearing}
            orders={[...interim, ...finals]}
            cino={h.cino}
            court={court}
            caseRef={h}
            onPurposeClick={() => liveBusinessRef.current?.trigger()}
          />
        </HistorySection>
      ) : null}

      {interim.length > 0 ? (
        <HistorySection title={t(L.interimOrders, 'Interim Orders')}>
          <OrdersTable orders={interim} cino={h.cino} court={court} caseRef={h} />
        </HistorySection>
      ) : null}

      {finals.length > 0 ? (
        <HistorySection title={t(L.finalOrders, 'Final Orders/Judgements')}>
          <OrdersTable orders={finals} cino={h.cino} court={court} caseRef={h} />
        </HistorySection>
      ) : null}

      {h.transfer && h.transfer.length > 0 ? <TransferList transfers={h.transfer} /> : null}

      <IaBusinessSection cino={h.cino} court={court} />
      <AppellateInfoSection
        stateCode={h.state_code}
        distCode={h.district_code}
        courtCode={h.court_code}
        caseNumber1={h.case_no}
        appCsNo={String(h.reg_no ?? '')}
        court={court}
      />

      {h.last_business_date && h.last_business_date.showbusiness === 'Y' ? (
        <HistorySection title={t(L.dailyStatus, 'Daily Status')}>
          <div className="col" style={{ gap: 10 }}>
            <KvTable rows={[
              [t(L.purposeOfHearing, 'Purpose of Hearing'), (
                <button type="button" onClick={() => liveBusinessRef.current?.trigger()} title="Fetch live Business details from eCourts" style={{ textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit' }}>
                  {h.last_business_date.purpose || '—'}
                </button>
              )],
              [t(L.judge, 'Judge'), h.last_business_date.judge_name || ''],
              [t(L.businessOnDate, 'Business On Date'), h.last_business_date.todays_date1 || h.last_business_date.todays_date],
              [t(L.nextHearingDate, 'Next Hearing Date'), h.last_business_date.nextdate ? fmtNextDate(h.last_business_date.nextdate) : ''],
            ]} />
            <BusinessPanel row={h.last_business_date} court={court} onFallback={() => liveBusinessRef.current?.trigger()} />
            <LiveBusinessInline ref={liveBusinessRef} cino={h.cino} />
          </div>
        </HistorySection>
      ) : null}

      <NewHearingModal
        open={hearingOpen}
        onClose={() => setHearingOpen(false)}
        defaultCase={inMyCases?.title || caseTitle}
        defaultCourt={h.court_name}
      />
    </div>
  );
}

/** dd-mm-yyyy, as every date in the eCourts app. */
function dmy(iso: string | undefined | null): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}

/** The app's QR Code section - the case's CNR as a QR code. */
function CaseQrCode({ cnr }: { cnr: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(cnr, { margin: 1, width: 180 }).then((url) => { if (alive) setSrc(url); }).catch(() => undefined);
    return () => { alive = false; };
  }, [cnr]);
  return (
    <div className="col" style={{ alignItems: 'center', gap: 6, padding: 8 }}>
      {src ? <img src={src} alt={`QR code for CNR ${cnr}`} width={180} height={180} style={{ background: '#fff', padding: 6, borderRadius: 6 }} /> : <span className="body-sm muted">…</span>}
      <span className="mono body-sm">{cnr}</span>
    </div>
  );
}

/**
 * View Business (daily status) for one hearing date, fetched straight from
 * the eCourts app service - no captcha. If eCourts can't answer, offer the
 * website (captcha) version as a fallback.
 */
function BusinessPanel({ row, court, onFallback }: { row: EcourtsHearing; court: Court; onFallback: () => void }) {
  const q = useEcourtsBusiness(row, court);
  if (q.isLoading) return <p className="body-sm muted">Loading business for {row.todays_date1 || row.todays_date}…</p>;
  if (q.isError || !q.data) {
    return (
      <p className="body-sm muted">
        eCourts did not return the business for this date.{' '}
        <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 4px' }} onClick={onFallback}>
          Try the eCourts website (captcha)
        </button>
      </p>
    );
  }
  const d = q.data.details ?? {};
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="body-sm muted">
        Business on {String(d.businessDate ?? row.todays_date1 ?? '')}
        {d.judge_name ? ` · ${String(d.judge_name)}` : ''}
      </div>
      {q.data.rows.length === 0 ? (
        <p className="body-sm muted">No business recorded for this date.</p>
      ) : (
        <div className="grid-2" style={{ gap: 16 }}>
          {q.data.rows.map((r, i) => <Field key={i} label={r.title.toUpperCase()} value={r.value || '—'} />)}
        </div>
      )}
    </div>
  );
}

/** One Case History section - the app's collapsible section bar. */
function HistorySection({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="col" style={{ gap: 0 }} aria-label={title}>
      <SectionBar title={<span style={{ display: 'block', textAlign: 'center' }}>{title}</span>} open={open} onToggle={() => setOpen((o) => !o)} />
      {open ? <div style={{ padding: '10px 2px 4px' }}>{children}</div> : null}
    </section>
  );
}

/** Party block as in the app: "1) Name" lines, each with "Advocate - …". */
function PartyList({
  main,
  advocate,
  extras,
}: {
  main: string | undefined;
  advocate: string | undefined;
  extras: EcourtsCaseHistory['ex_pet_namelegal'];
}) {
  const mainLines = (main ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const adv = (advocate ?? '').trim();
  const extraRows = (extras ?? []).filter((p) => (p.partyname ?? '').trim());
  if (mainLines.length === 0 && extraRows.length === 0) return <p className="body-sm muted">—</p>;
  return (
    <div className="col" style={{ gap: 8 }}>
      {mainLines.map((line, i) => (
        <div key={`m${i}`} className="body-sm">
          {/^\d+\)/.test(line) ? line : `${i + 1}) ${line}`}
          {i === 0 && adv ? (
            <div className="muted" style={{ paddingLeft: 16 }}>{/^advocate/i.test(adv) ? adv : `Advocate - ${adv}`}</div>
          ) : null}
        </div>
      ))}
      {extraRows.map((p, i) => (
        <div key={`x${p.partyid ?? i}`} className="body-sm">
          {`${mainLines.length + i + 1}) ${p.partyname.trim()}`}
          {p.partyNameLegalHeirLitigantStatus ? <span className="muted"> ({p.partyNameLegalHeirLitigantStatus})</span> : null}
          {p.advExtraAdvname ? (
            <div className="muted" style={{ paddingLeft: 16 }}>Advocate - {String(p.advExtraAdvname).replace(/^Advocate\s*-\s*/i, '')}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function HearingsTable({ hearings, orders, cino, court, onPurposeClick, caseRef }: { hearings: EcourtsHearing[]; orders: EcourtsOrder[]; cino: string; court: Court; onPurposeClick: () => void; caseRef?: CaseRef }) {
  const { t } = useEcourtsT();
  const [expanded, setExpanded] = useState<number | null>(null);
  const download = useDownloadOrderPdf();
  const showToast = useUIStore((s) => s.showToast);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const handleDownload = async (o: EcourtsOrder, rowKey: string) => {
    setPendingKey(rowKey);
    try {
      const fname = await download.mutateAsync(orderPdfInput(o, cino, court, caseRef));
      showToast({ type: 'sage', text: `Downloaded ${fname}` });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not download PDF';
      showToast({ type: 'vermillion', text: msg });
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              {/* Columns and wording as in the eCourts app. */}
              <th>{t(L.judge, 'Judge')}</th>
              <th style={{ width: 130 }}>{t(L.businessOnDate, 'Business On Date')}</th>
              <th style={{ width: 130 }}>{t(L.hearingDate, 'Hearing Date')}</th>
              <th>{t(L.purposeOfHearing, 'Purpose of Hearing')}</th>
            </tr>
          </thead>
          <tbody>
            {hearings.map((hr, i) => {
              // A hearing's own date is the day's "business" at the court -
              // if an order was issued that same day, surface it inline
              // rather than making the advocate hunt for it in the separate
              // Orders section below.
              const hearingDate = hr.todays_date1 || hr.todays_date;
              const matchingOrder = orders.find((o) => orderDate(o) === hearingDate);
              const isOpen = expanded === i;
              const rowKey = `hearing-${hearingDate}-${i}`;
              return (
                <Fragment key={rowKey}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : i)}
                    style={{ cursor: 'pointer' }}
                    title="Click for this hearing's full detail"
                  >
                    <td>{hr.judge_name}</td>
                    <td className="mono tabular" style={{ fontSize: 12 }}>
                      {/* As in the app, the Business On Date opens View Business
                          (shown in the expanded row, no captcha). */}
                      <span
                        style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                        title="View Business (daily status) for this date"
                        onClick={(e) => { e.stopPropagation(); setExpanded(i); }}
                      >
                        {hearingDate}
                      </span>
                    </td>
                    <td className="mono tabular" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {hr.nextdate ? fmtNextDate(hr.nextdate) : '—'}
                    </td>
                    <td>{hr.purpose}</td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={4} style={{ background: 'var(--bg-surface-2)', padding: '16px 12px' }}>
                        <div className="eyebrow" style={{ marginBottom: 8 }}>{t(L.viewBusiness, 'View Business')}</div>
                        <div onClick={(e) => e.stopPropagation()} style={{ marginBottom: 16 }}>
                          <BusinessPanel row={hr} court={court} onFallback={onPurposeClick} />
                        </div>
                        <div className="grid-2" style={{ gap: 16 }}>
                          <Field label="COURT NO" value={hr.court_no || '—'} />
                          <Field label="CASE NUMBER" value={hr.case_number || '—'} />
                          <Field label="BUSINESS STATUS" value={hr.businessStatus || '—'} />
                          <Field label="SHOW BUSINESS" value={hr.showbusiness === 'Y' ? 'Yes' : 'No'} />
                        </div>
                        {matchingOrder ? (
                          <div className="row" style={{ marginTop: 12, gap: 12, alignItems: 'center' }}>
                            <span className="body-sm muted">Order issued this date: {matchingOrder.order_details}</span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={(e) => { e.stopPropagation(); void handleDownload(matchingOrder, rowKey); }}
                              disabled={pendingKey === rowKey}
                            >
                              {pendingKey === rowKey ? <>Fetching…</> : <><Icon name="download" size={12} /> View order</>}
                            </button>
                          </div>
                        ) : (
                          <p className="body-sm muted" style={{ marginTop: 12 }}>No order/judgment filed for this date.</p>
                        )}
                        <div onClick={(e) => e.stopPropagation()}>
                          <BusinessNoteEditor cino={cino} hearingDate={hearingDate} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
    </div>
  );
}

// BusinessNoteEditor — manual fallback for the captcha-gated "Business" text
// (see ecourts.service.ts's listBusinessNotes doc comment for why this can't
// be fetched automatically). The advocate reads the real Daily Status page
// via "Live Business (eCourts)" above, then pastes what they read here so it
// persists in DifAI per hearing date instead of needing the captcha again
// every time they revisit this case.
function BusinessNoteEditor({ cino, hearingDate }: { cino: string; hearingDate: string }) {
  const { data: notes } = useEcourtsBusinessNotes(cino);
  const save = useSaveEcourtsBusinessNote(cino);
  const showToast = useUIStore((s) => s.showToast);
  const existing = notes?.find((n) => n.hearingDate === hearingDate);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const startEdit = () => { setDraft(existing?.businessText ?? ''); setEditing(true); };

  const handleSave = async () => {
    const text = draft.trim();
    if (!text) return;
    try {
      await save.mutateAsync({ hearingDate, businessText: text });
      setEditing(false);
      showToast({ type: 'sage', text: 'Business note saved' });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not save note';
      showToast({ type: 'vermillion', text: msg });
    }
  };

  if (editing) {
    return (
      <div className="col" style={{ marginTop: 12, gap: 8 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
          BUSINESS NOTE (pasted from eCourts Daily Status)
        </span>
        <textarea
          className="input"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste what the eCourts Daily Status page shows for this date…"
        />
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={save.isPending || !draft.trim()}>
            {save.isPending ? 'Saving…' : 'Save note'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      {existing ? (
        <div className="col" style={{ gap: 4 }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>
            BUSINESS NOTE
          </span>
          <p className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{existing.businessText}</p>
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={startEdit}>
            Edit note
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={startEdit}>
          + Add business note for this date
        </button>
      )}
    </div>
  );
}

/** The case's own codes - fallbacks for an order row that lacks them. */
interface CaseRef { state_code?: number; district_code?: number; court_code?: number; case_no?: string }

/**
 * The order PDF request from an order row. Interim and final rows differ
 * (interim rows carry `order_date1`, final rows `order_date1f`; some rows
 * lack codes), so missing codes come from the case, and the court tier is
 * always sent - a High Court order must be fetched from the HC service.
 */
function orderPdfInput(o: EcourtsOrder, cino: string, court: Court, c?: CaseRef) {
  const row = o as EcourtsOrder & Record<string, unknown>;
  const num = (...vals: unknown[]) => {
    for (const v of vals) { const n = Number(v); if (v !== undefined && v !== null && v !== '' && Number.isFinite(n)) return n; }
    return 0;
  };
  return {
    cino,
    filename: String(row.filename ?? ''),
    stateCd: num(row.state_cd, c?.state_code),
    distCd: num(row.dist_cd, c?.district_code),
    courtCode: num(row.court_code, c?.court_code),
    caseNo: String(row.caseno || c?.case_no || ''),
    cCode: num(row.cCode, row.court_code, c?.court_code),
    bilingualFlag: String(row.bilingual_flag ?? '0'),
    court,
  };
}

const orderDate = orderDateOf;

/** Interim Orders / Final Orders/Judgements table as in the app: Order
 *  Number | Order Date | Order Details, where the details open the PDF. */
function OrdersTable({ orders, cino, court, caseRef }: { orders: EcourtsOrder[]; cino: string; court: Court; caseRef?: CaseRef }) {
  const { t } = useEcourtsT();
  const download = useDownloadOrderPdf();
  const showToast = useUIStore((s) => s.showToast);
  // Track which row is in-flight so the button on that row alone shows
  // "Fetching…"; eCourts is too slow to leave the whole table looking idle.
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const handleDownload = async (o: EcourtsOrder, rowKey: string) => {
    setPendingKey(rowKey);
    try {
      const fname = await download.mutateAsync(orderPdfInput(o, cino, court, caseRef));
      showToast({ type: 'sage', text: `Downloaded ${fname}` });
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (err as Error).message ?? 'Could not download PDF';
      showToast({ type: 'vermillion', text: msg });
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 90 }}>{t(L.orderNumber, 'Order Number')}</th>
            <th style={{ width: 130 }}>{t(L.orderDate, 'Order Date')}</th>
            <th>{t(L.orderDetails, 'Order Details')}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o, i) => {
            const rowKey = `${o.order_id}-${i}`;
            const isPending = pendingKey === rowKey;
            return (
              <tr key={rowKey}>
                <td className="tabular">{o.order_id || i + 1}</td>
                <td className="tabular">{orderDate(o) || '—'}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => { void handleDownload(o, rowKey); }}
                    disabled={isPending}
                    title="Open the order PDF from eCourts"
                    style={{ textDecoration: 'underline', background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 600 }}
                  >
                    {isPending ? 'Fetching…' : (o.order_details || 'Order')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TransferList({ transfers }: { transfers: NonNullable<EcourtsCaseHistory['transfer']> }) {
  const { t } = useEcourtsT();
  return (
    <HistorySection title={t(L.caseTransferDetails, 'Case Transfer Details')}>
      <table className="tbl">
        <thead><tr><th style={{ width: 130 }}>Transfer Date</th><th>From Court</th><th>To Court</th></tr></thead>
        <tbody>
          {transfers.map((tr, i) => (
            <tr key={i}>
              <td className="tabular">{tr.transfer_date}</td>
              <td>{tr.from_court}</td>
              <td>{tr.to_court}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </HistorySection>
  );
}

// IA Business - Interim Application business/status, one of the 6 endpoints
// found by re-auditing the full decompiled APK (see ecourts.service.ts).
// Renders nothing if the case has no IAs (a legitimate empty answer, not an
// error) - same "don't show a blank section" discipline as TransferList.
function IaBusinessSection({ cino, court }: { cino: string; court: Court }) {
  const { data: items, isLoading } = useEcourtsIaBusiness(cino, court);
  const { t } = useEcourtsT();
  if (isLoading || !items || items.length === 0) return null;
  return (
    <HistorySection title={t(L.iaStatus, 'IA Status')}>
      <table className="tbl">
        <thead><tr><th>IA Number</th><th>{t(L.purposeOfHearing, 'Purpose of Hearing')}</th><th>{t(L.nextHearingDate, 'Next Date')}</th><th>{t(L.status, 'Status')}</th></tr></thead>
        <tbody>
          {items.map((ia, i) => (
            <tr key={i}>
              <td>{ia.ia_no ?? `IA ${i + 1}`}</td>
              <td>{ia.purpose || '—'}</td>
              <td className="tabular">{ia.nextdate || '—'}</td>
              <td>{ia.businessStatus || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </HistorySection>
  );
}

// Appellate info - whether this case has been through an appeal, one of the
// 6 endpoints found by re-auditing the full decompiled APK. The backend
// route needs a request body (court/case scope), so this triggers once on
// mount rather than auto-querying by CNR like IaBusinessSection. Renders
// nothing if every field besides the heading comes back empty (confirmed
// live: that's eCourts' own "no appellate activity" answer, not missing
// data) - same quiet-fail discipline as the rest of this view.
function AppellateInfoSection({
  stateCode, distCode, courtCode, caseNumber1, appCsNo, court,
}: { stateCode: number; distCode: number; courtCode: number; caseNumber1: string; appCsNo: string; court: Court }) {
  const mutation = useEcourtsAppellateInfo();
  const { mutate } = mutation;
  const { t } = useEcourtsT();
  useEffect(() => {
    if (!caseNumber1 || !appCsNo) return;
    mutate({ stateCode, distCode, courtCode, caseNumber1, appCsNo, court });
    // Only re-fetch if the underlying case identity actually changes - not
    // on every render (mutate/mutation identity is stable from TanStack
    // Query, but included for correctness).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateCode, distCode, courtCode, caseNumber1, appCsNo, court]);

  const info = mutation.data?.writInfo;
  if (!info) return null;
  const hasContent = Boolean(info.app_auth_desc || info.app_aut || info.dt_of_recp || info.dt_of_oder || info.order_brief);
  if (!hasContent) return null;

  return (
    <HistorySection title={t(L.appellateInformation, 'Appellate Information')}>
      {info.heading ? <p className="body-sm" style={{ marginBottom: 8 }}>{info.heading}</p> : null}
      <KvTable rows={[
        ...(info.app_aut ? [['Appellate Authority', info.app_aut] as const] : []),
        ...(info.app_auth_desc ? [['Authority Description', info.app_auth_desc] as const] : []),
        ...(info.dt_of_recp ? [['Date of Receipt', info.dt_of_recp] as const] : []),
        ...(info.dt_of_oder ? [['Date of Order', info.dt_of_oder] as const] : []),
        ...(info.order_brief ? [['Order', info.order_brief] as const] : []),
      ]} />
    </HistorySection>
  );
}

function Field({ label, value, mono, onClick, title }: { label: string; value: string; mono?: boolean; onClick?: () => void; title?: string }) {
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="mono" style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-tertiary)' }}>{label}</span>
      <span
        style={{
          fontSize: 14, fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          cursor: onClick ? 'pointer' : undefined,
          textDecoration: onClick ? 'underline' : undefined,
          textDecorationStyle: onClick ? 'dotted' : undefined,
        }}
        className={mono ? 'tabular' : ''}
        onClick={onClick}
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string | undefined | null): string {
  if (!iso) return '';
  // Accept YYYY-MM-DD or DD-MM-YYYY (eCourts mixes both).
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  return iso;
}

function fmtNextDate(raw: string): string {
  // Hearings sometimes deliver `20230112` (compact YYYYMMDD).
  if (/^\d{8}$/.test(raw)) {
    const y = raw.slice(0, 4); const m = raw.slice(4, 6); const d = raw.slice(6, 8);
    return fmtDate(`${y}-${m}-${d}`);
  }
  return raw;
}

// =============================================================================
// LiveBusinessInline — fetches the free-text "Business" narrative for ONE
// case directly by its CNR, inline on a search result row (Party Name,
// Advocate, Case Number, etc. all already return a `cino` per case from the
// fast mobile API). No state/district/complex picking - the CNR already
// encodes the court, so this is a single eCourts page (home/index) with one
// captcha. Each case looked up this way needs its own captcha solve,
// because eCourts requires one per lookup; there's no way to batch it.
// =============================================================================

type LiveBusinessInlineStep = 'idle' | 'captcha' | 'result';

type PreconnectState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'ready'; sessionId: string; captchaImageBase64: string }
  | { phase: 'failed'; error: string };

export interface LiveBusinessInlineHandle {
  /** Starts (or jumps straight to) the captcha/result flow - used so clicking a
   *  hearing row or the Latest Business purpose text can trigger the same
   *  fetch as the inline button, without duplicating the connect logic. */
  trigger: () => void;
}

const LiveBusinessInline = forwardRef<LiveBusinessInlineHandle, { cino: string; eager?: boolean }>(function LiveBusinessInline({ cino, eager = false }, ref) {
  const [step, setStep] = useState<LiveBusinessInlineStep>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const [historyHtml, setHistoryHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pre-connect state: started silently on mount so the advocate's click
  // usually lands on an already-open session instead of staring at a 15-30s
  // "Connecting…" spinner they triggered themselves. eCourts' own server is
  // what's slow/occasionally unresponsive - no code change fixes that - but
  // starting the connection before the advocate asks for it means the wait
  // happens while they're reading the case, not after they've clicked.
  const [preconnect, setPreconnect] = useState<PreconnectState>(eager ? { phase: 'connecting' } : { phase: 'idle' });
  const preconnectStarted = useRef(false);
  // This genuinely takes 10-20s (launching a real headless browser session
  // against the live eCourts site) - confirmed live, not a bug. With no
  // visible progress, a static "Preparing..." label for that long reads as
  // stuck/broken rather than working (confirmed: this exact confusion is
  // what prompted this fix). A ticking elapsed-seconds counter is enough to
  // show it's actively working without implying a fake progress bar.
  const [connectingSeconds, setConnectingSeconds] = useState(0);
  useEffect(() => {
    if (preconnect.phase !== 'connecting') { setConnectingSeconds(0); return; }
    const id = setInterval(() => setConnectingSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [preconnect.phase]);

  const startSession = useStartCnrLiveSession();
  const openLookup = useOpenLiveCnrLookup();
  const refreshCaptcha = useRefreshCnrCaptcha();
  const submitCaptcha = useSubmitCnrCaptcha();

  // eCourts' anti-bot defenses intermittently block or crash the connection
  // (observed live: outright 405s, page crashes, alongside genuine 15-30s
  // slow-but-working loads) - one silent retry absorbs the transient case
  // before surfacing an error for something that often just works a few
  // seconds later.
  const connect = async (isRetry = false): Promise<void> => {
    try {
      const { sessionId: id } = await startSession.mutateAsync();
      // The backend may transparently restart the session on a page crash
      // and return a different id than the one just sent - always use what
      // openLookup actually hands back for every call after this.
      const { captchaImageBase64, sessionId: finalId } = await openLookup.mutateAsync({ sessionId: id, cino });
      setPreconnect({ phase: 'ready', sessionId: finalId, captchaImageBase64 });
    } catch (err) {
      if (!isRetry) {
        await new Promise((r) => setTimeout(r, 1500));
        return connect(true);
      }
      setPreconnect({ phase: 'failed', error: errMsg(err, "eCourts is not responding right now - this can happen when their site is slow or under heavy automated-access protection. Try 'Live Business' again in a minute.") });
    }
  };

  useEffect(() => {
    // `eager` is true only on the single-case CNR detail card, not on
    // search-result rows - a results list can have dozens of cases, and
    // pre-connecting every row the moment the page renders would launch
    // that many background eCourts browser sessions for cases the advocate
    // may never click into. Non-eager rows keep today's click-to-connect.
    if (!eager || preconnectStarted.current) return;
    preconnectStarted.current = true;
    void connect();
    // Only ever run once per case card, on mount - cino doesn't change for a
    // mounted instance of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = () => {
    setError(null);
    if (preconnect.phase === 'ready') {
      setSessionId(preconnect.sessionId);
      setCaptchaImage(preconnect.captchaImageBase64);
      setStep('captcha');
      return;
    }
    // 'idle' (non-eager row, first click) or 'failed' (retry) both connect
    // fresh now - the only difference from the eager path is this request
    // happens on click instead of having already started on mount.
    setPreconnect({ phase: 'connecting' });
    void connect();
  };

  useImperativeHandle(ref, () => ({ trigger: handleStart }));

  const handleRefresh = async () => {
    if (!sessionId) return;
    try {
      const { captchaImageBase64 } = await refreshCaptcha.mutateAsync(sessionId);
      setCaptchaImage(captchaImageBase64); setCaptchaCode(''); setCaptchaError(null);
    } catch (err) {
      setError(errMsg(err, 'Could not refresh the captcha'));
    }
  };

  const handleSubmit = async () => {
    if (!sessionId) return;
    setCaptchaError(null);
    try {
      const result = await submitCaptcha.mutateAsync({ sessionId, captchaCode, cino });
      if ('retry' in result) {
        setCaptchaImage(result.captchaImageBase64); setCaptchaCode(''); setCaptchaError(result.reason);
        return;
      }
      setHistoryHtml(result.historyHtml); setStep('result');
    } catch (err) {
      setError(errMsg(err, 'Could not submit the captcha'));
    }
  };

  if (step === 'idle') {
    // Pre-connect already ran silently on mount - by the time the advocate
    // is here reading the case, the session is often already 'ready', so
    // clicking shows the captcha instantly instead of waiting live.
    const stillConnecting = preconnect.phase === 'connecting';
    return (
      <div className="col" style={{ gap: 6, alignItems: 'flex-start' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleStart} disabled={stillConnecting}>
          {stillConnecting
            ? `Connecting to eCourts… (${connectingSeconds}s - this takes ~10-20s, a real government site)`
            : <><Icon name="eye" size={12} /> Live Business (eCourts)</>}
        </button>
        {preconnect.phase === 'failed' ? (
          <p className="body-sm muted">eCourts didn't respond while preparing this - click above to try again.</p>
        ) : null}
        {error ? (
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleStart}>Retry</button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 8, padding: 12, background: 'var(--bg-subtle)', borderRadius: 6 }}>
      {step === 'captcha' && captchaImage ? (
        <>
          <span className="body-sm muted">Enter the code you see: eCourts requires this before showing live details.</span>
          <img
            src={`data:image/png;base64,${captchaImage}`}
            alt="eCourts captcha"
            style={{ border: '1px solid var(--border-default)', borderRadius: 4, width: 150 }}
          />
          {captchaError ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{captchaError}</p> : null}
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ maxWidth: 160 }}
              placeholder="Captcha code"
              value={captchaCode}
              onChange={(e) => setCaptchaCode(e.target.value)}
              autoFocus
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { void handleSubmit(); }} disabled={submitCaptcha.isPending || !captchaCode}>
              {submitCaptcha.isPending ? 'Submitting…' : 'Submit'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { void handleRefresh(); }} disabled={refreshCaptcha.isPending}>
              New image
            </button>
          </div>
        </>
      ) : null}
      {step === 'result' && historyHtml !== null ? (
        // eCourts' own rendered case-history markup for this CNR - a simple
        // labelled layout (Business / Next Purpose / Next Hearing Date), not
        // arbitrary third-party HTML.
        <div className="body-sm" dangerouslySetInnerHTML={{ __html: historyHtml }} />
      ) : null}
      {error ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{error}</p> : null}
    </div>
  );
});

function errMsg(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } }; message?: string };
  return e?.response?.data?.error ?? e?.message ?? fallback;
}
