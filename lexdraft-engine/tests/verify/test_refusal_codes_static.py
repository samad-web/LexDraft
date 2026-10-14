"""Static gate: no `_refuse(...)` call anywhere may omit `code=`.

The runtime coverage test (test_refusal_codes_all) drives the catalogued cases;
this one is a belt-and-braces AST scan that catches a code-less refusal even if
the catalogue does not exercise that exact path. Together they enforce: nothing
routes until EVERY refusal has a stable code.
"""

import ast
from pathlib import Path

import pytest

_SRC = Path(__file__).resolve().parents[2] / "src"

# Files that define a `_refuse` helper requiring code= at every call site.
_PIPELINES = sorted((_SRC / "pipelines").glob("*.py"))


@pytest.mark.parametrize("path", _PIPELINES, ids=lambda p: p.name)
def test_every_refuse_call_passes_a_code(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    offenders = []
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "_refuse"):
            if "code" not in {kw.arg for kw in node.keywords}:
                offenders.append(node.lineno)
    assert not offenders, (
        f"{path.name}: _refuse(...) without code= at line(s) {offenders}")
