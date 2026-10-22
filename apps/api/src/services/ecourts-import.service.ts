import { db } from '../db/client';
import { casesService } from './cases.service';
import { instantiateGraph } from './case-pipeline.service';
import { normaliseCnr, queueLink } from './ecourts-link.service';
import { logger } from '../logger';

// =============================================================================
// Import of My Cases - the eCourts app's Import / Export, brought into
// matters. The advocate uploads any file holding CNRs (the app's own
// myCases_backup.txt / hcMyCases_backup.txt, a CSV, a list); the browser
// pulls the CNRs out and sends them here. Each new CNR becomes a shell
// matter that the normal eCourts link job fills in (title, court, parties,
// hearings) - the same path as a matter typed in by hand, so it keeps
// working while eCourts is down. CNRs already in the firm's matters are
// skipped, never touched.
// =============================================================================

export const MAX_IMPORT = 200;

export type Court = 'DC' | 'HC';

export interface ImportResult {
  created: Array<{ cnr: string; id: string }>;
  existing: string[];
  invalid: string[];
}

/** Which of these CNRs the firm already has (live, non-deleted matters). */
export async function existingCnrs(firmId: string, cnrs: string[]): Promise<Set<string>> {
  const sql = db();
  if (!sql || cnrs.length === 0) return new Set();
  const rows = await sql<Array<{ cnr: string }>>`
    select upper(trim(cnr)) as cnr from cases
    where firm_id = ${firmId}::uuid and upper(trim(cnr)) = any(${cnrs}::text[])
  `;
  return new Set(rows.map((r) => r.cnr));
}

export async function importCnrs(firmId: string, raw: Array<{ cnr: string; court?: Court }>): Promise<ImportResult> {
  const result: ImportResult = { created: [], existing: [], invalid: [] };
  const wanted = new Map<string, Court | undefined>();
  for (const item of raw) {
    const cnr = normaliseCnr(item.cnr);
    if (!cnr) { result.invalid.push(item.cnr); continue; }
    if (!wanted.has(cnr)) wanted.set(cnr, item.court);
  }
  const have = await existingCnrs(firmId, [...wanted.keys()]);

  for (const [cnr, court] of wanted) {
    if (have.has(cnr)) { result.existing.push(cnr); continue; }
    let id: string;
    try {
      // Blank title/client/type are FILL-IF-BLANK for the eCourts sync, so
      // the first successful link writes the real details. "High Court" in
      // the court column steers the tier guess for HC CNRs.
      const created = await casesService.create({
        cnr,
        title: '',
        court: court === 'HC' ? 'High Court' : '',
        stage: 'Filing',
        client: '',
        status: 'Active',
        next: '',
        type: 'Other',
      }, firmId);
      id = created.id;
      try { await instantiateGraph(created.id, firmId, created.type, created.stage); } catch { /* lazy on read */ }
    } catch (err) {
      if ((err as { code?: string }).code === 'duplicate_cnr') { result.existing.push(cnr); continue; }
      throw err;
    }
    result.created.push({ cnr, id });
    try {
      await queueLink(id, firmId);
    } catch (err) {
      logger.warn({ err, caseId: id }, 'ecourts-import: link queue failed; scheduled run will pick it up');
    }
  }
  return result;
}
