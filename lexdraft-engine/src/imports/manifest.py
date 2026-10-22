"""The imported-formats manifest: one entry per imported doc type.

An imported format is DATA, not code — a .docx template under templates/imported/
plus one entry in templates/imported/manifest.json describing its title, field
contract, provenance and review status. The generic adapter
(src/service/adapters/imported.py) registers every valid entry at start-up, so
adding a format never needs a new pipeline/adapter module.

Entry shape (keyed by doc-type slug):

    {
      "title": "High Court Original Side Summons",
      "status": "pending_review" | "approved",
      "version": 1,
      "template": "<slug>.docx",
      "court_issued": false,
      "fields": [{"key", "kind", "required", "label", "help",
                  "enum_values" (enum only), "sample"}],
      "source": {"kind": "lawe" | "advocate", "ref", "sha256", "imported_on"},
      "review_notes": {"law_updates": [...], "corrections": [...], "uncertain": [...]},
      "approved_by": null, "approved_on": null
    }
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

ROOT = Path(__file__).resolve().parents[2]
IMPORTED_DIR = ROOT / "templates" / "imported"
MANIFEST_PATH = IMPORTED_DIR / "manifest.json"
SPECS_DIR = IMPORTED_DIR / "specs"

# Adapter.template value prefix; render.template_path resolves it to IMPORTED_DIR.
TEMPLATE_PREFIX = "imported/"

FIELD_KINDS = ("string", "date", "int", "bool", "enum", "string_list")
STATUSES = ("pending_review", "approved")
SOURCE_KINDS = ("lawe", "advocate")

SLUG_RE = re.compile(r"^[a-z][a-z0-9_]{2,60}$")
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,60}$")

# Context keys the renderer/sign-off layer owns; a format may not declare them.
RESERVED_KEYS = frozenset({"review_banner", "unverified_marker", "court_issues"})


def empty_manifest() -> Dict[str, Any]:
    return {"version": 1, "doc_types": {}}


def load_manifest(path: Optional[Path] = None) -> Dict[str, Any]:
    """The manifest, or an empty one when the file is absent/unreadable."""
    p = path or MANIFEST_PATH
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return empty_manifest()
    if not isinstance(data, dict) or not isinstance(data.get("doc_types"), dict):
        return empty_manifest()
    return data


def save_manifest(data: Mapping[str, Any], path: Optional[Path] = None) -> None:
    p = path or MANIFEST_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
                 encoding="utf-8")


def validate_entry(slug: str, entry: Mapping[str, Any]) -> List[str]:
    """Every structural problem with one manifest entry (empty list = valid).

    An invalid entry is never registered — the engine logs it and skips it, so a
    hand-edited manifest can't take the service down.
    """
    problems: List[str] = []
    if not SLUG_RE.match(slug or ""):
        problems.append(f"slug {slug!r} must be snake_case, 3-61 chars")
    if not isinstance(entry.get("title"), str) or not entry["title"].strip():
        problems.append("title is required")
    if entry.get("status") not in STATUSES:
        problems.append(f"status must be one of {STATUSES}")
    if not isinstance(entry.get("template"), str) or not entry["template"].endswith(".docx"):
        problems.append("template must be a .docx filename")
    fields = entry.get("fields")
    if not isinstance(fields, list) or not fields:
        problems.append("fields must be a non-empty list")
        return problems
    seen = set()
    for i, f in enumerate(fields):
        where = f"fields[{i}]"
        if not isinstance(f, Mapping):
            problems.append(f"{where} must be an object")
            continue
        key = f.get("key")
        if not isinstance(key, str) or not KEY_RE.match(key):
            problems.append(f"{where}.key {key!r} must be snake_case")
        elif key in RESERVED_KEYS:
            problems.append(f"{where}.key {key!r} is reserved")
        elif key in seen:
            problems.append(f"{where}.key {key!r} is duplicated")
        seen.add(key)
        if f.get("kind") not in FIELD_KINDS:
            problems.append(f"{where}.kind must be one of {FIELD_KINDS}")
        if f.get("kind") == "enum":
            vals = f.get("enum_values")
            if not isinstance(vals, list) or not vals or not all(isinstance(v, str) for v in vals):
                problems.append(f"{where}.enum_values must be a non-empty list of strings")
        if not isinstance(f.get("required"), bool):
            problems.append(f"{where}.required must be true/false")
    return problems


def field_keys(entry: Mapping[str, Any]) -> List[str]:
    return [f["key"] for f in entry.get("fields", []) if isinstance(f, Mapping) and "key" in f]
