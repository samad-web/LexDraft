/**
 * Conflict-of-interest types — Practice-tier feature.
 *
 * Bar Council rules require advocates to refuse a matter where they (or the
 * firm) have a relationship with the opposing side. The check runs across
 * the firm's existing clients + cases when a new matter is opened.
 *
 * `severity` ladder:
 *   - red   → blocking; user must explicitly confirm before proceeding
 *             (existing_client OR same advocate on the other side)
 *   - amber → soft warning; party name appeared in an older matter
 *   - green → no hits, safe to proceed
 *
 * Hits are kept simple — just the matched fragment + classification + the
 * row it came from — so the UI can render a humane "we found X in Y"
 * narrative without re-querying.
 */

export type ConflictSeverity = 'red' | 'amber' | 'green';

export type ConflictClassification =
  | 'existing_client'        // matches a current client (red)
  | 'past_matter_party'      // matches a party in a past matter title (amber)
  | 'same_advocate_other_side'; // firm previously acted FOR this name, now they're opposing (red)

/**
 * Which side of the new matter the search term came from. The classification
 * logic differs subtly: a hit on a *party* name against `cases.client` means
 * "we have represented this person" (informational); a hit on an *opposing*
 * name against `cases.client` means the firm has acted for the now-opposing
 * party — a textbook conflict.
 */
export type ConflictSide = 'party' | 'opposing';

export type MatchedAgainst = 'cases.client' | 'cases.title' | 'clients.name';

export interface ConflictHit {
  severity: ConflictSeverity;
  classification: ConflictClassification;
  /** The user-supplied name that triggered the hit. */
  matchedName: string;
  /** Which column produced the match. */
  matchedAgainst: MatchedAgainst;
  /** Which side of the new matter contributed the term. */
  side: ConflictSide;
  matterId?: string;
  matterTitle?: string;
  clientId?: string;
  clientName?: string;
}

export interface ConflictsCheckInput {
  firmId: string;
  partyNames: string[];
  opposingNames: string[];
  /** When editing an existing matter, exclude it from the scan to avoid self-flagging. */
  excludeMatterId?: string;
}

export interface ConflictsResult {
  severity: ConflictSeverity;
  hits: ConflictHit[];
}
