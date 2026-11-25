// hearings-calendar-feed: the firm's hearings as a calendar the advocate
// subscribes to once (Apple Calendar on iPhone / iPad / Mac, Google, Outlook).
// The link is /api/calendar/<userId>/<token>.ics; the token is an HMAC of the
// user's feed version with the server's signing secret, so nothing secret is
// stored and "Reset link" (version + 1) kills every old copy. No model calls.
import crypto from 'node:crypto';
import type { CalendarHearing } from '@lexdraft/types';
import { db } from '../db/client';
import { env } from '../env';
import { hearingsService } from './hearings.service';
import { firmIdForUser } from './tenant';

export function feedToken(userId: string, version: number, secret = env.storageSigningSecret): string {
  return crypto.createHmac('sha256', secret).update(`calendar-feed:${userId}:${version}`).digest('base64url').slice(0, 32);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 lines are folded at 75 octets. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = Buffer.from(line, 'utf8');
  while (rest.length > 75) {
    let cut = out.length ? 74 : 75;
    while (cut > 0 && (rest[cut]! & 0xc0) === 0x80) cut--; // never split a UTF-8 character
    out.push(rest.subarray(0, cut).toString('utf8'));
    rest = rest.subarray(cut);
  }
  out.push(rest.toString('utf8'));
  return out.join('\r\n ');
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Hearings as an iCalendar feed. Times are IST; a hearing without a time is
 *  an all-day event on its date (courts often list without a time). */
export function hearingsIcs(hearings: readonly CalendarHearing[], now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DifAi//Hearings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:DifAi hearings', 'X-WR-TIMEZONE:Asia/Kolkata',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const h of hearings) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date)) continue;
    const m = /^(\d{1,2}):(\d{2})/.exec(h.time ?? '');
    lines.push('BEGIN:VEVENT', `UID:hearing-${h.id ?? `${h.date}-${h.case}`}@difai`, `DTSTAMP:${utc(now)}`);
    if (m && Number(m[1]) < 24) {
      const start = new Date(`${h.date}T${m[1]!.padStart(2, '0')}:${m[2]}:00+05:30`);
      lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(new Date(start.getTime() + 60 * 60 * 1000))}`);
    } else {
      const d = h.date.replace(/-/g, '');
      const next = new Date(`${h.date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, '')}`);
    }
    lines.push(
      `SUMMARY:${esc([h.case, h.purpose].filter(Boolean).join(' – '))}`,
      ...(h.court ? [`LOCATION:${esc(h.court)}`] : []),
      `DESCRIPTION:${esc([h.judge ? `Judge: ${h.judge}` : '', `Status: ${h.status}`, 'From DifAi'].filter(Boolean).join('\n'))}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export const calendarFeedService = {
  async version(userId: string): Promise<number | null> {
    const sql = db();
    if (!sql) return null;
    const rows = await sql<Array<{ v: number | null }>>`select calendar_feed_version as v from users where id = ${userId}::uuid`;
    return rows[0]?.v ?? null;
  },

  /** Turn on (keeps the current link) or reset (a new link; old ones stop). */
  async enable(userId: string, reset: boolean): Promise<string> {
    const sql = db();
    if (!sql) throw new Error('database required');
    const rows = await sql<Array<{ v: number }>>`
      update users set calendar_feed_version = case
        when calendar_feed_version is null then 1
        when ${reset} then calendar_feed_version + 1
        else calendar_feed_version end
      where id = ${userId}::uuid returning calendar_feed_version as v`;
    return feedToken(userId, rows[0]!.v);
  },

  async disable(userId: string): Promise<void> {
    const sql = db();
    if (!sql) return;
    await sql`update users set calendar_feed_version = null where id = ${userId}::uuid`;
  },

  async tokenFor(userId: string): Promise<string | null> {
    const v = await this.version(userId);
    return v == null ? null : feedToken(userId, v);
  },

  /** The feed, or null for a wrong / old / turned-off link (always the same
   *  answer, so a link can't be probed). 30 days back, a year ahead. */
  async feed(userId: string, token: string, now = new Date()): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
    const v = await this.version(userId).catch(() => null);
    if (v == null || !safeEqual(token, feedToken(userId, v))) return null;
    const firmId = await firmIdForUser(userId);
    const from = new Date(now.getTime() - 30 * 86_400_000);
    const to = new Date(now.getTime() + 365 * 86_400_000);
    return hearingsIcs(await hearingsService.listRange(firmId, iso(from), iso(to)), now);
  },
};
