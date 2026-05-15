/**
 * Plan-tier enforcement for the client portal (CLIENT_PORTAL.md §7.4).
 *
 *   Solo:     portal is not included - blocked at the gate.
 *   Practice: included; capped at 50 active portal-enabled clients per firm.
 *   Firm:     unlimited.
 *
 * The cap is enforced when transitioning a client from disabled → enabled.
 * Disable / re-enable cycles are free; only net-new portal users count.
 */

import { db } from '../db/client';

export const PRACTICE_PORTAL_CAP = 50;

interface PlanGateOk {
  allowed: true;
}
interface PlanGateBlocked {
  allowed: false;
  /** Machine-readable reason - `'plan_not_supported'` for Solo,
   *  `'cap_reached'` when Practice is at its 50-seat ceiling. */
  reason: 'plan_not_supported' | 'cap_reached';
  /** Human-friendly message safe to surface in the UI. */
  message: string;
}
export type PlanGateResult = PlanGateOk | PlanGateBlocked;

/**
 * Decide whether the firm is allowed to enable the portal for ONE more
 * client. Reads the firm's plan tier and counts existing portal-enabled
 * clients in a single round trip. Returns `{ allowed: true }` outside the
 * SQL path (memory mode) since dev demos shouldn't be plan-gated.
 */
export async function checkCanEnablePortal(firmId: string): Promise<PlanGateResult> {
  const sql = db();
  if (!sql) return { allowed: true };

  const rows = await sql<Array<{ plan_tier: string | null; enabled_count: string | number }>>`
    select f.plan_tier,
           (select count(*) from clients c
              where c.firm_id = f.id and c.portal_enabled = true) as enabled_count
    from firms f where f.id = ${firmId}::uuid limit 1
  `;
  const row = rows[0];
  if (!row) {
    return { allowed: false, reason: 'plan_not_supported', message: 'Firm not found.' };
  }

  const plan = (row.plan_tier ?? '').trim();
  if (plan === 'Solo') {
    return {
      allowed: false,
      reason: 'plan_not_supported',
      message: 'The client portal is included on Practice and Firm plans. Upgrade to invite clients.',
    };
  }
  if (plan === 'Practice') {
    const count = Number(row.enabled_count ?? 0);
    if (count >= PRACTICE_PORTAL_CAP) {
      return {
        allowed: false,
        reason: 'cap_reached',
        message: `The Practice plan is limited to ${PRACTICE_PORTAL_CAP} active portal users. Disable a current user or upgrade to Firm.`,
      };
    }
  }
  // Firm tier (or any future tier we haven't gated): unlimited.
  return { allowed: true };
}
