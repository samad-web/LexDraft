import { db } from '../db/client';
import { BadRequestError, NotFoundError } from '../lib/errors';
import type {
  CaseFact,
  FilingAct,
  FilingParticulars,
  FilingParty,
  MactDetails,
  PartySide,
} from '../lib/efiling/types';

// =============================================================================
// efiling-particulars.service
//
// The data the eFiling portal's New Case wizard asks for (tabs 1-6), kept per
// matter in tables the eCourts sync never touches (migration 0086): eCourts
// rows describe the case as REGISTERED, these describe it as FILED.
//
// prefill() seeds an empty particulars set from what DifAi already knows:
// the court codes and tier on the case row, the eCourts parties and acts.
// It never overwrites anything the advocate has entered.
// =============================================================================

type Sql = NonNullable<ReturnType<typeof db>>;

function need(): Sql {
  const sql = db();
  if (!sql) throw new BadRequestError('eFiling requires DATABASE_URL to be configured');
  return sql;
}

async function assertCase(sql: Sql, caseId: string, firmId: string): Promise<{ id: string; title: string }> {
  const rows = await sql<Array<{ id: string; title: string }>>`
    select id, title from cases
    where id::text = ${caseId} and firm_id = ${firmId}::uuid and deleted_at is null
    limit 1
  `;
  if (!rows[0]) throw new NotFoundError('Case not found');
  return rows[0];
}

const iso = (v: Date | string | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : v);
const num = (v: string | number | null): number | null => (v == null ? null : Number(v));

// ---- particulars ------------------------------------------------------------

interface ParticularsRow {
  case_id: string;
  court_tier: 'DC' | 'HC' | null;
  state_code: number | null;
  district_code: number | null;
  court_code: number | null;
  est_code: string | null;
  court_complex_code: string | null;
  establishment_name: string | null;
  case_type_code: string | null;
  case_type_name: string | null;
  is_urgent: boolean;
  hc_side: 'civil' | 'criminal' | null;
  hc_matter_type: string | null;
  hc_bench: string | null;
  cause_of_action: string | null;
  cause_of_action_date: string | null;
  dispute_place: string | null;
  subject: string | null;
  prayer: string | null;
  relief_particulars: string | null;
  valuation_inr: string | null;
  claim_amount_inr: string | null;
  acts: FilingAct[] | string;
  hide_party: boolean;
  hide_party_reason: string | null;
  local_language: string | null;
  plaint_local: string | null;
  mact: MactDetails | string | null;
  extra: Record<string, string> | string | null;
  updated_at: Date | string | null;
}

const parseJson = <T>(v: T | string | null, fallback: T): T =>
  v == null ? fallback : typeof v === 'string' ? (JSON.parse(v) as T) : v;

function particularsFromRow(r: ParticularsRow): FilingParticulars {
  return {
    caseId: r.case_id,
    courtTier: r.court_tier,
    stateCode: r.state_code,
    districtCode: r.district_code,
    courtCode: r.court_code,
    estCode: r.est_code,
    courtComplexCode: r.court_complex_code,
    establishmentName: r.establishment_name,
    caseTypeCode: r.case_type_code,
    caseTypeName: r.case_type_name,
    isUrgent: r.is_urgent,
    hcSide: r.hc_side,
    hcMatterType: r.hc_matter_type,
    hcBench: r.hc_bench,
    causeOfAction: r.cause_of_action,
    causeOfActionDate: r.cause_of_action_date,
    disputePlace: r.dispute_place,
    subject: r.subject,
    prayer: r.prayer,
    reliefParticulars: r.relief_particulars,
    valuationInr: num(r.valuation_inr),
    claimAmountInr: num(r.claim_amount_inr),
    acts: parseJson<FilingAct[]>(r.acts, []),
    hideParty: r.hide_party,
    hidePartyReason: r.hide_party_reason,
    localLanguage: r.local_language,
    plaintLocal: r.plaint_local,
    mact: parseJson<MactDetails | null>(r.mact, null),
    extra: parseJson<Record<string, string>>(r.extra, {}),
    updatedAt: iso(r.updated_at),
  };
}

const PARTICULARS_COLS = `
  case_id, court_tier, state_code, district_code, court_code, est_code, court_complex_code, establishment_name,
  case_type_code, case_type_name, is_urgent, hc_side, hc_matter_type, hc_bench,
  cause_of_action, cause_of_action_date::text as cause_of_action_date,
  dispute_place, subject, prayer, relief_particulars, valuation_inr, claim_amount_inr, acts,
  hide_party, hide_party_reason, local_language, plaint_local, mact, extra, updated_at
`;

export type ParticularsPatch = Partial<Omit<FilingParticulars, 'caseId' | 'updatedAt'>>;

/** camelCase patch key -> column. Only these can be written. `extra` is
 *  merged key by key (migration 0090), not replaced. */
const PATCH_COLUMNS: Record<Exclude<keyof ParticularsPatch, 'extra'>, string> = {
  courtTier: 'court_tier',
  stateCode: 'state_code',
  districtCode: 'district_code',
  courtCode: 'court_code',
  estCode: 'est_code',
  courtComplexCode: 'court_complex_code',
  establishmentName: 'establishment_name',
  caseTypeCode: 'case_type_code',
  caseTypeName: 'case_type_name',
  isUrgent: 'is_urgent',
  hcSide: 'hc_side',
  hcMatterType: 'hc_matter_type',
  hcBench: 'hc_bench',
  causeOfAction: 'cause_of_action',
  causeOfActionDate: 'cause_of_action_date',
  disputePlace: 'dispute_place',
  subject: 'subject',
  prayer: 'prayer',
  reliefParticulars: 'relief_particulars',
  valuationInr: 'valuation_inr',
  claimAmountInr: 'claim_amount_inr',
  acts: 'acts',
  hideParty: 'hide_party',
  hidePartyReason: 'hide_party_reason',
  localLanguage: 'local_language',
  plaintLocal: 'plaint_local',
  mact: 'mact',
};

// ---- parties ----------------------------------------------------------------

interface PartyRow {
  id: string;
  case_id: string;
  side: PartySide;
  position: number;
  is_client: boolean;
  is_organization: boolean;
  name: string;
  relation_type: FilingParty['relationType'];
  relation_name: string | null;
  gender: FilingParty['gender'];
  age: number | null;
  date_of_birth: string | null;
  occupation: string | null;
  address: string | null;
  district: string | null;
  state: string | null;
  pin_code: string | null;
  mobile: string | null;
  email: string | null;
  is_minor: boolean;
  guardian_name: string | null;
  org_representative: string | null;
  legal_heir_of: string | null;
  name_local: string | null;
  address_local: string | null;
  extra: Record<string, string> | string;
}

function partyFromRow(r: PartyRow): FilingParty {
  return {
    id: r.id,
    caseId: r.case_id,
    side: r.side,
    position: r.position,
    isClient: r.is_client,
    isOrganization: r.is_organization,
    name: r.name,
    relationType: r.relation_type,
    relationName: r.relation_name,
    gender: r.gender,
    age: r.age,
    dateOfBirth: r.date_of_birth,
    occupation: r.occupation,
    address: r.address,
    district: r.district,
    state: r.state,
    pinCode: r.pin_code,
    mobile: r.mobile,
    email: r.email,
    isMinor: r.is_minor,
    guardianName: r.guardian_name,
    orgRepresentative: r.org_representative,
    legalHeirOf: r.legal_heir_of,
    nameLocal: r.name_local,
    addressLocal: r.address_local,
    extra: parseJson<Record<string, string>>(r.extra, {}),
  };
}

const PARTY_COLS = `
  id, case_id, side, position, is_client, is_organization, name, relation_type, relation_name, gender, age,
  date_of_birth::text as date_of_birth, occupation, address, district, state, pin_code, mobile, email,
  is_minor, guardian_name, org_representative, legal_heir_of, name_local, address_local, extra
`;

export type PartyInput = Omit<FilingParty, 'id' | 'caseId' | 'position'> & { position?: number };

const PARTY_COLUMNS: Record<Exclude<keyof PartyInput, 'position'>, string> = {
  side: 'side',
  isClient: 'is_client',
  isOrganization: 'is_organization',
  name: 'name',
  relationType: 'relation_type',
  relationName: 'relation_name',
  gender: 'gender',
  age: 'age',
  dateOfBirth: 'date_of_birth',
  occupation: 'occupation',
  address: 'address',
  district: 'district',
  state: 'state',
  pinCode: 'pin_code',
  mobile: 'mobile',
  email: 'email',
  isMinor: 'is_minor',
  guardianName: 'guardian_name',
  orgRepresentative: 'org_representative',
  legalHeirOf: 'legal_heir_of',
  nameLocal: 'name_local',
  addressLocal: 'address_local',
  extra: 'extra',
};

function toColumnValues(
  patch: Record<string, unknown>,
  map: Record<string, string>,
  jsonCols: ReadonlySet<string>,
  sql: Sql,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const col = map[key];
    if (!col || value === undefined) continue;
    out[col] = jsonCols.has(col) && value != null ? sql.json(value as never) : value;
  }
  return out;
}

async function legalHeirTargetOk(sql: Sql, caseId: string, targetId: string | null | undefined, selfId?: string): Promise<void> {
  if (!targetId) return;
  if (targetId === selfId) throw new BadRequestError('A party cannot be their own legal heir.');
  const rows = await sql`select 1 from case_filing_parties where id::text = ${targetId} and case_id::text = ${caseId}`;
  if (rows.length === 0) throw new BadRequestError('Legal heir must point to a party on the same case.');
}

// ---- service ----------------------------------------------------------------

export interface ParticularsBundle {
  particulars: FilingParticulars | null;
  parties: FilingParty[];
  facts: CaseFact[];
}

export const efilingParticularsService = {
  async get(caseId: string, firmId: string): Promise<ParticularsBundle> {
    const sql = need();
    await assertCase(sql, caseId, firmId);
    const [p] = await sql<ParticularsRow[]>`
      select ${sql.unsafe(PARTICULARS_COLS)} from case_filing_particulars where case_id::text = ${caseId}
    `;
    const parties = await sql<PartyRow[]>`
      select ${sql.unsafe(PARTY_COLS)} from case_filing_parties
      where case_id::text = ${caseId}
      order by side desc, position, created_at
    `;
    const facts = await sql<Array<{ id: string; case_id: string; position: number; fact_date: string | null; fact_time: string | null; description: string }>>`
      select id, case_id, position, fact_date::text as fact_date, to_char(fact_time, 'HH24:MI') as fact_time, description
      from case_facts where case_id::text = ${caseId}
      order by position, fact_date nulls last
    `;
    return {
      particulars: p ? particularsFromRow(p) : null,
      parties: parties.map(partyFromRow),
      facts: facts.map((f) => ({
        id: f.id, caseId: f.case_id, position: f.position,
        factDate: f.fact_date, factTime: f.fact_time, description: f.description,
      })),
    };
  },

  /**
   * Seed particulars from the case row (court codes, tier, type), its
   * eCourts acts and its eCourts parties - only where nothing exists yet.
   */
  async prefill(caseId: string, firmId: string, userId: string): Promise<ParticularsBundle> {
    const sql = need();
    await assertCase(sql, caseId, firmId);
    await sql.begin(async (tx) => {
      await tx`
        insert into case_filing_particulars
          (case_id, firm_id, court_tier, state_code, district_code, court_code, est_code,
           establishment_name, case_type_name, acts, updated_by_user_id)
        select c.id, c.firm_id,
               coalesce(c.ecourts_court_tier, case when c.court ~* 'high\\s*court' then 'HC' else null end),
               c.state_code, c.district_code, c.court_code, c.est_code,
               nullif(c.court, ''), nullif(c.type, ''),
               coalesce((
                 select jsonb_agg(jsonb_build_object('act', a.act_name, 'section', a.section) order by a.position)
                 from case_acts a where a.case_id = c.id
               ), '[]'::jsonb),
               ${userId}::uuid
        from cases c
        where c.id::text = ${caseId} and c.firm_id = ${firmId}::uuid
        on conflict (case_id) do nothing
      `;
      const existing = await tx`select 1 from case_filing_parties where case_id::text = ${caseId} limit 1`;
      if (existing.length === 0) {
        // Pre-mark the party whose name matches the matter's client - the
        // advocate confirms it on the Parties step.
        await tx`
          insert into case_filing_parties (case_id, firm_id, side, position, name, is_client)
          select p.case_id, ${firmId}::uuid, p.side::text, p.position, p.party_name,
                 coalesce(length(trim(c.client)) >= 3 and (
                   p.party_name ilike '%' || trim(c.client) || '%' or trim(c.client) ilike '%' || p.party_name || '%'
                 ), false)
          from case_parties p
          join cases c on c.id = p.case_id
          where p.case_id::text = ${caseId}
        `;
      }
    });
    return this.get(caseId, firmId);
  },

  async updateParticulars(caseId: string, firmId: string, userId: string, patch: ParticularsPatch): Promise<FilingParticulars> {
    const sql = need();
    await assertCase(sql, caseId, firmId);
    const values = toColumnValues(patch, PATCH_COLUMNS, new Set(['acts', 'mact']), sql);
    // Make sure the row exists, then apply the patch.
    await sql`
      insert into case_filing_particulars (case_id, firm_id, updated_by_user_id)
      values (${caseId}::uuid, ${firmId}::uuid, ${userId}::uuid)
      on conflict (case_id) do nothing
    `;
    if (Object.keys(values).length > 0) {
      await sql`
        update case_filing_particulars set
          ${sql(values)}, updated_at = now(), updated_by_user_id = ${userId}::uuid
        where case_id::text = ${caseId}
      `;
    }
    if (patch.extra && Object.keys(patch.extra).length > 0) {
      await sql`
        update case_filing_particulars set
          extra = extra || ${sql.json(patch.extra)}, updated_at = now(), updated_by_user_id = ${userId}::uuid
        where case_id::text = ${caseId}
      `;
    }
    const [row] = await sql<ParticularsRow[]>`
      select ${sql.unsafe(PARTICULARS_COLS)} from case_filing_particulars where case_id::text = ${caseId}
    `;
    return particularsFromRow(row!);
  },

  async addParty(caseId: string, firmId: string, input: PartyInput): Promise<FilingParty> {
    const sql = need();
    await assertCase(sql, caseId, firmId);
    await legalHeirTargetOk(sql, caseId, input.legalHeirOf);
    const values = toColumnValues(input, PARTY_COLUMNS, new Set(['extra']), sql);
    const [pos] = await sql<Array<{ n: number }>>`
      select coalesce(max(position) + 1, 0)::int as n from case_filing_parties
      where case_id::text = ${caseId} and side = ${input.side}
    `;
    const [row] = await sql<PartyRow[]>`
      insert into case_filing_parties ${sql({
        ...values,
        case_id: caseId,
        firm_id: firmId,
        position: input.position ?? pos?.n ?? 0,
      })}
      returning ${sql.unsafe(PARTY_COLS)}
    `;
    return partyFromRow(row!);
  },

  async updateParty(caseId: string, firmId: string, partyId: string, patch: Partial<PartyInput>): Promise<FilingParty> {
    const sql = need();
    await assertCase(sql, caseId, firmId);
    if (patch.legalHeirOf !== undefined) await legalHeirTargetOk(sql, caseId, patch.legalHeirOf, partyId);
    const values = toColumnValues(patch, { ...PARTY_COLUMNS, position: 'position' }, new Set(['extra']), sql);
    if (Object.keys(values).length === 0) throw new BadRequestError('Nothing to update');
    const [row] = await sql<PartyRow[]>`
      update case_filing_parties set ${sql(values)}, updated_at = now()
      where id::text = ${partyId} and case_id::text = ${caseId}
      returning ${sql.unsafe(PARTY_COLS)}
    `;
    if (!row) throw new NotFoundError('Party not found');
    return partyFromRow(row);
  },

  async deleteParty(caseId: string, firmId: string, partyId: string): Promise<void> {
    const sql = need();
    await assertCase(sql, caseId, firmId);
    const rows = await sql`delete from case_filing_parties where id::text = ${partyId} and case_id::text = ${caseId} returning id`;
    if (rows.length === 0) throw new NotFoundError('Party not found');
  },

  /** Facts are edited as one ordered list, like the portal's "Add More Fact". */
  async replaceFacts(
    caseId: string,
    firmId: string,
    facts: Array<{ factDate?: string | null; factTime?: string | null; description: string }>,
  ): Promise<CaseFact[]> {
    const sql = need();
    await assertCase(sql, caseId, firmId);
    await sql.begin(async (tx) => {
      await tx`delete from case_facts where case_id::text = ${caseId}`;
      for (let i = 0; i < facts.length; i++) {
        const f = facts[i]!;
        await tx`
          insert into case_facts (case_id, firm_id, position, fact_date, fact_time, description)
          values (${caseId}::uuid, ${firmId}::uuid, ${i}, ${f.factDate ?? null}, ${f.factTime ?? null}, ${f.description})
        `;
      }
    });
    return (await this.get(caseId, firmId)).facts;
  },
};
