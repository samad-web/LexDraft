"""Adapter for the anticipatory bail application (spec 3.3)."""

from __future__ import annotations

from ...pipelines import anticipatory_bail as pipeline
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="anticipatory_bail", spec="3.3",
    title="Application for anticipatory bail (s.438)", build=pipeline.build,
    template="anticipatory_bail.docx",
    fields=(
        FieldSpec("accused_name", "string"),
        FieldSpec("age", "int"),
        FieldSpec("occupation", "string"),
        FieldSpec("address", "string"),
        FieldSpec("fir_no", "string"),
        FieldSpec("police_station", "string"),
        FieldSpec("district", "string"),
        FieldSpec("sections", "string_list"),
        FieldSpec("offence_date", "date", required=False, default=None),
        FieldSpec("proceeding_start_date", "date", required=False, default=None),
        FieldSpec("is_fresh_action", "bool", required=False, default=False),
        FieldSpec("apprehension_basis", "string"),
        FieldSpec("already_arrested", "bool", required=False, default=False),
        FieldSpec("is_scst_offence", "bool", required=False, default=False),
        FieldSpec("is_transit", "bool", required=False, default=False),
        FieldSpec("prosecution_case", "string", required=False, default=""),
        FieldSpec("place", "string"),
        FieldSpec("accused_parentage", "string", required=False, default=None),
        FieldSpec("bail_court", "string", required=False, default=None),
        FieldSpec("application_date", "date", required=False, default=None),
    ),
    slots=("prosecution_case",),
)

register(ADAPTER)
