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
    Tables are left alone: schedules use their own ``dd-mm-yyyy`` convention;
    body ``dd-mm-yyyy`` dates become ``dd.mm.yyyy`` too;
  - rupee figures get Indian grouping (``Rs. 1000000`` -> ``Rs. 10,00,000``);
  - a numbered paragraph sequence that skips a number because an optional
    paragraph rendered empty is closed up (5, 7, 8 -> 5, 6, 7).
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


_DASH_DATE = re.compile(r"\b(\d{2})-(\d{2})-(\d{4})\b")
_RUPEES = re.compile(r"((?:Rs\.?|₹|INR)\s?)(\d{4,})(?![\d,])")
_PARA_NO = re.compile(r"^(\s*)(\d{1,3})(\.\s)")


def indian_grouping(digits: str) -> str:
    """'1000000' -> '10,00,000' (lakh / crore grouping)."""
    if len(digits) <= 3:
        return digits
    head, tail = digits[:-3], digits[-3:]
    pairs = []
    while len(head) > 2:
        pairs.insert(0, head[-2:])
        head = head[:-2]
    return ",".join([head, *pairs, tail])


def _renumber(p, state: dict) -> None:
    """Close a gap left by an optional paragraph that rendered empty (5, 7 -> 5, 6).
    Only a small forward jump in a running sequence is closed; a restart at 1
    (a list of documents) or any other jump is left as the template typed it."""
    runs = p.runs
    m = _PARA_NO.match(runs[0].text) if runs else None
    if not m:
        return
    n, expected = int(m[2]), state.get("next")
    if n == 1 or expected is None:
        state["next"] = n + 1
    elif expected < n <= expected + 2:
        runs[0].text = f"{m[1]}{expected}{m[3]}" + runs[0].text[m.end():]
        state["next"] = expected + 1
    else:
        state["next"] = n + 1


def tidy_docx(path: Union[str, Path]) -> None:
    doc = Document(str(path))
    prev_blank = True  # treat the start as blank so leading blanks are dropped
    numbering: dict = {}
    for p in list(doc.paragraphs):
        if _blank(p):
            if prev_blank:
                p._p.getparent().remove(p._p)
            prev_blank = True
            continue
        prev_blank = False
        _fix_court_heading(p)
        _renumber(p, numbering)
        for run in p.runs:
            text = run.text
            text = _ISO_DATE.sub(lambda m: f"{m[3]}.{m[2]}.{m[1]}", text)
            text = _DASH_DATE.sub(lambda m: f"{m[1]}.{m[2]}.{m[3]}", text)
            text = _RUPEES.sub(lambda m: m[1] + indian_grouping(m[2]), text)
            if text != run.text:
                run.text = text
    doc.save(str(path))
