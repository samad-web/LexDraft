/**
 * Shared fixtures helper for the integration suite.
 *
 * Service tests need a real firm + user row attached to the test schema
 * before they can exercise any firm-scoped query. Rather than have each
 * test re-author the same INSERT, this helper centralises the four
 * primitives:
 *
 *   - `seedFirm(name, plan)` → returns a firm row with `id` and `plan_tier`
 *   - `seedUser(firmId, opts)` → returns a user row with a stable `id`
 *   - `assignSystemRole(userId, roleName)` → wires `users.role_id` to the
 *     matching system role from migration 0009 (so the permissions resolver
 *     returns something other than baseline).
 *   - `addUserFeatureOverride(...)` - convenience for the override tests.
 *
 * Everything uses the schema-bound `getIntegrationSql()` client, so the
 * inserts land where the test expects.
 */

import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getIntegrationSql } from './integration-db';

export interface SeededFirm {
  id: string;
  name: string;
  planTier: 'Solo' | 'Practice' | 'Firm';
}

export interface SeededUser {
  id: string;
  firmId: string;
  email: string;
  name: string;
  /** Plain-text password - re-used by tests that want to call authService.signIn */
  password: string;
  role: string;
}

export interface SeedUserOpts {
  email?: string;
  name?: string;
  password?: string;
  /** Free-text role label (the legacy `users.role` column). */
  role?: string;
  isSuperadmin?: boolean;
  /** Optional system role NAME ('Firm Admin', 'Solo Advocate', etc.) - when
   *  provided, the user is wired to that role_id post-insert. */
  systemRole?: string;
}

export async function seedFirm(
  name = 'Integration Test Firm',
  planTier: SeededFirm['planTier'] = 'Practice',
): Promise<SeededFirm> {
  const sql = getIntegrationSql();
  const rows = await sql<Array<{ id: string }>>`
    insert into firms (name, plan_tier, seats)
    values (${name}, ${planTier}::firm_plan_tier, 8)
    returning id
  `;
  return { id: rows[0]!.id, name, planTier };
}

export async function seedUser(
  firmId: string,
  opts: SeedUserOpts = {},
): Promise<SeededUser> {
  const sql = getIntegrationSql();
  const suffix = crypto.randomBytes(3).toString('hex');
  const email = (opts.email ?? `user-${suffix}@integration.test`).toLowerCase();
  const name = opts.name ?? `Integration User ${suffix}`;
  const password = opts.password ?? 'integration-pass-1';
  const role = opts.role ?? 'Solo Advocate';
  const passwordHash = await bcrypt.hash(password, 4); // cost 4 - tests, not prod

  const rows = await sql<Array<{ id: string }>>`
    insert into users (firm_id, name, email, role, is_superadmin, password_hash)
    values (${firmId}::uuid, ${name}, ${email}, ${role}, ${!!opts.isSuperadmin}, ${passwordHash})
    returning id
  `;
  const userId = rows[0]!.id;

  if (opts.systemRole) {
    await assignSystemRole(userId, opts.systemRole);
  }

  return { id: userId, firmId, email, name, password, role };
}

export async function assignSystemRole(userId: string, roleName: string): Promise<void> {
  const sql = getIntegrationSql();
  await sql`
    update users
    set role_id = (
      select id from roles
      where firm_id is null and is_system = true and name = ${roleName}
      limit 1
    )
    where id = ${userId}::uuid
  `;
}

export async function addUserFeatureOverride(
  userId: string,
  featureKey: string,
  decision: 'grant' | 'deny',
): Promise<void> {
  const sql = getIntegrationSql();
  await sql`
    insert into user_feature_overrides (user_id, feature_key, decision)
    values (${userId}::uuid, ${featureKey}, ${decision}::override_decision)
    on conflict (user_id, feature_key) do update
      set decision = excluded.decision
  `;
}
