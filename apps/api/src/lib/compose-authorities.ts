// =============================================================================
// compose-authorities — the VERIFIED AUTHORITY SET a compose pass may cite.
//
// Compose used to be allowed only the provisions already in the engine skeleton,
// so grounds read as facts without law. The authority set widens that, without
// letting the model cite from memory: every provision it may add is either
//
//   curated     a small, well-known anchor list per document family (heading
//               only — the model may rely on what the heading says, nothing more)
//   statute-db  a section retrieved from our own statute corpus (laws-search),
//               passed with its actual text
//
// The guard (draft-guards.unauthorisedCitations) then requires every NEW section
// or article in the composed body to match an authority here, with that
// authority's Act named in the same sentence. Case law is deliberately absent
// until the judgment corpus exists: a reported citation the skeleton doesn't
// carry is still stripped.
//
// Curated anchors are counsel-reviewable data: keep them to provisions whose
// number and heading are settled; never add text the heading doesn't state.
// =============================================================================

import { logger } from '../logger';
import { COMPOSE_FAMILY, type ComposeFamily } from './compose-families';
import { lawsSearchService, type LawHit } from '../services/laws-search.service';
import { citationKey, judgmentCitationsIn, particularsOf, sentencesOf } from './draft-guards';

export interface Authority {
  /** How the composed text should cite it: "Section 480 of the Bharatiya Nagarik Suraksha Sanhita, 2023". */
  cite: string;
  /** Short heading of the provision. */
  heading: string;
  /** Statute text, when retrieved from the corpus (trimmed). Curated anchors have none. */
  text?: string;
  /** Matches the Act's name or usual abbreviation in a sentence (case-insensitive). */
  actPattern: string;
  source: 'curated' | 'statute-db' | 'judgment';
  /** Link to the source (statute page / judgment), when known. */
  url?: string;
}

const BNSS = { act: 'Bharatiya Nagarik Suraksha Sanhita, 2023', pattern: 'BNSS|Bharatiya Nagarik Suraksha Sanhita' };
const COI = { act: 'Constitution of India', pattern: 'Constitution' };
const CPC = { act: 'Code of Civil Procedure, 1908', pattern: 'CPC|C\\.P\\.C|Code of Civil Procedure' };
const SRA = { act: 'Specific Relief Act, 1963', pattern: 'Specific Relief Act' };
const NIA = { act: 'Negotiable Instruments Act, 1881', pattern: 'N\\.?I\\.? Act|Negotiable Instruments Act' };
const CPA = { act: 'Consumer Protection Act, 2019', pattern: 'Consumer Protection Act' };
const HMA = { act: 'Hindu Marriage Act, 1955', pattern: 'H\\.?M\\.? Act|Hindu Marriage Act' };
const DVA = { act: 'Protection of Women from Domestic Violence Act, 2005', pattern: 'D\\.?V\\.? Act|Domestic Violence Act' };
const TPA = { act: 'Transfer of Property Act, 1882', pattern: 'T\\.?P\\.? Act|Transfer of Property Act' };
const MVA = { act: 'Motor Vehicles Act, 1988', pattern: 'M\\.?V\\.? Act|Motor Vehicles Act' };
const BSA = { act: 'Bharatiya Sakshya Adhiniyam, 2023', pattern: 'BSA|Bharatiya Sakshya Adhiniyam' };

type ActRef = { act: string; pattern: string };
const sec = (a: ActRef, n: string, heading: string): Authority =>
  ({ cite: `Section ${n} of the ${a.act}`, heading, actPattern: a.pattern, source: 'curated' });
const art = (n: string, heading: string): Authority =>
  ({ cite: `Article ${n} of the ${COI.act}`, heading, actPattern: COI.pattern, source: 'curated' });
/** A CPC Order/Rule, e.g. ord('VIII', 'Rules 3, 4 and 5', '…'). */
const ord = (order: string, rules: string, heading: string): Authority =>
  ({ cite: `Order ${order} ${rules} of the ${CPC.act}`, heading, actPattern: CPC.pattern, source: 'curated' });

const CURATED: Record<ComposeFamily, Authority[]> = {
  s138_notice: [
    sec(NIA, '138', 'Dishonour of cheque for insufficiency, etc., of funds in the account'),
    sec(NIA, '139', 'Presumption in favour of holder'),
  ],
  complaint: [
    sec(NIA, '138', 'Dishonour of cheque for insufficiency, etc., of funds in the account'),
    sec(NIA, '139', 'Presumption in favour of holder'),
    sec(NIA, '141', 'Offences by companies'),
    sec(NIA, '142', 'Cognizance of offences'),
  ],
  bail: [
    sec(BNSS, '480', 'When bail may be taken in case of non-bailable offence (formerly Section 437 CrPC)'),
    sec(BNSS, '482', 'Direction for grant of bail to person apprehending arrest (formerly Section 438 CrPC)'),
    sec(BNSS, '483', 'Special powers of High Court or Court of Session regarding bail (formerly Section 439 CrPC)'),
    sec(BNSS, '187', 'Procedure when investigation cannot be completed in twenty-four hours (formerly Section 167 CrPC)'),
    sec(BNSS, '479', 'Maximum period for which undertrial prisoner can be detained (formerly Section 436A CrPC)'),
    art('21', 'Protection of life and personal liberty'),
  ],
  writ: [
    art('14', 'Equality before law'),
    art('19(1)(g)', 'Right to practise any profession, or to carry on any occupation, trade or business'),
    art('21', 'Protection of life and personal liberty'),
    art('226', 'Power of High Courts to issue certain writs'),
    art('300A', 'Persons not to be deprived of property save by authority of law'),
  ],
  suit: [
    sec(CPC, '9', 'Courts to try all civil suits unless barred'),
    sec(CPC, '20', 'Other suits to be instituted where defendants reside or cause of action arises'),
    sec(SRA, '10', 'Cases in which specific performance of contract enforced'),
    sec(SRA, '38', 'Perpetual injunction when granted'),
    ord('VII', 'Rule 1', 'Particulars to be contained in plaint'),
    ord('XXXIX', 'Rules 1 and 2', 'Cases in which temporary injunction may be granted; injunction to restrain repetition or continuance of breach'),
  ],
  family: [
    sec(HMA, '9', 'Restitution of conjugal rights'),
    sec(HMA, '10', 'Judicial separation'),
    sec(HMA, '13', 'Divorce'),
    sec(HMA, '24', 'Maintenance pendente lite and expenses of proceedings'),
    sec(DVA, '12', 'Application to Magistrate'),
    sec(BNSS, '144', 'Order for maintenance of wives, children and parents (formerly Section 125 CrPC)'),
  ],
  notice: [
    sec(CPC, '80', 'Notice (to the Government or a public officer before a suit)'),
    sec(TPA, '106', 'Duration of certain leases in absence of written contract or local usage'),
  ],
  consumer: [
    sec(CPA, '2(7)', 'Definition of "consumer"'),
    sec(CPA, '2(11)', 'Definition of "deficiency"'),
    sec(CPA, '2(47)', 'Definition of "unfair trade practice"'),
    sec(CPA, '35', 'Manner in which complaint shall be made'),
  ],
  mact: [
    sec(MVA, '166', 'Application for compensation'),
    sec(MVA, '168', 'Award of the Claims Tribunal'),
  ],
  // Orders/Rules (O8 R3-5, O39 R2A) are cited by the skeleton itself. Applications
  // span civil and criminal courts, so no shared anchor (s.151 CPC in a criminal
  // recall petition would be wrong); the corpus hits are matter-specific.
  reply: [
    ord('VIII', 'Rules 3, 4 and 5', 'Denial to be specific; evasive denial; specific denial — allegations not denied deemed admitted'),
  ],
  application: [],
  // s.528 BNSS vs s.482 CrPC depends on when the proceeding began; the engine's
  // router puts the right one in the skeleton, so it isn't offered here.
  quash: [
    art('21', 'Protection of life and personal liberty'),
  ],
  // Civil and criminal appeals share a guide; their forum provisions come from the
  // engine skeleton (router-resolved BNSS/CrPC, CPC), so no shared anchor here.
  appeal: [],
  generic: [],
};

/**
 * Per document type, where a family's shared list would offer the wrong remedy's
 * provision (a mutual-consent divorce offered s.13 instead of s.13B; a regular bail
 * offered the anticipatory/default-bail sections). Takes precedence over CURATED.
 */
const ART21 = art('21', 'Protection of life and personal liberty');
const BY_DOC: Record<string, Authority[]> = {
  regular_bail: [
    sec(BNSS, '480', 'When bail may be taken in case of non-bailable offence (formerly Section 437 CrPC)'),
    sec(BNSS, '483', 'Special powers of High Court or Court of Session regarding bail (formerly Section 439 CrPC)'),
    sec(BNSS, '479', 'Maximum period for which undertrial prisoner can be detained (formerly Section 436A CrPC)'),
    // A regular application may still plead the default-bail right when no charge
    // sheet is filed in time (QA: 69 days' custody on a 7-year offence, none filed).
    sec(BNSS, '187', 'Procedure when investigation cannot be completed in twenty-four hours (formerly Section 167 CrPC)'),
    ART21,
  ],
  anticipatory_bail: [
    sec(BNSS, '482', 'Direction for grant of bail to person apprehending arrest (formerly Section 438 CrPC)'),
    ART21,
  ],
  default_bail: [
    sec(BNSS, '187', 'Procedure when investigation cannot be completed in twenty-four hours (formerly Section 167 CrPC)'),
    ART21,
  ],
  divorce_mutual_first: [sec(HMA, '13B', 'Divorce by mutual consent')],
  divorce_mutual_second: [sec(HMA, '13B', 'Divorce by mutual consent')],
  divorce_contested: [sec(HMA, '13', 'Divorce'), sec(HMA, '24', 'Maintenance pendente lite and expenses of proceedings')],
  restitution_conjugal_rights: [sec(HMA, '9', 'Restitution of conjugal rights')],
  judicial_separation: [sec(HMA, '10', 'Judicial separation'), sec(HMA, '13', 'Divorce')],
  maintenance: [sec(BNSS, '144', 'Order for maintenance of wives, children and parents (formerly Section 125 CrPC)')],
  // Suits for immovable property lie where the property is (s.16 CPC), not s.20.
  specific_performance: [
    sec(CPC, '16', 'Suits to be instituted where subject-matter situate'),
    sec(SRA, '10', 'Cases in which specific performance of contract enforced'),
    sec(SRA, '16', 'Personal bars to relief'),
    sec(SRA, '22', 'Power to grant relief for possession, partition, refund of earnest money, etc.'),
  ],
  ejectment: [
    sec(CPC, '16', 'Suits to be instituted where subject-matter situate'),
    sec(TPA, '106', 'Duration of certain leases in absence of written contract or local usage'),
  ],
  permanent_injunction: [
    sec(CPC, '16', 'Suits to be instituted where subject-matter situate'),
    sec(SRA, '38', 'Perpetual injunction when granted'),
  ],
  consumer_complaint: [
    sec(CPA, '2(7)', 'Definition of "consumer"'),
    sec(CPA, '2(10)', 'Definition of "defect" (goods)'),
    sec(CPA, '2(11)', 'Definition of "deficiency" (services)'),
    sec(CPA, '34', 'Jurisdiction of District Commission'),
    sec(CPA, '35', 'Manner in which complaint shall be made'),
    sec(CPA, '69', 'Limitation period'),
  ],
  mact_claim: [
    sec(MVA, '166', 'Application for compensation (including the six-month limit in sub-section (3))'),
    sec(MVA, '168', 'Award of the Claims Tribunal'),
  ],
  dv_application: [sec(DVA, '12', 'Application to Magistrate')],
  // A writ counter is not a CPC pleading (Explanation to s.141 CPC): no Order VIII.
  counter_affidavit: [],
};

/** Act-level statutes keyed on the subject of the matter (Tamil Nadu state Acts
 *  our statute corpus doesn't hold). No section: a section the model adds to one
 *  is not in this set, so the guard strips it — only the Act itself may be named. */
const act = (title: string, heading: string, pattern: string): Authority =>
  ({ cite: `the ${title}`, heading, actPattern: pattern, source: 'curated' });
const BY_SUBJECT: Array<{ when: RegExp; add: Authority[] }> = [
  { when: /\bpatta\b|transfer of registry|mutation/i,
    add: [act('Tamil Nadu Patta Pass Book Act, 1983', 'Patta pass books and the record of rights in land (cite the Act only; verify the provision for transfer of registry)', 'Patta Pass Book')] },
  // r12 civil revision: refusing a handwriting-expert reference had no statutory basis.
  { when: /handwriting expert|disputed (?:signature|handwriting)|expert opinion/i,
    add: [sec(BSA, '39', 'Opinions of experts — on handwriting or finger impressions, the opinion of a person specially skilled is relevant (formerly Section 45 of the Indian Evidence Act, 1872)')] },
];

const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A corpus hit -> an Authority, or null when it can't be cited precisely. */
function fromHit(h: LawHit): Authority | null {
  if (!h.sectionNumber || !h.actTitle) return null;
  // Strip the year and any trailing comma: "The Indian Contract Act, 1872" -> "Indian Contract Act".
  const bare = h.actTitle.replace(/^the\s+/i, '').replace(/,?\s*\(?\d{4}\)?\s*$/, '').trim();
  if (bare.length < 4) return null;
  const text = h.content.replace(/\s+/g, ' ').trim();
  // Pleadings usually abbreviate the Act ("BNS"), so its initials match too.
  const initials = bare.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('');
  return {
    cite: `Section ${h.sectionNumber} of the ${h.actTitle.replace(/^the\s+/i, '')}`,
    heading: h.sectionHeading ?? '',
    text: text.length > 600 ? `${text.slice(0, 600)}…` : text,
    actPattern: initials.length >= 3 ? `${escapeRx(bare)}|\\b${initials}\\b` : escapeRx(bare),
    source: 'statute-db',
    ...(h.sourceUrl ? { url: h.sourceUrl } : {}),
  };
}

/** The search query for a matter: the doc label plus the facts that describe it. */
function queryFor(docLabel: string, facts: Record<string, string>): string {
  const descriptive = Object.entries(facts)
    .filter(([k, v]) => /offence|ground|relief|nature|cause|claim|allegation|dispute|defect|subject|act|section/i.test(k) && v.length < 300)
    .map(([, v]) => v);
  return [docLabel, ...descriptive].join(' ').slice(0, 500);
}

const RETRIEVE_TIMEOUT_MS = 4000;

/**
 * The authority set for one compose pass: the family's curated anchors plus up to
 * `k` statute sections from the corpus. Retrieval failure or a slow corpus is
 * never fatal — the curated anchors alone are returned.
 */
export async function gatherAuthorities(args: {
  docType: string;
  docLabel: string;
  facts: Record<string, string>;
  /** The advocate's own narrative — subject keywords (patta, …) live here too. */
  account?: string;
  k?: number;
}): Promise<Authority[]> {
  const family = COMPOSE_FAMILY[args.docType] ?? 'generic';
  const out = [...(BY_DOC[args.docType] ?? CURATED[family])];
  const text = `${Object.values(args.facts).join(' ')} ${args.account ?? ''}`;
  for (const s of BY_SUBJECT) if (s.when.test(text)) out.push(...s.add);
  if (!lawsSearchService.configured()) return out;
  try {
    const hits = await Promise.race([
      lawsSearchService.search(queryFor(args.docLabel, args.facts), { k: args.k ?? 6 }),
      new Promise<LawHit[]>((_, reject) => setTimeout(() => reject(new Error('authority retrieval timed out')), RETRIEVE_TIMEOUT_MS)),
    ]);
    const seen = new Set(out.map((a) => a.cite.toLowerCase()));
    for (const h of hits) {
      const a = fromHit(h);
      if (a && !seen.has(a.cite.toLowerCase())) {
        seen.add(a.cite.toLowerCase());
        out.push(a);
      }
    }
  } catch (err) {
    logger.warn({ err, docType: args.docType }, 'compose-authorities: retrieval failed, curated anchors only');
  }
  return out;
}

/** A retrieved judgment (judgments.service.forGrounds), as compose receives it. */
export interface JudgmentRef {
  cite: string;
  court: string;
  decisionDate: string | null;
  paraNo: number;
  excerpt: string;
  url: string | null;
}

/** A retrieved judgment as an authority: its quoted paragraph is what it may be cited for. */
export function judgmentAuthority(j: JudgmentRef): Authority {
  return {
    cite: j.cite,
    heading: `JUDGMENT — ${j.court}${j.decisionDate ? `, decided ${j.decisionDate}` : ''}${j.paraNo ? `, para ${j.paraNo}` : ''}`,
    text: j.excerpt,
    // Never matches: a judgment is cited by its case name/citation, not an Act.
    actPattern: '(?!)',
    source: 'judgment',
    ...(j.url ? { url: j.url } : {}),
  };
}

/** "Vijay Singh v. The State of Bihar" — a case name in running text. */
const CASE_NAME = /\b([A-Z][\w.&'@-]*(?:\s+[A-Z@&][\w.&'-]*){0,6})\s+(?:v\.|vs\.?|versus)\s+((?:The\s+)?[A-Z][\w.&'-]*(?:\s+(?:of\s+)?[A-Z][\w.&'-]*){0,6})/g;

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** A case named WITHOUT "v." — "as held in Pranay Sethi", "laid down in Alka
 *  Subhash Gadia", "Rajnesh (supra)" (QA found these slipping past). */
const CASE_REF_VERB = /\b(?:laid down|held|observed|ruled|decided|declared|explained|reiterated|followed|settled|propounded|enunciated)\s+(?:by\s+[^.;]{0,40}?\s+)?in\s+(?:the\s+(?:case|decision|judgment)\s+of\s+)?((?:[A-Z][\w.'@&-]*)(?:\s+(?:[A-Z][\w.'@&-]*|and|of|@)){1,6})/g;
const CASE_REF_PHRASE = /\b(?:the\s+(?:case|decision|judgment|ruling)\s+(?:of|in))\s+((?:[A-Z][\w.'@&-]*)(?:\s+(?:[A-Z][\w.'@&-]*|and|of|@)){1,6})/g;
const CASE_REF_SUPRA = /((?:[A-Z][\w.'@&-]*)(?:\s+(?:[A-Z][\w.'@&-]*|and|of|@)){0,6})\s*\(\s*supra\s*\)/g;
/** Capitalised phrases after "held in" that are not case names. */
const NOT_A_CASE = /^(?:Section|Sections|Article|Articles|Order|Rule|Rules|Chapter|Schedule|Clause|Para|Paragraph|Form|Annexure|Exhibit|Crime|FIR|C\.C|O\.S|W\.P|S\.C|Crl|The Constitution|This|That|These|Those|Hon'ble|India|Tamil Nadu|Chennai|Madras)\b/;

function namedCases(sentence: string): string[] {
  const out: string[] = [];
  for (const rx of [CASE_REF_VERB, CASE_REF_PHRASE, CASE_REF_SUPRA]) {
    for (const m of sentence.matchAll(rx)) {
      const name = m[1]!.trim();
      if (!NOT_A_CASE.test(name)) out.push(name);
    }
  }
  return out;
}

/**
 * Sentences citing a case that is not a supplied judgment — by citation (SCC, AIR,
 * INSC, MLJ …) or by "X v. Y" name. Allowed: the retrieved judgments' cites, and
 * anything the skeleton/facts already carry. -> the sentences to strip.
 */
export function unauthorisedCases(paragraphs: string[], authorities: Authority[], allowedSources: string[]): string[] {
  const judgments = authorities.filter((a) => a.source === 'judgment');
  const allowedText = allowedSources.join('\n');
  const keys = new Set([
    ...judgments.flatMap((j) => judgmentCitationsIn(j.cite)),
    ...judgmentCitationsIn(allowedText),
  ].map(citationKey));
  const titles = judgments.map((j) => nameKey(j.cite));
  const allowedNames = nameKey(allowedText);
  const bad: string[] = [];
  for (const para of paragraphs) {
    for (const s of sentencesOf(para)) {
      const citeOk = judgmentCitationsIn(s).every((c) => keys.has(citationKey(c)));
      const namesOk = [...s.matchAll(CASE_NAME)].every((m) => {
        const first = nameKey(m[1]!).split(' ').filter((w) => w.length >= 4);
        const second = nameKey(m[2]!).split(' ').filter((w) => w.length >= 4 && w !== 'state');
        const inTitle = (t: string) => [...first, ...second].length > 0 && [...first, ...second].every((w) => t.includes(w));
        return titles.some(inTitle) || inTitle(allowedNames);
      });
      const refsOk = namedCases(s).every((name) => {
        const words = nameKey(name).split(' ').filter((w) => w.length >= 4);
        const inTitle = (t: string) => words.length > 0 && words.every((w) => t.includes(w));
        return titles.some(inTitle) || inTitle(allowedNames);
      });
      if (!citeOk || !namesOk || !refsOk) bad.push(s.trim());
    }
  }
  return bad;
}

/**
 * The general-AI fallback cites from memory (no corpus to check against). Make that
 * safe to file: a case named WITHOUT a reporter citation ("Whitney Pex Mills v. CIT")
 * is unverifiable — its sentence becomes "[authority to be cited]"; a case WITH a
 * citation stays but is marked "[verify citation]" for the advocate.
 */
export function guardRecalledCases(paragraphs: string[]): { paragraphs: string[]; flagged: number; removed: string[] } {
  let flagged = 0;
  const removed: string[] = [];
  const out = paragraphs.map((para) => sentencesOf(para).map((s) => {
    const cites = judgmentCitationsIn(s);
    const named = [...s.matchAll(CASE_NAME)].length > 0 || namedCases(s).length > 0;
    if (cites.length) {
      flagged += 1;
      return s.replace(/([.;]?)(\s*)$/, ' [verify citation]$1$2');
    }
    if (named) {
      removed.push(s.trim());
      return `${s.match(/^\s*/)?.[0] ?? ''}[authority to be cited]${/\s$/.test(s) ? ' ' : ''}`;
    }
    return s;
  }).join(''));
  return { paragraphs: out, flagged, removed };
}

/** The authorities as the prompt lists them. */
export function authoritiesBlock(authorities: Authority[]): string {
  if (!authorities.length) return '(none — cite only what the skeleton cites)';
  return authorities
    .map((a) => `- ${a.cite}${a.heading ? ` — ${a.heading}` : ''}${a.text ? `\n  Text: ${a.text}` : ''}`)
    .join('\n');
}

/** The authorities a composed body actually cites — listed for the advocate to
 *  check before filing. Same matching rule as the guard: provision + its Act named
 *  in the sentence (an article needs no Act). Skeleton citations aren't listed. */
export function citedAuthorities(paragraphs: string[], authorities: Authority[], skeleton: string): Authority[] {
  const inSkeleton = new Set(particularsOf(skeleton).map((p) => `${p.kind}:${p.key}`));
  const sentences = paragraphs.flatMap((p) => p.split(/(?<=[.;])\s+/));
  const body = nameKey(paragraphs.join(' '));
  const bodyCites = new Set(judgmentCitationsIn(paragraphs.join('\n')).map(citationKey));
  return authorities.filter((a) => {
    if (a.source === 'judgment') {
      // Cited by its citation, or by its case name (first party's words).
      const byCite = judgmentCitationsIn(a.cite).some((c) => bodyCites.has(citationKey(c)));
      const party = nameKey(a.cite.split(/\s+v(?:s)?\.?\s+/i)[0] ?? '').split(' ').filter((w) => w.length >= 4).slice(0, 3);
      return byCite || (party.length > 0 && body.includes(party.join(' ')));
    }
    const keys = particularsOf(a.cite)
      .filter((p) => p.kind === 'section' || p.kind === 'article' || p.kind === 'order')
      .map((p) => `${p.kind}:${p.key}`)
      .filter((k) => !inSkeleton.has(k));
    if (!keys.length) return false;
    const act = new RegExp(a.actPattern, 'i');
    return sentences.some((s) => {
      const here = new Set(particularsOf(s).map((p) => `${p.kind}:${p.key}`));
      return keys.some((k) => here.has(k) && (k.startsWith('article:') || k.startsWith('order:') || act.test(s)));
    });
  });
}

/** Exposed for tests. */
export const curatedAuthorities = (family: ComposeFamily): Authority[] => CURATED[family];
