import { db } from '../db/client';
import { BadRequestError } from '../lib/errors';
import { EFILING_PORTAL_STATE_CODES } from '../lib/efiling/types';

// =============================================================================
// efiling-profile.service
//
// The advocate-side details the eFiling portal registers people by: Bar
// Council enrolment number + state, the portal's unique advocate code, and
// the practice locations (HC benches / districts) the advocate may file in.
// Stored on the DifAI user (migration 0086) so filings can be checked
// against them and vakalatnamas pre-filled.
// =============================================================================

export interface PracticeLocation {
  id: string;
  courtTier: 'DC' | 'HC';
  stateCode: number;
  districtCode: number | null;
  bench: string | null;
  label: string | null;
}

export interface EfilingProfile {
  barEnrolmentNo: string | null;
  barCouncilStateCode: number | null;
  efilingUniqueCode: string | null;
  practiceLocations: PracticeLocation[];
}

function need() {
  const sql = db();
  if (!sql) throw new BadRequestError('eFiling requires DATABASE_URL to be configured');
  return sql;
}

export const efilingProfileService = {
  async get(userId: string): Promise<EfilingProfile> {
    const sql = need();
    const [u] = await sql<Array<{ bar_enrolment_no: string | null; bar_council_state_code: number | null; efiling_unique_code: string | null }>>`
      select bar_enrolment_no, bar_council_state_code, efiling_unique_code from users where id = ${userId}::uuid
    `;
    const locs = await sql<Array<{ id: string; court_tier: 'DC' | 'HC'; state_code: number; district_code: number | null; bench: string | null; label: string | null }>>`
      select id, court_tier, state_code, district_code, bench, label
      from advocate_practice_locations where user_id = ${userId}::uuid
      order by court_tier desc, state_code, district_code nulls first
    `;
    return {
      barEnrolmentNo: u?.bar_enrolment_no ?? null,
      barCouncilStateCode: u?.bar_council_state_code ?? null,
      efilingUniqueCode: u?.efiling_unique_code ?? null,
      practiceLocations: locs.map((l) => ({
        id: l.id, courtTier: l.court_tier, stateCode: l.state_code, districtCode: l.district_code, bench: l.bench, label: l.label,
      })),
    };
  },

  async update(
    userId: string,
    firmId: string,
    input: {
      barEnrolmentNo?: string | null;
      barCouncilStateCode?: number | null;
      efilingUniqueCode?: string | null;
      practiceLocations?: Array<Omit<PracticeLocation, 'id'>>;
    },
  ): Promise<EfilingProfile> {
    const sql = need();
    for (const l of input.practiceLocations ?? []) {
      if (!EFILING_PORTAL_STATE_CODES.has(l.stateCode)) {
        throw new BadRequestError('One of the practice locations is in a state the eFiling portal does not cover.');
      }
      if (l.courtTier === 'DC' && l.districtCode == null) {
        throw new BadRequestError('A district-court practice location needs a district.');
      }
    }
    await sql.begin(async (tx) => {
      const values: Record<string, unknown> = {};
      if (input.barEnrolmentNo !== undefined) values.bar_enrolment_no = input.barEnrolmentNo?.trim().toUpperCase() || null;
      if (input.barCouncilStateCode !== undefined) values.bar_council_state_code = input.barCouncilStateCode;
      if (input.efilingUniqueCode !== undefined) values.efiling_unique_code = input.efilingUniqueCode?.trim().toUpperCase() || null;
      if (Object.keys(values).length > 0) {
        await tx`update users set ${tx(values)}, updated_at = now() where id = ${userId}::uuid`;
      }
      if (input.practiceLocations) {
        await tx`delete from advocate_practice_locations where user_id = ${userId}::uuid`;
        for (const l of input.practiceLocations) {
          await tx`
            insert into advocate_practice_locations (user_id, firm_id, court_tier, state_code, district_code, bench, label)
            values (${userId}::uuid, ${firmId}::uuid, ${l.courtTier}, ${l.stateCode}, ${l.districtCode ?? null},
                    ${l.bench?.trim() || null}, ${l.label?.trim() || null})
            on conflict do nothing
          `;
        }
      }
    });
    return this.get(userId);
  },
};
