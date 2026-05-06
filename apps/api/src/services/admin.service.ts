import bcrypt from 'bcryptjs';
import type {
  AdminCreateFirmRequest,
  AdminUpdateBrandingRequest,
  AdminUpdateFirmRequest,
  AdminUpdateFlagsRequest,
  AdminUpdatePlanRequest,
  AdminUpdateUserRequest,
  AdminUserSummary,
  FeatureFlag,
  FeatureModule,
  FirmBranding,
  FirmDetail,
  FirmPlan,
  FirmStatus,
  FirmSummary,
  PlatformStats,
  UserStatus,
} from '@lexdraft/types';
import { db } from '../db/client';
import { auditService } from './audit.service';

// ---------- shared row shapes -----------------------------------------------

interface FirmRow {
  id: string;
  name: string;
  seats: number;
  status: FirmStatus;
  plan_tier: FirmPlan['tier'];
  plan_status: FirmPlan['status'];
  mrr_inr: number;
  renews_at: Date | null;
  created_at: Date;
  case_count: number;
  seats_used: number;
}

interface BrandingRow {
  firm_id: string;
  display_name: string;
  logo_url: string | null;
  accent_color: string | null;
}

interface FlagRow {
  module: string;
  enabled: boolean;
  updated_at: Date;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  is_superadmin: boolean;
  firm_id: string | null;
  firm_name: string | null;
  status: UserStatus;
  created_at: Date;
  last_seen_at: Date | null;
}

const ALL_MODULES: FeatureModule[] = [
  'drafting', 'cases', 'contracts', 'billing', 'research',
  'limitation', 'ecourts', 'analytics', 'firm_dashboard',
];

function rowToFirmSummary(r: FirmRow): FirmSummary {
  return {
    id: r.id,
    name: r.name,
    seats: r.seats,
    seatsUsed: Number(r.seats_used ?? 0),
    caseCount: Number(r.case_count ?? 0),
    status: r.status,
    plan: {
      tier: r.plan_tier,
      status: r.plan_status,
      mrrInr: Number(r.mrr_inr ?? 0),
      renewsAt: r.renews_at ? r.renews_at.toISOString().slice(0, 10) : null,
    },
    createdAt: r.created_at.toISOString(),
  };
}

function rowToBranding(r: BrandingRow | undefined, fallbackName: string): FirmBranding {
  return {
    displayName: r?.display_name ?? fallbackName,
    logoUrl: r?.logo_url ?? null,
    accentColor: r?.accent_color ?? null,
  };
}

function rowToUserSummary(r: UserRow): AdminUserSummary {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    firmId: r.firm_id,
    firmName: r.firm_name,
    isSuperadmin: r.is_superadmin,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    lastSeenAt: r.last_seen_at ? r.last_seen_at.toISOString() : null,
  };
}

function withDefaults(rows: FlagRow[]): FeatureFlag[] {
  const present = new Map(rows.map((r) => [r.module, r]));
  return ALL_MODULES.map<FeatureFlag>((module) => {
    const r = present.get(module);
    return {
      module,
      enabled: r?.enabled ?? true,
      updatedAt: r?.updated_at?.toISOString() ?? new Date(0).toISOString(),
    };
  });
}

// ---------- public API ------------------------------------------------------

export const adminService = {
  // ---- firms --------------------------------------------------------------

  async listFirms(): Promise<FirmSummary[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<FirmRow[]>`
      select f.id, f.name, f.seats, f.status, f.plan_tier, f.plan_status,
             f.mrr_inr, f.renews_at, f.created_at,
             coalesce((select count(*) from cases c where c.firm_id = f.id), 0)::int as case_count,
             coalesce((select count(*) from users u where u.firm_id = f.id and u.status = 'active'), 0)::int as seats_used
      from firms f
      order by f.created_at desc
    `;
    return rows.map(rowToFirmSummary);
  },

  async getFirm(id: string): Promise<FirmDetail | null> {
    const sql = db();
    if (!sql) return null;
    const firmRows = await sql<FirmRow[]>`
      select f.id, f.name, f.seats, f.status, f.plan_tier, f.plan_status,
             f.mrr_inr, f.renews_at, f.created_at,
             coalesce((select count(*) from cases c where c.firm_id = f.id), 0)::int as case_count,
             coalesce((select count(*) from users u where u.firm_id = f.id and u.status = 'active'), 0)::int as seats_used
      from firms f where f.id = ${id}::uuid limit 1
    `;
    const firm = firmRows[0];
    if (!firm) return null;

    const [brandingRows, flagRows, memberRows, recentAudit] = await Promise.all([
      sql<BrandingRow[]>`select firm_id, display_name, logo_url, accent_color from firm_branding where firm_id = ${id}::uuid limit 1`,
      sql<FlagRow[]>`select module, enabled, updated_at from feature_flags where firm_id = ${id}::uuid`,
      sql<UserRow[]>`
        select u.id, u.name, u.email, u.role, u.is_superadmin, u.firm_id,
               f.name as firm_name, u.status, u.created_at, u.last_seen_at
        from users u left join firms f on f.id = u.firm_id
        where u.firm_id = ${id}::uuid
        order by u.created_at asc
      `,
      auditService.recentForFirm(id, 20),
    ]);

    return {
      ...rowToFirmSummary(firm),
      branding: rowToBranding(brandingRows[0], firm.name),
      flags: withDefaults(flagRows),
      members: memberRows.map(rowToUserSummary),
      recentAudit,
    };
  },

  async createFirm(input: AdminCreateFirmRequest, actor: { id: string; email: string }): Promise<FirmSummary> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');

    const rows = await sql<{ id: string }[]>`
      insert into firms (name, seats, plan_tier)
      values (${input.name}, ${input.seats}, ${input.plan})
      returning id
    `;
    const firmId = rows[0]!.id;

    // Default branding mirrors the firm name; default flags = all enabled.
    await sql`insert into firm_branding (firm_id, display_name) values (${firmId}::uuid, ${input.name})`;
    await sql`
      insert into feature_flags (firm_id, module, enabled)
      select ${firmId}::uuid, m, true from unnest(${ALL_MODULES as unknown as string[]}::text[]) as m
    `;

    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'firm.create', targetType: 'firm', targetId: firmId,
      payload: { name: input.name, seats: input.seats, plan: input.plan },
    });

    const detail = await this.getFirm(firmId);
    if (!detail) throw new Error('Firm vanished after create');
    return detail;
  },

  async updateFirm(id: string, patch: AdminUpdateFirmRequest, actor: { id: string; email: string }): Promise<FirmSummary> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    await sql`
      update firms set
        name   = coalesce(${patch.name ?? null}, name),
        seats  = coalesce(${patch.seats ?? null}, seats),
        status = coalesce(${patch.status ?? null}::firm_status, status),
        suspended_at = case
          when ${patch.status ?? null}::firm_status = 'suspended' then now()
          when ${patch.status ?? null}::firm_status = 'active'    then null
          else suspended_at
        end
      where id = ${id}::uuid
    `;
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: patch.status === 'suspended' ? 'firm.suspend'
            : patch.status === 'active'    ? 'firm.reactivate'
            : 'firm.update',
      targetType: 'firm', targetId: id, payload: patch,
    });
    const detail = await this.getFirm(id);
    if (!detail) throw new Error('Firm not found after update');
    return detail;
  },

  async deleteFirm(id: string, actor: { id: string; email: string }): Promise<void> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    await sql`delete from firms where id = ${id}::uuid`;
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'firm.delete', targetType: 'firm', targetId: id, payload: null,
    });
  },

  // ---- plan ---------------------------------------------------------------

  async updatePlan(id: string, patch: AdminUpdatePlanRequest, actor: { id: string; email: string }): Promise<FirmPlan> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    await sql`
      update firms set
        plan_tier   = coalesce(${patch.tier ?? null}::firm_plan_tier, plan_tier),
        plan_status = coalesce(${patch.status ?? null}::billing_status, plan_status),
        mrr_inr     = coalesce(${patch.mrrInr ?? null}, mrr_inr),
        renews_at   = case when ${patch.renewsAt === undefined ? 1 : 0}::int = 1
                           then renews_at
                           else ${patch.renewsAt ?? null}::date end
      where id = ${id}::uuid
    `;
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'firm.plan.update', targetType: 'firm', targetId: id, payload: patch,
    });
    const rows = await sql<Array<Pick<FirmRow, 'plan_tier' | 'plan_status' | 'mrr_inr' | 'renews_at'>>>`
      select plan_tier, plan_status, mrr_inr, renews_at from firms where id = ${id}::uuid limit 1
    `;
    const r = rows[0];
    if (!r) throw new Error('Firm not found');
    return {
      tier: r.plan_tier,
      status: r.plan_status,
      mrrInr: Number(r.mrr_inr ?? 0),
      renewsAt: r.renews_at ? r.renews_at.toISOString().slice(0, 10) : null,
    };
  },

  // ---- flags --------------------------------------------------------------

  async updateFlags(id: string, patch: AdminUpdateFlagsRequest, actor: { id: string; email: string }): Promise<FeatureFlag[]> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    await sql.begin(async (tx) => {
      for (const f of patch.flags) {
        await tx`
          insert into feature_flags (firm_id, module, enabled)
          values (${id}::uuid, ${f.module}, ${f.enabled})
          on conflict (firm_id, module) do update set enabled = excluded.enabled, updated_at = now()
        `;
      }
    });
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'firm.flags.update', targetType: 'firm', targetId: id, payload: { flags: patch.flags },
    });
    const rows = await sql<FlagRow[]>`select module, enabled, updated_at from feature_flags where firm_id = ${id}::uuid`;
    return withDefaults(rows);
  },

  // ---- branding -----------------------------------------------------------

  async updateBranding(id: string, patch: AdminUpdateBrandingRequest, actor: { id: string; email: string }): Promise<FirmBranding> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    await sql`
      insert into firm_branding (firm_id, display_name, logo_url, accent_color)
      values (
        ${id}::uuid,
        ${patch.displayName ?? ''},
        ${patch.logoUrl ?? null},
        ${patch.accentColor ?? null}
      )
      on conflict (firm_id) do update set
        display_name = coalesce(nullif(${patch.displayName ?? null}, ''), firm_branding.display_name),
        logo_url     = case when ${patch.logoUrl === undefined ? 1 : 0}::int = 1 then firm_branding.logo_url     else ${patch.logoUrl ?? null} end,
        accent_color = case when ${patch.accentColor === undefined ? 1 : 0}::int = 1 then firm_branding.accent_color else ${patch.accentColor ?? null} end,
        updated_at   = now()
    `;
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'firm.branding.update', targetType: 'firm', targetId: id, payload: patch,
    });
    const rows = await sql<BrandingRow[]>`
      select firm_id, display_name, logo_url, accent_color from firm_branding where firm_id = ${id}::uuid limit 1
    `;
    const fname = await sql<{ name: string }[]>`select name from firms where id = ${id}::uuid limit 1`;
    return rowToBranding(rows[0], fname[0]?.name ?? '');
  },

  // ---- users (cross-firm) -------------------------------------------------

  async listUsers(filter: { firmId?: string | null; status?: UserStatus; q?: string } = {}): Promise<AdminUserSummary[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<UserRow[]>`
      select u.id, u.name, u.email, u.role, u.is_superadmin, u.firm_id,
             f.name as firm_name, u.status, u.created_at, u.last_seen_at
      from users u
      left join firms f on f.id = u.firm_id
      where (${filter.firmId ?? null}::uuid is null or u.firm_id = ${filter.firmId ?? null}::uuid)
        and (${filter.status ?? null}::user_status is null or u.status = ${filter.status ?? null}::user_status)
        and (
          ${filter.q ?? null}::text is null
          or lower(u.name) like '%' || lower(${filter.q ?? null}) || '%'
          or lower(u.email) like '%' || lower(${filter.q ?? null}) || '%'
        )
      order by u.created_at desc
      limit 500
    `;
    return rows.map(rowToUserSummary);
  },

  async updateUser(id: string, patch: AdminUpdateUserRequest, actor: { id: string; email: string }): Promise<AdminUserSummary> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    await sql`
      update users set
        role          = coalesce(${patch.role ?? null}, role),
        status        = coalesce(${patch.status ?? null}::user_status, status),
        is_superadmin = coalesce(${patch.isSuperadmin ?? null}, is_superadmin),
        firm_id       = case when ${patch.firmId === undefined ? 1 : 0}::int = 1
                             then firm_id
                             else ${patch.firmId ?? null}::uuid end,
        suspended_at  = case
          when ${patch.status ?? null}::user_status = 'suspended' then now()
          when ${patch.status ?? null}::user_status = 'active'    then null
          else suspended_at
        end
      where id = ${id}::uuid
    `;
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: patch.status === 'suspended' ? 'user.suspend'
            : patch.status === 'active'    ? 'user.reactivate'
            : 'user.update',
      targetType: 'user', targetId: id, payload: patch,
    });
    const rows = await sql<UserRow[]>`
      select u.id, u.name, u.email, u.role, u.is_superadmin, u.firm_id,
             f.name as firm_name, u.status, u.created_at, u.last_seen_at
      from users u left join firms f on f.id = u.firm_id
      where u.id = ${id}::uuid limit 1
    `;
    const r = rows[0];
    if (!r) throw new Error('User not found');
    return rowToUserSummary(r);
  },

  async deleteUser(id: string, actor: { id: string; email: string }): Promise<void> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    await sql`delete from users where id = ${id}::uuid`;
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'user.delete', targetType: 'user', targetId: id, payload: null,
    });
  },

  /** Generate a random temp password, hash it, store it, and return the
   *  plaintext to the admin so they can communicate it out-of-band. In real
   *  prod this would email a reset link instead. */
  async resetUserPassword(id: string, actor: { id: string; email: string }): Promise<{ tempPassword: string }> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const tempPassword = Array.from(crypto.getRandomValues(new Uint8Array(9)))
      .map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31])
      .join('');
    const hash = await bcrypt.hash(tempPassword, 10);
    await sql`update users set password_hash = ${hash} where id = ${id}::uuid`;
    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'user.password_reset', targetType: 'user', targetId: id, payload: null,
    });
    return { tempPassword };
  },

  // ---- platform stats -----------------------------------------------------

  async platformStats(): Promise<PlatformStats> {
    const sql = db();
    if (!sql) {
      return {
        firms: { total: 0, active: 0, suspended: 0 },
        users: { total: 0, active: 0, superadmins: 0 },
        mrrInr: 0, caseCount: 0, recentAudit: [],
      };
    }
    const [firmCounts, userCounts, mrr, cases, recentAudit] = await Promise.all([
      sql<Array<{ total: number; active: number; suspended: number }>>`
        select count(*)::int as total,
               count(*) filter (where status = 'active')::int as active,
               count(*) filter (where status = 'suspended')::int as suspended
        from firms
      `,
      sql<Array<{ total: number; active: number; superadmins: number }>>`
        select count(*)::int as total,
               count(*) filter (where status = 'active')::int as active,
               count(*) filter (where is_superadmin)::int as superadmins
        from users
      `,
      sql<Array<{ mrr: number }>>`select coalesce(sum(mrr_inr), 0)::int as mrr from firms where status = 'active'`,
      sql<Array<{ cases: number }>>`select count(*)::int as cases from cases`,
      auditService.list({ limit: 10 }),
    ]);
    return {
      firms: firmCounts[0] ?? { total: 0, active: 0, suspended: 0 },
      users: userCounts[0] ?? { total: 0, active: 0, superadmins: 0 },
      mrrInr: mrr[0]?.mrr ?? 0,
      caseCount: cases[0]?.cases ?? 0,
      recentAudit,
    };
  },
};
