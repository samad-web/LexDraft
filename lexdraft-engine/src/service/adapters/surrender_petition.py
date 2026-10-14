"""Adapter for the surrender petition (from the pipeline signature)."""

from __future__ import annotations

from ...pipelines import surrender_petition as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="surrender_petition", spec="tn-surrender",
    title="Surrender Petition",
    build=pipeline.build, template="surrender_petition.docx",
    fields=(
        FieldSpec("accused_name", "string"),
        FieldSpec("offence_section", "string"),
        FieldSpec("crime_no", "string"),
        FieldSpec("identification_marks", "string_list"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("accused_address", "string", required=False, default=None),
        FieldSpec("complainant_name", "string", required=False, default=None),
        FieldSpec("state_rep_by", "string", required=False, default=None),
        FieldSpec("police_station", "string", required=False, default=None),
        FieldSpec("petition_date", "date", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
