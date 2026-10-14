"""CI gate: no docxtpl placeholder may be split across run boundaries.

Wraps tools/check_placeholder_integrity.py so it runs in the engine's pytest suite.
A split {{ ... }} makes docxtpl silently ship the tag verbatim into a filed document
— the check must be green before any hand-authored template lands. Also asserts the
checker actually CATCHES a split (a guard against the check silently no-op'ing).
"""
from __future__ import annotations

import shutil
import sys
import zipfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from tools import check_placeholder_integrity as cpi  # noqa: E402


def test_all_committed_placeholders_are_single_run():
    assert cpi.main() == 0, (
        "a docxtpl placeholder is split across runs — see output above. Retype it in "
        "one motion or insert via Find & Replace (docs/template-authoring-guide.md)."
    )


def test_checker_catches_a_split(tmp_path, monkeypatch):
    """Inject a split placeholder into a copy of a real template and confirm the
    checker flags it. Without this, a regression that makes the checker inert would
    pass silently — the worst kind of green."""
    import re

    src = _ROOT / "templates" / "shared" / "regular_bail.docx"
    shared = tmp_path / "templates" / "shared"
    shared.mkdir(parents=True)
    dst = shared / "regular_bail.docx"
    shutil.copy(src, dst)

    with zipfile.ZipFile(dst) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    doc = parts["word/document.xml"].decode("utf-8")
    m = re.search(
        r"(<w:r[^>]*>(?:(?!</w:r>).)*?<w:t[^>]*>)([^<]*\{\{ [^}]+ \}\}[^<]*)(</w:t>.*?</w:r>)",
        doc, re.S,
    )
    assert m, "fixture setup: no single-run token to split"
    pre, txt, post = m.group(1), m.group(2), m.group(3)
    i = txt.index("{{") + 2
    replacement = f'{pre}{txt[:i]}</w:t></w:r><w:r><w:t xml:space="preserve">{txt[i:]}{post}'
    doc2 = doc[: m.start()] + replacement + doc[m.end():]
    parts["word/document.xml"] = doc2.encode("utf-8")
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for n, b in parts.items():
            z.writestr(n, b)

    monkeypatch.setattr(cpi, "SHARED", shared)
    assert cpi.main() == 1, "checker failed to catch a deliberately split placeholder"
