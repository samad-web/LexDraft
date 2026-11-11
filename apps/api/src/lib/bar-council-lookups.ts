/**
 * Live enrolment lookups for councils whose public search answers a plain
 * server request (no captcha, no login). Response shapes confirmed against
 * each council's live search on 2026-11-11. Each lookup returns every record
 * the council sent back; bar-verification.service decides what matches.
 */
import type { BarRecord } from './bar-councils';

const UA = 'DifAi-advocate-verification (+https://difai.sirahdigital.in)';
const TIMEOUT_MS = 20_000;

const str = (v: unknown): string | undefined => (v == null || String(v).trim() === '' ? undefined : String(v).trim());
const stripTags = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

async function post(url: string, body: string, contentType: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'User-Agent': UA },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.text();
}

// ---- Karnataka (ksbc.org.in): JSON list, or a "Please Check ..." string when nothing matches.
export function parseKarnataka(text: string): BarRecord[] {
  let rows: unknown;
  try { rows = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r: Record<string, unknown>) => (str(r.RollNo) ? [{
    name: str(r.NAME) ?? '',
    enrolmentNo: str(r.RollNo)!,
    enrolmentDate: str(r.DateOfEnroll),
    status: str(r.EnrollmentStatus),
  }] : []));
}

// ---- Gujarat (barcouncilofgujarat.org): { Data: [...] | null, IsSuccess }.
export function parseGujarat(text: string): BarRecord[] {
  let body: { Data?: Array<Record<string, unknown>> | null };
  try { body = JSON.parse(text); } catch { return []; }
  return (body.Data ?? []).flatMap((r) => (str(r.EnroNumber) ? [{
    name: str(r.FullName) ?? '',
    enrolmentNo: str(r.EnroNumber)!,
    status: str(r.PracticeVerificationStatus),
  }] : []));
}

// ---- Andhra Pradesh (barcouncilap.org): an HTML table, 6 cells per advocate:
// enrolment no., name, enrolment date, address, bar association, status.
export function parseAndhra(html: string): BarRecord[] {
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]!));
  const out: BarRecord[] = [];
  for (let i = 0; i + 5 < cells.length; i += 6) {
    const [no, name, date, , , status] = cells.slice(i, i + 6);
    if (no) out.push({ name: name ?? '', enrolmentNo: no, enrolmentDate: date || undefined, status: status || undefined });
  }
  return out;
}

export interface LiveLookup {
  source: string;
  lookup: (enrolmentNo: string) => Promise<BarRecord[]>;
}

export const LIVE_LOOKUPS: Record<string, LiveLookup> = {
  karnataka: {
    source: 'ksbc.org.in',
    lookup: async (no) => parseKarnataka(await post('https://intranet.ksbc.org.in/MobileAPI/Members.ashx',
      JSON.stringify({ Name: '', rno: no, place: '' }), 'application/json')),
  },
  gujarat: {
    source: 'barcouncilofgujarat.org',
    lookup: async (no) => parseGujarat(await post('https://barcouncilofgujarat.org/AdvocateVerificationStatusDetail',
      JSON.stringify({ EnrollmentNumber: no }), 'application/json')),
  },
  ap: {
    source: 'barcouncilap.org',
    lookup: async (no) => parseAndhra(await post('https://barcouncilap.org/wp-admin/admin-ajax.php',
      new URLSearchParams({ action: 'get_details_enrl', enumber: no }).toString(), 'application/x-www-form-urlencoded')),
  },
};
