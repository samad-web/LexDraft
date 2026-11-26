// team-docs presence: "Priya is working on this now". While someone has a
// document, a review copy or a case's notes open for work, their app reports it
// every ~25 s; others in the same firm see their name. Kept in memory only (one
// API process; nothing stored), an entry lapses 75 s after the last report.
import { db } from '../db/client';

export const PRESENCE_TTL_MS = 75_000;
/** What can be "worked on": a document, a draft, a review copy, a case's notes. */
export const TARGET = /^(doc|draft|review|case-notes):[0-9a-f-]{36}$/i;

interface Entry { name: string; at: number }
type FirmMap = Map<string, Map<string, Entry>>; // target -> userId -> entry
const firms = new Map<string, FirmMap>();
const names = new Map<string, { name: string; at: number }>();

export async function nameOf(userId: string): Promise<string> {
  const hit = names.get(userId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.name;
  const sql = db();
  const rows = sql ? await sql<Array<{ name: string }>>`select name from users where id = ${userId}::uuid limit 1` : [];
  const name = rows[0]?.name?.trim() || 'A teammate';
  names.set(userId, { name, at: Date.now() });
  return name;
}

function prune(m: FirmMap, now: number) {
  for (const [t, users] of m) {
    for (const [u, e] of users) if (now - e.at > PRESENCE_TTL_MS) users.delete(u);
    if (!users.size) m.delete(t);
  }
}

export type PresenceView = Record<string, Array<{ userId: string; name: string }>>;

export const presence = {
  beat(firmId: string, userId: string, name: string, targets: string[], now = Date.now()): void {
    const m = firms.get(firmId) ?? new Map();
    firms.set(firmId, m);
    for (const t of targets) {
      const users = m.get(t) ?? new Map<string, Entry>();
      users.set(userId, { name, at: now });
      m.set(t, users);
    }
  },

  leave(firmId: string, userId: string, targets: string[]): void {
    const m = firms.get(firmId);
    if (!m) return;
    for (const t of targets) m.get(t)?.delete(userId);
  },

  /** Who else is working on what in this firm (optionally only `targets`). */
  view(firmId: string, exceptUserId: string, targets?: string[], now = Date.now()): PresenceView {
    const m = firms.get(firmId);
    if (!m) return {};
    prune(m, now);
    const out: PresenceView = {};
    for (const [t, users] of m) {
      if (targets && !targets.includes(t)) continue;
      const others = [...users].filter(([u]) => u !== exceptUserId).map(([userId, e]) => ({ userId, name: e.name }));
      if (others.length) out[t] = others;
    }
    return out;
  },

  _reset(): void { firms.clear(); names.clear(); },
};
