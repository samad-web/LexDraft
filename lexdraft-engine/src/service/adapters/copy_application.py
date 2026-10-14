"""Adapter for the application for certified copies of documents."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import copy_application as pipeline
from ...pipelines.copy_application import CopyDocRow, Forum
from . import Adapter, FieldSpec, ListFieldSpec, register


_COPY_DOC_ITEM = (
    FieldSpec("description", "string"),
    FieldSpec("date_of_document", "string", required=False, default=None),
    FieldSpec("date_of_filing", "string", required=False, default=None),
    FieldSpec("number_of_copies", "string", required=False, default=None),
    FieldSpec("order_under_which", "string", required=False, default=None),
    FieldSpec("pending_or_final", "string", required=False, default=None),
)


def _copy_doc(kw: Dict[str, Any]) -> CopyDocRow:
    return CopyDocRow(**kw)


ADAPTER = Adapter(
    doc_type="copy_application", spec="tn-copy",
    title="Application for Certified Copies",
    build=pipeline.build, template="copy_application.docx",
    # FILL-IN COURT FORM: every field OPTIONAL so the engine renders the form with
    # blanks/placeholders instead of 422-ing when a value isn't on record.
    fields=(
        FieldSpec("forum", "enum",
                  enum_values=tuple(f.value for f in Forum), to_engine=Forum,
                  required=False, default=Forum.CITY_CIVIL),
        FieldSpec("case_ref", "string", required=False, default=""),
        FieldSpec("applicant_name", "string", required=False, default=""),
        FieldSpec("applicant_role", "string", required=False, default=""),
        ListFieldSpec("documents", _COPY_DOC_ITEM, _copy_doc, min_items=0,
                      required=False),
        FieldSpec("place", "string", required=False, default=""),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("court_name", "string", required=False, default=None),
        FieldSpec("opposite_party_name", "string", required=False, default=None),
        FieldSpec("opposite_role", "string", required=False, default=None),
        FieldSpec("addressed_to", "string", required=False, default=None),
        FieldSpec("rule_ref", "string", required=False, default=None),
        FieldSpec("filing_date", "date", required=False, default=None),
        FieldSpec("os_no", "string", required=False, default=None),
        FieldSpec("os_year", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
