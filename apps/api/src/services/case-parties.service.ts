import type { CaseParty } from '@lexdraft/types';
import { db } from '../db/client';

type DbHandle = NonNullable<ReturnType<typeof db>>;

// =============================================================================
// case-parties.service
//
// Stores all parties + their advocates per matter. eCourts payloads carry
// the principal petitioner/respondent plus optional `ex_pet_namelegal[]` and
// `ex_res_namelegal[]` arrays for multi-party matters; we flatten all of
// these into one rows-per-side table. `replaceForCase` is the path used by
// the sync to refresh the full set atomically.
// =============================================================================

interface CasePartyRow {
  id: string;
  case_id: string;
  side: 'petitioner' | 'respondent';
  party_name: string;
  role_label: string | null;
  advocate_name: string | null;
  position: number;
  source: 'ecourts' | 'manual';
}

function fromRow(r: CasePartyRow): CaseParty {
  return {
    id:           r.id,
    caseId:       r.case_id,
    side:         r.side,
    partyName:    r.party_name,
    roleLabel:    r.role_label,
    advocateName: r.advocate_name,
    position:     r.position,
    source:       r.source,
  };
}

export interface NewCaseParty {
  side: 'petitioner' | 'respondent';
  partyName: string;
  roleLabel?: string | null;
  advocateName?: string | null;
  source?: 'ecourts' | 'manual';
}

export const casePartiesService = {
  async listForCase(caseId: string, firmId: string): Promise<CaseParty[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<CasePartyRow[]>`
      select p.id, p.case_id, p.side, p.party_name, p.role_label, p.advocate_name,
             p.position, p.source
      from case_parties p
      join cases c on c.id = p.case_id
      where p.case_id::text = ${caseId} and c.firm_id = ${firmId}::uuid
      order by p.side desc, p.position
    `;
    return rows.map(fromRow);
  },

  async replaceForCase(
    caseId: string,
    items: NewCaseParty[],
    tx?: DbHandle,
  ): Promise<void> {
    const exec = tx ?? db();
    if (!exec) return;
    await exec`delete from case_parties where case_id::text = ${caseId}`;
    // Position is assigned per side so reordering UIs can target a side
    // independently. The sync passes parties pre-grouped (petitioner first,
    // then respondent); we still re-count per side to be safe.
    const counters: Record<'petitioner' | 'respondent', number> = { petitioner: 0, respondent: 0 };
    for (const item of items) {
      const pos = counters[item.side];
      counters[item.side] = pos + 1;
      await exec`
        insert into case_parties (case_id, side, party_name, role_label, advocate_name, position, source)
        values (${caseId}::uuid, ${item.side}::case_party_side,
                ${item.partyName},
                ${item.roleLabel ?? null},
                ${item.advocateName ?? null},
                ${pos},
                ${item.source ?? 'ecourts'})
      `;
    }
  },
};
