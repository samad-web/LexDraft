"""Final tidy of a rendered .docx before it is served as the filing copy.

Templates carry blank spacer paragraphs, and an optional section whose condition
is false leaves its own blank behind, so a render can open with a blank line or
show two or three blank lines in a row — visible as large gaps in the filed copy.
And context dates that reach the text as ``date`` objects print as ISO
``yyyy-mm-dd``, which Indian court drafts never use.

This runs on the SERVED document only (the service layer), so the golden tests
that pin raw template rendering are unaffected:

  - leading blank paragraphs are removed and any run of blanks becomes one;
  - ISO dates in body paragraphs become ``dd.mm.yyyy`` (components/date_format).
    Tables are left alone: schedules use their own ``dd-mm-yyyy`` convention.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Union

from docx import Document

_ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def _blank(p) -> bool:
    if p.text.strip():
        return False
    # A paragraph holding only a picture/drawing is not a blank spacer.
    return not p._p.xpath(".//w:drawing | .//w:pict")


_COURT_LINE = re.compile(r"^\s*IN THE COURT OF\s+", re.IGNORECASE)


def court_heading(text: str) -> str:
    """'IN THE COURT OF Judicial Magistrate No. II, Egmore, Chennai (DISTRICT Chennai), '
    -> 'IN THE COURT OF JUDICIAL MAGISTRATE NO. II, EGMORE, CHENNAI'. The templates
    append '(DISTRICT x)' and ', city' after a court name that often already names
    the place; drop what the name already contains, any dangling comma, and set
    the whole heading in capitals."""
    m = re.match(r"^(\s*IN THE COURT OF\s+)(.*?)((?:\s*\(DISTRICT\s+[^)]*\))?)((?:,\s*[^,()]*)?)\s*,?\s*$",
                 text, re.IGNORECASE)
    if not m:
        return text
    head, court, district, city = m.groups()
    low = court.lower()
    d = re.sub(r"^\s*\(DISTRICT\s+|\)$", "", district, flags=re.IGNORECASE).strip()
    c = city.lstrip(", ").strip()
    out = court.strip().rstrip(",")
    if d and d.lower() not in low:
        out += f" (DISTRICT {d})"
    if c and c.lower() not in low and c.lower() != d.lower():
        out += f", {c}"
    return (head + out).upper()


def _fix_court_heading(p) -> None:
    if not _COURT_LINE.match(p.text) or not p.runs:
        return
    fixed = court_heading(p.text)
    if fixed != p.text:
        p.runs[0].text = fixed
        for r in p.runs[1:]:
            r.text = ""


def tidy_docx(path: Union[str, Path]) -> None:
    doc = Document(str(path))
    prev_blank = True  # treat the start as blank so leading blanks are dropped
    for p in list(doc.paragraphs):
        if _blank(p):
            if prev_blank:
                p._p.getparent().remove(p._p)
            prev_blank = True
            continue
        prev_blank = False
        _fix_court_heading(p)
        for run in p.runs:
            if _ISO_DATE.search(run.text):
                run.text = _ISO_DATE.sub(lambda m: f"{m[3]}.{m[2]}.{m[1]}", run.text)
    doc.save(str(path))
