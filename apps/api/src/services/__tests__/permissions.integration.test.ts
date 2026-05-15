/**
 * permissions.service - real-Postgres resolver coverage.
 *
 * The unit suite tests `demoFallbackFor` (the no-DB fallback). This file
 * tests the actual SQL CTE in `resolveFeatures` against the seeded
 * features / plan_features / role_features tables, AND the layer-3
 * `user_feature_overrides` table - which the in-memory mode can never
 * exercise.
 *
 * Test matrix:
 *   - Solo plan × Firm Admin role → drafting.ai present (Solo plan opens the
 *     gate per migration 0016; metering enforces the 50/mo cap elsewhere),
 *     but admin.users / esign.bulk absent (Solo plan doesn't include them).
 *   - Practice plan × Firm Admin role → admin.users present (plan + role
 *     both grant), drafting.ai present (plan unlocks).
 *   - Firm plan × Firm Admin → full set including esign.bulk + analytics.firm.
 *   - Firm plan × Associate → drafting.ai present (role grants, plan permits)
 *     but admin.users NOT present (role doesn't grant).
 *   - user_feature_overrides:
 *       grant override on a key the user's role does NOT grant but the plan
 *         permits → key appears.
 *       deny override on a key the user normally has → key disappears.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addUserFeatureOverride,
  seedFirm,
  seedUser,
  type SeededFirm,
} from '../../__tests__/integration-fixtures';
import {
  invalidatePermissionsCache,
  resolveFeatures,
} from '../permissions.service';

let firmSolo: SeededFirm;
let firmPractice: SeededFirm;
let firmFirm: SeededFirm;

beforeAll(async () => {
  firmSolo = await seedFirm('Permissions Firm Solo', 'Solo');
  firmPractice = await seedFirm('Permissions Firm Practice', 'Practice');
  firmFirm = await seedFirm('Permissions Firm Firm', 'Firm');
});

beforeEach(() => {
  // Each test starts with no cached resolutions so a previous test's
  // override write doesn't leak through the 60s TTL.
  invalidatePermissionsCache();
});

describe('resolveFeatures - plan × role intersection', () => {
  it('Solo plan + Firm Admin role: drafting.ai yes (mig 0016), admin.users / esign.bulk NO (plan does not)', async () => {
    const u = await seedUser(firmSolo.id, {
      email: `perm-solo-admin-${Date.now()}@integration.test`,
      role: 'Firm Admin',
      systemRole: 'Firm Admin',
    });
    const out = await resolveFeatures(u.id);
    expect(out.features).toContain('profile.view'); // baseline
    // drafting.ai is in Solo plan_features per 0016_solo_drafting_ai.sql:
    // the 50/month cap is enforced by metering in me.routes.ts, not by the
    // feature gate. Firm Admin role permits it; plan unlocks it.
    expect(out.features).toContain('drafting.ai');
    // drafting.basic ships in every paid tier.
    expect(out.features).toContain('drafting.basic');
    // esign.bulk is Firm-tier only; absent on Solo regardless of role.
    expect(out.features).not.toContain('esign.bulk');
    // admin.users requires Practice or Firm plan - confirm it's absent on Solo
    // even when the role (Firm Admin) would otherwise grant it.
    expect(out.features).not.toContain('admin.users');
  });

  it('Practice plan + Firm Admin: admin.users yes, drafting.ai yes, esign.bulk NO (Firm plan only)', async () => {
    const u = await seedUser(firmPractice.id, {
      email: `perm-prac-admin-${Date.now()}@integration.test`,
      role: 'Firm Admin',
      systemRole: 'Firm Admin',
    });
    const out = await resolveFeatures(u.id);
    expect(out.plan).toBe('Practice');
    expect(out.features).toContain('admin.users');
    expect(out.features).toContain('drafting.ai');
    expect(out.features).toContain('matter.assign');
    expect(out.features).not.toContain('esign.bulk');
  });

  it('Firm plan + Firm Admin: complete admin surface including esign.bulk', async () => {
    const u = await seedUser(firmFirm.id, {
      email: `perm-firm-admin-${Date.now()}@integration.test`,
      role: 'Firm Admin',
      systemRole: 'Firm Admin',
    });
    const out = await resolveFeatures(u.id);
    expect(out.plan).toBe('Firm');
    expect(out.features).toContain('admin.users');
    expect(out.features).toContain('admin.audit');
    expect(out.features).toContain('admin.billing');
    expect(out.features).toContain('esign.bulk');
    expect(out.features).toContain('drafting.ai');
  });

  it('Firm plan + Associate: drafting.ai yes, admin.users NO (role does not grant)', async () => {
    const u = await seedUser(firmFirm.id, {
      email: `perm-firm-assoc-${Date.now()}@integration.test`,
      role: 'Associate',
      systemRole: 'Associate',
    });
    const out = await resolveFeatures(u.id);
    expect(out.features).toContain('drafting.ai');
    expect(out.features).toContain('drafting.basic');
    expect(out.features).not.toContain('admin.users');
    expect(out.features).not.toContain('esign.bulk');
  });
});

describe('resolveFeatures - user_feature_overrides', () => {
  it('grant override unlocks a key the user\'s role would otherwise skip', async () => {
    const u = await seedUser(firmFirm.id, {
      email: `perm-grant-${Date.now()}@integration.test`,
      role: 'Associate',
      systemRole: 'Associate',
    });
    // Sanity: baseline run does NOT include admin.users.
    let out = await resolveFeatures(u.id);
    expect(out.features).not.toContain('admin.users');

    invalidatePermissionsCache();
    await addUserFeatureOverride(u.id, 'admin.users', 'grant');
    out = await resolveFeatures(u.id);
    // Firm plan permits admin.users, and the override now grants it to this
    // user - should appear.
    expect(out.features).toContain('admin.users');
  });

  it('deny override removes a key the user normally has', async () => {
    const u = await seedUser(firmFirm.id, {
      email: `perm-deny-${Date.now()}@integration.test`,
      role: 'Associate',
      systemRole: 'Associate',
    });
    let out = await resolveFeatures(u.id);
    expect(out.features).toContain('drafting.ai');

    invalidatePermissionsCache();
    await addUserFeatureOverride(u.id, 'drafting.ai', 'deny');
    out = await resolveFeatures(u.id);
    expect(out.features).not.toContain('drafting.ai');
  });

  it('grant override is ignored when the plan does NOT permit the feature', async () => {
    // Solo plan does not unlock esign.bulk. A grant override should NOT bypass
    // the plan layer - the resolver intersects grant overrides with plan_set.
    const u = await seedUser(firmSolo.id, {
      email: `perm-grant-plan-block-${Date.now()}@integration.test`,
      role: 'Firm Admin',
      systemRole: 'Firm Admin',
    });
    await addUserFeatureOverride(u.id, 'esign.bulk', 'grant');
    invalidatePermissionsCache();
    const out = await resolveFeatures(u.id);
    expect(out.features).not.toContain('esign.bulk');
  });
});
