import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * Practice-tier conflict-of-interest check.
 *
 * Wraps `POST /api/conflicts/check`. Used by NewCaseModal to debounce-scan
 * client + party fields as the user types. We keep this as a mutation (not
 * a query) so each fresh scan is a deliberate trigger — the UI controls
 * timing/debounce, react-query doesn't auto-refire on focus.
 */

export type ConflictSeverity = 'red' | 'amber' | 'green';

export type ConflictClassification =
  | 'existing_client'
  | 'past_matter_party'
  | 'same_advocate_other_side';

export type ConflictSide = 'party' | 'opposing';

export interface ConflictHit {
  severity: ConflictSeverity;
  classification: ConflictClassification;
  matchedName: string;
  matchedAgainst: 'cases.client' | 'cases.title' | 'clients.name';
  side: ConflictSide;
  matterId?: string;
  matterTitle?: string;
  clientId?: string;
  clientName?: string;
}

export interface ConflictsResult {
  severity: ConflictSeverity;
  hits: ConflictHit[];
}

export interface CheckArgs {
  partyNames: string[];
  opposingNames: string[];
  excludeMatterId?: string;
}

export function useConflictsCheck() {
  return useMutation<ConflictsResult, unknown, CheckArgs>({
    mutationFn: (args) => api.post<ConflictsResult>('/conflicts/check', args),
  });
}
