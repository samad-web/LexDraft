"""Adapter for the DV Act s.12 application (spec 6.4)."""

from __future__ import annotations

import re
from typing import Any, Dict

from ...pipelines import dv_application as pipeline
from ...pipelines.dv_application import (AbuseCategory, AbuseIncident, ReliefHead,
                                        ReliefSought)
from . import Adapter, FieldSpec, ListFieldSpec, register


_RELIEF_ITEM = (
    FieldSpec("head", "enum", enum_values=tuple(h.value for h in ReliefHead)),
    FieldSpec("averment", "string"),
)


def _relief(kw: Dict[str, Any]) -> ReliefSought:
    return ReliefSought(head=ReliefHead(kw["head"]), averment=kw["averment"])


_INCIDENT_ITEM = (
    FieldSpec("category", "enum", required=False, default=None,
              enum_values=tuple(c.value for c in AbuseCategory)),
    FieldSpec("date", "date", required=False, default=None),
    FieldSpec("description", "string"),
)


_CATEGORY_WORDS = (
    (AbuseCategory.SEXUAL, r"\b(?:sexual|molest|forced intercourse)"),
    (AbuseCategory.PHYSICAL, r"\b(?:assault|beat|hit|slap|kick|burn|injur|physical)"),
    (AbuseCategory.ECONOMIC, r"\b(?:dowry|money|salary|stridhan|jewel|maintenance|economic|financ)"),
)


def _category(given: Any, description: str) -> AbuseCategory:
    """The incident's head under s.3, from its own words when the brief reading left
    it unset (v3: one blank category sent the whole application to the AI)."""
    if given:
        return AbuseCategory(given)
    for category, pattern in _CATEGORY_WORDS:
        if re.search(pattern, description or "", re.I):
            return category
    return AbuseCategory.VERBAL_EMOTIONAL


def _incident(kw: Dict[str, Any]) -> AbuseIncident:
    return AbuseIncident(category=_category(kw.get("category"), kw["description"]),
                         date=kw.get("date"), description=kw["description"])


ADAPTER = Adapter(
    doc_type="dv_application", spec="6.4",
    title="Application under s.12 DV Act", build=pipeline.build,
    template="dv_application.docx",
    fields=(
        FieldSpec("aggrieved_name", "string"),
        FieldSpec("respondent_name", "string"),
        FieldSpec("domestic_relationship_pleaded", "bool"),
        FieldSpec("domestic_relationship_basis", "string"),
        FieldSpec("shared_household_pleaded", "bool", required=False, default=False),
        FieldSpec("shared_household_particulars", "string", required=False, default=""),
        ListFieldSpec("reliefs", _RELIEF_ITEM, _relief, min_items=1),
        ListFieldSpec("incidents", _INCIDENT_ITEM, _incident, required=False),
        FieldSpec("jurisdiction_basis", "string"),
        FieldSpec("place", "string"),
        FieldSpec("incidents_narrative", "string", required=False, default=""),
        FieldSpec("magistrate_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
        FieldSpec("filing_date", "date", required=False, default=None),
        FieldSpec("respondent_names", "string_list", required=False, default=None),
        FieldSpec("aggrieved_age", "int", required=False, default=None),
        FieldSpec("aggrieved_address", "string", required=False, default=None),
        FieldSpec("respondent_address", "string", required=False, default=None),
    ),
    slots=("incidents_narrative",),
)

register(ADAPTER)
