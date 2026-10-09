// =============================================================================
// bns-enrichment — deterministic IPC/CrPC/IEA -> BNS/BNSS/BSA enrichment for the
// conversational intake, so a draft cites the IN-FORCE 2023 Sanhita sections
// instead of the repealed codes.
//
// The intake extracts an advocate's brief + case documents into fields. Those
// fields (and the brief itself) commonly carry legacy references — "cheating
// u/s 420 IPC", "bail under 439 CrPC". This module uses the curated
// sanhita-map.json (via sanhitaService) to:
//   1. REWRITE a field value's legacy tokens to the new section, keeping the old
//      one in a parenthetical so nothing the advocate typed is lost:
//         "420 IPC"  ->  "Section 318 BNS (formerly Section 420 IPC)"
//   2. Produce a human CONCORDANCE ("Section 420 IPC -> Section 318 BNS") the UI
//      can show and the brief can carry, so the engine/model has the exact
//      numbers rather than being told to "use BNS where applicable".
//
// Deterministic + synchronous. Coverage is the curated map's coverage: an
// unmapped reference is LEFT UNTOUCHED (never guessed). This is a drafting aid;
// counsel confirms — see sanhita-map.json's UNVERIFIED markers.
// =============================================================================

import { sanhitaService } from '../services/sanhita.service';
import type { ScanSuggestion } from '../types/sanhita.types';

export interface BnsConcordanceEntry {
  /** As written in the brief, normalised — e.g. "Section 420 IPC". */
  old: string;
  /** The in-force replacement — e.g. "Section 318 BNS". */
  new: string;
  toAct: 'BNS' | 'BNSS' | 'BSA';
  /** substantiveChange from the map — surfaced so counsel sees a non-trivial recast. */
  change: string;
}

/** Format a mapping's old/new side as "Section <n> <ACT>". */
function fmtOld(s: ScanSuggestion): string {
  return `Section ${s.fromSection} ${s.fromAct}`;
}
function fmtNew(s: ScanSuggestion): string {
  const m = s.mapping!;
  return `Section ${m.toSection} ${m.toAct}`;
}

/**
 * Scan free text and return a de-duplicated concordance of every legacy
 * reference that HAS a mapping. Hits with no mapping are dropped (we don't guess).
 */
export function scanConcordance(text: string): BnsConcordanceEntry[] {
  if (!text || !text.trim()) return [];
  const { suggestions } = sanhitaService.scanText(text);
  const out: BnsConcordanceEntry[] = [];
  const seen = new Set<string>();
  for (const s of suggestions) {
    if (!s.mapping) continue;
    const key = `${s.fromAct}:${s.fromSection}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      old: fmtOld(s),
      new: fmtNew(s),
      toAct: s.mapping.toAct,
      change: s.mapping.substantiveChange || 'Renumbered only',
    });
  }
  return out;
}

/**
 * Rewrite a single field value: every legacy reference that maps is replaced by
 * its new section, keeping the old one parenthetically. Returns the value
 * unchanged when it carries no mapped reference. Longest matches are replaced
 * first (via source-order + offset handling) so overlapping tokens are safe.
 */
export function rewriteValueToBns(value: string): string {
  if (!value || !value.trim()) return value;
  const { suggestions } = sanhitaService.scanText(value);
  const mapped = suggestions.filter((s) => s.mapping);
  if (mapped.length === 0) return value;
  // Replace from the LAST match backwards so earlier indices stay valid.
  const ordered = [...mapped].sort((a, b) => b.index - a.index);
  let out = value;
  for (const s of ordered) {
    const replacement = `${fmtNew(s)} (formerly ${fmtOld(s)})`;
    out = out.slice(0, s.index) + replacement + out.slice(s.index + s.length);
  }
  return out;
}

/**
 * Enrich a form in place-safe fashion: return a NEW form where every string
 * field value that contains a mapped legacy reference is rewritten to the new
 * section. Only string values are touched; arrays/objects/numbers pass through.
 * Also returns the overall concordance found across all fields (+ any extra text
 * such as the brief) for persistence / UI display.
 */
export function enrichFormWithBns(
  form: Record<string, unknown>,
  extraText = '',
): { form: Record<string, unknown>; concordance: BnsConcordanceEntry[] } {
  const nextForm: Record<string, unknown> = { ...form };
  let combined = extraText;
  for (const [k, v] of Object.entries(form)) {
    if (typeof v === 'string' && v.trim()) {
      combined += `\n${v}`;
      const rewritten = rewriteValueToBns(v);
      if (rewritten !== v) nextForm[k] = rewritten;
    }
  }
  return { form: nextForm, concordance: scanConcordance(combined) };
}

/** Render a concordance as a compact brief block the engine/model can read. */
export function concordanceToBriefBlock(entries: BnsConcordanceEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((e) =>
    `- ${e.old} → ${e.new}${e.change && e.change !== 'Renumbered only' ? ` (${e.change})` : ''}`,
  );
  return (
    '[In-force law — cite these 2023 Sanhita sections; the legacy codes below are repealed]\n' +
    lines.join('\n')
  );
}
