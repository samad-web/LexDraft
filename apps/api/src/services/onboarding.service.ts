import type { OnboardingCompleteRequest, OnboardingCompleteResponse } from '@lexdraft/types';
import { db } from '../db/client';
import { FREE_PLAN_ENDS_AT } from '../lib/free-plan';
import { BadRequestError, HttpError, NotFoundError } from '../lib/errors';
import { authService, resolveSystemRoleId } from './auth.service';
import { billingService } from './billing.service';
import { invalidatePermissionsCache } from './permissions.service';
import { invalidatePlanStatusCache } from './plan-status.service';
import { storage } from './storage.service';

// =============================================================================
// Post-sign-up onboarding (/onboarding, migration 0097). The account is made
// from Google + a verified WhatsApp number + a password; the plan and practice
// details are picked here, then the firm is set up to match:
//   free     -> Solo tier, free launch plan till FREE_PLAN_ENDS_AT
//   solo     -> same as free until Dodo confirms the payment (webhook)
//   practice -> Practice tier, 14-day trial, owner becomes Managing Partner
// =============================================================================

const TRIAL_DAYS = 14;

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
    const [u] = await sql<{ firm_id: string | null; name: string; onboarded_at: Date | null }[]>`
      select firm_id, name, onboarded_at from users where id = ${userId}::uuid
    `;
    if (!u) throw new NotFoundError('User not found');
    if (!u.firm_id) throw new BadRequestError('Your account is not attached to a practice.');
    if (u.onboarded_at) throw new BadRequestError('Your practice is already set up. Change your plan from Plan & Billing.');

    const practice = input.plan === 'practice';
    const student = input.plan === 'free' && input.kind === 'student';
    if (practice && !clean(input.firm)) throw new BadRequestError('Enter your firm name.');
    if (student && !clean(input.college)) throw new BadRequestError('Enter your college or university.');

    const role = practice ? 'Managing Partner' : 'Solo Advocate';
    const roleId = await resolveSystemRoleId(role);
    const accountType = practice ? 'firm' : student ? 'student' : 'advocate';
    const firmName = clean(input.firm) ?? `${u.name} (${student ? 'Student' : 'Solo'})`;
    const trialEndsAt = practice ? new Date(Date.now() + TRIAL_DAYS * 86_400_000) : FREE_PLAN_ENDS_AT;
    const cycle = input.plan === 'free' ? null : input.cycle ?? 'monthly';

    await sql.begin(async (tx) => {
      await tx`
        update firms set
          name = ${firmName},
          plan_tier = ${practice ? 'Practice' : 'Solo'}::firm_plan_tier,
          plan_status = 'trial',
          trial_ends_at = ${trialEndsAt},
          free_plan = ${!practice},
          logo_key = coalesce(${ownKey(u.firm_id!, input.logoKey)}, logo_key)
        where id = ${u.firm_id}::uuid
      `;
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
          onboarded_at = now()
        where id = ${userId}::uuid
      `;
    });
    invalidatePermissionsCache(userId);
    invalidatePlanStatusCache(userId);
    await billingService.recordSignup(userId, input.plan, cycle).catch(() => undefined);

    const user = await authService.getById(userId);
    if (!user) throw new NotFoundError('User not found');

    if (input.plan === 'solo') {
      try {
        const { checkoutUrl } = await billingService.startCheckout(userId, 'solo', cycle ?? 'monthly');
        return { user, checkoutUrl };
      } catch (err) {
        return { user, checkoutError: (err as Error).message };
      }
    }
    return { user };
  },
};
