// Details the advocate types into "Missing details" (LiveDetailsPanel), kept per
// draft until they click "Update document". Owner 2026-11-24: typing must never
// re-draft; the document changes only once, on the advocate's approval.
// Module-level so the popup and the side-rail panel (never both mounted) share
// what was typed: closing the popup keeps it.

export type DetailEdits = Record<string, string>;

const store = new Map<string, DetailEdits>();

export const draftKey = (matterId: string, docLabel: string) => `${matterId}|${docLabel}`;

export function getEdits(key: string): DetailEdits {
  return store.get(key) ?? {};
}

export function setEdit(key: string, field: string, value: string): DetailEdits {
  const next = { ...getEdits(key), [field]: value };
  store.set(key, next);
  return next;
}

export function clearEdits(key: string): void {
  store.delete(key);
}

/** The single request "Update document" sends: every typed detail, re-drafted
 *  once with the final wording. Null when nothing was typed. */
export function updateRequest<L extends string>(matterId: string, docLabel: string, edits: DetailEdits, language?: L) {
  if (!Object.keys(edits).length) return null;
  return { matterId, docLabel, edits, draftNow: true as const, ...(language ? { language } : {}) };
}
