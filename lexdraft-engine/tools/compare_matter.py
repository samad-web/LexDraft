"""Comparison harness — diff the engine's output against a really-filed document.

MEASUREMENT ONLY. Runs a real closed matter (fact sheet hand-filled from the
firm's files) through the engine and diffs our generated document against what was
actually filed. It never auto-fixes anything.

The diff is BY SECTION, not by line — cause title, party blocks, each numbered
paragraph, prayer, verification. Line diffs on legal prose are noise.

Each section difference is classified:
  MISSING     in the filed document, not in ours  <- the important column: a gap
              in our mandatory-averment lists.
  EXTRA       in ours, not filed.
  DIFFERENT   both present, materially different wording.
  FORMATTING  cosmetic only (whitespace / case / punctuation).

Per-matter summaries and a cross-matter aggregate make a recurring MISSING item
visible as a pattern.

Usage:
    python tools/compare_matter.py --ours generated.docx --filed filed.docx \
        --matter-id M-2021-045
    python tools/compare_matter.py --report matters.json   # aggregate several
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Sequence


# --------------------------------------------------------------------------
# Section model.
# --------------------------------------------------------------------------

class SectionKind(Enum):
    CAUSE_TITLE = "cause_title"
    PARTY_BLOCK = "party_block"
    PARAGRAPH = "paragraph"
    PRAYER = "prayer"
    VERIFICATION = "verification"
    OTHER = "other"


@dataclass(frozen=True)
class Section:
    kind: SectionKind
    text: str
    key: Optional[str] = None   # paragraph number for PARAGRAPH sections


_PARA_RE = re.compile(r"^\s*(\d+[A-Z]?)\.\s+(.*)$")
_CAUSE_TITLE_RE = re.compile(r"IN THE (COURT|HIGH COURT|SUPREME COURT)", re.I)
_PRAYER_RE = re.compile(r"^\s*(?:\d+[A-Z]?\.\s*)?(PRAYER|MAIN PRAYER|JOINT PRAYER)\b", re.I)
_VERIFICATION_RE = re.compile(r"^\s*(VERIFICATION|I,\s.+\bverify\b)", re.I)


def parse_sections(text: str) -> List[Section]:
    """Parse a document's plain text into ordered sections.

    Deterministic and heuristic: numbered paragraphs by their leading 'n.'; the
    cause title, prayer and verification by their recognisable markers. Anything
    else is OTHER. This matches how our own documents render and is tolerant of a
    filed document's slightly different surface form.
    """
    sections: List[Section] = []
    lines = [ln.rstrip() for ln in text.splitlines()]

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue

        # Cause title (first recognisable heading block).
        if _CAUSE_TITLE_RE.search(line) and not sections:
            block = [line]
            i += 1
            # absorb following non-numbered heading lines until the first para
            while i < n and not _PARA_RE.match(lines[i]) and lines[i].strip():
                block.append(lines[i])
                i += 1
            sections.append(Section(kind=SectionKind.CAUSE_TITLE,
                                    text="\n".join(block).strip()))
            continue

        # Verification.
        if _VERIFICATION_RE.match(line):
            block = [line]
            i += 1
            while i < n and lines[i].strip():
                block.append(lines[i])
                i += 1
            sections.append(Section(kind=SectionKind.VERIFICATION,
                                    text="\n".join(block).strip()))
            continue

        # Numbered paragraph (prayer paragraphs are captured as PRAYER).
        m = _PARA_RE.match(line)
        if m:
            key, body = m.group(1), m.group(2)
            kind = (SectionKind.PRAYER if _PRAYER_RE.match(line)
                    else SectionKind.PARAGRAPH)
            # absorb continuation lines (sub-bullets / wrapped text), but STOP at
            # a standalone PRAYER / VERIFICATION marker so they parse separately.
            block = [body]
            i += 1
            while i < n and lines[i].strip() and not _PARA_RE.match(lines[i]) \
                    and not _VERIFICATION_RE.match(lines[i]) \
                    and not _PRAYER_RE.match(lines[i]):
                block.append(lines[i].strip())
                i += 1
            sections.append(Section(kind=kind, key=key,
                                    text=" ".join(block).strip()))
            continue

        # Standalone PRAYER without a number.
        if _PRAYER_RE.match(line):
            sections.append(Section(kind=SectionKind.PRAYER, text=line.strip()))
            i += 1
            continue

        sections.append(Section(kind=SectionKind.OTHER, text=line.strip()))
        i += 1

    return sections


# --------------------------------------------------------------------------
# Classification.
# --------------------------------------------------------------------------

class Classification(Enum):
    MISSING = "missing"        # in filed, not ours
    EXTRA = "extra"            # in ours, not filed
    DIFFERENT = "different"    # both present, materially different
    FORMATTING = "formatting"  # cosmetic only
    SAME = "same"              # identical after normalisation (no action)


@dataclass(frozen=True)
class SectionDiff:
    classification: Classification
    kind: SectionKind
    key: Optional[str]
    ours_text: Optional[str]
    filed_text: Optional[str]


def _normalise(text: str) -> str:
    """Fold whitespace, case and terminal punctuation so a FORMATTING-only
    difference does not read as material."""
    t = text.lower().strip()
    t = re.sub(r"\s+", " ", t)
    t = re.sub(r"[.,;:]+$", "", t)
    return t


def _align_key(sec: Section) -> str:
    """The identity a section is matched on across the two documents."""
    if sec.kind is SectionKind.PARAGRAPH:
        return f"paragraph:{sec.key}"
    return sec.kind.value


def diff_sections(*, ours: Sequence[Section], filed: Sequence[Section]) -> List[SectionDiff]:
    """Section-align ours vs filed and classify each. Order follows the filed
    document, then any EXTRA sections from ours."""
    ours_by = {_align_key(s): s for s in ours}
    filed_by = {_align_key(s): s for s in filed}

    diffs: List[SectionDiff] = []

    for key, f in filed_by.items():
        o = ours_by.get(key)
        if o is None:
            diffs.append(SectionDiff(Classification.MISSING, f.kind, f.key,
                                     None, f.text))
        elif _normalise(o.text) == _normalise(f.text):
            if o.text == f.text:
                diffs.append(SectionDiff(Classification.SAME, f.kind, f.key,
                                         o.text, f.text))
            else:
                diffs.append(SectionDiff(Classification.FORMATTING, f.kind, f.key,
                                         o.text, f.text))
        else:
            diffs.append(SectionDiff(Classification.DIFFERENT, f.kind, f.key,
                                     o.text, f.text))

    for key, o in ours_by.items():
        if key not in filed_by:
            diffs.append(SectionDiff(Classification.EXTRA, o.kind, o.key,
                                     o.text, None))

    return diffs


# --------------------------------------------------------------------------
# Per-matter + aggregate.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class MatterSummary:
    matter_id: str
    diffs: List[SectionDiff]
    counts: Dict[Classification, int]


def compare_matter(*, matter_id: str, ours: Sequence[Section],
                   filed: Sequence[Section]) -> MatterSummary:
    diffs = diff_sections(ours=ours, filed=filed)
    counts = {c: 0 for c in Classification}
    for d in diffs:
        counts[d.classification] += 1
    return MatterSummary(matter_id=matter_id, diffs=diffs, counts=counts)


@dataclass(frozen=True)
class RecurringItem:
    text: str
    count: int
    matters: List[str]


@dataclass(frozen=True)
class Aggregate:
    matters: List[MatterSummary]

    @property
    def matter_count(self) -> int:
        return len(self.matters)

    def total(self, classification: Classification) -> int:
        return sum(m.counts.get(classification, 0) for m in self.matters)

    def recurring_missing(self) -> List[RecurringItem]:
        """MISSING items grouped by normalised text, most-recurring first — so a
        gap that appears across several matters is visible as a pattern."""
        buckets: Dict[str, List[str]] = {}
        display: Dict[str, str] = {}
        for m in self.matters:
            for d in m.diffs:
                if d.classification is Classification.MISSING and d.filed_text:
                    norm = _normalise(d.filed_text)
                    buckets.setdefault(norm, []).append(m.matter_id)
                    display.setdefault(norm, d.filed_text)
        items = [
            RecurringItem(text=display[k], count=len(v), matters=v)
            for k, v in buckets.items()
        ]
        items.sort(key=lambda it: (-it.count, it.text))
        return items


def aggregate(matters: Sequence[MatterSummary]) -> Aggregate:
    return Aggregate(matters=list(matters))


# --------------------------------------------------------------------------
# Report rendering (text).
# --------------------------------------------------------------------------

def render_matter_report(summary: MatterSummary) -> str:
    lines = [f"=== Matter {summary.matter_id} ===",
             "  " + "  ".join(f"{c.value.upper()}={summary.counts[c]}"
                              for c in Classification if c is not Classification.SAME)]
    missing = [d for d in summary.diffs if d.classification is Classification.MISSING]
    if missing:
        lines.append("  MISSING (pleaded by advocate, not generated):")
        for d in missing:
            where = f"para {d.key}" if d.key else d.kind.value
            lines.append(f"    - [{where}] {d.filed_text}")
    return "\n".join(lines)


def render_aggregate_report(agg: Aggregate) -> str:
    lines = [f"=== AGGREGATE over {agg.matter_count} matter(s) ===",
             f"  total MISSING={agg.total(Classification.MISSING)}  "
             f"EXTRA={agg.total(Classification.EXTRA)}  "
             f"DIFFERENT={agg.total(Classification.DIFFERENT)}  "
             f"FORMATTING={agg.total(Classification.FORMATTING)}",
             "  Recurring MISSING (pattern across matters):"]
    for it in agg.recurring_missing():
        if it.count > 1:
            lines.append(f"    x{it.count} [{', '.join(it.matters)}] {it.text}")
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Document reading + CLI.
# --------------------------------------------------------------------------

def read_document_text(path: str) -> str:
    """Extract plain text from a .docx or .pdf filed document."""
    lower = path.lower()
    if lower.endswith(".docx"):
        from docx import Document
        return "\n".join(p.text for p in Document(path).paragraphs)
    if lower.endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise RuntimeError(
                "reading a filed PDF needs pypdf; install it, or supply the filed "
                "document as .docx"
            ) from exc
        reader = PdfReader(path)
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    raise ValueError(f"unsupported filed-document format: {path}")


def _main(argv: Optional[Sequence[str]] = None) -> int:  # pragma: no cover - CLI
    import argparse
    import json

    ap = argparse.ArgumentParser(description="Compare engine output vs a filed document")
    ap.add_argument("--ours", help="our generated .docx")
    ap.add_argument("--filed", help="the actually-filed .docx or .pdf")
    ap.add_argument("--matter-id", default="matter")
    ap.add_argument("--report", help="JSON list of {matter_id, ours, filed} to aggregate")
    args = ap.parse_args(argv)

    summaries: List[MatterSummary] = []
    if args.report:
        with open(args.report, encoding="utf-8") as fh:
            data = json.load(fh)
            # accept either a bare list or the manifest shape {"matters": [...]}.
            entries = data["matters"] if isinstance(data, dict) else data
            for entry in entries:
                if str(entry.get("matter_id", "")).startswith("_"):
                    continue  # skip comment/placeholder entries
                o = parse_sections(read_document_text(entry["ours"]))
                f = parse_sections(read_document_text(entry["filed"]))
                summaries.append(compare_matter(matter_id=entry["matter_id"],
                                                ours=o, filed=f))
    elif args.ours and args.filed:
        o = parse_sections(read_document_text(args.ours))
        f = parse_sections(read_document_text(args.filed))
        summaries.append(compare_matter(matter_id=args.matter_id, ours=o, filed=f))
    else:
        ap.error("supply --ours and --filed, or --report")

    for s in summaries:
        print(render_matter_report(s))
        print()
    print(render_aggregate_report(aggregate(summaries)))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(_main())
