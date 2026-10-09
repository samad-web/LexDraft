import type { Case, Client } from '@lexdraft/types';

// =============================================================================
// client-case-link
//
// Cases relate to clients by the freeform `cases.client` STRING, not a foreign
// key (see the Case type - there is no client_id). Matching them therefore
// needs one canonical normalisation so the Clients list, the client detail
// page, and anywhere else that joins the two tables all agree on what counts
// as "the same client". Centralising it here keeps that logic from drifting
// per-view (which is how the two surfaces disagreed before).
//
// Normalisation is deliberately forgiving because the two strings were entered
// by different forms over time: case-insensitive, whitespace-collapsed, and
// trimmed of a few honorifics/suffixes advocates commonly add on one side but
// not the other.
// =============================================================================

const STRIP_TOKENS = new Set([
  'm/s', 'ms', 'mr', 'mrs', 'dr', 'shri', 'smt', 'sri',
]);

/** Canonical key for a client-or-case name string. */
export function normalizeClientName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[.,]/g, ' ')          // punctuation → space so "M/s." == "M/s"
    .split(/\s+/)
    .filter(Boolean)
    .filter((tok) => !STRIP_TOKENS.has(tok))
    .join(' ')
    .trim();
}

/** True when a case belongs to the given client, by normalised name. */
export function caseBelongsToClient(c: Case, client: Pick<Client, 'name'>): boolean {
  const key = normalizeClientName(client.name);
  if (!key) return false;
  return normalizeClientName(c.client) === key;
}

/** All cases that match a client, most-recent-hearing first. */
export function casesForClient(
  cases: ReadonlyArray<Case>,
  client: Pick<Client, 'name'>,
): Case[] {
  return cases
    .filter((c) => caseBelongsToClient(c, client))
    .slice()
    .sort((a, b) => (a.next < b.next ? 1 : a.next > b.next ? -1 : 0));
}
