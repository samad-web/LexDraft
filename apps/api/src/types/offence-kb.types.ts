/**
 * Offence Knowledge Base — the drafting/RAG layer.
 *
 * PURPOSE
 * -------
 * `sanhita-map.json` answers "what is the new section number for old section X?"
 * (a renumbering lookup). It intentionally does NOT carry the classification an
 * advocate needs to actually DRAFT a document (bailable? cognizable? which court?
 * what are the ingredients to plead?).
 *
 * This KB fills that gap. Each entry is keyed on a BNS/BNSS/BSA section and is
 * meant to be retrieved by the drafting engine (via alias/keyword or vector
 * search) so the AI can:
 *   1. resolve an advocate's plain words ("cheating", "dhoka") to a real section,
 *   2. state bailable/cognizable/court correctly for a bail application,
 *   3. check the pleaded facts against the offence's essential ingredients.
 *
 * RELATIONSHIP TO sanhita-map.json
 * --------------------------------
 * We do NOT duplicate the old→new renumbering here. `oldRef` holds only the
 * pointer (e.g. IPC 420); the authoritative mapping row lives in sanhita-map.json
 * and is joined at load time on (act, section). A validator (see
 * scripts/validate-offence-kb.ts) asserts every `oldRef` exists in the map so the
 * two files can never silently drift.
 *
 * VERIFICATION DISCIPLINE (read this before shipping)
 * ---------------------------------------------------
 * Same rule as sanhita.types.ts: every legal value below is plausibility-grade
 * until a human verifies it against the bare Act. The `verification` field on each
 * entry is the gate — the drafting engine MUST treat anything not `"verified"` as
 * "suggest to advocate, do not assert in the document". Nothing with
 * verification !== "verified" may be printed as a hard citation.
 */

export type OffenceLaw = 'BNS' | 'BNSS' | 'BSA';
export type OldAct = 'IPC' | 'CrPC' | 'IEA';

/**
 * Whether an offence is bailable. `conditional` = depends on aggravating facts
 * (e.g. value, injury grade); the engine must then ask the advocate.
 */
export type BailStatus = 'bailable' | 'non-bailable' | 'conditional';

/** Cognizable status; `conditional` behaves like BailStatus.conditional. */
export type CognizableStatus = 'cognizable' | 'non-cognizable' | 'conditional';

/**
 * Verification gate. Only `verified` may be asserted as a hard citation in a
 * generated document; everything else is a suggestion the advocate must confirm.
 */
export type VerificationStatus =
  | 'verified' // checked against the bare Act by counsel; safe to cite
  | 'needs-review' // structured & plausible, NOT yet counsel-checked (default)
  | 'disputed'; // counsel flagged a problem; never auto-cite

export interface OldRef {
  act: OldAct;
  /** e.g. "420". Must exist as a fromSection in sanhita-map.json. */
  section: string;
}

export interface OffenceEntry {
  /** Stable slug, e.g. "bns-318-cheating". Used as the RAG document id. */
  id: string;

  /** Canonical offence name as an advocate would say it, e.g. "Cheating". */
  offenceName: string;

  law: OffenceLaw;
  /** BNS section as written in the Act, e.g. "318(4)" or "115(2)". */
  section: string;
  /** Section heading, quoted from the Act. */
  sectionTitle: string;

  /** Pointer to the corresponding old-law section (joined via sanhita-map.json). */
  oldRef: OldRef | null;

  /**
   * Everything an advocate/STT might call this offence, incl. Hindi/vernacular
   * and common misspellings, so retrieval catches plain-language input.
   * e.g. ["cheat", "fraud", "dhoka", "thagi", "cheating and fraud"].
   */
  aliases: string[];

  bailable: BailStatus;
  cognizable: CognizableStatus;
  /** Compoundable status is often decisive for advice; keep it explicit. */
  compoundable: boolean | 'conditional';

  /** Court that tries it, e.g. "Magistrate of the First Class", "Court of Session". */
  triableBy: string;

  /** Human-readable punishment, quoted/paraphrased from the Act. */
  punishment: string;

  /**
   * The facts that MUST be present for the offence to lie. This is what lets the
   * AI reason like counsel: if a pleaded fact-set is missing an ingredient, the
   * engine flags "this may be the wrong section" instead of drafting blindly.
   */
  essentialIngredients: string[];

  /**
   * Sections an advocate frequently confuses this with, so the engine can offer
   * the alternative (e.g. cheating vs criminal breach of trust). Ids from this KB.
   */
  commonlyConfusedWith: string[];

  verification: VerificationStatus;

  /** Audit trail for the verification decision (set by the counsel-verify CLI).
   *  Present only once someone has moved the entry off the default. */
  verifiedBy?: string;
  /** ISO date the verification status was last set. */
  verifiedAt?: string;

  /** Free-text: renumbering caveats, split/merged provisions, review notes. */
  notes: string;
}

export interface OffenceKb {
  /** ISO date the file was last edited (kept literal; no runtime clock in build). */
  updatedAt: string;
  /** Which Acts this file currently covers, for quick capability checks. */
  laws: OffenceLaw[];
  entries: OffenceEntry[];
}
