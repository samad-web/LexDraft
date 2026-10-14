"""Adapter for the suit for permanent injunction (DPC book pp.14-16)."""
from __future__ import annotations
from ...pipelines import permanent_injunction as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="permanent_injunction", spec="dpc-14-16",
    title="Suit for permanent injunction", build=pipeline.build,
    template="permanent_injunction.docx",
    fields=(
        FieldSpec("plaintiff_name", "string"),
        FieldSpec("defendant_names", "string_list"),
        FieldSpec("suit_property", "string"),
        FieldSpec("possession_basis", "string"),
        FieldSpec("act_restrained", "string"),
        FieldSpec("threat_narrative", "string", required=False, default=""),
        FieldSpec("cause_of_action_date", "date"),
        FieldSpec("cause_of_action_place", "string"),
        FieldSpec("court_fee", "int"),
        FieldSpec("valuation", "string"),
        FieldSpec("jurisdiction_basis", "string"),
        FieldSpec("filing_date", "date"),
        FieldSpec("place", "string"),
        FieldSpec("plaintiff_parentage", "string", required=False, default=None),
        FieldSpec("plaintiff_address", "string", required=False, default=None),
        FieldSpec("defendant_addresses", "string_list", required=False, default=None),
        FieldSpec("civil_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
    ),
    slots=("threat_narrative",),
)
register(ADAPTER)
