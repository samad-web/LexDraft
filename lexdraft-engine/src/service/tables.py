"""Evidence tables in drafted text: a list of documents, index of annexures, list of
dates or summary of admissions is written as pipe rows ("| Sr. No | Date | ... |"),
the first row being the column headings. In the .docx each run of rows is a ruled
Word table; read back for display, every table row is one "| a | b |" line again.
"""

from __future__ import annotations

import re
from typing import Iterator, List, Union

from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

_ROW = re.compile(r"^\s*\|.*\|\s*$")
_RULE = re.compile(r"^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*\|?\s*$")


def is_rule(line: str) -> bool:
    """A Markdown header rule ("|---|---|") — layout only, never a row."""
    return bool(_RULE.match(line))


def is_row(line: str) -> bool:
    """A table row: pipes at both ends, at least two cells, not a rule."""
    return bool(_ROW.match(line)) and not is_rule(line) and len(cells(line)) >= 2


def cells(line: str) -> List[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def row_text(values: List[str]) -> str:
    return "| " + " | ".join(" ".join(v.split()) for v in values) + " |"


def expand(paragraphs: List[str]) -> List[str]:
    """One entry per line for a paragraph that is a table (rows joined by newlines);
    rule lines dropped. Any other paragraph is kept as it is."""
    out: List[str] = []
    for p in paragraphs:
        lines = [l for l in p.split("\n") if l.strip()]
        if len(lines) > 1 and all(is_row(l) or is_rule(l) for l in lines):
            out.extend(l.strip() for l in lines if not is_rule(l))
        elif not is_rule(p):
            out.append(p)
    return out


def runs_of(lines: List[str]) -> List[Union[str, List[List[str]]]]:
    """Lines grouped: two or more consecutive rows become one table (a list of rows,
    each padded or folded to the heading row's width); everything else stays a line.
    A lone row is ordinary text."""
    out: List[Union[str, List[List[str]]]] = []
    i = 0
    while i < len(lines):
        j = i
        while j < len(lines) and is_row(lines[j]):
            j += 1
        if j - i >= 2:
            rows = [cells(l) for l in lines[i:j]]
            width = len(rows[0])
            fitted = []
            for r in rows:
                r = r + [""] * (width - len(r)) if len(r) < width else r[:width - 1] + [" ".join(r[width - 1:])]
                fitted.append(r)
            out.append(fitted)
            i = j
        else:
            out.append(lines[i])
            i += 1
    return out


def _border_all(table: Table) -> None:
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        for k, v in (("val", "single"), ("sz", "4"), ("space", "0"), ("color", "000000")):
            el.set(qn(f"w:{k}"), v)
        borders.append(el)
    table._tbl.tblPr.append(borders)


def add_table(doc, rows: List[List[str]]) -> Table:
    """A ruled table at the end of `doc`: bold heading row repeated on every page,
    rows never split across a page."""
    table = doc.add_table(rows=len(rows), cols=len(rows[0]))
    _border_all(table)
    for r, values in enumerate(rows):
        row = table.rows[r]
        tr_pr = row._tr.get_or_add_trPr()
        tr_pr.append(OxmlElement("w:cantSplit"))
        if r == 0:
            tr_pr.append(OxmlElement("w:tblHeader"))
        for c, value in enumerate(values):
            para = row.cells[c].paragraphs[0]
            para.paragraph_format.space_after = 0
            run = para.add_run(value)
            run.bold = r == 0
    return table


def row_values(row) -> List[str]:
    """A row's cell texts, merged cells counted once."""
    seen, out = set(), []
    for cell in row.cells:
        if id(cell._tc) in seen:
            continue
        seen.add(id(cell._tc))
        out.append(" ".join(cell.text.split()))
    return out


def body_items(doc) -> Iterator[Union[Paragraph, Table]]:
    """Paragraphs and tables of the document body, in reading order."""
    for child in doc.element.body.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, doc)
        elif child.tag == qn("w:tbl"):
            yield Table(child, doc)
