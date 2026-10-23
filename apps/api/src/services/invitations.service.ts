import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type {
  AcceptInvitationRequest,
  AuthResponse,
  CreateInvitationRequest,
  CustomRoleAccess,
  Invitation,
  InvitationPublic,
  InvitationStatus,
  User,
} from '@lexdraft/types';
import { env } from '../env';
import { db } from '../db/client';
import { jobs } from './jobs.service';
import { logger } from '../logger';
import { systemRoleNameFor } from './auth.service';

const INVITATION_TTL_DAYS = 7;
// Dev/demo fallback when an inviter has no firm attached. Must NOT be used to
// scope reads/writes - those always derive firmId from the caller.
const FALLBACK_FIRM_ID = '00000000-0000-0000-0000-000000000001';

interface Inviter {
  id: string;
  name: string;
  email: string;
  firm?: string;
}

interface InvitationRow {
  id: string;
  firm_id: string | null;
  email: string;
  role: string;
  firm_name: string;
  invited_by_id: string | null;
  invited_by_name: string;
  status: InvitationStatus;
  token: string;
  expires_at: string | Date;
  accepted_at: string | Date | null;
  message: string | null;
  created_at: string | Date;
}

/** Internal carrier - firmId is not part of the public Invitation type. */
interface InvitationWithFirm {
  inv: Invitation;
  firmId: string | null;
}

// Exported for co-counsel.service.ts, which inserts its own `invitations`
// rows (kind='co_counsel_handover') rather than going through
// invitationsService.create - that path is email-only and firm-member-role
// specific. Pure/stateless, safe to share.
export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}
export function generateId(): string {
  return `inv_${randomBytes(8).toString('hex')}`;
}
export function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
function toIso(v: string | Date | null | undefined): string {
  if (!v) return '';
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function fromRow(r: InvitationRow): Invitation {
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    firm: r.firm_name,
    invitedBy: { id: r.invited_by_id ?? '', name: r.invited_by_name },
    status: r.status,
    token: r.token,
    expiresAt: toIso(r.expires_at),
    createdAt: toIso(r.created_at),
    acceptedAt: r.accepted_at ? toIso(r.accepted_at) : undefined,
    message: r.message ?? undefined,
  };
}

function toPublic(inv: Invitation): InvitationPublic {
  return {
    email: inv.email,
    role: inv.role,
    firm: inv.firm,
    invitedBy: inv.invitedBy.name,
    expiresAt: inv.expiresAt,
    message: inv.message,
  };
}

// In-memory fallback (used only when DATABASE_URL is blank). The companion
// firmId map keeps tenant scoping in dev demos that span multiple firms.
const memInvites = new Map<string, Invitation>();
const memInviteFirm = new Map<string, string | null>();
const memByToken = new Map<string, string>();

const INVITATION_SELECT = `
  select id, firm_id, email, role, firm_name, invited_by_id, invited_by_name, status,
         token, expires_at, accepted_at, message, created_at
  from invitations
`;

interface SeatRow { seats: number; used: number }

/**
 * Reject when (active users + pending invites) would exceed the firm's seat
 * cap. Counted at invite time so admins get clean feedback before sending the
 * email. Re-checked at accept() time to catch races where multiple invites
 * land in the same window.
 *
 * Returns silently when firmId is null (dev fallback firm or unauthenticated
 * paths). Returns silently when DATABASE_URL is unset (demo mode).
 */
async function assertSeatCapNotExceeded(firmId: string | null): Promise<void> {
  if (!firmId) return;
  const sql = db();
  if (!sql) return;
  const [row] = await sql<SeatRow[]>`
    select
      f.seats,
      ((select count(*)::int from users
        where firm_id = ${firmId}::uuid and status = 'active')
       + (select count(*)::int from invitations
          where firm_id = ${firmId}::uuid and status = 'pending')) as used
    from firms f
    where f.id = ${firmId}::uuid
    limit 1
  `;
  if (!row) return;
  if (row.used >= row.seats) {
    throw Object.assign(
      new Error(
        `Seat cap reached (${row.used} of ${row.seats}). Upgrade your plan to invite more advocates.`,
      ),
      { status: 402, code: 'seat_cap_exceeded', cap: row.seats, used: row.used },
    );
  }
}

const PRESET_ROLES = new Set([
  'Managing Partner', 'Senior Associate', 'Associate', 'Junior Associate', 'Of Counsel', 'Paralegal',
]);

/**
 * "Other" invites: the inviter names the role (e.g. "Office Manager") and picks
 * the access level it inherits. Stored as a firm-scoped custom role whose
 * base_role_id points at that system role; the permission resolver follows
 * base_role_id. Reuses an existing firm role of the same name (case-insensitive)
 * so inviting a second "Office Manager" doesn't fork the role.
 */
async function ensureCustomRole(firmId: string, name: string, access: CustomRoleAccess): Promise<string> {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length < 2 || clean.length > 60) {
    throw Object.assign(new Error('Role name must be 2 to 60 characters'), { status: 400 });
  }
  if (PRESET_ROLES.has(clean) || systemRoleNameFor(clean)) {
    // A preset name typed into "Other" should just be that preset.
    return clean;
  }
  const sql = db();
  if (!sql) return clean;
  const [system] = await sql<Array<{ id: string; name: string }>>`
    select id, name from roles where firm_id is null and is_system = true and name = ${access} limit 1
  `;
  if (!system) throw Object.assign(new Error('Unknown access level'), { status: 400 });
  const [clash] = await sql<Array<{ id: string }>>`
    select id from roles where firm_id is null and is_system = true and lower(name) = lower(${clean}) limit 1
  `;
  if (clash) throw Object.assign(new Error(`"${clean}" is a built-in role name. Pick it from the list instead.`), { status: 400 });
  await sql`
    insert into roles (firm_id, name, description, is_system, base_role_id)
    values (${firmId}::uuid, ${clean}, ${`Custom role with ${system.name} access`}, false, ${system.id}::uuid)
    on conflict (firm_id, lower(name)) where firm_id is not null do nothing
  `;
  return clean;
}

/** Email the acceptance link. Returns false when SMTP isn't configured (the
 *  mail would only be logged), so the UI can tell the inviter to share the
 *  link themselves. Never throws - the invitation already exists. */
async function sendInvitationEmail(inv: Invitation, replyTo?: string | null): Promise<boolean> {
  if (!env.hasSmtp) return false;
  const link = `${env.webPublicBaseUrl.replace(/\/+$/, '')}/invite/${inv.token}`;
  try {
    await jobs.enqueue('email.send', {
      to: inv.email,
      // Reads as coming from the inviter; replies reach their sign-in email.
      fromName: `${inv.invitedBy.name} (via LexDraft)`,
      ...(replyTo ? { replyTo } : {}),
      subject: `${inv.invitedBy.name} invited you to join ${inv.firm} on LexDraft`,
      body: [
        `Hello,`,
        ``,
        `${inv.invitedBy.name} has invited you to join ${inv.firm} on LexDraft as ${inv.role}.`,
        ...(inv.message ? [``, `"${inv.message}"`] : []),
        ``,
        `Accept the invitation and set your password here:`,
        link,
        ``,
        `This link expires on ${new Date(inv.expiresAt).toDateString()}.`,
      ].join('\n'),
    });
    return true;
  } catch (err) {
    logger.warn({ err, invitationId: inv.id }, 'invitation email enqueue failed');
    return false;
  }
}

export const invitationsService = {
  async list(firmId: string | null): Promise<Invitation[]> {
    if (!firmId) return [];
    const sql = db();
    if (sql) {
      await sql`update invitations set status = 'expired' where status = 'pending' and expires_at < now() and firm_id = ${firmId}::uuid`;
      const rows = await sql<InvitationRow[]>`
        ${sql.unsafe(INVITATION_SELECT)}
        where firm_id = ${firmId}::uuid
        order by created_at desc
      `;
      return rows.map(fromRow);
    }
    const now = Date.now();
    const out: Invitation[] = [];
    for (const inv of memInvites.values()) {
      if (memInviteFirm.get(inv.id) !== firmId) continue;
      if (inv.status === 'pending' && new Date(inv.expiresAt).getTime() < now) {
        memInvites.set(inv.id, { ...inv, status: 'expired' });
      }
      out.push(memInvites.get(inv.id)!);
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async create(
    input: CreateInvitationRequest,
    inviter: Inviter,
    firmId: string | null,
  ): Promise<Invitation> {
    // Enforce seat cap before allocating the invite. Failing here keeps the
    // pending-invites table free of unfillable entries and gives the admin
    // an actionable 402 with the current usage in the error payload.
    await assertSeatCapNotExceeded(firmId);

    let role: string = input.role;
    if (input.role === 'Other') {
      if (!input.customRoleName?.trim() || !input.accessLevel) {
        throw Object.assign(new Error('Name the role and choose its access level'), { status: 400 });
      }
      if (!firmId) throw Object.assign(new Error('No firm attached'), { status: 422 });
      role = await ensureCustomRole(firmId, input.customRoleName, input.accessLevel);
    }

    const email = input.email.toLowerCase().trim();
    const id = generateId();
    const token = generateToken();
    const expiresAt = isoPlusDays(INVITATION_TTL_DAYS);
    const firm = inviter.firm ?? 'Sharma & Associates';
    const inviterUuid = /^[0-9a-f-]{36}$/i.test(inviter.id) ? inviter.id : null;
    const persistedFirmId = firmId ?? FALLBACK_FIRM_ID;

    const sql = db();
    if (sql) {
      // Duplicate-pending check is firm-scoped - different firms can each
      // invite the same email address independently.
      const dup = await sql<{ id: string }[]>`
        select id from invitations
        where lower(email) = ${email}
          and status = 'pending'
          and firm_id = ${persistedFirmId}::uuid
        limit 1
      `;
      if (dup.length > 0) {
        throw Object.assign(new Error('An invitation is already pending for this email'), { status: 409 });
      }
      const rows = await sql<InvitationRow[]>`
        insert into invitations (
          id, firm_id, email, role, firm_name, invited_by_id, invited_by_name,
          status, token, expires_at, message
        ) values (
          ${id}, ${persistedFirmId}, ${email}, ${role}, ${firm},
          ${inviterUuid}, ${inviter.name},
          'pending', ${token}, ${expiresAt}, ${input.message?.trim() || null}
        )
        returning id, firm_id, email, role, firm_name, invited_by_id, invited_by_name,
                  status, token, expires_at, accepted_at, message, created_at
      `;
      const created = fromRow(rows[0]!);
      return { ...created, emailSent: await sendInvitationEmail(created, inviter.email) };
    }

    for (const existing of memInvites.values()) {
      if (
        existing.email === email &&
        existing.status === 'pending' &&
        memInviteFirm.get(existing.id) === persistedFirmId
      ) {
        throw Object.assign(new Error('An invitation is already pending for this email'), { status: 409 });
      }
    }
    const inv: Invitation = {
      id,
      email,
      role,
      firm,
      invitedBy: { id: inviter.id, name: inviter.name },
      status: 'pending',
      token,
      expiresAt,
      createdAt: new Date().toISOString(),
      message: input.message?.trim() || undefined,
    };
    memInvites.set(inv.id, inv);
    memInviteFirm.set(inv.id, persistedFirmId);
    memByToken.set(inv.token, inv.id);
    return inv;
  },

  async cancel(id: string, firmId: string | null): Promise<boolean> {
    if (!firmId) return false;
    const sql = db();
    if (sql) {
      const rows = await sql`
        update invitations set status = 'cancelled'
        where id = ${id}
          and status = 'pending'
          and firm_id = ${firmId}::uuid
        returning id
      `;
      return rows.length > 0;
    }
    const inv = memInvites.get(id);
    if (!inv || inv.status !== 'pending') return false;
    if (memInviteFirm.get(id) !== firmId) return false;
    memInvites.set(id, { ...inv, status: 'cancelled' });
    memByToken.delete(inv.token);
    return true;
  },

  async resend(id: string, firmId: string | null): Promise<Invitation | undefined> {
    if (!firmId) return undefined;
    const sql = db();
    // Keep the token: links the inviter already shared (WhatsApp etc.) must
    // keep working. Only the expiry is extended. To kill a leaked link,
    // cancel the invitation and invite again.
    const newExpires = isoPlusDays(INVITATION_TTL_DAYS);
    if (sql) {
      const rows = await sql<InvitationRow[]>`
        update invitations set expires_at = ${newExpires}
        where id = ${id}
          and status = 'pending'
          and firm_id = ${firmId}::uuid
        returning id, firm_id, email, role, firm_name, invited_by_id, invited_by_name,
                  status, token, expires_at, accepted_at, message, created_at
      `;
      const row = rows[0];
      if (!row) return undefined;
      const refreshed = fromRow(row);
      const [inviter] = row.invited_by_id
        ? await sql<Array<{ email: string }>>`select email from users where id = ${row.invited_by_id}::uuid limit 1`
        : [];
      return { ...refreshed, emailSent: await sendInvitationEmail(refreshed, inviter?.email) };
    }
    const inv = memInvites.get(id);
    if (!inv || inv.status !== 'pending') return undefined;
    if (memInviteFirm.get(id) !== firmId) return undefined;
    const refreshed: Invitation = { ...inv, expiresAt: newExpires };
    memInvites.set(id, refreshed);
    return { ...refreshed, emailSent: false };
  },

  async lookupByToken(token: string): Promise<InvitationPublic> {
    const sql = db();
    if (sql) {
      await sql`
        update invitations set status = 'expired'
        where token = ${token} and status = 'pending' and expires_at < now()
      `;
      const rows = await sql<InvitationRow[]>`
        ${sql.unsafe(INVITATION_SELECT)}
        where token = ${token} limit 1
      `;
      const row = rows[0];
      if (!row) throw Object.assign(new Error('Invitation not found'), { status: 404 });
      const inv = fromRow(row);
      if (inv.status === 'expired') throw Object.assign(new Error('This invitation has expired'), { status: 410 });
      if (inv.status !== 'pending') throw Object.assign(new Error(`This invitation is ${inv.status}`), { status: 409 });
      return toPublic(inv);
    }

    const id = memByToken.get(token);
    if (!id) throw Object.assign(new Error('Invitation not found'), { status: 404 });
    const inv = memInvites.get(id);
    if (!inv) throw Object.assign(new Error('Invitation not found'), { status: 404 });
    if (inv.status === 'pending' && new Date(inv.expiresAt).getTime() < Date.now()) {
      memInvites.set(id, { ...inv, status: 'expired' });
      throw Object.assign(new Error('This invitation has expired'), { status: 410 });
    }
    if (inv.status !== 'pending') throw Object.assign(new Error(`This invitation is ${inv.status}`), { status: 409 });
    return toPublic(inv);
  },

  async accept(
    token: string,
    body: AcceptInvitationRequest,
    registerUser: (u: User & { passwordHash: string }, firmId: string | null) => Promise<void>,
  ): Promise<AuthResponse> {
    const sql = db();
    let bundle: InvitationWithFirm;
    if (sql) {
      const rows = await sql<InvitationRow[]>`
        ${sql.unsafe(INVITATION_SELECT)}
        where token = ${token} limit 1
      `;
      const row = rows[0];
      if (!row) throw Object.assign(new Error('Invitation not found'), { status: 404 });
      bundle = { inv: fromRow(row), firmId: row.firm_id };
    } else {
      const id = memByToken.get(token);
      if (!id) throw Object.assign(new Error('Invitation not found'), { status: 404 });
      const inv = memInvites.get(id)!;
      bundle = { inv, firmId: memInviteFirm.get(id) ?? null };
    }

    const { inv, firmId } = bundle;
    if (inv.status !== 'pending') {
      throw Object.assign(new Error(`This invitation is ${inv.status}`), { status: 409 });
    }
    if (new Date(inv.expiresAt).getTime() < Date.now()) {
      throw Object.assign(new Error('This invitation has expired'), { status: 410 });
    }
    // Re-check the seat cap at acceptance time. The create() check counted
    // this invite while it was pending, but if seats were reduced or another
    // invite was accepted in the meantime, we want a clean 402 rather than a
    // silently overpopulated firm.
    await assertSeatCapNotExceeded(firmId);

    const passwordHash = await bcrypt.hash(body.password, 10);
    const provisionalId = randomBytes(8).toString('hex');
    const user: User = {
      id: provisionalId,
      name: body.name.trim(),
      email: inv.email,
      role: inv.role,
      firm: inv.firm,
      isSuperadmin: false,
    };

    await registerUser({ ...user, passwordHash }, firmId);

    if (sql) {
      const rows = await sql<{ id: string }[]>`
        select id from users where lower(email) = ${inv.email} limit 1
      `;
      if (rows[0]?.id) user.id = rows[0].id;
      await sql`update invitations set status = 'accepted', accepted_at = now() where id = ${inv.id}`;
    } else {
      const memInv = memInvites.get(inv.id);
      if (memInv) memInvites.set(inv.id, { ...memInv, status: 'accepted', acceptedAt: new Date().toISOString() });
      memByToken.delete(inv.token);
    }

    const tokenJwt = jwt.sign(
      { sub: user.id, email: user.email, role: user.role, isSuperadmin: false },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
    );
    return { user, token: tokenJwt };
  },
};
