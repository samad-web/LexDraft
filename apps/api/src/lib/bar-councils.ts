/**
 * State Bar Councils and how DifAi can check an enrolment against each one
 * (survey of the councils' official sites, 2026-11-11 - see
 * build-docs/features/bar-council-verification.md).
 *
 *   otp  - the council's own search sends an OTP to the person searching;
 *          the advocate types it (Tamil Nadu).
 *   none - no automatic check yet: either the council publishes no online
 *          roll, or its lookup is not built yet (`note` says which).
 */
export type BarCouncilMode = 'otp' | 'none';

export interface BarCouncil {
  id: string;
  name: string;
  mode: BarCouncilMode;
  note?: string;
}

const NO_ROLL = 'Your Bar Council does not publish its roll online, so it cannot be checked automatically.';
const NOT_YET = 'Automatic checking for your Bar Council is coming soon.';

export const BAR_COUNCILS: BarCouncil[] = [
  { id: 'tn', name: 'Tamil Nadu & Puducherry', mode: 'otp' },
  { id: 'kerala', name: 'Kerala', mode: 'none', note: NOT_YET },
  { id: 'karnataka', name: 'Karnataka', mode: 'none', note: NOT_YET },
  { id: 'ap', name: 'Andhra Pradesh', mode: 'none', note: NOT_YET },
  // Its site asks automated clients to stay away (robots.txt); skipped until the council permits it.
  { id: 'telangana', name: 'Telangana', mode: 'none', note: 'Automatic checking for your Bar Council is not available yet.' },
  { id: 'gujarat', name: 'Gujarat', mode: 'none', note: NOT_YET },
  { id: 'up', name: 'Uttar Pradesh', mode: 'none', note: NOT_YET },
  { id: 'mp', name: 'Madhya Pradesh', mode: 'none', note: NOT_YET },
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

/** "ms 1234/2019", "MS-1234-2019", "MS/01234/2019" -> { prefix: 'MS', num: 1234, year: 2019 }. */
export function parseEnrolment(raw: string): { prefix: string; num: number; year: number } | null {
  const m = /^([A-Z.\s]*?)[\s/.-]*0*(\d{1,6})\s*[/.-]\s*(\d{4})$/.exec(raw.toUpperCase().trim());
  if (!m) return null;
  return { prefix: m[1]!.replace(/[^A-Z]/g, ''), num: Number(m[2]), year: Number(m[3]) };
}

/** Same enrolment: number and year equal; the state prefix must agree when both carry one. */
export function sameEnrolment(a: string, b: string): boolean {
  const x = parseEnrolment(a);
  const y = parseEnrolment(b);
  if (!x || !y) return false;
  return x.num === y.num && x.year === y.year && (!x.prefix || !y.prefix || x.prefix === y.prefix);
}

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
