import type { Page } from 'playwright';
import { EcourtsHttpError } from '../lib/ecourts';
import {
  closePortalPopups, htmlTable, onLoginForm, openPortalMenu, portalPost, withPortalPage, type PortalTableData,
} from './efiling-live.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DOM global, no dom lib in this tsconfig
declare const document: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- page-side values are untyped DOM objects
type Any = any;

// =============================================================================
// efiling-portal-casefiling.service
//
// The portal's Case Filing menu, live over the advocate's own logged-in
// session: New Case Filing (the PDE wizard), its Draft / eFiled case lists,
// and Manage Favourite Clients. Everything is read from and done on the
// portal's own page - DifAi shows the portal's tabs, fields (label, order,
// choices, required marks, its validation messages), buttons and lists as the
// page has them, sets values the way a person would (firing the page's own
// change handlers, so its cascades - District -> Establishment, Civil/Criminal
// -> Relief Sought -> Case Type, State -> District -> Taluka -> Village - run
// there), and presses the page's own buttons.
//
// What is known from the pages' own scripts (js/adv_case_registration/
// registration.js, litigant.js, macp.js, complainant.js, favourite_client.js,
// as served to a logged-in advocate; and docs/efiling-portal-reverse-
// engineering.md §2):
//   tabs   new_case_tab (#tab_add) Initial Inputs -> insertNewPDE (creates the
//          temporary e-filing number, #adv_pde_no) · litigant_tab (#tab1,
//          #frmAdvParty) insertPartyInformationTab · legal_heir_tab
//          (#frmLegalHeirNot / #frmAdvLegalHeirParty) insertPartyInformationTab_lh
//          · fact_tab (#frmAdvFact) insertFactTab -> insertFact · case_detail_tab
//          (#tab2, #frmAdvCaseDetail, acts in #act_section) insertCaseInfo ·
//          mvc_tab (#tab3, #frmAdvMVC, only when macp=='Y') insertMVC · MACT
//          states: victim_details_tab (#frmVictimDetails) insertVictimInformationTab,
//          accident_details_tab (#frmAccidentDetails) insertAccidentDetailsTab,
//          claim_computation_tab (#frmClaimComputationDeath / ...Injury)
//          insertClaimComputationTab / insertClaimComputationInjuryTab (macp/...) ·
//          criminal_tab9 (#frmPoliceStation) insertPoliceStationTab · complainant138_tab
//          (#frmComplainant138) insertComplainant138Tab · caveat_tab ·
//          subordinate_court_tab insertSubordinateCourt · eFile_tab (#tab5)
//          submitEfileData (its own confirm: "Do you want to submit the case?").
//          A tab stays .disabled until the portal enables it; the page's
//          showNextTab moves between them.
//   lists  parties #dropdown_content10 (editPDECaseParty / delPDECaseParty),
//          previous-case parties #dropdown_content11 (editPDEPrevCaseParty),
//          legal heirs #dropdown_content_lh (editPDE_LHCaseParty / delPDE_LHCaseParty);
//          drafts #dvEditCase (getUnRegisteredPDE(page, 10) with #txtEditCaseSearch;
//          rows grouped by columns 7 and 1; fetchPDECaseData opens one,
//          deletePDECase deletes), filed #dvSubmittedPDE (getSubmittedNewCases
//          (page, 10) with #txtAppSearch; grouped by columns 1 and 3).
//   clients Manage Favourite Clients (favourite_client.js): #new_client_tab
//          with Client (#frmAdvParty, insertClientInformationTab ->
//          insertFavouriteParty) and Organization (#frmOrg, insertOrgInformationTab);
//          #edit_client_tab lists them (favourite_client_list -> #dvClientList):
//          fetchFavClient (edit), deleteFavClient, getClientCases.
//   acts   #fdispactcodes<n> autocompletes from getActs (sets #fhiddactcodes<n>,
//          #factcodes<n>); #factsection_code<n> from autocomplete_section +
//          fetch_sectioncode.
// Field NAMES and labels are server-rendered (not in the JS), which is why
// they are read from the page every time rather than written down here.
//
// Deleting anything and "eFile Case" need { confirmed: true } from the
// advocate; the portal's own confirm() is accepted only then.
// =============================================================================

export type CaseFilingTabKey =
  | 'initial' | 'litigant' | 'legal_heir' | 'facts' | 'case_details' | 'police' | 'complainant138' | 'caveat'
  | 'mvc' | 'victim' | 'accident' | 'claim' | 'subordinate' | 'efile'
  | 'client' | 'organisation';
export type PartyListKey = 'parties' | 'prev_parties' | 'lh_parties';
export type CaseListKey = 'draft' | 'filed' | 'clients';
/** The two Case Filing pages DifAi works on: New Case Filing and Manage Favourite Clients. */
export type ScreenKey = 'new_case' | 'clients';

export const CASE_FILING_TABS: readonly CaseFilingTabKey[] = [
  'initial', 'litigant', 'legal_heir', 'facts', 'case_details', 'police', 'complainant138', 'caveat',
  'mvc', 'victim', 'accident', 'claim', 'subordinate', 'efile', 'client', 'organisation',
];

interface TabDef {
  key: CaseFilingTabKey;
  /** Used only when the portal's tab link has no text. */
  label: string;
  /** The tab link (a CSS selector, from the page's scripts). */
  anchor: string;
  /** A tab that must be open first (Manage Favourite Clients' "Add Client"). */
  outer?: string;
  /** The pane the link shows, when its href doesn't say. */
  pane: string;
  forms: string[];
  /** The tab's save: the page function(s) its Save button calls, and the request each makes. */
  save: Array<{ fn: string; route: string }>;
  lists: PartyListKey[];
  /** e-File tab: what each tab saved, as the portal summarises it before eFiling. */
  summary: Array<{ id: string; title: string }>;
}

const tab = (key: CaseFilingTabKey, label: string, anchor: string, pane: string, forms: string[], save: Array<[string, string]>, extra: Partial<TabDef> = {}): TabDef =>
  ({ key, label, anchor, pane, forms, save: save.map(([fn, route]) => ({ fn, route })), lists: [], summary: [], ...extra });

// Shown in the page's own order (DifAi sorts by where the links sit).
const TABS: TabDef[] = [
  tab('initial', 'Initial Inputs', '#new_case_tab', 'tab_add', ['frmInitialInput1', 'frmInitialInput2', 'frmSubordinate', 'frmapplication_court'], [['insertNewPDE', 'insertNewPDE']]),
  tab('victim', 'Victim Details', '#victim_details_tab', '', ['frmVictimDetails'], [['insertVictimInformationTab', 'insertVictimInformationTab']]),
  tab('litigant', 'Litigant', '#litigant_tab', 'tab1', ['frmAdvParty'], [['insertPartyInformationTab', 'insertPartyInformationTab']], { lists: ['parties', 'prev_parties'] }),
  tab('legal_heir', 'Legal Heir', '#legal_heir_tab', '', ['frmLegalHeirNot', 'frmAdvLegalHeirParty', 'frmLegalHeirAdd'], [['insertPartyInformationTab_lh', 'insertPartyInformationTab_lh']], { lists: ['lh_parties'] }),
  tab('facts', 'Fact Details', '#fact_tab', '', ['frmAdvFact'], [['insertFactTab', 'insertFact']]),
  tab('complainant138', 'Complainant 138', '#complainant138_tab', 'tab138', ['frmComplainant138'], [['insertComplainant138Tab', 'insertComplainant138']]),
  tab('police', 'Police Station', '#criminal_tab9', '', ['frmPoliceStation'], [['insertPoliceStationTab', 'insertPoliceStation']]),
  tab('case_details', 'Case Details', '#case_detail_tab', 'tab2', ['frmAdvCaseDetail'], [['insertCaseInfo', 'insertCaseInfo']]),
  tab('caveat', 'Caveat', '#caveat_tab', '', [], []),
  tab('mvc', 'MVC', '#mvc_tab', 'tab3', ['frmAdvMVC'], [['insertMVC', 'insertMVC']]),
  tab('accident', 'Accident Details', '#accident_details_tab', '', ['frmAccidentDetails'], [['insertAccidentDetailsTab', 'insertAccidentDetailsTab']]),
  tab('claim', 'Claim Computation', '#claim_computation_tab', '', ['frmClaimComputationDeath', 'frmClaimComputationInjury'],
    [['insertClaimComputationTab', 'insertClaimComputationTab'], ['insertClaimComputationInjuryTab', 'insertClaimComputationInjuryTab']]),
  tab('subordinate', 'Subordinate Court', '#subordinate_court_tab', '', [], [['insertSubordinateCourt', 'insertSubordinateCourt']]),
  tab('efile', 'e-File', '#eFile_tab', 'tab5', [], [], {
    summary: [
      { id: 'litigant_tab1', title: 'Litigant' }, { id: 'compainant_138_tab', title: 'Complainant 138' }, { id: 'fact_detail_tab1', title: 'Fact Details' },
      { id: 'police_station_tab1', title: 'Police Station' }, { id: 'case_detail_tab1', title: 'Case Details' }, { id: 'victim_tab1', title: 'Victim Details' },
      { id: 'accident_tab1', title: 'Accident Details' }, { id: 'claim_tab1', title: 'Claim Computation' }, { id: 'mvc_tab1', title: 'MVC' },
      { id: 'subordinate_court_tab1', title: 'Subordinate Court' },
    ],
  }),
];

// Manage Favourite Clients: "Add Client" (#new_client_tab -> #new_client) holds
// the Client and Organization forms.
const CLIENT_TABS: TabDef[] = [
  tab('client', 'Client', 'a[href="#new_party"]', 'new_party', ['frmAdvParty'], [['insertClientInformationTab', 'insertFavouriteParty']], { outer: '#new_client_tab' }),
  tab('organisation', 'Organization', 'a[href="#new_organisation"]', 'new_organisation', ['frmOrg'], [['insertOrgInformationTab', 'insertOrgInformationTab']], { outer: '#new_client_tab' }),
];

interface Screen { key: ScreenKey; label: string; menu: RegExp; defs: TabDef[] }

const SCREENS: Record<ScreenKey, Screen> = {
  new_case: { key: 'new_case', label: 'New Case Filing', menu: /new\s*case\s*filing/i, defs: TABS },
  clients: { key: 'clients', label: 'Manage Favourite Clients', menu: /favou?rite\s*clients?/i, defs: CLIENT_TABS },
};

const PARTY_LISTS: Record<PartyListKey, { id: string; count: string; title: string; label: string }> = {
  parties: { id: 'dropdown_content10', count: 'tot_delay_count', title: '', label: 'Parties' },
  prev_parties: { id: 'dropdown_content11', count: 'tot_party_count', title: 'prev_case_title', label: 'Parties of the previous case' },
  lh_parties: { id: 'dropdown_content_lh', count: 'tot_delay_count_lh', title: '', label: 'Legal heirs' },
};

// ---- what DifAi shows -----------------------------------------------------------

export interface CaseFilingOption { value: string; text: string; disabled?: boolean }

export interface CaseFilingField {
  /** '#<id>', 'radio:<name>' or '<name>@<n>' - how DifAi finds it on the page again. */
  key: string;
  id: string;
  name: string;
  kind: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'number' | 'email' | 'tel';
  label: string;
  required: boolean;
  value: string;
  checked?: boolean;
  options?: CaseFilingOption[];
  placeholder: string;
  maxLength: number | null;
  disabled: boolean;
  readOnly: boolean;
  /** The page reacts to this one at once (fills the next dropdown, shows/hides fields). */
  live: boolean;
  /** Act / section boxes: the portal suggests as you type. */
  suggest?: 'act' | 'section';
  /** The portal's own validation message under the field. */
  error?: string;
}

export interface CaseFilingSection { title: string; fields: CaseFilingField[] }

export interface CaseFilingButton {
  key: string;
  text: string;
  /** The page function it calls (from its onclick), when it names one. */
  fn: string;
  kind: 'save' | 'efile' | 'delete' | 'action';
  disabled: boolean;
}

export interface CaseFilingAction {
  label: string;
  fn: string;
  kind: 'open' | 'edit' | 'delete' | 'pdf' | 'status' | 'other';
  /** The first argument it passes (a PDE number, a "type~no" party key). */
  arg: string | null;
  /** The cell (column) it sits in. */
  cell: number;
}

export type CaseFilingRow = { group: string } | { cells: string[]; actions?: CaseFilingAction[] };

export interface CaseFilingTable { headers: string[]; rows: CaseFilingRow[] }

export interface CaseFilingPartyList { key: PartyListKey; title: string; total: number | null; table: CaseFilingTable }

export interface CaseFilingTab {
  key: CaseFilingTabKey;
  label: string;
  present: boolean;
  shown: boolean;
  enabled: boolean;
  active: boolean;
  /** The portal coloured it red after a failed eFile. */
  error: boolean;
  paneId: string;
  sections?: CaseFilingSection[];
  buttons?: CaseFilingButton[];
  lists?: CaseFilingPartyList[];
  summary?: Array<{ title: string; tables: PortalTableData[]; text: string }>;
}

export interface CaseFilingWizard {
  screen: ScreenKey;
  /** The portal's temporary e-filing (PDE) number, once Initial Inputs is saved. */
  pdeNo: string | null;
  caseTitle: string;
  petLabel: string;
  resLabel: string;
  /** "Please fill <Petitioner> entry" and similar notes the page shows. */
  notice: string;
  mode: 'insert' | 'edit' | null;
  /** False when the case is another advocate's (the portal hides eFile then). */
  efileAllowed: boolean;
  tab: CaseFilingTabKey;
  tabs: CaseFilingTab[];
}

export interface CaseFilingStepResult {
  ok: boolean;
  /** What the portal said (its alerts, success / error messages). */
  portal: string[];
  notApplied?: Array<{ key: string; reason: string }>;
  wizard: CaseFilingWizard;
}

export interface CaseFilingList extends CaseFilingTable {
  /** Server-side pages (the page's getUnRegisteredPDE / getSubmittedNewCases (page, 10)). */
  page: number;
  pages: number;
  /** "Showing a to b of n" as the portal words it (records_info). */
  info: string;
  search: string;
  list: CaseListKey;
  label: string;
  total: number | null;
  error: string | null;
}

// ---- the page side ------------------------------------------------------------------
//
// One function runs inside the portal page for every read and every act, so a
// field or button is found the same way when it is shown and when it is used.

interface DomArgs { defs: TabDef[]; lists: typeof PARTY_LISTS; op: string; tab: string; payload: Any }


const DOM = (a: DomArgs): Any => {
  const W: Any = globalThis;
  const D: Any = document;
  const txt = (e: Any): string => String(e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const byId = (id: string): Any => (id ? D.getElementById(id) : null);
  const q = (sel: string): Any => (sel ? D.querySelector(sel) : null);
  const esc = (s: string): string => (W.CSS?.escape ? W.CSS.escape(s) : String(s).replace(/"/g, '\\"'));
  const hiddenStyle = (n: Any): boolean => { const s = W.getComputedStyle(n); return s.display === 'none' || s.visibility === 'hidden'; };
  // Visible as the page draws it; tab panes count as open (DifAi opens tabs itself).
  const shown = (el: Any): boolean => {
    let e = el;
    const next = e.nextElementSibling;
    if (e.tagName === 'SELECT' && next && /chosen-container/.test(String(next.className))) e = next;
    for (let n = e; n && n !== D.body && n !== D.documentElement; n = n.parentElement) {
      if (n.classList?.contains('tab-pane')) continue;
      if (hiddenStyle(n)) return false;
    }
    return true;
  };
  const docOrder = (x: Any, y: Any): number => (x === y ? 0 : x.compareDocumentPosition(y) & 4 ? -1 : 1);
  const hrefId = (x: Any): string => String(x?.getAttribute('href') || x?.getAttribute('data-target') || x?.getAttribute('data-bs-target') || '').replace(/^[^#]*#?/, '');
  const paneOf = (d: TabDef): Any => {
    const fromAnchor = byId(hrefId(q(d.anchor)));
    if (fromAnchor) return fromAnchor;
    if (d.pane && byId(d.pane)) return byId(d.pane);
    const f = d.forms.map(byId).find(Boolean);
    return f ? f.closest('.tab-pane') : null;
  };
  const fnOf = (b: Any): string => {
    const code = String(b.getAttribute('onclick') ?? '') || String(b.getAttribute('href') ?? '').replace(/^javascript:/i, '');
    return /([A-Za-z_$][\w$]*)\s*\(/.exec(code)?.[1] ?? '';
  };
  const argOf = (b: Any): string | null => {
    const code = String(b.getAttribute('onclick') ?? '') || String(b.getAttribute('href') ?? '');
    const m = /\(\s*['"]?([^'",)]*)/.exec(code);
    return m && m[1] ? m[1].trim() : null;
  };
  // Only when the portal's link has no text or title of its own (icon buttons).
  const FN_LABEL: Record<string, string> = {
    fetchPDECaseData: 'Edit', deletePDECase: 'Delete', deleteSubmittedPDECase: 'Delete', editPDECaseParty: 'Edit', delPDECaseParty: 'Delete',
    editPDE_LHCaseParty: 'Edit', delPDE_LHCaseParty: 'Delete', editPDEPrevCaseParty: 'Select', generateCasePDF: 'View', generateCaseHistoryPDF: 'History', getStatus: 'Status',
    fetchFavClient: 'Edit', deleteFavClient: 'Delete', getClientCases: 'Cases',
  };
  const actionKind = (fn: string, label: string): string => (fn === 'fetchPDECaseData' ? 'open'
    : /^(del|delete|remove)/i.test(fn) || /\b(delete|remove)\b/i.test(label) ? 'delete'
      : /pdf/i.test(fn) ? 'pdf' : fn === 'getStatus' ? 'status' : /^edit/i.test(fn) || fn === 'fetchFavClient' ? 'edit' : 'other');
  const cellText = (c: Any): string => {
    const k = c.cloneNode(true);
    for (const e of [...k.querySelectorAll('script, style, .modal, [style*="display:none"], [style*="display: none"]')]) e.remove();
    const sel = k.querySelector('select');
    if (sel) return [...sel.options].map(txt).filter((t: string) => t && !/^select/i.test(t)).join(', ');
    for (const br of [...k.querySelectorAll('br')]) br.replaceWith('\n');
    for (const b of [...k.querySelectorAll('div, p, li, tr')]) b.append('\n');
    return String(k.textContent ?? '').split('\n').map((x: string) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  };
  const rowEls = (t: Any): Any[] => {
    const $ = W.jQuery;
    // DataTables keeps rows of other pages out of the document: ask it for all.
    if ($?.fn?.dataTable?.isDataTable?.(t)) return $(t).DataTable().rows().nodes().toArray();
    return (t.tBodies?.length ? [...t.tBodies].flatMap((b: Any) => [...b.rows]) : [...t.rows]).filter((r: Any) => r.parentElement?.tagName !== 'THEAD');
  };
  const actionsOf = (tr: Any): Array<{ el: Any; label: string; fn: string; kind: string; arg: string | null; cell: number }> => {
    const out: Array<{ el: Any; label: string; fn: string; kind: string; arg: string | null; cell: number }> = [];
    const cellsOf = [...tr.cells];
    for (const b of [...tr.querySelectorAll('a, button, input[type=button], img[onclick], i[onclick], span[onclick]')] as Any[]) {
      const fn = fnOf(b);
      if (!fn) continue;
      let label = txt(b) || String(b.value ?? '').trim() || b.getAttribute('title') || b.getAttribute('data-original-title') || b.getAttribute('aria-label') || b.getAttribute('alt') || FN_LABEL[fn] || fn;
      label = String(label).replace(/\s+/g, ' ').trim().slice(0, 40);
      if (out.some((o) => o.el.contains(b) || b.contains(o.el))) continue;
      const n = out.filter((o) => o.label === label || o.label.startsWith(`${label} (`)).length;
      out.push({ el: b, label: n ? `${label} (${n + 1})` : label, fn, kind: actionKind(fn, label), arg: argOf(b), cell: cellsOf.indexOf(b.closest('td, th')) });
    }
    return out;
  };
  const tableOf = (root: Any): { headers: string[]; rows: Any[]; trs: Any[] } => {
    const t = root ? (root.tagName === 'TABLE' ? root : root.querySelector('table')) : null;
    if (!t) return { headers: [], rows: [], trs: [] };
    let headRow = t.tHead?.rows?.[t.tHead.rows.length - 1];
    if (!headRow) headRow = t.closest('.dataTables_wrapper')?.querySelector('.dataTables_scrollHead thead tr:last-child');
    let headers: string[] = headRow ? [...headRow.cells].map(txt) : [];
    const trs: Any[] = [];
    const rows: Any[] = [];
    for (const tr of rowEls(t)) {
      const cells = [...tr.cells] as Any[];
      if (!cells.length) continue;
      if (!headers.length && cells.every((c) => c.tagName === 'TH')) { headers = cells.map(txt); continue; }
      if (cells.length === 1 && Number(cells[0].getAttribute('colspan') || 1) > 1) { rows.push({ group: txt(cells[0]) }); trs.push(null); continue; }
      const texts = cells.map(cellText);
      // DataTables' own "No data available in table" row.
      if (cells.length === 1 && /dataTables_empty/.test(String(cells[0].className))) continue;
      if (!texts.some(Boolean)) continue;
      const actions = actionsOf(tr).map(({ label, fn, kind, arg, cell }) => ({ label, fn, kind, arg, cell }));
      rows.push(actions.length ? { cells: texts, actions } : { cells: texts });
      trs.push(tr);
    }
    return { headers, rows, trs };
  };

  const tabDef = a.defs.find((d) => d.key === a.tab) ?? a.defs[0]!;
  const saveFns = tabDef.save.map((x) => x.fn);
  const pane = paneOf(tabDef);
  const listSel = Object.values(a.lists).map((l) => `#${l.id}`).join(', ');
  const roots0 = [pane, ...tabDef.forms.map(byId)].filter(Boolean);
  const roots = roots0.filter((r: Any, i: number) => roots0.indexOf(r) === i && !roots0.some((o: Any) => o !== r && o.contains(r)));
  const ownForms = tabDef.forms.map(byId).filter(Boolean);
  const otherPanes = a.defs.filter((d) => d.key !== tabDef.key).map(paneOf).filter((p: Any) => p && p !== pane && !(pane && p.contains(pane)));
  const skip = (el: Any): boolean => {
    if (el.closest(`${listSel}, .dataTables_wrapper, .chosen-container, .ui-autocomplete, .nav-tabs`)) return true;
    if (ownForms.some((f: Any) => f.contains(el))) return false;
    return otherPanes.some((p: Any) => p.contains(el));
  };
  const collect = (sel: string): Any[] => {
    const seen = new Set<Any>();
    const out: Any[] = [];
    for (const r of roots) for (const el of r.querySelectorAll(sel)) if (!seen.has(el)) { seen.add(el); out.push(el); }
    return out.sort(docOrder).filter((el) => !skip(el));
  };
  const controls = (): Any[] => collect('input, select, textarea').filter((el) => !/^(hidden|button|submit|reset|image|file)$/i.test(el.type || ''));
  const buttons = (): Any[] => collect('button, input[type=button], input[type=submit], a.btn, a[onclick]');
  const keyOf = (el: Any, all: Any[]): string => {
    if (el.type === 'radio' && el.name) return `radio:${el.name}`;
    if (el.id) return `#${el.id}`;
    const same = el.name ? all.filter((x) => x.name === el.name) : all.filter((x) => !x.name && !x.id && x.tagName === el.tagName);
    return `${el.name || el.tagName.toLowerCase()}@${same.indexOf(el)}`;
  };
  const btnText = (b: Any): string => (txt(b) || String(b.value ?? '').trim() || b.getAttribute('title') || '').slice(0, 60);
  const btnKey = (b: Any, all: Any[]): string => (b.id ? `#${b.id}` : `btn@${all.indexOf(b)}`);
  const btnKind = (b: Any): string => {
    const fn = fnOf(b);
    const t = btnText(b);
    if (fn === 'submitEfileData' || /^e-?file(\s*case)?$/i.test(t)) return 'efile';
    if (saveFns.includes(fn)) return 'save';
    if (/^(del|delete|remove)/i.test(fn) || /\b(delete|remove)\b/i.test(t)) return 'delete';
    return 'action';
  };

  if (a.op === 'tabs' || a.op === 'read') {
    const tabs = a.defs.map((d) => {
      const anchor = q(d.anchor);
      const li = anchor?.closest('li');
      const p = paneOf(d);
      const formsHere = d.forms.some((f) => byId(f));
      let vis = true;
      if (anchor) for (let n = anchor; n && n !== D.body; n = n.parentElement) if (!n.classList?.contains('tab-pane') && hiddenStyle(n)) { vis = false; break; }
      return {
        key: d.key, label: (anchor ? txt(anchor) : '') || d.label, paneId: p?.id ?? '',
        present: !!anchor || formsHere,
        shown: anchor ? vis : formsHere,
        enabled: anchor ? !anchor.classList.contains('disabled') && !li?.classList.contains('disabled') : formsHere,
        active: !!(anchor && (anchor.classList.contains('active') || li?.classList.contains('active') || p?.classList.contains('active'))),
        error: !!anchor && /color:\s*(red|rgb\(255,\s*0,\s*0\))/i.test(String(anchor.getAttribute('style') ?? '')),
        anchorEl: anchor,
      };
    });
    // The page's own order of its tab links.
    tabs.sort((x: Any, y: Any) => (x.anchorEl && y.anchorEl ? docOrder(x.anchorEl, y.anchorEl) : x.anchorEl ? -1 : y.anchorEl ? 1 : 0));
    for (const t of tabs as Any[]) delete t.anchorEl;
    if (a.op === 'tabs') return tabs;

    const all = controls();
    const labelFor = (el: Any): Any => (el.id ? D.querySelector(`label[for="${esc(el.id)}"]`) : null);
    const ownLabel = (el: Any): string => { const l = labelFor(el); if (l && txt(l)) return txt(l); const w = el.closest('label'); return w ? txt(w) : ''; };
    const nearLabel = (el: Any, exclude: Any[]): string => {
      let p = el.parentElement;
      for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
        const cands = ([...p.querySelectorAll('label, .control-label')] as Any[]).filter((l) => (l.compareDocumentPosition(el) & 4) && txt(l)
          && !exclude.some((e) => e === l || l.contains(e)) && !l.querySelector('input, select, textarea')
          && (!l.htmlFor || l.htmlFor === el.id || !byId(l.htmlFor)) && !/\berror\b/.test(String(l.className)));
        if (cands.length) return txt(cands[cands.length - 1]);
        const prev = p.previousElementSibling;
        if (prev && !prev.querySelector('input, select, textarea') && txt(prev) && txt(prev).length < 100) return txt(prev);
        if (roots.includes(p)) break;
      }
      return '';
    };
    const sectionOf = (el: Any): string => {
      for (let n = el; n && !roots.includes(n) && n !== D.body; n = n.parentElement) {
        for (let s = n.previousElementSibling; s; s = s.previousElementSibling) {
          if (s.id === 'dvCaseHeader') continue;
          if (/^(H[1-6]|LEGEND)$/.test(s.tagName) || /(^|\s)(card-header|panel-heading|box-title|heading)(\s|$)/.test(String(s.className))) {
            const t = txt(s);
            if (t && t.length < 90) return t;
          }
          const h = s.querySelector?.('h1, h2, h3, h4, h5, h6, legend, .card-header, .panel-heading, .box-title');
          if (h && !s.querySelector('input, select, textarea')) { const t = txt(h); if (t && t.length < 90) return t; }
        }
      }
      return '';
    };
    const errorOf = (el: Any): string => {
      const e = (el.id && (byId(`${el.id}-error`) || D.querySelector(`label.error[for="${esc(el.id)}"]`))) || (el.name && D.querySelector(`label.error[for="${esc(el.name)}"]`));
      return e && shown(e) ? txt(e) : '';
    };
    const jq = (el: Any, t: string): boolean => !!W.jQuery?._data?.(el, 'events')?.[t];
    // Bound by litigant.js itself ($('.rdoCivCrim').change, name=ftype / pet_res ... radios).
    const live = (el: Any): boolean => !!(el.getAttribute('onchange') || ((el.type === 'radio' || el.type === 'checkbox') && el.getAttribute('onclick'))
      || jq(el, 'change') || jq(el, 'click') || /\b(rdoCivCrim|rdoHCDC)\b/.test(String(el.className))
      || /^(ftype|ftype_lh|fcasetype|rdoCourtType|pet_res|pet_res_legal_heir|rdoCaseFiled)$/.test(el.name || '')
      || /^(fextraorg_check|fother_check|fother_check_lh|hidepolicest)$/.test(el.id || ''));
    const clean = (s: string): string => s.replace(/\*/g, '').replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim();
    const fields: Any[] = [];
    const radiosDone = new Set<string>();
    for (const el of all) {
      const key = keyOf(el, all);
      if (el.type === 'radio') {
        if (radiosDone.has(key)) continue;
        radiosDone.add(key);
        const group = all.filter((x) => x.type === 'radio' && x.name === el.name);
        const vis = group.filter(shown);
        if (!vis.length) continue;
        const own = group.map((r) => labelFor(r) ?? r.closest('label')).filter(Boolean);
        const raw = nearLabel(el, [...own, ...group]);
        fields.push({
          key, id: '', name: el.name, kind: 'radio', label: clean(raw), required: /\*/.test(raw) || group.some((r) => r.required),
          value: String(group.find((r) => r.checked)?.value ?? ''),
          options: vis.map((r) => ({ value: String(r.value), text: clean(ownLabel(r) || txt(r.nextSibling) || String(r.value)), ...(r.disabled ? { disabled: true } : {}) })),
          placeholder: '', maxLength: null, disabled: vis.every((r) => r.disabled), readOnly: false, live: group.some(live),
          section: sectionOf(el), error: errorOf(el),
        });
        continue;
      }
      if (!shown(el)) continue;
      const raw = el.type === 'checkbox' ? (ownLabel(el) || nearLabel(el, [])) : (ownLabel(el) || nearLabel(el, []));
      const idn = `${el.id || ''} ${el.name || ''}`;
      const kind = el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : el.type === 'checkbox' ? 'checkbox'
        : (/hasDatepicker/.test(String(el.className)) || /date|dob/i.test(idn)) && el.type !== 'number' ? 'date'
          : ['number', 'email', 'tel'].includes(el.type) ? el.type : 'text';
      const ml = Number(el.getAttribute('maxlength'));
      fields.push({
        key, id: el.id || '', name: el.name || '', kind,
        label: clean(raw) || clean(el.getAttribute('placeholder') || el.getAttribute('title') || el.name || el.id || ''),
        required: !!el.required || /\*/.test(raw) || el.classList.contains('required') || el.getAttribute('aria-required') === 'true',
        value: el.type === 'checkbox' ? (el.checked ? String(el.value || 'Y') : '') : String(el.value ?? ''),
        ...(el.type === 'checkbox' ? { checked: !!el.checked } : {}),
        ...(el.tagName === 'SELECT' ? { options: ([...el.options] as Any[]).slice(0, 3000).map((o) => ({ value: String(o.value), text: txt(o), ...(o.disabled ? { disabled: true } : {}) })) } : {}),
        placeholder: String(el.getAttribute('placeholder') ?? ''), maxLength: ml > 0 ? ml : null,
        disabled: !!el.disabled, readOnly: !!el.readOnly && kind !== 'date', live: live(el),
        ...(/^fdispactcodes/.test(el.id || '') ? { suggest: 'act' } : /^factsection_code/.test(el.id || '') ? { suggest: 'section' } : {}),
        section: sectionOf(el), error: errorOf(el),
      });
    }
    const allBtns = buttons();
    const btns = allBtns.filter(shown).map((b) => ({ key: btnKey(b, allBtns), text: btnText(b), fn: fnOf(b), kind: btnKind(b), disabled: !!b.disabled || b.classList.contains('disabled') }))
      .filter((b) => b.text);
    const lists = tabDef.lists.map((k) => {
      const l = a.lists[k];
      const el = byId(l.id);
      if (!el || !shown(el)) return null;
      const t = tableOf(el);
      if (!t.rows.length) return null;
      const count = /\d+/.exec(txt(byId(l.count)))?.[0];
      const title = l.title && txt(byId(l.title)) ? `${l.label} - ${txt(byId(l.title))}` : l.label;
      return { key: k, title, total: count ? Number(count) : t.rows.filter((r: Any) => 'cells' in r).length, table: { headers: t.headers, rows: t.rows } };
    }).filter(Boolean);
    const summary = tabDef.summary.map((s) => {
      const el = byId(s.id);
      if (!el || !shown(el) || !txt(el)) return null;
      const tables = ([...el.querySelectorAll('table')] as Any[]).filter((t) => !t.parentElement?.closest('table') || !el.contains(t.parentElement.closest('table')));
      const k = el.cloneNode(true);
      for (const t of [...k.querySelectorAll('table')]) t.remove();
      return { title: s.title, html: tables.map((t) => String(t.outerHTML)), text: txt(k).slice(0, 2000) };
    }).filter(Boolean);
    const finals = [...D.querySelectorAll('.dvFinalSubmit')] as Any[];
    const mode = String(byId('form_active_mode')?.value ?? '');
    return {
      pdeNo: String(byId('adv_pde_no')?.value ?? '').trim() || null,
      caseTitle: byId('dvCaseHeader') && shown(byId('dvCaseHeader')) ? txt(byId('dvCaseHeader')) : '',
      petLabel: txt(byId('pet_label')), resLabel: txt(byId('res_label')),
      notice: ([...D.querySelectorAll('.dvPartyField')] as Any[]).filter(shown).map(txt).filter(Boolean).join(' '),
      mode: mode === '1' ? 'insert' : mode === '2' ? 'edit' : null,
      efileAllowed: finals.length ? finals.some(shown) : true,
      tabs, fields, buttons: btns, lists, summary,
    };
  }

  if (a.op === 'show') {
    const outer = q(tabDef.outer ?? '');
    if (outer && !outer.classList.contains('active')) outer.click();
    const anchor = q(tabDef.anchor);
    if (!anchor) return { ok: false, reason: 'absent' };
    if (anchor.classList.contains('disabled') || anchor.closest('li')?.classList.contains('disabled')) return { ok: false, reason: 'disabled' };
    anchor.click();
    return { ok: true };
  }

  if (a.op === 'set') {
    const all = controls();
    const { key, value } = a.payload as { key: string; value: string | boolean };
    const targets = all.filter((el) => keyOf(el, all) === key);
    if (!targets.length) return { ok: false, reason: 'not on the portal form' };
    const fire = (el: Any, types: string[]) => {
      for (const t of types) el.dispatchEvent(new W.Event(t, { bubbles: true }));
      if (W.jQuery) W.jQuery(el).trigger('chosen:updated');
    };
    const el = targets[0];
    if (el.type === 'radio') {
      const r = targets.find((x) => String(x.value) === String(value));
      if (!r) return { ok: false, reason: 'not a choice the portal offers' };
      if (!r.checked) r.click();
      return { ok: true };
    }
    if (el.type === 'checkbox') {
      const on = value === true || value === 'Y' || value === 'true' || value === '1' || (typeof value === 'string' && value !== '' && value === el.value);
      if (el.checked !== on) el.click();
      return { ok: true };
    }
    if (el.disabled) return { ok: false, reason: 'the portal has it switched off' };
    if (el.tagName === 'SELECT') {
      if (!([...el.options] as Any[]).some((o) => String(o.value) === String(value))) return { ok: false, reason: 'not a choice the portal offers' };
      el.value = String(value);
      fire(el, ['change']);
      return { ok: true };
    }
    el.value = String(value);
    fire(el, ['input', 'change']);
    el.dispatchEvent(new W.Event('blur'));
    return { ok: true };
  }

  if (a.op === 'press') {
    const all = buttons();
    const { key, text } = a.payload as { key: string; text?: string };
    let b = all.find((x) => btnKey(x, all) === key && (!text || btnText(x) === text));
    if (!b && text) b = all.find((x) => shown(x) && btnText(x) === text);
    if (!b || !shown(b)) return { ok: false, reason: 'not on the portal page now' };
    if (b.disabled || b.classList.contains('disabled')) return { ok: false, reason: 'switched off on the portal' };
    W.__difaiClick = b;
    return { ok: true, fn: fnOf(b), kind: btnKind(b), text: btnText(b) };
  }

  if (a.op === 'row') {
    const { container, match, label } = a.payload as { container: string; match: string[]; label: string };
    const root = byId(container);
    if (!root) return { ok: false, reason: 'list' };
    const t = tableOf(root);
    // DataTables on the page hides the grouping columns: the row is the one holding these texts.
    const i = t.rows.findIndex((r: Any) => 'cells' in r && match.every((m) => r.cells.includes(m)));
    if (i < 0) return { ok: false, reason: 'row' };
    const act = actionsOf(t.trs[i]).find((x) => x.label === label);
    if (!act) return { ok: false, reason: 'action' };
    W.__difaiClick = act.el;
    return { ok: true, fn: act.fn, kind: act.kind, arg: act.arg };
  }

  if (a.op === 'click') {
    const el = W.__difaiClick;
    W.__difaiClick = null;
    if (!el) return { ok: false };
    // After this evaluate returns, so a confirm() it opens doesn't hold it.
    W.setTimeout(() => el.click(), 0);
    return { ok: true };
  }

  if (a.op === 'call') {
    const f = W[a.payload.fn];
    if (typeof f !== 'function') return { ok: false };
    const args = a.payload.args ?? [];
    W.setTimeout(() => f(...args), 0);
    return { ok: true };
  }

  if (a.op === 'table') {
    const t = tableOf(byId(a.payload.container));
    return { headers: t.headers, rows: t.rows };
  }

  if (a.op === 'tableHtml') {
    // A list as the portal sent it (all columns, before the page's DataTables hides any).
    const doc = new W.DOMParser().parseFromString(String(a.payload.html), 'text/html');
    const t = tableOf(doc.querySelector('table'));
    const pages = ([...new W.DOMParser().parseFromString(String(a.payload.pagination ?? ''), 'text/html').querySelectorAll('[data-page]')] as Any[])
      .map((e) => Number(e.getAttribute('data-page'))).filter((n) => n > 0);
    const info = new W.DOMParser().parseFromString(String(a.payload.info ?? ''), 'text/html').body.textContent ?? '';
    return { headers: t.headers, rows: t.rows, pages: pages.length ? Math.max(...pages) : 1, info: String(info).replace(/\s+/g, ' ').trim() };
  }

  if (a.op === 'suggest') {
    const all = controls();
    const el = all.find((x) => keyOf(x, all) === a.payload.key);
    if (!el) return { ok: false, widget: false };
    el.focus();
    el.value = a.payload.term;
    for (const t of ['keydown', 'keyup', 'input']) el.dispatchEvent(new W.Event(t, { bubbles: true }));
    const $ = W.jQuery;
    const widget = !!($ && $(el).data?.('ui-autocomplete'));
    if (widget) $(el).autocomplete('search', a.payload.term);
    return { ok: true, widget };
  }

  if (a.op === 'menu') {
    return ([...D.querySelectorAll('ul.ui-autocomplete')] as Any[]).filter(shown)
      .flatMap((u) => ([...u.querySelectorAll('li')] as Any[]).map(txt)).filter(Boolean);
  }

  if (a.op === 'fill') {
    // The act box's own select handler (litigant.js actautofetch): name, national code, act code.
    for (const [id, v] of Object.entries(a.payload as Record<string, string>)) {
      const el = byId(id);
      if (el) { el.value = v; el.dispatchEvent(new W.Event('change', { bubbles: true })); }
    }
    return { ok: true };
  }

  if (a.op === 'value') return String(byId(a.payload.id)?.value ?? '');

  if (a.op === 'inject') {
    // The way the portal's own callbacks show a list: its HTML into the container.
    let el = byId(a.payload.container);
    if (!el) {
      el = D.createElement('div');
      el.id = a.payload.container;
      el.style.display = 'none';
      D.body.appendChild(el);
    }
    el.innerHTML = a.payload.html;
    return true;
  }

  if (a.op === 'popup') {
    const box = ([...D.querySelectorAll('#db_case_body, #vw_application, .modal.show .modal-body, .modal.in .modal-body')] as Any[]).find((e) => shown(e) && txt(e));
    if (!box) return { text: '', html: [] };
    const tables = ([...box.querySelectorAll('table')] as Any[]).filter((t) => !t.parentElement?.closest('table'));
    const k = box.cloneNode(true);
    for (const t of [...k.querySelectorAll('table')]) t.remove();
    return { text: txt(k).slice(0, 2000), html: tables.map((t) => String(t.outerHTML)) };
  }
  return null;
};

// ---- talking to the page ---------------------------------------------------------

const dom = <T>(page: Page, op: string, tab: CaseFilingTabKey, payload: unknown = null): Promise<T> =>
  page.evaluate(DOM, { defs: CLIENT_TABS.some((d) => d.key === tab) ? CLIENT_TABS : TABS, lists: PARTY_LISTS, op, tab, payload }) as Promise<T>;

interface Reply { route: string; json: Record<string, unknown> | null }

/**
 * The portal's requests while one step runs. Its ajaxCall starts each request
 * from a setTimeout and redraws dropdowns 300 ms after the answer, so a step
 * is done when nothing has been asked for a little while.
 */
function watchPortal(page: Page) {
  const replies: Reply[] = [];
  const reads: Array<Promise<void>> = [];
  let pending = 0;
  let last = Date.now();
  const isPortal = (u: string) => u.includes('?p=');
  const routeOf = (u: string) => (new URL(u).searchParams.get('p') ?? '').replace(/\/+$/, '');
  const onReq = (r: { url: () => string }) => { if (isPortal(r.url())) { pending += 1; last = Date.now(); } };
  const onDone = (r: { url: () => string }) => { if (isPortal(r.url())) { pending = Math.max(0, pending - 1); last = Date.now(); } };
  const onRes = (res: { url: () => string; json: () => Promise<unknown> }) => {
    if (!isPortal(res.url())) return;
    const route = routeOf(res.url());
    reads.push(res.json().then((j) => { replies.push({ route, json: j && typeof j === 'object' ? (j as Record<string, unknown>) : null }); }, () => { replies.push({ route, json: null }); }));
  };
  page.on('request', onReq);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  page.on('response', onRes);
  const quiet = async (idle = 700, timeout = 30_000) => {
    const until = Date.now() + timeout;
    await page.waitForTimeout(150);
    while (Date.now() < until && (pending > 0 || Date.now() - last < idle)) await page.waitForTimeout(100);
    await Promise.all(reads);
  };
  return {
    replies,
    quiet,
    /** After setting one field: wait only if the page asked the portal for something. */
    async settle() {
      const t = Date.now();
      await page.waitForTimeout(140);
      if (pending > 0 || last > t) await quiet();
    },
    reply(name: string): Reply | undefined {
      return [...replies].reverse().find((r) => r.route === name || r.route.endsWith(`/${name}`));
    },
    stop() {
      page.off('request', onReq);
      page.off('requestfinished', onDone);
      page.off('requestfailed', onDone);
      page.off('response', onRes);
    },
  };
}

type Watch = ReturnType<typeof watchPortal>;

/** What the portal tells the advocate: its alert boxes, dialogs and replies' messages. */
async function listen(page: Page, acceptConfirm: boolean): Promise<(w: Watch) => Promise<string[]>> {
  const dialogs: string[] = [];
  const onDialog = (d: { message: () => string; type: () => string; accept: () => Promise<void>; dismiss: () => Promise<void> }) => {
    dialogs.push(d.message());
    void (d.type() === 'confirm' && !acceptConfirm ? d.dismiss() : d.accept()).catch(() => {});
  };
  page.on('dialog', onDialog);
  await page.evaluate(() => {
    const w = globalThis as Any;
    w.__difaiMsgs = [];
    for (const fn of ['errorAlert', 'successAlert']) {
      const orig = w[fn];
      if (typeof orig === 'function' && !orig.__difai) {
        const wrapped = function (this: unknown, msg: unknown) {
          w.__difaiMsgs.push(String(msg ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
          return orig.apply(this, arguments as Any);
        };
        (wrapped as Any).__difai = true;
        w[fn] = wrapped;
      }
    }
  }).catch(() => {});
  return async (w) => {
    page.off('dialog', onDialog);
    const fromPage = (await page.evaluate(() => (globalThis as Any).__difaiMsgs ?? []).catch(() => [])) as string[];
    const fromReplies = w.replies.flatMap((r) => ['errormsg', 'msg'].map((k) => r.json?.[k]).filter((m): m is string => typeof m === 'string' && m.trim() !== ''))
      .map((m) => m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    return [...new Set([...fromPage, ...dialogs, ...fromReplies].filter(Boolean))];
  };
}

/** One step on the portal: listen, act, wait for its requests to finish. */
async function step(page: Page, acceptConfirm: boolean, act: (w: Watch) => Promise<void>): Promise<{ w: Watch; portal: string[] }> {
  const w = watchPortal(page);
  const done = await listen(page, acceptConfirm);
  try {
    await act(w);
    await w.quiet();
  } finally {
    w.stop();
  }
  return { w, portal: await done(w) };
}

const sessionEnded = () => new EcourtsHttpError(410, 'The eFiling portal has signed this session out (the same account was probably opened in another browser). Log in again.');

const screenOf = (key: ScreenKey | undefined): Screen => SCREENS[key ?? 'new_case'];

/** Is the session on this screen's page now? */
async function onScreen(page: Page, screen: Screen): Promise<boolean> {
  const clientsUrl = /favourite_client/i.test(page.url());
  if (screen.key === 'clients') return clientsUrl || Boolean(await page.$('#dvClientList, #edit_client_tab, #frmOrg'));
  return !clientsUrl && Boolean(await page.$('#frmInitialInput1, #frmInitialInput2'));
}

/** Be on the screen's page, opened from the portal's own Case Filing menu. */
async function ensureScreen(page: Page, screen: Screen, fresh = false): Promise<void> {
  if (!fresh && await onScreen(page, screen)) return;
  await closePortalPopups(page);
  if (!(await openPortalMenu(page, screen.menu))) {
    if (await onLoginForm(page)) throw sessionEnded();
    throw new EcourtsHttpError(502, `Couldn't open Case Filing > ${screen.label} on your portal account.`);
  }
  if (await onLoginForm(page)) throw sessionEnded();
  if (!(await onScreen(page, screen))) {
    throw new EcourtsHttpError(502, `The ${screen.label} screen on the portal is not what DifAi expects - nothing was changed.`);
  }
}

const PDE_NO = /^[A-Za-z0-9]{4,40}$/;

/** Open a draft the way its Edit button does: the page's fetchPDECaseData(pde_no). */
async function openDraftOnPage(page: Page, pdeNo: string): Promise<string[]> {
  if (!PDE_NO.test(pdeNo)) throw new EcourtsHttpError(400, 'That is not a portal e-filing number.');
  const { w, portal } = await step(page, false, async () => {
    const r = await dom<{ ok: boolean }>(page, 'call', 'initial', { fn: 'fetchPDECaseData', args: [pdeNo] });
    if (!r.ok) throw new EcourtsHttpError(502, 'The New Case Filing screen on the portal cannot open drafts (fetchPDECaseData is missing).');
  });
  const reply = w.reply('fetchPDECaseData');
  if (!reply) throw new EcourtsHttpError(502, `The portal did not open draft ${pdeNo}. Try again.`);
  if (typeof reply.json?.['errormsg'] === 'string' && reply.json['errormsg']) throw new EcourtsHttpError(409, String(reply.json['errormsg']));
  return portal;
}

interface WizardRef { screen?: ScreenKey; pdeNo?: string | null; tab?: CaseFilingTabKey }

async function ensureWizard(page: Page, o: WizardRef & { fresh?: boolean }): Promise<string[]> {
  const screen = screenOf(o.screen);
  await ensureScreen(page, screen, o.fresh);
  if (screen.key !== 'new_case' || !o.pdeNo) return [];
  const current = await dom<string>(page, 'value', 'initial', { id: 'adv_pde_no' }).catch(() => '');
  return current.trim() === o.pdeNo ? [] : openDraftOnPage(page, o.pdeNo);
}

/**
 * The screen with one tab's detail: `tab`, or - after a save, which moves the
 * portal on by itself - the tab the portal is showing now (else `fallback`).
 */
async function readWizard(page: Page, screenKey: ScreenKey, tab?: CaseFilingTabKey, fallback?: CaseFilingTabKey): Promise<CaseFilingWizard> {
  const screen = screenOf(screenKey);
  const first = screen.defs[0]!.key;
  let want = tab;
  if (!want) {
    const tabs = await dom<Array<{ key: CaseFilingTabKey; active: boolean; present: boolean; shown: boolean; enabled: boolean }>>(page, 'tabs', first);
    want = tabs.find((t) => t.active && t.present && t.shown && t.enabled && t.key !== 'initial')?.key ?? fallback ?? first;
  }
  const raw = await dom<Any>(page, 'read', want);
  const sections: CaseFilingSection[] = [];
  for (const f of raw.fields as Array<CaseFilingField & { section: string }>) {
    const { section, ...field } = f;
    if (!field.error) delete field.error;
    const last = sections[sections.length - 1];
    if (last && last.title === section) last.fields.push(field);
    else sections.push({ title: section, fields: [field] });
  }
  const summary = await Promise.all((raw.summary as Array<{ title: string; html: string[]; text: string }>).map(async (s) => ({
    title: s.title, tables: (await Promise.all(s.html.map((h) => htmlTable(page, h)))).filter((t) => t.rows.length), text: s.text,
  })));
  const tabs: CaseFilingTab[] = (raw.tabs as CaseFilingTab[]).map((t) => (t.key === want
    ? { ...t, sections, buttons: raw.buttons, lists: raw.lists, ...(t.key === 'efile' ? { summary } : {}) }
    : t));
  return {
    screen: screen.key, pdeNo: raw.pdeNo, caseTitle: raw.caseTitle, petLabel: raw.petLabel, resLabel: raw.resLabel, notice: raw.notice,
    mode: raw.mode, efileAllowed: raw.efileAllowed, tab: want, tabs,
  };
}

async function applyValues(page: Page, w: Watch, tab: CaseFilingTabKey, values: Array<{ key: string; value: string | boolean }>): Promise<Array<{ key: string; reason: string }>> {
  const missed: Array<{ key: string; reason: string }> = [];
  for (const v of values) {
    const r = await dom<{ ok: boolean; reason?: string }>(page, 'set', tab, v);
    if (!r.ok) missed.push({ key: v.key, reason: r.reason ?? 'not set' });
    await w.settle();
  }
  return missed;
}

const tabDef = (key: CaseFilingTabKey, screen?: ScreenKey): TabDef => {
  const d = screenOf(screen).defs.find((t) => t.key === key);
  if (!d) throw new EcourtsHttpError(400, `That tab is not on ${screenOf(screen).label}.`);
  return d;
};

// ---- New Case Filing / Manage Favourite Clients: public steps ----------------------

/**
 * The screen as the portal shows it now (New Case Filing, or Manage
 * Favourite Clients' forms). `fresh` opens the menu item again (a new, empty
 * case); `pdeNo` opens that draft (its Edit).
 */
export async function openCaseFilingWizard(sessionId: string, userId: string, o: WizardRef & { fresh?: boolean }): Promise<CaseFilingStepResult> {
  const screen = screenOf(o.screen).key;
  if (o.tab) tabDef(o.tab, screen);
  return withPortalPage(sessionId, userId, async (page) => {
    const portal = await ensureWizard(page, o);
    if (o.tab) await dom(page, 'show', o.tab).catch(() => null);
    return { ok: true, portal, wizard: await readWizard(page, screen, o.tab) };
  });
}

/** Click one of the screen's tabs. The portal keeps a tab switched off until earlier tabs are saved. */
export async function showCaseFilingTab(sessionId: string, userId: string, o: WizardRef & { tab: CaseFilingTabKey }): Promise<CaseFilingStepResult> {
  const screen = screenOf(o.screen).key;
  const def = tabDef(o.tab, screen);
  return withPortalPage(sessionId, userId, async (page) => {
    const before = await ensureWizard(page, o);
    let shownOk = false;
    let reason = '';
    const { portal } = await step(page, false, async () => {
      const r = await dom<{ ok: boolean; reason?: string }>(page, 'show', o.tab);
      shownOk = r.ok;
      reason = r.reason ?? '';
    });
    const wizard = await readWizard(page, screen, o.tab);
    const label = wizard.tabs.find((t) => t.key === o.tab)?.label ?? def.label;
    const note = shownOk ? [] : [reason === 'disabled' ? `The portal opens "${label}" after the earlier tabs are saved.` : `The portal does not show "${label}" for this case.`];
    return { ok: shownOk, portal: [...before, ...portal, ...note], wizard };
  });
}

/**
 * Set fields as the advocate would. Fields the page reacts to (dropdowns that
 * fill the next one, radios that switch sections) are set one by one, each
 * cascade finishing on the portal before the next value goes in.
 */
export async function setCaseFilingFields(sessionId: string, userId: string, o: WizardRef & { tab: CaseFilingTabKey; values: Array<{ key: string; value: string | boolean }> }): Promise<CaseFilingStepResult> {
  const screen = screenOf(o.screen).key;
  tabDef(o.tab, screen);
  return withPortalPage(sessionId, userId, async (page) => {
    const before = await ensureWizard(page, o);
    let notApplied: Array<{ key: string; reason: string }> = [];
    const { portal } = await step(page, false, async (w) => { notApplied = await applyValues(page, w, o.tab, o.values); });
    return { ok: notApplied.length === 0, portal: [...before, ...portal], notApplied, wizard: await readWizard(page, screen, o.tab) };
  });
}

/**
 * Press a tab's Save on the portal (insertNewPDE / insertPartyInformationTab /
 * insertFactTab / insertCaseInfo / insertMVC / the MACT tabs' / a favourite
 * client's ...). A confirm() the page asks on the way (e.g. "update client
 * info in favourite list?") is answered No, and reported.
 */
export async function saveCaseFilingTab(sessionId: string, userId: string, o: WizardRef & { tab: CaseFilingTabKey; values: Array<{ key: string; value: string | boolean }> }): Promise<CaseFilingStepResult> {
  const screen = screenOf(o.screen).key;
  const def = tabDef(o.tab, screen);
  if (!def.save.length) throw new EcourtsHttpError(400, o.tab === 'efile' ? 'This tab has nothing to save - use "eFile Case".' : 'This tab has no Save on the portal.');
  return withPortalPage(sessionId, userId, async (page) => {
    const before = await ensureWizard(page, o);
    let notApplied: Array<{ key: string; reason: string }> = [];
    const { w, portal } = await step(page, false, async (w) => {
      notApplied = await applyValues(page, w, o.tab, o.values);
      // The tab's own Save button when it has one, else the function it calls.
      const read = await dom<Any>(page, 'read', o.tab);
      const btn = (read.buttons as CaseFilingButton[]).find((b) => b.kind === 'save' && !b.disabled);
      const pressed = btn ? await dom<{ ok: boolean }>(page, 'press', o.tab, { key: btn.key, text: btn.text }) : { ok: false };
      const r = pressed.ok ? await dom<{ ok: boolean }>(page, 'click', o.tab) : await dom<{ ok: boolean }>(page, 'call', o.tab, { fn: def.save[0]!.fn });
      if (!r.ok) throw new EcourtsHttpError(502, 'The Save for this tab is not on the portal page.');
    });
    const reply = def.save.map((x) => w.reply(x.route)).find(Boolean);
    const wizard = await readWizard(page, screen, undefined, o.tab);
    const json = reply?.json ?? null;
    let ok = Boolean(json) && !json?.['errormsg'] && String(json?.['errorstatus'] ?? '') !== '1';
    if (o.tab === 'initial') ok = ok && Boolean(json?.['pde_no'] || wizard.pdeNo);
    // Nothing went to the portal: its form checks stopped it (messages under the fields).
    const note = reply ? [] : ['The portal did not save - see the marked fields.'];
    return { ok, portal: [...before, ...portal, ...note], notApplied, wizard };
  });
}

/**
 * Any other button the portal has on the tab (Add More Fact, More Acts...,
 * Prayer, Search, Add New Party, Next ...). Deleting / removing needs
 * `confirmed`; "eFile Case" goes through efileCase.
 */
export async function pressCaseFilingButton(sessionId: string, userId: string, o: WizardRef & {
  tab: CaseFilingTabKey; key: string; text?: string; values?: Array<{ key: string; value: string | boolean }>; confirmed?: boolean;
}): Promise<CaseFilingStepResult> {
  const screen = screenOf(o.screen).key;
  tabDef(o.tab, screen);
  return withPortalPage(sessionId, userId, async (page) => {
    const before = await ensureWizard(page, o);
    const found = await dom<{ ok: boolean; reason?: string; kind?: string; text?: string }>(page, 'press', o.tab, { key: o.key, text: o.text });
    if (!found.ok) throw new EcourtsHttpError(409, `That button is ${found.reason ?? 'not on the portal page now'}.`);
    if (found.kind === 'efile') throw new EcourtsHttpError(400, 'Use "eFile Case" - it needs your confirmation.');
    if (found.kind === 'delete' && !o.confirmed) throw new EcourtsHttpError(400, `Confirm "${found.text}" first - it removes it on the portal.`);
    let notApplied: Array<{ key: string; reason: string }> = [];
    const { portal } = await step(page, found.kind === 'delete', async (w) => {
      if (o.values?.length) notApplied = await applyValues(page, w, o.tab, o.values);
      const again = await dom<{ ok: boolean }>(page, 'press', o.tab, { key: o.key, text: o.text });
      if (!again.ok || !(await dom<{ ok: boolean }>(page, 'click', o.tab)).ok) throw new EcourtsHttpError(409, 'That button is not on the portal page now.');
    });
    return { ok: true, portal: [...before, ...portal], notApplied, wizard: await readWizard(page, screen, undefined, o.tab) };
  });
}

const PARTY_LIST_TAB: Record<PartyListKey, CaseFilingTabKey> = { parties: 'litigant', prev_parties: 'litigant', lh_parties: 'legal_heir' };

/** A row's Edit / Delete in the Litigant tab's party list (or the legal heirs list). Delete needs `confirmed`. */
export async function caseFilingPartyAction(sessionId: string, userId: string, o: Omit<WizardRef, 'screen'> & {
  list: PartyListKey; match: string[]; action: string; confirmed?: boolean;
}): Promise<CaseFilingStepResult> {
  const tab = PARTY_LIST_TAB[o.list];
  return withPortalPage(sessionId, userId, async (page) => {
    const before = await ensureWizard(page, o);
    const found = await dom<{ ok: boolean; reason?: string; kind?: string }>(page, 'row', tab, { container: PARTY_LISTS[o.list].id, match: o.match, label: o.action });
    if (!found.ok) {
      throw new EcourtsHttpError(409, found.reason === 'action' ? `The portal has no "${o.action}" in that row now.` : 'That party is no longer in the list on the portal - it was refreshed.');
    }
    if (found.kind === 'delete' && !o.confirmed) throw new EcourtsHttpError(400, `Confirm "${o.action}" first - it deletes the party on the portal.`);
    const { portal } = await step(page, found.kind === 'delete', async () => { await dom(page, 'click', tab); });
    return { ok: true, portal: [...before, ...portal], wizard: await readWizard(page, 'new_case', undefined, tab) };
  });
}

async function actSuggestions(page: Page, tab: CaseFilingTabKey, key: string, term: string): Promise<{ widget: boolean; items: string[]; raw: Array<Record<string, unknown>> }> {
  const w = watchPortal(page);
  try {
    const r = await dom<{ ok: boolean; widget: boolean }>(page, 'suggest', tab, { key, term });
    if (!r.ok) throw new EcourtsHttpError(409, 'That box is not on the portal form now.');
    await w.quiet(500, 15_000);
    if (r.widget) {
      await page.waitForSelector('ul.ui-autocomplete li', { state: 'visible', timeout: 4000 }).catch(() => null);
      return { widget: true, items: await dom<string[]>(page, 'menu', tab), raw: [] };
    }
  } finally {
    w.stop();
  }
  // No autocomplete on the box: the request its autocomplete makes (actautofetch /
  // autocomplete_section, sent the way ajaxCallAct sends them).
  const id = key.replace(/^#/, '');
  const est = (await dom<string>(page, 'value', tab, { id: 'selEstablishment' }).catch(() => '')).split('~');
  const place = est.length === 3 ? `&stateCode=${encodeURIComponent(est[0]!)}&distCode=${encodeURIComponent(est[1]!)}&estCode=${encodeURIComponent(est[2]!)}` : '';
  if (/^fdispactcodes/.test(id)) {
    const res = await portalPost(page, 'advocate_case_registration/getActs', `term=${encodeURIComponent(term)}${place}`);
    const list = Array.isArray(res.json?.['act']) ? (res.json!['act'] as Array<Record<string, unknown>>) : [];
    return { widget: false, items: list.map((x) => String(x['label'] ?? x['value'] ?? '')), raw: list };
  }
  if (/^factsection_code/.test(id)) {
    const national = await dom<string>(page, 'value', tab, { id: id.replace('factsection_code', 'fhiddactcodes') });
    const res = await portalPost(page, 'advocate_case_registration/autocomplete_section', `term=${encodeURIComponent(term)}&national_code=${encodeURIComponent(national)}${place}`);
    const list = Array.isArray(res.json) ? (res.json as unknown as Array<Record<string, unknown>>) : [];
    return { widget: false, items: list.map((x) => String(x['label'] ?? x['value'] ?? '')), raw: list };
  }
  return { widget: false, items: [], raw: [] };
}

/** What the portal suggests for an act / section box as the advocate types (3+ letters, as on the portal). */
export async function suggestCaseFiling(sessionId: string, userId: string, o: Omit<WizardRef, 'screen'> & { tab: CaseFilingTabKey; key: string; term: string }): Promise<{ items: string[] }> {
  if (o.term.trim().length < 3) return { items: [] };
  return withPortalPage(sessionId, userId, async (page) => {
    await ensureWizard(page, o);
    const { items } = await actSuggestions(page, o.tab, o.key, o.term);
    return { items: items.slice(0, 50) };
  });
}

/** Take the portal's suggestion, as clicking it there does (it records the act's codes / the section). */
export async function pickCaseFilingSuggestion(sessionId: string, userId: string, o: Omit<WizardRef, 'screen'> & { tab: CaseFilingTabKey; key: string; term: string; index: number }): Promise<CaseFilingStepResult> {
  return withPortalPage(sessionId, userId, async (page) => {
    const before = await ensureWizard(page, o);
    const s = await actSuggestions(page, o.tab, o.key, o.term);
    if (!s.items[o.index]) throw new EcourtsHttpError(409, 'The portal no longer suggests that - type again.');
    const id = o.key.replace(/^#/, '');
    const { portal } = await step(page, false, async () => {
      if (s.widget) {
        await page.locator('ul.ui-autocomplete li:visible').nth(o.index).click();
        // fetch_sectioncode writes the section 500 ms after its answer.
        await page.waitForTimeout(700);
        return;
      }
      const item = s.raw[o.index]!;
      if (/^fdispactcodes/.test(id)) {
        const n = id.replace('fdispactcodes', '');
        await dom(page, 'fill', o.tab, { [id]: String(item['label'] ?? ''), [`fhiddactcodes${n}`]: String(item['national_code'] ?? ''), [`factcodes${n}`]: String(item['actvalue'] ?? '') });
      } else {
        const prev = await dom<string>(page, 'value', o.tab, { id });
        const res = await portalPost(page, 'advocate_case_registration/fetch_sectioncode', `label=${encodeURIComponent(String(item['secvalue'] ?? item['label'] ?? ''))}&prevval=${encodeURIComponent(prev)}`);
        const val = typeof (res.json as unknown) === 'string' ? (res.json as unknown as string) : res.text;
        await dom(page, 'fill', o.tab, { [id]: String(val ?? '').trim() });
      }
    });
    return { ok: true, portal: [...before, ...portal], wizard: await readWizard(page, 'new_case', o.tab) };
  });
}

export interface EfileResult { ok: boolean; pdeNo: string; portal: string[]; errorTabs: CaseFilingTabKey[]; wizard: CaseFilingWizard | null }

/**
 * "eFile Case" (submitEfileData) - irreversible: only with the advocate's
 * confirmation, then the portal's own "Do you want to submit the case? Once
 * submitted, case details can not be modfied." is accepted.
 */
export async function efileCase(sessionId: string, userId: string, o: { pdeNo: string; confirmed: boolean }): Promise<EfileResult> {
  if (!o.confirmed) throw new EcourtsHttpError(400, 'Confirm "eFile Case" first - it cannot be undone.');
  if (!PDE_NO.test(o.pdeNo)) throw new EcourtsHttpError(400, 'That is not a portal e-filing number.');
  return withPortalPage(sessionId, userId, async (page) => {
    const before = await ensureWizard(page, { pdeNo: o.pdeNo });
    const now = await readWizard(page, 'new_case', 'efile');
    const tab = now.tabs.find((t) => t.key === 'efile');
    if (!now.efileAllowed) throw new EcourtsHttpError(409, 'The portal does not let you eFile this case here (it was filed by another advocate).');
    if (!tab?.present || !tab.enabled) throw new EcourtsHttpError(409, 'The portal has not opened e-File for this case yet - save Case Details (and the MACT tabs, when shown) first.');
    const { w, portal } = await step(page, true, async () => {
      await dom(page, 'show', 'efile');
      await page.waitForTimeout(300);
      const btn = (await readWizard(page, 'new_case', 'efile')).tabs.find((t) => t.key === 'efile')?.buttons?.find((b) => b.kind === 'efile');
      const pressed = btn ? (await dom<{ ok: boolean }>(page, 'press', 'efile', { key: btn.key, text: btn.text })).ok : false;
      const r = pressed ? await dom<{ ok: boolean }>(page, 'click', 'efile') : await dom<{ ok: boolean }>(page, 'call', 'efile', { fn: 'submitEfileData' });
      if (!r.ok) throw new EcourtsHttpError(502, '"eFile Case" is not on the portal page.');
    });
    const json = w.reply('submitEfileData')?.json ?? null;
    const paneToTab = new Map(now.tabs.map((t) => [t.paneId, t.key]));
    const errorTabs = json && Number(json['errorcode']) === 2 && json['error_tab'] && typeof json['error_tab'] === 'object'
      ? Object.keys(json['error_tab'] as object).map((k) => paneToTab.get(k)).filter((k): k is CaseFilingTabKey => Boolean(k))
      : [];
    const ok = Boolean(json) && !json?.['errormsg'] && Number(json?.['errorcode'] ?? 0) !== 1 && Number(json?.['errorcode'] ?? 0) !== 2;
    const wizard = ok ? null : await readWizard(page, 'new_case', errorTabs[0] ?? 'efile').catch(() => null);
    const note = json ? [] : ['The portal did not answer "eFile Case" - check eFiled Cases before trying again.'];
    return { ok, pdeNo: o.pdeNo, portal: [...before, ...portal, ...note], errorTabs, wizard };
  });
}

// ---- Draft Cases / eFiled Cases / favourite clients --------------------------------

interface ListDef {
  screen: ScreenKey;
  label: string;
  container: string;
  route: string;
  field: string;
  /** The page's own list function, called (page, 10) - registration.js. */
  fn: string | null;
  /** Its search box (sent as txtAppSearch). */
  search: string | null;
  /** What shows the list when there is no function to call. */
  open: string;
  /** A tab to show first. */
  outer?: string;
  /** Columns the page's DataTables groups rows by (and hides). */
  group: number[];
}

const CASE_LISTS: Record<CaseListKey, ListDef> = {
  // #edit_case_tab -> getUnRegisteredPDE(page, 10): rowGroup dataSrc [7, 1].
  draft: { screen: 'new_case', label: 'Draft Cases', container: 'dvEditCase', route: 'advocate_case_registration/getUnRegisteredPDE', field: 'pde_list', fn: 'getUnRegisteredPDE', search: 'txtEditCaseSearch', open: '#edit_case_tab', group: [7, 1] },
  // #submitted_pde -> getSubmittedNewCases(page, 10): rowGroup dataSrc [1, 3].
  filed: { screen: 'new_case', label: 'eFiled Cases', container: 'dvSubmittedPDE', route: 'advocate_case_registration/getSubmittedPDE', field: 'submitted_pde_list', fn: 'getSubmittedNewCases', search: 'txtAppSearch', open: '#submitted_pde', outer: 'a[href="#old_case"]', group: [1, 3] },
  // #edit_client_tab -> favourite_client_list -> #dvClientList (#tblFavClient).
  clients: { screen: 'clients', label: 'Favourite Clients', container: 'dvClientList', route: 'advocate_case_registration/favourite_client_list', field: 'client_list', fn: null, search: null, open: '#edit_client_tab', group: [] },
};

/** The page's DataTables rowGroup: group headings from those columns, which it then hides. */
function groupRows(t: CaseFilingTable, cols: number[]): CaseFilingTable {
  const width = Math.max(t.headers.length, ...t.rows.map((r) => ('cells' in r ? r.cells.length : 0)));
  if (!cols.length || width <= Math.max(...cols)) return t;
  const keep = <T>(arr: T[]) => arr.filter((_, i) => !cols.includes(i));
  const last: Array<string | null> = cols.map(() => null);
  const rows: CaseFilingRow[] = [];
  for (const r of t.rows) {
    if (!('cells' in r)) { rows.push(r); continue; }
    cols.forEach((c, level) => {
      const v = r.cells[c] ?? '';
      if (v === last[level]) return;
      last[level] = v;
      for (let k = level + 1; k < cols.length; k++) last[k] = null;
      if (v) rows.push({ group: v });
    });
    // Buttons keep their column once the grouped columns are gone.
    const actions = r.actions?.map((x) => ({ ...x, cell: cols.includes(x.cell) ? -1 : x.cell - cols.filter((c) => c < x.cell).length }));
    rows.push({ ...r, cells: keep(r.cells), ...(actions ? { actions } : {}) });
  }
  return { headers: keep(t.headers), rows };
}

async function readListOnPage(page: Page, key: CaseListKey, o: { page?: number; search?: string } = {}): Promise<CaseFilingList> {
  const l = CASE_LISTS[key];
  const pageNo = Math.max(1, o.page ?? 1);
  const search = o.search ?? '';
  await ensureScreen(page, screenOf(l.screen));
  const w = watchPortal(page);
  try {
    await page.evaluate(({ outer, search, id }) => {
      const t = outer ? document.querySelector(outer) : null;
      if (t) t.click();
      const box = id ? document.getElementById(id) : null;
      if (box) box.value = search;
    }, { outer: l.outer ?? '', search, id: l.search ?? '' });
    const called = l.fn ? (await dom<{ ok: boolean }>(page, 'call', 'initial', { fn: l.fn, args: [pageNo, 10] })).ok : false;
    if (!called) await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) el.click(); }, l.open);
    await w.quiet();
  } finally {
    w.stop();
  }
  let json = w.reply(l.route.split('/').pop()!)?.json ?? null;
  if (!json) {
    // The page didn't ask: the same request its list function makes, shown the
    // way its callback shows it.
    const reply = await portalPost(page, l.route, l.fn ? `page=${pageNo}&limit=10&txtAppSearch=${encodeURIComponent(search)}` : '');
    if (!reply.json) {
      return { list: key, label: l.label, total: null, headers: [], rows: [], error: reply.httpStatus === 200 ? 'The portal sent an unexpected answer.' : `The portal answered ${reply.httpStatus}.`, page: pageNo, pages: 1, info: '', search };
    }
    json = reply.json;
    await dom(page, 'inject', 'initial', { container: l.container, html: String(json[l.field] ?? '') });
  }
  const html = typeof json[l.field] === 'string' ? (json[l.field] as string) : '';
  const parsed = await dom<CaseFilingTable & { pages: number; info: string }>(page, 'tableHtml', 'initial', { html, pagination: json['pagination'] ?? '', info: json['records_info'] ?? '' });
  const table = groupRows({ headers: parsed.headers, rows: parsed.rows }, l.group);
  const n = Number(json['total_record'] ?? json['record_count']);
  const error = typeof json['errormsg'] === 'string' && json['errormsg'] ? (json['errormsg'] as string) : null;
  return {
    list: key, label: l.label, total: Number.isFinite(n) ? n : table.rows.filter((r) => 'cells' in r).length, ...table, error,
    page: pageNo, pages: Math.max(pageNo, parsed.pages), info: parsed.info, search: typeof json['search'] === 'string' ? (json['search'] as string) : search,
  };
}

/** Draft Cases / eFiled Cases (New Case Filing) or the favourite clients list, as the page shows them. */
export async function readCaseFilingList(sessionId: string, userId: string, key: CaseListKey, o: { page?: number; search?: string } = {}): Promise<CaseFilingList> {
  return withPortalPage(sessionId, userId, (page) => readListOnPage(page, key, o));
}

export interface CaseListActionResult {
  kind: CaseFilingAction['kind'];
  ok: boolean;
  portal: string[];
  /** 'open' / 'edit': the draft or client, opened in its form. */
  wizard?: CaseFilingWizard;
  /** 'delete': the list as the portal shows it afterwards. */
  list?: CaseFilingList;
  /** 'pdf': fetch it with caseFilingPdf. */
  pdeNo?: string | null;
  /** 'status' / 'other': what the portal showed (text and its tables). */
  text?: string;
  tables?: PortalTableData[];
}

/** A row's button (Edit, Delete, its PDF, status, a client's cases ...). Delete needs `confirmed`. */
export async function caseFilingListAction(sessionId: string, userId: string, o: { list: CaseListKey; match: string[]; action: string; confirmed?: boolean; page?: number; search?: string }): Promise<CaseListActionResult> {
  const l = CASE_LISTS[o.list];
  return withPortalPage(sessionId, userId, async (page) => {
    // Fresh rows to click in, as the advocate sees them.
    await readListOnPage(page, o.list, o);
    const found = await dom<{ ok: boolean; reason?: string; kind?: CaseFilingAction['kind']; arg?: string | null }>(page, 'row', 'initial', { container: l.container, match: o.match, label: o.action });
    if (!found.ok) {
      throw new EcourtsHttpError(409, found.reason === 'action' ? `The portal has no "${o.action}" in that row now.` : 'That entry is no longer in this list on the portal - Refresh and try again.');
    }
    const kind = found.kind ?? 'other';
    if (kind === 'pdf') return { kind, ok: true, portal: [], pdeNo: found.arg ?? null };
    if (kind === 'delete' && !o.confirmed) throw new EcourtsHttpError(400, `Confirm "${o.action}" first - the portal deletes it.`);
    const { w, portal } = await step(page, kind === 'delete', async () => { await dom(page, 'click', 'initial'); });
    if (kind === 'open') {
      const reply = w.reply('fetchPDECaseData');
      return { kind, ok: Boolean(reply?.json) && !reply?.json?.['errormsg'], portal, wizard: await readWizard(page, 'new_case') };
    }
    if (kind === 'edit') {
      // fetchFavClient fills the Client or the Organization form (its reply's
      // client_type) but only re-opens the outer tab: show that form.
      const type = w.reply('fetchFavClient')?.json?.['client_type'];
      const formTab: CaseFilingTabKey | undefined = type === 'client' ? 'client' : type === 'org' ? 'organisation' : undefined;
      if (formTab) await dom(page, 'show', formTab).catch(() => null);
      return { kind, ok: true, portal, wizard: await readWizard(page, l.screen, formTab) };
    }
    if (kind === 'delete') {
      const del = w.replies.find((r) => /del/i.test(r.route));
      return { kind, ok: Boolean(del?.json) && !del?.json?.['errormsg'], portal, list: await readListOnPage(page, o.list, o) };
    }
    const shown = await dom<{ text: string; html: string[] }>(page, 'popup', 'initial');
    const tables = (await Promise.all(shown.html.map((h) => htmlTable(page, h)))).filter((t) => t.headers.length || t.rows.length);
    await closePortalPopups(page);
    return { kind, ok: true, portal, text: shown.text, tables };
  });
}

export interface CaseFilingFile { name: string; contentType: string; body: Buffer }

/** The case's PDF as the portal makes it (generateCasePDF, sel_pde). */
export async function caseFilingPdf(sessionId: string, userId: string, pdeNo: string): Promise<CaseFilingFile> {
  if (!PDE_NO.test(pdeNo)) throw new EcourtsHttpError(400, 'That is not a portal e-filing number.');
  return withPortalPage(sessionId, userId, async (page) => {
    if (!(await page.$('#__csrf_magic'))) await ensureScreen(page, SCREENS.new_case);
    const reply = await portalPost(page, 'advocate_case_registration/generateCasePDF', `sel_pde=${encodeURIComponent(pdeNo)}`);
    const url = typeof reply.json?.['viewPDF'] === 'string' ? (reply.json['viewPDF'] as string) : '';
    if (!url) {
      const msg = typeof reply.json?.['errormsg'] === 'string' ? (reply.json['errormsg'] as string) : '';
      throw new EcourtsHttpError(502, msg || 'The portal did not make the case PDF. Try again.');
    }
    const name = `${pdeNo}.pdf`;
    if (url.startsWith('data:')) {
      const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
      if (!m) throw new EcourtsHttpError(502, 'The portal sent a document DifAi could not read.');
      return { name, contentType: m[1] || 'application/pdf', body: m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!)) };
    }
    const abs = new URL(url, page.url()).toString();
    if (new URL(abs).hostname !== new URL(page.url()).hostname) {
      throw new EcourtsHttpError(502, 'The portal pointed the document somewhere else; DifAi did not follow it.');
    }
    const got = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { status: r.status, type: r.headers.get('content-type') ?? '', b64: btoa(s) };
    }, abs);
    if (got.status >= 400) throw new EcourtsHttpError(502, `The portal answered ${got.status} for this document.`);
    return { name, contentType: got.type.split(';')[0] || 'application/pdf', body: Buffer.from(got.b64, 'base64') };
  });
}

export const __testing = { TABS, CLIENT_TABS, PARTY_LISTS, groupRows };
