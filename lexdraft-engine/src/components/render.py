"""docxtpl rendering + text extraction helpers for shared components.

Templates are real .docx files under templates/shared/, authored with Jinja-style
placeholders. Output is always editable .docx (never PDF, never plain text).
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, List, Mapping, Union

from docxtpl import DocxTemplate
from docx import Document

# Repo root -> templates/shared
_TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "templates" / "shared"
# Imported formats live apart from the shared set (src/imports/manifest.py).
_IMPORTED_DIR = Path(__file__).resolve().parents[2] / "templates" / "imported"
_IMPORTED_PREFIX = "imported/"


def template_path(name: str) -> Path:
    """Resolve a shared-template filename to its absolute path. An
    'imported/<file>.docx' name resolves under templates/imported/."""
    if name.startswith(_IMPORTED_PREFIX):
        return _IMPORTED_DIR / name[len(_IMPORTED_PREFIX):]
    return _TEMPLATES_DIR / name


def render_to_docx(
    template: Union[str, Path],
    context: Mapping[str, Any],
    out_path: Union[str, Path],
    jinja_env: Any = None,
) -> Path:
    """Render `template` with `context` to a .docx at `out_path`. `jinja_env`
    overrides docxtpl's default environment (blank forms render unknown values
    as fill-in lines)."""
    tpl_path = template if isinstance(template, Path) else template_path(str(template))
    if not Path(tpl_path).exists():
        raise FileNotFoundError(
            f"template not found: {tpl_path}. Build templates first "
            f"(python templates/build_templates.py)."
        )
    doc = DocxTemplate(str(tpl_path))
    # autoescape: docxtpl re-parses with recover=True, so a raw "&" in a value
    # ("Accountant General (A&E)") was silently dropped along with what followed.
    doc.render(dict(context), jinja_env, autoescape=True)
    collapse_doubled_tokens(doc.docx)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(out))
    return out


# A template prints a prefix the value already carries ("S/o {{ father }}" fed
# "S/o Ravi", "20{{ yy }}" fed "2026"). Each pattern matches only the redundant
# FIRST copy, which is deleted; the value's own copy is kept.
_DOUBLED = [
    re.compile(r"\b([SDWC]/o)\.?\s+(?=\1\b)", re.I),
    re.compile(r"\bRs\.?\s*(?=Rs\b)"),
    re.compile(r"\b(Mr|Mrs|Ms|Dr)\b\.?\s+(?=\1\b)", re.I),
    re.compile(r"\bMr\./Ms\.\s+(?=(Mr|Mrs|Ms|Dr)\b)"),
    re.compile(r"\bPolice Station\s+(?=Police Station\b)", re.I),
    re.compile(r"(?:(?<=\bof )|(?<=\bof\t))20(?=20\d\d\b)"),
]


def _paragraphs(container):
    yield from container.paragraphs
    for table in container.tables:
        for row in table.rows:
            for cell in row.cells:
                yield from _paragraphs(cell)


def collapse_doubled_tokens(document) -> None:
    """Delete the doubled prefixes above in every paragraph (body, tables,
    headers, footers), across run boundaries, keeping each run's formatting."""
    parts = [document] + [hf for s in document.sections for hf in (s.header, s.footer)]
    for part in parts:
        for p in _paragraphs(part):
            runs = p.runs
            texts = [r.text for r in runs]
            full = "".join(texts)
            keep = [True] * len(full)
            for rx in _DOUBLED:
                for m in rx.finditer(full):
                    keep[m.start():m.end()] = [False] * (m.end() - m.start())
            if all(keep):
                continue
            pos = 0
            for r, t in zip(runs, texts):
                new = "".join(c for c, k in zip(t, keep[pos:pos + len(t)]) if k)
                pos += len(t)
                if new != t:
                    r.text = new


def extract_text(docx_path: Union[str, Path]) -> str:
    """Extract paragraph text from a .docx, one paragraph per line.

    Deterministic: only the text and its order, which is the legally meaningful
    content golden tests pin. Trailing whitespace per line is stripped; blank
    paragraphs are preserved as empty lines so structure is visible. A table (a list
    of documents, dates or annexures) reads in its place as one "| a | b |" line per
    row, the same lines the Draft page shows.
    """
    from ..service.tables import body_items, row_text, row_values

    lines: List[str] = []
    for item in body_items(Document(str(docx_path))):
        if hasattr(item, "rows"):
            lines += [row_text(row_values(r)) for r in item.rows if any(row_values(r))]
        else:
            lines.append(item.text.rstrip())
    return "\n".join(lines).strip() + "\n"
