"""Adapter for the petition to recall a warrant of arrest (s.70(2) CrPC)."""

from __future__ import annotations

from ...pipelines import recall_warrant as pipeline
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="recall_warrant", spec="tn-recall",
    title="Petition to Recall Warrant (s.70(2) CrPC)",
    build=pipeline.build, template="recall_warrant.docx",
    fields=(
        FieldSpec("accused_name", "string"),
        FieldSpec("absence_reason", "string"),
        FieldSpec("warrant_pending", "bool"),
        FieldSpec("undertaking_future_appearance", "bool"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("state_rep_by", "string", required=False, default=None),
        FieldSpec("police_station", "string", required=False, default=None),
        FieldSpec("petition_date", "date", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
