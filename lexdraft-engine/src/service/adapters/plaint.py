"""Adapter for the plaint for money recovery (spec 4.1).

Maps the inbound form JSON to src.pipelines.plaint.build kwargs. Enum fields
(variant, forum, territorial bases) coerce inbound strings to the engine's Enum
members via to_engine. The narrative paragraphs (transaction/performance/default/
notice) are declared as slots, merged by the app after coercion.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ...pipelines import plaint as pipeline
from ...pipelines.plaint import Variant
from ...rules import jurisdiction as jur
from ...rules.limitation import Acknowledgement
from . import Adapter, FieldSpec, ListFieldSpec, register


def _variant(v: str) -> Variant:
    return Variant(v)


def _forum(v: str) -> jur.Forum:
    return jur.Forum(v)


def _territorial(vs: List[str]) -> List[jur.TerritorialBasis]:
    return [jur.TerritorialBasis(v) for v in vs]


def _ack(kw: Dict[str, Any]) -> Acknowledgement:
    return Acknowledgement(**kw)


_ACK_ITEM = (
    FieldSpec("date", "date"),
    FieldSpec("description", "string", required=False, default=""),
)


ADAPTER = Adapter(
    doc_type="plaint",
    spec="4.1",
    title="Plaint for recovery of money",
    build=pipeline.build,
    template="plaint.docx",
    fields=(
        FieldSpec("plaintiff_name", "string"),
        FieldSpec("defendant_names", "string_list"),
        FieldSpec("variant", "enum",
                  enum_values=tuple(v.value for v in Variant), to_engine=_variant),
        FieldSpec("cause_of_action_date", "date"),
        FieldSpec("cause_of_action_place", "string"),
        FieldSpec("forum", "enum",
                  enum_values=tuple(f.value for f in jur.Forum), to_engine=_forum),
        FieldSpec("territorial_bases", "string_list", to_engine=_territorial),
        FieldSpec("principal", "int"),
        FieldSpec("interest_amount", "int"),
        FieldSpec("claimed_total", "int"),
        FieldSpec("interest_rate", "int"),   # percent; int is fine for the form
        FieldSpec("interest_is_contractual", "bool"),
        FieldSpec("interest_document_ref", "string", required=False, default=None),
        FieldSpec("limitation_article", "string"),
        FieldSpec("limitation_trigger_date", "date"),
        ListFieldSpec("acknowledgements", _ACK_ITEM, _ack, required=False),
        FieldSpec("filing_date", "date"),
        FieldSpec("is_government_defendant", "bool", required=False, default=False),
        FieldSpec("s80_notice_ref", "string", required=False, default=None),
        FieldSpec("is_commercial_suit", "bool", required=False, default=False),
        FieldSpec("s12a_ref", "string", required=False, default=None),
        # narrative slots
        FieldSpec("transaction_narrative", "string", required=False, default=""),
        FieldSpec("performance_narrative", "string", required=False, default=""),
        FieldSpec("default_narrative", "string", required=False, default=""),
        FieldSpec("notice_narrative", "string", required=False, default=""),
        FieldSpec("place", "string"),
        # optional cause-title header fields
        FieldSpec("plaintiff_parentage", "string", required=False, default=None),
        FieldSpec("plaintiff_address", "string", required=False, default=None),
        FieldSpec("defendant_addresses", "string_list", required=False, default=None),
        FieldSpec("civil_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
    ),
    slots=("transaction_narrative", "performance_narrative", "default_narrative",
           "notice_narrative"),
)

register(ADAPTER)
