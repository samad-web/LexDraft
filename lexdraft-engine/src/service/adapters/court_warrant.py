"""Adapter for the court-issued warrant / order (court-issued instrument)."""

from __future__ import annotations

from ...pipelines import court_warrant as pipeline
from ...pipelines.court_warrant import WarrantKind
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="court_warrant", spec="tn-warrant",
    title="Court Warrant / Order",
    build=pipeline.build, template="court_warrant.docx",
    fields=(
        FieldSpec("kind", "enum",
                  enum_values=tuple(k.value for k in WarrantKind), to_engine=WarrantKind),
        FieldSpec("case_ref", "string"),
        FieldSpec("decree_holder_or_petitioner_name", "string"),
        FieldSpec("judgment_debtor_or_respondent_name", "string"),
        FieldSpec("place", "string"),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("decree_or_order_ref", "string", required=False, default=None),
        FieldSpec("decree_or_order_date", "date", required=False, default=None),
        FieldSpec("property_schedule", "string", required=False, default=None),
        FieldSpec("amount_due", "string", required=False, default=None),
        FieldSpec("restraint_text", "string", required=False, default=None),
        FieldSpec("addressed_to", "string", required=False, default=None),
        FieldSpec("seal_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
