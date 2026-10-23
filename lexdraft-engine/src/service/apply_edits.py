"""Write an advocate's text edits back INTO an engine-rendered .docx.

The Draft page shows a draft as one text block per non-empty paragraph (see
app._extract_blocks). When the advocate edits that text and downloads, a generic
HTML export would lose the court layout (alignment, headings, tab leaders, page
numbers). Instead, map the edited paragraphs back onto the document's own
paragraphs, in order, and replace only the ones whose text changed — keeping
each paragraph's style, alignment and its first run's formatting.

Only possible when the paragraph count still matches (the advocate edited text
in place, e.g. filled in blanks). If paragraphs were added or removed, return
None and let the caller fall back to its generic export.
"""

from __future__ import annotations

import io
from typing import List, Optional

from docx import Document


def _targets(doc) -> List[tuple]:
    """(paragraph, line_count) for every paragraph with text, in reading order —
    each line of a paragraph (soft line breaks) is one display block."""
    out = []
    for p in doc.paragraphs:
        lines = [l for l in p.text.split("\n") if l.strip()]
        if lines:
            out.append((p, len(lines)))
    return out


def apply_edits(docx_bytes: bytes, paragraphs: List[str]) -> Optional[bytes]:
    doc = Document(io.BytesIO(docx_bytes))
    targets = _targets(doc)
    edited = [t.rstrip() for t in paragraphs if t.strip()]
    if sum(n for _, n in targets) != len(edited):
        return None
    i = 0
    for p, n in targets:
        new_text = "\n".join(edited[i:i + n])
        i += n
        old_text = "\n".join(l for l in p.text.split("\n") if l.strip())
        if new_text == old_text.rstrip():
            continue  # untouched paragraph keeps every run exactly as rendered
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
