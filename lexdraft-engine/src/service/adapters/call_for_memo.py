"""Adapter for the Call for Memo (memo to release applied-for certified copies)."""

from __future__ import annotations

from ...pipelines import call_for_memo as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="call_for_memo", spec="tn-callmemo",
    title="Call for Memo",
    build=pipeline.build, template="call_for_memo.docx",
    # FILL-IN COURT FORM: every field OPTIONAL so the engine renders the form with
    # blanks/placeholders instead of 422-ing when a value isn't on record.
    fields=(
        FieldSpec("court_name", "string", required=False, default=""),
        FieldSpec("court_place", "string", required=False, default=""),
        FieldSpec("pincode", "string", required=False, default=""),
        FieldSpec("case_ref", "string", required=False, default=""),
        FieldSpec("cc_no", "string", required=False, default=""),
        FieldSpec("cc_year", "string", required=False, default=""),
        FieldSpec("complainant_name", "string", required=False, default=""),
        FieldSpec("accused_name", "string", required=False, default=""),
        # The numbered list of documents applied for (one item per line).
        FieldSpec("documents", "string_list", required=False, default=()),
        FieldSpec("purpose", "string", required=False, default=""),
        FieldSpec("court_fee", "string", required=False, default=""),
        FieldSpec("place", "string", required=False, default=""),
        FieldSpec("filing_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
