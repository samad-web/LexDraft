/**
 * Bar Council enrolment verification (build-docs/features/bar-council-verification.md).
 *
 * Tamil Nadu & Puducherry: the council's search (bctnpy.org/verify/advocate)
 * is guarded by reCAPTCHA v3 and an SMS OTP to the person searching, so the
 * server drives the council's own page in a real browser and the advocate
 * types the OTP the council sends to their mobile. The result is read from
 * the page's own API response, not scraped from the screen.
 */
import { randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright';
import { db } from '../db/client';
import { logger } from '../logger';
import { BadRequestError, HttpError, NotFoundError } from '../lib/errors';
import { barCouncil, isInactiveStatus, namesMatch, sameEnrolment, type BarRecord } from '../lib/bar-councils';
import { LIVE_LOOKUPS } from '../lib/bar-council-lookups';

export type { BarRecord };

const TN_URL = 'https://www.bctnpy.org/verify/advocate';
const TN_SOURCE = 'bctnpy.org';
const SESSION_TTL_MS = 10 * 60 * 1000;
const STEP_TIMEOUT_MS = 30_000;

export type BarStatus = 'verified' | 'inactive' | 'not_found' | 'name_mismatch' | 'unavailable' | 'unsupported';

/** Pull advocate records out of whatever shape the council's API returns
 *  (a list for searches, `{ record }` for the detail call). */
export function findAdvocateRecords(payload: unknown): BarRecord[] {
  const out: BarRecord[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.bcteno === 'string' && o.bcteno.trim()) {
      const str = (k: string) => (o[k] == null || o[k] === '' ? undefined : String(o[k]));
      out.push({
        name: str('fullName') ?? '',
        enrolmentNo: o.bcteno.trim(),
        enrolmentDate: str('bcteDate'),
        fatherName: str('fatherName'),
        status: str('status'),
        copStatus: typeof o.copStatus === 'object' ? JSON.stringify(o.copStatus) : str('copStatus'),
      });
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(payload);
  return out;
}

/** Verified only when the council has this enrolment number under this name,
 *  and the roll does not say the advocate died, retired, was suspended, etc. */
export function decide(records: BarRecord[], enrolmentNo: string, name: string): { status: BarStatus; record?: BarRecord } {
  const same = records.filter((r) => sameEnrolment(r.enrolmentNo, enrolmentNo));
  if (!same.length) return { status: 'not_found' };
  const named = same.filter((r) => r.name && namesMatch(r.name, name));
  if (named.length) return { status: isInactiveStatus(named[0]!.status) ? 'inactive' : 'verified', record: named[0] };
  // A detail-less row (no name) can't prove anything either way.
  return { status: same.some((r) => r.name) ? 'name_mismatch' : 'not_found', record: same[0] };
}

async function save(userId: string, council: string, status: BarStatus, source: string | null, record?: BarRecord): Promise<void> {
  const sql = db();
  if (!sql) return;
  await sql`
    update users set
      bar_council = ${council},
      bar_verification_status = ${status},
      bar_verification_source = ${source},
      bar_record = ${record ? sql.json(record as unknown as Parameters<typeof sql.json>[0]) : null},
      bar_checked_at = now(),
      bar_verified_at = ${status === 'verified' ? new Date() : null}
    where id = ${userId}::uuid
  `;
}

// ---- browser sessions (one per advocate, closed after use or 10 min) ------

interface TnSession {
  id: string;
  userId: string;
  enrolmentNo: string;
  name: string;
  context: BrowserContext;
  page: Page;
  timer: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, TnSession>();
let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // CHROMIUM_PATH: Alpine's chromium in the Docker image; unset in dev (same as tn-land-records).
    browserPromise = chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      args: ['--disable-dev-shm-usage'],
    }).then((b) => {
      b.once('disconnected', () => { browserPromise = null; sessions.clear(); });
      return b;
    }).catch((err) => { browserPromise = null; throw err; });
  }
  return browserPromise;
}

async function closeSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  clearTimeout(s.timer);
  await s.context.close().catch(() => {});
}

const apiResponse = (page: Page, path: string): Promise<Response> =>
  page.waitForResponse((r) => r.url().includes(path) && r.request().method() !== 'OPTIONS', { timeout: STEP_TIMEOUT_MS });

async function readJson(res: Response): Promise<{ status?: boolean; msg?: string; payload?: unknown }> {
  try { return (await res.json()) as { status?: boolean; msg?: string; payload?: unknown }; } catch { return {}; }
}

export const barVerificationService = {
  /** Step 1 (Tamil Nadu): fill the council's search and have it SMS an OTP to the advocate's mobile. */
  async startTn(input: { userId: string; enrolmentNo: string; mobile?: string }): Promise<{ sessionId: string; mobile: string }> {
    const sql = db();
    if (!sql) throw new HttpError(503, 'Database not configured');
    const [u] = await sql<{ name: string; phone: string | null }[]>`select name, phone from users where id = ${input.userId}::uuid`;
    if (!u) throw new NotFoundError('User not found');

    const enrolmentNo = input.enrolmentNo.trim().toUpperCase();
    if (!enrolmentNo) throw new BadRequestError('Enter your enrolment number.');
    // The council's form takes a 10-digit Indian mobile; default to the WhatsApp number verified at sign-up.
    const mobile = (input.mobile ?? u.phone ?? '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(mobile)) throw new BadRequestError('Enter your 10-digit mobile number.');

    for (const s of [...sessions.values()]) if (s.userId === input.userId) await closeSession(s.id);

    const context = await (await getBrowser()).newContext();
    const page = await context.newPage();
    const id = randomUUID();
    try {
      await page.goto(TN_URL, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS });
      await page.locator('#verifyAdvocate_searchValue').fill(enrolmentNo, { timeout: STEP_TIMEOUT_MS });
      await page.locator('#verifyAdvocate_publicName').fill(u.name);
      await page.locator('#verifyAdvocate_publicSearchMobile').fill(mobile);
      const sent = apiResponse(page, '/server/api/otp/advocate');
      await page.getByRole('button', { name: 'Send OTP' }).click();
      const body = await readJson(await sent);
      if (body.status === false) throw new BadRequestError(body.msg || 'The Bar Council could not send the OTP.');
    } catch (err) {
      await context.close().catch(() => {});
      if (err instanceof HttpError) throw err;
      logger.warn({ err }, 'bar-verify: TN start failed');
      throw new HttpError(503, 'The Bar Council website is not responding. Try again in a few minutes.');
    }
    sessions.set(id, {
      id, userId: input.userId, enrolmentNo, name: u.name, context, page,
      timer: setTimeout(() => void closeSession(id), SESSION_TTL_MS),
    });
    return { sessionId: id, mobile: `******${mobile.slice(-4)}` };
  },

  /** Step 2 (Tamil Nadu): submit the OTP, read the council's record, compare and save. */
  async finishTn(input: { userId: string; sessionId: string; otp: string }): Promise<{ status: BarStatus; record?: BarRecord }> {
    const s = sessions.get(input.sessionId);
    if (!s || s.userId !== input.userId) throw new BadRequestError('This check has expired. Send a new OTP.');
    const { page } = s;
    let records: BarRecord[];
    try {
      await page.locator('#verifyAdvocate_publicSearchMobileOtp').fill(input.otp.trim());
      await page.locator('#verifyAdvocate_reasonForSearch').fill('Verifying my own enrolment while signing up to DifAi.');
      const searched = apiResponse(page, '/server/api/verify/advocate');
      await page.getByRole('button', { name: 'Search' }).click();
      const body = await readJson(await searched);
      // Wrong OTP etc.: keep the session so the advocate can retry.
      if (body.status === false) throw new BadRequestError(body.msg || 'The Bar Council rejected the search. Check the OTP.');
      records = findAdvocateRecords(body.payload);
      // The search row may carry only the number; the council loads details when it is opened.
      const row = records.find((r) => sameEnrolment(r.enrolmentNo, s.enrolmentNo));
      if (row && !row.name) {
        const detail = apiResponse(page, '/server/api/update/searchlog');
        await page.getByText(row.enrolmentNo, { exact: true }).first().click();
        records = findAdvocateRecords((await readJson(await detail)).payload);
      }
    } catch (err) {
      if (err instanceof BadRequestError) throw err;
      logger.warn({ err }, 'bar-verify: TN search failed');
      await closeSession(s.id);
      await save(input.userId, 'tn', 'unavailable', TN_SOURCE);
      throw new HttpError(503, 'The Bar Council website did not answer. Try again in a few minutes.');
    }
    await closeSession(s.id);
    const result = decide(records, s.enrolmentNo, s.name);
    await save(input.userId, 'tn', result.status, TN_SOURCE, result.record);
    return result;
  },

  /** Councils with a live lookup (Karnataka, AP, Gujarat): ask the council and save the outcome. */
  async checkLive(userId: string, councilId: string, enrolmentNo: string): Promise<{ status: BarStatus; record?: BarRecord }> {
    const live = LIVE_LOOKUPS[councilId];
    const sql = db();
    if (!live || barCouncil(councilId)?.mode !== 'live') throw new BadRequestError('Your Bar Council has no automatic check.');
    if (!sql) throw new HttpError(503, 'Database not configured');
    const [u] = await sql<{ name: string }[]>`select name from users where id = ${userId}::uuid`;
    if (!u) throw new NotFoundError('User not found');
    const no = enrolmentNo.trim().toUpperCase();
    let records: BarRecord[];
    try {
      records = await live.lookup(no);
    } catch (err) {
      logger.warn({ err, councilId }, 'bar-verify: live lookup failed');
      await save(userId, councilId, 'unavailable', live.source);
      return { status: 'unavailable' };
    }
    const result = decide(records, no, u.name);
    await save(userId, councilId, result.status, live.source, result.record);
    return result;
  },

  /**
   * Onboarding finished: store the advocate's council. Councils with no
   * automatic check become 'unsupported'. A Tamil Nadu result is kept only if
   * it was for the enrolment number now on file; otherwise it is cleared
   * (= not checked yet), so a check of one number can't vouch for another.
   */
  async afterOnboarding(userId: string, councilId: string | undefined, enrolmentNo: string | null): Promise<void> {
    const council = barCouncil(councilId);
    const sql = db();
    if (!council || !sql) return;
    if (council.mode === 'none') { await save(userId, council.id, 'unsupported', null); return; }
    if (council.mode === 'live') {
      // Never hold up onboarding on a council website; the result lands on the user row.
      if (enrolmentNo) void barVerificationService.checkLive(userId, council.id, enrolmentNo).catch(() => undefined);
      return;
    }
    const [u] = await sql<{ bar_council: string | null; bar_record: BarRecord | null }[]>`
      select bar_council, bar_record from users where id = ${userId}::uuid`;
    const stillValid = u?.bar_council === council.id && !!u.bar_record && !!enrolmentNo
      && sameEnrolment(u.bar_record.enrolmentNo, enrolmentNo);
    if (stillValid) return;
    await sql`
      update users set bar_council = ${council.id}, bar_verification_status = null, bar_record = null,
        bar_verification_source = null, bar_verified_at = null
      where id = ${userId}::uuid
    `;
  },
};
