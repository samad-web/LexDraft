"""Generic adapter for IMPORTED formats (templates/imported/manifest.json).

One adapter per manifest entry, built from data — no per-format module. The
contract is exactly the hand-written adapters' contract: missing/malformed
required input is a 422 (Adapter.coerce), never a refusal. An imported format
carries no legal hard stops of its own (those are authored in a real pipeline
if the format ever needs them), so build() always generates.

Never shadows a hand-written doc type: an entry whose slug is already
registered is skipped. An invalid entry or a missing template is skipped with
a warning, so a bad import can't take the service down.

Review status:
  * pending_review — NOT served unless LEXDRAFT_IMPORTS_SERVE_PENDING=true (set
    by the local dev launcher, never in production). When served, every draft
    carries an "imported format, not yet approved" marker at the top, in
    addition to the mandatory review banner.
  * approved — served with no marker (still under the normal review banner
    until the document itself is signed off).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Mapping, Optional, Tuple

from ...imports import manifest as mf
from ...verify.refusals import Refusal
from . import Adapter, FieldSpec, _ADAPTERS, register

log = logging.getLogger(__name__)

# An optional fill-in the advocate left empty renders as a visible blank line,
# exactly as on the printed form.
BLANK = "____________"

PENDING_MARKER = (
    "[IMPORTED FORMAT — transcribed automatically from {source}; not yet approved "
    "by an advocate. Check the wording against the original before filing.]"
)

# Slugs registered from the manifest (dump_engine_contract tags them `imported`).
IMPORTED_DOC_TYPES: set = set()
_SAMPLES: Dict[str, Dict[str, Any]] = {}


@dataclass(frozen=True)
class ImportedResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def serve_pending() -> bool:
    """Serve not-yet-approved formats too? Local development only."""
    return os.environ.get("LEXDRAFT_IMPORTS_SERVE_PENDING", "").strip().lower() == "true"


def is_served(entry: Mapping[str, Any]) -> bool:
    return entry.get("status") == "approved" or serve_pending()


def _source_label(entry: Mapping[str, Any]) -> str:
    src = entry.get("source") or {}
    if src.get("kind") == "lawe":
        return "the LAWE forms library"
    return "the advocate's own format"


def _make_build(entry: Mapping[str, Any]):
    fields = list(entry["fields"])
    pending = entry.get("status") != "approved"
    court_issued = bool(entry.get("court_issued", False))
    marker = PENDING_MARKER.format(source=_source_label(entry)) if pending else ""

    def build(**kwargs: Any) -> ImportedResult:
        ctx: Dict[str, Any] = {}
        for f in fields:
            key, kind = f["key"], f["kind"]
            value = kwargs.get(key)
            if isinstance(value, date):
                value = value.isoformat()
            if kind == "bool":
                value = bool(value)
            elif kind == "string_list":
                value = [v for v in (value or []) if str(v).strip()]
            elif value is None or (isinstance(value, str) and not value.strip()):
                value = BLANK
            ctx[key] = value
        ctx["court_issues"] = court_issued
        ctx["unverified_marker"] = marker
        return ImportedResult(refused=False, context=ctx)

    return build


def _field_spec(f: Mapping[str, Any]) -> FieldSpec:
    kind = f["kind"]
    enum_values = tuple(f["enum_values"]) if kind == "enum" else None
    if f["required"]:
        return FieldSpec(f["key"], kind, enum_values=enum_values)
    default: Any = [] if kind == "string_list" else (False if kind == "bool" else None)
    return FieldSpec(f["key"], kind, required=False, default=default, enum_values=enum_values)


def _sample_value(f: Mapping[str, Any]) -> Any:
    """A valid inbound value for one field (manifest `sample`, else a stand-in)."""
    kind, sample = f["kind"], f.get("sample")
    if kind == "bool":
        return str(sample).strip().lower() in ("true", "yes", "1")
    if kind == "int":
        try:
            return int(str(sample).strip())
        except ValueError:
            return 1
    if kind == "date":
        try:
            return date.fromisoformat(str(sample).strip()).isoformat()
        except ValueError:
            return "2026-01-15"
    if kind == "enum":
        vals = f["enum_values"]
        return sample if sample in vals else vals[0]
    if kind == "string_list":
        if isinstance(sample, list) and sample:
            return [str(s) for s in sample]
        return [str(sample)] if sample else ["Sample item"]
    return str(sample).strip() if sample and str(sample).strip() else f"Sample {f['key'].replace('_', ' ')}"


def sample_payload(entry: Mapping[str, Any]) -> Dict[str, Any]:
    return {f["key"]: _sample_value(f) for f in entry["fields"]}


def adapter_for(slug: str, entry: Mapping[str, Any]) -> Adapter:
    """Build (but do not register) the adapter for one manifest entry."""
    src_kind = (entry.get("source") or {}).get("kind", "advocate")
    return Adapter(
        doc_type=slug,
        spec=f"import:{src_kind}:v{entry.get('version', 1)}",
        title=entry["title"].strip(),
        build=_make_build(entry),
        template=mf.TEMPLATE_PREFIX + entry["template"],
        fields=tuple(_field_spec(f) for f in entry["fields"]),
        slots=(),
    )


def register_all(manifest: Optional[Mapping[str, Any]] = None) -> List[str]:
    """Register every valid, served manifest entry. Returns the slugs registered."""
    data = manifest if manifest is not None else mf.load_manifest()
    taken_titles = {a.title for a in _ADAPTERS.values()}
    done: List[str] = []
    for slug, entry in sorted(data.get("doc_types", {}).items()):
        problems = mf.validate_entry(slug, entry)
        if problems:
            log.warning("imported format %s skipped: %s", slug, "; ".join(problems))
            continue
        if not is_served(entry):
            continue
        if slug in _ADAPTERS and slug not in IMPORTED_DOC_TYPES:
            log.warning("imported format %s skipped: slug is a built-in doc type", slug)
            continue
        if entry["title"].strip() in taken_titles and slug not in IMPORTED_DOC_TYPES:
            log.warning("imported format %s skipped: title clashes with a built-in", slug)
            continue
        if not (mf.IMPORTED_DIR / entry["template"]).exists():
            log.warning("imported format %s skipped: template %s missing", slug, entry["template"])
            continue
        register(adapter_for(slug, entry))
        IMPORTED_DOC_TYPES.add(slug)
        _SAMPLES[slug] = sample_payload(entry)
        taken_titles.add(entry["title"].strip())
        done.append(slug)
    return done


def sample_payloads() -> Dict[str, Dict[str, Any]]:
    """slug -> a valid inbound payload, for every registered imported format."""
    return dict(_SAMPLES)


register_all()
