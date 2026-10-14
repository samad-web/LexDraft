"""Adapter for the Batta Witness application (issue of process + witness batta)."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import batta_witness as pipeline
from ...pipelines.batta_witness import BattaRow
from . import Adapter, FieldSpec, ListFieldSpec, register


# One schedule row — every column optional (fill-in form).
_BATTA_ROW_ITEM = (
    FieldSpec("nature_of_process", "string", required=False, default=""),
    FieldSpec("person_description", "string", required=False, default=""),
    FieldSpec("place_of_service", "string", required=False, default=""),
    FieldSpec("distance_miles", "string", required=False, default=""),
    FieldSpec("travelling_allowance", "string", required=False, default=""),
    FieldSpec("class_of_allowance", "string", required=False, default=""),
    FieldSpec("amount", "string", required=False, default=""),
    FieldSpec("for_how_many_days", "string", required=False, default=""),
    FieldSpec("process_fees", "string", required=False, default=""),
    FieldSpec("remarks", "string", required=False, default=""),
)


def _batta_row(kw: Dict[str, Any]) -> BattaRow:
    return BattaRow(**kw)


ADAPTER = Adapter(
    doc_type="batta_witness", spec="tn-batta",
    title="Batta Witness (Issue of Process)",
    build=pipeline.build, template="batta_witness.docx",
    # FILL-IN COURT FORM: every field OPTIONAL so the engine renders the form with
    # blanks/placeholders instead of 422-ing when a value isn't on record.
    fields=(
        FieldSpec("court_name", "string", required=False, default=""),
        FieldSpec("court_place", "string", required=False, default=""),
        FieldSpec("case_ref", "string", required=False, default=""),
        FieldSpec("os_no", "string", required=False, default=""),
        FieldSpec("os_year", "string", required=False, default=""),
        FieldSpec("plaintiff_name", "string", required=False, default=""),
        FieldSpec("defendant_name", "string", required=False, default=""),
        FieldSpec("applicant_role", "string", required=False, default=""),
        FieldSpec("value_of_claim", "string", required=False, default=""),
        FieldSpec("court_day", "string", required=False, default=""),
        ListFieldSpec("rows", _BATTA_ROW_ITEM, _batta_row, min_items=0,
                      required=False),
        FieldSpec("place", "string", required=False, default=""),
        FieldSpec("filing_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
