/**
 * Calculator DTOs - kept LOCAL to the api package on purpose. The orchestrator
 * will lift these into `@lexdraft/types` once UI contracts stabilise; for now
 * the calculators are read-only "tool" endpoints and the web hook duplicates
 * the response shapes inline.
 *
 * Data source: apps/api/src/data/state-fees.json +
 *              apps/api/src/data/vakalatnama-templates.json.
 *
 * All monetary values are in INR (paise dropped; integers). Caller is expected
 * to pre-validate user input - services additionally throw `BadRequestError`
 * for unknown stateCode / instrument keys so the UI can render an actionable
 * message rather than a 500.
 */

/* ---------------------------------------------------------------- state-fees */

/** Slab-style rule: flat fee for any matter value in [min, max). */
export interface FlatFeeRule {
  type?: 'flat';
  matterValueMin: number;
  /** Null means open-ended (matches any value >= min). */
  matterValueMax: number | null;
  fee: number;
}

/** Ad-valorem rule: percentage of matter value, optionally capped. */
export interface PercentageFeeRule {
  type: 'percentage';
  matterValueMin: number;
  matterValueMax: number | null;
  /** Whole-number percent - e.g. 1.5 means 1.5%. */
  percentage: number;
  /** Optional INR cap. Null means uncapped. */
  cap: number | null;
}

export type CourtFeeRule = FlatFeeRule | PercentageFeeRule;

export interface CourtFeeSchedule {
  rules: CourtFeeRule[];
  notes: string;
}

export interface PercentageInstrument {
  percentage: number;
  /** Floor in INR (e.g. mortgage minimums). */
  minimum?: number;
  /** Lease-specific: max months of rent the duty applies to. */
  monthsCap?: number;
  notes: string;
}

export interface FixedInstrument {
  fixed: number;
  notes: string;
}

export type StampInstrument = PercentageInstrument | FixedInstrument;

export interface StampDutySchedule {
  instruments: Record<string, StampInstrument>;
}

export interface StateFees {
  stateCode: string;
  stateName: string;
  courtFee: CourtFeeSchedule;
  stampDuty: StampDutySchedule;
}

/* -------------------------------------------------------------- vakalatnama */

export type VakalatnamaCourtType = 'District Court' | 'High Court' | 'Supreme Court';

export interface VakalatnamaTemplate {
  stateCode: string;
  courtType: VakalatnamaCourtType;
  template: string;
}

/* ---------------------------------------------------------------- responses */

export interface CalculatorStateRef {
  stateCode: string;
  stateName: string;
  courtTypes: VakalatnamaCourtType[];
  instruments: string[];
}

export interface CourtFeeResult {
  fee: number;
  breakdown: string[];
  notes: string;
}

export interface StampDutyResult {
  duty: number;
  breakdown: string[];
  notes: string;
}

export interface VakalatnamaResult {
  text: string;
}

/* ----------------------------------------------------------------- inputs   */

export interface CourtFeeInput {
  stateCode: string;
  matterValueInr: number;
}

export interface StampDutyInput {
  stateCode: string;
  instrument: string;
  considerationInr: number;
}

export interface VakalatnamaInput {
  stateCode: string;
  courtType: VakalatnamaCourtType;
  party: string;
  parent: string;
  age: number;
  address: string;
  advocate: string;
  barNo: string;
  court: string;
  city: string;
  respondent?: string;
}
