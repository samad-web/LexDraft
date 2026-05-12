/**
 * Local types for the Sanhita translator. Kept out of `packages/types/src/index.ts`
 * because the feature is currently API-only data + UI consuming inline shapes;
 * if the front-end ever needs to share a stronger contract we can promote these.
 *
 * Mapping coverage is plausibility-grade — see sanhita-map.json — and must be
 * verified by counsel before production use.
 */

export type OldAct = 'IPC' | 'CrPC' | 'IEA';
export type NewAct = 'BNS' | 'BNSS' | 'BSA';

export interface SanhitaMapping {
  fromAct: OldAct;
  fromSection: string;
  fromTitle: string;
  toAct: NewAct;
  toSection: string;
  toTitle: string;
  /** "" | "Renumbered only" | free-text describing what changed | "UNVERIFIED — counsel review required". */
  substantiveChange: string;
  /** Optional mind-the-gap commentary. */
  notes: string;
}

export interface ScanHit {
  /** The exact substring matched in the input body (e.g. "Sec. 302 IPC"). */
  match: string;
  /** Zero-based character offset into the input body. */
  index: number;
  /** Length of the match. */
  length: number;
  fromAct: OldAct;
  fromSection: string;
}

export interface ScanSuggestion extends ScanHit {
  /** The mapping that should replace the stale reference, if known. */
  mapping: SanhitaMapping | null;
}

export interface ScanResult {
  /** All matches in source-order (may include hits with no mapping). */
  found: ScanHit[];
  /** Hits enriched with their replacement mapping (mapping may be null when uncovered). */
  suggestions: ScanSuggestion[];
}
