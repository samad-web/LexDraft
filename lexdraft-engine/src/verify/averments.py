"""Mandatory-averment registry loader + review-pack Section B generator.

Each document type's mandatory / advisory averments live in their own JSON file
under `verify/averments/<document>.json`:

    document   the document key (matches the filename stem).
    spec       the spec label (e.g. "7.2").
    title      the human document name.
    entries    a list, each:
        averment     the averment text (what must be pleaded).
        kind         "mandatory" | "advisory".
        source       { "type": "statute" | "case_law" | "local_practice",
                       "ref": ... } — where the requirement comes from.
        verified     bool — has an advocate confirmed this averment belongs?
        reviewed_by  reviewer name (empty until reviewed).
        reviewed_on  ISO date of review (empty until reviewed).

`section_b()` renders the review pack's Section B from these files, so the
advocate always reviews the CURRENT state of the mandatory-averment lists — never
a hand-maintained copy that has drifted from the code.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

_AVERMENTS_DIR = Path(__file__).resolve().parents[2] / "verify" / "averments"

_VALID_KINDS = {"mandatory", "advisory"}
_VALID_SOURCE_TYPES = {"statute", "case_law", "local_practice"}


class AvermentRegistryError(RuntimeError):
    """An averment registry file is missing, malformed, or inconsistent."""


@dataclass(frozen=True)
class Averment:
    averment: str
    kind: str
    source_type: str
    source_ref: str
    verified: bool
    reviewed_by: str
    reviewed_on: str

    @property
    def source_label(self) -> str:
        pretty = {"statute": "Statute", "case_law": "Case law",
                  "local_practice": "Local practice"}[self.source_type]
        return f"{pretty}: {self.source_ref}" if self.source_ref else pretty


@dataclass(frozen=True)
class DocumentAverments:
    document: str
    spec: str
    title: str
    entries: List[Averment]

    def mandatory(self) -> List[Averment]:
        return [e for e in self.entries if e.kind == "mandatory"]

    def advisory(self) -> List[Averment]:
        return [e for e in self.entries if e.kind == "advisory"]


def _load_file(path: Path) -> DocumentAverments:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AvermentRegistryError(f"{path.name} is not valid JSON: {exc}")

    for key in ("document", "spec", "title", "entries"):
        if key not in raw:
            raise AvermentRegistryError(f"{path.name} is missing key {key!r}")
    if raw["document"] != path.stem:
        raise AvermentRegistryError(
            f"{path.name} declares document {raw['document']!r}; the filename stem "
            f"is {path.stem!r} — they must match."
        )

    entries: List[Averment] = []
    for i, e in enumerate(raw["entries"]):
        missing = ({"averment", "kind", "source", "verified",
                    "reviewed_by", "reviewed_on"} - set(e))
        if missing:
            raise AvermentRegistryError(
                f"{path.name} entry {i} missing keys: {', '.join(sorted(missing))}"
            )
        if e["kind"] not in _VALID_KINDS:
            raise AvermentRegistryError(
                f"{path.name} entry {i}: kind must be one of {_VALID_KINDS}, got "
                f"{e['kind']!r}"
            )
        src = e["source"]
        if src.get("type") not in _VALID_SOURCE_TYPES:
            raise AvermentRegistryError(
                f"{path.name} entry {i}: source.type must be one of "
                f"{_VALID_SOURCE_TYPES}, got {src.get('type')!r}"
            )
        if not isinstance(e["verified"], bool):
            raise AvermentRegistryError(
                f"{path.name} entry {i}: 'verified' must be a JSON boolean"
            )
        if e["verified"] and not (str(e["reviewed_by"]).strip()
                                  and str(e["reviewed_on"]).strip()):
            raise AvermentRegistryError(
                f"{path.name} entry {i} is verified but has no reviewed_by / "
                f"reviewed_on. A sign-off must be attributable and dated."
            )
        entries.append(Averment(
            averment=e["averment"],
            kind=e["kind"],
            source_type=src["type"],
            source_ref=str(src.get("ref", "")),
            verified=bool(e["verified"]),
            reviewed_by=str(e["reviewed_by"]),
            reviewed_on=str(e["reviewed_on"]),
        ))
    return DocumentAverments(document=raw["document"], spec=raw["spec"],
                             title=raw["title"], entries=entries)


def get(document: str) -> DocumentAverments:
    path = _AVERMENTS_DIR / f"{document}.json"
    if not path.exists():
        raise AvermentRegistryError(
            f"averment registry for {document!r} not found at {path}."
        )
    return _load_file(path)


def all_documents() -> List[DocumentAverments]:
    """Every document's averments, sorted by spec then document."""
    docs = [_load_file(p) for p in _AVERMENTS_DIR.glob("*.json")]
    return sorted(docs, key=lambda d: (_spec_key(d.spec), d.document))


def averments_dir() -> Path:
    return _AVERMENTS_DIR


def _spec_key(spec: str):
    # "7.2" -> (7, 2) so specs order naturally; non-numeric falls to the end.
    parts = []
    for chunk in str(spec).replace("-", ".").split("."):
        parts.append((0, int(chunk)) if chunk.isdigit() else (1, chunk))
    return parts


# --------------------------------------------------------------------------
# Review-pack Section B — generated from the registry, never hand-maintained.
# --------------------------------------------------------------------------

def section_b() -> str:
    """Render Section B of the advocate review pack (Markdown) from the registry.

    Section B is the mandatory-averment review: for each document, every
    mandatory (and advisory) averment, its source, and its current sign-off
    state. Because it is generated from the same files the pipelines encode
    against, the advocate always reviews the CURRENT state.
    """
    docs = all_documents()
    total = sum(len(d.entries) for d in docs)
    verified = sum(1 for d in docs for e in d.entries if e.verified)

    out: List[str] = []
    out.append("# Section B — Mandatory Averments")
    out.append("")
    out.append(
        f"Generated from `verify/averments/` — {len(docs)} documents, {total} "
        f"averments ({verified} verified, {total - verified} pending). "
        f"For each averment, confirm it belongs, correct the text or source if "
        f"needed, then mark it verified (set `verified: true` with your name and "
        f"the date in the JSON)."
    )
    out.append("")

    for d in docs:
        out.append(f"## {d.spec} — {d.title}")
        out.append("")
        out.append("| # | Averment | Kind | Source | Verified |")
        out.append("|---|---|---|---|---|")
        for i, e in enumerate(d.entries, start=1):
            tick = "yes" if e.verified else "PENDING"
            averment = e.averment.replace("|", "\\|")
            source = e.source_label.replace("|", "\\|")
            out.append(f"| {i} | {averment} | {e.kind} | {source} | {tick} |")
        out.append("")

    return "\n".join(out)
