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
from ...verify.signoff import SLOT_PATTERN
from . import Adapter, FieldSpec, ListFieldSpec, register


def _variant(v: str) -> Variant:
    return Variant(v)


def _forum(v: str) -> jur.Forum:
    return jur.Forum(v)


_BASES = tuple(b.value for b in jur.TerritorialBasis)


def _territorial(vs: List[str]) -> List[Any]:
    # A draft-now "[… to be provided]" gap stays text so the clause renders with a
    # visible gap; anything else must be a real basis (ValueError -> 422).
    return [v if SLOT_PATTERN.search(v) else jur.TerritorialBasis(v) for v in vs]


def _ack(kw: Dict[str, Any]) -> Acknowledgement:
    # s.18 Limitation Act: only a written, signed acknowledgement extends time. The
    # free-text description is for the pleading, not the limitation rule (passing it
    # through crashed the engine with a TypeError).
    return Acknowledgement(date=kw["date"], in_writing=bool(kw.get("in_writing")),
                           signed=bool(kw.get("signed")))


_TRANCHE_ITEM = (
    FieldSpec("amount", "int"),
    FieldSpec("from_date", "date"),
)


def _tranche(kw: Dict[str, Any]):
    # a sum and the date interest on it runs from (e.g. an invoice and its date)
    return (kw["amount"], kw["from_date"])


_ACK_ITEM = (
    FieldSpec("date", "date"),
    FieldSpec("description", "string", required=False, default=""),
    FieldSpec("in_writing", "bool", required=False, default=False),
    FieldSpec("signed", "bool", required=False, default=False),
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
        # invoices (interest_tranches) fix the cause of action when none is given
        FieldSpec("cause_of_action_date", "date", required=False, default=None,
                  requires_when=lambda p: not p.get("interest_tranches")),
        FieldSpec("cause_of_action_place", "string"),
        FieldSpec("forum", "enum",
                  enum_values=tuple(f.value for f in jur.Forum), to_engine=_forum),
        FieldSpec("territorial_bases", "string_list", enum_values=_BASES, to_engine=_territorial),
        FieldSpec("principal", "int"),
        FieldSpec("interest_amount", "int", required=False, default=None),
        FieldSpec("claimed_total", "int", required=False, default=None),
        FieldSpec("interest_rate", "int"),   # percent; int is fine for the form
        FieldSpec("interest_is_contractual", "bool"),
        FieldSpec("interest_document_ref", "string", required=False, default=None),
        # derived from claim_for / the cause of action when not given
        FieldSpec("limitation_article", "string", required=False, default=None),
        FieldSpec("limitation_trigger_date", "date", required=False, default=None),
        FieldSpec("claim_for", "enum", required=False, default=None,
                  enum_values=tuple(pipeline.CLAIM_ARTICLES) + ("other",)),
        FieldSpec("legal_notice_served_date", "date", required=False, default=None),
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
        # who signs for a firm/company plaintiff, e.g. "Mr. G. Venkatesh, managing partner"
        FieldSpec("plaintiff_representative", "string", required=False, default=None),
        FieldSpec("plaintiff_address", "string", required=False, default=None),
        FieldSpec("defendant_addresses", "string_list", required=False, default=None),
        FieldSpec("civil_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
        FieldSpec("interest_from_date", "date", required=False, default=None),
        ListFieldSpec("interest_tranches", _TRANCHE_ITEM, _tranche, required=False),
    ),
    slots=("transaction_narrative", "performance_narrative", "default_narrative",
           "notice_narrative"),
)

register(ADAPTER)
