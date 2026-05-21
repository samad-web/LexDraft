/**
 * Conflict-of-interest scan.
 *
 * When a new matter is opened, the firm must confirm it has no relationship
 * to the opposing side - both Bar Council ethics and DPDP-era client-trust
 * hygiene demand this. Manual review is fine for ~50 matters; past that it
 * stops happening reliably, which is exactly when conflicts cost real money.
 *
 * Scope:
 *   - read-only: pulls from `clients` and `cases` (no schema change)
 *   - tenant-scoped: every query carries firmId; no cross-firm leakage
 *   - case-insensitive substring match (LIKE with lower()) for now
 *
 * Pragmatic caveats (recorded as TODOs for the next iteration):
 *   1. `pg_trgm` would give us fuzzy + similarity scoring. Adding the
 *      extension is a migration-level change; out of scope here.
 *   2. The `cases` table doesn't yet carry a structured `opposing_party`
 *      column - we mine `cases.title` ("X v. Y") which is heuristic but
 *      covers the dominant Indian filing convention.
 *   3. No counsel-on-record table either, so `same_advocate_other_side`
 *      is currently surfaced when an opposing-side term hits `cases.client`
 *      (i.e. the firm previously represented the now-opposing party).
 */

import { db } from '../db/client';
import type {
  ConflictHit,
  ConflictsCheckInput,
  ConflictsResult,
  ConflictSeverity,
  MatchedAgainst,
} from '../types/conflicts.types';

interface CaseHitRow {
  id: string;
  title: string;
  client: string;
}

interface ClientHitRow {
  id: string;
  name: string;
}

/** Inputs trimmed + lowercased; empties dropped. Order-preserving + de-duped. */
function normaliseTerms(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== 'string') continue;
    const t = r.toLowerCase().trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Red dominates amber dominates green. */
function maxSeverity(a: ConflictSeverity, b: ConflictSeverity): ConflictSeverity {
  if (a === 'red' || b === 'red') return 'red';
  if (a === 'amber' || b === 'amber') return 'amber';
  return 'green';
}

/**
 * Bag of cases (id, title, client) and clients (id, name) for the firm - we
 * fetch once and run match logic in JS. For a ~thousand-row firm this is
 * cheaper than N round-trips per term, and it lets us keep the LIKE plain
 * (no pg_trgm) without slowing the API down materially.
 *
 * If perf becomes an issue: add a trigram GIN index on `cases.title`,
 * `cases.client`, `clients.name` and switch to SQL-side filtering.
 */
async function loadFirmCorpus(firmId: string, excludeMatterId?: string): Promise<{
  cases: CaseHitRow[];
  clients: ClientHitRow[];
}> {
  const sql = db();
  if (!sql) return { cases: [], clients: [] };

  const cases = await sql<CaseHitRow[]>`
    select id::text as id, title, client
    from cases
    where firm_id = ${firmId}::uuid
      and kind = 'matter'
      and (${excludeMatterId ?? null}::text is null
           or id::text <> ${excludeMatterId ?? null}::text)
  `;
  const clients = await sql<ClientHitRow[]>`
    select id::text as id, name
    from clients
    where firm_id = ${firmId}::uuid
  `;
  return { cases, clients };
}

/** Push a hit only if (matterId|clientId, classification, side, matchedName) is new. */
function pushUnique(hits: ConflictHit[], hit: ConflictHit): void {
  const key = `${hit.classification}|${hit.side}|${hit.matchedName}|${hit.matterId ?? ''}|${hit.clientId ?? ''}|${hit.matchedAgainst}`;
  if (hits.some((h) => keyOf(h) === key)) return;
  hits.push(hit);
}
function keyOf(h: ConflictHit): string {
  return `${h.classification}|${h.side}|${h.matchedName}|${h.matterId ?? ''}|${h.clientId ?? ''}|${h.matchedAgainst}`;
}

function buildHit(args: {
  classification: ConflictHit['classification'];
  severity: ConflictSeverity;
  matchedName: string;
  matchedAgainst: MatchedAgainst;
  side: ConflictHit['side'];
  matterId?: string;
  matterTitle?: string;
  clientId?: string;
  clientName?: string;
}): ConflictHit {
  return {
    severity: args.severity,
    classification: args.classification,
    matchedName: args.matchedName,
    matchedAgainst: args.matchedAgainst,
    side: args.side,
    ...(args.matterId ? { matterId: args.matterId } : {}),
    ...(args.matterTitle ? { matterTitle: args.matterTitle } : {}),
    ...(args.clientId ? { clientId: args.clientId } : {}),
    ...(args.clientName ? { clientName: args.clientName } : {}),
  };
}

export const conflictsService = {
  /**
   * Run the conflict scan. Returns `{ severity: 'green', hits: [] }` when:
   *   - no firmId, or
   *   - no usable input terms, or
   *   - no matches.
   *
   * Empty input is treated as green (not an error) so the UI can call this
   * on every keystroke without dealing with 400s during partial typing.
   */
  async check(input: ConflictsCheckInput): Promise<ConflictsResult> {
    const { firmId, excludeMatterId } = input;
    if (!firmId) return { severity: 'green', hits: [] };

    const partyTerms = normaliseTerms(input.partyNames ?? []);
    const opposingTerms = normaliseTerms(input.opposingNames ?? []);
    if (partyTerms.length === 0 && opposingTerms.length === 0) {
      return { severity: 'green', hits: [] };
    }

    const { cases, clients } = await loadFirmCorpus(firmId, excludeMatterId);
    const hits: ConflictHit[] = [];
    let severity: ConflictSeverity = 'green';

    // -- Opposing-side scan -------------------------------------------------
    // A match on the OPPOSING side is the hot path for the ethics check:
    //   - opposing name == an existing client  → red (existing_client)
    //   - opposing name appears in a past case.client → red
    //     (same_advocate_other_side - we acted FOR them before)
    //   - opposing name appears in a past case.title → amber (mentioned before)
    for (const term of opposingTerms) {
      for (const c of clients) {
        if (c.name.toLowerCase().includes(term)) {
          const h = buildHit({
            classification: 'existing_client',
            severity: 'red',
            matchedName: term,
            matchedAgainst: 'clients.name',
            side: 'opposing',
            clientId: c.id,
            clientName: c.name,
          });
          pushUnique(hits, h);
          severity = maxSeverity(severity, 'red');
        }
      }
      for (const k of cases) {
        if (k.client.toLowerCase().includes(term)) {
          const h = buildHit({
            classification: 'same_advocate_other_side',
            severity: 'red',
            matchedName: term,
            matchedAgainst: 'cases.client',
            side: 'opposing',
            matterId: k.id,
            matterTitle: k.title,
          });
          pushUnique(hits, h);
          severity = maxSeverity(severity, 'red');
        }
        if (k.title.toLowerCase().includes(term)) {
          const h = buildHit({
            classification: 'past_matter_party',
            severity: 'amber',
            matchedName: term,
            matchedAgainst: 'cases.title',
            side: 'opposing',
            matterId: k.id,
            matterTitle: k.title,
          });
          pushUnique(hits, h);
          severity = maxSeverity(severity, 'amber');
        }
      }
    }

    // -- Party-side scan ----------------------------------------------------
    // A party-side hit is informational: "we've represented this person
    // before" is usually fine and often expected. We still surface it as
    // amber so the lawyer can sanity-check, and treat an exact match on
    // an existing client as 'existing_client' (red) only if it isn't the
    // same matter (excludeMatterId already filtered).
    for (const term of partyTerms) {
      for (const c of clients) {
        if (c.name.toLowerCase().includes(term)) {
          // The party IS an existing client - that's the normal happy
          // path (returning client). Surface amber so the user sees the
          // link, but don't block.
          const h = buildHit({
            classification: 'past_matter_party',
            severity: 'amber',
            matchedName: term,
            matchedAgainst: 'clients.name',
            side: 'party',
            clientId: c.id,
            clientName: c.name,
          });
          pushUnique(hits, h);
          severity = maxSeverity(severity, 'amber');
        }
      }
      for (const k of cases) {
        if (k.title.toLowerCase().includes(term) || k.client.toLowerCase().includes(term)) {
          const h = buildHit({
            classification: 'past_matter_party',
            severity: 'amber',
            matchedName: term,
            matchedAgainst: k.client.toLowerCase().includes(term) ? 'cases.client' : 'cases.title',
            side: 'party',
            matterId: k.id,
            matterTitle: k.title,
          });
          pushUnique(hits, h);
          severity = maxSeverity(severity, 'amber');
        }
      }
    }

    return { severity, hits };
  },
};
