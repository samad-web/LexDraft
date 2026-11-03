// =============================================================================
// judgment-parse — pure parsing for the judgment corpus (0098_judgments_corpus).
//
// No I/O here: the ingester (scripts/ingest-judgments.ts) downloads, this file
// turns the dataset's raw metadata and the PDF's text into what we store.
//
//   parseScMetadata(json)   Supreme Court: metadata/json/year=YYYY/<path>.json
//   parseHcMetadata(json)   High Courts:   metadata/json/year=YYYY/court=../bench=../<file>.json
//   cleanJudgmentText(t)    drop page furniture (page numbers, running headers, URLs)
//   splitParagraphs(t)      the judgment's OWN numbered paragraphs, in order
//   neutralCitationFromText neutral citation printed in the PDF ("2024:MHC:1234")
//   formatCite(j)           "Case Title v. Other, (citation)" — what drafts cite
//
// Both datasets carry the eCourts result-list HTML as `raw_html`; the fields we
// need are read out of it by label, never guessed. A field that is not there
// stays null.
// =============================================================================

export interface JudgmentMeta {
  sourceKey: string;
  court: string;
  courtCode: string;
  caseTitle: string;
  caseNumber: string | null;
  cnr: string | null;
  neutralCitation: string | null;
  reportedCitations: string[];
  decisionDate: string | null; // ISO yyyy-mm-dd
  bench: string | null;
  benchSize: number | null;
  disposal: string | null;
  language: string;
  sourceUrl: string | null;
}

export interface JudgmentParagraph {
  /** 0-based order within the judgment. */
  seq: number;
  /** The court's own paragraph number (0 = unnumbered preamble). */
  paraNo: number;
  text: string;
}

/** High Courts we know how to label. Keyed by the dataset's court code
 *  ("33~10" in the JSON, "33_10" in S3 paths). */
export const HIGH_COURTS: Record<string, { name: string; code: string; sourceUrl: string }> = {
  '33_10': { name: 'Madras High Court', code: 'MHC', sourceUrl: 'https://www.mhc.tn.gov.in/judis' },
};

export const SUPREME_COURT = {
  name: 'Supreme Court of India',
  code: 'SC',
  sourceUrl: 'https://scr.sci.gov.in',
};

// ---- small helpers ----------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Value printed after "<label> :" in the eCourts result-list HTML. */
function labelled(html: string, label: string): string | null {
  const rx = new RegExp(`${label}\\s*:\\s*(?:<\\/span>)?\\s*(?:<font[^>]*>)?([^<|]+)`, 'i');
  const m = html.match(rx);
  const v = m ? decodeEntities(m[1]!).replace(/\s+/g, ' ').trim() : '';
  return v || null;
}

/** "25-09-2024" / "25.09.2024" / "25/09/2024" -> "2024-09-25"; null if not a real date. */
export function isoDate(dmy: string | null | undefined): string | null {
  const m = dmy?.match(/^\s*(\d{1,2})[-./](\d{1,2})[-./](\d{4})\s*$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const SMALL_WORDS = new Set(['of', 'and', 'for', 'in', 'on', 'to', 'by']);

/** "BELA M. TRIVEDI" -> "Bela M. Trivedi", "THE STATE OF BIHAR" -> "The State
 *  of Bihar". Leaves mixed-case input alone. */
export function nameCase(s: string): string {
  if (/[a-z]/.test(s)) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s.(@'-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
    .replace(/(?<=\s)(Of|And|For|In|On|To|By)(?=\s)/g, (w) => (SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w));
}

/** "2024INSC735" -> "2024 INSC 735". */
function spacedNeutral(nc: string): string {
  const m = nc.replace(/\s+/g, '').match(/^(\d{4})INSC(\d+)$/i);
  return m ? `${m[1]} INSC ${m[2]}` : nc.trim();
}

// ---- metadata ---------------------------------------------------------------

interface ScRawMeta {
  raw_html?: string;
  path?: string;
  citation_year?: string;
  nc_display?: string;
}

/** Supreme Court metadata JSON -> JudgmentMeta. Returns null when the record
 *  has no usable title (nothing we could cite honestly). */
export function parseScMetadata(raw: ScRawMeta): JudgmentMeta | null {
  const html = raw.raw_html ?? '';
  if (!raw.path) return null;

  // aria-label carries the title in its proper case: " X versus Y pdf".
  const aria = html.match(/aria-label="\s*([^"]*?)\s*pdf"/i)?.[1];
  const strong = html.match(/<font size='4'>\s*<strong>([\s\S]*?)<\/strong>/i)?.[1];
  const rawTitle = aria
    ? decodeEntities(aria)
    : strong ? stripTags(strong).split(/\s+versus\s+/i).map((p) => nameCase(p.trim())).join(' versus ') : '';
  const caseTitle = rawTitle.replace(/\s+versus\s+/i, ' v. ').replace(/\s+/g, ' ').trim();
  if (!caseTitle) return null;

  const escr = html.match(/class='escrText'>([^<]*)</i)?.[1];
  const ncHtml = html.match(/class='ncDisplay'>([^<]*)</i)?.[1];
  const nc = (ncHtml || raw.nc_display || '').trim();

  const coramRaw = html.match(/Coram\s*:\s*([\s\S]*?)<\/strong>/i)?.[1];
  const judges = coramRaw
    ? stripTags(coramRaw.replace(/<sup[\s\S]*?<\/sup>/gi, '')).replace(/\*/g, '')
      .split(',').map((j) => nameCase(j.trim())).filter(Boolean)
    : [];
  const benchLabel = labelled(html, 'Bench');
  const benchSize = Number(benchLabel?.match(/(\d+)/)?.[1]) || (judges.length || null);

  return {
    sourceKey: `sc:${raw.path}`,
    court: SUPREME_COURT.name,
    courtCode: SUPREME_COURT.code,
    caseTitle,
    caseNumber: labelled(html, 'Case No'),
    cnr: html.match(/id='cnr'\s+value=([A-Z0-9]+)/i)?.[1] ?? null,
    neutralCitation: nc ? spacedNeutral(nc) : null,
    reportedCitations: escr ? [decodeEntities(escr).replace(/\s+/g, ' ').trim()] : [],
    decisionDate: isoDate(labelled(html, 'Decision Date')),
    bench: judges.length ? judges.join(', ') : null,
    benchSize,
    disposal: labelled(html, 'Disposal Nature'),
    language: 'en',
    sourceUrl: SUPREME_COURT.sourceUrl,
  };
}

interface HcRawMeta {
  court_code?: string;
  court_name?: string;
  raw_html?: string;
  pdf_link?: string;
}

/** High Court metadata JSON -> JudgmentMeta. `fileKey` is the JSON file's
 *  basename without extension (e.g. "HCMA010000062024_1_2024-04-18"). */
export function parseHcMetadata(raw: HcRawMeta, fileKey: string): JudgmentMeta | null {
  const html = raw.raw_html ?? '';
  const courtPath = (raw.court_code ?? '').replace(/~/g, '_');
  const known = HIGH_COURTS[courtPath];
  const courtName = known?.name ?? raw.court_name?.trim();
  if (!courtName || !courtPath) return null;

  // "<font size='3'>HCP/83/2024 of M.KALA Vs THE SECRETARY TO THE GOVERNMENT</button>"
  const head = html.match(/<font size='3'>([\s\S]*?)<\/button>/i)?.[1];
  const text = head ? stripTags(head) : '';
  // The case number ("HCP/83/2024", "CRL OP/163/2024") runs up to the first " of ".
  const m = text.match(/^([A-Za-z][A-Za-z.() ]*\/\s*\d+\s*\/\s*\d{4})\s+of\s+(.+?)\s+Vs\.?\s+(.+)$/i);
  const party = (s: string) => s.trim().replace(/[\s,;:]+$/, '');
  const caseNumber = m ? m[1]!.replace(/\s+/g, ' ') : null;
  const caseTitle = m ? `${party(m[2]!)} v. ${party(m[3]!)}` : text;
  if (!caseTitle) return null;

  const judgeRaw = labelled(html, 'Judge');
  const judges = judgeRaw
    ? judgeRaw.split(',')
      .map((j) => j.replace(/^\s*(?:THE\s+)?HON'?OU?RABLE\s+(?:(?:MR|MRS|MS|DR)\.?\s+)?(?:CHIEF\s+)?JUSTICE\s+/i, '').trim())
      .filter(Boolean)
      .map(nameCase)
    : [];

  return {
    sourceKey: `hc:${courtPath}:${fileKey}`,
    court: courtName,
    courtCode: known?.code ?? courtPath,
    caseTitle: caseTitle.replace(/\s+/g, ' '),
    caseNumber,
    cnr: labelled(html, 'CNR'),
    neutralCitation: null, // read from the judgment text, see neutralCitationFromText
    reportedCitations: [],
    decisionDate: isoDate(labelled(html, 'Decision Date')),
    bench: judges.length ? judges.join(', ') : null,
    benchSize: judges.length || null,
    disposal: labelled(html, 'Disposal Nature'),
    language: 'en',
    sourceUrl: known?.sourceUrl ?? null,
  };
}

/** Neutral citation printed in the judgment itself, when the court uses one.
 *  "2024:MHC:1234" (High Courts, "<year>:<court>:<n>") or "2024 INSC 735". */
export function neutralCitationFromText(text: string): string | null {
  const hc = text.match(/\b((?:19|20)\d{2}):([A-Z]{2,8}(?:-[A-Z]{1,4})?):(\d{1,6})(?:-[A-Z]{2,4})?\b/);
  if (hc) return `${hc[1]}:${hc[2]}:${hc[3]}`;
  const sc = text.match(/\b((?:19|20)\d{2})\s*INSC\s*(\d{1,5})\b/);
  return sc ? `${sc[1]} INSC ${sc[2]}` : null;
}

/** "Case Title v. Other, (2024 INSC 735; [2024] 10 S.C.R. 108)". When there is
 *  no citation at all, the case number, court and date identify it instead. */
export function formatCite(j: {
  caseTitle: string;
  neutralCitation?: string | null;
  reportedCitations?: string[] | null;
  caseNumber?: string | null;
  court?: string | null;
  decisionDate?: string | null;
}): string {
  const cites = [j.neutralCitation, ...(j.reportedCitations ?? [])].filter((c): c is string => !!c && !!c.trim());
  if (cites.length) return `${j.caseTitle}, (${[...new Set(cites)].join('; ')})`;
  const date = j.decisionDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const ident = [j.caseNumber, j.court, date ? `${date[3]}.${date[2]}.${date[1]}` : null].filter(Boolean);
  return ident.length ? `${j.caseTitle}, (${ident.join(', ')})` : j.caseTitle;
}

// ---- text -------------------------------------------------------------------

// Page furniture that pdf-parse emits between paragraphs.
const FURNITURE: RegExp[] = [
  /^\d{1,4}$/,                                          // bare page number
  /^\d{1,4}\s*\/\s*\d{1,4}$/,                           // "38/43" page x of y
  /^https?:\/\/\S+$/i,                                  // "https://www.mhc.tn.gov.in/judis" footer
  /^\[\d{4}\]\s*\d+\s*S\.C\.R\.\s*\d+$/i,               // "[2024] 10 S.C.R.  109" SCR running head
  /^\d+\s*\[\d{4}\]\s*\d+\s*S\.C\.R\.$/i,               // "110 [2024] 10 S.C.R."
  /^Digital Supreme Court Reports$/i,
];

// SCR PDFs set fi / fl / ff as ligature glyphs that extract with a space after
// them: "off ence", "fi ndings", "fi led", "eff ect". Rejoin them. "ff" is only
// rejoined before known continuations, so "off the" / "staff members" stay apart.
const FF_TAILS = 'ence|ences|ect|ects|ective|ectively|er|ers|ered|ering|ice|icer|icers|icial|ord|orded|ort|orts|ix|ixed|irm|irmed|idavit|idavits|end|ender|ended|ending|erence|erent|iliated|lict';
export function rejoinLigatures(text: string): string {
  return text
    .replace(/\b(\w*)(ffi|ffl|fi|fl) (?=[a-z])/g, '$1$2')
    .replace(new RegExp(String.raw`\b(\w*ff) (?=(?:${FF_TAILS})\b)`, 'g'), '$1');
}

/** Normalise PDF text and drop page furniture: page numbers, footer URLs,
 *  reporter running heads, and any short line repeated on 3+ pages (the case
 *  number / cause title printed at the top of every page). */
export function cleanJudgmentText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- C0 controls pdf-parse emits (Postgres rejects 0x00)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\u00AD]/g, '')
    .replace(/\u00A0/g, ' ')
    .split('\n')
    .map((l) => rejoinLigatures(l.replace(/\s+/g, ' ').trim()));

  const counts = new Map<string, number>();
  for (const l of lines) if (l.length >= 8 && l.length <= 120) counts.set(l, (counts.get(l) ?? 0) + 1);

  return lines
    .filter((l) => {
      if (!l) return true;
      if (FURNITURE.some((rx) => rx.test(l))) return false;
      if ((counts.get(l) ?? 0) >= 3 && !/^\d{1,3}\s*\./.test(l)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Where the court's own text starts: the "JUDGMENT" / "ORDER" heading.
const BODY_HEADING = /^(?:common\s+)?(?:judg(?:e)?ment|order)(?:\s*\/\s*order)?(?:\s+of\s+the\s+(?:supreme\s+)?court)?\s*:?$|^j\s+u\s+d\s+g\s+(?:e\s+)?m\s+e\s+n\s+t$|^o\s+r\s+d\s+e\s+r$/i;
// Judge-name lines right under the heading ("M.S.RAMESH, J.", "AND", "(Delivered by ...)").
const AUTHOR_LINE = /^(?:[A-Z][A-Za-z .]*,\s*(?:C\.\s*)?J\.?|AND|\(.*\)|J\s*U\s*D\s*G\s*M\s*E\s*N\s*T|JUDG(?:E)?MENT)$/;
// Where it ends: signature initials ("[M.S.R., J]"), copy-to list ("To" — case-
// sensitive, a wrapped "to" is just prose), MHC index footer, SCR editorial tail.
const BODY_END = [
  /^(?:To,?|Copy to:?)$/,
  /^\[[A-Z][A-Z.\s]*,\s*(?:C\.\s*)?J\.?\]/,
  /^(?:Internet\s*:.*|Index\s*:.*|Neutral Citation\s*:?.*|\W*Headnotes prepared by.*|Result of the case.*)$/i,
];
const NUMBERED = /^(\d{1,3})\s*\.\s*(?![\d)])(.*)$/;
// A line that is only a date ("09.01.2024") right after a finished sentence is
// the date under the signature, not prose.
const SIGNATURE_DATE = /^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/;
// Caption repeated above an un-headed order: "Crl.O.P.No.163 of 2024".
const CASE_NO_LINE = /^[A-Za-z.() ]*No\.?\s*[\d,&\s]+(?:and\s+\d+\s*)?of\s+\d{4}$/i;

const MAX_PARA_CHARS = 3_000;
const FALLBACK_CHUNK = 1_200;

/** Join wrapped lines into one paragraph ("brother-\nin-law" stays hyphenated). */
function joinLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (!out) out = l;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(l)) out += l;
    else out += ` ${l}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Split text into ~`size`-char pieces at sentence ends. */
function chunkSentences(text: string, size: number): string[] {
  if (text.length <= size * 1.5) return [text];
  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && cur.length + s.length > size) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * The judgment's own numbered paragraphs, in order. Numbering must run in
 * sequence (1, 2, 3 ...) so a numbered address list or a "3.1" sub-paragraph
 * doesn't restart it. Text before paragraph 1 (after the JUDGMENT/ORDER
 * heading) is kept as para 0; when the court left the first paragraph
 * unnumbered and started at "2.", that text is para 1. A paragraph longer than
 * ~3,000 chars is split into parts that share its number.
 *
 * When the text has no usable numbering (fewer than 2 numbered paragraphs),
 * falls back to ~1,200-char sentence-aligned chunks numbered 1..n and returns
 * `numbered: false` so callers can tell.
 */
export function splitParagraphs(cleaned: string): { paragraphs: JudgmentParagraph[]; numbered: boolean } {
  const all = cleaned.split('\n');
  const headingAt = all.findIndex((l) => BODY_HEADING.test(l.trim()));
  let start = headingAt >= 0 ? headingAt + 1 : 0;
  const skippable = (l: string) => !l || AUTHOR_LINE.test(l) || BODY_HEADING.test(l);
  while (start < all.length && skippable(all[start]!.trim())) start += 1;
  const body = all.slice(start);

  const blocks: Array<{ no: number; lines: string[] }> = [];
  const preamble: string[] = [];
  let expected = 1;
  for (const line of body) {
    const l = line.trim();
    if (blocks.length && BODY_END.some((rx) => rx.test(l))) break;
    if (blocks.length && SIGNATURE_DATE.test(l) && /[.)]$/.test(blocks[blocks.length - 1]!.lines.at(-1) ?? '')) break;
    if (!blocks.length && (AUTHOR_LINE.test(l) || CASE_NO_LINE.test(l))) continue;
    const m = l.match(NUMBERED);
    const n = m ? Number(m[1]) : NaN;
    const startsPara = m && (n === expected || (!blocks.length && n === 2));
    if (startsPara) {
      blocks.push({ no: n, lines: [m![2]!] });
      expected = n + 1;
    } else if (blocks.length) {
      blocks[blocks.length - 1]!.lines.push(l);
    } else {
      preamble.push(l);
    }
  }

  const out: JudgmentParagraph[] = [];
  const push = (paraNo: number, text: string) => {
    for (const part of chunkSentences(text, MAX_PARA_CHARS)) if (part) out.push({ seq: out.length, paraNo, text: part });
  };

  if (blocks.length >= 2) {
    const pre = joinLines(preamble);
    // Numbering that starts at 2 means the preamble IS paragraph 1, however short.
    if (blocks[0]!.no === 2 ? pre.length >= 20 : pre.length >= 80) push(blocks[0]!.no === 2 ? 1 : 0, pre);
    for (const b of blocks) {
      const text = joinLines(b.lines);
      if (text) push(b.no, text);
    }
    return { paragraphs: out, numbered: true };
  }

  const whole = joinLines(body.length ? body : all);
  chunkSentences(whole, FALLBACK_CHUNK).forEach((t, i) => out.push({ seq: i, paraNo: i + 1, text: t }));
  return { paragraphs: out, numbered: false };
}
