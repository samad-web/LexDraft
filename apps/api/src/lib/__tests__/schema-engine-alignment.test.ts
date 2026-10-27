// =============================================================================
// schema-engine-alignment — CI gate: the web DOC_SCHEMAS must match the engine's
// field contract for every doc type routed through the engine.
//
// WHY THIS EXISTS
//   The engine path is passthrough for all doc types except s138_notice: the web form
//   posts its field keys and the engine substitutes them. That ONLY works if the web
//   form's keys ARE the engine adapter's keys. Nothing generated the web forms from
//   the engine contract and nothing enforced the match, so the two vocabularies
//   silently drifted — most "routable" doc types would 422 on nearly every field, or
//   never route at all because the web label != the engine label.
//
//   This test makes that drift a BUILD FAILURE. It compares, for every engine label:
//     1. REACHABILITY — is there a web DOC_SCHEMAS entry under that exact label? (If
//        not, the web can never route to it — a label mismatch.)
//     2. FIELD ALIGNMENT — do the web form's keys cover the engine's REQUIRED fields,
//        with no web key the engine doesn't accept?
//
//   Doc types with a bespoke mapper (engine-field-map CUSTOM_MAPPERS) are exempt from
//   field alignment — their whole purpose is to bridge different vocabularies.
//
// This test READS the two source files textually rather than importing the web bundle
// (the api package can't import the web package). The engine contract is captured in a
// committed snapshot (engine-doc-contract.json) generated from the engine's describe();
// regenerate it with scripts/dump-engine-contract when the engine adds/changes fields.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LABEL_TO_ENGINE_DOC } from '../engine-field-map';

const WEB_SCHEMAS = join(__dirname, '../../../../web/src/lib/doc-schemas.ts');
// Canonical location is @lexdraft/types (both apps' production code depends
// on it - it used to live here, which broke the web Docker build).
const CONTRACT = join(__dirname, '../../../../../packages/types/src/data/engine-doc-contract.json');
const BASELINE = join(__dirname, 'engine-alignment-baseline.json');

interface Baseline {
  unreachableLabels: string[];
  misalignedFields: Record<string, { missingRequired: string[]; webExtra: string[] }>;
}

function loadBaseline(): Baseline {
  if (!existsSync(BASELINE)) return { unreachableLabels: [], misalignedFields: {} };
  const b = JSON.parse(readFileSync(BASELINE, 'utf8'));
  return {
    unreachableLabels: b.unreachableLabels ?? [],
    misalignedFields: b.misalignedFields ?? {},
  };
}

// Bespoke mappers bridge vocab deliberately — exempt from field alignment (but still
// must be reachable by label).
const BESPOKE = new Set(['s138_notice']);

// Doc types whose custom mapper reshapes SOME web keys (engine-field-map.ts): the
// consumed web keys are replaced by the engine keys the mapper emits; every other
// key is still checked like a passthrough doc type.
const BRIDGED: Record<string, { consumes: RegExp; provides: string[] }> = {
  s138_complaint: {
    consumes: /^(cheque_no|cheque_date|cheque_amount|drawee_bank)(_\d+)?$|^notice_service_status$/,
    provides: ['cheques', 'notice_refused', 'notice_unclaimed'],
  },
};

/** Parse DOC_SCHEMAS: top-level label -> its field `key:` names. Textual parse (no
 *  web bundle import); mirrors the audit tool. */
function parseWebSchemas(src: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const keyRe = /^  ['"]([^'"]+)['"]:\s*\{/gm;
  const labels: Array<{ label: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(src))) labels.push({ label: m[1]!, start: m.index });
  for (let i = 0; i < labels.length; i += 1) {
    const start = labels[i]!.start;
    const end = i + 1 < labels.length ? labels[i + 1]!.start : src.length;
    const block = src.slice(start, end);
    const fields = new Set<string>();
    const fk = /\bkey:\s*['"]([a-zA-Z0-9_]+)['"]/g;
    let fm: RegExpExecArray | null;
    while ((fm = fk.exec(block))) fields.add(fm[1]!);
    out.set(labels[i]!.label, fields);
  }
  return out;
}

interface EngineContract {
  [slug: string]: { required: string[]; all: string[] };
}

describe('web DOC_SCHEMAS ↔ engine contract alignment', () => {
  // If the contract snapshot isn't present yet, fail with a clear instruction rather
  // than silently passing — a missing snapshot must not look like "aligned".
  it('has a committed engine contract snapshot', () => {
    expect(
      existsSync(CONTRACT),
      `Missing ${CONTRACT}. Generate it from the engine describe() (see ` +
        `scripts/dump-engine-contract) and commit it.`,
    ).toBe(true);
  });

  if (!existsSync(CONTRACT)) return;

  const contract = JSON.parse(readFileSync(CONTRACT, 'utf8')) as EngineContract;
  const webSrc = readFileSync(WEB_SCHEMAS, 'utf8');
  const web = parseWebSchemas(webSrc);
  const baseline = loadBaseline();

  const engineLabels = Object.entries(LABEL_TO_ENGINE_DOC);

  // The check ratchets: it fails on drift that is NOT in the accepted-drift baseline
  // (a regression), AND on baseline entries that are now FIXED but not removed (so a
  // fix must delete its baseline entry — the backlog can only shrink). It never fails
  // on a known, still-present baseline entry.

  it('no NEW unreachable doc types beyond the accepted baseline', () => {
    const unreachable = engineLabels.filter(([label]) => !web.has(label)).map(([l]) => l);
    const known = new Set(baseline.unreachableLabels);
    const regressions = unreachable.filter((l) => !known.has(l));
    expect(
      regressions,
      `NEW label mismatch(es) — a web DOC_SCHEMAS label stopped matching its engine ` +
        `label. Align the label instead of adding to the baseline:\n  ${regressions.join('\n  ')}`,
    ).toEqual([]);
  });

  it('baseline unreachable entries that are now fixed must be removed from the baseline', () => {
    const reachable = new Set(engineLabels.filter(([label]) => web.has(label)).map(([l]) => l));
    const staleFixed = baseline.unreachableLabels.filter((l) => reachable.has(l));
    expect(
      staleFixed,
      `These labels are now reachable — remove them from engine-alignment-baseline.json ` +
        `unreachableLabels (the backlog only shrinks):\n  ${staleFixed.join('\n  ')}`,
    ).toEqual([]);
  });

  it('no NEW field drift beyond the accepted baseline for reachable doc types', () => {
    const regressions: string[] = [];
    for (const [label, slug] of engineLabels) {
      if (BESPOKE.has(slug)) continue;
      const rawKeys = web.get(label);
      if (!rawKeys) continue; // unreachable — covered above
      const bridge = BRIDGED[slug];
      const wkeys = bridge
        ? new Set([...[...rawKeys].filter((k) => !bridge.consumes.test(k)), ...bridge.provides])
        : rawKeys;
      const c = contract[slug];
      if (!c) {
        regressions.push(`${label} -> ${slug}: no contract entry (regenerate snapshot)`);
        continue;
      }
      const missingRequired = c.required.filter((k) => !wkeys.has(k));
      const webExtra = [...wkeys].filter((k) => !c.all.includes(k));
      if (!missingRequired.length && !webExtra.length) continue;

      const base = baseline.misalignedFields[label];
      // A regression = a missing-required or web-extra key NOT already accepted.
      const newMissing = missingRequired.filter((k) => !base?.missingRequired.includes(k));
      const newExtra = webExtra.filter((k) => !base?.webExtra.includes(k));
      if (newMissing.length || newExtra.length) {
        regressions.push(
          `${label} -> ${slug}: NEW missing-required=[${newMissing.join(', ')}] ` +
            `NEW web-extra=[${newExtra.join(', ')}]`,
        );
      }
    }
    expect(
      regressions,
      `NEW web<->engine field drift (passthrough would 422). Align keys or add a mapper; ` +
        `do NOT add to the baseline:\n  ${regressions.join('\n  ')}`,
    ).toEqual([]);
  });
});
