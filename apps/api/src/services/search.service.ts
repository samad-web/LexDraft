import type { SearchResults } from '@lexdraft/types';
import { db } from '../db/client';
import { firmIdForUser } from './tenant';
import { resolveFeatures } from './permissions.service';

// =============================================================================
// search.service - the Ctrl+K quick search. Read-only, firm-scoped, and each
// section only runs when the caller holds the feature needed to open it.
// Matches are case-insensitive substrings; a CNR / title prefix ranks first.
// Client email is encrypted at rest (0084) so clients match by name only.
// =============================================================================

const PER_KIND = 6;

/** Escape LIKE wildcards so "50%" or "a_b" are matched literally. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export const __testing = { likePattern };

function empty(q: string): SearchResults {
  return { q, cases: [], clients: [], leads: [], drafts: [], documents: [] };
}

export const searchService = {
  async search(userId: string | undefined, rawQ: string): Promise<SearchResults> {
    const q = rawQ.trim().slice(0, 100);
    if (q.length < 2 || !userId) return empty(q);
    const firmId = await firmIdForUser(userId);
    const sql = db();
    if (!firmId || !sql) return empty(q);

    const { features } = await resolveFeatures(userId);
    const can = (f: string) => features.includes(f);
    const like = likePattern(q);
    const prefix = `${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

    const [cases, clients, leads, drafts, documents] = await Promise.all([
      can('matter.view')
        ? sql<Array<{ id: string; title: string; cnr: string; court: string; client: string; party: string | null }>>`
            select c.id, c.title, c.cnr, c.court, c.client,
                   (select p.party_name from case_parties p
                     where p.case_id = c.id and p.party_name ilike ${like}
                     limit 1) as party
            from cases c
            where c.firm_id = ${firmId}::uuid and c.deleted_at is null
              and (c.title ilike ${like} or c.cnr ilike ${like} or c.client ilike ${like}
                   or exists (select 1 from case_parties p
                               where p.case_id = c.id and p.party_name ilike ${like}))
            order by (c.cnr ilike ${prefix} or c.title ilike ${prefix}) desc,
                     (c.status = 'Active') desc, c.updated_at desc
            limit ${PER_KIND}`
        : Promise.resolve([]),
      can('client.view')
        ? sql<Array<{ id: string; name: string; type: string }>>`
            select id, name, type::text as type from clients
            where firm_id = ${firmId}::uuid and name ilike ${like}
            order by (name ilike ${prefix}) desc, name
            limit ${PER_KIND}`
        : Promise.resolve([]),
      can('leads.view')
        ? sql<Array<{ id: string; name: string; stage: string }>>`
            select id, name, stage::text as stage from leads
            where firm_id = ${firmId}::uuid and (name ilike ${like} or referrer ilike ${like})
            order by (name ilike ${prefix}) desc, updated_at desc
            limit ${PER_KIND}`
        : Promise.resolve([]),
      // Drafts are personal: only the caller's own.
      can('drafting.ai') || can('drafting.basic')
        ? sql<Array<{ id: string; title: string; doc_type: string }>>`
            select id, title, doc_type from drafts
            where firm_id = ${firmId}::uuid and user_id = ${userId}::uuid and title ilike ${like}
            order by updated_at desc
            limit ${PER_KIND}`
        : Promise.resolve([]),
      can('shared.documents')
        ? sql<Array<{ id: string; name: string; case_id: string | null; case_label: string }>>`
            select id, name, case_id, case_label from documents
            where firm_id = ${firmId}::uuid and name ilike ${like}
            order by updated_at desc
            limit ${PER_KIND}`
        : Promise.resolve([]),
    ]);

    return {
      q,
      cases: cases.map((c) => ({
        id: c.id, title: c.title, cnr: c.cnr, court: c.court, client: c.client,
        matchedParty: c.party ?? undefined,
      })),
      clients: clients.map((c) => ({ id: c.id, name: c.name, type: c.type })),
      leads: leads.map((l) => ({ id: l.id, name: l.name, stage: l.stage })),
      drafts: drafts.map((d) => ({ id: d.id, title: d.title, docType: d.doc_type })),
      documents: documents.map((d) => ({ id: d.id, name: d.name, caseId: d.case_id, caseLabel: d.case_label })),
    };
  },
};
