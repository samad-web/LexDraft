// =============================================================================
// old-to-new-law — deterministic mapping from repealed codes to the sanhitas.
//
// The drafting prompts INSTRUCT the model to cite the new codes (BNS/BNSS/BSA)
// and to "map any legacy CrPC/IPC section the brief supplies". Instruction alone
// is not a guarantee: a model can forget, and VERIFY only flags repealed-law
// references AFTER the fact. This module gives the pipeline a deterministic
// lookup so it can (a) tell the model the exact new section for a legacy one it
// sees in the brief, and (b) explain a flagged old-law reference to the advocate
// with the correct replacement rather than a bare "old law" warning.
//
// Scope: the high-frequency provisions a general criminal/civil practice meets.
// This is a drafting aid, NOT an authoritative concordance — a few provisions
// were split or merged in the recast, so callers must treat the mapping as a
// strong hint the advocate confirms, never as settled law. Where a clean 1:1
// mapping does not exist, the entry is omitted rather than guessed.
// =============================================================================

export interface LawMapping {
  /** The repealed reference as commonly written, e.g. "Section 439 CrPC". */
  old: string;
  /** The in-force equivalent, e.g. "Section 483 BNSS". */
  new: string;
  /** Which code family the new reference belongs to. */
  code: 'BNS' | 'BNSS' | 'BSA';
  /** Set when the recast split/merged the provision so the map is approximate. */
  approximate?: boolean;
}

/**
 * Keyed by a normalised legacy token (lowercased, "§"/"sec."/"section" and the
 * act name folded out) -> mapping. `lookupOldProvision` does the normalising, so
 * callers pass raw strings like "u/s 439 CrPC" or "IPC 302".
 */
const MAP: LawMapping[] = [
  // ---- Procedure: CrPC -> BNSS -------------------------------------------
  { old: 'Section 154 CrPC', new: 'Section 173 BNSS', code: 'BNSS' }, // FIR
  { old: 'Section 161 CrPC', new: 'Section 180 BNSS', code: 'BNSS' }, // police statements
  { old: 'Section 173 CrPC', new: 'Section 193 BNSS', code: 'BNSS' }, // charge-sheet
  { old: 'Section 200 CrPC', new: 'Section 223 BNSS', code: 'BNSS' }, // private complaint
  { old: 'Section 227 CrPC', new: 'Section 250 BNSS', code: 'BNSS' }, // discharge
  { old: 'Section 437 CrPC', new: 'Section 480 BNSS', code: 'BNSS' }, // bail by Magistrate
  { old: 'Section 438 CrPC', new: 'Section 482 BNSS', code: 'BNSS' }, // anticipatory bail
  { old: 'Section 439 CrPC', new: 'Section 483 BNSS', code: 'BNSS' }, // bail by Sessions/HC
  { old: 'Section 482 CrPC', new: 'Section 528 BNSS', code: 'BNSS' }, // inherent powers (HC)

  // ---- Penal: IPC -> BNS --------------------------------------------------
  { old: 'Section 302 IPC', new: 'Section 103 BNS', code: 'BNS' }, // murder
  { old: 'Section 304 IPC', new: 'Section 105 BNS', code: 'BNS' }, // culpable homicide
  { old: 'Section 304A IPC', new: 'Section 106 BNS', code: 'BNS' }, // death by negligence
  { old: 'Section 307 IPC', new: 'Section 109 BNS', code: 'BNS' }, // attempt to murder
  { old: 'Section 323 IPC', new: 'Section 115 BNS', code: 'BNS' }, // hurt
  { old: 'Section 325 IPC', new: 'Section 117 BNS', code: 'BNS' }, // grievous hurt
  { old: 'Section 354 IPC', new: 'Section 74 BNS', code: 'BNS' }, // assault on woman
  { old: 'Section 376 IPC', new: 'Section 64 BNS', code: 'BNS' }, // rape
  { old: 'Section 406 IPC', new: 'Section 316 BNS', code: 'BNS' }, // criminal breach of trust
  { old: 'Section 420 IPC', new: 'Section 318 BNS', code: 'BNS' }, // cheating
  { old: 'Section 498A IPC', new: 'Section 85 BNS', code: 'BNS' }, // cruelty by husband/relatives
  { old: 'Section 506 IPC', new: 'Section 351 BNS', code: 'BNS' }, // criminal intimidation

  // ---- Evidence: Evidence Act -> BSA -------------------------------------
  { old: 'Section 65B Evidence Act', new: 'Section 63 BSA', code: 'BSA' }, // electronic records
];

/** Normalise a legacy reference to a comparable token: lowercase, strip the
 *  "section"/"sec."/"§"/"u/s" noise and punctuation, and canonicalise the act. */
function normalise(ref: string): string {
  return ref
    .toLowerCase()
    .replace(/u\/s|under section|section|sec\.?|§/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/indian penal code/g, 'ipc')
    .replace(/code of criminal procedure/g, 'crpc')
    .replace(/cr\s*\.?\s*p\s*\.?\s*c\s*\.?/g, 'crpc')
    .replace(/indian evidence act/g, 'evidence act')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALISED = MAP.map((m) => ({ key: normalise(m.old), mapping: m }));

/**
 * Look up the in-force equivalent of a legacy provision reference. Returns null
 * when there is no clean mapping (the caller should then leave the advocate to
 * resolve it rather than guess). Matching is exact-on-normalised-token so that
 * "u/s 439 CrPC", "Section 439 Cr.P.C.", and "439 crpc" all resolve.
 */
export function lookupOldProvision(ref: string): LawMapping | null {
  const key = normalise(ref);
  const hit = NORMALISED.find((n) => n.key === key);
  return hit ? hit.mapping : null;
}

/**
 * Scan free text for legacy code references and return the mappings found, so a
 * caller can render an advisory like: "Brief cites Section 439 CrPC → cite
 * Section 483 BNSS instead." Deduplicated, order-preserving.
 */
export function findOldProvisions(text: string): LawMapping[] {
  const found: LawMapping[] = [];
  const seen = new Set<string>();
  // Match "<num><optional letter> <act>" with the usual section prefixes.
  const re = /(?:u\/s\s*|section\s*|sec\.?\s*|§\s*)?(\d{1,3}[A-Za-z]?)\s*(ipc|crpc|cr\.?p\.?c\.?|indian penal code|code of criminal procedure|evidence act|indian evidence act)/gi;
  for (const m of text.matchAll(re)) {
    const mapping = lookupOldProvision(`${m[1]} ${m[2]}`);
    if (mapping && !seen.has(mapping.old)) {
      seen.add(mapping.old);
      found.push(mapping);
    }
  }
  return found;
}
