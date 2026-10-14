"""Adapter for the application for issue of process and deposit of batta."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import process_application as pipeline
from ...pipelines.process_application import Forum, ProcessRow
from . import Adapter, FieldSpec, ListFieldSpec, register


_PROCESS_ROW_ITEM = (
    FieldSpec("nature_of_process", "string"),
    FieldSpec("on_whom", "string"),
    FieldSpec("place_of_service", "string"),
    FieldSpec("distance_miles", "string", required=False, default=None),
    FieldSpec("travelling_allowance", "string", required=False, default=None),
    FieldSpec("subsistence_allowance", "string", required=False, default=None),
    FieldSpec("process_fee", "string", required=False, default=None),
    FieldSpec("remarks", "string", required=False, default=None),
)


def _process_row(kw: Dict[str, Any]) -> ProcessRow:
    return ProcessRow(**kw)


ADAPTER = Adapter(
    doc_type="process_application", spec="tn-process",
    title="Application for Issue of Process",
    build=pipeline.build, template="process_application.docx",
    fields=(
        FieldSpec("forum", "enum",
                  enum_values=tuple(f.value for f in Forum), to_engine=Forum),
        FieldSpec("case_ref", "string"),
        FieldSpec("applicant_name", "string"),
        FieldSpec("applicant_role", "string"),
        ListFieldSpec("rows", _PROCESS_ROW_ITEM, _process_row, min_items=1),
        FieldSpec("place", "string"),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("opposite_party_name", "string", required=False, default=None),
        FieldSpec("value_of_claim", "string", required=False, default=None),
        FieldSpec("court_day", "string", required=False, default=None),
        FieldSpec("process_type", "string", required=False, default=None),
        FieldSpec("service_mode", "string", required=False, default=None),
        FieldSpec("next_hearing_date", "date", required=False, default=None),
        FieldSpec("filing_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
