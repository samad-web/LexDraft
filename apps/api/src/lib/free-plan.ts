// =============================================================================
// Free launch plan - solo advocates and law students (migration 0095).
//
// A free account is a Solo-tier firm with firms.free_plan = true and a trial
// clock that runs to FREE_PLAN_ENDS_AT. The superadmin console flips the
// switches below platform-wide; permissions.service applies them.
// =============================================================================

/** Free access runs through 1 June 2027 (IST). */
export const FREE_PLAN_ENDS_AT = new Date('2027-06-01T23:59:59+05:30');

/** Stored files per free account. */
export const FREE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

/** Free accounts have no AI drafting cap; this stands in for "unlimited". */
export const FREE_AI_MONTHLY_CAP = 1_000_000;

export type FreePlanSwitch = 'team_chat' | 'analytics' | 'limitation' | 'co_counsel';

export const FREE_PLAN_SWITCHES: ReadonlyArray<{ key: FreePlanSwitch; label: string; description: string }> = [
  { key: 'team_chat',  label: 'Team chat',  description: 'Direct messages, groups and matter discussions.' },
  { key: 'analytics',  label: 'Analytics',  description: 'Firm analytics, workload & profitability, activity reports.' },
  { key: 'limitation', label: 'Limitation', description: 'Limitation tracker and calculator.' },
  { key: 'co_counsel', label: 'Co-counsel', description: 'Handing matters over to outside advocates. Accepting a handover always stays open.' },
];

/** Feature keys each switch controls for free accounts: withheld while the
 *  switch is off, granted while it is on. */
export const FREE_PLAN_SWITCH_FEATURES: Record<FreePlanSwitch, readonly string[]> = {
  team_chat:  ['team.messaging'],
  analytics:  ['analytics.firm', 'practice.analytics', 'reports.activity'],
  limitation: ['limitation.use'],
  co_counsel: ['co_counsel.handover'],
};
