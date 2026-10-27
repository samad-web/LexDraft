import { db } from '../db/client';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors';
import { evaluateReadiness } from '../lib/efiling/readiness';
import {
  EFILED_STEP,
  PORTAL_STEPS_BY_KIND,
  TRACKED_STATUSES,
  type CnrCandidateDto,
  type EfilingFiling,
  type FilingDocument,
  type FilingEvent,
  type FilingKind,
  type FilingPayment,
  type FilingStatus,
  type PortalStepKey,
  type PortalStepState,
  type ReadinessReport,
  type TrackingStatus,
} from '../lib/efiling/types';
import { efilingParticularsService } from './efiling-particulars.service';

// =============================================================================
// efiling-filings.service
//
// One row per submission to the eFiling portal. The portal itself is driven
// by the advocate (Aadhaar eSign, oath video, ePay and final submit cannot be
// automated - see docs/efiling-selector-capture-todo.md §4), so DifAI's job
// is to (a) get the data and bundle ready, (b) record what happened on the
// portal - eFiling number, GRNs, objections - and (c) connect the case to
// eCourts once the court registers it (efiling-tracker.service.ts).
//
// Status machine (mirrors the portal, see lib/efiling/types.ts):
//   draft -> ready -> efiled -> submitted -> accepted -> registered
//     \______________/^            |  ^         |
//                                  v  |         v
//                               objected -> refiled
//   any open state -> withdrawn; scrutiny states -> rejected;
//   rejected/withdrawn -> draft
//
// efiled    = entered on the portal ("eFile Case" / IA added); eFiling no.
// submitted = final submit from Draft Pleadings with the GRN (IA: both OTP
//             authentications done, which submits it). Guarded: the kind's
//             required portal steps must be ticked off first.
// =============================================================================

type Sql = NonNullable<ReturnType<typeof db>>;

function need(): Sql {
  const sql = db();
  if (!sql) throw new BadRequestError('eFiling requires DATABASE_URL to be configured');
  return sql;
}

const TRANSITIONS: Record<FilingStatus, ReadonlyArray<FilingStatus>> = {
  draft: ['ready', 'efiled', 'withdrawn'],
  ready: ['draft', 'efiled', 'withdrawn'],
  efiled: ['submitted', 'withdrawn'],
  submitted: ['objected', 'accepted', 'registered', 'rejected', 'withdrawn'],
  objected: ['refiled', 'rejected', 'withdrawn'],
  refiled: ['objected', 'accepted', 'registered', 'rejected', 'withdrawn'],
  accepted: ['objected', 'registered'],
  registered: [],
  rejected: ['draft'],
  withdrawn: ['draft'],
};

export function canTransition(from: FilingStatus, to: FilingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

interface FilingRow {
  id: string;
  case_id: string;
  case_title: string;
  kind: FilingKind;
  title: string;
  status: FilingStatus;
  efiling_no: string | null;
  efiled_at: Date | null;
  submitted_at: Date | null;
  court_filing_no: string | null;
  court_filing_year: number | null;
  registration_no: string | null;
  cnr: string | null;
  registered_at: Date | null;
  objections: string | null;
  objections_raised_at: Date | null;
  objections_cured_at: Date | null;
  steps: Record<string, PortalStepState> | string;
  bundle_pages: number | null;
  bundle_size_bytes: string | number | null;
  bundle_built_at: Date | null;
  tracking_status: TrackingStatus;
  tracking_candidates: CnrCandidateDto[] | string | null;
  tracking_last_attempt_at: Date | null;
  tracking_last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

const iso = (v: Date | string | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : v);
const parse = <T>(v: T | string | null, fallback: T): T =>
  v == null ? fallback : typeof v === 'string' ? (JSON.parse(v) as T) : v;

function fromRow(r: FilingRow): EfilingFiling {
  return {
    id: r.id,
    caseId: r.case_id,
    caseTitle: r.case_title,
    kind: r.kind,
    title: r.title,
    status: r.status,
    efilingNo: r.efiling_no,
    efiledAt: iso(r.efiled_at),
    submittedAt: iso(r.submitted_at),
    courtFilingNo: r.court_filing_no,
    courtFilingYear: r.court_filing_year,
    registrationNo: r.registration_no,
    cnr: r.cnr,
    registeredAt: iso(r.registered_at),
    objections: r.objections,
    objectionsRaisedAt: iso(r.objections_raised_at),
    objectionsCuredAt: iso(r.objections_cured_at),
    steps: parse<Partial<Record<PortalStepKey, PortalStepState>>>(r.steps, {}),
    bundle: r.bundle_built_at
      ? {
          pages: r.bundle_pages,
          sizeBytes: r.bundle_size_bytes == null ? null : Number(r.bundle_size_bytes),
          builtAt: iso(r.bundle_built_at)!,
        }
      : null,
    tracking: {
      status: r.tracking_status,
      lastAttemptAt: iso(r.tracking_last_attempt_at),
      lastError: r.tracking_last_error,
      candidates: parse<CnrCandidateDto[]>(r.tracking_candidates, []),
    },
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

const FILING_SELECT = `
  select f.id, f.case_id, c.title as case_title, f.kind, f.title, f.status, f.efiling_no, f.efiled_at, f.submitted_at,
         f.court_filing_no, f.court_filing_year, f.registration_no, f.cnr, f.registered_at,
         f.objections, f.objections_raised_at, f.objections_cured_at, f.steps,
         f.bundle_pages, f.bundle_size_bytes, f.bundle_built_at,
         f.tracking_status, f.tracking_candidates, f.tracking_last_attempt_at, f.tracking_last_error,
         f.created_at, f.updated_at
  from efiling_filings f
  join cases c on c.id = f.case_id
`;

async function load(sql: Sql, id: string, firmId: string): Promise<EfilingFiling> {
  const [row] = await sql<FilingRow[]>`
    ${sql.unsafe(FILING_SELECT)}
    where f.id::text = ${id} and f.firm_id = ${firmId}::uuid and c.deleted_at is null
  `;
  if (!row) throw new NotFoundError('Filing not found');
  return fromRow(row);
}

export async function recordFilingEvent(
  sql: Sql,
  e: { filingId: string; firmId: string; from?: string | null; to?: string | null; note?: string | null; source: 'advocate' | 'tracker'; actorUserId?: string | null },
): Promise<void> {
  await sql`
    insert into efiling_filing_events (filing_id, firm_id, from_status, to_status, note, source, actor_user_id)
    values (${e.filingId}::uuid, ${e.firmId}::uuid, ${e.from ?? null}, ${e.to ?? null}, ${e.note ?? null},
            ${e.source}, ${e.actorUserId ?? null})
  `;
}

export interface FilingPatch {
  title?: string;
  efilingNo?: string | null;
  courtFilingNo?: string | null;
  courtFilingYear?: number | null;
  registrationNo?: string | null;
  objections?: string | null;
  steps?: Partial<Record<PortalStepKey, PortalStepState>>;
}

export interface TransitionInput {
  to: FilingStatus;
  note?: string | null;
  efilingNo?: string | null;
  submittedAt?: string | null;
  objections?: string | null;
  cnr?: string | null;
}

export interface FilingDetail extends EfilingFiling {
  documents: FilingDocument[];
  payments: FilingPayment[];
  events: FilingEvent[];
}

export const efilingFilingsService = {
  async list(firmId: string, filter: { caseId?: string; open?: boolean } = {}): Promise<EfilingFiling[]> {
    const sql = need();
    const rows = await sql<FilingRow[]>`
      ${sql.unsafe(FILING_SELECT)}
      where f.firm_id = ${firmId}::uuid and c.deleted_at is null
        and (${filter.caseId ?? null}::text is null or f.case_id::text = ${filter.caseId ?? null})
        and (${filter.open ?? false} = false or f.status not in ('registered', 'rejected', 'withdrawn'))
      order by f.updated_at desc
      limit 200
    `;
    return rows.map(fromRow);
  },

  async get(id: string, firmId: string): Promise<FilingDetail> {
    const sql = need();
    const filing = await load(sql, id, firmId);
    const documents = await sql<Array<{
      id: string; position: number; label: string; source_kind: 'draft_render' | 'document';
      source_id: string; page_count: number | null; size_bytes: string | null;
    }>>`
      select id, position, label, source_kind, source_id, page_count, size_bytes
      from efiling_documents where filing_id::text = ${id} order by position
    `;
    const payments = await sql<Array<{
      id: string; purpose: FilingPayment['purpose']; amount_inr: string; grn: string | null; paid_on: string | null;
      payer_name: string | null; mode: FilingPayment['mode']; created_at: Date;
    }>>`
      select id, purpose, amount_inr, grn, paid_on::text as paid_on, payer_name, mode, created_at
      from efiling_payments where filing_id::text = ${id} order by created_at
    `;
    const events = await sql<Array<{
      id: string; from_status: string | null; to_status: string | null; note: string | null;
      source: 'advocate' | 'tracker'; created_at: Date;
    }>>`
      select id, from_status, to_status, note, source, created_at
      from efiling_filing_events where filing_id::text = ${id} order by created_at desc limit 100
    `;
    return {
      ...filing,
      documents: documents.map((d) => ({
        id: d.id, position: d.position, label: d.label, sourceKind: d.source_kind, sourceId: d.source_id,
        pageCount: d.page_count, sizeBytes: d.size_bytes == null ? null : Number(d.size_bytes),
      })),
      payments: payments.map((p) => ({
        id: p.id, purpose: p.purpose, amountInr: Number(p.amount_inr), grn: p.grn, paidOn: p.paid_on,
        payerName: p.payer_name, mode: p.mode, createdAt: iso(p.created_at)!,
      })),
      events: events.map((e) => ({
        id: e.id, fromStatus: e.from_status, toStatus: e.to_status, note: e.note, source: e.source,
        createdAt: iso(e.created_at)!,
      })),
    };
  },

  async create(firmId: string, userId: string, input: { caseId: string; kind: FilingKind; title?: string }): Promise<EfilingFiling> {
    const sql = need();
    const [c] = await sql<Array<{ title: string }>>`
      select title from cases where id::text = ${input.caseId} and firm_id = ${firmId}::uuid and deleted_at is null
    `;
    if (!c) throw new NotFoundError('Case not found');
    const defaultTitle: Record<FilingKind, string> = {
      new_case: `New case: ${c.title}`,
      ia: `IA in ${c.title}`,
      caveat: `Caveat: ${c.title}`,
      misc_document: `Documents in ${c.title}`,
      deficit_court_fee: `Deficit court fee: ${c.title}`,
    };
    const [row] = await sql<Array<{ id: string }>>`
      insert into efiling_filings (firm_id, case_id, kind, title, created_by_user_id)
      values (${firmId}::uuid, ${input.caseId}::uuid, ${input.kind}, ${input.title?.trim() || defaultTitle[input.kind]}, ${userId}::uuid)
      returning id
    `;
    await recordFilingEvent(sql, { filingId: row!.id, firmId, to: 'draft', note: 'Filing created', source: 'advocate', actorUserId: userId });
    if (input.kind === 'new_case') {
      // Seed the wizard data from what the matter already holds.
      await efilingParticularsService.prefill(input.caseId, firmId, userId);
    }
    return load(sql, row!.id, firmId);
  },

  async update(id: string, firmId: string, userId: string, patch: FilingPatch): Promise<EfilingFiling> {
    const sql = need();
    const current = await load(sql, id, firmId);
    const values: Record<string, unknown> = {};
    if (patch.title !== undefined) values.title = patch.title.trim() || current.title;
    if (patch.efilingNo !== undefined) values.efiling_no = patch.efilingNo?.trim().toUpperCase() || null;
    if (patch.courtFilingNo !== undefined) values.court_filing_no = patch.courtFilingNo?.trim() || null;
    if (patch.courtFilingYear !== undefined) values.court_filing_year = patch.courtFilingYear;
    if (patch.registrationNo !== undefined) values.registration_no = patch.registrationNo?.trim() || null;
    if (patch.objections !== undefined) values.objections = patch.objections?.trim() || null;
    if (patch.steps !== undefined) {
      const allowed = new Map(PORTAL_STEPS_BY_KIND[current.kind].map((s) => [s.key, s]));
      for (const [k, v] of Object.entries(patch.steps)) {
        const step = allowed.get(k as PortalStepKey);
        if (!step) throw new BadRequestError(`"${k}" is not a step for this kind of filing.`, { code: 'invalid_step' });
        if (step.required && v === 'not_applicable') {
          throw new BadRequestError(`"${step.label}" can't be skipped on the portal.`, { code: 'step_required' });
        }
      }
      // Merge in the database (jsonb ||), not read-modify-write: ticking two
      // steps in quick succession must not lose one of them.
      await sql`
        update efiling_filings set steps = steps || ${sql.json(patch.steps as never)}, updated_at = now()
        where id::text = ${id}
      `;
    }
    if (Object.keys(values).length === 0) {
      if (patch.steps) {
        const changed = Object.entries(patch.steps).map(([k, v]) => `${k}: ${v}`).join(', ');
        await recordFilingEvent(sql, { filingId: id, firmId, note: `Portal steps updated (${changed})`, source: 'advocate', actorUserId: userId });
        return load(sql, id, firmId);
      }
      return current;
    }
    // New lookup keys -> let the tracker try again right away.
    if (values.court_filing_no !== undefined || values.court_filing_year !== undefined) {
      values.tracking_status = 'idle';
      values.tracking_fail_count = 0;
    }
    try {
      await sql`update efiling_filings set ${sql(values)}, updated_at = now() where id::text = ${id}`;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('Another filing in your firm already has this eFiling number.', { code: 'duplicate_efiling_no' });
      }
      throw err;
    }
    if (patch.steps) {
      const changed = Object.entries(patch.steps).map(([k, v]) => `${k}: ${v}`).join(', ');
      await recordFilingEvent(sql, { filingId: id, firmId, note: `Portal steps updated (${changed})`, source: 'advocate', actorUserId: userId });
    }
    return load(sql, id, firmId);
  },

  async readiness(id: string, firmId: string): Promise<ReadinessReport> {
    const sql = need();
    const filing = await load(sql, id, firmId);
    const docs = (await this.get(id, firmId)).documents;
    if (filing.kind !== 'new_case') {
      // IA / caveat / documents into an existing case: only the documents matter.
      return evaluateDocumentsOnly(docs, filing.bundle);
    }
    const { particulars, parties, facts } = await efilingParticularsService.get(filing.caseId, firmId);
    return evaluateReadiness({ particulars, parties, facts, documents: docs, bundle: filing.bundle });
  },

  async transition(id: string, firmId: string, userId: string, input: TransitionInput): Promise<EfilingFiling> {
    const sql = need();
    const filing = await load(sql, id, firmId);
    if (!canTransition(filing.status, input.to)) {
      throw new BadRequestError(`A filing that is "${filing.status}" cannot move to "${input.to}".`, { code: 'invalid_transition' });
    }
    const values: Record<string, unknown> = { status: input.to };

    if (input.to === 'ready') {
      const report = await this.readiness(id, firmId);
      if (!report.ready) {
        throw new BadRequestError(`${report.errors} item(s) still need attention before this filing is ready.`, {
          code: 'not_ready',
          details: report,
        });
      }
    }
    if (input.to === 'efiled') {
      // "eFile Case" (tab 7) issues the eFiling number; an IA or documents
      // into an existing case are filed against the case, so it's optional.
      const efilingNo = (input.efilingNo ?? filing.efilingNo ?? '').trim().toUpperCase();
      if (!efilingNo && (filing.kind === 'new_case' || filing.kind === 'caveat')) {
        throw new BadRequestError('Enter the eFiling number the portal showed after "eFile Case".', { code: 'efiling_no_required' });
      }
      if (efilingNo) values.efiling_no = efilingNo;
      values.efiled_at = input.submittedAt ? new Date(input.submittedAt) : new Date();
      values.steps = sql.json({ ...filing.steps, [EFILED_STEP[filing.kind]]: 'done' });
    }
    if (input.to === 'submitted') {
      const missing = missingBeforeSubmit(filing);
      if (missing.length > 0) {
        throw new BadRequestError(`Finish these on the portal first: ${missing.join(', ')}.`, { code: 'steps_pending', details: { missing } });
      }
      // Final submit is done with a GRN selected (Draft Pleadings).
      const feeStep = PORTAL_STEPS_BY_KIND[filing.kind].some((s) => s.key === 'court_fee');
      if (feeStep && filing.steps.court_fee !== 'not_applicable') {
        const [grn] = await sql<Array<{ n: number }>>`
          select count(*)::int as n from efiling_payments where filing_id::text = ${id} and grn is not null
        `;
        if (!grn?.n) {
          throw new BadRequestError('Record the court-fee payment with its GRN first. Final submit selects that GRN on the portal.', { code: 'grn_required' });
        }
      }
      values.submitted_at = input.submittedAt ? new Date(input.submittedAt) : new Date();
      const doneKey = filing.kind === 'ia' ? null : 'final_submit';
      if (doneKey) values.steps = sql.json({ ...filing.steps, [doneKey]: 'done' });
    }
    if (input.to === 'objected') {
      const objections = (input.objections ?? '').trim();
      if (!objections) throw new BadRequestError('Record the objections the registry raised.', { code: 'objections_required' });
      values.objections = objections;
      values.objections_raised_at = new Date();
      values.objections_cured_at = null;
    }
    if (input.to === 'refiled') values.objections_cured_at = new Date();
    if (TRACKED_STATUSES.includes(input.to)) {
      values.tracking_status = 'idle';
      values.tracking_fail_count = 0;
    }
    if (input.to === 'draft') {
      values.tracking_status = 'idle';
      values.tracking_candidates = null;
    }

    try {
      await sql`update efiling_filings set ${sql(values)}, updated_at = now() where id::text = ${id}`;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictError('Another filing in your firm already has this eFiling number.', { code: 'duplicate_efiling_no' });
      }
      throw err;
    }
    await recordFilingEvent(sql, { filingId: id, firmId, from: filing.status, to: input.to, note: input.note ?? null, source: 'advocate', actorUserId: userId });

    // Registered by hand, with the CNR the advocate already has.
    if (input.to === 'registered' && input.cnr) {
      await this.attachCnr(id, firmId, input.cnr, 'advocate', userId);
    }
    return load(sql, id, firmId);
  },

  /** Record the case's CNR on the filing and connect the matter to eCourts. */
  async attachCnr(id: string, firmId: string, cnr: string, source: 'advocate' | 'tracker', actorUserId?: string | null): Promise<EfilingFiling> {
    const sql = need();
    const filing = await load(sql, id, firmId);
    const { attachCnrAndQueue, normaliseCnr } = await import('./ecourts-link.service');
    const clean = normaliseCnr(cnr);
    if (!clean) throw new BadRequestError('CNR must be 16 characters: 4 letters followed by 12 letters/digits.', { code: 'invalid_cnr' });
    if (filing.kind === 'new_case') {
      // A filing into an existing case keeps the case's CNR; only a new case
      // gets its CNR from the registration.
      await attachCnrAndQueue(filing.caseId, firmId, clean);
    }
    await sql`
      update efiling_filings set
        cnr = ${clean},
        status = 'registered',
        registered_at = coalesce(registered_at, now()),
        tracking_status = 'matched',
        tracking_candidates = null,
        updated_at = now()
      where id::text = ${id}
    `;
    await recordFilingEvent(sql, {
      filingId: id, firmId, from: filing.status, to: 'registered',
      note: source === 'tracker' ? `Found on eCourts: CNR ${clean}` : `CNR ${clean} entered`,
      source, actorUserId,
    });
    return load(sql, id, firmId);
  },

  /** The advocate picks the right case from the tracker's candidates. */
  async chooseCandidate(id: string, firmId: string, userId: string, cino: string): Promise<EfilingFiling> {
    const sql = need();
    const filing = await load(sql, id, firmId);
    if (!filing.tracking.candidates.some((c) => c.cino === cino.trim().toUpperCase())) {
      throw new BadRequestError('That CNR is not one of the matches found for this filing.', { code: 'not_a_candidate' });
    }
    return this.attachCnr(id, firmId, cino, 'advocate', userId);
  },

  async setDocuments(
    id: string,
    firmId: string,
    userId: string,
    docs: Array<{ label: string; sourceKind: 'draft_render' | 'document'; sourceId: string }>,
  ): Promise<FilingDocument[]> {
    const sql = need();
    const filing = await load(sql, id, firmId);
    // On the portal, pleadings are uploaded after "eFile Case", so documents
    // stay editable while the filing is efiled too.
    if (!['draft', 'ready', 'efiled', 'objected'].includes(filing.status)) {
      throw new BadRequestError('Documents can only be changed before final submit, or while curing objections.');
    }
    // Every source must belong to this firm.
    for (const d of docs) {
      const owned = d.sourceKind === 'document'
        ? await sql`select 1 from documents where id::text = ${d.sourceId} and firm_id = ${firmId}::uuid`
        : await sql`select 1 from draft_renders where id::text = ${d.sourceId} and firm_id = ${firmId}::uuid and pdf_key is not null`;
      if (owned.length === 0) throw new BadRequestError(`"${d.label}" is not a document in your firm (or has no PDF yet).`);
    }
    await sql.begin(async (tx) => {
      await tx`delete from efiling_documents where filing_id::text = ${id}`;
      for (let i = 0; i < docs.length; i++) {
        const d = docs[i]!;
        await tx`
          insert into efiling_documents (filing_id, firm_id, position, label, source_kind, source_id)
          values (${id}::uuid, ${firmId}::uuid, ${i}, ${d.label}, ${d.sourceKind}, ${d.sourceId}::uuid)
        `;
      }
      // The old bundle no longer reflects the document list.
      await tx`
        update efiling_filings set bundle_key = null, bundle_pages = null, bundle_size_bytes = null,
          bundle_built_at = null, updated_at = now()
        where id::text = ${id}
      `;
    });
    await recordFilingEvent(sql, { filingId: id, firmId, note: `Documents set (${docs.length})`, source: 'advocate', actorUserId: userId });
    return (await this.get(id, firmId)).documents;
  },

  async addPayment(
    id: string,
    firmId: string,
    userId: string,
    p: { purpose: FilingPayment['purpose']; amountInr: number; grn?: string | null; paidOn?: string | null; payerName?: string | null; mode?: FilingPayment['mode'] },
  ): Promise<FilingPayment[]> {
    const sql = need();
    const filing = await load(sql, id, firmId);
    await sql`
      insert into efiling_payments (filing_id, firm_id, purpose, amount_inr, grn, paid_on, payer_name, mode, created_by_user_id)
      values (${id}::uuid, ${firmId}::uuid, ${p.purpose}, ${p.amountInr}, ${p.grn?.trim().toUpperCase() || null},
              ${p.paidOn ?? null}, ${p.payerName ?? null}, ${p.mode ?? null}, ${userId}::uuid)
    `;
    if (p.purpose === 'court_fee' || p.purpose === 'deficit_court_fee') {
      const feeKey: PortalStepKey = filing.kind === 'ia' ? 'ia_fee' : 'court_fee';
      await sql`update efiling_filings set steps = ${sql.json({ ...filing.steps, [feeKey]: 'done' })}, updated_at = now() where id::text = ${id}`;
    }
    await recordFilingEvent(sql, {
      filingId: id, firmId, source: 'advocate', actorUserId: userId,
      note: `Payment recorded: ₹${p.amountInr}${p.grn ? ` (GRN ${p.grn.trim().toUpperCase()})` : ''}`,
    });
    return (await this.get(id, firmId)).payments;
  },

  async deletePayment(id: string, firmId: string, paymentId: string): Promise<void> {
    const sql = need();
    await load(sql, id, firmId);
    const rows = await sql`delete from efiling_payments where id::text = ${paymentId} and filing_id::text = ${id} returning id`;
    if (rows.length === 0) throw new NotFoundError('Payment not found');
  },

  /** PDFs on the filing's matter that can go into the bundle. */
  async availableDocuments(id: string, firmId: string): Promise<Array<{ id: string; name: string; sizeBytes: number | null }>> {
    const sql = need();
    const filing = await load(sql, id, firmId);
    const rows = await sql<Array<{ id: string; name: string; file_size: string | null }>>`
      select d.id, d.name, d.file_size
      from documents d
      join cases c on c.id = ${filing.caseId}::uuid
      where d.firm_id = ${firmId}::uuid
        and (d.case_id = c.id or (d.case_id is null and d.case_label = c.title))
        and d.storage_key is not null
        and d.file_mime = 'application/pdf'
      order by d.updated_at desc
      limit 200
    `;
    return rows.map((r) => ({ id: r.id, name: r.name, sizeBytes: r.file_size == null ? null : Number(r.file_size) }));
  },

  async remove(id: string, firmId: string): Promise<void> {
    const sql = need();
    const filing = await load(sql, id, firmId);
    if (!['draft', 'ready', 'withdrawn', 'rejected'].includes(filing.status)) {
      throw new BadRequestError('A filing that is on the portal cannot be deleted. Mark it withdrawn instead.');
    }
    await sql`delete from efiling_filings where id::text = ${id}`;
  },
};

/** Required portal steps (other than final submit itself) not yet done. */
export function missingBeforeSubmit(f: Pick<EfilingFiling, 'kind' | 'steps'>): string[] {
  return PORTAL_STEPS_BY_KIND[f.kind]
    .filter((s) => s.key !== 'final_submit')
    .filter((s) => (s.required ? f.steps[s.key] !== 'done' : (f.steps[s.key] ?? 'pending') === 'pending'))
    .map((s) => s.label);
}

function evaluateDocumentsOnly(documents: FilingDocument[], bundle: EfilingFiling['bundle']): ReadinessReport {
  const report = evaluateReadiness({ particulars: null, parties: [], facts: [], documents, bundle });
  const issues = report.issues.filter((i) => i.section === 'documents');
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { ready: errors === 0, errors, warnings: issues.length - errors, issues };
}
