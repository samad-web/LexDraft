/**
 * Firm-admin service - backs the /firm/users, /firm/roles, /firm/practice-groups
 * routes used by the in-app User Management section (spec §7).
 *
 * Tenant isolation: every query is scoped to the caller's firm_id, looked up
 * from `users.firm_id` rather than trusting client input.
 */

import bcrypt from 'bcryptjs';
import type {
  FirmCreateUserRequest,
  FirmCreateUserResponse,
  FirmManagedUser,
  FirmUpdateUserRequest,
  PracticeGroup,
  Role,
  UserStatus,
} from '@lexdraft/types';
import { db } from '../db/client';
import { auditService } from './audit.service';
import { invalidatePermissionsCache } from './permissions.service';
import { invalidateTenantCache } from './tenant';

interface ManagedUserRow {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  is_superadmin: boolean;
  role_id: string | null;
  role_name: string | null;
  role_is_system: boolean | null;
  pg_id: string | null;
  pg_name: string | null;
  last_seen_at: Date | null;
  created_at: Date;
}

interface RoleRow {
  id: string;
  firm_id: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
  base_role_id: string | null;
  user_count: string | number;
}

interface PgRow {
  id: string;
  firm_id: string;
  name: string;
  lead_user_id: string | null;
  archived_at: Date | null;
  member_count: string | number;
}

function rowToManagedUser(r: ManagedUserRow): FirmManagedUser {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    status: r.status,
    isSuperadmin: r.is_superadmin,
    role: r.role_id
      ? { id: r.role_id, name: r.role_name ?? '', isSystem: !!r.role_is_system }
      : null,
    practiceGroup: r.pg_id ? { id: r.pg_id, name: r.pg_name ?? '' } : null,
    lastSeenAt: r.last_seen_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
  };
}

function rowToRole(r: RoleRow): Role {
  return {
    id: r.id,
    firmId: r.firm_id,
    name: r.name,
    description: r.description,
    isSystem: r.is_system,
    baseRoleId: r.base_role_id,
    userCount: Number(r.user_count ?? 0),
  };
}

function rowToPracticeGroup(r: PgRow): PracticeGroup {
  return {
    id: r.id,
    firmId: r.firm_id,
    name: r.name,
    leadUserId: r.lead_user_id,
    archivedAt: r.archived_at?.toISOString() ?? null,
    memberCount: Number(r.member_count ?? 0),
  };
}

async function loadCallerFirmId(userId: string): Promise<string | null> {
  const sql = db();
  if (!sql) return null;
  const [row] = await sql<Array<{ firm_id: string | null }>>`
    select firm_id from users where id = ${userId}::uuid limit 1
  `;
  return row?.firm_id ?? null;
}

export const firmAdminService = {
  /** Direct user creation by a Firm Admin (spec §3.3 alt). Bypasses the
   *  invite-link flow when the admin already knows the credentials. Tenant
   *  isolation: the new user always lands in the caller's firm; the role and
   *  practice-group references are validated against that firm too. */
  async createUser(
    callerId: string,
    input: FirmCreateUserRequest,
    actor: { id: string; email: string },
  ): Promise<FirmCreateUserResponse> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');

    const firmId = await loadCallerFirmId(callerId);
    if (!firmId) {
      throw Object.assign(new Error('Caller has no firm'), { status: 403 });
    }

    // ---- pre-flight validation ------------------------------------------
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw Object.assign(new Error('Invalid email'), { status: 422 });
    }

    const [existing] = await sql<Array<{ id: string }>>`
      select id from users where lower(email) = ${email} limit 1
    `;
    if (existing) {
      throw Object.assign(
        new Error(`A user with email "${email}" already exists.`),
        { status: 409 },
      );
    }

    // Role must be either a system role (firm_id IS NULL) or a custom role
    // belonging to the caller's firm. Anything else is a tenant-isolation
    // violation and returns 404 (don't leak existence of other firms' roles).
    const [roleRow] = await sql<Array<{ id: string; name: string; firm_id: string | null }>>`
      select id, name, firm_id from roles
      where id = ${input.roleId}::uuid
        and (firm_id is null or firm_id = ${firmId}::uuid)
      limit 1
    `;
    if (!roleRow) {
      throw Object.assign(new Error('Role not found in this firm'), { status: 404 });
    }

    // Practice group, if supplied, must also belong to this firm.
    if (input.practiceGroupId) {
      const [pgRow] = await sql<Array<{ id: string }>>`
        select id from practice_groups
        where id = ${input.practiceGroupId}::uuid and firm_id = ${firmId}::uuid
        limit 1
      `;
      if (!pgRow) {
        throw Object.assign(new Error('Practice group not in this firm'), { status: 404 });
      }
    }

    // Resolve display name first because the auto-password depends on it.
    const name = input.name?.trim()
      || (email.split('@')[0] ?? '')
        .split(/[._-]+/)
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ')
      || email;

    // Generate `${FirstName}@123` if no password supplied - same pattern as
    // adminService.createFirm.
    let plaintextPassword = input.password?.trim();
    let generated = false;
    if (!plaintextPassword) {
      const firstToken = name.split(/\s+/)[0] ?? '';
      const sanitized  = firstToken.replace(/[^A-Za-z0-9]/g, '');
      const firstName  = sanitized.length > 0
        ? sanitized.charAt(0).toUpperCase() + sanitized.slice(1).toLowerCase()
        : 'User';
      plaintextPassword = `${firstName}@123`;
      generated = true;
    } else if (plaintextPassword.length < 8) {
      throw Object.assign(new Error('Password must be at least 8 characters'), { status: 422 });
    }
    const passwordHash = await bcrypt.hash(plaintextPassword, 10);

    // ---- insert ----------------------------------------------------------
    const [inserted] = await sql<Array<{ id: string }>>`
      insert into users (
        firm_id, name, email, role, role_id, practice_group_id,
        is_superadmin, password_hash, status
      ) values (
        ${firmId}::uuid,
        ${name},
        ${email},
        ${roleRow.name},
        ${roleRow.id}::uuid,
        ${input.practiceGroupId ?? null}::uuid,
        ${false},
        ${passwordHash},
        ${'active'}::user_status
      )
      returning id
    `;
    const newUserId = inserted!.id;

    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: 'user.update', // closest existing AuditAction; specific 'user.create' could be added later
      targetType: 'user', targetId: newUserId,
      payload: {
        kind: 'firm.user.create',
        email, name,
        roleId: roleRow.id,
        practiceGroupId: input.practiceGroupId ?? null,
        passwordSource: generated ? 'generated' : 'supplied',
      },
    });

    // Reload the rich shape for the response so the UI can show the new row
    // immediately without a list-refetch.
    const [row] = await sql<ManagedUserRow[]>`
      select u.id, u.name, u.email, u.status, u.is_superadmin,
             r.id as role_id, r.name as role_name, r.is_system as role_is_system,
             pg.id as pg_id, pg.name as pg_name,
             u.last_seen_at, u.created_at
      from users u
      left join roles r on r.id = u.role_id
      left join practice_groups pg on pg.id = u.practice_group_id
      where u.id = ${newUserId}::uuid
      limit 1
    `;
    if (!row) throw new Error('User vanished after create');

    return {
      user: rowToManagedUser(row),
      ...(generated ? { tempPassword: plaintextPassword } : {}),
    };
  },

  async listUsers(callerId: string): Promise<FirmManagedUser[]> {
    const sql = db();
    if (!sql) return [];
    const firmId = await loadCallerFirmId(callerId);
    if (!firmId) return [];
    const rows = await sql<ManagedUserRow[]>`
      select u.id, u.name, u.email, u.status, u.is_superadmin,
             r.id as role_id, r.name as role_name, r.is_system as role_is_system,
             pg.id as pg_id, pg.name as pg_name,
             u.last_seen_at, u.created_at
      from users u
      left join roles r on r.id = u.role_id
      left join practice_groups pg on pg.id = u.practice_group_id
      where u.firm_id = ${firmId}::uuid
      order by u.created_at desc
    `;
    return rows.map(rowToManagedUser);
  },

  async updateUser(
    callerId: string,
    targetId: string,
    patch: FirmUpdateUserRequest,
    actor: { id: string; email: string },
  ): Promise<FirmManagedUser> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');

    const firmId = await loadCallerFirmId(callerId);
    if (!firmId) throw Object.assign(new Error('Caller has no firm'), { status: 403 });

    // Tenant isolation: target must be in caller's firm.
    const [targetFirm] = await sql<Array<{ firm_id: string | null }>>`
      select firm_id from users where id = ${targetId}::uuid limit 1
    `;
    if (!targetFirm || targetFirm.firm_id !== firmId) {
      throw Object.assign(new Error('User is not in this firm'), { status: 404 });
    }

    // Last-admin protection - same logic as the platform-admin path.
    if (patch.roleId !== undefined || patch.status === 'suspended' || patch.status === 'deactivated') {
      const [adminCheck] = await sql<Array<{ is_admin: boolean }>>`
        select (r.name = 'Firm Admin' and r.is_system = true) as is_admin
        from users u left join roles r on r.id = u.role_id
        where u.id = ${targetId}::uuid limit 1
      `;
      if (adminCheck?.is_admin) {
        const [count] = await sql<Array<{ c: string | number }>>`
          select count(*)::int as c
          from users u
          join roles r on r.id = u.role_id
          where u.firm_id = ${firmId}::uuid
            and r.name = 'Firm Admin' and r.is_system = true
            and u.status = 'active'
            and u.id <> ${targetId}::uuid
        `;
        if (Number(count?.c ?? 0) === 0) {
          throw Object.assign(
            new Error('Last active Firm Admin - promote another admin first.'),
            { status: 422 },
          );
        }
      }
    }

    await sql`
      update users set
        role_id           = coalesce(${patch.roleId ?? null}::uuid, role_id),
        practice_group_id = case when ${patch.practiceGroupId === undefined ? 1 : 0}::int = 1
                                 then practice_group_id
                                 else ${patch.practiceGroupId ?? null}::uuid end,
        status            = coalesce(${patch.status ?? null}::user_status, status),
        suspended_at      = case
          when ${patch.status ?? null}::user_status = 'suspended' then now()
          when ${patch.status ?? null}::user_status = 'active'    then null
          else suspended_at
        end
      where id = ${targetId}::uuid
    `;
    invalidatePermissionsCache(targetId);
    invalidateTenantCache(targetId);

    await auditService.write({
      actorUserId: actor.id, actorEmail: actor.email,
      action: patch.status === 'suspended' ? 'user.suspend'
            : patch.status === 'active'    ? 'user.reactivate'
            : 'user.update',
      targetType: 'user', targetId, payload: patch,
    });

    const [row] = await sql<ManagedUserRow[]>`
      select u.id, u.name, u.email, u.status, u.is_superadmin,
             r.id as role_id, r.name as role_name, r.is_system as role_is_system,
             pg.id as pg_id, pg.name as pg_name,
             u.last_seen_at, u.created_at
      from users u
      left join roles r on r.id = u.role_id
      left join practice_groups pg on pg.id = u.practice_group_id
      where u.id = ${targetId}::uuid
      limit 1
    `;
    if (!row) throw new Error('User not found after update');
    return rowToManagedUser(row);
  },

  /** Lists every role available to assign in this firm - system roles plus any
   *  custom roles the firm has created. Phase 2 will surface a role-editor UI
   *  on top of this read endpoint. */
  async listAvailableRoles(callerId: string): Promise<Role[]> {
    const sql = db();
    if (!sql) return [];
    const firmId = await loadCallerFirmId(callerId);
    const rows = await sql<RoleRow[]>`
      select r.id, r.firm_id, r.name, r.description, r.is_system, r.base_role_id,
             coalesce(c.cnt, 0) as user_count
      from roles r
      left join (
        select role_id, count(*) as cnt
        from users
        where firm_id = ${firmId ?? null}::uuid
        group by role_id
      ) c on c.role_id = r.id
      where r.firm_id is null or r.firm_id = ${firmId ?? null}::uuid
      order by r.is_system desc, r.name asc
    `;
    return rows.map(rowToRole);
  },

  async listPracticeGroups(callerId: string): Promise<PracticeGroup[]> {
    const sql = db();
    if (!sql) return [];
    const firmId = await loadCallerFirmId(callerId);
    if (!firmId) return [];
    const rows = await sql<PgRow[]>`
      select pg.id, pg.firm_id, pg.name, pg.lead_user_id, pg.archived_at,
             coalesce(c.cnt, 0) as member_count
      from practice_groups pg
      left join (
        select practice_group_id, count(*) as cnt from users
        group by practice_group_id
      ) c on c.practice_group_id = pg.id
      where pg.firm_id = ${firmId}::uuid
      order by pg.archived_at nulls first, pg.name asc
    `;
    return rows.map(rowToPracticeGroup);
  },
};
