"""Adapter for the memo of appearance (counsel's entry of appearance)."""

from __future__ import annotations

from ...pipelines import memo_of_appearance as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="memo_of_appearance", spec="tn-memo",
    title="Memo of Appearance",
    build=pipeline.build, template="memo_of_appearance.docx",
    fields=(
        FieldSpec("counsel_name", "string"),
        FieldSpec("party_represented", "string"),
        FieldSpec("party_name", "string"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("court_name", "string", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("opposite_party_name", "string", required=False, default=None),
        FieldSpec("addressed_to", "string", required=False, default=None),
        FieldSpec("enrolment_no", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
