import { logger } from '../logger';
import type { CaseOrder, Court } from '../lib/ecourts/types';
import { lookupByCnr, searchByPartyName } from './ecourts.service';
import { extractCnrCandidates } from './ecourts-link.service';

// =============================================================================
// ecourts-orders.service
//
// "Court orders by party name" WITHOUT the eCourts website's captcha.
//
// The website's Court Orders page is captcha-gated, but the same information
// is reachable through the eCourts mobile API DifAI already uses for the
// 09:00 / 19:00 sync (no captcha):
//   1. searchByPartyName  -> every case in the court with that party, + CNRs
//   2. lookupByCnr        -> each case's interimOrder[] / finalOrder[], whose
//                            entries download through the existing order-PDF
//                            route (POST /ecourts/orders/pdf)
//
// Step 2 is one eCourts call per case, so the number of cases opened is
// capped and paced (eCourts throttles bursts); the caller is told when the
// list was cut short so the advocate can narrow the name.
// =============================================================================

const MAX_CASES = 15;
const PACE_MS = 700;

export type OrderTypeFilter = 'both' | 'finalorder' | 'interim';

export interface OrdersByPartyInput {
  stateCode: number;
  distCode: number;
  courtCode: number;
  estCode: string;
  partyName: string;
  year: number;
  orderType: OrderTypeFilter;
  court?: Court;
}

export interface CaseWithOrders {
  cino: string;
  title: string;
  caseNo: string | null;
  establishment: string | null;
  interimOrders: CaseOrder[];
  finalOrders: CaseOrder[];
  /** Set when this one case couldn't be opened (eCourts error). */
  error?: string;
}

export interface OrdersByPartyResult {
  /** Cases found for the party name (before the per-case cap). */
  casesFound: number;
  /** Cases actually opened; < casesFound when truncated. */
  casesOpened: number;
  truncated: boolean;
  cases: CaseWithOrders[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function searchOrdersByParty(input: OrdersByPartyInput): Promise<OrdersByPartyResult> {
  const court = input.court ?? 'DC';
  // Throws EcourtsHttpError when eCourts is unreachable - the route's error
  // handler turns that into a clear "eCourts not responding" message.
  const payload = await searchByPartyName({
    stateCode: input.stateCode,
    distCode: input.distCode,
    courtCode: input.courtCode,
    estCode: input.estCode,
    partyName: input.partyName,
    year: input.year,
    court,
  });
  const candidates = extractCnrCandidates(payload);
  const toOpen = candidates.slice(0, MAX_CASES);

  const cases: CaseWithOrders[] = [];
  for (let i = 0; i < toOpen.length; i++) {
    const c = toOpen[i]!;
    if (i > 0) await sleep(PACE_MS);
    try {
      const h = await lookupByCnr(c.cino, court);
      const interim = input.orderType === 'finalorder' ? [] : h?.interimOrder ?? [];
      const final = input.orderType === 'interim' ? [] : h?.finalOrder ?? [];
      cases.push({ ...c, interimOrders: interim, finalOrders: final });
    } catch (err) {
      logger.warn({ err, cino: c.cino }, 'orders-by-party: case lookup failed');
      cases.push({ ...c, interimOrders: [], finalOrders: [], error: 'eCourts did not return this case right now.' });
    }
  }

  // Cases with orders first; keep eCourts' order otherwise.
  cases.sort((a, b) => Number(b.interimOrders.length + b.finalOrders.length > 0) - Number(a.interimOrders.length + a.finalOrders.length > 0));
  return { casesFound: candidates.length, casesOpened: toOpen.length, truncated: candidates.length > toOpen.length, cases };
}
