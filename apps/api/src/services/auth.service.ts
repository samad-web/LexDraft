import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AuthResponse, SignInRequest, SignUpRequest, User, UserPlan } from '@lexdraft/types';
import { env } from '../env';
import { db } from '../db/client';
import { mfaService } from './mfa.service';
import { getPlanState, evaluatePlanState } from './plan-status.service';
import { ConflictError, PaymentRequiredError, UnauthorizedError } from '../lib/errors';

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
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_superadmin: boolean;
  password_hash: string;
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
}

/**
 * Maps the auth-time role-text label (set by signUp/signIn) to the canonical
 * system role name seeded by migrations 0009/0013. Used so auto-provisioned
 * users land with a real `role_id`, not just a free-text role.
 *
 * Returns null when there's no match - the user will fall through to
 * baseline-only permissions, which is the safer default than guessing.
 */
function systemRoleNameFor(roleText: string): string | null {
  switch (roleText) {
    case 'Solo Advocate':    return 'Solo Advocate';
    case 'Practice Lead':    return 'Practice Group Lead';
    case 'Managing Partner': return 'Firm Admin';
    case 'Firm Admin':       return 'Firm Admin';
    default:                 return null;
  }
}

async function resolveSystemRoleId(roleText: string): Promise<string | null> {
  const name = systemRoleNameFor(roleText);
  if (!name) return null;
  const sql = db();
  if (!sql) return null;
  const rows = await sql<Array<{ id: string }>>`
    select id from roles
    where firm_id is null and is_system = true and name = ${name}
    limit 1
  `;
  return rows[0]?.id ?? null;
}

const VALID_PLANS: ReadonlySet<UserPlan> = new Set(['Solo', 'Practice', 'Firm']);
function normalizePlan(raw: string | null | undefined): UserPlan | undefined {
  if (!raw) return undefined;
  return VALID_PLANS.has(raw as UserPlan) ? (raw as UserPlan) : undefined;
}

/**
 * Map the self-serve sign-up role choice to the plan tier the new firm
 * starts on. `firm_plan_tier` defaults to 'Practice' at the column level;
 * for self-serve we set it explicitly so a solo sign-up lands on Solo and
 * a managing-partner sign-up lands on Firm.
 */
function planTierForSignUpRole(role: SignUpRequest['role']): UserPlan {
  switch (role) {
    case 'solo':  return 'Solo';
    case 'group': return 'Practice';
    case 'firm':  return 'Firm';
  }
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
  return user;
}

const USER_SELECT_WITH_FIRM = `
  select u.id, u.name, u.email, u.role, u.is_superadmin, u.password_hash, u.firm_id,
         u.enrolment, u.primary_court, u.practice_areas, u.default_language_code,
         f.name as firm_name, f.plan_tier,
         f.plan_status, f.trial_ends_at, f.is_demo
  from users u
  left join firms f on f.id = u.firm_id
`;

async function findByEmail(email: string): Promise<{ publicUser: User; passwordHash: string } | undefined> {
  const sql = db();
  if (sql) {
    const rows = await sql<UserRow[]>`
      ${sql.unsafe(USER_SELECT_WITH_FIRM)}
      where lower(u.email) = ${email.toLowerCase()} limit 1
    `;
    const row = rows[0];
    if (!row) return undefined;
    return { publicUser: rowToPublic(row), passwordHash: row.password_hash };
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
    const roleId = await resolveSystemRoleId(record.role);
    const rows = await sql<UserRow[]>`
      with inserted as (
        insert into users (
          firm_id, name, email, role, role_id, is_superadmin, password_hash,
          enrolment, primary_court, practice_areas
        )
        values (
          ${firmId}, ${record.name}, ${record.email.toLowerCase()},
          ${record.role}, ${roleId}::uuid, ${!!record.isSuperadmin}, ${record.passwordHash},
          ${record.enrolment ?? null}, ${record.primaryCourt ?? null}, ${record.practiceAreas ?? null}
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
/** Intent the caller landed on the sign-up form with. Controls plan_status
 *  and trial_ends_at on the freshly-provisioned firm. */
export type SignUpIntent = 'trial' | 'paid' | 'demo';

const TRIAL_LENGTH_DAYS = 14;

async function insertUserWithNewFirm(
  record: StoredUser,
  firmName: string,
  planTier: UserPlan,
  intent: SignUpIntent = 'trial',
): Promise<User> {
  const sql = db();
  if (!sql) {
    return insertUser(record, null);
  }
  const roleId = await resolveSystemRoleId(record.role);
  // Trial bookkeeping. 'paid' starts active with no trial clock; 'trial'
  // and 'demo' both get a 14-day window. `is_demo` is set only for the
  // dedicated interactive-demo funnel.
  const planStatus = intent === 'paid' ? 'active' : 'trial';
  const trialEndsAt = intent === 'paid'
    ? null
    : new Date(Date.now() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000);
  const isDemo = intent === 'demo';
  const rows = await sql.begin(async (tx) => {
    const [firmRow] = await tx<{ id: string }[]>`
      insert into firms (name, plan_tier, plan_status, trial_ends_at, is_demo)
      values (
        ${firmName},
        ${planTier}::firm_plan_tier,
        ${planStatus},
        ${trialEndsAt},
        ${isDemo}
      )
      returning id
    `;
    const newFirmId = firmRow!.id;
    return tx<UserRow[]>`
      with inserted as (
        insert into users (
          firm_id, name, email, role, role_id, is_superadmin, password_hash,
          enrolment, primary_court, practice_areas
        )
        values (
          ${newFirmId}::uuid, ${record.name}, ${record.email.toLowerCase()},
          ${record.role}, ${roleId}::uuid, ${!!record.isSuperadmin}, ${record.passwordHash},
          ${record.enrolment ?? null}, ${record.primaryCourt ?? null}, ${record.practiceAreas ?? null}
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
        throw new UnauthorizedError('Invalid credentials');
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
        'Solo',
      );
      // Freshly-provisioned users can never already be enrolled. Branch 3
      // applies; a Solo Advocate doesn't trigger mustEnrollMfa either.
      return { user, token: issueToken(user) };
    }

    const ok = await bcrypt.compare(password, lookup.passwordHash);
    if (!ok) throw new UnauthorizedError('Invalid credentials');

    // Refuse to issue a token when the firm's plan is already inactive.
    // Mid-session enforcement is handled by the requireActivePlan middleware;
    // doing the same check here means the user never sees the dashboard
    // flash before getting kicked out by the first authenticated request.
    // Superadmins bypass so they can still log in to fix lapsed customers.
    if (!lookup.publicUser.isSuperadmin) {
      const planState = await getPlanState(lookup.publicUser.id);
      const planCheck = evaluatePlanState(planState);
      if (!planCheck.ok) {
        throw new PaymentRequiredError('Your firm plan is no longer active. Please renew to continue.', {
          code: planCheck.reason,
          details: planCheck.renewsAt ? { renewsAt: planCheck.renewsAt.toISOString() } : undefined,
        });
      }
    }

    // MFA gate. signInGate hits the DB once for the user's MFA state +
    // role-requirement flags. The in-memory mode (no DATABASE_URL) throws
    // there - guard the call so dev-mode logins still work.
    let gate: { enrolled: boolean; required: boolean } = { enrolled: false, required: false };
    try {
      gate = await mfaService.signInGate(lookup.publicUser.id);
    } catch {
      // In-memory mode, or first-boot before migration 0019 ran. Fall
      // through to the legacy { user, token } response.
    }

    if (gate.enrolled) {
      const challenge = await mfaService.openSignInChallenge(lookup.publicUser.id);
      return {
        mfaRequired: true,
        challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt,
      };
    }

    const response: AuthResponseWithMfa = {
      user: lookup.publicUser,
      token: issueToken(lookup.publicUser),
    };
    if (gate.required) response.mustEnrollMfa = true;
    return response;
  },

  async signUp(input: SignUpRequest): Promise<AuthResponse> {
    const existing = await findByEmail(input.email);
    if (existing) throw new ConflictError('Email already registered');

    const role: User['role'] =
      input.role === 'solo' ? 'Solo Advocate' : input.role === 'group' ? 'Practice Lead' : 'Managing Partner';

    // Each self-serve sign-up provisions its own firm (one firm per paying
    // customer). The user becomes the owner of that fresh tenant; invitees
    // join later via the invitation flow with firmId set from the invite row.
    // Intent decides whether the firm lands as 'trial' (with a 14-day clock),
    // 'paid' (no trial, billing wired downstream), or 'demo' (trial + flag).
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
      },
      deriveFirmName(input),
      planTierForSignUpRole(input.role),
      input.intent ?? 'trial',
    );
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
    record: User & { passwordHash: string },
    firmId: string | null,
  ): Promise<void> {
    const existing = await findByEmail(record.email);
    if (existing) throw new ConflictError('Email already registered');
    await insertUser(record, firmId);
  },
};
