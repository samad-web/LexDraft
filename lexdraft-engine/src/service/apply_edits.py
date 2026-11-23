"""Write an advocate's text edits back INTO an engine-rendered .docx.

The Draft page shows a draft as one text block per non-empty paragraph (see
app._extract_blocks). When the advocate edits that text and downloads, a generic
HTML export would lose the court layout (alignment, headings, tab leaders, page
numbers). Instead, map the edited paragraphs back onto the document's own
paragraphs, in order, and replace only the ones whose text changed — keeping
each paragraph's style, alignment and its first run's formatting.

Same paragraph count (text edited in place): paragraph i gets line i, exactly as
before. Paragraphs added or removed: the lines are aligned with the document
(difflib); an added line clones the format of a neighbouring paragraph (or table
row), a removed line drops its paragraph (or row). None only when nothing can be
mapped — the caller then falls back to its generic export.
"""

from __future__ import annotations

import copy
import difflib
import io
import re
from typing import List, Optional

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

from .tables import add_table, body_items, cells, expand, is_row, paragraph_align, row_text, row_values, runs_of


class _Row:
    """A table row as an edit target: one display line ("| a | b |")."""

    def __init__(self, row, table):
        self.row, self.table = row, table
        self._p = row._tr

    @property
    def text(self) -> str:
        return row_text(row_values(self.row))

    def set(self, text: str) -> None:
        values = cells(text) if is_row(text) else [text.strip()]
        tcs = []
        for cell in self.row.cells:
            if all(cell._tc is not t for t in tcs):
                tcs.append(cell._tc)
        for k, tc in enumerate(tcs):
            value = values[k] if k < len(values) else ""
            if k == len(tcs) - 1 and len(values) > len(tcs):
                value = " ".join(values[k:])  # surplus cells fold into the last
            para = Paragraph(tc.p_lst[0], self.table)
            _set_text(para, value)
            for extra in tc.p_lst[1:]:
                tc.remove(extra)


def _in_range(targets: List[tuple], start: int, end: int) -> List[tuple]:
    """The targets with at least one display line in [start, end]."""
    out, line = [], 0
    for p, n in targets:
        if not (line + n - 1 < start or line > end):
            out.append((p, n))
        line += n
    return out


def _targets(doc) -> List[tuple]:
    """(paragraph or table row, line_count) for every paragraph with text and every
    table row with text, in reading order — each line of a paragraph (soft line
    breaks) and each table row is one display block (see app._extract_blocks)."""
    out = []
    for item in body_items(doc):
        if hasattr(item, "rows"):
            out.extend((_Row(r, item), 1) for r in item.rows if any(row_values(r)))
            continue
        lines = [l for l in item.text.split("\n") if l.strip()]
        if lines:
            out.append((item, len(lines)))
    return out


def apply_edits(docx_bytes: bytes, paragraphs: List[str]) -> Optional[bytes]:
    doc = Document(io.BytesIO(docx_bytes))
    targets = _targets(doc)
    edited = [t.rstrip() for t in paragraphs if t.strip()]
    if sum(n for _, n in targets) != len(edited):
        # Paragraphs added or deleted: line the edit up against the document and
        # clone/remove paragraphs, so the advocate's own layout survives too.
        if not targets or not edited or not _apply_aligned(targets, edited):
            return None
        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()
    i = 0
    for p, n in targets:
        new_text = "\n".join(edited[i:i + n])
        i += n
        old_text = "\n".join(l for l in p.text.split("\n") if l.strip())
        if new_text == old_text.rstrip():
            continue  # untouched paragraph keeps every run exactly as rendered
        if isinstance(p, _Row):
            p.set(new_text)
            continue
        runs = p.runs
        if not runs:
            p.add_run(new_text)
            continue
        runs[0].text = new_text  # python-docx turns \n / \t into breaks / tabs
        for r in runs[1:]:
            r.text = ""
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


_LEADING_NUMBER = re.compile(r"^\s*(?:\d+|[ivxlc]+|[a-z])[.)]\s+", re.IGNORECASE)


def _set_text(p, text: str) -> None:
    runs = p.runs
    if not runs:
        p.add_run(text)
        return
    runs[0].text = text
    for r in runs[1:]:
        r.text = ""


def _auto_numbered(p) -> bool:
    ppr = p._p.pPr
    return ppr is not None and ppr.numPr is not None


def _emphasised(p) -> bool:
    """Bold or underlined lead run — a template sub-heading, not body text."""
    runs = [r for r in p.runs if r.text.strip()]
    return bool(runs) and bool(runs[0].bold or runs[0].underline)


def _is_heading_text(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    caps = bool(letters) and sum(c.isupper() for c in letters) / len(letters) > 0.85
    return caps and len(text) <= 70 and not _LEADING_NUMBER.match(text)


def splice_lines(docx_bytes: bytes, start: int, end: int, paragraphs: List[str]) -> Optional[bytes]:
    """Replace display lines [start, end] (inclusive, the same line indexing as the
    Draft page's blocks) with `paragraphs` — one Word paragraph each — keeping the
    court layout everywhere else. Used to write a COMPOSED body back into the engine
    .docx: the cause title above and the prayer/verification below are untouched.

    Reused paragraphs keep their own style and first-run formatting; extra ones are
    clones of the last paragraph in the range; surplus ones are removed. A paragraph
    Word numbers automatically has any typed "1." prefix stripped so it isn't
    numbered twice. A range edge inside a multi-line paragraph (a field value with a
    newline) takes the whole paragraph, keeping its out-of-range lines as their own
    paragraphs. Returns None when the range is out of bounds — the caller then keeps
    the plain engine draft.
    """
    doc = Document(io.BytesIO(docx_bytes))
    targets = _targets(doc)
    new = [t.strip() for t in paragraphs if t.strip()]
    total = sum(n for _, n in targets)
    if not new or start < 0 or end < start or end >= total:
        return None

    # Map the line range onto whole paragraphs. A table touched by the range is
    # replaced whole: its rows outside the range are carried over as lines.
    picked, head, tail, line = [], [], [], 0
    touched = {id(p.table._tbl) for p, n, in _in_range(targets, start, end) if isinstance(p, _Row)}
    for p, n in targets:
        first, last = line, line + n - 1
        line += n
        in_table = isinstance(p, _Row) and id(p.table._tbl) in touched
        if (last < start or first > end) and not in_table:
            continue
        lines = [l for l in p.text.split("\n") if l.strip()]
        if last < start:
            head += lines
        elif first > end:
            tail += lines
        else:
            if first < start:
                head += lines[:start - first]
            if last > end:
                tail = lines[end - first + 1:] + tail
        picked.append(p)
    if not picked:
        return None
    new = expand(head + new + tail)

    # The body-level elements being replaced, in order (a table row stands for its table).
    def elem(p):
        return p.table._tbl if isinstance(p, _Row) else p._p

    gone = []
    for p in picked:
        if all(elem(p) is not e for e in gone):
            gone.append(elem(p))
    # Blank spacer paragraphs BETWEEN the replaced ones belonged to the old
    # skeleton's layout; left in place they show as gaps inside the new body.
    body = list(doc.element.body.iterchildren())
    first, last = body.index(gone[0]), body.index(gone[-1])
    for el in body[first + 1:last]:
        if all(el is not g for g in gone) and el.tag.endswith("}p") and not "".join(el.itertext()).strip():
            el.getparent().remove(el)

    # Every new paragraph is a clone of a MODEL from the range: body text takes the
    # template's plain body paragraph (the longest un-emphasised one), so a bold
    # sub-heading it happens to land on ("1. Description of the Complainant")
    # never makes the pleading bold; a caps heading line takes a bold one.
    paras = [p for p in picked if not isinstance(p, _Row)]
    plain = [p for p in paras if not _emphasised(p)]
    body_model = max(plain, key=lambda p: len(p.text)) if plain else None
    heading_model = next((p for p in paras if _emphasised(p)), None)
    anchor = gone[0]
    for item in runs_of(new):
        if isinstance(item, list):  # an evidence table
            anchor.addprevious(add_table(doc, item)._tbl)
            continue
        text = item
        is_heading = _is_heading_text(text) and heading_model is not None
        model = heading_model if is_heading else (body_model or (paras[-1] if paras else None))
        if model is None:  # only table rows in the range: a plain paragraph
            fresh = doc.add_paragraph()
            anchor.addprevious(fresh._p)
            _set_text(fresh, text)
            continue
        clone = copy.deepcopy(model._p)
        anchor.addprevious(clone)
        p = Paragraph(clone, model._parent)
        if body_model is None and not is_heading:
            for r in p.runs:  # no plain paragraph to copy: strip the emphasis
                r.bold = None
                r.underline = None
        _set_text(p, _LEADING_NUMBER.sub("", text) if _auto_numbered(p) else text)
    for el in gone:
        el.getparent().remove(el)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ---- added / removed paragraphs ------------------------------------------------

_KEEP_ON_DELETE = (qn("w:sectPr"), qn("w:drawing"), qn("w:pict"), qn("w:bookmarkStart"))


def _lines(p) -> List[str]:
    """A target's display lines, as app._extract_blocks shows them."""
    return [l.rstrip() for l in p.text.split("\n") if l.strip()]


def _apply_aligned(targets: List[tuple], edited: List[str]) -> bool:
    """Write `edited` into the document when its line count differs from the
    document's. Returns False when the edit can't be mapped onto anything."""
    owner: List[int] = []  # display line -> index into targets
    old: List[str] = []
    for t, (p, _) in enumerate(targets):
        for line in _lines(p):
            owner.append(t)
            old.append(line)
    lines: List[List[str]] = [[] for _ in targets]  # new lines kept by each target
    added: List[List[str]] = [[] for _ in range(len(targets) + 1)]  # inserted after target k-1
    sm = difflib.SequenceMatcher(None, old, edited, autojunk=False)
    if sm.ratio() < 0.2:
        return False  # a different document, not an edit of this one
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        paired = min(i2 - i1, j2 - j1) if tag == "replace" else (i2 - i1 if tag == "equal" else 0)
        for k in range(paired):
            lines[owner[i1 + k]].append(edited[j1 + k])
        extra = edited[j1 + paired:j2]
        if extra:
            # after the last line kept in this block, else after the line before it
            last = i1 + paired - 1
            added[owner[last] + 1 if last >= 0 else 0].extend(extra)
    for t in range(len(targets) - 1, -1, -1):
        p, _ = targets[t]
        if added[t + 1]:
            _insert_after(targets, t, added[t + 1])
        if not lines[t]:
            _drop(p)
            continue
        if lines[t] != _lines(p):
            new_text = "\n".join(lines[t])
            p.set(new_text) if isinstance(p, _Row) else _set_text(p, new_text)
    if added[0]:
        _insert_before_first(targets, added[0])
    return True


def _template(targets: List[tuple], t: int):
    """The paragraph whose format an added line after target t takes: t itself,
    unless t is a heading/centred line and the next paragraph is body text."""
    p = targets[t][0]
    if isinstance(p, _Row):
        return p
    nxt = targets[t + 1][0] if t + 1 < len(targets) else None
    heading = _emphasised(p) or paragraph_align(p) == "center"
    if heading and nxt is not None and not isinstance(nxt, _Row) and not _emphasised(nxt):
        return nxt
    return p


def _clone_para(src):
    """A copy of `src`'s paragraph format + first run format, with no content."""
    new = copy.deepcopy(src._p)
    for child in list(new):
        if child.tag != qn("w:pPr"):
            new.remove(child)
    ppr = new.find(qn("w:pPr"))
    if ppr is not None:
        for sect in ppr.findall(qn("w:sectPr")):
            ppr.remove(sect)  # a section break stays with the original only
    run = next((r for r in src.runs if r.text.strip()), None)
    r = Paragraph(new, src._parent).add_run()
    if run is not None and run._r.rPr is not None:
        r._r.insert(0, copy.deepcopy(run._r.rPr))
    return new


def _insert_after(targets: List[tuple], t: int, texts: List[str]) -> None:
    anchor = targets[t][0]
    tpl = _template(targets, t)
    at = anchor._p
    for text in texts:
        if isinstance(tpl, _Row) and is_row(text):
            new = copy.deepcopy(tpl.row._tr)
            at.addnext(new)
            from docx.table import _Row as DocxRow
            _Row(DocxRow(new, tpl.table), tpl.table).set(text)
        else:
            if isinstance(tpl, _Row):  # plain text after a table: a body paragraph
                body_p = next((q for q, _ in targets if not isinstance(q, _Row)), None)
                new = _clone_para(body_p) if body_p is not None else OxmlElement("w:p")
                at = tpl.table._tbl
            else:
                new = _clone_para(tpl)
            at.addnext(new)
            _set_text(Paragraph(new, anchor._parent if not isinstance(anchor, _Row) else tpl.table._parent), text)
        at = new


def _insert_before_first(targets: List[tuple], texts: List[str]) -> None:
    first = targets[0][0]
    el = first.table._tbl if isinstance(first, _Row) else first._p
    body_p = next((q for q, _ in targets if not isinstance(q, _Row)), None)
    for text in texts:
        new = _clone_para(body_p) if body_p is not None else OxmlElement("w:p")
        el.addprevious(new)
        _set_text(Paragraph(new, el.getparent()), text)


def _drop(p) -> None:
    """Remove a deleted paragraph / row. A paragraph that also holds a section
    break, an image or a bookmark keeps its element and only loses its text."""
    if isinstance(p, _Row):
        tbl = p.table._tbl
        tbl.remove(p._p)
        if tbl.find(qn("w:tr")) is None:
            tbl.getparent().remove(tbl)
        return
    el = p._p
    if any(el.find(".//" + tag) is not None for tag in _KEEP_ON_DELETE):
        for r in p.runs:
            if r._r.find(qn("w:drawing")) is None and r._r.find(qn("w:pict")) is None:
                r.text = ""
        return
    el.getparent().remove(el)
