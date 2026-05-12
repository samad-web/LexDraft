/**
 * Resolve a letterhead — by id, or "the user's effective default" — into the
 * shape `exportPdf` / `exportDocx` need to render it.
 *
 * Why a separate file: the exporter runs inside a non-React call stack
 * (a button onClick), so it can't use TanStack hooks directly. These
 * helpers wrap the same endpoints the hooks use but as plain async fns.
 *
 * Cheap to call repeatedly — the underlying endpoints respond in tens of ms
 * and the response is small. If repeated calls become a hot path we can
 * memoise on the React Query cache, but exporters don't fire often enough
 * to justify that today.
 */

import { api } from '@/lib/api';
import type {
  Letterhead,
  LetterheadFields,
  LetterheadTemplateKey,
  ListLetterheadsResponse,
} from '@/hooks/useLetterheads';

/** What the exporter needs to render a letterhead — template + slot values
 *  + the logo as a usable URL (already resolved to a presigned GET). */
export interface ResolvedLetterhead {
  id: string;
  name: string;
  templateKey: LetterheadTemplateKey;
  fields: LetterheadFields;
  logoUrl: string | null;
}

/** Fetch a single letterhead by id and resolve its logo URL if present. */
export async function resolveLetterhead(id: string): Promise<ResolvedLetterhead | null> {
  try {
    const lh = await api.get<Letterhead>(`/letterheads/${id}`);
    return await toResolved(lh);
  } catch {
    return null;
  }
}

/** Fetch the user's effective default — personal beats firm, returns null
 *  if neither exists. The route already computes which one wins. */
export async function resolveEffectiveLetterhead(): Promise<ResolvedLetterhead | null> {
  try {
    const list = await api.get<ListLetterheadsResponse>('/letterheads');
    const lh = list.effectiveDefault;
    return lh ? await toResolved(lh) : null;
  } catch {
    // Failing to resolve a letterhead must never break the export — fall
    // back to the un-letterheaded path silently.
    return null;
  }
}

async function toResolved(lh: Letterhead): Promise<ResolvedLetterhead> {
  let logoUrl: string | null = null;
  if (lh.logoKey) {
    try {
      const res = await api.get<{ downloadUrl: string | null }>(
        `/letterheads/${lh.id}/logo-url`,
      );
      logoUrl = res.downloadUrl;
    } catch {
      // Logo fetch failure shouldn't poison the rest of the letterhead —
      // the template renders gracefully with an empty logoUrl.
      logoUrl = null;
    }
  }
  return {
    id: lh.id,
    name: lh.name,
    templateKey: lh.templateKey,
    fields: lh.fields,
    logoUrl,
  };
}
