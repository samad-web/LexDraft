"""Adapter for the memorandum to furnish sureties (from the pipeline signature)."""

from __future__ import annotations

from ...pipelines import memorandum_furnish_sureties as pipeline
from . import Adapter, FieldSpec, ListFieldSpec, register
from .surety_memo import SURETY_ITEM

ADAPTER = Adapter(
    doc_type="memorandum_furnish_sureties", spec="tn-suretymemo",
    title="Memorandum to Furnish Sureties",
    build=pipeline.build, template="memorandum_furnish_sureties.docx",
    fields=(
        FieldSpec("accused_name", "string"),
        FieldSpec("granting_court", "string"),
        FieldSpec("bail_granted", "bool"),
        FieldSpec("bail_order_date", "date"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("complainant_name", "string", required=False, default=None),
        FieldSpec("memo_date", "date", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("bail_order_ref", "string", required=False, default=""),
        FieldSpec("court_name", "string", required=False, default=None),
        FieldSpec("police_station", "string", required=False, default=None),
        ListFieldSpec("sureties", SURETY_ITEM, dict, min_items=0, required=False),
        FieldSpec("accused_gender", "string", required=False, default=None),
        FieldSpec("filing_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
