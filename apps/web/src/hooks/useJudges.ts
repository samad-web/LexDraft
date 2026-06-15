import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { INDIAN_COURTS } from '@/lib/indian-courts';

// =============================================================================
// useJudges — sitting-judge roster for the High Courts.
//
// Backend: GET /api/judges?highCourt=... (apps/api/src/routes/judges.routes.ts).
// Powers the BENCH dropdown in the hearing modal: once a High Court is picked
// in the COURT field, this lists that court's judges as suggestions.
// =============================================================================

export interface CourtJudge {
  id: string;
  high_court: string;
  judge_name: string;
  is_chief_justice: boolean;
  judge_type: 'permanent' | 'additional';
  recruited_from: string | null;
  appointed_on: string | null;
  retires_on: string | null;
  term_expires_on: string | null;
  remarks: string | null;
  source_url: string;
  synced_at: string;
}

/** True for the canonical High Court names the roster is keyed by (e.g.
 *  "Kerala High Court"). District courts / tribunals have no roster. */
export function isHighCourt(court: string | null | undefined): boolean {
  return /\bHigh Court$/i.test((court ?? '').trim());
}

const HIGH_COURTS = INDIAN_COURTS.filter((c) => /\bHigh Court$/i.test(c));
// Seat token for each HC (the part before " High Court"), normalised so "&"
// and "and" compare equal — e.g. "punjab and haryana".
const HIGH_COURT_SEATS = HIGH_COURTS.map((c) => ({
  canonical: c,
  seat: c.replace(/\s+High Court$/i, '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' '),
}));

/**
 * Resolve a free-text forum string to a canonical High Court name, or null.
 * Handles "High Court of Karnataka", "Karnataka High Court, Court Hall 12",
 * "Punjab & Haryana HC", etc. by matching the seat token. The diary modal's
 * FORUM field is free text, so this is how its BENCH dropdown finds a roster.
 */
export function highCourtFromText(text: string | null | undefined): string | null {
  const t = (text ?? '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  for (const { canonical, seat } of HIGH_COURT_SEATS) {
    if (t.includes(seat)) return canonical;
  }
  return null;
}

/** Roster for one High Court, Chief Justice first. Only fires for a High Court
 *  value so typing a district court / tribunal doesn't hit the API. */
export function useCourtJudges(highCourt: string | null | undefined) {
  const court = (highCourt ?? '').trim();
  return useQuery({
    queryKey: ['judges', court],
    queryFn: () =>
      api.get<{ items: CourtJudge[] }>('/judges', { highCourt: court }),
    select: (r) => r.items,
    enabled: isHighCourt(court),
    // Roster is slow-moving reference data — cache for the session.
    staleTime: 24 * 60 * 60 * 1000,
  });
}
