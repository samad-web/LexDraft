"""Dump every engine adapter's field contract to JSON for the Node alignment check.

The Node/web repo can't import the Python engine, so the engine's describe() contract
is snapshotted here and committed on the Node side
(apps/api/src/lib/__tests__/engine-doc-contract.json). The schema-engine-alignment
test diffs web DOC_SCHEMAS against this snapshot. Regenerate + commit whenever an
engine adapter adds/removes/renames a field.

Usage:
    python tools/dump_engine_contract.py            # prints JSON to stdout
    python tools/dump_engine_contract.py --out PATH # writes to PATH
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.service import adapters  # noqa: E402


def build() -> dict:
    out: dict = {}
    for a in adapters.all_adapters():
        d = a.describe()
        required, allf, fields = [], [], []
        for f in d.get("fields", []):
            name = f.get("name") or f.get("key")
            if not name:
                continue
            allf.append(name)
            if f.get("required"):
                required.append(name)
            # Full descriptor for the form generator: kind + enum values drive the web
            # field TYPE (the presentation LABEL/section/help are authored separately).
            desc = {"key": name, "kind": f.get("kind", "string"),
                    "required": bool(f.get("required"))}
            if f.get("enum_values"):
                desc["enumValues"] = list(f["enum_values"])
            # A conditionally-required field carries the machine-readable condition
            # (e.g. {"field": "matter_type", "equals": "s138"}). Passed through so the
            # Node contract stays honest about when a field is required.
            if f.get("required_when") is not None:
                desc["requiredWhen"] = dict(f["required_when"])
            # A `list` field (e.g. cheques) carries a nested item schema — the sub-fields
            # each list item collects. The generator renders a repeatable sub-record
            # group from these; the coercion assembles the array of objects.
            if f.get("item_fields"):
                desc["itemFields"] = [
                    {"key": it.get("key"), "kind": it.get("kind", "string"),
                     "required": bool(it.get("required")),
                     **({"enumValues": list(it["enum_values"])} if it.get("enum_values") else {})}
                    for it in f["item_fields"] if it.get("key")
                ]
            if f.get("min_items") is not None:
                desc["minItems"] = f["min_items"]
            fields.append(desc)
        out[a.doc_type] = {
            "title": d.get("title", a.doc_type),
            "required": sorted(set(required)),
            "all": sorted(set(allf)),
            # ordered as the adapter declares them (meaningful default field order).
            "fields": fields,
        }
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Dump engine field contract to JSON.")
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args(argv)
    data = json.dumps(build(), indent=2, sort_keys=True) + "\n"
    if args.out:
        args.out.write_text(data, encoding="utf-8")
        print(f"wrote {args.out}")
    else:
        sys.stdout.write(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
