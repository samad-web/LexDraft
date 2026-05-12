/**
 * Indian limitations calculator. Pure, no I/O — given a filing-type id and
 * the trigger date, returns the deadline plus any compound milestones (e.g.
 * the NI Act §138 ladder: notice → 15-day wait → 30-day window).
 *
 * Coverage is the most-used ~20 articles of Schedule I to the Limitation Act
 * 1963 plus the NI Act §138 ladder. This is NOT exhaustive — every article
 * needs research-grade citation work; the catalog here is meant to be
 * gradually extended. Each entry carries `reference` and `notes` so the UI
 * can warn users to verify against the bare Act for the specific facts.
 *
 * In addition to the FILING_TYPES picker (organised by cause-of-action), this
 * module exposes a parallel matter-type → deadline path via getRules() and
 * computeDeadline(). The matter-type rules live in
 * `apps/api/src/data/limitation-rules.json` and are keyed by a human-friendly
 * matter type (e.g. "Complaint under §138 NI Act"). Either path is supported;
 * the rules-based path is the entry point used by the "Add deadline" flow
 * once a firm has classified a matter.
 */

import rulesData from '../data/limitation-rules.json';

export type PeriodUnit = 'days' | 'months' | 'years';

export interface PeriodSpec {
  unit: PeriodUnit;
  count: number;
}

export interface FilingType {
  id: string;
  category: string;
  label: string;
  period: PeriodSpec;
  reference: string;
  triggerLabel: string;
  /** Caveats / exclusions / condonation hints shown alongside the result. */
  notes?: string[];
}

export interface CalculationStep {
  label: string;
  /** ISO YYYY-MM-DD. */
  date: string;
  /** Whole days from the user-supplied trigger. */
  daysFromTrigger: number;
  notes?: string;
}

export interface CalculationResult {
  filingType: FilingType;
  triggerDate: string;
  /** The terminal deadline. ISO YYYY-MM-DD. */
  deadline: string;
  /** Whole-day delta from local-midnight today. Negative when expired. */
  daysRemaining: number;
  /** Compound milestones for ladder-style deadlines; empty for simple ones. */
  steps: CalculationStep[];
  /** Surface-level warnings: weekend/holiday landings, near-expiry, etc. */
  warnings: string[];
}

// ---- Catalog ----------------------------------------------------------------

export const FILING_TYPES: ReadonlyArray<FilingType> = [
  // ---- Money / contract --------------------------------------------------
  {
    id: 'art-19-money-paid',
    category: 'Money & contract',
    label: 'Money paid for the plaintiff (Art. 19)',
    period: { unit: 'years', count: 3 },
    reference: 'Limitation Act 1963, Sch. I, Art. 19',
    triggerLabel: 'Date the money was paid',
  },
  {
    id: 'art-23-money-lent',
    category: 'Money & contract',
    label: 'Money lent — without instrument (Art. 22 / 23)',
    period: { unit: 'years', count: 3 },
    reference: 'Limitation Act 1963, Sch. I, Art. 22/23',
    triggerLabel: 'Date the loan was advanced',
    notes: ['If a written agreement fixes a different demand date, anchor on that instead.'],
  },
  {
    id: 'art-14-goods-sold',
    category: 'Money & contract',
    label: 'Price of goods sold and delivered (Art. 14)',
    period: { unit: 'years', count: 3 },
    reference: 'Limitation Act 1963, Sch. I, Art. 14',
    triggerLabel: 'Date of delivery',
  },
  {
    id: 'art-55-breach',
    category: 'Money & contract',
    label: 'Compensation for breach of contract — general (Art. 55)',
    period: { unit: 'years', count: 3 },
    reference: 'Limitation Act 1963, Sch. I, Art. 55',
    triggerLabel: 'Date the contract was broken',
  },
  {
    id: 'art-54-specific-performance',
    category: 'Money & contract',
    label: 'Specific performance of a contract (Art. 54)',
    period: { unit: 'years', count: 3 },
    reference: 'Limitation Act 1963, Sch. I, Art. 54',
    triggerLabel: 'Date fixed for performance — or date of refusal',
    notes: ['If the contract fixes a date, run from that. Else from the date the plaintiff had notice that performance was refused.'],
  },

  // ---- Tort & misc personal claims --------------------------------------
  {
    id: 'art-72-tort',
    category: 'Tort',
    label: 'Compensation for tort (Art. 72)',
    period: { unit: 'years', count: 1 },
    reference: 'Limitation Act 1963, Sch. I, Art. 72',
    triggerLabel: 'Date the tort was committed',
  },
  {
    id: 'art-91-injury-property',
    category: 'Tort',
    label: 'Compensation for injury to movable property (Art. 91)',
    period: { unit: 'years', count: 3 },
    reference: 'Limitation Act 1963, Sch. I, Art. 91',
    triggerLabel: 'Date of the wrongful act',
  },

  // ---- Immoveable property ----------------------------------------------
  {
    id: 'art-65-possession',
    category: 'Immoveable property',
    label: 'Possession based on title (Art. 65)',
    period: { unit: 'years', count: 12 },
    reference: 'Limitation Act 1963, Sch. I, Art. 65',
    triggerLabel: 'Date possession of the defendant became adverse',
    notes: ['12-year clock starts only when possession turns adverse — not from initial entry.'],
  },
  {
    id: 'art-58-declaration',
    category: 'Immoveable property',
    label: 'Declaration (general) (Art. 58)',
    period: { unit: 'years', count: 3 },
    reference: 'Limitation Act 1963, Sch. I, Art. 58',
    triggerLabel: 'Date the right to sue first accrued',
  },
  {
    id: 'art-61-redemption',
    category: 'Immoveable property',
    label: 'Suit for redemption of mortgage (Art. 61)',
    period: { unit: 'years', count: 30 },
    reference: 'Limitation Act 1963, Sch. I, Art. 61',
    triggerLabel: 'Date the right to redeem accrued',
  },

  // ---- Appeals / applications -------------------------------------------
  {
    id: 'art-116-civil-appeal-hc',
    category: 'Appeals & applications',
    label: 'First appeal to High Court — civil (Art. 116(a))',
    period: { unit: 'days', count: 90 },
    reference: 'Limitation Act 1963, Sch. I, Art. 116(a)',
    triggerLabel: 'Date of decree appealed from',
    notes: ['Time taken to obtain a certified copy of the decree is excluded under s. 12.'],
  },
  {
    id: 'art-116-civil-appeal-other',
    category: 'Appeals & applications',
    label: 'First appeal to other civil court (Art. 116(b))',
    period: { unit: 'days', count: 30 },
    reference: 'Limitation Act 1963, Sch. I, Art. 116(b)',
    triggerLabel: 'Date of decree appealed from',
  },
  {
    id: 'art-117-letters-patent',
    category: 'Appeals & applications',
    label: 'Letters Patent appeal (Art. 117)',
    period: { unit: 'days', count: 30 },
    reference: 'Limitation Act 1963, Sch. I, Art. 117',
    triggerLabel: 'Date of judgment appealed from',
  },
  {
    id: 'art-124-review',
    category: 'Appeals & applications',
    label: 'Application for review of a judgment (Art. 124)',
    period: { unit: 'days', count: 30 },
    reference: 'Limitation Act 1963, Sch. I, Art. 124',
    triggerLabel: 'Date of decree or order',
  },
  {
    id: 'art-131-revision',
    category: 'Appeals & applications',
    label: 'Application for revision (Art. 131)',
    period: { unit: 'days', count: 90 },
    reference: 'Limitation Act 1963, Sch. I, Art. 131',
    triggerLabel: 'Date of decree or order sought to be revised',
  },
  {
    id: 'art-137-residual',
    category: 'Appeals & applications',
    label: 'Residual application (Art. 137)',
    period: { unit: 'years', count: 3 },
    reference: 'Limitation Act 1963, Sch. I, Art. 137',
    triggerLabel: 'Date the right to apply accrued',
    notes: ['Catch-all article for applications not otherwise provided for.'],
  },

  // ---- Special statutes -------------------------------------------------
  {
    id: 'arb-s34',
    category: 'Arbitration',
    label: 'Application to set aside an award (A&C Act §34)',
    period: { unit: 'months', count: 3 },
    reference: 'Arbitration & Conciliation Act 1996, §34(3)',
    triggerLabel: 'Date the party received the signed award',
    notes: ['Court may extend by another 30 days on sufficient cause; absolute bar after 3 months + 30 days.'],
  },

  // NI §138 is a compound ladder — kept here so the picker offers it; the
  // calculator switches to a ladder for this id.
  {
    id: 'ni138-dishonor',
    category: 'NI Act',
    label: 'Section 138 NI Act — full ladder',
    period: { unit: 'days', count: 75 },
    reference: 'Negotiable Instruments Act 1881, §138 provisos & §142',
    triggerLabel: 'Date of cheque-dishonor memo',
    notes: [
      '30 days to issue statutory notice (proviso (b)).',
      'Drawer has 15 days from notice to pay (proviso (c)).',
      'Complaint must be filed within 30 days of expiry of the 15-day notice period (§142(b)).',
    ],
  },
];

// ---- Date math --------------------------------------------------------------

function parseIsoDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw Object.assign(new Error('Trigger date must be ISO YYYY-MM-DD'), { status: 422 });
  }
  // Construct in local time so day arithmetic doesn't slide across DST.
  const [y, m, d] = iso.split('-').map((n) => Number(n));
  return new Date(y!, m! - 1, d!);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

export function addMonths(iso: string, months: number): string {
  const d = parseIsoDate(iso);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Anchor-day adjustment: e.g. +1 month from Jan 31 must land on Feb 28/29,
  // not march 3. JS rolls forward; we roll back to the last day of the
  // intended month when that happens.
  if (d.getDate() < day) {
    d.setDate(0);
  }
  return toIso(d);
}

export function addYears(iso: string, years: number): string {
  const d = parseIsoDate(iso);
  const day = d.getDate();
  const month = d.getMonth();
  d.setFullYear(d.getFullYear() + years);
  // Same anchor-day fix for Feb 29 → Feb 28 on non-leap years.
  if (d.getDate() < day || d.getMonth() !== month) {
    d.setMonth(month + 1, 0);
  }
  return toIso(d);
}

export function applyPeriod(iso: string, p: PeriodSpec): string {
  if (p.unit === 'days')   return addDays(iso, p.count);
  if (p.unit === 'months') return addMonths(iso, p.count);
  return addYears(iso, p.count);
}

export function daysBetween(iso: string, now: Date = new Date()): number {
  const d = parseIsoDate(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

function isWeekend(iso: string): boolean {
  const d = parseIsoDate(iso);
  const day = d.getDay();
  return day === 0 || day === 6;
}

// ---- Calculator -------------------------------------------------------------

export function getFilingType(id: string): FilingType | undefined {
  return FILING_TYPES.find((t) => t.id === id);
}

export interface CalculateInput {
  filingTypeId: string;
  triggerDate: string;
  /** Override "now" — for tests. */
  now?: Date;
}

export function calculate(input: CalculateInput): CalculationResult {
  const filingType = getFilingType(input.filingTypeId);
  if (!filingType) {
    throw Object.assign(new Error(`Unknown filing type: ${input.filingTypeId}`), { status: 422 });
  }
  // Validate the date format up front so the error is human.
  parseIsoDate(input.triggerDate);

  const warnings: string[] = [];

  // NI Act §138 is a compound ladder. The terminal "deadline" is the latest
  // day a complaint may be filed.
  if (filingType.id === 'ni138-dishonor') {
    const noticeDeadline = addDays(input.triggerDate, 30);
    // Per §138 proviso (c) the drawer has 15 days FROM notice service. We
    // assume same-day service (best case) for the calculator; the UI surfaces
    // this assumption as a warning.
    const noticeServedOn = noticeDeadline; // assumption: notice issued on day 30
    const drawerWindowEnds = addDays(noticeServedOn, 15);
    const complaintDeadline = addDays(drawerWindowEnds, 30);

    const steps: CalculationStep[] = [
      {
        label: 'Issue statutory notice',
        date: noticeDeadline,
        daysFromTrigger: 30,
        notes: 'Latest day to despatch the §138 notice (proviso (b)).',
      },
      {
        label: 'Drawer\'s 15-day payment window ends',
        date: drawerWindowEnds,
        daysFromTrigger: 45,
        notes: 'Calculated assuming notice was served on day 30. Adjust if served later.',
      },
      {
        label: 'Latest day to file complaint',
        date: complaintDeadline,
        daysFromTrigger: 75,
        notes: 'Complaint must be filed within 30 days of expiry of the drawer\'s 15-day window (§142(b)).',
      },
    ];

    warnings.push('Notice-service date is assumed to be the day the notice is despatched. If service is delayed, every downstream date shifts by the same number of days.');
    if (isWeekend(complaintDeadline)) warnings.push(`Complaint deadline (${complaintDeadline}) falls on a weekend; verify court working day.`);

    const days = daysBetween(complaintDeadline, input.now ?? new Date());
    if (days < 0)       warnings.push('Complaint deadline has already passed; consider §473 CrPC condonation.');
    else if (days <= 7) warnings.push('Complaint deadline is within 7 days — file urgently.');

    return {
      filingType,
      triggerDate: input.triggerDate,
      deadline: complaintDeadline,
      daysRemaining: days,
      steps,
      warnings,
    };
  }

  // Simple article: deadline = trigger + period.
  const deadline = applyPeriod(input.triggerDate, filingType.period);
  const days = daysBetween(deadline, input.now ?? new Date());

  if (isWeekend(deadline)) {
    warnings.push(`Deadline (${deadline}) falls on a weekend; verify court working day. Section 4 may extend the period to the next working day.`);
  }
  if (days < 0)        warnings.push('This deadline has already passed. Consider whether s. 5 condonation is available.');
  else if (days <= 7)  warnings.push('Deadline is within 7 days — file urgently.');
  else if (days <= 30) warnings.push('Deadline is within 30 days.');

  return {
    filingType,
    triggerDate: input.triggerDate,
    deadline,
    daysRemaining: days,
    steps: [],
    warnings,
  };
}

// ---- Matter-type rules table ------------------------------------------------
//
// The rules-based path is intended for the "Add deadline" flow: a user picks
// a matter type (e.g. "Recovery of money — written contract"), enters the
// cause-of-action date, and the engine returns the statutory deadline plus
// the basis citation. The rules JSON is plausibility-grade research-stand-in
// data; counsel must verify before relying on it for filings.
//
// Period semantics: a rule may specify `periodMonths`, `periodDays`, or both.
// When both are set the engine adds days first, then months (the NI 138 ladder
// uses only periodDays = 75 and falls back to the dedicated ladder code path).

export interface LimitationRule {
  matterType: string;
  statute: string;
  section: string;
  periodMonths: number;
  /** Optional day-precision component for sub-month periods (e.g. 30, 60, 75). */
  periodDays?: number;
  computedFrom: string;
  notes?: string;
}

const RULES: LimitationRule[] = rulesData as LimitationRule[];

/** Return the full curated rules table. Used by GET /api/limitations/rules. */
export function getRules(): LimitationRule[] {
  return RULES.slice();
}

export function getRule(matterType: string): LimitationRule | undefined {
  const want = matterType.trim().toLowerCase();
  return RULES.find((r) => r.matterType.toLowerCase() === want);
}

export interface ComputeDeadlineInput {
  matterType: string;
  /** ISO YYYY-MM-DD. */
  computedFrom: string;
  /** Override "now" — for tests. */
  now?: Date;
}

export interface ComputeDeadlineResult {
  matterType: string;
  basisStatute: string;
  basisSection: string;
  /** ISO YYYY-MM-DD deadline date. */
  deadline: string;
  daysRemaining: number;
  computedFrom: string;
  notes?: string;
}

/**
 * Apply a curated matter-type rule to a trigger date and return the
 * statutory deadline plus the citation. Throws a 422-flagged error when the
 * matter type isn't in the rules table — callers should pre-validate against
 * getRules() so we surface a useful UI error.
 */
export function computeDeadline(input: ComputeDeadlineInput): ComputeDeadlineResult {
  const rule = getRule(input.matterType);
  if (!rule) {
    throw Object.assign(new Error(`Unknown matter type: ${input.matterType}`), { status: 422 });
  }
  parseIsoDate(input.computedFrom);

  // Apply days first (if any), then months. This ordering matters for hybrid
  // rules like "3 months + 30 days" (none in the current table, but the
  // engine should handle the case for free when we add them).
  let deadline = input.computedFrom;
  if (rule.periodDays && rule.periodDays > 0) {
    deadline = addDays(deadline, rule.periodDays);
  }
  if (rule.periodMonths > 0) {
    deadline = addMonths(deadline, rule.periodMonths);
  }

  const daysRemaining = daysBetween(deadline, input.now ?? new Date());

  return {
    matterType: rule.matterType,
    basisStatute: rule.statute,
    basisSection: rule.section,
    deadline,
    daysRemaining,
    computedFrom: input.computedFrom,
    notes: rule.notes,
  };
}
