"""An advocate's OWN Word file, opened for editing (import-edit-document).

Only reads: checks the file is a safe, plain .docx and lists what the editor
can't show, so the app can warn. The editable lines come from app._extract_blocks
and edits go back through apply_edits — the same path as engine drafts. No model.
"""

from __future__ import annotations

import io
import zipfile
from typing import List, Optional

from docx.oxml.ns import qn

MAX_UNZIPPED_BYTES = 50 * 1024 * 1024  # zip-bomb guard, checked before parsing

# Pre-Unicode Tamil fonts: text typed in them is Latin letters drawn as Tamil, so
# it reads as garbage once the font is gone (the editor shows plain text).
_LEGACY_TAMIL_FONTS = ("bamini", "vanavil", "kalaham", "elango", "amudham", "shree-tam",
                       "tam-", "tab-", "tsc", "mylai", "senthamil", "sun tommy", "tm-tt")


def check_docx(raw: bytes) -> Optional[str]:
    """None when `raw` is a readable .docx, else an error code."""
    if raw[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return "encrypted_or_doc"  # OLE: a password-protected .docx (or an old .doc)
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        return "not_docx"
    names = set(z.namelist())
    if "word/document.xml" not in names:
        return "not_docx"
    if "word/vbaProject.bin" in names:
        return "macro"
    if sum(i.file_size for i in z.infolist()) > MAX_UNZIPPED_BYTES:
        return "too_large"
    return None


def docx_warnings(doc) -> List[str]:
    """What the editor won't show or change, as codes (the app words them)."""
    body = doc.element.body
    out: List[str] = []

    def has(tag: str) -> bool:
        return next(body.iter(qn(tag)), None) is not None

    if has("w:ins") or has("w:del"):
        out.append("tracked_changes")  # blocking: p.text skips w:ins, so edits would duplicate it
    if has("w:numPr"):
        out.append("auto_numbering")
    if has("w:txbxContent"):
        out.append("text_boxes")
    if has("w:footnoteReference") or has("w:endnoteReference"):
        out.append("footnotes")
    if has("w:drawing") or has("w:pict"):
        out.append("images")
    if any(p.text.strip() for s in doc.sections for p in (*s.header.paragraphs, *s.footer.paragraphs)):
        out.append("header_footer")
    fonts = {(f.get(qn("w:ascii")) or "").lower()
             for root in (doc.element, doc.styles.element) for f in root.iter(qn("w:rFonts"))}
    if any(t in f for f in fonts for t in _LEGACY_TAMIL_FONTS):
        out.append("legacy_tamil_font")
    return out
