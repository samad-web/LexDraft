"""Adapter for the Recall Petition (Petition u/s 70(2) Cr.P.C. to recall warrant)."""

from __future__ import annotations

from ...pipelines import recall_petition as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="recall_petition", spec="tn-recallpet",
    title="Recall Petition (s.70(2) CrPC)",
    build=pipeline.build, template="recall_petition.docx",
    # FILL-IN COURT FORM: every field OPTIONAL so the engine renders the form with
    # blanks instead of 422-ing when a value isn't on record.
    fields=(
        FieldSpec("court_name", "string", required=False, default=""),
        FieldSpec("court_place", "string", required=False, default=""),
        FieldSpec("case_ref", "string", required=False, default=""),
        FieldSpec("cc_no", "string", required=False, default=""),
        FieldSpec("accused_name", "string", required=False, default=""),
        FieldSpec("complainant_name", "string", required=False, default=""),
        FieldSpec("warrant_type", "string", required=False, default=""),
        FieldSpec("place", "string", required=False, default=""),
        FieldSpec("filing_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
