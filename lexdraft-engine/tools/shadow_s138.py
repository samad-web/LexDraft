"""s.138 notice — shadow-mode harness (API-layer migration Phase 1).

Runs a matter through the ENGINE (via the adapter) and diffs the result against
the current TS-pipeline output for the SAME matter, WITHOUT changing anything the
advocate sees. The point is to understand — before flipping the flag — every place
the engine decides or refuses differently from the model, and confirm each is an
engine win (a real defect the model missed, a section the engine resolves
deterministically, a refusal the model would have drafted through).

The engine side is live. The TS side is supplied as a recorded JSON response
(what `POST /drafting/pipeline` returned for the same brief), so this runs offline
and deterministically; in CI it is fed fixtures, in practice it is fed real
recorded pairs. The diff is structured, not textual.

Usage:
    python tools/shadow_s138.py --pair intake/shadow/M-A.json
    python tools/shadow_s138.py --report intake/shadow/pairs.json   # many

A pair file is:
    { "matter_id": "...", "version": 1,
      "fields": { <s138 inbound fields> },
      "ts": { <recorded TS pipeline response, or null if unavailable> } }
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.service import adapters  # noqa: E402
from src.service.adapters import AdapterValidationError  # noqa: E402


class _Matter:
    def __init__(self, matter_id: str, version: int):
        self.matter_id = matter_id
        self.version = version


def _engine_result(fields: Dict[str, Any], matter: _Matter) -> Dict[str, Any]:
    """Run the engine via the adapter and return a compact structured result."""
    adapter = adapters.get_adapter("s138_notice")
    try:
        kwargs = adapter.coerce(fields)
    except AdapterValidationError as exc:
        # A validation failure here means the fixture's fields are incomplete —
        # report it as such (it is NOT an engine refusal).
        return {"status": "invalid_input", "issues": exc.to_dict()["issues"]}
    result = adapter.build(**kwargs)
    if getattr(result, "refused", False):
        return {"status": "refused",
                "refusal": adapter.refusal_to_wire(result.refusal)}
    return {"status": "generated",
            "demand_amount": result.context.get("demand_amount"),
            "unverified_marker": result.context.get("unverified_marker", "")}


def _diff(engine: Dict[str, Any], ts: Optional[Dict[str, Any]]) -> List[str]:
    """Structured differences engine-vs-TS. Each line is a finding to understand."""
    findings: List[str] = []
    if ts is None:
        findings.append("NO_TS_BASELINE: engine result recorded; no TS output to compare")
        return findings

    # The TS pipeline expresses a hard block via `blocked=true`; the engine via a
    # refusal. Compare the two notions of "should not be filed".
    engine_blocks = engine["status"] == "refused"
    ts_blocks = bool(ts.get("blocked"))
    if engine_blocks and not ts_blocks:
        findings.append(
            f"ENGINE_REFUSES_TS_DRAFTS: engine refused "
            f"({engine['refusal']['code']}) but TS produced a draft — the model "
            f"would have drafted a legally-defective notice. ENGINE WIN.")
    elif ts_blocks and not engine_blocks:
        findings.append(
            "TS_BLOCKS_ENGINE_GENERATES: TS blocked export but the engine "
            "generated — inspect the TS block reason; may be a citation-audit "
            "concern the engine handles differently (see §7.2 of the plan).")
    elif engine_blocks and ts_blocks:
        findings.append(
            f"BOTH_BLOCK: engine code={engine['refusal']['code']}; "
            f"TS advisories={ts.get('advisories', [])} — confirm same ground.")
    else:
        findings.append("BOTH_GENERATE: compare section citations + computations.")

    # Old-law leakage: the TS side flags repealed citations post-hoc; the engine
    # never emits one. If the TS draft carried old-law refs, note it.
    old = (ts.get("verify") or {}).get("old_law_references") or []
    if old:
        findings.append(f"TS_OLD_LAW_REFS: {old} — engine cites in-force codes by "
                        f"construction. ENGINE WIN.")
    return findings


def run_pair(pair: Dict[str, Any]) -> Dict[str, Any]:
    matter = _Matter(pair["matter_id"], int(pair.get("version", 1)))
    engine = _engine_result(pair["fields"], matter)
    findings = _diff(engine, pair.get("ts"))
    return {"matter_id": pair["matter_id"], "engine": engine, "findings": findings}


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="s.138 shadow-mode engine/TS diff.")
    ap.add_argument("--pair", type=Path, help="a single pair JSON file")
    ap.add_argument("--report", type=Path, help="a JSON array of pair files / pairs")
    args = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")

    pairs: List[Dict[str, Any]] = []
    if args.pair:
        pairs.append(json.loads(args.pair.read_text(encoding="utf-8")))
    if args.report:
        entries = json.loads(args.report.read_text(encoding="utf-8"))
        for e in entries:
            if isinstance(e, str):
                pairs.append(json.loads((args.report.parent / e).read_text(encoding="utf-8")))
            else:
                pairs.append(e)
    if not pairs:
        ap.error("supply --pair or --report")

    all_findings = 0
    for pair in pairs:
        out = run_pair(pair)
        print(f"\n=== {out['matter_id']} — engine: {out['engine']['status']} ===")
        for f in out["findings"]:
            print(f"  • {f}")
            all_findings += 1
    print(f"\n{len(pairs)} matter(s), {all_findings} finding(s). "
          f"Shadow mode: nothing user-visible changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
