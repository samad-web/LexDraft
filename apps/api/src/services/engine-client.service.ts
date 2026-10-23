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

/** One document in a bundle response — the same shape a single /v1/draft returns,
 *  either generated or refused. */
export type EngineBundleDoc =
  | {
      outcome: 'generated';
      docType: string;
      signals: { review_banner: string; unverified_marker: string };
      unfilledSlots: string[];
      blocks: EngineBlock[];
      docxBase64: string | null;
      templateId: string;
      templateVersion: number;
    }
  | { outcome: 'refused'; docType: string; refusal: EngineRefusal };

/** Result of POST /v1/draft-bundle/s138_complaint. Either the complaint was
 *  legally refused (whole bundle short-circuits, no affidavit built), or both the
 *  complaint and its derived proof affidavit come back. The affidavit itself may
 *  still be refused if it re-runs a window stop the complaint did not gate. */
export type EngineS138BundleResult =
  | { outcome: 'refused'; for: 's138_complaint'; refusal: EngineRefusal }
  | { outcome: 'generated'; bundle: 's138_complaint'; complaint: EngineBundleDoc; affidavit: EngineBundleDoc };

/** Deponent particulars the complaint does not carry, required to derive the
 *  affidavit. Everything else is read from the built complaint. */
export interface S138AffidavitDeponent {
  deponentAge: number;
  deponentOccupation: string;
  attestor: string;
  authorityRef?: string;
  affirmDate?: string;
}

/** GET /v1/format-spec/contract — the engine owns the format-spec contract. */
export interface EngineFormatContract {
  system_prompt: string;
  schema: Record<string, unknown>;
  existing: Array<[string, string]>;
  common_keys: string[];
  block_styles: string[];
  field_kinds: string[];
}

/** POST /v1/format-spec/check. `spec` comes back normalised. */
export interface EngineSpecCheck {
  ok: boolean;
  problems: string[];
  spec: unknown;
  preview: string[];
  describe: { fields: Array<{ key: string; kind: string; required: boolean; enum_values?: string[] }> } | null;
}

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

/** Map one document in a bundle response (snake_case wire) to EngineBundleDoc.
 *  Shared by the complaint and affidavit halves — the same shape /v1/draft yields. */
function mapBundleDoc(docType: string, doc: any): EngineBundleDoc {
  if (doc?.outcome === 'refused') {
    return { outcome: 'refused', docType, refusal: doc.refusal as EngineRefusal };
  }
  return {
    outcome: 'generated',
    docType,
    signals: doc.signals,
    unfilledSlots: doc.unfilled_slots ?? [],
    blocks: doc.blocks ?? [],
    docxBase64: doc.docx_base64 ?? null,
    templateId: doc.template_id ?? '',
    templateVersion: doc.template_version ?? 0,
  };
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
    opts: { slots?: Record<string, string>; render?: boolean; language?: string; allowPlaceholders?: boolean } = {},
  ): Promise<EngineDraftResult> {
    const current = await factSheetService.getCurrent(matterId);
    if (!current) throw new EngineError(`no fact sheet for matter ${matterId}`);

    const { status, json } = await call('POST', `/v1/draft/${docType}`, {
      // Draft status is shown in the app; keep the banner line out of the document.
      review_banner_in_document: false,
      // "Draft now" only: accept visible [… to be provided] gaps in required text.
      ...(opts.allowPlaceholders ? { allow_placeholders: true } : {}),
      matter: { matter_id: matterId, version: current.version },
      fields,
      slots: opts.slots ?? {},
      render: opts.render ?? true,
      // Output language for the RENDERED docx (EN default; 'TA' → Tamil render).
      // Additive: the engine ignores it for EN, so existing callers are unaffected.
      language: opts.language ?? 'EN',
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
   * Draft the s.138 complaint AND its derived proof affidavit in one call
   * (POST /v1/draft-bundle/s138_complaint). `fields` is the same complaint payload
   * `draft('s138_complaint', ...)` takes; `deponent` supplies the affidavit-only
   * particulars the complaint does not carry.
   *
   * A complaint refusal short-circuits the bundle (no affidavit is built) and is
   * returned as `{ outcome: 'refused', for: 's138_complaint' }` — never thrown.
   */
  async draftS138Bundle(
    matterId: string,
    fields: Record<string, unknown>,
    deponent: S138AffidavitDeponent,
    opts: { slots?: Record<string, string>; render?: boolean } = {},
  ): Promise<EngineS138BundleResult> {
    const current = await factSheetService.getCurrent(matterId);
    if (!current) throw new EngineError(`no fact sheet for matter ${matterId}`);

    const { status, json } = await call('POST', '/v1/draft-bundle/s138_complaint', {
      review_banner_in_document: false,
      matter: { matter_id: matterId, version: current.version },
      fields,
      affidavit: {
        deponent_age: deponent.deponentAge,
        deponent_occupation: deponent.deponentOccupation,
        attestor: deponent.attestor,
        ...(deponent.authorityRef !== undefined ? { authority_ref: deponent.authorityRef } : {}),
        ...(deponent.affirmDate !== undefined ? { affirm_date: deponent.affirmDate } : {}),
      },
      slots: opts.slots ?? {},
      render: opts.render ?? true,
    });

    if (status === 422) throw new EngineValidationError(json?.issues ?? []);
    if (status !== 200) throw new EngineError(`draft-bundle failed: ${status}`);

    if (json.outcome === 'refused') {
      return { outcome: 'refused', for: 's138_complaint', refusal: json.refusal as EngineRefusal };
    }
    return {
      outcome: 'generated',
      bundle: 's138_complaint',
      complaint: mapBundleDoc('s138_complaint', json.complaint),
      affidavit: mapBundleDoc('affidavit', json.affidavit),
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

  // ---- A firm's OWN format (spec sent with each call; engine is stateless) ----

  /** What the format reader must produce: transcriber prompt, JSON schema, and
   *  the engine vocabulary (existing doc types, common field keys). */
  async formatContract(): Promise<EngineFormatContract> {
    const { status, json } = await call('GET', '/v1/format-spec/contract');
    if (status !== 200) throw new EngineError(`format-spec contract failed: ${status}`);
    return json as EngineFormatContract;
  },

  /** Validate a spec + preview it rendered with sample data. */
  async checkSpec(docType: string, spec: unknown): Promise<EngineSpecCheck> {
    const { status, json } = await call('POST', '/v1/format-spec/check', { doc_type: docType, spec });
    if (status !== 200) throw new EngineError(`format-spec check failed: ${status}`);
    return {
      ok: Boolean(json?.ok),
      problems: json?.problems ?? [],
      spec: json?.spec ?? spec,
      preview: json?.preview ?? [],
      describe: json?.describe ?? null,
    };
  },

  /** Draft from a firm format's stored spec. Same result contract as draft(). */
  async draftSpec(
    docType: string,
    spec: unknown,
    version: number,
    matterId: string,
    fields: Record<string, unknown>,
    opts: { slots?: Record<string, string>; render?: boolean; language?: string; allowPlaceholders?: boolean } = {},
  ): Promise<EngineDraftResult> {
    const current = await factSheetService.getCurrent(matterId);
    if (!current) throw new EngineError(`no fact sheet for matter ${matterId}`);
    const { status, json } = await call('POST', '/v1/draft-spec', {
      review_banner_in_document: false,
      ...(opts.allowPlaceholders ? { allow_placeholders: true } : {}),
      doc_type: docType,
      spec,
      status: 'approved',
      version,
      matter: { matter_id: matterId, version: current.version },
      fields,
      slots: opts.slots ?? {},
      render: opts.render ?? true,
      language: opts.language ?? 'EN',
    });
    if (status === 422 && json?.error === 'invalid_spec') {
      throw new EngineError(`stored format is invalid: ${(json.problems ?? []).join('; ')}`);
    }
    if (status === 422) throw new EngineValidationError(json?.issues ?? json?.detail?.issues ?? []);
    if (status !== 200) throw new EngineError(`draft-spec failed: ${status}`);
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

  /** A doc type (or a firm spec) rendered as a blank, editable form. `null` when
   *  the format can't be produced without the case facts (engine 409). */
  async blank(input: {
    docType: string;
    spec?: unknown;
    preset?: Record<string, string>;
  }): Promise<{ docxBase64: string; blocks: EngineBlock[] } | { needsFacts: string }> {
    const { status, json } = await call('POST', '/v1/blank', {
      doc_type: input.docType,
      ...(input.spec !== undefined ? { spec: input.spec } : {}),
      preset: input.preset ?? {},
    });
    if (status === 409) return { needsFacts: json?.reason ?? 'this format needs the case details' };
    if (status === 404) throw new EngineError(`unknown doc_type ${input.docType}`);
    if (status !== 200) throw new EngineError(`blank failed: ${status}`);
    return { docxBase64: json.docx_base64, blocks: json.blocks ?? [] };
  },

  /** The LAWE forms library: each form, its original-PDF link, and the doc type
   *  (+ variant preset) that drafts it here. */
  async laweCatalog(): Promise<Array<{
    id: string; title: string; group: string; url: string; doc_type: string; preset: Record<string, string>;
  }>> {
    const { status, json } = await call('GET', '/v1/lawe-catalog');
    if (status !== 200) throw new EngineError(`lawe-catalog failed: ${status}`);
    return json?.forms ?? [];
  },

  /** Write edited paragraphs back into an engine .docx (keeps the court layout).
   *  null when paragraphs were added/removed — the caller falls back. */
  async applyEdits(docxBase64: string, paragraphs: string[]): Promise<string | null> {
    const { status, json } = await call('POST', '/v1/apply-edits', { docx_base64: docxBase64, paragraphs });
    if (status !== 200) throw new EngineError(`apply-edits failed: ${status}`);
    return json?.matched ? (json.docx_base64 as string) : null;
  },

  /** Doc types the LIVE engine serves right now (null if it can't be reached). */
  async servedDocTypes(): Promise<Set<string> | null> {
    try {
      const { status, json } = await call('GET', '/healthz');
      if (status !== 200 || !Array.isArray(json?.doc_types)) return null;
      return new Set(json.doc_types as string[]);
    } catch {
      return null;
    }
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
