import { db } from '../db/client';
import type { LawHit } from './laws-search.service';
import { lookupByOldSection } from './sanhita.service';

// =============================================================================
// Local BNS full-text search — the no-external-API fallback for the "Search
// statutes" tab when LAWS_DATABASE_URL (the external indiacode-rag corpus)
// isn't configured. Searches the 358 real Bharatiya Nyaya Sanhita, 2023
// sections seeded by scripts/ingest-bns-local.ts from the official gazette
// text (see 0078_bns_sections_corpus.sql). No embedding service, no vector
// DB — Postgres full-text search (tsvector/GIN) over real statute text.
//
// Coverage is narrow and SINGLE-ACT (BNS only — the criminal code; no BNSS,
// no civil/procedural acts, no case law) compared to the external corpus
// laws-search.service.ts was built for. That's an honest, bounded scope, not
// a placeholder — every result is real gazette wording, just for one act.
//
// VERIFICATION STATUS — every row in the source file ships `verified: false`
// (parsed from the PDF by regex, not yet checked by counsel against the
// primary source). This service does NOT upgrade that status; it surfaces it
// unchanged on every hit via `LawHit.verified` so the caller (the UI) can
// render it honestly as "needs review" rather than a confirmed citation —
// mirrors the rule in ingest-bns-bnss.ts / offence-kb.json.
// =============================================================================

interface BnsRow {
  id: string;
  act: string;
  act_title: string;
  section_number: string;
  heading: string | null;
  body_text: string;
  old_act: string | null;
  old_section: string | null;
  verified: boolean;
  rank: number;
}

function fromRow(r: BnsRow): LawHit {
  return {
    id: r.id,
    content: r.body_text,
    sectionId: r.id,
    actId: null,
    citation: `${r.act} ${r.section_number}`,
    sectionNumber: r.section_number,
    sectionHeading: r.heading,
    actTitle: r.act_title,
    pdfStoragePath: null,
    sourceUrl: 'https://www.indiacode.nic.in/handle/123456789/20062',
    score: r.rank,
    jurisdiction: 'Central',
    state: null,
    verified: r.verified,
    oldSection: r.old_section && r.old_act ? `${r.old_act} ${r.old_section}` : null,
  };
}

/** "BNS 103" / "bns103" / "103" / "section 103" — pull a bare section number
 *  out so a direct lookup can skip full-text ranking entirely. Returns null
 *  when the query doesn't look like a section reference. */
function extractSectionNumber(query: string): string | null {
  const m = query.trim().match(/(?:^|\bbns\s*|\bsection\s*)(\d+[A-Za-z]?)\s*$/i);
  return m ? m[1]! : null;
}

/** "IPC 420" / "ipc 420" / "420 IPC" — pull an old-code section reference so
 *  it can be resolved through the real crosswalk (sanhita-map.json) rather
 *  than the BNS JSON's own oldSection field, which is empty for every row
 *  in the current source file (the fetch script never populated it). */
function extractOldSection(query: string): { act: 'IPC' | 'CrPC' | 'IEA'; section: string } | null {
  const m = query.trim().match(/\b(ipc|crpc|cr\.?p\.?c\.?|iea)\s*(\d+[A-Za-z]?)\b|\b(\d+[A-Za-z]?)\s*(ipc|crpc|cr\.?p\.?c\.?|iea)\b/i);
  if (!m) return null;
  const rawAct = (m[1] ?? m[4] ?? '').toUpperCase();
  const section = m[2] ?? m[3];
  if (!section) return null;
  const act = rawAct.startsWith('IPC') ? 'IPC' : rawAct.startsWith('IEA') ? 'IEA' : 'CrPC';
  return { act, section };
}

export const bnsSearchService = {
  /** True once at least one row has been ingested. Cheap enough to call per
   *  request — this is a local table, not a network round trip. */
  async configured(): Promise<boolean> {
    const sql = db();
    if (!sql) return false;
    const rows = await sql<{ exists: boolean }[]>`
      select exists(select 1 from bns_sections limit 1) as exists
    `;
    return rows[0]?.exists ?? false;
  },

  async search(query: string, k = 20): Promise<LawHit[]> {
    const sql = db();
    if (!sql) return [];
    const trimmed = query.trim();
    if (!trimmed) return [];

    // "IPC 420"-style: resolve through the real crosswalk (sanhita-map.json)
    // before anything else — this is the authoritative renumbering table,
    // not the BNS JSON's own oldSection field (empty for every row today).
    const oldRef = extractOldSection(trimmed);
    if (oldRef) {
      const mapping = lookupByOldSection(oldRef);
      if (mapping && mapping.toAct === 'BNS') {
        // toSection can carry a sub-clause ("318(4)") the base-section table
        // doesn't key on; strip it for the row lookup but keep it in the hit
        // via sectionHeading so the advocate sees the precise cite.
        const baseSection = mapping.toSection.replace(/\(.*$/, '');
        const hits = await this.lookup(baseSection, k);
        return hits.map((h) => ({
          ...h,
          citation: `BNS ${mapping.toSection}`,
          oldSection: `${oldRef.act} ${oldRef.section}`,
        }));
      }
      // A recognised old-code reference with no mapping in our curated
      // table: stay silent rather than guess (same policy as scanText()) —
      // fall through to full-text on the raw query instead of a wrong hit.
    }

    // A bare/near-bare section number: exact lookup, no ranking ambiguity.
    const sectionNumber = extractSectionNumber(trimmed);
    if (sectionNumber) {
      const exact = await this.lookup(sectionNumber, k);
      if (exact.length > 0) return exact;
      // Fall through to full-text if nothing matched exactly (e.g. "103A"
      // typo'd, or the number doesn't exist — let FTS try the whole string).
    }

    const rows = await sql<BnsRow[]>`
      select id, act, act_title, section_number, heading, body_text,
             old_act, old_section, verified,
             ts_rank(search_vector, websearch_to_tsquery('english', ${trimmed})) as rank
      from bns_sections
      where search_vector @@ websearch_to_tsquery('english', ${trimmed})
      order by rank desc
      limit ${Math.min(50, Math.max(1, k))}
    `;
    return rows.map(fromRow);
  },

  /** Direct section-number lookup — "BNS 103" / "103". */
  async lookup(sectionNumber: string, k = 5): Promise<LawHit[]> {
    const sql = db();
    if (!sql) return [];
    const rows = await sql<BnsRow[]>`
      select id, act, act_title, section_number, heading, body_text,
             old_act, old_section, verified, 1.0 as rank
      from bns_sections
      where section_number = ${sectionNumber}
         or old_section = ${sectionNumber}
      limit ${Math.min(20, Math.max(1, k))}
    `;
    return rows.map(fromRow);
  },
};
