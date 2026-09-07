// =============================================================================
// draft-blocks — turning the drafting pipelines' internal BLOCK KEYS into a
// filing-ready document body, and extracting the OPEN ITEMS that must reach the
// advocate as a separate checklist (never buried in the document).
//
// WHY THIS EXISTS:
// The grounded pipelines emit a map of block-key -> drafted text
// ({ causeTitle, facts, grounds, prayer, verification, ... }). Two accept-flows
// used to assemble the body with `${key.toUpperCase()}` as the heading, which
// leaked internal keys into the filed document ("causeTitle" -> "CAUSETITLE").
// A court document must never show these. `renderDraftBlocks` maps each key to
// its correct forum-convention heading — and renders the document's OPENING
// blocks (cause title, deed title, deponent line, ...) with NO heading at all,
// because those blocks ARE the document's own heading.
//
// Separately, `collectOpenItems` implements the system-prompt Step 9 contract:
// unfilled placeholders, sections still to verify, and advisories are surfaced
// as a list SEPARATE from the body so they cannot be filed by accident.
// =============================================================================

/**
 * Block-key -> heading label. A value of `null` means "render this block with
 * NO heading" — it is (or contains) the document's own opening/title and a
 * label would be wrong ("CAUSETITLE" over a cause title, etc.).
 */
const BLOCK_HEADINGS: Record<string, string | null> = {
  // Opening / title-bearing blocks — rendered label-less.
  causeTitle: null,
  deedTitle: null,
  agreementTitle: null,
  title: null,
  header: null,
  deponent: null,
  appointment: null,
  willDeclaration: null,
  bondObligation: null,
  poaAppointment: null,
  opening: null,
  signature: null,
  execution: null,
  testimonium: null,
  attestation: null,

  // Substantive blocks — rendered with a proper heading.
  facts: 'FACTS',
  grounds: 'GROUNDS',
  prayer: 'PRAYER',
  verification: 'VERIFICATION',
  undertaking: 'UNDERTAKING',
  jurat: 'VERIFICATION',
  recital: 'RECITALS',
  recitals: 'RECITALS',
  operative: 'OPERATIVE PART',
  terms: 'TERMS',
  boilerplate: 'GENERAL',
  schedule: 'SCHEDULE',
  parties: 'PARTIES',
  preliminaryObjections: 'PRELIMINARY OBJECTIONS',
  paraWiseReply: 'REPLY ON MERITS',
  apprehension: 'APPREHENSION OF ARREST',
  submissions: 'SUBMISSIONS',
  infoSought: 'INFORMATION SOUGHT',
  demand: 'DEMAND',
  binding: 'BINDING / NON-BINDING',
  bequests: 'BEQUESTS',
  powers: 'POWERS',
  condition: 'CONDITION',
  close: 'DECLARATION',
};

/**
 * De-camelCase an unknown block key into an UPPER-CASED heading, so an
 * unmapped key never prints as a raw camelCase token. "someNewKey" -> "SOME NEW KEY".
 */
function fallbackHeading(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toUpperCase();
}

/** The heading for a block key: mapped value (which may be `null` = no heading),
 *  or a de-camelCased fallback for unknown keys. `undefined` return means the
 *  key is known and deliberately label-less. */
export function headingForBlock(key: string): string | null {
  if (key in BLOCK_HEADINGS) return BLOCK_HEADINGS[key] ?? null;
  return fallbackHeading(key);
}

/**
 * Assemble the drafting pipeline's block map into a single document body string,
 * preserving the given order, with correct forum-convention headings. Internal
 * block keys are NEVER emitted; opening/title blocks are rendered label-less.
 * Empty block values are skipped.
 */
export function renderDraftBlocks(blocks: Record<string, string>): string {
  return Object.entries(blocks)
    .filter(([, v]) => typeof v === 'string' && v.trim().length > 0)
    .map(([k, v]) => {
      const heading = headingForBlock(k);
      const text = v.trim();
      return heading ? `${heading}\n\n${text}` : text;
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Emphasis: bold the legally-salient words in a drafted document body.
// ---------------------------------------------------------------------------

/**
 * Bold the important words in a drafted document's HTML — applied to EVERY
 * drafting path (engine intake and model auto-draft) so drafts read like filed
 * documents: the key terms stand out. This runs on the RENDERED HTML, right
 * before the preview/export, and only ever wraps matches in <strong>…</strong>;
 * it never changes the words themselves.
 *
 * What counts as important (court/legal convention):
 *   • statute / section citations — "Section 138", "u/s 420 IPC", "Order VII Rule 11"
 *   • the Acts themselves — "Negotiable Instruments Act, 1881", "IPC", "BNS"
 *   • money amounts — "Rs. 3,99,088", "₹1,20,000", "INR 25,00,000"
 *   • the standing legal-notice cue words — "hereby", "called upon", "within 15 days"
 *   • structural headings we emit (FACTS / GROUNDS / PRAYER / DEMAND / …)
 *
 * Safety: we only ever operate on TEXT nodes (never inside tags/attributes),
 * skip anything already inside a <strong>/<b>, and leave the advocate's own
 * manual edits untouched (the caller passes edited HTML through unchanged).
 */
export function emphasizeLegalTerms(html: string): string {
  if (!html) return html;

  // Ordered patterns — each is applied to raw text spans only. Kept deliberately
  // conservative so we bold real legal salients, not stray words.
  const PATTERNS: RegExp[] = [
    // Money: Rs./₹/INR followed by an amount (Indian or plain grouping), optional paise.
    /(?:(?:Rs\.?|₹|INR)\s?)[\d,]+(?:\.\d{1,2})?(?:\s?(?:only|\/-))?/gi,
    // Worded amounts: "25 lakh", "1.2 crore".
    /\b\d[\d,]*(?:\.\d+)?\s?(?:lakhs?|crores?)\b/gi,
    // Section / statute citations.
    /\bu\/s\.?\s?\d+[A-Z]*(?:\s?(?:\([\dA-Za-z]+\)))*/gi,
    /\b(?:Sections?|Secs?\.?|§)\s?\d+[A-Z]*(?:\s?(?:\([\dA-Za-z]+\)))*(?:\s?(?:and|,|&|to)\s?\d+[A-Z]*)*/gi,
    /\bOrder\s+[IVXLC]+\s+Rule\s+\d+/gi,
    /\bArticle\s+\d+[A-Z]*/gi,
    // Named Acts (with or without year), and the common abbreviations.
    /\b[A-Z][A-Za-z&.\s]{2,60}?Act,?\s?\d{4}/g,
    /\b(?:IPC|CrPC|CPC|BNS|BNSS|BSA|NI Act|N\.I\. Act)\b/g,
    // Notice cue phrases the reader must not miss.
    /\bhereby\b/gi,
    /\bcalled upon\b/gi,
    /\bwithin\s+\d+\s+days\b/gi,
    /\bfailing which\b/gi,
  ];

  // Split on tags so we only touch text between them; also track <strong>/<b>
  // depth to avoid double-wrapping something already bold.
  const parts = html.split(/(<[^>]+>)/);
  let boldDepth = 0;
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    if (seg.startsWith('<')) {
      if (/^<\s*(strong|b)\b/i.test(seg)) boldDepth++;
      else if (/^<\s*\/\s*(strong|b)\b/i.test(seg)) boldDepth = Math.max(0, boldDepth - 1);
      continue; // never rewrite a tag
    }
    if (boldDepth > 0) continue; // already inside bold — leave as-is
    let text = seg;
    for (const re of PATTERNS) {
      text = text.replace(re, (match) => `<strong>${match}</strong>`);
    }
    parts[i] = text;
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Open items (system-prompt Step 9): surfaced SEPARATELY from the body.
// ---------------------------------------------------------------------------

/**
 * Scan assembled draft text for bracketed placeholders — "[father's name to be
 * supplied]", "[date]", "[TO BE CONFIRMED: ...]". Deduped case-insensitively and
 * trimmed. Deliberately EXCLUDES neutral citation brackets that carry no
 * placeholder intent (e.g. "[2019]" in "[2019] 4 SCC 1", or a bare "[4]"): a
 * segment with NO letter is not a fill-in-the-blank and is ignored.
 */
export function scanPlaceholders(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] ?? '').trim();
    if (!raw) continue;
    // Ignore neutral/numeric brackets (citations, footnote markers) — a real
    // placeholder always contains at least one letter to describe what's missing.
    if (!/[a-z]/i.test(raw)) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

/** A consolidated open-items set, grouped so the UI can render one panel. */
export interface OpenItems {
  /** Bracketed placeholders still to be filled. */
  placeholders: string[];
  /** Sections/citations the advocate must verify before filing. */
  toVerify: string[];
  /** Advisories / missing-detail prompts from the pipeline. */
  advisories: string[];
}

/** True when there is at least one open item to show. */
export function hasOpenItems(o: OpenItems | null | undefined): boolean {
  if (!o) return false;
  return o.placeholders.length > 0 || o.toVerify.length > 0 || o.advisories.length > 0;
}

interface CollectInput {
  /** The assembled document body (placeholders are scanned from this). */
  bodyText?: string;
  /** Placeholders the pipeline's VERIFY stage already reported. */
  verifyPlaceholders?: string[];
  /** needs_clarification from EXTRACT. */
  needsClarification?: string[];
  /** Human-readable advisories from the orchestrator. */
  advisories?: string[];
  /** Sections still to verify (SUGGESTED / not counsel-confirmed), as labels. */
  toVerify?: string[];
}

/**
 * Build the open-items list from a body scan plus whatever the pipeline
 * surfaced. Everything is deduped. This is DERIVED data — it must never be
 * written back into the exportable body.
 */
export function collectOpenItems(input: CollectInput): OpenItems {
  const dedupe = (items: (string | undefined)[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const it of items) {
      const s = (it ?? '').trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
    }
    return out;
  };

  const placeholders = dedupe([
    ...scanPlaceholders(input.bodyText ?? ''),
    ...(input.verifyPlaceholders ?? []),
  ]);
  const advisories = dedupe([...(input.advisories ?? []), ...(input.needsClarification ?? [])]);
  const toVerify = dedupe(input.toVerify ?? []);

  return { placeholders, toVerify, advisories };
}
