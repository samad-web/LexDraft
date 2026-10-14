"""CI gate: every {{ ... }} / {% ... %} placeholder must live in a SINGLE run.

THE HAZARD
    When you type `{{ accused.name }}` into Word, Word frequently splits it across
    several <w:r> runs — a spell-check squiggle, an rsid boundary, or an autocorrect
    edit inserts a run break mid-placeholder. The document.xml then reads like:
        <w:r><w:t>{{ accused.</w:t></w:r><w:r><w:t>name }}</w:t></w:r>
    docxtpl matches placeholders on the CONCATENATED text of a paragraph in most
    cases, but a split that lands across certain boundaries (or inside the `{{`/`}}`
    delimiters themselves) makes docxtpl silently fail to substitute — the tag ships
    verbatim into the filed document. That is a catastrophic, invisible defect.

WHAT THIS CHECKS
    For every .docx under templates/shared/, in word/document.xml AND every header/
    footer part, reconstruct each paragraph's runs and flag any `{{`, `}}`, `{%`, `%}`
    delimiter, or a `{{ name }}` token, that is broken across a </w:t>…<w:t> boundary
    (i.e. spans more than one run). Reports the offending file + the surrounding text.

    Exit 0 = all placeholders are single-run. Exit 1 = at least one is split.

FIXING A FAILURE
    In Word, select the whole placeholder, delete it, and retype it in one motion —
    or (reliable) use Find & Replace to insert it, which writes it as one run. See
    docs/template-authoring-guide.md.

Usage:  python tools/check_placeholder_integrity.py
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path
from typing import List, Tuple
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / "templates" / "shared"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# The delimiter fragments that must never straddle a run boundary. If any of these
# appears in the concatenated paragraph text but NOT wholly within a single run, the
# placeholder is split.
DELIMS = ("{{", "}}", "{%", "%}")


def _paragraph_runs_text(p: ET.Element) -> List[str]:
    """Ordered list of each run's visible text in a <w:p>. One entry per <w:r> that
    has a <w:t> (empty string for runs without text is skipped — they cannot host a
    delimiter)."""
    runs: List[str] = []
    for r in p.iter(f"{W}r"):
        texts = [t.text or "" for t in r.iter(f"{W}t")]
        joined = "".join(texts)
        if joined:
            runs.append(joined)
    return runs


def _find_splits(runs: List[str]) -> List[str]:
    """Return a list of human-readable descriptions of any placeholder delimiter that
    is split across the given runs.

    Strategy: the concatenated text tells us a placeholder EXISTS; we then verify each
    delimiter occurrence is fully contained in one run. A delimiter that appears in the
    concatenation but in no single run is split across the boundary.
    """
    full = "".join(runs)
    problems: List[str] = []
    if not any(d in full for d in DELIMS):
        return problems

    # Count delimiter occurrences in the concatenation vs. the sum over single runs.
    for d in DELIMS:
        total = full.count(d)
        in_runs = sum(run.count(d) for run in runs)
        if total > in_runs:
            # At least one occurrence of this delimiter is split across runs.
            ctx = _context_around(full, d)
            problems.append(
                f"delimiter {d!r} split across runs (found {total} in text, "
                f"only {in_runs} intact) near: …{ctx}…"
            )

    # Also catch a full {{ name }} whose OPEN and CLOSE are in different runs even when
    # each delimiter is individually intact (e.g. "{{" ends run A, "name }}" is run B).
    # We do this by checking that for every "{{" there is a "}}" in the SAME run after
    # it. This is a heuristic but catches the common single-token split.
    for i, run in enumerate(runs):
        opens = run.count("{{")
        closes = run.count("}}")
        if opens != closes:
            # An unbalanced run means a {{ or }} pairs with one in a neighbour run.
            ctx = _context_around("".join(runs), "{{")
            problems.append(
                f"a {{{{ … }}}} token spans a run boundary (run #{i} is unbalanced) "
                f"near: …{ctx}…"
            )
            break
    return problems


def _context_around(text: str, needle: str, width: int = 30) -> str:
    idx = text.find(needle)
    if idx < 0:
        return text[:width]
    start = max(0, idx - width // 2)
    return text[start : idx + len(needle) + width // 2].replace("\n", " ")


def _check_docx(path: Path) -> List[str]:
    problems: List[str] = []
    with zipfile.ZipFile(path) as z:
        parts = [
            n for n in z.namelist()
            if n == "word/document.xml"
            or re.match(r"word/(header|footer)\d*\.xml", n)
        ]
        for part in parts:
            try:
                tree = ET.fromstring(z.read(part))
            except ET.ParseError as exc:
                problems.append(f"{path.name}::{part}: XML parse error: {exc}")
                continue
            for p in tree.iter(f"{W}p"):
                runs = _paragraph_runs_text(p)
                for desc in _find_splits(runs):
                    problems.append(f"{path.name}::{part}: {desc}")
    return problems


def main() -> int:
    templates = sorted(SHARED.glob("*.docx"))
    if not templates:
        print("placeholder-integrity: no templates found", file=sys.stderr)
        return 1
    all_problems: List[str] = []
    for t in templates:
        all_problems.extend(_check_docx(t))
    if all_problems:
        print("placeholder-integrity FAILED — split placeholders found:", file=sys.stderr)
        for p in all_problems:
            print(f"  {p}", file=sys.stderr)
        print(
            "\nFix: retype each placeholder in one motion, or insert via Find & Replace "
            "(see docs/template-authoring-guide.md).",
            file=sys.stderr,
        )
        return 1
    print(f"placeholder-integrity OK: {len(templates)} templates, all placeholders single-run.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
