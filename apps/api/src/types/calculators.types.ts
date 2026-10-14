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

/**
 * Advocate sign-off state for a state's figures - mirrors the VERIFY-table
 * pattern in lexdraft-engine/src/verify/tables.py. `verified: true` must
 * carry a `reviewedBy` + `reviewedOn`; an unsigned true is the exact failure
 * mode this exists to prevent. Defaults to unverified for every state until
 * an advocate licensed in (or familiar with) that state confirms the figures
 * against the bare Act / current gazette schedule.
 */
export interface VerificationStatus {
  verified: boolean;
  reviewedBy: string;
  reviewedOn: string;
  /** e.g. "Tamil Nadu Court Fees and Suits Valuation Act 1955, Schedule I". */
  source: string;
}

export interface StateFees {
  stateCode: string;
  stateName: string;
  courtFee: CourtFeeSchedule;
  stampDuty: StampDutySchedule;
  verification: VerificationStatus;
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
  verification: VerificationStatus;
}

export interface CourtFeeResult {
  fee: number;
  breakdown: string[];
  notes: string;
  verification: VerificationStatus;
}

export interface StampDutyResult {
  duty: number;
  breakdown: string[];
  notes: string;
  verification: VerificationStatus;
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
