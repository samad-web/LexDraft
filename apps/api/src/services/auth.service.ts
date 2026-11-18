import crypto from 'node:crypto';
import { assertDeliverableEmail } from '../lib/email-check';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AuthResponse, SignInRequest, SignUpRequest, User, UserPlan } from '@lexdraft/types';
import { env } from '../env';
import { db } from '../db/client';
import { mfaService } from './mfa.service';
import { getPlanState, evaluatePlanState } from './plan-status.service';
import { BadRequestError, ConflictError, ForbiddenError, PaymentRequiredError, UnauthorizedError } from '../lib/errors';
import { FREE_PLAN_ENDS_AT } from '../lib/free-plan';
import { verifyGoogleIdToken, type GoogleIdentity } from '../lib/google-id-token';
import { normalizePhone, phoneOtpService } from './phone-otp.service';
import { billingService } from './billing.service';
import { TERMS_CONSENT_TYPE, TERMS_VERSION } from '../lib/legal';

/**
 * Transitional response returned by signIn when the user is MFA-enrolled
 * but has not yet proved a code this session. The web client renders the
 * TOTP-entry screen and POSTs (challengeId, code) to
 * /api/me/mfa/verify-challenge to exchange for a real session token.
 */
export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeId: string;
  expiresAt: string;
}

/** Extension of AuthResponse used when sign-in succeeds for a user whose
 *  role requires MFA but who has not enrolled yet. The frontend uses
 *  `mustEnrollMfa` to force the enrolment flow on first action. */
export interface AuthResponseWithMfa extends AuthResponse {
  mustEnrollMfa?: boolean;
}

export type SignInResult = AuthResponseWithMfa | MfaChallengeResponse;

export function isMfaChallenge(r: SignInResult): r is MfaChallengeResponse {
  return (r as MfaChallengeResponse).mfaRequired === true;
}

interface StoredUser extends User {
  passwordHash: string;
  /** Google + WhatsApp sign-up only (migration 0094). */
  googleSub?: string;
  phone?: string;
  /** Sign-up profile (migration 0095). */
  profile?: SignupProfile;
}

/** Extra details the sign-up form collects (migration 0095). */
export interface SignupProfile {
  accountType?: 'advocate' | 'student' | 'firm';
  city?: string;
  state?: string;
  college?: string;
  studyYear?: string;
  teamSize?: string;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_superadmin: boolean;
  password_hash: string;
  /** Migration 0094. */
  google_sub?: string | null;
  firm_id: string | null;
  firm_name: string | null;
  plan_tier: string | null;
  enrolment: string | null;
  primary_court: string | null;
  practice_areas: string | null;
  /** Migration 0039. Defaults to 'en-IN' on backfilled rows. */
  default_language_code: string | null;
  /** Migration 0040. */
  plan_status: 'trial' | 'active' | 'past_due' | 'cancelled' | null;
  trial_ends_at: string | Date | null;
  is_demo: boolean | null;
  /** Migration 0097: null until the post-sign-up onboarding is finished. */
  onboarded_at?: Date | null;
  /** Latest consent_log answer for the current Terms version (null = never asked). */
  terms_granted?: boolean | null;
}

/**
 * Maps the auth-time role-text label (set by signUp/signIn) to the canonical
 * system role name seeded by migrations 0009/0013. Used so auto-provisioned
 * users land with a real `role_id`, not just a free-text role.
 *
 * Returns null when there's no match - the user will fall through to
 * baseline-only permissions, which is the safer default than guessing.
 */
export function systemRoleNameFor(roleText: string): string | null {
  switch (roleText) {
    case 'Solo Advocate':    return 'Solo Advocate';
    case 'Practice Lead':    return 'Practice Group Lead';
    case 'Managing Partner': return 'Firm Admin';
    case 'Firm Admin':       return 'Firm Admin';
    // Invitation presets (InviteMemberModal). Before these were mapped,
    // invited members landed with role_id = null and baseline-only access.
    case 'Senior Associate': return 'Senior Associate';
    case 'Associate':        return 'Associate';
    case 'Junior Associate': return 'Associate';
    case 'Of Counsel':       return 'Senior Associate';
    case 'Paralegal':        return 'Paralegal';
    case 'Munshi':           return 'Munshi';
    default:                 return null;
  }
}

/** Role id for a role label: a system role via systemRoleNameFor, else a
 *  firm-defined custom role of that name (created by an "Other" invite). */
export async function resolveSystemRoleId(roleText: string, firmId?: string | null): Promise<string | null> {
  const sql = db();
  if (!sql) return null;
  const name = systemRoleNameFor(roleText);
  if (name) {
    const rows = await sql<Array<{ id: string }>>`
      select id from roles
      where firm_id is null and is_system = true and name = ${name}
      limit 1
    `;
    return rows[0]?.id ?? null;
  }
  if (!firmId) return null;
  const rows = await sql<Array<{ id: string }>>`
    select id from roles
    where firm_id = ${firmId}::uuid and lower(name) = lower(${roleText})
    limit 1
  `;
  return rows[0]?.id ?? null;
}

const VALID_PLANS: ReadonlySet<UserPlan> = new Set(['Solo', 'Practice', 'Firm']);
function normalizePlan(raw: string | null | undefined): UserPlan | undefined {
  if (!raw) return undefined;
  return VALID_PLANS.has(raw as UserPlan) ? (raw as UserPlan) : undefined;
}

/** Text role a self-serve sign-up starts with. Firm sign-ups get Managing
 *  Partner so their trial covers every Firm-plan feature. */
function signUpRoleText(role: SignUpRequest['role']): User['role'] {
  return role === 'solo' || role === 'student' ? 'Solo Advocate' : 'Managing Partner';
}

function signupProfile(input: Pick<SignUpRequest, 'role' | 'city' | 'state' | 'college' | 'studyYear' | 'teamSize'>): SignupProfile {
  const clean = (v?: string) => v?.trim() || undefined;
  return {
    accountType: input.role === 'solo' ? 'advocate' : input.role === 'student' ? 'student' : 'firm',
    city: clean(input.city),
    state: clean(input.state),
    college: clean(input.college),
    studyYear: clean(input.studyYear),
    teamSize: clean(input.teamSize),
  };
}

/**
 * Derive the new firm's display name from sign-up input. `firms.name` is
 * NOT NULL, so we always need a non-empty string. The user-supplied firm
 * field wins; otherwise we synthesise something readable from their name.
 */
function deriveFirmName(input: SignUpRequest): string {
  const provided = input.firm?.trim();
  if (provided) return provided;
  switch (input.role) {
    case 'solo':  return `${input.name} (Solo)`;
    case 'student': return `${input.name} (Student)`;
    case 'group': return `${input.name}'s Practice`;
    case 'firm':  return `${input.name}'s Firm`;
  }
}

// In-memory fallback (used only when DATABASE_URL is blank).
const memUsers = new Map<string, StoredUser>();

interface ActAsClaim {
  adminId: string;
  adminEmail: string;
}

interface IssueTokenOpts {
  /** When provided, embeds an `mfaVerifiedAt` claim (unix seconds) on the
   *  token. requireMfa middleware uses this claim to gate routes that
   *  demand a fresh MFA proof. */
  mfaVerifiedAt?: number;
}

function issueToken(user: User, opts: IssueTokenOpts = {}): string {
  const claims: Record<string, unknown> = {
    sub: user.id,
    email: user.email,
    role: user.role,
    isSuperadmin: !!user.isSuperadmin,
  };
  if (typeof opts.mfaVerifiedAt === 'number') {
    claims.mfaVerifiedAt = opts.mfaVerifiedAt;
  }
  return jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

/** Issue a short-lived JWT for an admin acting as another user. The token's
 *  identity is the target user (so all tenant routes Just Work) but it
 *  carries an `actAs` claim that:
 *    1. lets the frontend show an "Impersonating" banner, and
 *    2. lets requireSuperadmin reject the token from /admin routes.
 *  isSuperadmin is forced to false on the token so impersonated sessions can
 *  never escalate. */
export function issueImpersonationToken(target: User, admin: ActAsClaim): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min
  const token = jwt.sign(
    {
      sub: target.id,
      email: target.email,
      role: target.role,
      isSuperadmin: false,
      actAs: admin,
    },
    env.JWT_SECRET,
    { expiresIn: '30m' },
  );
  return { token, expiresAt };
}

export interface ConsentMeta { ip: string | null; userAgent: string | null }

/** Records the Terms + Privacy agreement given at sign-up. A failure leaves
 *  the account in place; the in-app consent gate then asks again. */
async function recordTermsAcceptance(user: User, meta?: ConsentMeta): Promise<void> {
  const sql = db();
  if (!sql) return;
  try {
    await sql`
      insert into consent_log (user_id, firm_id, consent_type, consent_version, granted, ip, user_agent)
      select u.id, u.firm_id, ${TERMS_CONSENT_TYPE}, ${TERMS_VERSION}, true, ${meta?.ip ?? null}, ${meta?.userAgent ?? null}
      from users u where u.id = ${user.id}::uuid
    `;
    delete user.needsTermsAcceptance;
  } catch {
    user.needsTermsAcceptance = true;
  }
}

function rowToPublic(row: UserRow): User {
  const user: User = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isSuperadmin: row.is_superadmin,
    firm: row.firm_name ?? '',
    plan: normalizePlan(row.plan_tier),
  };
  if (row.enrolment) user.enrolment = row.enrolment;
  if (row.primary_court) user.primaryCourt = row.primary_court;
  if (row.practice_areas) user.practiceAreas = row.practice_areas;
  user.defaultLanguageCode = row.default_language_code ?? 'en-IN';
  if (row.plan_status) user.planStatus = row.plan_status;
  user.trialEndsAt = row.trial_ends_at
    ? (row.trial_ends_at instanceof Date ? row.trial_ends_at.toISOString() : row.trial_ends_at)
    : null;
  user.isDemo = !!row.is_demo;
  if (row.onboarded_at === null) user.needsOnboarding = true;
  if (row.terms_granted !== true) user.needsTermsAcceptance = true;
  return user;
}

const USER_SELECT_WITH_FIRM = `
  select u.id, u.name, u.email, u.role, u.is_superadmin, u.password_hash, u.google_sub, u.firm_id,
         u.enrolment, u.primary_court, u.practice_areas, u.default_language_code, u.onboarded_at,
         f.name as firm_name, f.plan_tier,
         f.plan_status, f.trial_ends_at, f.is_demo,
         (select c.granted from consent_log c
           where c.user_id = u.id and c.consent_type = '${TERMS_CONSENT_TYPE}'
             and c.consent_version = '${TERMS_VERSION}'
           order by c.created_at desc limit 1) as terms_granted
  from users u
  left join firms f on f.id = u.firm_id
`;

async function findByEmail(
  email: string,
): Promise<{ publicUser: User; passwordHash: string; googleSub?: string | null } | undefined> {
  const sql = db();
  if (sql) {
    const rows = await sql<UserRow[]>`
      ${sql.unsafe(USER_SELECT_WITH_FIRM)}
      where lower(u.email) = ${email.toLowerCase()} limit 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    return { publicUser: rowToPublic(row), passwordHash: row.password_hash, googleSub: row.google_sub };
  }
  const stored = memUsers.get(email.toLowerCase());
  if (!stored) return undefined;
  const { passwordHash, ...rest } = stored;
  return { publicUser: rest, passwordHash };
}

async function insertUser(record: StoredUser, firmId: string | null): Promise<User> {
  const sql = db();
  if (sql) {
    // DB mode every user must be scoped to a real firm. Self-serve sign-up
    // and dev auto-provision go through insertUserWithNewFirm so they
    // always supply a firmId; invitation acceptance passes the inviter's
    // firmId. A null here is a programming error.
    if (!firmId) {
      throw new Error('insertUser: firmId is required when DATABASE_URL is set');
    }
    // Resolve the system role id so the resolver's plan ∩ role intersection
    // actually grants this user something. Without role_id they'd see
    // baseline-only features.
    const roleId = await resolveSystemRoleId(record.role, firmId);
    const rows = await sql<UserRow[]>`
      with inserted as (
        insert into users (
          firm_id, name, email, role, role_id, is_superadmin, password_hash,
          enrolment, primary_court, practice_areas,
          google_sub, phone, phone_verified_at
        )
        values (
          ${firmId}, ${record.name}, ${record.email.toLowerCase()},
          ${record.role}, ${roleId}::uuid, ${!!record.isSuperadmin}, ${record.passwordHash},
          ${record.enrolment ?? null}, ${record.primaryCourt ?? null}, ${record.practiceAreas ?? null},
          ${record.googleSub ?? null}, ${record.phone ?? null}, ${record.phone ? new Date() : null}
        )
        returning id, name, email, role, is_superadmin, password_hash, firm_id,
                  enrolment, primary_court, practice_areas
      )
      select i.id, i.name, i.email, i.role, i.is_superadmin, i.password_hash, i.firm_id,
             i.enrolment, i.primary_court, i.practice_areas,
             f.name as firm_name, f.plan_tier
      from inserted i
      left join firms f on f.id = i.firm_id
    `;
    return rowToPublic(rows[0]!);
  }
  // In-memory mode: generate an id so downstream code (middleware, JWT,
  // permission resolver, portal) gets a stable handle. No firm tracking
  // happens here - memUsers carries the user record only.
  const stored: StoredUser = { ...record, id: record.id || crypto.randomUUID() };
  memUsers.set(record.email.toLowerCase(), stored);
  const { passwordHash: _ph, ...rest } = stored;
  return rest;
}

/**
 * Atomically provision a new firm and insert the signed-up user into it.
 * Used by self-serve sign-up and the dev-only auto-provision path on sign-in.
 *
 * Firm + user are written inside a single transaction so an email-uniqueness
 * violation on the user insert rolls back the firm row too - no orphaned
 * tenants in the database when two clients race the same email.
 *
 * Memory mode (no DATABASE_URL) skips firm tracking and falls back to the
 * plain in-memory insertUser path.
 */
/** Intent the caller landed on the sign-up form with. Kept for old clients;
 *  it no longer changes the new firm (signup-hardening.md): 'demo' is refused. */
export type SignUpIntent = 'trial' | 'paid' | 'demo';

/** Shape of a freshly made firm.
 *  - 'unpaid' (every self-serve sign-up, signup-hardening.md): Solo tier,
 *    1 seat, no trial clock, not free; the user must finish /onboarding and
 *    the plan, seats and credits come only from a paid plan.
 *  - 'free_guest' (co-counsel guest accounts, dev auto-provision): the
 *    free launch plan until FREE_PLAN_ENDS_AT, already onboarded (unchanged). */
type NewFirmMode = 'unpaid' | 'free_guest';

async function insertUserWithNewFirm(
  record: StoredUser,
  firmName: string,
  mode: NewFirmMode,
): Promise<User> {
  const sql = db();
  if (!sql) {
    return insertUser(record, null);
  }
  const roleId = await resolveSystemRoleId(record.role);
  const unpaid = mode === 'unpaid';
  const trialEndsAt = unpaid ? null : FREE_PLAN_ENDS_AT;
  const profile = record.profile ?? {};
  const rows = await sql.begin(async (tx) => {
    const [firmRow] = await tx<{ id: string }[]>`
      insert into firms (name, plan_tier, seats, plan_status, trial_ends_at, is_demo, free_plan)
      values (${firmName}, 'Solo'::firm_plan_tier, 1, 'trial', ${trialEndsAt}, false, ${!unpaid})
      returning id
    `;
    const newFirmId = firmRow!.id;
    return tx<UserRow[]>`
      with inserted as (
        insert into users (
          firm_id, name, email, role, role_id, is_superadmin, password_hash,
          enrolment, primary_court, practice_areas,
          google_sub, phone, phone_verified_at,
          account_type, city, state, college, study_year, team_size, onboarded_at
        )
        values (
          ${newFirmId}::uuid, ${record.name}, ${record.email.toLowerCase()},
          ${record.role}, ${roleId}::uuid, ${!!record.isSuperadmin}, ${record.passwordHash},
          ${record.enrolment ?? null}, ${record.primaryCourt ?? null}, ${record.practiceAreas ?? null},
          ${record.googleSub ?? null}, ${record.phone ?? null}, ${record.phone ? new Date() : null},
          ${profile.accountType ?? null}, ${profile.city ?? null}, ${profile.state ?? null},
          ${profile.college ?? null}, ${profile.studyYear ?? null}, ${profile.teamSize ?? null},
          ${unpaid ? null : new Date()}
        )
        returning id, name, email, role, is_superadmin, password_hash, firm_id,
                  enrolment, primary_court, practice_areas
      )
      select i.id, i.name, i.email, i.role, i.is_superadmin, i.password_hash, i.firm_id,
             i.enrolment, i.primary_court, i.practice_areas,
             f.name as firm_name, f.plan_tier
      from inserted i
      left join firms f on f.id = i.firm_id
    `;
  });
  return rowToPublic(rows[0]!);
}

/** Token handed to a Google user who has no account yet. Signed with a
 *  derived secret so it can never pass requireAuth as a session token. */
const SIGNUP_TOKEN_SECRET = `${env.JWT_SECRET}:google-signup`;

// Email sign-up form (restored 2026-11-17, owner): signs the name/email/phone
// between "send code" and "create account".
const EMAIL_SIGNUP_TOKEN_SECRET = `${env.JWT_SECRET}:email-signup`;

interface SignupTokenClaims {
  google: GoogleIdentity;
  /** Present once the WhatsApp OTP has been verified. */
  phone?: string;
}

function issueSignupToken(claims: SignupTokenClaims): string {
  return jwt.sign({ purpose: 'google-signup', ...claims }, SIGNUP_TOKEN_SECRET, { expiresIn: '30m' });
}

function verifySignupToken(token: string): SignupTokenClaims {
  try {
    const c = jwt.verify(token, SIGNUP_TOKEN_SECRET) as SignupTokenClaims & { purpose?: string };
    if (c.purpose !== 'google-signup' || !c.google?.sub) throw new Error('wrong purpose');
    return { google: c.google, phone: c.phone };
  } catch {
    throw new UnauthorizedError('Your sign-up session expired. Continue with Google again.');
  }
}

const RENEW_TOKEN_SECRET = `${env.JWT_SECRET}:plan-renew`;

/** Handed to an account owner whose trial / plan has ended, so they can pay
 *  from the sign-in page (POST /billing/renew-checkout). Never a session. */
function issueRenewToken(userId: string): string {
  return jwt.sign({ purpose: 'plan-renew', sub: userId }, RENEW_TOKEN_SECRET, { expiresIn: '30m' });
}

export function verifyRenewToken(token: string): string {
  try {
    const c = jwt.verify(token, RENEW_TOKEN_SECRET) as { purpose?: string; sub?: string };
    if (c.purpose !== 'plan-renew' || !c.sub) throw new Error('wrong purpose');
    return c.sub;
  } catch {
    throw new UnauthorizedError('Your session expired. Sign in again to choose a plan.');
  }
}

/** One WhatsApp number per account, so the number identifies the user. */
async function assertPhoneUnused(phone: string): Promise<void> {
  const sql = db();
  if (!sql) return;
  const rows = await sql<{ id: string }[]>`select id from users where phone = ${phone} limit 1`;
  if (rows[0]) {
    throw new ConflictError('This WhatsApp number is already linked to a DifAi account. Sign in with that account instead.');
  }
}

export interface GoogleSignupRequired {
  signupRequired: true;
  signupToken: string;
  profile: { email: string; name: string; picture?: string };
}

export interface GoogleSignUpInput {
  signupToken: string;
  /** The account's password - email + password sign-in from then on. */
  password: string;
  name?: string;
  role: SignUpRequest['role'];
  firm?: string;
  enrolment?: string;
  primaryCourt?: string;
  practiceAreas?: string;
  city?: string;
  state?: string;
  college?: string;
  studyYear?: string;
  teamSize?: string;
  intent?: SignUpIntent;
  plan?: SignUpRequest['plan'];
  billingCycle?: SignUpRequest['billingCycle'];
}

/** Post-authentication gate shared by password and Google sign-in: plan
 *  status check, then the MFA branches documented on authService.signIn. */
async function completeSignIn(publicUser: User): Promise<SignInResult> {
  // Refuse to issue a token when the firm's plan is already inactive.
  // Mid-session enforcement is handled by the requireActivePlan middleware;
  // doing the same check here means the user never sees the dashboard
  // flash before getting kicked out by the first authenticated request.
  // Superadmins bypass so they can still log in to fix lapsed customers.
  if (!publicUser.isSuperadmin) {
    const planState = await getPlanState(publicUser.id);
    const planCheck = evaluatePlanState(planState);
    // Not set up yet: sign in so /onboarding can pick the plan and pay; the
    // app itself stays closed (403 onboarding_required). Paying from the
    // renew screen instead would skip set-up (signup-hardening.md, F1).
    if (!planCheck.ok && planState.onboarded) {
      // The owner can pick a plan and pay right from the sign-in page.
      const owner = publicUser.role === 'Solo Advocate' || publicUser.role === 'Managing Partner';
      throw new PaymentRequiredError('Your firm plan is no longer active. Please renew to continue.', {
        code: planCheck.reason,
        details: {
          ...(planCheck.renewsAt ? { renewsAt: planCheck.renewsAt.toISOString() } : {}),
          ...(owner ? { renewToken: issueRenewToken(publicUser.id) } : {}),
        },
      });
    }
  }

  // MFA gate. signInGate hits the DB once for the user's MFA state +
  // role-requirement flags. The in-memory mode (no DATABASE_URL) throws
  // there - guard the call so dev-mode logins still work.
  let gate: { enrolled: boolean; required: boolean } = { enrolled: false, required: false };
  try {
    gate = await mfaService.signInGate(publicUser.id);
  } catch {
    // In-memory mode, or first-boot before migration 0019 ran. Fall
    // through to the legacy { user, token } response.
  }

  if (gate.enrolled) {
    const challenge = await mfaService.openSignInChallenge(publicUser.id);
    return {
      mfaRequired: true,
      challengeId: challenge.challengeId,
      expiresAt: challenge.expiresAt,
    };
  }

  const response: AuthResponseWithMfa = {
    user: publicUser,
    token: issueToken(publicUser),
  };
  if (gate.required) response.mustEnrollMfa = true;
  return response;
}

export const authService = {
  /**
   * Sign in with email + password.
   *
   * Branches after successful password verification (spec §10):
   *   1. User has MFA enrolled → return { mfaRequired: true, challengeId }.
   *      The client trades (challengeId, code) at /api/me/mfa/verify-challenge
   *      for a real token.
   *   2. User's role REQUIRES MFA but they haven't enrolled (first login
   *      after role promotion) → return a normal { user, token } plus
   *      `mustEnrollMfa: true`. We don't hard-block here because that
   *      would lock a freshly-promoted Firm Admin out at the moment they
   *      most need to be inside.
   *   3. Everyone else → normal { user, token }.
   */
  /**
   * Superadmin console sign-in by username (the account's login id, stored in
   * users.email but not necessarily an email address) + password. Non-superadmin
   * accounts are refused with the same message as a wrong password.
   */
  async adminSignIn(username: string, password: string): Promise<SignInResult> {
    const lookup = await findByEmail(username.trim());
    const ok = !!lookup && lookup.publicUser.isSuperadmin
      && await bcrypt.compare(password, lookup.passwordHash);
    if (!ok || !lookup) throw new UnauthorizedError('Invalid username or password');
    return completeSignIn(lookup.publicUser);
  },

  async signIn({ email, password }: SignInRequest): Promise<SignInResult> {
    // Empty password is never valid - refuse before any DB lookup so the
    // legitimate "no password supplied" path can't get confused with a real
    // login attempt. (Older dev paths used to default to the literal
    // 'lexdraft' string; that backdoor is gone.)
    if (!password) throw new UnauthorizedError('Invalid credentials');

    const lookup = await findByEmail(email);

    if (!lookup) {
      // Dev-only auto-provision. Gated on (a) NODE_ENV !== 'production' AND
      // (b) explicit DEV_AUTH_AUTO_PROVISION='true'. In prod, unknown email
      // means 401 - no account is silently created and no superadmin can
      // ever materialize via the email-contains-'admin' shortcut.
      if (!env.devAuthAutoProvision) {
        // Sign in never creates an account: point them at sign-up instead.
        throw new UnauthorizedError('No DifAi account uses this email. Create your account first.', { code: 'account_not_found' });
      }
      const isAdminish = email.toLowerCase().includes('admin');
      const localPart = email.split('@')[0] ?? '';
      const derivedName = localPart
        .split(/[._-]+/)
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ') || email;
      // Dev auto-provision matches the self-serve sign-up shape - each
      // unknown email gets a fresh Solo firm rather than landing in a
      // shared dev seed tenant.
      const user = await insertUserWithNewFirm(
        {
          id: '',
          name: derivedName,
          email: email.toLowerCase(),
          role: 'Solo Advocate',
          firm: '',
          isSuperadmin: isAdminish,
          passwordHash: bcrypt.hashSync(password, 10),
        },
        `${derivedName} (Solo)`,
        'free_guest',
      );
      // Freshly-provisioned users can never already be enrolled. Branch 3
      // applies; a Solo Advocate doesn't trigger mustEnrollMfa either.
      return { user, token: issueToken(user) };
    }

    const ok = await bcrypt.compare(password, lookup.passwordHash);
    if (!ok) throw new UnauthorizedError('Invalid credentials');

    return completeSignIn(lookup.publicUser);
  },

  /**
   * "Sign in with Google". An existing account (matched on Google's `sub`,
   * else on the verified email - which links the Google account to it) goes
   * through the same plan + MFA gate as a password sign-in. An unknown
   * Google account gets a short-lived sign-up token instead: the client must
   * verify a WhatsApp number (startSignupOtp / verifySignupOtp) and then call
   * googleSignUp to create the account.
   */
  async googleSignIn(credential: string, intent: 'signin' | 'signup' = 'signin'): Promise<SignInResult | GoogleSignupRequired> {
    const google = await verifyGoogleIdToken(credential);
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    // From the sign-up page an existing account is never signed in or linked:
    // the user is told to sign in instead.
    const alreadyExists = () =>
      new ConflictError('An account with this email already exists. Sign in instead.', { code: 'account_exists' });

    const bySub = await sql<UserRow[]>`
      ${sql.unsafe(USER_SELECT_WITH_FIRM)}
      where u.google_sub = ${google.sub} limit 1
    `;
    if (bySub[0]) {
      if (intent === 'signup') throw alreadyExists();
      return completeSignIn(rowToPublic(bySub[0]));
    }

    const byEmail = await findByEmail(google.email);
    if (byEmail) {
      if (intent === 'signup') throw alreadyExists();
      if (byEmail.googleSub && byEmail.googleSub !== google.sub) {
        throw new UnauthorizedError('This email is linked to a different Google account.');
      }
      // Never link Google to a password account by email alone: whoever set
      // that password may not own the address (signup-hardening.md, F3). The
      // owner signs in with the password and connects Google in Settings.
      throw new ConflictError(
        'This email already has a DifAi password. Sign in with your password, then connect Google from Settings.',
        { code: 'google_link_required' },
      );
    }

    return {
      signupRequired: true,
      signupToken: issueSignupToken({ google }),
      profile: { email: google.email, name: google.name, picture: google.picture },
    };
  },

  /** Settings -> "Connect Google": the signed-in user proves a Google account
   *  with the same email, which is then linked for Google sign-in. */
  async connectGoogle(userId: string, credential: string): Promise<{ connected: true }> {
    const google = await verifyGoogleIdToken(credential);
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    const [u] = await sql<{ email: string; google_sub: string | null }[]>`select email, google_sub from users where id = ${userId}::uuid`;
    if (!u) throw new UnauthorizedError('Sign in again.');
    if (u.email.toLowerCase() !== google.email.toLowerCase()) {
      throw new BadRequestError(`Choose the Google account for ${u.email}.`, { code: 'google_email_mismatch' });
    }
    if (u.google_sub && u.google_sub !== google.sub) {
      throw new ConflictError('Your account is linked to a different Google account.', { code: 'google_linked_elsewhere' });
    }
    const [other] = await sql<{ id: string }[]>`select id from users where google_sub = ${google.sub} and id <> ${userId}::uuid limit 1`;
    if (other) throw new ConflictError('This Google account is linked to another DifAi account.', { code: 'google_linked_elsewhere' });
    await sql`update users set google_sub = ${google.sub}, updated_at = now() where id = ${userId}::uuid`;
    return { connected: true };
  },

  /** Send a WhatsApp OTP to the number a new Google user entered. */
  /** Sign-up form (name, email, WhatsApp number, password), restored 2026-11-17
   *  at the owner's request: checks the email and number are free and sends the
   *  WhatsApp code. completeEmailSignup creates the account once the code is
   *  entered. Safe with Google: Google never joins a password account by email
   *  (409 google_link_required), so a form account can't capture a Google user. */
  async startEmailSignup(input: { name: string; email: string; phone: string; ip: string | null }) {
    const email = input.email.trim().toLowerCase();
    await assertDeliverableEmail(email);
    const phone = normalizePhone(input.phone);
    if (phone.startsWith('+91') && !/^\+91[6-9]\d{9}$/.test(phone)) {
      throw new BadRequestError('Enter a valid 10-digit Indian mobile number that uses WhatsApp.');
    }
    if (await findByEmail(email)) {
      throw new ConflictError('An account with this email already exists. Sign in instead.');
    }
    await assertPhoneUnused(phone);
    const challenge = await phoneOtpService.start({ phone, googleSub: `email:${email}`, ip: input.ip });
    const signupToken = jwt.sign(
      { purpose: 'email-signup', name: input.name.trim(), email, phone },
      EMAIL_SIGNUP_TOKEN_SECRET,
      { expiresIn: '30m' },
    );
    return { ...challenge, phone, signupToken };
  },

  /** Verifies the WhatsApp code and creates the account: unpaid until the plan
   *  is chosen and paid on /onboarding (signup-hardening.md). */
  async completeEmailSignup(input: { signupToken: string; challengeId: string; code: string; password: string }, meta?: ConsentMeta): Promise<AuthResponse> {
    let claims: { purpose?: string; name?: string; email?: string; phone?: string };
    try {
      claims = jwt.verify(input.signupToken, EMAIL_SIGNUP_TOKEN_SECRET) as typeof claims;
      if (claims.purpose !== 'email-signup' || !claims.email || !claims.phone || !claims.name) throw new Error('bad');
    } catch {
      throw new UnauthorizedError('Your sign-up session expired. Start again.');
    }
    const phone = await phoneOtpService.verify({
      challengeId: input.challengeId,
      code: input.code,
      googleSub: `email:${claims.email}`,
    });
    if (await findByEmail(claims.email)) {
      throw new ConflictError('An account with this email already exists. Sign in instead.');
    }
    await assertPhoneUnused(phone);
    const user = await insertUserWithNewFirm(
      {
        id: '',
        name: claims.name,
        email: claims.email,
        role: 'Solo Advocate',
        firm: '',
        isSuperadmin: false,
        passwordHash: await bcrypt.hash(input.password, 10),
        phone,
        profile: {},
      },
      `${claims.name} (Solo)`,
      'unpaid',
    );
    if (db()) user.needsOnboarding = true;
    await recordTermsAcceptance(user, meta);
    return { user, token: issueToken(user) };
  },

  async startSignupOtp(input: { signupToken: string; phone: string; ip: string | null }) {
    const claims = verifySignupToken(input.signupToken);
    const phone = normalizePhone(input.phone);
    await assertPhoneUnused(phone);
    const challenge = await phoneOtpService.start({ phone, googleSub: claims.google.sub, ip: input.ip });
    return { ...challenge, phone };
  },

  /** Prove the OTP. Returns a fresh sign-up token that carries the verified
   *  phone, which googleSignUp requires. */
  async verifySignupOtp(input: { signupToken: string; challengeId: string; code: string }) {
    const claims = verifySignupToken(input.signupToken);
    const phone = await phoneOtpService.verify({
      challengeId: input.challengeId,
      code: input.code,
      googleSub: claims.google.sub,
    });
    return { signupToken: issueSignupToken({ google: claims.google, phone }), phone };
  },

  /** Forgot password (forgot-password-whatsapp.md): a code goes to the
   *  account's verified WhatsApp number. The reply is the same whether or not
   *  the email has such an account, so it can't be used to find accounts.
   *  Superadmins and suspended users are never sent a code. */
  async startPasswordReset(input: { email: string; ip: string | null }) {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    const [u] = await sql<{ id: string; phone: string }[]>`
      select id, phone from users
      where lower(email) = ${input.email.trim().toLowerCase()}
        and phone is not null and phone_verified_at is not null
        and not is_superadmin and status = 'active'
      limit 1
    `;
    if (!u) return { challengeId: crypto.randomUUID(), resendAfterSeconds: 30 };
    const { challengeId, resendAfterSeconds } = await phoneOtpService.start({ phone: u.phone, userId: u.id, ip: input.ip });
    return { challengeId, resendAfterSeconds };
  },

  /** Right code -> new password for the account the code was sent for. */
  async completePasswordReset(input: { challengeId: string; code: string; password: string }) {
    const sql = db();
    if (!sql) throw new Error('DATABASE_URL not configured');
    const userId = await phoneOtpService.verifyReset({ challengeId: input.challengeId, code: input.code });
    const hash = await bcrypt.hash(input.password, 10);
    await sql`update users set password_hash = ${hash} where id = ${userId}::uuid`;
    return { ok: true as const };
  },

  /** Create the account for a Google user whose WhatsApp number is verified. */
  async googleSignUp(input: GoogleSignUpInput, meta?: ConsentMeta): Promise<AuthResponse> {
    // Paid-only sign-up (owner, 2026-11-16): no free demo accounts.
    if (input.intent === 'demo') {
      throw new ForbiddenError('Book a demo and we will call you.', { code: 'demo_disabled' });
    }
    const { google, phone } = await authService.verifiedSignup(input.signupToken);

    const name = input.name?.trim() || google.name;
    const role: User['role'] =
      signUpRoleText(input.role);
    const signUpShape: SignUpRequest = { ...input, name, email: google.email };
    const user = await insertUserWithNewFirm(
      {
        id: '',
        name,
        email: google.email,
        role,
        firm: input.firm ?? '',
        isSuperadmin: false,
        passwordHash: await bcrypt.hash(input.password, 10),
        enrolment: input.enrolment,
        primaryCourt: input.primaryCourt,
        practiceAreas: input.practiceAreas,
        googleSub: google.sub,
        phone,
        profile: signupProfile(input),
      },
      deriveFirmName(signUpShape),
      'unpaid',
    );
    if (input.plan) {
      await billingService.recordSignup(user.id, input.plan, input.plan === 'free' ? null : input.billingCycle ?? 'monthly')
        .catch(() => undefined);
    }
    // Plan, payment and practice details always come next, on /onboarding;
    // requireActivePlan keeps the app closed until then (onboarded_at is
    // written null by the insert itself).
    user.needsOnboarding = true;
    await recordTermsAcceptance(user, meta);
    return { user, token: issueToken(user) };
  },

  /**
   * Every account is created from a Google identity plus a WhatsApp number
   * proved by OTP. Self sign-up, invitation acceptance and co-counsel
   * acceptance all call this to unwrap the verified sign-up token.
   */
  async verifiedSignup(signupToken: string): Promise<{ google: GoogleIdentity; phone: string }> {
    const claims = verifySignupToken(signupToken);
    if (!claims.phone) throw new UnauthorizedError('Verify your WhatsApp number first.');
    if (await findByEmail(claims.google.email)) {
      throw new ConflictError('An account with this Google email already exists. Sign in with Google instead.');
    }
    await assertPhoneUnused(claims.phone);
    return { google: claims.google, phone: claims.phone };
  },

  async signUp(input: SignUpRequest, meta?: ConsentMeta): Promise<AuthResponse> {
    // Dev/test path (PASSWORD_SIGNUP; off in production). Same rules as
    // Google sign-up: no demo accounts, never active without a payment.
    if (input.intent === 'demo') {
      throw new ForbiddenError('Book a demo and we will call you.', { code: 'demo_disabled' });
    }
    const existing = await findByEmail(input.email);
    if (existing) throw new ConflictError('Email already registered');

    const role: User['role'] =
      signUpRoleText(input.role);

    // Each self-serve sign-up provisions its own firm (one firm per paying
    // customer), unpaid until /onboarding + payment (signup-hardening.md).
    const user = await insertUserWithNewFirm(
      {
        id: '',
        name: input.name,
        email: input.email.toLowerCase(),
        role,
        firm: input.firm ?? '',
        isSuperadmin: false,
        passwordHash: await bcrypt.hash(input.password, 10),
        enrolment: input.enrolment,
        primaryCourt: input.primaryCourt,
        practiceAreas: input.practiceAreas,
        profile: signupProfile(input),
      },
      deriveFirmName(input),
      'unpaid',
    );
    if (db()) user.needsOnboarding = true;
    const plan = input.plan ?? (input.role === 'group' ? 'chambers' : input.role === 'firm' ? 'law_firm' : 'advocate');
    await billingService.recordSignup(user.id, plan, plan === 'free' ? null : input.billingCycle ?? 'monthly')
      .catch(() => undefined);
    await recordTermsAcceptance(user, meta);
    return { user, token: issueToken(user) };
  },

  verify(token: string): {
    sub: string;
    email: string;
    role: string;
    isSuperadmin: boolean;
    actAs?: ActAsClaim;
    mfaVerifiedAt?: number;
  } {
    return jwt.verify(token, env.JWT_SECRET) as ReturnType<typeof authService.verify>;
  },

  /**
   * Reissue the user's token with `mfaVerifiedAt = now`. Called by
   * /api/me/mfa/verify and /api/me/mfa/verify-challenge after a successful
   * code check. The client replaces its stored bearer with the returned
   * token; `requireMfa` middleware then lets the user through to gated
   * routes.
   */
  issueTokenWithMfa(user: User): string {
    return issueToken(user, { mfaVerifiedAt: Math.floor(Date.now() / 1000) });
  },

  async getById(id: string): Promise<User | undefined> {
    const sql = db();
    if (sql) {
      const rows = await sql<UserRow[]>`
        ${sql.unsafe(USER_SELECT_WITH_FIRM)}
        where u.id::text = ${id} limit 1
      `;
      const row = rows[0];
      return row ? rowToPublic(row) : undefined;
    }
    for (const u of memUsers.values()) {
      if (u.id === id) {
        const { passwordHash: _ph, ...rest } = u;
        return rest;
      }
    }
    return undefined;
  },

  /**
   * Persist a user-level preference change. Currently scoped to
   * `defaultLanguageCode` (the Mock-Arguments default). Validation of the
   * code itself is done by the caller; we just round-trip the string.
   *
   * Returns the refreshed public User so the client can update its auth
   * store in one round-trip.
   */
  async updatePreferences(
    userId: string,
    prefs: { defaultLanguageCode?: string },
  ): Promise<User | undefined> {
    const sql = db();
    if (!sql) {
      // Mem mode: mutate the stored copy so subsequent /me reads return the
      // new preference within the process lifetime.
      for (const u of memUsers.values()) {
        if (u.id === userId) {
          if (prefs.defaultLanguageCode !== undefined) {
            u.defaultLanguageCode = prefs.defaultLanguageCode;
          }
          const { passwordHash: _ph, ...rest } = u;
          return rest;
        }
      }
      return undefined;
    }
    if (prefs.defaultLanguageCode !== undefined) {
      await sql`
        update users set
          default_language_code = ${prefs.defaultLanguageCode},
          updated_at = now()
        where id = ${userId}::uuid
      `;
    }
    return authService.getById(userId);
  },

  /**
   * Direct insert - used by the invitation acceptance flow. The firmId comes
   * from the invitation row so the new user joins the inviter's tenant, not
   * the self-serve default.
   */
  async registerExternalUser(
    record: User & { passwordHash: string; googleSub?: string; phone?: string },
    firmId: string | null,
  ): Promise<void> {
    const existing = await findByEmail(record.email);
    if (existing) throw new ConflictError('Email already registered');
    await insertUser(record, firmId);
  },

  /**
   * Used by the co-counsel handover accept flow when the receiving advocate
   * has no DifAi account yet. Unlike `registerExternalUser` (which joins
   * the inviter's firm), this provisions the new advocate their OWN trial
   * Solo firm via `insertUserWithNewFirm` - they must NOT gain membership in
   * the referring firm just by accepting a single-case handover. Their only
   * access to the referred case comes from the `case_guest_grants` row the
   * caller creates separately. Returns a signed session token alongside the
   * user, same shape invitationsService.accept() returns, so the frontend can
   * log the new advocate straight in after acceptance.
   */
  async registerCoCounselGuest(record: {
    name: string;
    email: string;
    googleSub: string;
    phone: string;
    password: string;
  }): Promise<AuthResponse> {
    const existing = await findByEmail(record.email);
    if (existing) throw new ConflictError('Email already registered');
    const user = await insertUserWithNewFirm(
      {
        id: '',
        name: record.name,
        email: record.email.toLowerCase(),
        role: 'Solo Advocate',
        firm: '',
        isSuperadmin: false,
        passwordHash: await bcrypt.hash(record.password, 10),
        googleSub: record.googleSub,
        phone: record.phone,
      },
      `${record.name} (Solo)`,
      'free_guest',
    );
    return { user, token: issueToken(user) };
  },
};
