import type { OnboardingCompleteRequest, OnboardingCompleteResponse } from '@lexdraft/types';
import { db } from '../db/client';
import { FREE_PLAN_ENDS_AT } from '../lib/free-plan';
import { isPaidPlan, PLANS } from '../lib/plans';
import { BadRequestError, HttpError, NotFoundError } from '../lib/errors';
import { authService, resolveSystemRoleId } from './auth.service';
import { billingService, paymentsEnabled } from './billing.service';
import { invalidatePermissionsCache } from './permissions.service';
import { invalidatePlanStatusCache } from './plan-status.service';
import { storage } from './storage.service';

// =============================================================================
// Post-sign-up onboarding (/onboarding, migration 0097). The account is made
// from Google + a verified WhatsApp number + a password; the plan and practice
// details are picked here, then the firm is set up to match (pricing v5):
//   advocate -> Solo tier; chambers -> Practice, law_firm -> Firm tier, owner
//     becomes Managing Partner (lib/plans.ts). No free plan and no trial: the account gets a
//     short window to finish paying, and the Razorpay webhook makes it active.
//     Tier and seats are set only by the payment (signup-hardening.md).
//   free -> only for accounts that already have the free launch plan
//     (firms.free_launch): Solo tier, free till FREE_PLAN_ENDS_AT.
// =============================================================================

/** Time to finish paying after onboarding before the app asks for payment
 *  (sign-in then offers the plan cards with a renew token). */
export const PAYMENT_WINDOW_MS = 30 * 60_000;

const clean = (v?: string) => v?.trim() || null;

const UPLOAD_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'application/pdf': 'pdf',
};
const UPLOAD_MAX_BYTES: Record<'logo' | 'id', number> = { logo: 1024 * 1024, id: 5 * 1024 * 1024 };

/** A key handed out by upload() for this firm, so complete() can't be
 *  pointed at someone else's file. */
function ownKey(firmId: string, key: string | undefined): string | null {
  return key && key.startsWith(`onboarding/${firmId}/`) ? key : null;
}

export const onboardingService = {
  /** Practice logo (step 2) or ID document (step 3), sent as base64. */
  async upload(userId: string, input: { kind: 'logo' | 'id'; contentType: string; dataBase64: string }): Promise<{ key: string }> {
    const sql = db();
    if (!sql) throw new HttpError(503, 'Uploads need the database.');
    const [u] = await sql<{ firm_id: string | null }[]>`select firm_id from users where id = ${userId}::uuid`;
    if (!u?.firm_id) throw new BadRequestError('Your account is not attached to a practice.');
    const ext = UPLOAD_TYPES[input.contentType];
    if (!ext || (input.kind === 'logo' && ext === 'pdf')) {
      throw new BadRequestError(input.kind === 'logo' ? 'Use a PNG, JPG or SVG image.' : 'Use a JPG, PNG or PDF file.');
    }
    const body = Buffer.from(input.dataBase64, 'base64');
    if (body.length === 0) throw new BadRequestError('The file is empty.');
    if (body.length > UPLOAD_MAX_BYTES[input.kind]) {
      throw new BadRequestError(`The file is too large (max ${input.kind === 'logo' ? '1' : '5'} MB).`);
    }
    const key = `onboarding/${u.firm_id}/${input.kind}-${Date.now()}.${ext}`;
    await storage().putObject({ key, body, contentType: input.contentType });
    return { key };
  },

  async complete(userId: string, input: OnboardingCompleteRequest): Promise<OnboardingCompleteResponse> {
    const sql = db();
    if (!sql) throw new HttpError(503, 'Onboarding needs the database.');
    const [u] = await sql<Array<{
      firm_id: string | null; name: string; onboarded_at: Date | null; plan_status: string | null; free_plan: boolean | null;
      free_launch: boolean | null; selected_plan: string | null; renews_at: Date | null;
    }>>`
      select u.firm_id, u.name, u.onboarded_at, f.plan_status, f.free_plan, f.free_launch, f.selected_plan, f.renews_at
      from users u left join firms f on f.id = u.firm_id where u.id = ${userId}::uuid
    `;
    if (!u) throw new NotFoundError('User not found');
    if (!u.firm_id) throw new BadRequestError('Your account is not attached to a practice.');
    if (u.onboarded_at) throw new BadRequestError('Your practice is already set up. Change your plan from Plan & Billing.');

    // Already paid (e.g. paid from the sign-in renew screen before finishing
    // set-up): save the practice details only. The paid plan is kept and no
    // second checkout is opened (signup-hardening.md, F1).
    const paidPlan0 = isPaidPlan(u.selected_plan) ? u.selected_plan : null;
    const alreadyPaid = u.plan_status === 'active' && !u.free_plan && !!u.renews_at && new Date(u.renews_at) > new Date()
      && (!!paidPlan0 || u.selected_plan === 'enterprise');

    const paidPlan = alreadyPaid ? paidPlan0 : isPaidPlan(input.plan) ? input.plan : null;
    const practice = alreadyPaid ? (paidPlan ? PLANS[paidPlan].seats > 1 : true) : !!paidPlan && PLANS[paidPlan].seats > 1;
    const student = !practice && input.kind === 'student';
    const free = !alreadyPaid && input.plan === 'free';
    if (free && !u.free_launch) throw new BadRequestError('Choose a plan to continue.', { code: 'plan_required' });
    // Paid-only sign-up: never fall back to a free plan when online payment
    // is off (F5). Existing free-launch accounts ('free') are unaffected.
    if (!alreadyPaid && !free && !paymentsEnabled()) {
      throw new HttpError(503, 'Online payment is not switched on yet. Please try again later.', { code: 'payments_disabled' });
    }
    if (practice && !alreadyPaid && !clean(input.firm)) throw new BadRequestError('Enter your firm name.');
    if (student && !clean(input.college)) throw new BadRequestError('Enter your college or university.');

    const role = practice ? 'Managing Partner' : 'Solo Advocate';
    const roleId = await resolveSystemRoleId(role);
    const accountType = practice ? 'firm' : student ? 'student' : 'advocate';
    const firmName = clean(input.firm) ?? (alreadyPaid ? null : `${u.name} (${student ? 'Student' : 'Solo'})`);
    const cycle = free ? null : input.cycle ?? 'monthly';

    await sql.begin(async (tx) => {
      if (alreadyPaid) {
        await tx`
          update firms set name = coalesce(${firmName}, name), logo_key = coalesce(${ownKey(u.firm_id!, input.logoKey)}, logo_key)
          where id = ${u.firm_id}::uuid
        `;
      } else {
        // Tier and seats stay Solo / 1 until the payment is applied (the
        // webhook sets them from the paid plan): nothing is unlocked unpaid.
        await tx`
          update firms set
            name = ${firmName},
            plan_tier = 'Solo'::firm_plan_tier,
            seats = 1,
            plan_status = 'trial',
            trial_ends_at = ${free ? FREE_PLAN_ENDS_AT : new Date(Date.now() + PAYMENT_WINDOW_MS)},
            free_plan = ${free},
            logo_key = coalesce(${ownKey(u.firm_id!, input.logoKey)}, logo_key)
          where id = ${u.firm_id}::uuid
        `;
      }
      await tx`
        update users set
          role = ${role},
          role_id = coalesce(${roleId}::uuid, role_id),
          account_type = ${accountType},
          enrolment = ${student ? null : clean(input.enrolment)},
          primary_court = ${student ? null : clean(input.primaryCourt)},
          practice_areas = ${student ? null : clean(input.practiceAreas)},
          city = ${clean(input.city)},
          state = ${clean(input.state)},
          college = ${student ? clean(input.college) : null},
          study_year = ${student ? clean(input.studyYear) : null},
          team_size = ${practice ? clean(input.teamSize) : null},
          id_document_type = ${input.idDocumentType ?? null},
          id_document_number = ${clean(input.idDocumentNumber)},
          id_document_key = ${ownKey(u.firm_id!, input.idDocumentKey)},
          gstin = ${clean(input.gstin)?.toUpperCase() ?? null},
          address_line = ${clean(input.addressLine)},
          pincode = ${clean(input.pincode)},
          -- A paid plan opens the app only once the payment lands (the
          -- webhook sets onboarded_at); closing Razorpay leaves the owner on
          -- /onboarding to pay (owner 2026-11-18, pay-before-app).
          onboarded_at = ${alreadyPaid || free ? new Date() : null}
        where id = ${userId}::uuid
      `;
    });
    invalidatePermissionsCache(userId);
    invalidatePlanStatusCache(userId);

    if (!alreadyPaid) await billingService.recordSignup(userId, input.plan, cycle).catch(() => undefined);
    const user = await authService.getById(userId);
    if (!user) throw new NotFoundError('User not found');

    if (!alreadyPaid && !free && isPaidPlan(input.plan)) {
      try {
        const { checkoutUrl } = await billingService.startCheckout(userId, input.plan, cycle ?? 'monthly', input.munshi ?? 0);
        return { user, checkoutUrl };
      } catch (err) {
        return { user, checkoutError: (err as Error).message };
      }
    }
    return { user };
  },
};
