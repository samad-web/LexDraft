"""Adapter for the application to serve process on listed respondents."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import service_of_process_application as pipeline
from ...pipelines.service_of_process_application import RespondentToServe
from . import Adapter, FieldSpec, ListFieldSpec, register


_RESPONDENT_ITEM = (
    FieldSpec("name", "string"),
    FieldSpec("father_or_guardian", "string", required=False, default=None),
    FieldSpec("occupation", "string", required=False, default=None),
    FieldSpec("district", "string", required=False, default=None),
    FieldSpec("taluk", "string", required=False, default=None),
    FieldSpec("village_town_address", "string", required=False, default=None),
)


def _respondent(kw: Dict[str, Any]) -> RespondentToServe:
    return RespondentToServe(**kw)


ADAPTER = Adapter(
    doc_type="service_of_process_application", spec="tn-service",
    title="Application for Service of Process",
    build=pipeline.build, template="service_of_process_application.docx",
    fields=(
        FieldSpec("case_ref", "string"),
        ListFieldSpec("respondents", _RESPONDENT_ITEM, _respondent, min_items=1),
        FieldSpec("place", "string"),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("court_fee_amount", "string", required=False, default=None),
        FieldSpec("hearing_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
