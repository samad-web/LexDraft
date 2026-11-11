/**
 * State Bar Councils and how DifAi can check an enrolment against each one
 * (survey of the councils' official sites, 2026-11-11 - see
 * build-docs/features/bar-council-verification.md).
 *
 *   otp  - the council's own search sends an OTP to the person searching;
 *          the advocate types it (Tamil Nadu).
 *   live - the council's public search answers a server request
 *          (lib/bar-council-lookups.ts).
 *   none - no automatic check: the council publishes no online roll, its
 *          site blocks automated requests, or the lookup is not built yet.
 */
export type BarCouncilMode = 'otp' | 'live' | 'none';

/** What a council's roll says about one advocate. */
export interface BarRecord {
  name: string;
  enrolmentNo: string;
  enrolmentDate?: string;
  fatherName?: string;
  status?: string;
  copStatus?: string;
}

export interface BarCouncil {
  id: string;
  name: string;
  mode: BarCouncilMode;
  note?: string;
}

const NO_ROLL = 'Your Bar Council does not publish its roll online, so it cannot be checked automatically.';
const NOT_YET = 'Automatic checking for your Bar Council is coming soon.';
const BLOCKED = "Your Bar Council's website does not allow automatic checks.";

export const BAR_COUNCILS: BarCouncil[] = [
  { id: 'tn', name: 'Tamil Nadu & Puducherry', mode: 'otp' },
  // Kerala's directory (bck-portal.qourt.net) refuses non-browser clients; not worked around.
  { id: 'kerala', name: 'Kerala', mode: 'none', note: BLOCKED },
  { id: 'karnataka', name: 'Karnataka', mode: 'live' },
  { id: 'ap', name: 'Andhra Pradesh', mode: 'live' },
  // Its site asks automated clients to stay away (robots.txt); skipped until the council permits it.
  { id: 'telangana', name: 'Telangana', mode: 'none', note: 'Automatic checking for your Bar Council is not available yet.' },
  { id: 'gujarat', name: 'Gujarat', mode: 'live' },
  { id: 'up', name: 'Uttar Pradesh', mode: 'none', note: NOT_YET },
  // Its firewall refuses automated requests; not worked around.
  { id: 'mp', name: 'Madhya Pradesh', mode: 'none', note: BLOCKED },
  { id: 'punjab_haryana', name: 'Punjab & Haryana', mode: 'none', note: NOT_YET },
  { id: 'jk', name: 'Jammu & Kashmir and Ladakh', mode: 'none', note: NOT_YET },
  { id: 'uttarakhand', name: 'Uttarakhand', mode: 'none', note: NOT_YET },
  { id: 'rajasthan', name: 'Rajasthan', mode: 'none', note: NOT_YET },
  { id: 'maharashtra_goa', name: 'Maharashtra & Goa', mode: 'none', note: NO_ROLL },
  { id: 'delhi', name: 'Delhi', mode: 'none', note: NO_ROLL },
  { id: 'wb', name: 'West Bengal', mode: 'none', note: NO_ROLL },
  { id: 'odisha', name: 'Odisha', mode: 'none', note: NO_ROLL },
  { id: 'assam', name: 'Assam, Nagaland, Mizoram, Arunachal Pradesh & Sikkim', mode: 'none', note: NO_ROLL },
  { id: 'meghalaya', name: 'Meghalaya', mode: 'none', note: NO_ROLL },
  { id: 'manipur', name: 'Manipur', mode: 'none', note: NO_ROLL },
  { id: 'tripura', name: 'Tripura', mode: 'none', note: NO_ROLL },
  { id: 'chhattisgarh', name: 'Chhattisgarh', mode: 'none', note: NO_ROLL },
  { id: 'hp', name: 'Himachal Pradesh', mode: 'none', note: NO_ROLL },
  { id: 'bihar', name: 'Bihar', mode: 'none', note: NO_ROLL },
  { id: 'jharkhand', name: 'Jharkhand', mode: 'none', note: NO_ROLL },
];

export const barCouncil = (id: string | null | undefined): BarCouncil | undefined =>
  BAR_COUNCILS.find((c) => c.id === id);

/**
 * "ms 1234/2019", "MS-01234-2019", "MS1234/2019", "KAR/123/85", "K5/001234/2015"
 * -> prefix letters/digits, number, year. Two-digit years are kept as written
 * (councils print "85" and "1985" for the same roll entry).
 */
export function parseEnrolment(raw: string): { prefix: string; num: number; year: string } | null {
  const parts = raw.toUpperCase().trim().split(/[\s/.\-]+/).filter(Boolean);
  const year = parts.pop();
  let numPart = parts.pop();
  if (!year || !numPart || !/^\d{2}(\d{2})?$/.test(year)) return null;
  const glued = /^([A-Z]+)(\d+)$/.exec(numPart);          // "MS1234"
  if (glued) { parts.push(glued[1]!); numPart = glued[2]!; }
  if (!/^\d{1,7}$/.test(numPart)) return null;
  return { prefix: parts.join(''), num: Number(numPart), year };
}

const sameYear = (a: string, b: string): boolean => a === b || (Math.min(a.length, b.length) === 2 && a.slice(-2) === b.slice(-2));
const compact = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Same enrolment: number and year equal; the state prefix must agree when both carry one.
 *  Numbers no parser understands (e.g. Karnataka's "MYS/45-B/78") must match character for character. */
export function sameEnrolment(a: string, b: string): boolean {
  const x = parseEnrolment(a);
  const y = parseEnrolment(b);
  if (!x || !y) return !!compact(a) && compact(a) === compact(b);
  return x.num === y.num && sameYear(x.year, y.year) && (!x.prefix || !y.prefix || x.prefix === y.prefix);
}

/** Roll statuses that mean the advocate is not practising today. Unknown codes are not judged. */
export const isInactiveStatus = (status: string | undefined): boolean =>
  !!status && /died|death|deceased|retire|suspend|remov|struck|transfer|non[\s-]?pract/i.test(status);

const TITLES = new Set(['ADV', 'ADVOCATE', 'MR', 'MRS', 'MS', 'MISS', 'DR', 'SRI', 'SHRI', 'SMT', 'THIRU', 'TMT', 'SELVI', 'KUMARI']);

function words(name: string): string[] {
  return name.toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !TITLES.has(w));
}

/**
 * Indian names are written with initials in any order ("R. Senthil Kumar",
 * "SENTHILKUMAR R"), so initials are ignored and the full words compared:
 * every full word of the shorter name must be in the longer one, or the
 * words run together must be equal.
 */
export function namesMatch(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.includes(w)) || x.join('') === y.join('');
}
