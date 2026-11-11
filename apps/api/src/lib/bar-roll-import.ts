/**
 * Parsers for Bar Council rolls published as PDFs. Layouts confirmed on the
 * live files 2026-11-11 by text position (x/y of each text item), because the
 * plain text runs the columns together. Only enrolment number + name leave
 * this module; addresses, phones and emails are dropped here.
 */
import { parseEnrolment } from './bar-councils';

export interface TextItem { x: number; y: number; str: string }
export interface RollEntry { enrolmentNo: string; num: number; name: string }

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

function entry(enrolmentNo: string, name: string): RollEntry | null {
  const p = parseEnrolment(enrolmentNo);
  const n = clean(name);
  return p && n ? { enrolmentNo, num: p.num, name: n } : null;
}

/** Group items into printed lines (same baseline within `tol` points), top to bottom. */
function lines(items: TextItem[], tol: number): TextItem[][] {
  const out: { y: number; items: TextItem[] }[] = [];
  for (const it of [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y)) {
    const line = out.find((l) => Math.abs(l.y - it.y) <= tol);
    if (line) line.items.push(it); else out.push({ y: it.y, items: [it] });
  }
  return out.map((l) => l.items.sort((a, b) => a.x - b.x));
}

/**
 * Punjab & Haryana electoral roll (bcph.co.in, FinalElectoral<year>.pdf):
 * columns Sr. No.+State Roll No. (x < 130, one item "12 PH/1234/2010"),
 * Name (x 130-250), Address (x 250+), Station. A long name wraps onto a line
 * with nothing in the number column.
 */
export function parsePunjabHaryanaPage(items: TextItem[]): RollEntry[] {
  const out: RollEntry[] = [];
  let last: { no: string; name: string } | null = null;
  const flush = () => { if (last) { const e = entry(last.no, last.name); if (e) out.push(e); } last = null; };
  for (const line of lines(items, 2)) {
    const numCol = clean(line.filter((i) => i.x < 130).map((i) => i.str).join(' '));
    const nameCol = line.filter((i) => i.x >= 130 && i.x < 250).map((i) => i.str).join(' ');
    const m = /^\d+\s+([A-Z]{1,3}\s*\/\s*\d{1,6}\s*\/\s*\d{4})$/.exec(numCol);
    if (m) { flush(); last = { no: m[1]!.replace(/\s/g, ''), name: nameCol }; }
    else if (last && !numCol && nameCol.trim()) last.name += ` ${nameCol}`;
  }
  flush();
  return out;
}

/**
 * J&K and Ladakh roll from the High Court (jkhighcourt.nic.in, "Advocate
 * list_cis_<date>.pdf"): the New Enrolment No. column (x 225-300) prints "JK",
 * the number and the year as separate items; Name of Advocate is x 305-465 on
 * (nearly) the same baseline. Old-style numbers ("V.L.NO 123 & date") are
 * free text and are not imported.
 */
export function parseJkCisPage(items: TextItem[]): RollEntry[] {
  const out: RollEntry[] = [];
  for (const anchor of lines(items.filter((i) => i.x >= 225 && i.x < 300), 3)) {
    const m = /^JK\s*(\d{1,6})\s*(\d{4})$/.exec(clean(anchor.map((i) => i.str).join(' ')));
    if (!m) continue;
    const y = anchor[0]!.y;
    const name = items.filter((i) => i.x >= 305 && i.x < 465 && Math.abs(i.y - y) <= 7).sort((a, b) => b.y - a.y || a.x - b.x);
    const e = entry(`JK/${m[1]}/${m[2]}`, name.map((i) => i.str).join(' '));
    if (e) out.push(e);
  }
  return out;
}

export interface RollSource {
  council: string;
  url: string;
  parsePage: (items: TextItem[]) => RollEntry[];
}

// shortcut: the file names carry a year / date and change when the councils republish;
// the import logs a failure then, and the URL here must be updated by hand.
export const ROLL_SOURCES: RollSource[] = [
  {
    council: 'punjab_haryana',
    url: 'https://bcph.co.in/wp-content/uploads/Download/Final%20Electoral%20Roll/FinalElectoral2026.pdf',
    parsePage: parsePunjabHaryanaPage,
  },
  {
    council: 'jk',
    url: 'https://jkhighcourt.nic.in/Advocate%20list_cis_04112026.pdf',
    parsePage: parseJkCisPage,
  },
];

/** Download one roll PDF and parse every page. */
export async function fetchRoll(src: RollSource): Promise<RollEntry[]> {
  const res = await fetch(src.url, {
    headers: { 'User-Agent': 'DifAi-advocate-verification (+https://difai.sirahdigital.in)' },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`${src.council} roll: ${new URL(src.url).host} answered ${res.status}`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Cast: disableWorker/isEvalSupported are valid Node options missing from the published type (as in pdf-ocr.ts).
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()), disableWorker: true, isEvalSupported: false } as never).promise;
  const out: RollEntry[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as Array<{ str?: string; transform?: number[] }>)
      .filter((i) => typeof i.str === 'string' && i.transform)
      .map((i) => ({ x: i.transform![4]!, y: i.transform![5]!, str: i.str! }));
    out.push(...src.parsePage(items));
    page.cleanup();
  }
  await doc.destroy();
  return out;
}
