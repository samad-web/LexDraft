"""Adapter for the urgent-listing petition (s.151 CPC, inherent powers)."""

from __future__ import annotations

from ...pipelines import urgent_petition as pipeline
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="urgent_petition", spec="tn-urgent",
    title="Urgent Petition (s.151 CPC)",
    build=pipeline.build, template="urgent_petition.docx",
    fields=(
        FieldSpec("petitioner_name", "string"),
        FieldSpec("respondent_name", "string"),
        FieldSpec("underlying_application", "string"),
        FieldSpec("orders_prayed", "string"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("petition_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
