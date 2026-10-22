"""Formats supplied IN THE REQUEST (a firm's own uploaded format, stored by the API).

The engine holds no per-firm state: the Node API stores each firm's format spec
and sends it with every /v1/format-spec/check and /v1/draft-spec call. The spec
is validated exactly like an imported format (builder.check_spec +
manifest.validate_entry), drafted through the same generic adapter, and its
template is built from the spec on demand (cached by content hash in the temp
dir, so a redeploy or a second engine instance just rebuilds it).
"""

from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, List, Mapping, Tuple

from . import builder
from . import manifest as mf

_CACHE_DIR = Path(tempfile.gettempdir()) / "lexdraft_spec_templates"
_FIELD_KEYS = ("key", "kind", "required", "label", "help", "enum_values", "sample")


def spec_hash(spec: Mapping[str, Any]) -> str:
    material = {k: spec.get(k) for k in ("title", "court_issued", "fields", "blocks")}
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False)
                          .encode("utf-8")).hexdigest()


def entry_for(doc_type: str, spec: Any, *, status: str, source_kind: str = "advocate",
              version: int = 1) -> Tuple[Dict[str, Any], Dict[str, Any], List[str]]:
    """(normalised spec, manifest-style entry, problems) for a request spec."""
    if not isinstance(spec, Mapping):
        return {}, {}, ["spec must be an object"]
    if status not in mf.STATUSES:
        return {}, {}, [f"status must be one of {mf.STATUSES}"]
    s = builder.normalise_spec(copy.deepcopy(dict(spec)))
    s["slug"] = doc_type
    problems = builder.check_spec(s)
    fields = []
    for f in s.get("fields") or []:
        if isinstance(f, Mapping):
            fields.append({k: f[k] for k in _FIELD_KEYS if k in f})
    entry = {
        "title": str(s.get("title") or "").strip(),
        "status": status,
        "version": int(version or 1),
        "template": f"{doc_type}.docx",
        "court_issued": bool(s.get("court_issued")),
        "fields": fields,
        "source": {"kind": source_kind if source_kind in mf.SOURCE_KINDS else "advocate"},
    }
    if not problems:
        problems = mf.validate_entry(doc_type, entry)
    return s, entry, problems


def template_for(spec: Mapping[str, Any]) -> Path:
    """The built template for a (validated) spec, from the content-hash cache."""
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    digest = spec_hash(spec)
    path = _CACHE_DIR / f"{digest}.docx"
    if not path.exists():
        tmp = _CACHE_DIR / f"{digest}.{uuid.uuid4().hex}.tmp.docx"
        builder.build_docx(spec, tmp)
        tmp.replace(path)   # atomic: a concurrent request never reads a half file
    return path
