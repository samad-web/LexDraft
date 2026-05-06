import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AuthResponse, SignInRequest, SignUpRequest, User } from '@lexdraft/types';
import { env } from '../env';
import { db } from '../db/client';

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
}

const SEED_FIRM_ID = '00000000-0000-0000-0000-000000000001';

// In-memory fallback (used only when DATABASE_URL is blank).
const memUsers = new Map<string, StoredUser>();

interface ActAsClaim {
  adminId: string;
  adminEmail: string;
}

function issueToken(user: User): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, isSuperadmin: !!user.isSuperadmin },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] },
  );
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
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isSuperadmin: row.is_superadmin,
    firm: row.firm_name ?? '',
  };
}

const USER_SELECT_WITH_FIRM = `
  select u.id, u.name, u.email, u.role, u.is_superadmin, u.password_hash, u.firm_id,
         f.name as firm_name
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

async function insertUser(record: StoredUser): Promise<User> {
  const sql = db();
  if (sql) {
    const rows = await sql<UserRow[]>`
      with inserted as (
        insert into users (firm_id, name, email, role, is_superadmin, password_hash)
        values (${SEED_FIRM_ID}, ${record.name}, ${record.email.toLowerCase()},
                ${record.role}, ${!!record.isSuperadmin}, ${record.passwordHash})
        returning id, name, email, role, is_superadmin, password_hash, firm_id
      )
      select i.id, i.name, i.email, i.role, i.is_superadmin, i.password_hash, i.firm_id,
             f.name as firm_name
      from inserted i
      left join firms f on f.id = i.firm_id
    `;
    return rowToPublic(rows[0]!);
  }
  memUsers.set(record.email.toLowerCase(), record);
  const { passwordHash: _ph, ...rest } = record;
  return rest;
}

export const authService = {
  async signIn({ email, password }: SignInRequest): Promise<AuthResponse> {
    const lookup = await findByEmail(email);

    if (!lookup) {
      // Auto-provision when the email is unknown. Name is derived from the
      // email's local part — the user can update it later.
      const isAdminish = email.toLowerCase().includes('admin');
      const localPart = email.split('@')[0] ?? '';
      const derivedName = localPart
        .split(/[._-]+/)
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ') || email;
      const user = await insertUser({
        id: '',
        name: derivedName,
        email: email.toLowerCase(),
        role: 'Solo Advocate',
        firm: '',
        isSuperadmin: isAdminish,
        passwordHash: bcrypt.hashSync(password || 'lexdraft', 10),
      });
      return { user, token: issueToken(user) };
    }

    const ok = await bcrypt.compare(password || 'lexdraft', lookup.passwordHash);
    if (!ok) throw Object.assign(new Error('Invalid credentials'), { status: 401 });
    return { user: lookup.publicUser, token: issueToken(lookup.publicUser) };
  },

  async signUp(input: SignUpRequest): Promise<AuthResponse> {
    const existing = await findByEmail(input.email);
    if (existing) throw Object.assign(new Error('Email already registered'), { status: 409 });

    const role: User['role'] =
      input.role === 'solo' ? 'Solo Advocate' : input.role === 'group' ? 'Practice Lead' : 'Managing Partner';

    const user = await insertUser({
      id: '',
      name: input.name,
      email: input.email.toLowerCase(),
      role,
      firm: input.firm ?? '',
      isSuperadmin: false,
      passwordHash: await bcrypt.hash(input.password, 10),
    });
    return { user, token: issueToken(user) };
  },

  verify(token: string): {
    sub: string;
    email: string;
    role: string;
    isSuperadmin: boolean;
    actAs?: ActAsClaim;
  } {
    return jwt.verify(token, env.JWT_SECRET) as ReturnType<typeof authService.verify>;
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

  /** Direct insert — used by the invitation acceptance flow. */
  async registerExternalUser(record: User & { passwordHash: string }): Promise<void> {
    const existing = await findByEmail(record.email);
    if (existing) throw Object.assign(new Error('Email already registered'), { status: 409 });
    await insertUser(record);
  },
};
