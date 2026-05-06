import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type {
  AcceptInvitationRequest,
  AuthResponse,
  CreateInvitationRequest,
  Invitation,
  InvitationPublic,
  InvitationStatus,
  InviteRole,
  User,
} from '@lexdraft/types';
import { env } from '../env';
import { db } from '../db/client';

const INVITATION_TTL_DAYS = 7;
const SEED_FIRM_ID = '00000000-0000-0000-0000-000000000001';

interface Inviter {
  id: string;
  name: string;
  email: string;
  firm?: string;
}

interface InvitationRow {
  id: string;
  email: string;
  role: InviteRole;
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

function generateToken(): string {
  return randomBytes(24).toString('base64url');
}
function generateId(): string {
  return `inv_${randomBytes(8).toString('hex')}`;
}
function isoPlusDays(days: number): string {
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

// In-memory fallback (used only when DATABASE_URL is blank).
const memInvites = new Map<string, Invitation>();
const memByToken = new Map<string, string>();

export const invitationsService = {
  async list(): Promise<Invitation[]> {
    const sql = db();
    if (sql) {
      await sql`update invitations set status = 'expired' where status = 'pending' and expires_at < now()`;
      const rows = await sql<InvitationRow[]>`
        select id, email, role, firm_name, invited_by_id, invited_by_name, status,
               token, expires_at, accepted_at, message, created_at
        from invitations order by created_at desc
      `;
      return rows.map(fromRow);
    }
    const now = Date.now();
    for (const inv of memInvites.values()) {
      if (inv.status === 'pending' && new Date(inv.expiresAt).getTime() < now) {
        memInvites.set(inv.id, { ...inv, status: 'expired' });
      }
    }
    return Array.from(memInvites.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  async create(input: CreateInvitationRequest, inviter: Inviter): Promise<Invitation> {
    const email = input.email.toLowerCase().trim();
    const id = generateId();
    const token = generateToken();
    const expiresAt = isoPlusDays(INVITATION_TTL_DAYS);
    const firm = inviter.firm ?? 'Sharma & Associates';
    const inviterUuid = /^[0-9a-f-]{36}$/i.test(inviter.id) ? inviter.id : null;

    const sql = db();
    if (sql) {
      const dup = await sql<{ id: string }[]>`
        select id from invitations where lower(email) = ${email} and status = 'pending' limit 1
      `;
      if (dup.length > 0) {
        throw Object.assign(new Error('An invitation is already pending for this email'), { status: 409 });
      }
      const rows = await sql<InvitationRow[]>`
        insert into invitations (
          id, firm_id, email, role, firm_name, invited_by_id, invited_by_name,
          status, token, expires_at, message
        ) values (
          ${id}, ${SEED_FIRM_ID}, ${email}, ${input.role}, ${firm},
          ${inviterUuid}, ${inviter.name},
          'pending', ${token}, ${expiresAt}, ${input.message?.trim() || null}
        )
        returning id, email, role, firm_name, invited_by_id, invited_by_name,
                  status, token, expires_at, accepted_at, message, created_at
      `;
      return fromRow(rows[0]!);
    }

    for (const existing of memInvites.values()) {
      if (existing.email === email && existing.status === 'pending') {
        throw Object.assign(new Error('An invitation is already pending for this email'), { status: 409 });
      }
    }
    const inv: Invitation = {
      id,
      email,
      role: input.role,
      firm,
      invitedBy: { id: inviter.id, name: inviter.name },
      status: 'pending',
      token,
      expiresAt,
      createdAt: new Date().toISOString(),
      message: input.message?.trim() || undefined,
    };
    memInvites.set(inv.id, inv);
    memByToken.set(inv.token, inv.id);
    return inv;
  },

  async cancel(id: string): Promise<boolean> {
    const sql = db();
    if (sql) {
      const rows = await sql`
        update invitations set status = 'cancelled'
        where id = ${id} and status = 'pending'
        returning id
      `;
      return rows.length > 0;
    }
    const inv = memInvites.get(id);
    if (!inv || inv.status !== 'pending') return false;
    memInvites.set(id, { ...inv, status: 'cancelled' });
    memByToken.delete(inv.token);
    return true;
  },

  async resend(id: string): Promise<Invitation | undefined> {
    const sql = db();
    const newToken = generateToken();
    const newExpires = isoPlusDays(INVITATION_TTL_DAYS);
    if (sql) {
      const rows = await sql<InvitationRow[]>`
        update invitations set token = ${newToken}, expires_at = ${newExpires}
        where id = ${id} and status = 'pending'
        returning id, email, role, firm_name, invited_by_id, invited_by_name,
                  status, token, expires_at, accepted_at, message, created_at
      `;
      const row = rows[0];
      return row ? fromRow(row) : undefined;
    }
    const inv = memInvites.get(id);
    if (!inv || inv.status !== 'pending') return undefined;
    memByToken.delete(inv.token);
    const refreshed: Invitation = { ...inv, token: newToken, expiresAt: newExpires };
    memInvites.set(id, refreshed);
    memByToken.set(refreshed.token, refreshed.id);
    return refreshed;
  },

  async lookupByToken(token: string): Promise<InvitationPublic> {
    const sql = db();
    if (sql) {
      await sql`
        update invitations set status = 'expired'
        where token = ${token} and status = 'pending' and expires_at < now()
      `;
      const rows = await sql<InvitationRow[]>`
        select id, email, role, firm_name, invited_by_id, invited_by_name, status,
               token, expires_at, accepted_at, message, created_at
        from invitations where token = ${token} limit 1
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
    registerUser: (u: User & { passwordHash: string }) => Promise<void>,
  ): Promise<AuthResponse> {
    const sql = db();
    let inv: Invitation;
    if (sql) {
      const rows = await sql<InvitationRow[]>`
        select id, email, role, firm_name, invited_by_id, invited_by_name, status,
               token, expires_at, accepted_at, message, created_at
        from invitations where token = ${token} limit 1
      `;
      const row = rows[0];
      if (!row) throw Object.assign(new Error('Invitation not found'), { status: 404 });
      inv = fromRow(row);
    } else {
      const id = memByToken.get(token);
      if (!id) throw Object.assign(new Error('Invitation not found'), { status: 404 });
      inv = memInvites.get(id)!;
    }

    if (inv.status !== 'pending') {
      throw Object.assign(new Error(`This invitation is ${inv.status}`), { status: 409 });
    }
    if (new Date(inv.expiresAt).getTime() < Date.now()) {
      throw Object.assign(new Error('This invitation has expired'), { status: 410 });
    }

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

    await registerUser({ ...user, passwordHash });

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
