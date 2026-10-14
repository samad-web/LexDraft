"""Indian-practice date formatting for filed documents.

Court drafts in India write dates as ``dd.mm.yyyy`` in the narrative body and
``dd-mm-yyyy`` in tabular schedules (List of Documents, etc.) — never ISO
``yyyy-mm-dd``. These helpers centralise that convention so every pipeline
renders dates the way an advocate expects, instead of leaking Python's default
``date.isoformat()`` into the document.
"""

from __future__ import annotations

from datetime import date
from typing import Optional, Union

_DateLike = Union[date, str, None]


def _coerce(value: _DateLike) -> Optional[date]:
    if value is None or isinstance(value, date):
        return value
    # Accept ISO strings that the adapter/context may already carry.
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def body_date(value: _DateLike) -> str:
    """Narrative-body format: ``dd.mm.yyyy`` (e.g. 25.04.2026)."""
    d = _coerce(value)
    if d is None:
        return "" if value is None else str(value)
    return f"{d.day:02d}.{d.month:02d}.{d.year:04d}"


def table_date(value: _DateLike) -> str:
    """Tabular / schedule format: ``dd-mm-yyyy`` (e.g. 25-04-2026)."""
    d = _coerce(value)
    if d is None:
        return "" if value is None else str(value)
    return f"{d.day:02d}-{d.month:02d}-{d.year:04d}"
