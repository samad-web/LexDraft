"""Adapter for the Process Memo (prayer to issue summons/warrant at an address)."""

from __future__ import annotations

from ...pipelines import process_memo as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="process_memo", spec="tn-processmemo",
    title="Process Memo",
    build=pipeline.build, template="process_memo.docx",
    # FILL-IN COURT FORM: every field OPTIONAL so the engine renders the form with
    # blanks instead of 422-ing when a value isn't on record.
    fields=(
        FieldSpec("court_name", "string", required=False, default=""),
        FieldSpec("court_place", "string", required=False, default=""),
        FieldSpec("case_ref", "string", required=False, default=""),
        FieldSpec("case_no", "string", required=False, default=""),
        FieldSpec("case_year", "string", required=False, default=""),
        FieldSpec("petitioner_name", "string", required=False, default=""),
        FieldSpec("respondent_name", "string", required=False, default=""),
        FieldSpec("process_type", "string", required=False, default=""),
        FieldSpec("address_for_service", "string", required=False, default=""),
        FieldSpec("place", "string", required=False, default=""),
        FieldSpec("filing_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
