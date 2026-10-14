"""Adapter for the memorandum to furnish sureties (from the pipeline signature)."""

from __future__ import annotations

from ...pipelines import memorandum_furnish_sureties as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="memorandum_furnish_sureties", spec="tn-suretymemo",
    title="Memorandum to Furnish Sureties",
    build=pipeline.build, template="memorandum_furnish_sureties.docx",
    fields=(
        FieldSpec("accused_name", "string"),
        FieldSpec("granting_court", "string"),
        FieldSpec("bail_granted", "bool"),
        FieldSpec("bail_order_ref", "string"),
        FieldSpec("bail_order_date", "date"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("complainant_name", "string", required=False, default=None),
        FieldSpec("memo_date", "date", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
