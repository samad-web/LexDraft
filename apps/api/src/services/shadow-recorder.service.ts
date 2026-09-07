// =============================================================================
// shadow-recorder.service — capture REAL (model, engine) response pairs.
//
// Called from the actual drafting flow when an s.138 notice is drafted. The
// advocate sees the MODEL output exactly as before (shadow mode changes nothing
// user-visible). In the background this ALSO runs the engine for the same inbound
// fields and stores both responses as a pair, so the shadow reporter can diff
// real traffic — never synthetic.
//
// Guarantees:
//   * best-effort: an engine failure never affects the advocate's draft;
//   * real-only: it records what actually happened, and marks engine errors as
//     'error'/'invalid_input' so the reporter can exclude them from findings;
//   * disabled cleanly: when the engine service is not configured, recording is
//     a no-op (no rows, no cost).
// =============================================================================

import { db } from '../db/client';
import { logger } from '../logger';
import { engineClient, EngineValidationError } from './engine-client.service';

export interface CapturePair {
  docType: string;
  matterId: string | null;
  firmId: string | null;
  capturedBy: string;
  fields: Record<string, unknown>;
  /** The model pipeline's response, verbatim (DraftPipelineResult). */
  model: unknown;
}

interface MemRow extends CapturePair {
  id: string;
  engineStatus: string;
  engine: unknown;
  capturedAt: string;
}

const mem: MemRow[] = [];
let memId = 0;

export const shadowRecorderService = {
  /**
   * Capture one real pair. Runs the engine for the SAME fields as the model saw,
   * records both. Never throws — a shadow failure must not break drafting.
   *
   * Requires a matterId (the fact sheet supplies the version the engine keys on).
   * Without one we cannot draft through the engine deterministically, so we skip
   * rather than invent a matter — recording a pair on a fabricated matter would
   * be exactly the synthetic traffic we refuse to report on.
   */
  async capture(pair: CapturePair): Promise<void> {
    if (!engineClient.enabled) return; // engine off -> no shadow, no cost
    if (!pair.matterId) {
      logger.debug({ docType: pair.docType }, 'shadow: no matterId; skipping capture');
      return;
    }

    let engineStatus = 'error';
    let engineJson: unknown = null;
    try {
      const res = await engineClient.draft(pair.docType, pair.matterId, pair.fields, {
        render: false, // shadow: we compare decisions, not the rendered artifact
      });
      engineStatus = res.outcome; // 'generated' | 'refused'
      engineJson = res;
    } catch (err) {
      if (err instanceof EngineValidationError) {
        engineStatus = 'invalid_input';
        engineJson = { issues: err.issues };
      } else {
        engineStatus = 'error';
        engineJson = { message: err instanceof Error ? err.message : String(err) };
        logger.warn({ err, docType: pair.docType }, 'shadow: engine call failed');
      }
    }

    try {
      await this._store(pair, engineStatus, engineJson);
    } catch (err) {
      logger.warn({ err }, 'shadow: failed to store pair');
    }
  },

  async _store(pair: CapturePair, engineStatus: string, engineJson: unknown): Promise<void> {
    const sql = db();
    if (!sql) {
      memId += 1;
      mem.push({
        ...pair,
        id: `mem-${memId}`,
        engineStatus,
        engine: engineJson,
        capturedAt: new Date().toISOString(),
      });
      return;
    }
    await sql`
      insert into shadow_pairs
        (doc_type, matter_id, firm_id, captured_by, fields_json,
         model_json, engine_status, engine_json)
      values
        (${pair.docType}, ${pair.matterId}, ${pair.firmId}, ${pair.capturedBy},
         ${sql.json(pair.fields as Record<string, never>)},
         ${sql.json(pair.model as Record<string, never>)},
         ${engineStatus}, ${sql.json(engineJson as Record<string, never>)})
    `;
  },

  /** All recorded pairs for a doc type (newest first). Used by the reporter. */
  async list(docType: string): Promise<Array<{
    fields: Record<string, unknown>;
    model: unknown;
    engineStatus: string;
    engine: unknown;
    capturedAt: string;
  }>> {
    const sql = db();
    if (!sql) {
      return mem
        .filter((r) => r.docType === docType)
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
        .map((r) => ({
          fields: r.fields, model: r.model, engineStatus: r.engineStatus,
          engine: r.engine, capturedAt: r.capturedAt,
        }));
    }
    const rows = await sql<Array<{
      fields_json: Record<string, unknown>;
      model_json: unknown;
      engine_status: string;
      engine_json: unknown;
      captured_at: string | Date;
    }>>`
      select fields_json, model_json, engine_status, engine_json, captured_at
      from shadow_pairs
      where doc_type = ${docType}
      order by captured_at desc
    `;
    return rows.map((r) => ({
      fields: r.fields_json,
      model: r.model_json,
      engineStatus: r.engine_status,
      engine: r.engine_json,
      capturedAt: r.captured_at instanceof Date ? r.captured_at.toISOString() : r.captured_at,
    }));
  },

  _resetMemory(): void {
    mem.length = 0;
    memId = 0;
  },
};
