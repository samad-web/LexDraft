"""VERIFY table registry loader. Deterministic. No LLM.

Each VERIFY-marked reference table lives in its own JSON file under
`verify/tables/<name>.json`, carrying:

    name         the registry key (matches the filename stem).
    description  one line on what the table is.
    source       { "act": ..., "section": ... } — where the values come from.
    values       the data itself (shape is table-specific; see the schema note
                 on each file's loader below).
    verified     bool — has an advocate signed the values off?
    reviewed_by  reviewer name (empty until reviewed).
    reviewed_on  ISO date of review (empty until reviewed).

Modules load their tables from here at import instead of hard-coding literals.
The single source of truth for "is this settled?" is the file's `verified` flag.

The UNVERIFIED MARKER generalises the MACT pattern: `marker_for(*names)` returns
the visible marker string if ANY named table is unverified, else "". A pipeline
that consumes a VERIFY table sets `context["unverified_marker"]` from it; the
template renders the marker inline. Flipping `verified` true in the JSON removes
the marker with no other code change.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional

# Repo-root/verify/tables — src/verify/tables.py -> parents[2] is the repo root.
_TABLES_DIR = Path(__file__).resolve().parents[2] / "verify" / "tables"

# The one visible marker string, shared by every consuming document. (MACT used
# this exact string before generalisation; kept identical so goldens are stable.)
UNVERIFIED_MARKER = "[figures unverified — pending advocate review]"

_REQUIRED_KEYS = {"name", "description", "source", "values", "verified",
                  "reviewed_by", "reviewed_on"}


class VerifyRegistryError(RuntimeError):
    """A registry file is missing, malformed, or internally inconsistent."""


@dataclass(frozen=True)
class VerifyTable:
    name: str
    description: str
    source: Dict[str, Any]
    values: Any
    verified: bool
    reviewed_by: str
    reviewed_on: str

    @property
    def source_label(self) -> str:
        """Human 'Act, section' string for review packs and notes."""
        act = str(self.source.get("act", "")).strip()
        section = str(self.source.get("section", "")).strip()
        if act and section:
            return f"{act}, {section}"
        return act or section or "(source unspecified)"


# Cache keyed by table name. Registry files are read once per process; the cache
# is cleared by `reload()` (tests that write temp registries use it).
_cache: Dict[str, VerifyTable] = {}
_lock = threading.Lock()


def _path_for(name: str) -> Path:
    return _TABLES_DIR / f"{name}.json"


def _load_file(name: str) -> VerifyTable:
    path = _path_for(name)
    if not path.exists():
        raise VerifyRegistryError(
            f"VERIFY table {name!r} not found at {path}. Registry files live under "
            f"verify/tables/ — one JSON file per table."
        )
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise VerifyRegistryError(f"VERIFY table {name!r} is not valid JSON: {exc}")

    missing = _REQUIRED_KEYS - set(raw)
    if missing:
        raise VerifyRegistryError(
            f"VERIFY table {name!r} is missing required keys: "
            f"{', '.join(sorted(missing))}"
        )
    if raw["name"] != name:
        raise VerifyRegistryError(
            f"VERIFY table file {path.name} declares name {raw['name']!r}; "
            f"the filename stem is {name!r} — they must match."
        )
    if not isinstance(raw["verified"], bool):
        raise VerifyRegistryError(
            f"VERIFY table {name!r}: 'verified' must be a JSON boolean, got "
            f"{type(raw['verified']).__name__}."
        )
    # A verified table must record who reviewed it and when — an unsigned
    # 'verified: true' is exactly the failure mode this registry exists to prevent.
    if raw["verified"] and not (str(raw["reviewed_by"]).strip()
                                and str(raw["reviewed_on"]).strip()):
        raise VerifyRegistryError(
            f"VERIFY table {name!r} is marked verified but has no reviewed_by / "
            f"reviewed_on. A sign-off must be attributable and dated."
        )
    return VerifyTable(
        name=raw["name"],
        description=raw["description"],
        source=dict(raw["source"]),
        values=raw["values"],
        verified=bool(raw["verified"]),
        reviewed_by=str(raw["reviewed_by"]),
        reviewed_on=str(raw["reviewed_on"]),
    )


def get(name: str) -> VerifyTable:
    """Load (and cache) the VERIFY table `name`."""
    cached = _cache.get(name)
    if cached is not None:
        return cached
    with _lock:
        cached = _cache.get(name)
        if cached is None:
            cached = _load_file(name)
            _cache[name] = cached
    return cached


def values(name: str) -> Any:
    """The raw values of table `name` (its `values` block)."""
    return get(name).values


def is_verified(name: str) -> bool:
    """Whether table `name` has been advocate-verified."""
    return get(name).verified


def marker_for(*names: str) -> str:
    """The unverified marker if ANY named table is unverified, else "".

    This is the generalised MACT marker: a document consuming several VERIFY
    tables shows the marker until every one of them is signed off.
    """
    for name in names:
        if not is_verified(name):
            return UNVERIFIED_MARKER
    return ""


def all_tables() -> List[VerifyTable]:
    """Every registered table, sorted by name. Used by the review-pack builder."""
    return [get(p.stem) for p in sorted(_TABLES_DIR.glob("*.json"))]


def reload() -> None:
    """Drop the cache so the next access re-reads from disk."""
    with _lock:
        _cache.clear()


def tables_dir() -> Path:
    return _TABLES_DIR


def section_a() -> str:
    """Render Section A of the advocate review pack (Markdown) from the registry.

    Section A is the VERIFY-table review: every reference table, its source (Act
    and section), and its current sign-off state. Generated from verify/tables/,
    so the advocate always reviews the current values.
    """
    tables = all_tables()
    verified = sum(1 for t in tables if t.verified)

    out: List[str] = []
    out.append("# Section A — VERIFY Reference Tables")
    out.append("")
    out.append(
        f"Generated from `verify/tables/` — {len(tables)} tables "
        f"({verified} verified, {len(tables) - verified} pending). Every document "
        f"consuming an unverified table renders with the '{UNVERIFIED_MARKER}' "
        f"marker; verifying the table (set `verified: true` with your name and the "
        f"date in the JSON) removes the marker with no code change."
    )
    out.append("")
    out.append("| Table | Source (Act, section) | Verified |")
    out.append("|---|---|---|")
    for t in tables:
        tick = f"yes ({t.reviewed_by}, {t.reviewed_on})" if t.verified else "PENDING"
        out.append(f"| {t.name} — {t.description.split('.')[0]} "
                   f"| {t.source_label} | {tick} |")
    out.append("")
    return "\n".join(out)
