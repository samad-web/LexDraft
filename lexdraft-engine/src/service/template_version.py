"""Resolve the identity + version of the template a doc type renders against.

The Node layer records (template_id, template_version) on every draft_render row so
that, once templates are re-authored (Task 3), we can tell which drafts were produced
against the OLD builder-generated templates versus the new hand-authored ones. The
engine is the only component that knows which template file a doc type uses, so it is
the honest source of this fact.

`template_id` is the template filename (stable identity, e.g. "regular_bail.docx").
`template_version` is the highest version recorded for that file in
templates/versions.json — the version currently effective. If a file has no entry
(a freshly scaffolded doc type not yet registered), version resolves to 0, which the
Node side stores verbatim: "rendered against an unversioned template" is itself a
meaningful, queryable state.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, Tuple

_VERSIONS_PATH = Path(__file__).resolve().parents[2] / "templates" / "versions.json"


@lru_cache(maxsize=1)
def _registry() -> Dict[str, int]:
    """Map template filename -> highest recorded version. Cached; the file is a
    committed static registry that only changes on a deploy."""
    try:
        raw = json.loads(_VERSIONS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out: Dict[str, int] = {}
    # Structure: { "shared": { "<file>.docx": [ {version, effective_from, ...}, ... ] } }
    for _group, files in raw.items():
        if not isinstance(files, dict):
            continue
        for filename, entries in files.items():
            if not isinstance(entries, list) or not entries:
                continue
            versions = [e.get("version", 0) for e in entries if isinstance(e, dict)]
            if versions:
                out[filename] = max(versions)
    return out


def resolve(template_filename: str) -> Tuple[str, int]:
    """Return (template_id, template_version) for a template filename.

    template_id is the filename itself (stable across versions). version is the
    highest recorded in versions.json, or 0 when the file is not registered.
    An imported format ('imported/<file>.docx') is versioned by its manifest entry.
    """
    if template_filename.startswith("imported/"):
        from ..imports import manifest as mf
        name = template_filename[len("imported/"):]
        for entry in mf.load_manifest().get("doc_types", {}).values():
            if entry.get("template") == name:
                return template_filename, int(entry.get("version", 0) or 0)
        return template_filename, 0
    return template_filename, _registry().get(template_filename, 0)
