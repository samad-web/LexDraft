"""Adapter for the registry coding sheet (High Court filing cover)."""

from __future__ import annotations

from ...pipelines import coding_sheet as pipeline
from ...pipelines.coding_sheet import CodingSide
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="coding_sheet", spec="tn-coding",
    title="Registry Coding Sheet",
    build=pipeline.build, template="coding_sheet.docx",
    fields=(
        FieldSpec("side", "enum",
                  enum_values=tuple(s.value for s in CodingSide), to_engine=CodingSide),
        FieldSpec("petitioner_name", "string"),
        FieldSpec("respondent_name", "string"),
        FieldSpec("act_and_provision", "string"),
        FieldSpec("subject_matter", "string"),
        FieldSpec("court_place", "string"),
        FieldSpec("case_type", "string", required=False, default=None),
        FieldSpec("petitioner_counsel", "string", required=False, default=None),
        FieldSpec("respondent_counsel", "string", required=False, default=None),
        FieldSpec("subject_category_code", "string", required=False, default=None),
        FieldSpec("value_of_claim", "string", required=False, default=None),
        FieldSpec("court_fee", "string", required=False, default=None),
        FieldSpec("connected_case", "string", required=False, default=None),
        FieldSpec("lower_court_details", "string", required=False, default=None),
        FieldSpec("in_jail", "bool", required=False, default=False),
        FieldSpec("crime_no", "string", required=False, default=None),
        FieldSpec("police_station", "string", required=False, default=None),
        FieldSpec("is_hcp", "bool", required=False, default=False),
        FieldSpec("detaining_authority", "string", required=False, default=None),
        FieldSpec("order_violated", "string", required=False, default=None),
        FieldSpec("senior_citizen", "bool", required=False, default=False),
    ),
    slots=(),
)

register(ADAPTER)
