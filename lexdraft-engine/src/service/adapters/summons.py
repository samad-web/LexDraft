"""Adapter for the court summons (court-issued instrument)."""

from __future__ import annotations

from ...pipelines import summons as pipeline
from ...pipelines.summons import SummonsKind
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="summons", spec="tn-summons",
    title="Court Summons",
    build=pipeline.build, template="summons.docx",
    fields=(
        FieldSpec("kind", "enum",
                  enum_values=tuple(k.value for k in SummonsKind), to_engine=SummonsKind),
        FieldSpec("case_ref", "string"),
        FieldSpec("plaintiff_name", "string"),
        FieldSpec("defendant_or_witness_name", "string"),
        FieldSpec("place", "string"),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("cause_of_action", "string", required=False, default=None),
        FieldSpec("appearance_date", "date", required=False, default=None),
        FieldSpec("documents_to_produce", "string", required=False, default=None),
        FieldSpec("expenses_tendered", "string", required=False, default=None),
        FieldSpec("claim_amount", "string", required=False, default=None),
        FieldSpec("costs", "string", required=False, default=None),
        FieldSpec("seal_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
