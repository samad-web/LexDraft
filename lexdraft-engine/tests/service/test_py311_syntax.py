"""The server image runs Python 3.11: nothing may use syntax added later (local dev runs 3.14)."""

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _fstring_backslash_in_expression(source: str) -> bool:
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.JoinedStr):
            for part in node.values:
                if isinstance(part, ast.FormattedValue):
                    seg = ast.get_source_segment(source, part.value) or ""
                    if "\\" in seg:
                        return True
    return False


def test_no_311_incompatible_fstrings():
    bad = [str(p.relative_to(ROOT)) for p in (ROOT / "src").rglob("*.py")
           if _fstring_backslash_in_expression(p.read_text(encoding="utf8"))]
    assert bad == []


def test_server_image_is_311():
    assert re.search(r"^FROM python:3\.11", (ROOT / "Dockerfile").read_text(), re.M)
