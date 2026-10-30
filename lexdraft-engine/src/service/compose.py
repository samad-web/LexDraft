"""Compose a court-format .docx from plain drafted text.

When the engine's own checks would block a "Draft now", the Node app drafts the
document with Claude (text, one paragraph per line). That text must still reach
the advocate as a proper filing-style Word/PDF — not a "working copy" — so this
lays it out in the house court style (docs/template-authoring-guide.md): A4,
1.5" left binding margin, Carlito body / Caladea headings, "Page X of Y", and
the usual court-document shapes recognised line by line:

  * the court line / document heading      -> centred, bold
  * VERSUS / AND between the parties        -> centred
  * "... PETITIONER" party designations     -> right-aligned
  * section headings (PRAYER, VERIFICATION, MOST RESPECTFULLY SHOWETH, …)
                                            -> centred, bold
  * numbered paragraphs ("1.", "2)")        -> justified (numbers kept as typed)
  * signature / designation lines           -> right-aligned
  * other body text                         -> justified with a first-line indent

Text is written literally (no template syntax), then tidied like every served
document (blank-line runs collapsed, ISO dates -> dd.mm.yyyy).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import List

from docx import Document

from ..imports.builder import _add_block, _page_setup
from .tidy import tidy_docx

_COURT = re.compile(r"^\s*(IN THE\b|BEFORE THE\b|BEFORE\s+THE\s+HON)", re.IGNORECASE)
_VERSUS = re.compile(r"^\s*(VERSUS|VS\.?|V/S\.?|AND|-?\s*VS\s*-?)\s*$", re.IGNORECASE)
_PARTY = re.compile(
    r"(\.{2,}|…)\s*(PETITIONERS?|RESPONDENTS?|PLAINTIFFS?|DEFENDANTS?|APPELLANTS?|"
    r"COMPLAINANTS?|ACCUSED|APPLICANTS?|CAVEATORS?|OPPOSITE PART(Y|IES)|DEPONENT)\b",
    re.IGNORECASE,
)
_SECTION = re.compile(
    r"^\s*(PRAYER|VERIFICATION|MOST RESPECTFULLY SHOWETH|FACTS OF THE CASE|GROUNDS|"
    r"JURISDICTION|LIMITATION|COURT FEE|VALUATION|SCHEDULE|LIST OF DOCUMENTS|"
    r"AFFIDAVIT|DECLARATION|INTERIM PRAYER|CAUSE OF ACTION|IN THE MATTER OF)\b[\s:.\-A-Z]*$",
    re.IGNORECASE,
)
_CASE_NO = re.compile(r"\bNo\.?\s*[\[\d_]", re.IGNORECASE)
_SUBITEM = re.compile(r"^\s*\((?:[a-z]|[ivx]{1,4}|\d{1,2})\)\s+", re.IGNORECASE)
_BRACKET_ONLY = re.compile(r"^\s*\[[^\]]+\]\s*$")  # e.g. "[Petition No., if any]"
_NUMBERED = re.compile(r"^\s*(\d{1,3}|[ivxlc]{1,6}|[a-z])[.)]\s+", re.IGNORECASE)
_SIGNATURE = re.compile(
    r"^\s*(counsel for|advocate for|through counsel|petitioner\s*$|respondent\s*$|"
    r"plaintiff\s*$|defendant\s*$|deponent\s*$|signature|\(signature)",
    re.IGNORECASE,
)


def _is_caps(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(c.isupper() for c in letters) / len(letters) > 0.85


def classify(lines: List[str]) -> List[dict]:
    """Block style for each line (see module docstring)."""
    blocks: List[dict] = []
    seen_body = False
    for i, raw in enumerate(lines):
        text = raw.strip()
        if not text:
            blocks.append({"style": "blank", "text": ""})
            continue
        if not seen_body and _COURT.match(text):
            style = "title" if not blocks else "heading"
        elif _VERSUS.match(text):
            style = "center"
        elif _PARTY.search(text):
            style = "right"
        elif _SECTION.match(text) and len(text) <= 60:
            style = "heading"
        elif _SUBITEM.match(text):
            style = "left"  # "(a) …" / "(ii) …" sub-items: all laid out alike
        elif _NUMBERED.match(text):
            style, seen_body = "para", True
        elif _SIGNATURE.match(text) and len(text) <= 60:
            style = "signature"
        elif not seen_body and (_CASE_NO.search(text) or _BRACKET_ONLY.match(text)) and len(text) <= 90:
            style = "center"  # case number line: "H.M.O.P. No. __ of 20__"
        elif not seen_body and _is_caps(text):
            # cause-title lines: short ones centred, the long document title bold
            style = "center" if len(text) <= 60 else "heading"
        elif not seen_body and i + 1 < len(lines) and _PARTY.search(lines[i + 1]):
            style = "left"  # a party's description, just above "... PETITIONER"
        elif len(text) <= 60 and not text.endswith("."):
            style = "left"
        else:
            style, seen_body = "para", True
        # a numbered paragraph keeps its typed number: plain justified text,
        # never Word auto-numbering (which would number it twice)
        blocks.append({"style": style, "text": text, "bold": style in ("title", "heading")})
    return blocks


def compose_docx(lines: List[str], out_path: Path) -> Path:
    doc = Document()
    _page_setup(doc)
    for block in classify(lines):
        # literal text: neutralise any brace pairs so nothing reads as template syntax
        block["text"] = block["text"].replace("{{", "{ {").replace("}}", "} }")
        _add_block(doc, block)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out_path))
    tidy_docx(out_path)
    return out_path
