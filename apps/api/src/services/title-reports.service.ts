/**
 * Title Reports service — Title Investigation Report (TIR) authoring.
 *
 * Responsibilities (in roughly the order they fire in a real session):
 *   1. CRUD for the 11 tenant-scoped tables in migration 0050.
 *   2. Atomic firm-year `report_number` allocation via title_report_counters.
 *   3. State machine: draft → in_review → finalised → issued → withdrawn,
 *      with completeness gates enforced in the service (not the route).
 *   4. Per-action role gating: paralegals can draft but not finalise; senior
 *      associates can finalise but not issue; legal-secretaries/interns
 *      cannot see the feature. The feature-key gate (`title_report.use`) is
 *      coarser than this matrix, so per-action decisions live here.
 *   5. Solo monthly quota (plan_title_report_caps): mirrors ai-quota.service
 *      shape but counts rows in title_reports created within the firm's
 *      billing cycle, not AI calls.
 *   6. Hydrated-tree read used by the wizard and the PDF builder.
 *   7. Audit log writes on every state transition and export.
 *
 * All queries are firm-scoped; passing `firmId` from the route layer is
 * non-optional. The service trusts that the caller has already resolved the
 * firm via `firmIdForUser(req.user.id)`.
 */

import type {
  CreateTitleReportDto,
  ChainLinkDto,
  DefectAckDto,
  EncumbranceDto,
  HeirDto,
  LitigationEntryDto,
  ManualDefectDto,
  SearchEntryDto,
  StatutoryApprovalDto,
  TitleReport,
  TitleReportChainLink,
  TitleReportDefect,
  TitleReportDocument,
  TitleReportEncumbrance,
  TitleReportExport,
  TitleReportExportFormat,
  TitleReportFull,
  TitleReportHeir,
  TitleReportLitigation,
  TitleReportListQuery,
  TitleReportListResponse,
  TitleReportProperty,
  TitleReportQuotaStatus,
  TitleReportSearch,
  TitleReportStatutoryApproval,
  TitleReportStatus,
  TitleReportAiRun,
  UpdateTitleReportDto,
  UpsertTitleReportPropertyDto,
} from '@lexdraft/types';
import { db } from '../db/client';
import { auditService } from './audit.service';
import { aiQuotaService } from './ai-quota.service';
import { logger } from '../logger';

// ---- Errors ---------------------------------------------------------------

export class TitleReportError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'TitleReportError';
    this.status = status;
    this.code = code;
  }
}

export class TitleReportNotFound extends TitleReportError {
  constructor(id: string) {
    super(404, 'title_report_not_found', `Title report ${id} not found`);
  }
}

export class TitleReportForbidden extends TitleReportError {
  constructor(action: string) {
    super(403, 'title_report_forbidden', `Not permitted: ${action}`);
  }
}

export class TitleReportTransitionError extends TitleReportError {
  details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(409, 'title_report_transition_invalid', message);
    this.details = details;
  }
}

export class TitleReportQuotaExceeded extends TitleReportError {
  status_: TitleReportQuotaStatus;
  constructor(status: TitleReportQuotaStatus) {
    super(429, 'title_report_quota_exceeded', 'Title report quota exceeded');
    this.status_ = status;
  }
}

// ---- Role gating ----------------------------------------------------------
//
// The feature key `title_report.use` is granted broadly (every role with
// drafting.basic). Per-action gating lives here because Postgres roles +
// feature keys aren't expressive enough to model "paralegal can draft but
// not finalise" without inventing N keys. The mapping below is intentionally
// duplicated against the spec's permissions matrix so reviewers can scan it.

export type TitleReportAction =
  | 'view' | 'create' | 'edit' | 'transition.in_review'
  | 'transition.finalised' | 'transition.issued' | 'transition.withdrawn'
  | 'ai.run' | 'export';

const ROLE_DENY: Record<string, Set<TitleReportAction>> = {
  Paralegal: new Set<TitleReportAction>([
    'transition.finalised', 'transition.issued',
  ]),
  Associate: new Set<TitleReportAction>([
    'transition.issued',
  ]),
  'Legal Secretary': new Set<TitleReportAction>([
    'view', 'create', 'edit',
    'transition.in_review', 'transition.finalised', 'transition.issued',
    'transition.withdrawn', 'ai.run', 'export',
  ]),
  Intern: new Set<TitleReportAction>([
    'view', 'create', 'edit',
    'transition.in_review', 'transition.finalised', 'transition.issued',
    'transition.withdrawn', 'ai.run', 'export',
  ]),
};

export function isActionAllowedForRole(roleName: string | null | undefined, action: TitleReportAction): boolean {
  if (!roleName) return true; // Demo / no-role mode — let the feature key be the only gate.
  const deny = ROLE_DENY[roleName];
  if (!deny) return true;
  return !deny.has(action);
}

function assertRoleCan(roleName: string | null | undefined, action: TitleReportAction): void {
  if (!isActionAllowedForRole(roleName, action)) {
    throw new TitleReportForbidden(action);
  }
}

// ---- Plan caps ------------------------------------------------------------

const DEMO_QUOTA_CAP: Record<'Solo' | 'Practice' | 'Firm', number> = {
  Solo: 2,
  Practice: 200,
  Firm: 1000,
};

// ---- Row → domain mapping -------------------------------------------------

interface TitleReportRow {
  id: string;
  firm_id: string;
  case_id: string | null;
  client_id: string | null;
  created_by: string;
  assigned_to: string | null;
  status: TitleReportStatus;
  report_number: string;
  jurisdiction_state: string;
  applicant_name: string;
  applicant_type: 'buyer' | 'owner' | 'borrower';
  bank_name: string | null;
  bank_branch: string | null;
  loan_reference: string | null;
  search_period_from: Date | string | null;
  search_period_to: Date | string | null;
  opinion_verdict: 'pending' | 'clear' | 'clear_with_conditions' | 'not_clear';
  opinion_summary: string | null;
  finalised_at: Date | string | null;
  issued_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function isoOrNull(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function isoOf(d: Date | string): string {
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function dateOrNull(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function rowToHeader(r: TitleReportRow): TitleReport {
  return {
    id: r.id,
    firmId: r.firm_id,
    caseId: r.case_id,
    clientId: r.client_id,
    createdBy: r.created_by,
    assignedTo: r.assigned_to,
    status: r.status,
    reportNumber: r.report_number,
    jurisdictionState: r.jurisdiction_state as TitleReport['jurisdictionState'],
    applicantName: r.applicant_name,
    applicantType: r.applicant_type,
    bankName: r.bank_name,
    bankBranch: r.bank_branch,
    loanReference: r.loan_reference,
    searchPeriodFrom: dateOrNull(r.search_period_from),
    searchPeriodTo: dateOrNull(r.search_period_to),
    opinionVerdict: r.opinion_verdict,
    opinionSummary: r.opinion_summary,
    finalisedAt: isoOrNull(r.finalised_at),
    issuedAt: isoOrNull(r.issued_at),
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

// ---- Report number allocator ----------------------------------------------

async function allocateReportNumber(firmId: string): Promise<string> {
  const sql = db();
  const year = new Date().getUTCFullYear();
  if (!sql) {
    // Demo-mode: tick a per-process counter.
    const memKey = `${firmId}:${year}`;
    memCounters.set(memKey, (memCounters.get(memKey) ?? 0) + 1);
    const n = memCounters.get(memKey) ?? 1;
    return `TR/${year}/${String(n).padStart(5, '0')}`;
  }
  const [row] = await sql<{ last_seq: number }[]>`
    insert into title_report_counters (firm_id, year, last_seq)
    values (${firmId}::uuid, ${year}, 1)
    on conflict (firm_id, year)
    do update set last_seq = title_report_counters.last_seq + 1, updated_at = now()
    returning last_seq
  `;
  const seq = row?.last_seq ?? 1;
  return `TR/${year}/${String(seq).padStart(5, '0')}`;
}

const memCounters = new Map<string, number>();

// ---- Header CRUD ----------------------------------------------------------

async function create(
  firmId: string,
  userId: string,
  actorEmail: string,
  roleName: string | null,
  dto: CreateTitleReportDto,
): Promise<TitleReport> {
  assertRoleCan(roleName, 'create');

  // Title-report creation is counted against the shared AI-generation cap
  // (plan_ai_caps + ai_generations) — the same cap drafting uses. The
  // check fires before sequence-number allocation so a quota rejection
  // doesn't burn a number. Throws AiQuotaExceededError on cap hit; the
  // route translates that into 429 ai_quota_exceeded so the existing
  // CapExceededModal picks it up.
  await aiQuotaService.assertCanGenerate(firmId, userId);

  const sql = db();
  const reportNumber = await allocateReportNumber(firmId);
  if (!sql) {
    const now = new Date().toISOString();
    const row: TitleReport = {
      id: crypto.randomUUID(),
      firmId,
      caseId: dto.caseId ?? null,
      clientId: dto.clientId ?? null,
      createdBy: userId,
      assignedTo: dto.assignedTo ?? null,
      status: 'draft',
      reportNumber,
      jurisdictionState: dto.jurisdictionState,
      applicantName: dto.applicantName,
      applicantType: dto.applicantType ?? 'buyer',
      bankName: dto.bankName ?? null,
      bankBranch: dto.bankBranch ?? null,
      loanReference: dto.loanReference ?? null,
      searchPeriodFrom: dto.searchPeriodFrom ?? null,
      searchPeriodTo: dto.searchPeriodTo ?? null,
      opinionVerdict: 'pending',
      opinionSummary: null,
      finalisedAt: null,
      issuedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    memReports.push(row);
    await writeAudit(userId, actorEmail, 'title_report.create', row.id, { reportNumber });
    // Record against the shared AI cap. Non-fatal if the ledger write fails —
    // the user already got their report; the rate-limiter still bounds abuse.
    try {
      await aiQuotaService.record(firmId, userId, 'generate', { docType: 'title_report' });
    } catch (err) {
      logger.warn({ err, userId }, 'ai-quota record (title_report create, demo) failed');
    }
    return row;
  }
  const [row] = await sql<TitleReportRow[]>`
    insert into title_reports
      (firm_id, case_id, client_id, created_by, assigned_to,
       report_number, jurisdiction_state, applicant_name, applicant_type,
       bank_name, bank_branch, loan_reference,
       search_period_from, search_period_to)
    values
      (${firmId}::uuid,
       ${dto.caseId ?? null}::uuid,
       ${dto.clientId ?? null}::uuid,
       ${userId}::uuid,
       ${dto.assignedTo ?? null}::uuid,
       ${reportNumber},
       ${dto.jurisdictionState},
       ${dto.applicantName},
       ${dto.applicantType ?? 'buyer'},
       ${dto.bankName ?? null},
       ${dto.bankBranch ?? null},
       ${dto.loanReference ?? null},
       ${dto.searchPeriodFrom ?? null}::date,
       ${dto.searchPeriodTo ?? null}::date)
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'title_report_insert_failed', 'Insert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.create', row.id, { reportNumber });
  try {
    await aiQuotaService.record(firmId, userId, 'generate', { docType: 'title_report' });
  } catch (err) {
    logger.warn({ err, userId }, 'ai-quota record (title_report create) failed');
  }
  return rowToHeader(row);
}

async function update(
  firmId: string,
  id: string,
  userId: string,
  actorEmail: string,
  roleName: string | null,
  dto: UpdateTitleReportDto,
): Promise<TitleReport> {
  assertRoleCan(roleName, 'edit');
  const sql = db();
  if (!sql) {
    const idx = memReports.findIndex((r) => r.id === id && r.firmId === firmId);
    if (idx < 0) throw new TitleReportNotFound(id);
    const cur = memReports[idx]!;
    const merged: TitleReport = { ...cur, ...stripUndef(dto as unknown as Record<string, unknown>), updatedAt: new Date().toISOString() } as TitleReport;
    memReports[idx] = merged;
    await writeAudit(userId, actorEmail, 'title_report.update', id, { patch: dto });
    return merged;
  }
  const [row] = await sql<TitleReportRow[]>`
    update title_reports
    set
      jurisdiction_state = coalesce(${dto.jurisdictionState ?? null}, jurisdiction_state),
      applicant_name     = coalesce(${dto.applicantName ?? null},     applicant_name),
      applicant_type     = coalesce(${dto.applicantType ?? null},     applicant_type),
      bank_name          = ${dto.bankName === undefined ? null : dto.bankName} is not distinct from null
                             and bank_name is not null and ${dto.bankName === undefined ? 1 : 0} = 1
                             then bank_name else ${dto.bankName ?? null} end,
      bank_branch        = case when ${dto.bankBranch === undefined ? 1 : 0} = 1 then bank_branch else ${dto.bankBranch ?? null} end,
      loan_reference     = case when ${dto.loanReference === undefined ? 1 : 0} = 1 then loan_reference else ${dto.loanReference ?? null} end,
      case_id            = case when ${dto.caseId === undefined ? 1 : 0} = 1 then case_id else ${dto.caseId ?? null}::uuid end,
      client_id          = case when ${dto.clientId === undefined ? 1 : 0} = 1 then client_id else ${dto.clientId ?? null}::uuid end,
      assigned_to        = case when ${dto.assignedTo === undefined ? 1 : 0} = 1 then assigned_to else ${dto.assignedTo ?? null}::uuid end,
      search_period_from = case when ${dto.searchPeriodFrom === undefined ? 1 : 0} = 1 then search_period_from else ${dto.searchPeriodFrom ?? null}::date end,
      search_period_to   = case when ${dto.searchPeriodTo === undefined ? 1 : 0} = 1 then search_period_to else ${dto.searchPeriodTo ?? null}::date end,
      opinion_verdict    = coalesce(${dto.opinionVerdict ?? null}, opinion_verdict),
      opinion_summary    = case when ${dto.opinionSummary === undefined ? 1 : 0} = 1 then opinion_summary else ${dto.opinionSummary ?? null} end,
      updated_at         = now()
    where id = ${id}::uuid and firm_id = ${firmId}::uuid
    returning *
  `;
  if (!row) throw new TitleReportNotFound(id);
  await writeAudit(userId, actorEmail, 'title_report.update', id, { patch: dto });
  return rowToHeader(row);
}

function stripUndef<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

async function listForFirm(firmId: string, q: TitleReportListQuery): Promise<TitleReportListResponse> {
  const pageSize = Math.min(Math.max(q.pageSize ?? 25, 1), 100);
  const page = Math.max(q.page ?? 1, 1);
  const offset = (page - 1) * pageSize;
  const sql = db();
  if (!sql) {
    let items = memReports.filter((r) => r.firmId === firmId);
    if (q.status) items = items.filter((r) => r.status === q.status);
    if (q.jurisdictionState) items = items.filter((r) => r.jurisdictionState === q.jurisdictionState);
    if (q.assignedTo) items = items.filter((r) => r.assignedTo === q.assignedTo);
    if (q.bank) items = items.filter((r) => (r.bankName ?? '').toLowerCase().includes(q.bank!.toLowerCase()));
    if (q.q) {
      const needle = q.q.toLowerCase();
      items = items.filter((r) =>
        r.applicantName.toLowerCase().includes(needle) ||
        r.reportNumber.toLowerCase().includes(needle) ||
        (r.bankName ?? '').toLowerCase().includes(needle));
    }
    const total = items.length;
    items = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(offset, offset + pageSize);
    return { items, total, page, pageSize };
  }
  const rows = await sql<TitleReportRow[]>`
    select * from title_reports
    where firm_id = ${firmId}::uuid
      and (${q.status ?? null}::title_report_status is null or status = ${q.status ?? null}::title_report_status)
      and (${q.jurisdictionState ?? null}::text is null or jurisdiction_state = ${q.jurisdictionState ?? null})
      and (${q.assignedTo ?? null}::uuid is null or assigned_to = ${q.assignedTo ?? null}::uuid)
      and (${q.bank ?? null}::text is null or bank_name ilike '%' || ${q.bank ?? null} || '%')
      and (${q.q ?? null}::text is null
            or applicant_name ilike '%' || ${q.q ?? null} || '%'
            or report_number ilike '%' || ${q.q ?? null} || '%'
            or coalesce(bank_name, '') ilike '%' || ${q.q ?? null} || '%')
    order by created_at desc
    limit ${pageSize} offset ${offset}
  `;
  const [count] = await sql<{ total: number }[]>`
    select count(*)::int as total from title_reports
    where firm_id = ${firmId}::uuid
      and (${q.status ?? null}::title_report_status is null or status = ${q.status ?? null}::title_report_status)
  `;
  return {
    items: rows.map(rowToHeader),
    total: count?.total ?? rows.length,
    page,
    pageSize,
  };
}

async function findById(firmId: string, id: string): Promise<TitleReportRow | null> {
  const sql = db();
  if (!sql) {
    const r = memReports.find((x) => x.id === id && x.firmId === firmId);
    if (!r) return null;
    // Convert back into row shape for downstream symmetry.
    return {
      id: r.id,
      firm_id: r.firmId,
      case_id: r.caseId,
      client_id: r.clientId,
      created_by: r.createdBy,
      assigned_to: r.assignedTo,
      status: r.status,
      report_number: r.reportNumber,
      jurisdiction_state: r.jurisdictionState,
      applicant_name: r.applicantName,
      applicant_type: r.applicantType,
      bank_name: r.bankName,
      bank_branch: r.bankBranch,
      loan_reference: r.loanReference,
      search_period_from: r.searchPeriodFrom,
      search_period_to: r.searchPeriodTo,
      opinion_verdict: r.opinionVerdict,
      opinion_summary: r.opinionSummary,
      finalised_at: r.finalisedAt,
      issued_at: r.issuedAt,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }
  const [row] = await sql<TitleReportRow[]>`
    select * from title_reports where id = ${id}::uuid and firm_id = ${firmId}::uuid limit 1
  `;
  return row ?? null;
}

async function getFull(firmId: string, id: string): Promise<TitleReportFull> {
  const header = await findById(firmId, id);
  if (!header) throw new TitleReportNotFound(id);

  const sql = db();
  if (!sql) {
    return {
      ...rowToHeader(header),
      property: memProperty.get(id) ?? null,
      chainLinks: memChainLinks.filter((l) => l.titleReportId === id).sort((a, b) => a.sequenceNo - b.sequenceNo),
      documents: memDocuments.filter((d) => d.titleReportId === id),
      encumbrances: memEncumbrances.filter((e) => e.titleReportId === id),
      searches: memSearches.filter((s) => s.titleReportId === id),
      litigation: memLitigation.filter((l) => l.titleReportId === id),
      approvals: memApprovals.filter((a) => a.titleReportId === id),
      heirs: memHeirs.filter((h) => h.titleReportId === id),
      defects: memDefects.filter((d) => d.titleReportId === id),
      aiRuns: memAiRuns.filter((r) => r.titleReportId === id),
      exports: memExports.filter((e) => e.titleReportId === id),
    };
  }

  const [
    propertyRows, chainLinkRows, documentRows, encumbranceRows,
    searchRows, litigationRows, approvalRows, heirRows,
    defectRows, aiRunRows, exportRows,
  ] = await Promise.all([
    sql<PropertyRow[]>`select * from title_report_properties where title_report_id = ${id}::uuid limit 1`,
    sql<ChainLinkRow[]>`select * from title_report_chain_links where title_report_id = ${id}::uuid order by sequence_no asc`,
    sql<DocumentRow[]>`select * from title_report_documents where title_report_id = ${id}::uuid order by created_at asc`,
    sql<EncumbranceRow[]>`select * from title_report_encumbrances where title_report_id = ${id}::uuid order by transaction_date asc nulls last`,
    sql<SearchRow[]>`select * from title_report_searches where title_report_id = ${id}::uuid order by search_date asc nulls last`,
    sql<LitigationRow[]>`select * from title_report_litigation where title_report_id = ${id}::uuid order by created_at asc`,
    sql<ApprovalRow[]>`select * from title_report_statutory_approvals where title_report_id = ${id}::uuid order by created_at asc`,
    sql<HeirRow[]>`select * from title_report_heirs where title_report_id = ${id}::uuid order by created_at asc`,
    sql<DefectRow[]>`select * from title_report_defects where title_report_id = ${id}::uuid order by severity desc, created_at desc`,
    // Latest run per type — DISTINCT ON keyed by run_type.
    sql<AiRunRow[]>`
      select distinct on (run_type) *
      from title_report_ai_runs
      where title_report_id = ${id}::uuid and status = 'done'
      order by run_type, created_at desc
    `,
    sql<ExportRow[]>`select * from title_report_exports where title_report_id = ${id}::uuid order by created_at desc`,
  ]);

  return {
    ...rowToHeader(header),
    property: propertyRows[0] ? rowToProperty(propertyRows[0]) : null,
    chainLinks: chainLinkRows.map(rowToChainLink),
    documents: documentRows.map(rowToDocument),
    encumbrances: encumbranceRows.map(rowToEncumbrance),
    searches: searchRows.map(rowToSearch),
    litigation: litigationRows.map(rowToLitigation),
    approvals: approvalRows.map(rowToApproval),
    heirs: heirRows.map(rowToHeir),
    defects: defectRows.map(rowToDefect),
    aiRuns: aiRunRows.map(rowToAiRun),
    exports: exportRows.map(rowToExport),
  };
}

// ---- Sub-table row interfaces + mappers -----------------------------------

interface PropertyRow {
  id: string; title_report_id: string;
  address: string;
  survey_no: string | null; sub_division: string | null;
  extent_value: string | number | null; extent_unit: string | null;
  boundary_north: string | null; boundary_south: string | null;
  boundary_east: string | null; boundary_west: string | null;
  schedule_a: string | null;
  latitude: string | number | null; longitude: string | number | null;
  jurisdiction_specific: Record<string, unknown> | string;
  created_at: Date | string; updated_at: Date | string;
}

function rowToProperty(r: PropertyRow): TitleReportProperty {
  const js = typeof r.jurisdiction_specific === 'string'
    ? safeParse(r.jurisdiction_specific) : r.jurisdiction_specific;
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    address: r.address,
    surveyNo: r.survey_no,
    subDivision: r.sub_division,
    extentValue: r.extent_value !== null ? Number(r.extent_value) : null,
    extentUnit: (r.extent_unit ?? null) as TitleReportProperty['extentUnit'],
    boundaryNorth: r.boundary_north,
    boundarySouth: r.boundary_south,
    boundaryEast: r.boundary_east,
    boundaryWest: r.boundary_west,
    scheduleA: r.schedule_a,
    latitude: r.latitude !== null ? Number(r.latitude) : null,
    longitude: r.longitude !== null ? Number(r.longitude) : null,
    jurisdictionSpecific: (js ?? {}) as TitleReportProperty['jurisdictionSpecific'],
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

interface ChainLinkRow {
  id: string; title_report_id: string;
  sequence_no: number; link_type: string;
  transferor: string; transferee: string;
  document_date: Date | string | null;
  document_no: string | null; sro_office: string | null;
  book_no: string | null; volume_no: string | null; pages: string | null;
  stamp_duty_paid: string | number | null; consideration: string | number | null;
  notes: string | null;
  created_at: Date | string; updated_at: Date | string;
}

function rowToChainLink(r: ChainLinkRow): TitleReportChainLink {
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    sequenceNo: r.sequence_no,
    linkType: r.link_type as TitleReportChainLink['linkType'],
    transferor: r.transferor,
    transferee: r.transferee,
    documentDate: dateOrNull(r.document_date),
    documentNo: r.document_no,
    sroOffice: r.sro_office,
    bookNo: r.book_no,
    volumeNo: r.volume_no,
    pages: r.pages,
    stampDutyPaid: r.stamp_duty_paid !== null ? Number(r.stamp_duty_paid) : null,
    consideration: r.consideration !== null ? Number(r.consideration) : null,
    notes: r.notes,
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

interface DocumentRow {
  id: string; title_report_id: string;
  document_type: string; document_label: string;
  parties: string | null; document_date: Date | string | null;
  registration_no: string | null; sro_office: string | null;
  copy_type: string | null;
  storage_ref: string | null; file_name: string | null;
  file_mime: string | null; file_size: number | null;
  extracted_payload: Record<string, unknown> | string;
  extraction_status: string; extraction_error: string | null;
  created_at: Date | string; updated_at: Date | string;
}

function rowToDocument(r: DocumentRow): TitleReportDocument {
  const p = typeof r.extracted_payload === 'string'
    ? safeParse(r.extracted_payload) : r.extracted_payload;
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    documentType: r.document_type as TitleReportDocument['documentType'],
    documentLabel: r.document_label,
    parties: r.parties,
    documentDate: dateOrNull(r.document_date),
    registrationNo: r.registration_no,
    sroOffice: r.sro_office,
    copyType: (r.copy_type ?? null) as TitleReportDocument['copyType'],
    storageRef: r.storage_ref,
    fileName: r.file_name,
    fileMime: r.file_mime,
    fileSize: r.file_size,
    extractedPayload: (p ?? {}) as Record<string, unknown>,
    extractionStatus: r.extraction_status as TitleReportDocument['extractionStatus'],
    extractionError: r.extraction_error,
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

interface EncumbranceRow {
  id: string; title_report_id: string;
  ec_period_from: Date | string | null; ec_period_to: Date | string | null;
  ec_office: string | null; ec_form: string | null;
  transaction_no: string | null; transaction_date: Date | string | null;
  transaction_type: string | null; parties: string | null;
  consideration: string | number | null;
  status: string; discharge_doc_ref: string | null;
  created_at: Date | string; updated_at: Date | string;
}

function rowToEncumbrance(r: EncumbranceRow): TitleReportEncumbrance {
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    ecPeriodFrom: dateOrNull(r.ec_period_from),
    ecPeriodTo: dateOrNull(r.ec_period_to),
    ecOffice: r.ec_office,
    ecForm: (r.ec_form ?? null) as TitleReportEncumbrance['ecForm'],
    transactionNo: r.transaction_no,
    transactionDate: dateOrNull(r.transaction_date),
    transactionType: r.transaction_type,
    parties: r.parties,
    consideration: r.consideration !== null ? Number(r.consideration) : null,
    status: r.status as TitleReportEncumbrance['status'],
    dischargeDocRef: r.discharge_doc_ref,
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

interface SearchRow {
  id: string; title_report_id: string;
  search_type: string; search_office: string | null;
  search_query: string | null; search_date: Date | string | null;
  result_summary: string | null; result_negative: boolean;
  attachment_ref: string | null;
  created_at: Date | string; updated_at: Date | string;
}

function rowToSearch(r: SearchRow): TitleReportSearch {
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    searchType: r.search_type as TitleReportSearch['searchType'],
    searchOffice: r.search_office,
    searchQuery: r.search_query,
    searchDate: dateOrNull(r.search_date),
    resultSummary: r.result_summary,
    resultNegative: !!r.result_negative,
    attachmentRef: r.attachment_ref,
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

interface LitigationRow {
  id: string; title_report_id: string;
  court: string | null; case_number: string | null;
  parties: string | null; cause_of_action: string | null;
  stage: string | null; relevance: string;
  next_date: Date | string | null; notes: string | null;
  created_at: Date | string; updated_at: Date | string;
}

function rowToLitigation(r: LitigationRow): TitleReportLitigation {
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    court: r.court,
    caseNumber: r.case_number,
    parties: r.parties,
    causeOfAction: r.cause_of_action,
    stage: r.stage,
    relevance: r.relevance as TitleReportLitigation['relevance'],
    nextDate: dateOrNull(r.next_date),
    notes: r.notes,
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

interface ApprovalRow {
  id: string; title_report_id: string;
  approval_type: string; authority: string | null;
  reference_no: string | null; issue_date: Date | string | null;
  validity: string | null; status: string;
  created_at: Date | string; updated_at: Date | string;
}

function rowToApproval(r: ApprovalRow): TitleReportStatutoryApproval {
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    approvalType: r.approval_type as TitleReportStatutoryApproval['approvalType'],
    authority: r.authority,
    referenceNo: r.reference_no,
    issueDate: dateOrNull(r.issue_date),
    validity: r.validity,
    status: r.status as TitleReportStatutoryApproval['status'],
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

interface HeirRow {
  id: string; title_report_id: string;
  predecessor_name: string; predecessor_dod: Date | string | null;
  personal_law: string;
  heir_name: string; relationship: string | null;
  share: string | null; consent_status: string;
  created_at: Date | string; updated_at: Date | string;
}

function rowToHeir(r: HeirRow): TitleReportHeir {
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    predecessorName: r.predecessor_name,
    predecessorDod: dateOrNull(r.predecessor_dod),
    personalLaw: r.personal_law as TitleReportHeir['personalLaw'],
    heirName: r.heir_name,
    relationship: r.relationship,
    share: r.share,
    consentStatus: r.consent_status as TitleReportHeir['consentStatus'],
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

interface DefectRow {
  id: string; title_report_id: string;
  category: string; severity: string; description: string;
  recommendation: string | null; source: string;
  refs: Record<string, unknown>[] | string;
  acknowledged_by: string | null;
  acknowledged_at: Date | string | null;
  dismissed: boolean; dismissed_reason: string | null;
  created_at: Date | string; updated_at: Date | string;
}

function rowToDefect(r: DefectRow): TitleReportDefect {
  const refs = typeof r.refs === 'string' ? safeParse(r.refs) ?? [] : r.refs ?? [];
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    category: r.category as TitleReportDefect['category'],
    severity: r.severity as TitleReportDefect['severity'],
    description: r.description,
    recommendation: r.recommendation,
    source: r.source as TitleReportDefect['source'],
    refs: refs as TitleReportDefect['refs'],
    acknowledgedBy: r.acknowledged_by,
    acknowledgedAt: isoOrNull(r.acknowledged_at),
    dismissed: !!r.dismissed,
    dismissedReason: r.dismissed_reason,
    createdAt: isoOf(r.created_at),
    updatedAt: isoOf(r.updated_at),
  };
}

interface AiRunRow {
  id: string; title_report_id: string;
  run_type: string; model: string | null; provider: string | null;
  input_hash: string | null;
  output: Record<string, unknown> | string;
  status: string; error: string | null;
  tokens_in: number | null; tokens_out: number | null; duration_ms: number | null;
  created_by: string | null;
  created_at: Date | string; completed_at: Date | string | null;
}

function rowToAiRun(r: AiRunRow): TitleReportAiRun {
  const out = typeof r.output === 'string' ? safeParse(r.output) : r.output;
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    runType: r.run_type as TitleReportAiRun['runType'],
    model: r.model,
    provider: r.provider,
    inputHash: r.input_hash,
    output: (out ?? {}) as Record<string, unknown>,
    status: r.status as TitleReportAiRun['status'],
    error: r.error,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    durationMs: r.duration_ms,
    createdBy: r.created_by,
    createdAt: isoOf(r.created_at),
    completedAt: isoOrNull(r.completed_at),
  };
}

interface ExportRow {
  id: string; title_report_id: string;
  format: string; letterhead_id: string | null;
  storage_ref: string | null; file_name: string | null;
  file_mime: string | null; file_size: number | null;
  created_by: string | null; created_at: Date | string;
}

function rowToExport(r: ExportRow): TitleReportExport {
  return {
    id: r.id,
    titleReportId: r.title_report_id,
    format: r.format as TitleReportExportFormat,
    letterheadId: r.letterhead_id,
    storageRef: r.storage_ref,
    fileName: r.file_name,
    fileMime: r.file_mime,
    fileSize: r.file_size,
    createdBy: r.created_by,
    createdAt: isoOf(r.created_at),
  };
}

function safeParse<T = unknown>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { return null; }
}

// ---- Property -------------------------------------------------------------

async function upsertProperty(
  firmId: string,
  id: string,
  userId: string,
  actorEmail: string,
  roleName: string | null,
  dto: UpsertTitleReportPropertyDto,
): Promise<TitleReportProperty> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  const js = JSON.stringify(dto.jurisdictionSpecific ?? {});
  if (!sql) {
    const existing = memProperty.get(id);
    const now = new Date().toISOString();
    const merged: TitleReportProperty = {
      id: existing?.id ?? crypto.randomUUID(),
      titleReportId: id,
      address: dto.address,
      surveyNo: dto.surveyNo ?? null,
      subDivision: dto.subDivision ?? null,
      extentValue: dto.extentValue ?? null,
      extentUnit: dto.extentUnit ?? null,
      boundaryNorth: dto.boundaryNorth ?? null,
      boundarySouth: dto.boundarySouth ?? null,
      boundaryEast: dto.boundaryEast ?? null,
      boundaryWest: dto.boundaryWest ?? null,
      scheduleA: dto.scheduleA ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      jurisdictionSpecific: (dto.jurisdictionSpecific ?? {}) as Record<string, string | number | null>,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    memProperty.set(id, merged);
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'property' });
    return merged;
  }
  const [row] = await sql<PropertyRow[]>`
    insert into title_report_properties
      (title_report_id, firm_id, address, survey_no, sub_division,
       extent_value, extent_unit, boundary_north, boundary_south,
       boundary_east, boundary_west, schedule_a, latitude, longitude,
       jurisdiction_specific)
    values
      (${id}::uuid, ${firmId}::uuid,
       ${dto.address},
       ${dto.surveyNo ?? null},
       ${dto.subDivision ?? null},
       ${dto.extentValue ?? null},
       ${(dto.extentUnit ?? null) as string | null},
       ${dto.boundaryNorth ?? null},
       ${dto.boundarySouth ?? null},
       ${dto.boundaryEast ?? null},
       ${dto.boundaryWest ?? null},
       ${dto.scheduleA ?? null},
       ${dto.latitude ?? null},
       ${dto.longitude ?? null},
       ${js}::jsonb)
    on conflict (title_report_id) do update set
      address              = excluded.address,
      survey_no            = excluded.survey_no,
      sub_division         = excluded.sub_division,
      extent_value         = excluded.extent_value,
      extent_unit          = excluded.extent_unit,
      boundary_north       = excluded.boundary_north,
      boundary_south       = excluded.boundary_south,
      boundary_east        = excluded.boundary_east,
      boundary_west        = excluded.boundary_west,
      schedule_a           = excluded.schedule_a,
      latitude             = excluded.latitude,
      longitude            = excluded.longitude,
      jurisdiction_specific = excluded.jurisdiction_specific,
      updated_at           = now()
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'property_upsert_failed', 'Property upsert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'property' });
  return rowToProperty(row);
}

// ---- Chain links ----------------------------------------------------------

async function addChainLink(
  firmId: string, id: string, userId: string, actorEmail: string, roleName: string | null,
  dto: ChainLinkDto,
): Promise<TitleReportChainLink> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const now = new Date().toISOString();
    const row: TitleReportChainLink = {
      id: crypto.randomUUID(),
      titleReportId: id,
      sequenceNo: dto.sequenceNo,
      linkType: dto.linkType,
      transferor: dto.transferor,
      transferee: dto.transferee,
      documentDate: dto.documentDate ?? null,
      documentNo: dto.documentNo ?? null,
      sroOffice: dto.sroOffice ?? null,
      bookNo: dto.bookNo ?? null,
      volumeNo: dto.volumeNo ?? null,
      pages: dto.pages ?? null,
      stampDutyPaid: dto.stampDutyPaid ?? null,
      consideration: dto.consideration ?? null,
      notes: dto.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    memChainLinks.push(row);
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'chain_link.add' });
    return row;
  }
  const [row] = await sql<ChainLinkRow[]>`
    insert into title_report_chain_links
      (title_report_id, firm_id, sequence_no, link_type, transferor, transferee,
       document_date, document_no, sro_office, book_no, volume_no, pages,
       stamp_duty_paid, consideration, notes)
    values
      (${id}::uuid, ${firmId}::uuid, ${dto.sequenceNo}, ${dto.linkType},
       ${dto.transferor}, ${dto.transferee},
       ${dto.documentDate ?? null}::date,
       ${dto.documentNo ?? null}, ${dto.sroOffice ?? null},
       ${dto.bookNo ?? null}, ${dto.volumeNo ?? null}, ${dto.pages ?? null},
       ${dto.stampDutyPaid ?? null}, ${dto.consideration ?? null},
       ${dto.notes ?? null})
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'chain_link_insert_failed', 'Insert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'chain_link.add' });
  return rowToChainLink(row);
}

async function updateChainLink(
  firmId: string, id: string, linkId: string, userId: string, actorEmail: string,
  roleName: string | null, patch: Partial<ChainLinkDto>,
): Promise<TitleReportChainLink> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const idx = memChainLinks.findIndex((l) => l.id === linkId && l.titleReportId === id);
    if (idx < 0) throw new TitleReportError(404, 'chain_link_not_found', 'Chain link not found');
    memChainLinks[idx] = { ...memChainLinks[idx], ...stripUndef(patch as Record<string, unknown>), updatedAt: new Date().toISOString() } as TitleReportChainLink;
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'chain_link.update' });
    return memChainLinks[idx];
  }
  const [row] = await sql<ChainLinkRow[]>`
    update title_report_chain_links set
      sequence_no      = coalesce(${patch.sequenceNo ?? null}, sequence_no),
      link_type        = coalesce(${patch.linkType ?? null}, link_type),
      transferor       = coalesce(${patch.transferor ?? null}, transferor),
      transferee       = coalesce(${patch.transferee ?? null}, transferee),
      document_date    = case when ${patch.documentDate === undefined ? 1 : 0} = 1 then document_date else ${patch.documentDate ?? null}::date end,
      document_no      = case when ${patch.documentNo === undefined ? 1 : 0} = 1 then document_no else ${patch.documentNo ?? null} end,
      sro_office       = case when ${patch.sroOffice === undefined ? 1 : 0} = 1 then sro_office else ${patch.sroOffice ?? null} end,
      book_no          = case when ${patch.bookNo === undefined ? 1 : 0} = 1 then book_no else ${patch.bookNo ?? null} end,
      volume_no        = case when ${patch.volumeNo === undefined ? 1 : 0} = 1 then volume_no else ${patch.volumeNo ?? null} end,
      pages            = case when ${patch.pages === undefined ? 1 : 0} = 1 then pages else ${patch.pages ?? null} end,
      stamp_duty_paid  = case when ${patch.stampDutyPaid === undefined ? 1 : 0} = 1 then stamp_duty_paid else ${patch.stampDutyPaid ?? null} end,
      consideration    = case when ${patch.consideration === undefined ? 1 : 0} = 1 then consideration else ${patch.consideration ?? null} end,
      notes            = case when ${patch.notes === undefined ? 1 : 0} = 1 then notes else ${patch.notes ?? null} end,
      updated_at       = now()
    where id = ${linkId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
    returning *
  `;
  if (!row) throw new TitleReportError(404, 'chain_link_not_found', 'Chain link not found');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'chain_link.update' });
  return rowToChainLink(row);
}

async function deleteChainLink(
  firmId: string, id: string, linkId: string, userId: string, actorEmail: string, roleName: string | null,
): Promise<void> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    memChainLinks = memChainLinks.filter((l) => !(l.id === linkId && l.titleReportId === id));
  } else {
    await sql`
      delete from title_report_chain_links
      where id = ${linkId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
    `;
  }
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'chain_link.delete', linkId });
}

// ---- Documents (stored blob + extraction-state lifecycle) -----------------

async function addDocument(
  firmId: string, id: string, userId: string, actorEmail: string, roleName: string | null,
  input: {
    documentType: TitleReportDocument['documentType'];
    documentLabel: string;
    parties?: string | null;
    documentDate?: string | null;
    registrationNo?: string | null;
    sroOffice?: string | null;
    copyType?: TitleReportDocument['copyType'] | null;
    storageRef?: string | null;
    fileName?: string | null;
    fileMime?: string | null;
    fileSize?: number | null;
  },
): Promise<TitleReportDocument> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const now = new Date().toISOString();
    const row: TitleReportDocument = {
      id: crypto.randomUUID(),
      titleReportId: id,
      documentType: input.documentType,
      documentLabel: input.documentLabel,
      parties: input.parties ?? null,
      documentDate: input.documentDate ?? null,
      registrationNo: input.registrationNo ?? null,
      sroOffice: input.sroOffice ?? null,
      copyType: input.copyType ?? null,
      storageRef: input.storageRef ?? null,
      fileName: input.fileName ?? null,
      fileMime: input.fileMime ?? null,
      fileSize: input.fileSize ?? null,
      extractedPayload: {},
      extractionStatus: input.storageRef ? 'pending' : 'none',
      extractionError: null,
      createdAt: now,
      updatedAt: now,
    };
    memDocuments.push(row);
    await writeAudit(userId, actorEmail, 'title_report.document.upload', id, { documentId: row.id });
    return row;
  }
  const [row] = await sql<DocumentRow[]>`
    insert into title_report_documents
      (title_report_id, firm_id, document_type, document_label, parties,
       document_date, registration_no, sro_office, copy_type,
       storage_ref, file_name, file_mime, file_size,
       extraction_status)
    values
      (${id}::uuid, ${firmId}::uuid, ${input.documentType}, ${input.documentLabel},
       ${input.parties ?? null}, ${input.documentDate ?? null}::date,
       ${input.registrationNo ?? null}, ${input.sroOffice ?? null}, ${input.copyType ?? null},
       ${input.storageRef ?? null}, ${input.fileName ?? null},
       ${input.fileMime ?? null}, ${input.fileSize ?? null},
       ${input.storageRef ? 'pending' : 'none'})
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'document_insert_failed', 'Document insert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.document.upload', id, { documentId: row.id });
  return rowToDocument(row);
}

async function patchDocument(
  firmId: string, id: string, docId: string, userId: string, actorEmail: string, roleName: string | null,
  patch: Partial<{
    documentType: TitleReportDocument['documentType'];
    documentLabel: string;
    parties: string | null;
    documentDate: string | null;
    registrationNo: string | null;
    sroOffice: string | null;
    copyType: TitleReportDocument['copyType'] | null;
    extractedPayload: Record<string, unknown>;
    extractionStatus: TitleReportDocument['extractionStatus'];
    extractionError: string | null;
  }>,
): Promise<TitleReportDocument> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const idx = memDocuments.findIndex((d) => d.id === docId && d.titleReportId === id);
    if (idx < 0) throw new TitleReportError(404, 'document_not_found', 'Document not found');
    memDocuments[idx] = { ...memDocuments[idx], ...stripUndef(patch as Record<string, unknown>), updatedAt: new Date().toISOString() } as TitleReportDocument;
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'document.patch', documentId: docId });
    return memDocuments[idx];
  }
  const ep = patch.extractedPayload === undefined ? null : JSON.stringify(patch.extractedPayload);
  const [row] = await sql<DocumentRow[]>`
    update title_report_documents set
      document_type     = coalesce(${patch.documentType ?? null}, document_type),
      document_label    = coalesce(${patch.documentLabel ?? null}, document_label),
      parties           = case when ${patch.parties === undefined ? 1 : 0} = 1 then parties else ${patch.parties ?? null} end,
      document_date     = case when ${patch.documentDate === undefined ? 1 : 0} = 1 then document_date else ${patch.documentDate ?? null}::date end,
      registration_no   = case when ${patch.registrationNo === undefined ? 1 : 0} = 1 then registration_no else ${patch.registrationNo ?? null} end,
      sro_office        = case when ${patch.sroOffice === undefined ? 1 : 0} = 1 then sro_office else ${patch.sroOffice ?? null} end,
      copy_type         = case when ${patch.copyType === undefined ? 1 : 0} = 1 then copy_type else ${patch.copyType ?? null} end,
      extracted_payload = case when ${ep === null ? 1 : 0} = 1 then extracted_payload else ${ep}::jsonb end,
      extraction_status = coalesce(${patch.extractionStatus ?? null}, extraction_status),
      extraction_error  = case when ${patch.extractionError === undefined ? 1 : 0} = 1 then extraction_error else ${patch.extractionError ?? null} end,
      updated_at        = now()
    where id = ${docId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
    returning *
  `;
  if (!row) throw new TitleReportError(404, 'document_not_found', 'Document not found');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'document.patch', documentId: docId });
  return rowToDocument(row);
}

// ---- Apply extracted payload into the rest of the report ------------------
//
// Once title-reports.extract.service.ts has surfaced structured fields onto
// title_report_documents.extracted_payload, this method routes them into the
// correct sub-table:
//
//   sale_deed / gift_deed / partition_deed / will / settlement
//     -> a new chain link populated from {documentNo, sroOffice, bookNo, ...}
//   ec
//     -> encumbrance rows (one per transaction found in the EC table)
//   patta / chitta / adangal / khata / rtc / seven_twelve / mutation
//     -> merged into the property block's jurisdiction_specific jsonb
//
// Other document types are recorded but not auto-applied — the advocate can
// still copy values manually. The method never overwrites; it only inserts
// new rows or merges absent keys into property.jurisdiction_specific.

export interface ApplyExtractionOutcome {
  applied: 'chain_link' | 'encumbrance' | 'property' | 'none';
  chainLinkId?: string;
  encumbranceIds?: string[];
  propertyId?: string;
  fieldsApplied: string[];
  message: string;
}

const CHAIN_LINK_DOC_TYPES = new Set<TitleReportDocument['documentType']>([
  'sale_deed', 'gift_deed', 'partition_deed', 'will',
]);
const REVENUE_RECORD_DOC_TYPES = new Set<TitleReportDocument['documentType']>([
  'patta', 'chitta', 'adangal', 'khata', 'rtc', 'seven_twelve', 'mutation',
]);

function mapLinkTypeFromDocType(t: TitleReportDocument['documentType']): TitleReportChainLink['linkType'] {
  if (t === 'sale_deed') return 'sale';
  if (t === 'gift_deed') return 'gift';
  if (t === 'partition_deed') return 'partition';
  if (t === 'will') return 'will';
  return 'other';
}

async function applyDocumentExtraction(
  firmId: string, id: string, docId: string, userId: string, actorEmail: string, roleName: string | null,
): Promise<ApplyExtractionOutcome> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);

  // Load the document row to read document_type + extracted_payload.
  const sql = db();
  let docType: TitleReportDocument['documentType'] | null = null;
  let payload: Record<string, unknown> = {};
  if (!sql) {
    const doc = memDocuments.find((d) => d.id === docId && d.titleReportId === id);
    if (!doc) throw new TitleReportError(404, 'document_not_found', 'Document not found');
    docType = doc.documentType;
    payload = doc.extractedPayload ?? {};
  } else {
    const [row] = await sql<{ document_type: TitleReportDocument['documentType']; extracted_payload: Record<string, unknown> | string }[]>`
      select document_type, extracted_payload
      from title_report_documents
      where id = ${docId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
      limit 1
    `;
    if (!row) throw new TitleReportError(404, 'document_not_found', 'Document not found');
    docType = row.document_type;
    payload = typeof row.extracted_payload === 'string'
      ? (safeParse<Record<string, unknown>>(row.extracted_payload) ?? {})
      : (row.extracted_payload ?? {});
  }

  // Strip internal _confidence marker the extractor injects.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!k.startsWith('_') && v != null && String(v).trim() !== '') clean[k] = v;
  }

  if (Object.keys(clean).length === 0) {
    return { applied: 'none', fieldsApplied: [], message: 'Nothing to apply — extraction has no fields to use.' };
  }

  // ---- Chain-link route -------------------------------------------------
  if (CHAIN_LINK_DOC_TYPES.has(docType!)) {
    // Allocate the next sequence number for the chain.
    const existingLinks = sql
      ? (await sql<{ max_seq: number }[]>`
          select coalesce(max(sequence_no), 0)::int as max_seq
          from title_report_chain_links
          where title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
        `)[0]?.max_seq ?? 0
      : memChainLinks.filter((l) => l.titleReportId === id).reduce((m, l) => Math.max(m, l.sequenceNo), 0);

    const linkDto: ChainLinkDto = {
      sequenceNo: existingLinks + 1,
      linkType: mapLinkTypeFromDocType(docType!),
      transferor: typeof clean.transferor === 'string' ? clean.transferor : '',
      transferee: typeof clean.transferee === 'string' ? clean.transferee : '',
      ...(typeof clean.documentDate === 'string' ? { documentDate: clean.documentDate } : {}),
      ...(typeof clean.documentNo === 'string' ? { documentNo: clean.documentNo } : {}),
      ...(typeof clean.sroOffice === 'string' ? { sroOffice: clean.sroOffice } : {}),
      ...(typeof clean.bookNo === 'string' ? { bookNo: clean.bookNo } : {}),
      ...(typeof clean.volumeNo === 'string' ? { volumeNo: clean.volumeNo } : {}),
      ...(typeof clean.pages === 'string' ? { pages: clean.pages } : {}),
      ...(typeof clean.stampDutyPaid === 'number' ? { stampDutyPaid: clean.stampDutyPaid } : {}),
      ...(typeof clean.consideration === 'number' ? { consideration: clean.consideration } : {}),
    };
    const created = await addChainLink(firmId, id, userId, actorEmail, roleName, linkDto);
    await writeAudit(userId, actorEmail, 'title_report.update', id, {
      kind: 'extraction.applied', documentId: docId, target: 'chain_link', chainLinkId: created.id,
    });
    return {
      applied: 'chain_link',
      chainLinkId: created.id,
      fieldsApplied: Object.keys(clean),
      message: `Created chain link #${created.sequenceNo} from extracted fields.`,
    };
  }

  // ---- EC route ---------------------------------------------------------
  if (docType === 'ec') {
    const txs = Array.isArray(clean.transactions) ? clean.transactions as Array<Record<string, unknown>> : [];
    const ecForm = typeof clean.ecForm === 'string' ? clean.ecForm as TitleReportEncumbrance['ecForm'] : null;
    const ecOffice = typeof clean.ecOffice === 'string' ? clean.ecOffice : null;
    const ecPeriodFrom = typeof clean.ecPeriodFrom === 'string' ? clean.ecPeriodFrom : null;
    const ecPeriodTo = typeof clean.ecPeriodTo === 'string' ? clean.ecPeriodTo : null;
    const ids: string[] = [];
    // If no per-transaction rows surfaced, drop one summary row carrying the EC header data.
    if (txs.length === 0) {
      const created = await addEncumbrance(firmId, id, userId, actorEmail, roleName, {
        ...(ecPeriodFrom ? { ecPeriodFrom } : {}),
        ...(ecPeriodTo ? { ecPeriodTo } : {}),
        ...(ecOffice ? { ecOffice } : {}),
        ...(ecForm ? { ecForm } : {}),
      });
      ids.push(created.id);
    } else {
      for (const t of txs) {
        const created = await addEncumbrance(firmId, id, userId, actorEmail, roleName, {
          ...(ecPeriodFrom ? { ecPeriodFrom } : {}),
          ...(ecPeriodTo ? { ecPeriodTo } : {}),
          ...(ecOffice ? { ecOffice } : {}),
          ...(ecForm ? { ecForm } : {}),
          ...(typeof t.transactionNo === 'string' ? { transactionNo: t.transactionNo } : {}),
          ...(typeof t.transactionDate === 'string' ? { transactionDate: t.transactionDate } : {}),
          ...(typeof t.transactionType === 'string' ? { transactionType: t.transactionType } : {}),
          ...(typeof t.parties === 'string' ? { parties: t.parties } : {}),
          ...(typeof t.consideration === 'number' ? { consideration: t.consideration } : {}),
        });
        ids.push(created.id);
      }
    }
    await writeAudit(userId, actorEmail, 'title_report.update', id, {
      kind: 'extraction.applied', documentId: docId, target: 'encumbrance', encumbranceIds: ids,
    });
    return {
      applied: 'encumbrance',
      encumbranceIds: ids,
      fieldsApplied: Object.keys(clean),
      message: `Added ${ids.length} encumbrance row(s) from EC extraction.`,
    };
  }

  // ---- Revenue record route -> merge into property.jurisdiction_specific
  if (REVENUE_RECORD_DOC_TYPES.has(docType!)) {
    // Read existing property to preserve fields the user already entered. If
    // the property block doesn't exist yet (typical when the user uploads
    // the patta / khata before opening the Property step), bootstrap one with
    // an empty address so the extracted revenue keys have somewhere to land;
    // the user fills the real address in the Property step afterwards.
    let existingProperty: TitleReportProperty | null = null;
    if (!sql) {
      existingProperty = memProperty.get(id) ?? null;
    } else {
      const [r] = await sql<PropertyRow[]>`
        select * from title_report_properties
        where title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
        limit 1
      `;
      existingProperty = r ? rowToProperty(r) : null;
    }

    const bootstrappingProperty = !existingProperty;

    // jurisdiction_specific = existing keys ∪ extracted keys (user wins).
    // Known jurisdiction-key names; the heuristic / AI extractor uses these
    // exact field names (patta_no, khata_no, etc.) keyed against the state.
    const KNOWN_JUR_KEYS = new Set<string>([
      'patta_no', 'chitta_no', 'adangal', 'a_register', 'fmb_sketch', 'tslr',
      'khata_no', 'rtc_no', 'mutation_no', 'tippani', 'akarbandh',
      'seven_twelve', 'eight_a', 'mutation_entries',
      'dharani', 'one_b', 'pahani', 'ror_1b', 'khasra', 'jamabandi',
      'thandaper', 'fard', 'satbara', 'ror',
    ]);

    const merged: Record<string, string | number | null> = { ...(existingProperty?.jurisdictionSpecific ?? {}) };
    const newKeys: string[] = [];

    // Map the AI's camelCase output keys (pattaNo, khataNo, …) to the
    // snake_case JSONB keys the wizard's JurisdictionFields renders against.
    const toSnake = (k: string): string =>
      k === 'pattaNo' ? 'patta_no' :
      k === 'chittaNo' ? 'chitta_no' :
      k === 'khataNo' ? 'khata_no' :
      k === 'rtcNo' ? 'rtc_no' :
      k === 'mutationNo' ? 'mutation_no' :
      k === 'seven_twelve' ? 'seven_twelve' :
      k === 'ownerName' ? 'owner_name' :
      k === 'extent' ? 'extent_recital' :
      k;

    for (const [rawK, v] of Object.entries(clean)) {
      if (v == null) continue;
      const k = toSnake(rawK);
      // Restrict to either known jurisdiction keys or any snake_case-shaped
      // key (so a state-specific field we haven't enumerated still lands).
      if (!KNOWN_JUR_KEYS.has(k) && !/^[a-z][a-z0-9_]*$/.test(k)) continue;
      if (merged[k] == null || merged[k] === '') {
        merged[k] = typeof v === 'number' ? v : String(v);
        newKeys.push(k);
      }
    }

    const updated = await upsertProperty(firmId, id, userId, actorEmail, roleName, {
      address: existingProperty?.address ?? '',
      ...(existingProperty?.surveyNo ? { surveyNo: existingProperty.surveyNo } : {}),
      ...(existingProperty?.subDivision ? { subDivision: existingProperty.subDivision } : {}),
      ...(existingProperty?.extentValue != null ? { extentValue: existingProperty.extentValue } : {}),
      ...(existingProperty?.extentUnit ? { extentUnit: existingProperty.extentUnit } : {}),
      ...(existingProperty?.boundaryNorth ? { boundaryNorth: existingProperty.boundaryNorth } : {}),
      ...(existingProperty?.boundarySouth ? { boundarySouth: existingProperty.boundarySouth } : {}),
      ...(existingProperty?.boundaryEast ? { boundaryEast: existingProperty.boundaryEast } : {}),
      ...(existingProperty?.boundaryWest ? { boundaryWest: existingProperty.boundaryWest } : {}),
      ...(existingProperty?.scheduleA ? { scheduleA: existingProperty.scheduleA } : {}),
      jurisdictionSpecific: merged,
    });
    await writeAudit(userId, actorEmail, 'title_report.update', id, {
      kind: 'extraction.applied', documentId: docId, target: 'property',
      propertyId: updated.id, newKeys, bootstrapped: bootstrappingProperty,
    });
    return {
      applied: 'property',
      propertyId: updated.id,
      fieldsApplied: newKeys,
      message: bootstrappingProperty
        ? `Created the property block and seeded ${newKeys.length} revenue-record field(s)${newKeys.length ? ': ' + newKeys.join(', ') : ''}. Open the Property step to add the address and boundaries.`
        : newKeys.length > 0
          ? `Merged ${newKeys.length} field(s) into the property's revenue-record block: ${newKeys.join(', ')}.`
          : 'No new fields applied — every revenue key was already set on the property.',
    };
  }

  return {
    applied: 'none',
    fieldsApplied: [],
    message: `Auto-apply isn't defined for "${docType}" yet — the extracted fields remain on the document.`,
  };
}

// ---- Encumbrances / Searches / Litigation / Approvals / Heirs -------------
//
// All follow the same pattern: assert role + scope, insert/update/delete,
// audit-log. The variants share enough shape that a single helper would just
// hide the type errors — we inline them.

async function addEncumbrance(
  firmId: string, id: string, userId: string, actorEmail: string, roleName: string | null, dto: EncumbranceDto,
): Promise<TitleReportEncumbrance> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const now = new Date().toISOString();
    const row: TitleReportEncumbrance = {
      id: crypto.randomUUID(),
      titleReportId: id,
      ecPeriodFrom: dto.ecPeriodFrom ?? null,
      ecPeriodTo: dto.ecPeriodTo ?? null,
      ecOffice: dto.ecOffice ?? null,
      ecForm: dto.ecForm ?? null,
      transactionNo: dto.transactionNo ?? null,
      transactionDate: dto.transactionDate ?? null,
      transactionType: dto.transactionType ?? null,
      parties: dto.parties ?? null,
      consideration: dto.consideration ?? null,
      status: dto.status ?? 'subsisting',
      dischargeDocRef: dto.dischargeDocRef ?? null,
      createdAt: now,
      updatedAt: now,
    };
    memEncumbrances.push(row);
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'encumbrance.add' });
    return row;
  }
  const [row] = await sql<EncumbranceRow[]>`
    insert into title_report_encumbrances
      (title_report_id, firm_id, ec_period_from, ec_period_to, ec_office, ec_form,
       transaction_no, transaction_date, transaction_type, parties, consideration,
       status, discharge_doc_ref)
    values
      (${id}::uuid, ${firmId}::uuid,
       ${dto.ecPeriodFrom ?? null}::date, ${dto.ecPeriodTo ?? null}::date,
       ${dto.ecOffice ?? null}, ${dto.ecForm ?? null},
       ${dto.transactionNo ?? null}, ${dto.transactionDate ?? null}::date,
       ${dto.transactionType ?? null}, ${dto.parties ?? null}, ${dto.consideration ?? null},
       ${dto.status ?? 'subsisting'}, ${dto.dischargeDocRef ?? null})
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'encumbrance_insert_failed', 'Encumbrance insert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'encumbrance.add' });
  return rowToEncumbrance(row);
}

async function patchEncumbrance(
  firmId: string, id: string, encId: string, userId: string, actorEmail: string, roleName: string | null,
  patch: Partial<EncumbranceDto>,
): Promise<TitleReportEncumbrance> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const idx = memEncumbrances.findIndex((e) => e.id === encId && e.titleReportId === id);
    if (idx < 0) throw new TitleReportError(404, 'encumbrance_not_found', 'Encumbrance not found');
    memEncumbrances[idx] = { ...memEncumbrances[idx], ...stripUndef(patch as Record<string, unknown>), updatedAt: new Date().toISOString() } as TitleReportEncumbrance;
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'encumbrance.patch' });
    return memEncumbrances[idx];
  }
  const [row] = await sql<EncumbranceRow[]>`
    update title_report_encumbrances set
      ec_period_from   = case when ${patch.ecPeriodFrom === undefined ? 1 : 0} = 1 then ec_period_from else ${patch.ecPeriodFrom ?? null}::date end,
      ec_period_to     = case when ${patch.ecPeriodTo === undefined ? 1 : 0} = 1 then ec_period_to else ${patch.ecPeriodTo ?? null}::date end,
      ec_office        = case when ${patch.ecOffice === undefined ? 1 : 0} = 1 then ec_office else ${patch.ecOffice ?? null} end,
      ec_form          = case when ${patch.ecForm === undefined ? 1 : 0} = 1 then ec_form else ${patch.ecForm ?? null} end,
      transaction_no   = case when ${patch.transactionNo === undefined ? 1 : 0} = 1 then transaction_no else ${patch.transactionNo ?? null} end,
      transaction_date = case when ${patch.transactionDate === undefined ? 1 : 0} = 1 then transaction_date else ${patch.transactionDate ?? null}::date end,
      transaction_type = case when ${patch.transactionType === undefined ? 1 : 0} = 1 then transaction_type else ${patch.transactionType ?? null} end,
      parties          = case when ${patch.parties === undefined ? 1 : 0} = 1 then parties else ${patch.parties ?? null} end,
      consideration    = case when ${patch.consideration === undefined ? 1 : 0} = 1 then consideration else ${patch.consideration ?? null} end,
      status           = coalesce(${patch.status ?? null}, status),
      discharge_doc_ref = case when ${patch.dischargeDocRef === undefined ? 1 : 0} = 1 then discharge_doc_ref else ${patch.dischargeDocRef ?? null} end,
      updated_at       = now()
    where id = ${encId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
    returning *
  `;
  if (!row) throw new TitleReportError(404, 'encumbrance_not_found', 'Encumbrance not found');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'encumbrance.patch' });
  return rowToEncumbrance(row);
}

async function deleteEncumbrance(
  firmId: string, id: string, encId: string, userId: string, actorEmail: string, roleName: string | null,
): Promise<void> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    memEncumbrances = memEncumbrances.filter((e) => !(e.id === encId && e.titleReportId === id));
  } else {
    await sql`
      delete from title_report_encumbrances
      where id = ${encId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
    `;
  }
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'encumbrance.delete', encId });
}

async function addSearch(
  firmId: string, id: string, userId: string, actorEmail: string, roleName: string | null, dto: SearchEntryDto,
): Promise<TitleReportSearch> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const now = new Date().toISOString();
    const row: TitleReportSearch = {
      id: crypto.randomUUID(),
      titleReportId: id,
      searchType: dto.searchType,
      searchOffice: dto.searchOffice ?? null,
      searchQuery: dto.searchQuery ?? null,
      searchDate: dto.searchDate ?? null,
      resultSummary: dto.resultSummary ?? null,
      resultNegative: !!dto.resultNegative,
      attachmentRef: dto.attachmentRef ?? null,
      createdAt: now,
      updatedAt: now,
    };
    memSearches.push(row);
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'search.add' });
    return row;
  }
  const [row] = await sql<SearchRow[]>`
    insert into title_report_searches
      (title_report_id, firm_id, search_type, search_office, search_query,
       search_date, result_summary, result_negative, attachment_ref)
    values
      (${id}::uuid, ${firmId}::uuid, ${dto.searchType},
       ${dto.searchOffice ?? null}, ${dto.searchQuery ?? null},
       ${dto.searchDate ?? null}::date, ${dto.resultSummary ?? null},
       ${!!dto.resultNegative}, ${dto.attachmentRef ?? null})
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'search_insert_failed', 'Search insert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'search.add' });
  return rowToSearch(row);
}

async function addLitigation(
  firmId: string, id: string, userId: string, actorEmail: string, roleName: string | null, dto: LitigationEntryDto,
): Promise<TitleReportLitigation> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const now = new Date().toISOString();
    const row: TitleReportLitigation = {
      id: crypto.randomUUID(),
      titleReportId: id,
      court: dto.court ?? null,
      caseNumber: dto.caseNumber ?? null,
      parties: dto.parties ?? null,
      causeOfAction: dto.causeOfAction ?? null,
      stage: dto.stage ?? null,
      relevance: dto.relevance ?? 'none',
      nextDate: dto.nextDate ?? null,
      notes: dto.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    memLitigation.push(row);
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'litigation.add' });
    return row;
  }
  const [row] = await sql<LitigationRow[]>`
    insert into title_report_litigation
      (title_report_id, firm_id, court, case_number, parties, cause_of_action,
       stage, relevance, next_date, notes)
    values
      (${id}::uuid, ${firmId}::uuid,
       ${dto.court ?? null}, ${dto.caseNumber ?? null}, ${dto.parties ?? null},
       ${dto.causeOfAction ?? null}, ${dto.stage ?? null},
       ${dto.relevance ?? 'none'}, ${dto.nextDate ?? null}::date, ${dto.notes ?? null})
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'litigation_insert_failed', 'Litigation insert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'litigation.add' });
  return rowToLitigation(row);
}

async function addApproval(
  firmId: string, id: string, userId: string, actorEmail: string, roleName: string | null, dto: StatutoryApprovalDto,
): Promise<TitleReportStatutoryApproval> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const now = new Date().toISOString();
    const row: TitleReportStatutoryApproval = {
      id: crypto.randomUUID(),
      titleReportId: id,
      approvalType: dto.approvalType,
      authority: dto.authority ?? null,
      referenceNo: dto.referenceNo ?? null,
      issueDate: dto.issueDate ?? null,
      validity: dto.validity ?? null,
      status: dto.status ?? 'valid',
      createdAt: now,
      updatedAt: now,
    };
    memApprovals.push(row);
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'approval.add' });
    return row;
  }
  const [row] = await sql<ApprovalRow[]>`
    insert into title_report_statutory_approvals
      (title_report_id, firm_id, approval_type, authority, reference_no,
       issue_date, validity, status)
    values
      (${id}::uuid, ${firmId}::uuid, ${dto.approvalType},
       ${dto.authority ?? null}, ${dto.referenceNo ?? null},
       ${dto.issueDate ?? null}::date, ${dto.validity ?? null},
       ${dto.status ?? 'valid'})
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'approval_insert_failed', 'Approval insert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'approval.add' });
  return rowToApproval(row);
}

async function deleteApproval(
  firmId: string, id: string, apId: string, userId: string, actorEmail: string, roleName: string | null,
): Promise<void> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    memApprovals = memApprovals.filter((a) => !(a.id === apId && a.titleReportId === id));
  } else {
    await sql`
      delete from title_report_statutory_approvals
      where id = ${apId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
    `;
  }
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'approval.delete', apId });
}

async function deleteLitigation(
  firmId: string, id: string, litId: string, userId: string, actorEmail: string, roleName: string | null,
): Promise<void> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    memLitigation = memLitigation.filter((l) => !(l.id === litId && l.titleReportId === id));
  } else {
    await sql`
      delete from title_report_litigation
      where id = ${litId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
    `;
  }
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'litigation.delete', litId });
}

async function addHeir(
  firmId: string, id: string, userId: string, actorEmail: string, roleName: string | null, dto: HeirDto,
): Promise<TitleReportHeir> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const now = new Date().toISOString();
    const row: TitleReportHeir = {
      id: crypto.randomUUID(),
      titleReportId: id,
      predecessorName: dto.predecessorName,
      predecessorDod: dto.predecessorDod ?? null,
      personalLaw: dto.personalLaw ?? 'hindu',
      heirName: dto.heirName,
      relationship: dto.relationship ?? null,
      share: dto.share ?? null,
      consentStatus: dto.consentStatus ?? 'pending',
      createdAt: now,
      updatedAt: now,
    };
    memHeirs.push(row);
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'heir.add' });
    return row;
  }
  const [row] = await sql<HeirRow[]>`
    insert into title_report_heirs
      (title_report_id, firm_id, predecessor_name, predecessor_dod, personal_law,
       heir_name, relationship, share, consent_status)
    values
      (${id}::uuid, ${firmId}::uuid, ${dto.predecessorName},
       ${dto.predecessorDod ?? null}::date, ${dto.personalLaw ?? 'hindu'},
       ${dto.heirName}, ${dto.relationship ?? null}, ${dto.share ?? null},
       ${dto.consentStatus ?? 'pending'})
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'heir_insert_failed', 'Heir insert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'heir.add' });
  return rowToHeir(row);
}

// ---- Defects (ack / dismiss / edit + bulk import from AI) -----------------

async function addManualDefect(
  firmId: string, id: string, userId: string, actorEmail: string, roleName: string | null, dto: ManualDefectDto,
): Promise<TitleReportDefect> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  const refsJson = JSON.stringify(dto.refs ?? []);
  if (!sql) {
    const now = new Date().toISOString();
    const row: TitleReportDefect = {
      id: crypto.randomUUID(),
      titleReportId: id,
      category: dto.category,
      severity: dto.severity,
      description: dto.description,
      recommendation: dto.recommendation ?? null,
      source: 'advocate',
      refs: dto.refs ?? [],
      acknowledgedBy: null,
      acknowledgedAt: null,
      dismissed: false,
      dismissedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    memDefects.push(row);
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'defect.add', source: 'advocate' });
    return row;
  }
  const [row] = await sql<DefectRow[]>`
    insert into title_report_defects
      (title_report_id, firm_id, category, severity, description, recommendation, source, refs)
    values
      (${id}::uuid, ${firmId}::uuid, ${dto.category}, ${dto.severity},
       ${dto.description}, ${dto.recommendation ?? null}, 'advocate', ${refsJson}::jsonb)
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'defect_insert_failed', 'Defect insert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'defect.add', source: 'advocate' });
  return rowToDefect(row);
}

async function applyDefectAck(
  firmId: string, id: string, defectId: string, userId: string, actorEmail: string, roleName: string | null,
  dto: DefectAckDto,
): Promise<TitleReportDefect> {
  assertRoleCan(roleName, 'edit');
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const idx = memDefects.findIndex((d) => d.id === defectId && d.titleReportId === id);
    if (idx < 0) throw new TitleReportError(404, 'defect_not_found', 'Defect not found');
    const cur = memDefects[idx]!;
    const next: TitleReportDefect = { ...cur };
    if (dto.action === 'ack') {
      next.acknowledgedBy = userId;
      next.acknowledgedAt = new Date().toISOString();
      next.dismissed = false;
    } else if (dto.action === 'dismiss') {
      next.dismissed = true;
      next.dismissedReason = dto.reason ?? null;
    } else {
      if (dto.description !== undefined) next.description = dto.description;
      if (dto.recommendation !== undefined) next.recommendation = dto.recommendation;
      if (dto.severity !== undefined) next.severity = dto.severity;
    }
    next.updatedAt = new Date().toISOString();
    memDefects[idx] = next;
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'defect.ack', defectId, action: dto.action });
    return next;
  }
  if (dto.action === 'ack') {
    const [row] = await sql<DefectRow[]>`
      update title_report_defects set
        acknowledged_by = ${userId}::uuid,
        acknowledged_at = now(),
        dismissed       = false,
        updated_at      = now()
      where id = ${defectId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
      returning *
    `;
    if (!row) throw new TitleReportError(404, 'defect_not_found', 'Defect not found');
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'defect.ack', defectId });
    return rowToDefect(row);
  }
  if (dto.action === 'dismiss') {
    const [row] = await sql<DefectRow[]>`
      update title_report_defects set
        dismissed        = true,
        dismissed_reason = ${dto.reason ?? null},
        updated_at       = now()
      where id = ${defectId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
      returning *
    `;
    if (!row) throw new TitleReportError(404, 'defect_not_found', 'Defect not found');
    await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'defect.dismiss', defectId, reason: dto.reason ?? null });
    return rowToDefect(row);
  }
  // 'edit'
  const [row] = await sql<DefectRow[]>`
    update title_report_defects set
      description    = coalesce(${dto.description ?? null}, description),
      recommendation = case when ${dto.recommendation === undefined ? 1 : 0} = 1 then recommendation else ${dto.recommendation ?? null} end,
      severity       = coalesce(${dto.severity ?? null}, severity),
      updated_at     = now()
    where id = ${defectId}::uuid and title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid
    returning *
  `;
  if (!row) throw new TitleReportError(404, 'defect_not_found', 'Defect not found');
  await writeAudit(userId, actorEmail, 'title_report.update', id, { kind: 'defect.edit', defectId });
  return rowToDefect(row);
}

/** Replace all AI-source defects in one shot. Called by the AI service when
 *  a defects-analysis run completes — manual / acknowledged defects are
 *  preserved; the AI-flagged rows are wiped and re-inserted so re-runs
 *  don't accumulate duplicates. */
async function replaceAiDefects(
  firmId: string,
  id: string,
  defects: Array<Omit<ManualDefectDto, never> & { source?: 'ai' }>,
  userId?: string,
  actorEmail?: string,
): Promise<void> {
  const sql = db();
  let removedCount = 0;
  if (!sql) {
    const before = memDefects.length;
    memDefects = memDefects.filter((d) => !(d.titleReportId === id && d.source === 'ai'));
    removedCount = before - memDefects.length;
    const now = new Date().toISOString();
    for (const d of defects) {
      memDefects.push({
        id: crypto.randomUUID(),
        titleReportId: id,
        category: d.category,
        severity: d.severity,
        description: d.description,
        recommendation: d.recommendation ?? null,
        source: 'ai',
        refs: d.refs ?? [],
        acknowledgedBy: null,
        acknowledgedAt: null,
        dismissed: false,
        dismissedReason: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  } else {
    await sql.begin(async (tx) => {
      const deleted = await tx<Array<{ id: string }>>`
        delete from title_report_defects
        where title_report_id = ${id}::uuid and firm_id = ${firmId}::uuid and source = 'ai'
        returning id
      `;
      removedCount = deleted.length;
      for (const d of defects) {
        await tx`
          insert into title_report_defects
            (title_report_id, firm_id, category, severity, description, recommendation, source, refs)
          values
            (${id}::uuid, ${firmId}::uuid, ${d.category}, ${d.severity},
             ${d.description}, ${d.recommendation ?? null}, 'ai',
             ${JSON.stringify(d.refs ?? [])}::jsonb)
        `;
      }
    });
  }
  // Audit the replacement so compliance reviewers can see when AI-sourced
  // defects were wiped and what replaced them. Manual/advocate defects are
  // never touched.
  if (userId) {
    await writeAudit(userId, actorEmail ?? 'system', 'title_report.update', id, {
      kind: 'defects.ai_replace',
      removed: removedCount,
      inserted: defects.length,
    });
  }
}

// ---- State machine + completeness gates -----------------------------------

const VALID_TRANSITIONS: Record<TitleReportStatus, TitleReportStatus[]> = {
  draft:      ['in_review', 'withdrawn'],
  in_review:  ['draft', 'finalised', 'withdrawn'],
  finalised:  ['in_review', 'issued', 'withdrawn'],
  issued:     ['withdrawn'],
  withdrawn:  [],
};

interface CompletenessCheck { ok: boolean; missing: string[] }

async function assertCanTransition(
  firmId: string, id: string, from: TitleReportStatus, to: TitleReportStatus,
): Promise<void> {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new TitleReportTransitionError(
      `Cannot transition ${from} → ${to}`,
      { from, to, allowed },
    );
  }
  if (to === 'in_review') {
    const check = await checkInReviewReadiness(firmId, id);
    if (!check.ok) {
      throw new TitleReportTransitionError(
        'Not ready for review',
        { missing: check.missing },
      );
    }
  }
  if (to === 'finalised') {
    const check = await checkFinaliseReadiness(firmId, id);
    if (!check.ok) {
      throw new TitleReportTransitionError(
        'Not ready to finalise',
        { missing: check.missing },
      );
    }
  }
  if (to === 'issued') {
    const check = await checkIssueReadiness(firmId, id);
    if (!check.ok) {
      throw new TitleReportTransitionError(
        'Not ready to issue',
        { missing: check.missing },
      );
    }
  }
}

async function checkInReviewReadiness(firmId: string, id: string): Promise<CompletenessCheck> {
  const full = await getFull(firmId, id);
  const missing: string[] = [];
  if (!full.property || !full.property.address) missing.push('property block');
  if (full.chainLinks.length < 1) missing.push('at least one chain link');
  if (full.encumbrances.length < 1) missing.push('at least one EC row');
  if (full.searches.length < 1) missing.push('at least one search entry');
  if (full.opinionVerdict === 'pending') missing.push('opinion verdict');
  return { ok: missing.length === 0, missing };
}

async function checkFinaliseReadiness(firmId: string, id: string): Promise<CompletenessCheck> {
  const full = await getFull(firmId, id);
  const missing: string[] = [];
  const openBlockers = full.defects.filter(
    (d) => d.severity === 'blocker' && !d.dismissed && !d.acknowledgedAt,
  );
  if (openBlockers.length > 0) {
    missing.push(`${openBlockers.length} unresolved blocker defect(s)`);
  }
  if (!full.opinionSummary || full.opinionSummary.trim() === '') {
    missing.push('opinion summary');
  }
  if (full.opinionVerdict === 'pending') {
    missing.push('opinion verdict');
  }
  return { ok: missing.length === 0, missing };
}

async function checkIssueReadiness(firmId: string, id: string): Promise<CompletenessCheck> {
  const full = await getFull(firmId, id);
  const missing: string[] = [];
  if (full.status !== 'finalised') missing.push('report must be finalised first');
  if (full.exports.filter((e) => e.format === 'pdf').length < 1) {
    missing.push('PDF export must be generated');
  }
  return { ok: missing.length === 0, missing };
}

async function transition(
  firmId: string, id: string, userId: string, actorEmail: string, roleName: string | null,
  to: TitleReportStatus, reason?: string,
): Promise<TitleReport> {
  assertRoleCan(roleName, `transition.${to}` as TitleReportAction);
  const row = await findById(firmId, id);
  if (!row) throw new TitleReportNotFound(id);
  await assertCanTransition(firmId, id, row.status, to);
  const sql = db();
  if (!sql) {
    const idx = memReports.findIndex((r) => r.id === id);
    if (idx < 0) throw new TitleReportNotFound(id);
    const cur = memReports[idx]!;
    const now = new Date().toISOString();
    const next: TitleReport = {
      ...cur,
      status: to,
      finalisedAt: to === 'finalised' ? now : cur.finalisedAt,
      issuedAt: to === 'issued' ? now : cur.issuedAt,
      updatedAt: now,
    };
    memReports[idx] = next;
    await writeAudit(userId, actorEmail, 'title_report.transition', id, { from: row.status, to, reason: reason ?? null });
    return next;
  }
  const [updated] = await sql<TitleReportRow[]>`
    update title_reports
    set status        = ${to}::title_report_status,
        finalised_at  = case when ${to} = 'finalised' and finalised_at is null then now() else finalised_at end,
        issued_at     = case when ${to} = 'issued' and issued_at is null then now() else issued_at end,
        updated_at    = now()
    where id = ${id}::uuid and firm_id = ${firmId}::uuid
    returning *
  `;
  if (!updated) throw new TitleReportNotFound(id);
  await writeAudit(userId, actorEmail, 'title_report.transition', id, { from: row.status, to, reason: reason ?? null });
  return rowToHeader(updated);
}

/** Soft-delete = transition to 'withdrawn'. The row stays in the table so it
 *  remains queryable via list-with-status-filter (acceptance test §9.8). */
async function softDelete(
  firmId: string, id: string, userId: string, actorEmail: string, roleName: string | null, reason?: string,
): Promise<TitleReport> {
  return transition(firmId, id, userId, actorEmail, roleName, 'withdrawn', reason);
}

// ---- Quota (Solo: 2 reports / billing cycle) ------------------------------

async function quotaStatus(firmId: string): Promise<TitleReportQuotaStatus> {
  const sql = db();
  if (!sql) {
    const { start, end } = utcMonthBounds();
    const used = memReports.filter(
      (r) => r.firmId === firmId
        && new Date(r.createdAt) >= start
        && new Date(r.createdAt) < end,
    ).length;
    const cap = DEMO_QUOTA_CAP.Solo;
    return {
      cap, used, remaining: Math.max(0, cap - used),
      cycleStart: start.toISOString(), cycleEnd: end.toISOString(),
      planTier: 'Solo',
    };
  }
  // The per-firm Solo cap was retired in favour of the shared AI quota
  // (ai-quota.service); we no longer enforce a separate title-report cap.
  // This query is kept for back-compat with the GET /quota route + the
  // historical wizard "X used this cycle" chip, but always reports an
  // effectively-unlimited cap. The plan_title_report_caps table is dropped
  // in migration 0052.
  const [row] = await sql<{ cycle_start: Date; cycle_end: Date; plan_tier: 'Solo' | 'Practice' | 'Firm' | null; used: number }[]>`
    with firm as (
      select plan_tier, renews_at from firms where id = ${firmId}::uuid limit 1
    ),
    bounds as (
      select
        case when (select renews_at from firm) is null
             then date_trunc('month', now())
             else ((select renews_at from firm) - interval '1 month')::timestamptz end as cycle_start,
        case when (select renews_at from firm) is null
             then (date_trunc('month', now()) + interval '1 month')
             else ((select renews_at from firm))::timestamptz end as cycle_end,
        (select plan_tier from firm) as plan_tier
    )
    select b.cycle_start, b.cycle_end, b.plan_tier,
      (select count(*)::int from title_reports
        where firm_id = ${firmId}::uuid
          and created_at >= b.cycle_start and created_at < b.cycle_end
          and status <> 'withdrawn') as used
    from bounds b
  `;
  const UNLIMITED = 999_999;
  const used = Number(row?.used ?? 0);
  return {
    cap: UNLIMITED, used, remaining: UNLIMITED - used,
    cycleStart: row?.cycle_start instanceof Date ? row.cycle_start.toISOString() : String(row?.cycle_start ?? new Date().toISOString()),
    cycleEnd: row?.cycle_end instanceof Date ? row.cycle_end.toISOString() : String(row?.cycle_end ?? new Date().toISOString()),
    planTier: row?.plan_tier ?? null,
  };
}

async function assertQuotaOk(firmId: string): Promise<void> {
  const status = await quotaStatus(firmId);
  if (status.used >= status.cap) {
    throw new TitleReportQuotaExceeded(status);
  }
}

function utcMonthBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

// ---- Internal helpers -----------------------------------------------------

async function assertReportInFirm(firmId: string, id: string): Promise<void> {
  const row = await findById(firmId, id);
  if (!row) throw new TitleReportNotFound(id);
}

async function writeAudit(
  userId: string, actorEmail: string,
  action: Parameters<typeof auditService.write>[0]['action'],
  targetId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await auditService.write({
      actorUserId: userId,
      actorEmail,
      action,
      targetType: 'title_report',
      targetId,
      payload,
    });
  } catch (err) {
    logger.warn({ err, action, targetId }, 'title-report audit write failed');
  }
}

// ---- AI run plumbing ------------------------------------------------------
//
// The AI service (commit 5) calls these to persist run metadata. Exposing
// the inserter/updater here keeps the AI service free of postgres specifics
// and gives every AI call a single place to audit-log.

interface AiRunStart {
  runType: 'defects_analysis' | 'opinion_synthesis';
  model: string | null;
  provider: string | null;
  inputHash: string;
  createdBy: string;
}

async function startAiRun(firmId: string, id: string, input: AiRunStart): Promise<string> {
  await assertReportInFirm(firmId, id);
  const sql = db();
  const runId = crypto.randomUUID();
  if (!sql) {
    memAiRuns.push({
      id: runId,
      titleReportId: id,
      runType: input.runType,
      model: input.model,
      provider: input.provider,
      inputHash: input.inputHash,
      output: {},
      status: 'running',
      error: null,
      tokensIn: null,
      tokensOut: null,
      durationMs: null,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
    return runId;
  }
  await sql`
    insert into title_report_ai_runs
      (id, title_report_id, firm_id, run_type, model, provider, input_hash, status, created_by)
    values
      (${runId}::uuid, ${id}::uuid, ${firmId}::uuid,
       ${input.runType}, ${input.model}, ${input.provider}, ${input.inputHash},
       'running', ${input.createdBy}::uuid)
  `;
  return runId;
}

async function finishAiRun(
  firmId: string,
  runId: string,
  result: { output: Record<string, unknown>; tokensIn?: number; tokensOut?: number; durationMs?: number },
): Promise<void> {
  const sql = db();
  if (!sql) {
    const r = memAiRuns.find((x) => x.id === runId);
    if (r) {
      r.output = result.output;
      r.status = 'done';
      r.tokensIn = result.tokensIn ?? null;
      r.tokensOut = result.tokensOut ?? null;
      r.durationMs = result.durationMs ?? null;
      r.completedAt = new Date().toISOString();
    }
    return;
  }
  await sql`
    update title_report_ai_runs set
      status       = 'done',
      output       = ${JSON.stringify(result.output)}::jsonb,
      tokens_in    = ${result.tokensIn ?? null},
      tokens_out   = ${result.tokensOut ?? null},
      duration_ms  = ${result.durationMs ?? null},
      completed_at = now()
    where id = ${runId}::uuid and firm_id = ${firmId}::uuid
  `;
}

async function failAiRun(firmId: string, runId: string, error: string): Promise<void> {
  const sql = db();
  if (!sql) {
    const r = memAiRuns.find((x) => x.id === runId);
    if (r) { r.status = 'failed'; r.error = error; r.completedAt = new Date().toISOString(); }
    return;
  }
  await sql`
    update title_report_ai_runs set
      status = 'failed', error = ${error}, completed_at = now()
    where id = ${runId}::uuid and firm_id = ${firmId}::uuid
  `;
}

/** Count AI runs of a given type for a report in the last `windowSec` seconds.
 *  Used to rate-limit re-runs of defect analysis (LLM calls cost tokens). */
async function countRecentAiRuns(
  firmId: string,
  id: string,
  runType: 'defects_analysis' | 'opinion_synthesis',
  windowSec: number,
): Promise<number> {
  const cutoffMs = Date.now() - windowSec * 1000;
  const sql = db();
  if (!sql) {
    return memAiRuns.filter((r) =>
      r.titleReportId === id && r.runType === runType
      && new Date(r.createdAt).getTime() >= cutoffMs,
    ).length;
  }
  const [row] = await sql<Array<{ n: string }>>`
    select count(*)::text as n from title_report_ai_runs
    where firm_id = ${firmId}::uuid and title_report_id = ${id}::uuid
      and run_type = ${runType}
      and created_at >= ${new Date(cutoffMs).toISOString()}::timestamptz
  `;
  return Number(row?.n ?? 0);
}

async function getAiRun(firmId: string, runId: string): Promise<TitleReportAiRun | null> {
  const sql = db();
  if (!sql) {
    const r = memAiRuns.find((x) => x.id === runId);
    return r ?? null;
  }
  const [row] = await sql<AiRunRow[]>`
    select * from title_report_ai_runs
    where id = ${runId}::uuid and firm_id = ${firmId}::uuid
    limit 1
  `;
  return row ? rowToAiRun(row) : null;
}

// ---- Exports (record-keeping; PDF bytes generated on the web) -------------

async function recordExport(
  firmId: string, id: string, userId: string, actorEmail: string,
  input: { format: TitleReportExportFormat; letterheadId?: string | null; storageRef?: string | null; fileName?: string | null; fileMime?: string | null; fileSize?: number | null },
): Promise<TitleReportExport> {
  await assertReportInFirm(firmId, id);
  const sql = db();
  if (!sql) {
    const now = new Date().toISOString();
    const row: TitleReportExport = {
      id: crypto.randomUUID(),
      titleReportId: id,
      format: input.format,
      letterheadId: input.letterheadId ?? null,
      storageRef: input.storageRef ?? null,
      fileName: input.fileName ?? null,
      fileMime: input.fileMime ?? null,
      fileSize: input.fileSize ?? null,
      createdBy: userId,
      createdAt: now,
    };
    memExports.push(row);
    await writeAudit(userId, actorEmail, 'title_report.export', id, { format: input.format });
    return row;
  }
  const [row] = await sql<ExportRow[]>`
    insert into title_report_exports
      (title_report_id, firm_id, format, letterhead_id,
       storage_ref, file_name, file_mime, file_size, created_by)
    values
      (${id}::uuid, ${firmId}::uuid, ${input.format},
       ${input.letterheadId ?? null}::uuid,
       ${input.storageRef ?? null}, ${input.fileName ?? null},
       ${input.fileMime ?? null}, ${input.fileSize ?? null},
       ${userId}::uuid)
    returning *
  `;
  if (!row) throw new TitleReportError(500, 'export_insert_failed', 'Export insert returned no row');
  await writeAudit(userId, actorEmail, 'title_report.export', id, { format: input.format });
  return rowToExport(row);
}

// ---- Demo-mode in-memory stores -------------------------------------------
// Mirrors the per-table arrays the rest of the codebase uses for the
// no-DATABASE_URL path. Reset on process restart.

const memReports: TitleReport[] = [];
const memProperty = new Map<string, TitleReportProperty>();
let memChainLinks: TitleReportChainLink[] = [];
const memDocuments: TitleReportDocument[] = [];
let memEncumbrances: TitleReportEncumbrance[] = [];
const memSearches: TitleReportSearch[] = [];
let memLitigation: TitleReportLitigation[] = [];
let memApprovals: TitleReportStatutoryApproval[] = [];
const memHeirs: TitleReportHeir[] = [];
let memDefects: TitleReportDefect[] = [];
const memAiRuns: TitleReportAiRun[] = [];
const memExports: TitleReportExport[] = [];

// ---- Exported service surface ---------------------------------------------

export const titleReportsService = {
  // Header
  create, update, listForFirm, getFull, softDelete, transition,
  // Property
  upsertProperty,
  // Chain
  addChainLink, updateChainLink, deleteChainLink,
  // Documents
  addDocument, patchDocument, applyDocumentExtraction,
  // Encumbrances
  addEncumbrance, patchEncumbrance, deleteEncumbrance,
  // Searches / Litigation / Approvals / Heirs
  addSearch, addLitigation, deleteLitigation, addApproval, deleteApproval, addHeir,
  // Defects
  addManualDefect, applyDefectAck, replaceAiDefects,
  // AI runs
  startAiRun, finishAiRun, failAiRun, getAiRun, countRecentAiRuns,
  // Exports
  recordExport,
  // Quota
  quotaStatus, assertQuotaOk,
  // Role gate helper (used by tests / routes)
  isActionAllowedForRole,
};
