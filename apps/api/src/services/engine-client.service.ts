// =============================================================================
// engine-client.service — the Node client for the Python drafting-engine service.
//
// The engine is stateless; Node owns the fact sheet. This client is the ONLY
// place that talks to the engine, and it enforces the versioning invariant the
// engine's sign-off staleness depends on:
//
//   Every /v1/draft and /v1/sign-off call sends the CURRENT fact-sheet version,
//   resolved HERE from factSheetService.getCurrent(matterId). A caller passes a
//   matterId, never a version — so a stale version can't be sent by mistake.
//
// The HTTP contract is preserved as typed results, not thrown for legal outcomes:
//   * generated / refused        -> 200; both are normal EngineDraftResult values.
//   * validation (422)           -> EngineValidationError (client/form problem).
//   * signoff conflict (409)     -> EngineSignoffConflict (unfilled slot, etc.).
//   * unknown doc (404) / 5xx    -> EngineError.
// A refusal is NEVER an exception — it is a legal finding the caller renders.
// =============================================================================

import { env } from '../env';
import { logger } from '../logger';
import { factSheetService } from './factsheet.service';

// ---- Result shapes (mirror the engine's wire contract) ---------------------

export interface EngineRefusal {
  code: string;
  severity: string;
  reason: string;
  computation: string | null;
  pipeline: string;
  spec: string;
  fields_implicated: string[]; // INBOUND keys/paths (already translated engine-side)
  remedy_hint: string;
}

export interface EngineBlock {
  key: string;
  text: string;
}

export type EngineDraftResult =
  | {
      outcome: 'generated';
      docType: string;
      signals: { review_banner: string; unverified_marker: string };
      unfilledSlots: string[];
      blocks: EngineBlock[];
      docxBase64: string | null;
      /** Which template (identity + version) produced this render. Recorded on the
       *  draft_renders row so a re-render after template authoring is distinguishable
       *  from one against the old builder output. version 0 = unregistered template. */
      templateId: string;
      templateVersion: number;
    }
  | {
      outcome: 'refused';
      docType: string;
      refusal: EngineRefusal;
    };

export class EngineValidationError extends Error {
  constructor(public issues: Array<{ field: string; code: string; message: string }>) {
    super('engine input validation failed');
    this.name = 'EngineValidationError';
  }
}

export class EngineSignoffConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineSignoffConflict';
  }
}

export class EngineError extends Error {}

export class EngineDisabledError extends Error {
  constructor(message = 'engine service is not configured (ENGINE_SERVICE_URL is blank)') {
    super(message);
    this.name = 'EngineDisabledError';
  }
}

// ---- Low-level fetch --------------------------------------------------------

async function call(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  if (!env.hasEngineService) throw new EngineDisabledError();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.ENGINE_SERVICE_TOKEN) {
    headers['authorization'] = `Bearer ${env.ENGINE_SERVICE_TOKEN}`;
  }
  let res: Response;
  try {
    res = await fetch(`${env.ENGINE_SERVICE_URL}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // The engine service is configured but unreachable (not started, wrong port,
    // crashed). Surface this as "disabled/unavailable" — a clean 503 upstream —
    // rather than letting a raw `fetch failed` bubble up as an opaque 500.
    throw new EngineDisabledError(
      `engine service unreachable at ${env.ENGINE_SERVICE_URL}: ${(err as Error)?.message ?? 'fetch failed'}`,
    );
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body (unexpected); leave json null and let the caller's status
    // handling surface an EngineError.
  }
  return { status: res.status, json };
}

export const engineClient = {
  get enabled(): boolean {
    return env.hasEngineService;
  },

  /** The field/slot contract per document type. */
  async docTypes(): Promise<unknown> {
    const { status, json } = await call('GET', '/v1/doc-types');
    if (status !== 200) throw new EngineError(`doc-types failed: ${status}`);
    return json;
  },

  /**
   * Draft a document. `matterId` resolves the CURRENT fact-sheet version here;
   * the caller never supplies a version, so it is impossible to send a stale one.
   */
  async draft(
    docType: string,
    matterId: string,
    fields: Record<string, unknown>,
    opts: { slots?: Record<string, string>; render?: boolean } = {},
  ): Promise<EngineDraftResult> {
    const current = await factSheetService.getCurrent(matterId);
    if (!current) throw new EngineError(`no fact sheet for matter ${matterId}`);

    const { status, json } = await call('POST', `/v1/draft/${docType}`, {
      matter: { matter_id: matterId, version: current.version },
      fields,
      slots: opts.slots ?? {},
      render: opts.render ?? true,
    });

    if (status === 422) throw new EngineValidationError(json?.issues ?? []);
    if (status === 404) throw new EngineError(`unknown doc_type ${docType}`);
    if (status !== 200) throw new EngineError(`draft failed: ${status}`);

    if (json.outcome === 'refused') {
      return { outcome: 'refused', docType, refusal: json.refusal as EngineRefusal };
    }
    return {
      outcome: 'generated',
      docType,
      signals: json.signals,
      unfilledSlots: json.unfilled_slots ?? [],
      blocks: json.blocks ?? [],
      docxBase64: json.docx_base64 ?? null,
      templateId: json.template_id ?? '',
      templateVersion: json.template_version ?? 0,
    };
  },

  /**
   * Mark a document final. Sends the CURRENT version (resolved here), so the
   * engine records the exact version the advocate reviewed. If the facts are
   * later revised, getCurrent moves on and the engine treats this sign-off as
   * stale — the versioning is what makes that work.
   */
  async signOff(args: {
    docType: string;
    matterId: string;
    reviewer: string;
    signedOn: string;
    context: Record<string, unknown>;
  }): Promise<{ version: number }> {
    const current = await factSheetService.getCurrent(args.matterId);
    if (!current) throw new EngineError(`no fact sheet for matter ${args.matterId}`);
    const { status, json } = await call('POST', '/v1/sign-off', {
      matter: { matter_id: args.matterId, version: current.version },
      document: args.docType,
      reviewer: args.reviewer,
      signed_on: args.signedOn,
      context: args.context,
    });
    if (status === 409) {
      throw new EngineSignoffConflict(json?.detail?.message ?? 'sign-off refused');
    }
    if (status === 422) throw new EngineValidationError(json?.detail?.issues ?? json?.issues ?? []);
    if (status !== 200) throw new EngineError(`sign-off failed: ${status}`);
    return { version: json.version };
  },

  /** dual_code_router only — resolve the procedural framework or refuse. */
  async routeCode(input: {
    offenceDate?: string;
    proceedingStartDate?: string;
    isFreshAction: boolean;
  }): Promise<
    | { outcome: 'resolved'; codeFramework: string; substantive: string }
    | { outcome: 'refused'; refusal: EngineRefusal }
  > {
    const { status, json } = await call('POST', '/v1/route-code', {
      offence_date: input.offenceDate ?? null,
      proceeding_start_date: input.proceedingStartDate ?? null,
      is_fresh_action: input.isFreshAction,
    });
    if (status !== 200) throw new EngineError(`route-code failed: ${status}`);
    if (json.outcome === 'refused') return { outcome: 'refused', refusal: json.refusal };
    return {
      outcome: 'resolved',
      codeFramework: json.code_framework,
      substantive: json.substantive,
    };
  },

  async health(): Promise<boolean> {
    try {
      const { status } = await call('GET', '/healthz');
      return status === 200;
    } catch (err) {
      logger.warn({ err }, 'engine health check failed');
      return false;
    }
  },
};
