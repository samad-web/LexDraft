// team-docs: copies (marked, edited, duplicated) listed right under the document
// they came from, oldest first, with how deep they sit. A copy whose original
// isn't in the list (another case, filtered out) stays at the top level.
import type { DocumentRecord } from '@lexdraft/types';

export interface DocRow { doc: DocumentRecord; depth: number }

const parentOf = (d: DocumentRecord) => d.parentDocumentId ?? d.parentDraftId ?? null;

export function nestDocuments(items: readonly DocumentRecord[], maxDepth = 3): DocRow[] {
  const ids = new Set(items.map((d) => d.id).filter(Boolean) as string[]);
  const children = new Map<string, DocumentRecord[]>();
  const top: DocumentRecord[] = [];
  for (const d of items) {
    const p = parentOf(d);
    if (p && p !== d.id && ids.has(p)) {
      if (!children.has(p)) children.set(p, []);
      children.get(p)!.push(d);
    } else {
      top.push(d);
    }
  }
  for (const list of children.values()) list.sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const out: DocRow[] = [];
  const seen = new Set<string>();
  const walk = (d: DocumentRecord, depth: number) => {
    if (d.id) {
      if (seen.has(d.id)) return; // a broken loop of parents never repeats a row
      seen.add(d.id);
    }
    out.push({ doc: d, depth: Math.min(depth, maxDepth) });
    for (const c of (d.id && children.get(d.id)) || []) walk(c, depth + 1);
  };
  top.forEach((d) => walk(d, 0));
  // anything only reachable through a loop of parents still shows once
  items.forEach((d) => { if (d.id && !seen.has(d.id)) walk(d, 0); });
  return out;
}

/** "Marked copy · by Priya" style label for a copy; "by Priya" for an original. */
export function makerLine(d: DocumentRecord, isCopy: boolean): string {
  const kind = /\(marked copy|\(review,/i.test(d.name) ? 'Marked copy'
    : /\(edited\)$/i.test(d.name) || isCopy ? 'Copy' : '';
  const by = d.createdByName ? `by ${d.createdByName}` : '';
  return [isCopy ? kind : '', by].filter(Boolean).join(' · ');
}
