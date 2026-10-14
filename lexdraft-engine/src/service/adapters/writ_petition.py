"""Adapter for the writ petition (Civil) under Art.226 (spec 5.1).

The engine works with rich `Party` objects; the inbound form supplies the minimum
(petitioner name; respondents as {serial, name, is_authority}). A thin build
wrapper constructs the Party objects so the inbound contract stays flat/simple.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ...pipelines import writ_petition as pipeline
from ...pipelines.writ_petition import Party, WritType
from ...factsheet import PartyRole
from . import Adapter, FieldSpec, ListFieldSpec, register


def _petitioner_party(name: str) -> Party:
    return Party(role=PartyRole.PETITIONER, serial=1, name=name)


def _respondent_party(kw: Dict[str, Any]) -> Party:
    return Party(role=PartyRole.RESPONDENT, serial=int(kw.get("serial", 1)),
                 name=kw["name"], is_authority=bool(kw.get("is_authority", False)))


_RESPONDENT_ITEM = (
    FieldSpec("serial", "int", required=False, default=1),
    FieldSpec("name", "string"),
    FieldSpec("is_authority", "bool", required=False, default=False),
)


def _build(**kw: Any):
    # The pipeline needs BOTH the Party object and the petitioner_name string (the
    # latter for the verification block). Build the Party, keep the name.
    kw["petitioner"] = _petitioner_party(kw["petitioner_name"])
    return pipeline.build(**kw)


ADAPTER = Adapter(
    doc_type="writ_petition", spec="5.1",
    title="Writ petition (Civil) under Art.226", build=_build,
    template="writ_petition.docx",
    fields=(
        FieldSpec("petitioner_name", "string"),
        ListFieldSpec("respondents", _RESPONDENT_ITEM, _respondent_party, min_items=1),
        FieldSpec("court_place", "string"),
        FieldSpec("court_side", "string", required=False, default=""),
        FieldSpec("writ_type", "enum",
                  enum_values=tuple(w.value for w in WritType), to_engine=WritType),
        FieldSpec("legal_right", "string", required=False, default=""),
        FieldSpec("public_duty", "string", required=False, default=""),
        FieldSpec("prior_demand_and_refusal", "string", required=False, default=""),
        FieldSpec("quasi_judicial_order", "string", required=False, default=None),
        FieldSpec("public_office", "string", required=False, default=None),
        FieldSpec("impugned_order_number", "string"),
        FieldSpec("impugned_order_date", "date", required=False, default=None),
        FieldSpec("impugned_order_annexed", "bool", required=False, default=False),
        FieldSpec("alternative_remedy_addressed", "bool"),
        FieldSpec("alternative_remedy_basis", "string"),
        FieldSpec("impugned_action_recent", "bool", required=False, default=True),
        FieldSpec("delay_explanation", "string", required=False, default=None),
        FieldSpec("laches_threshold_days", "int", required=False, default=90),
        FieldSpec("impugned_action_date", "date", required=False, default=None),
        FieldSpec("filing_date", "date"),
        FieldSpec("no_similar_petition", "bool"),
        FieldSpec("place", "string"),
        FieldSpec("day", "string"),
        FieldSpec("month", "string"),
        FieldSpec("year", "string"),
        FieldSpec("facts_narrative", "string", required=False, default=""),
        FieldSpec("grounds_narrative", "string", required=False, default=""),
        FieldSpec("grounds_list", "string_list", required=False, default=None),
    ),
    slots=("facts_narrative", "grounds_narrative"),
)

register(ADAPTER)
