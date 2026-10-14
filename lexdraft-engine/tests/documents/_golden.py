"""Shared render helper for the document golden tests.

Golden documents pin what an advocate actually receives, so they render through
the rule-6 sign-off path: every draft carries the review banner (these fixtures
are never signed off, so the banner is always present), alongside any table
marker the pipeline set. The audit trail is pointed at a throwaway path so the
tests never touch the real one.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from src.components.render import render_to_docx
from src.factsheet import Case, Court, MatterFactSheet, Party, PartyRole
from src.verify import signoff

# A never-written audit path: these fixtures are always drafts (unsigned).
_NO_AUDIT = Path(__file__).parent / "_no_such_audit.jsonl"

# A throwaway fact sheet — only its (matter_id, version) matter here, and since the
# audit path is never written, these goldens are always unsigned drafts.
_SHEET = MatterFactSheet.create(
    court=Court(court_type="district", name="Golden Test Court", state="Tamil Nadu"),
    case=Case(category="C0", document_type="golden"),
    parties=[Party(role=PartyRole.PLAINTIFF, serial=1, name="Golden")],
    created_by="golden",
    created_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
)


def render_golden(template, context: Mapping[str, Any], out_path):
    """Render as a draft (review banner shown) for golden comparison."""
    ctx = signoff.resolve_context(
        context, document="golden", factsheet=_SHEET, audit_path=_NO_AUDIT
    )
    return render_to_docx(template, ctx, out_path)
