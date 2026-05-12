/**
 * Caseload health DTOs — kept LOCAL to the api package because the surface
 * is still maturing. The web client imports these via the route response
 * shape; once thresholds and signal keys stabilise the orchestrator will
 * promote `CaseloadHealthSummary` into `@lexdraft/types`.
 *
 * The model treats burnout as a multi-signal phenomenon: a solo advocate
 * who hits any one threshold may still be fine, but stacking signals erode
 * the composite score quickly. See `caseload-health.service.ts` for the
 * exact thresholds + scoring formula.
 */

export type CaseloadHealthBand = 'healthy' | 'stretched' | 'overloaded';

export type CaseloadHealthSeverity = 'info' | 'warning' | 'critical';

export type CaseloadHealthSignalKey =
  | 'open_matters'
  | 'imminent_limitations'
  | 'unscheduled_hearings'
  | 'invoice_overdue'
  | 'tasks_overdue';

export interface CaseloadHealthSignal {
  key: CaseloadHealthSignalKey;
  severity: CaseloadHealthSeverity;
  /** Human-readable signal name, e.g. "Open matters". */
  label: string;
  /** The raw measured count. */
  value: number;
  /** The threshold this signal tripped at (warning threshold when warning,
   *  critical when critical). 0 when the signal is `info`. */
  threshold: number;
  /** Short one-line explanation suitable for a chip tooltip or aria-label. */
  message: string;
}

export interface CaseloadHealthSummary {
  /** 0–100, higher = healthier. */
  score: number;
  band: CaseloadHealthBand;
  signals: CaseloadHealthSignal[];
  /** 0–3 short, actionable suggestions derived from the heaviest signals. */
  recommendations: string[];
}
