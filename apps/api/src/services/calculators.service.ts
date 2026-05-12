/**
 * State-aware calculators — court fees, stamp duty, vakalatnama generator.
 *
 * Surfaces three pure-function endpoints that read from static JSON tables
 * shipped with the API. No DB writes, no firm scoping (these are advisory
 * tools available to every authenticated user with the `tools.calculators`
 * feature) — but every input is validated against the known state catalogue
 * so a typo'd `stateCode=ZZ` returns a 400 rather than a silent zero.
 *
 * ## Data accuracy
 * The rate tables in `apps/api/src/data/state-fees.json` and the templates in
 * `apps/api/src/data/vakalatnama-templates.json` are PLAUSIBILITY-GRADE — they
 * reflect commonly-cited figures but stamp/court fees are amended by state
 * gazette circulars (usually March/April each FY) and templates vary by court.
 * Production deployments MUST replace these tables with values verified
 * against the relevant state's most recent gazette / court schedule, and the
 * UI must surface the "indicative only" disclaimer.
 *
 * ## Design notes
 *  - Slab matching is `[min, max)`; the open-ended slab uses `max: null`.
 *  - Percentage caps are floor'd to integer INR — partial paise is dropped
 *    because Indian fee schedules don't track sub-rupee.
 *  - The template substitution is intentionally trivial (no expression eval)
 *    — placeholders like `[party_name]` are replaced verbatim; unknown
 *    placeholders pass through so the advocate can spot what's missing.
 */

import { BadRequestError } from '../lib/errors';
import type {
  CalculatorStateRef,
  CourtFeeInput,
  CourtFeeResult,
  CourtFeeRule,
  FixedInstrument,
  PercentageInstrument,
  StampDutyInput,
  StampDutyResult,
  StampInstrument,
  StateFees,
  VakalatnamaCourtType,
  VakalatnamaInput,
  VakalatnamaResult,
  VakalatnamaTemplate,
} from '../types/calculators.types';
import stateFeesRaw from '../data/state-fees.json';
import vakalatnamaRaw from '../data/vakalatnama-templates.json';

// Cast at module boundary — the JSON is hand-curated and the JSON loader's
// inferred type is too loose (treats every literal as a wide string). The
// `tsc` resolveJsonModule output is unhelpful for discriminated unions.
const STATE_FEES: StateFees[] = stateFeesRaw as unknown as StateFees[];
const VAKALATNAMA_TEMPLATES: VakalatnamaTemplate[] =
  vakalatnamaRaw as unknown as VakalatnamaTemplate[];

const STATE_INDEX = new Map<string, StateFees>(
  STATE_FEES.map((s) => [s.stateCode, s]),
);

function lookupState(stateCode: string): StateFees {
  const hit = STATE_INDEX.get(stateCode);
  if (!hit) {
    throw new BadRequestError(`Unknown stateCode '${stateCode}'`, {
      code: 'unknown_state',
      details: { stateCode, supported: Array.from(STATE_INDEX.keys()) },
    });
  }
  return hit;
}

function isPercentageRule(r: CourtFeeRule): r is Extract<CourtFeeRule, { type: 'percentage' }> {
  return r.type === 'percentage';
}

function isPercentageInstrument(i: StampInstrument): i is PercentageInstrument {
  return typeof (i as PercentageInstrument).percentage === 'number';
}

function isFixedInstrument(i: StampInstrument): i is FixedInstrument {
  return typeof (i as FixedInstrument).fixed === 'number';
}

function formatINR(value: number): string {
  // Express style for the breakdown rows — keeps the JSON small and lets the
  // UI format if it wants to. We still emit human-readable amounts in the
  // breakdown lines so the API can be used directly (cURL, Postman).
  return `INR ${Math.round(value).toLocaleString('en-IN')}`;
}

/** Matches a [min, max) slab; `null` max is open-ended. */
function inSlab(value: number, min: number, max: number | null): boolean {
  if (value < min) return false;
  if (max === null) return true;
  return value < max;
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  // Trivial bracket substitution. Unknown keys are left in-place so the
  // advocate can see what didn't get filled (eg. typo'd field name).
  return template.replace(/\[(\w+)\]/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] ?? match : match,
  );
}

export const calculatorsService = {
  /**
   * Discovery endpoint — used by the UI's state dropdown. Returns the union
   * of available instruments / court types so the UI doesn't hard-code a
   * list that drifts from the data file.
   */
  listStates(): CalculatorStateRef[] {
    return STATE_FEES.map((s) => {
      const courtTypes = Array.from(
        new Set(
          VAKALATNAMA_TEMPLATES
            .filter((t) => t.stateCode === s.stateCode)
            .map((t) => t.courtType),
        ),
      );
      return {
        stateCode: s.stateCode,
        stateName: s.stateName,
        courtTypes,
        instruments: Object.keys(s.stampDuty.instruments),
      };
    });
  },

  courtFee(input: CourtFeeInput): CourtFeeResult {
    const value = Number(input.matterValueInr);
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestError('matterValueInr must be a non-negative number');
    }
    const state = lookupState(input.stateCode);
    const breakdown: string[] = [
      `State: ${state.stateName} (${state.stateCode})`,
      `Matter value: ${formatINR(value)}`,
    ];

    // Find the first matching slab. We walk in declaration order so the
    // open-ended percentage rule at the tail catches everything above the
    // last flat slab.
    const rule = state.courtFee.rules.find((r) =>
      inSlab(value, r.matterValueMin, r.matterValueMax),
    );
    if (!rule) {
      // The JSON should be exhaustive — this is a data-quality signal, not
      // user error, so surface it as 400 with a clear message rather than 500.
      throw new BadRequestError(
        `No court-fee rule matched value ${value} for state ${state.stateCode}`,
        { code: 'no_matching_rule' },
      );
    }

    let fee: number;
    if (isPercentageRule(rule)) {
      const raw = (value * rule.percentage) / 100;
      const capped = rule.cap !== null && raw > rule.cap ? rule.cap : raw;
      fee = Math.round(capped);
      const rangeLabel = rule.matterValueMax === null
        ? `above ${formatINR(rule.matterValueMin)}`
        : `${formatINR(rule.matterValueMin)} – ${formatINR(rule.matterValueMax)}`;
      breakdown.push(
        `Ad-valorem slab (${rangeLabel}): ${rule.percentage}% of ${formatINR(value)} = ${formatINR(raw)}`,
      );
      if (rule.cap !== null && raw > rule.cap) {
        breakdown.push(`Capped at ${formatINR(rule.cap)}`);
      }
    } else {
      fee = rule.fee;
      const rangeLabel = rule.matterValueMax === null
        ? `above ${formatINR(rule.matterValueMin)}`
        : `${formatINR(rule.matterValueMin)} – ${formatINR(rule.matterValueMax)}`;
      breakdown.push(`Flat slab (${rangeLabel}): ${formatINR(rule.fee)}`);
    }

    breakdown.push(`Court fee payable: ${formatINR(fee)}`);
    return { fee, breakdown, notes: state.courtFee.notes };
  },

  stampDuty(input: StampDutyInput): StampDutyResult {
    const value = Number(input.considerationInr);
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestError('considerationInr must be a non-negative number');
    }
    const state = lookupState(input.stateCode);
    const inst = state.stampDuty.instruments[input.instrument];
    if (!inst) {
      throw new BadRequestError(
        `Unknown instrument '${input.instrument}' for state ${state.stateCode}`,
        {
          code: 'unknown_instrument',
          details: {
            instrument: input.instrument,
            supported: Object.keys(state.stampDuty.instruments),
          },
        },
      );
    }

    const breakdown: string[] = [
      `State: ${state.stateName} (${state.stateCode})`,
      `Instrument: ${input.instrument}`,
      `Consideration: ${formatINR(value)}`,
    ];

    let duty: number;
    if (isFixedInstrument(inst)) {
      duty = inst.fixed;
      breakdown.push(`Fixed stamp duty: ${formatINR(inst.fixed)}`);
    } else if (isPercentageInstrument(inst)) {
      const raw = (value * inst.percentage) / 100;
      const withMin = typeof inst.minimum === 'number' && raw < inst.minimum
        ? inst.minimum
        : raw;
      duty = Math.round(withMin);
      breakdown.push(`Ad-valorem: ${inst.percentage}% of ${formatINR(value)} = ${formatINR(raw)}`);
      if (typeof inst.minimum === 'number' && raw < inst.minimum) {
        breakdown.push(`Below minimum — floored at ${formatINR(inst.minimum)}`);
      }
      if (typeof inst.monthsCap === 'number') {
        breakdown.push(
          `Lease cap reference: duty applies on up to ${inst.monthsCap} months' rent / premium`,
        );
      }
    } else {
      // Defensive — the discriminator should be exhaustive.
      throw new BadRequestError(
        `Instrument '${input.instrument}' has neither 'fixed' nor 'percentage'`,
        { code: 'invalid_instrument_shape' },
      );
    }

    breakdown.push(`Stamp duty payable: ${formatINR(duty)}`);
    return { duty, breakdown, notes: inst.notes };
  },

  vakalatnama(input: VakalatnamaInput): VakalatnamaResult {
    // Validate stateCode against the known catalogue so the UI gets a clear
    // error if it falls out of sync with the templates JSON.
    lookupState(input.stateCode);

    if (!input.party?.trim() || !input.advocate?.trim()) {
      throw new BadRequestError('party and advocate are required');
    }
    if (!Number.isFinite(input.age) || input.age <= 0 || input.age > 130) {
      throw new BadRequestError('age must be a positive number under 130');
    }

    // Prefer (stateCode, courtType) match. Fall back to (any state,
    // courtType) — most jurisdictions accept the generic Form-X-style
    // vakalatnama with state-specific Bar Council substitution.
    const exact = VAKALATNAMA_TEMPLATES.find(
      (t) => t.stateCode === input.stateCode && t.courtType === input.courtType,
    );
    const fallback = exact ?? VAKALATNAMA_TEMPLATES.find((t) => t.courtType === input.courtType);
    if (!fallback) {
      throw new BadRequestError(
        `No vakalatnama template available for courtType '${input.courtType}'`,
        {
          code: 'no_template',
          details: {
            courtType: input.courtType,
            availableCourtTypes: Array.from(
              new Set(VAKALATNAMA_TEMPLATES.map((t) => t.courtType)),
            ),
          },
        },
      );
    }

    const text = fillTemplate(fallback.template, {
      court: input.court,
      city: input.city,
      party: input.party,
      party_name: input.party,
      respondent: input.respondent ?? '__________________',
      respondent_name: input.respondent ?? '__________________',
      parent: input.parent,
      parent_name: input.parent,
      age: String(input.age),
      address: input.address,
      advocate: input.advocate,
      advocate_name: input.advocate,
      bar_no: input.barNo,
    });

    return { text };
  },
};
