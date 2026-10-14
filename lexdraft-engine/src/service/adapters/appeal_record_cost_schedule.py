"""Adapter for the appeal-record cost schedule (Form 476)."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import appeal_record_cost_schedule as pipeline
from ...pipelines.appeal_record_cost_schedule import RecordDocRow
from . import Adapter, FieldSpec, ListFieldSpec, register


_DOCUMENT_ITEM = (
    FieldSpec("description", "string"),
    FieldSpec("whole_or_part", "string", required=False, default=None),
    FieldSpec("mark_in_lower_court", "string", required=False, default=None),
    FieldSpec("pages_translation", "string", required=False, default=None),
    FieldSpec("pages_printing", "string", required=False, default=None),
    FieldSpec("cost_estimate", "string", required=False, default=None),
)


def _document(kw: Dict[str, Any]) -> RecordDocRow:
    return RecordDocRow(**kw)


ADAPTER = Adapter(
    doc_type="appeal_record_cost_schedule", spec="tn-appealrec",
    title="Appeal Record Cost Schedule (Form 476)",
    build=pipeline.build, template="appeal_record_cost_schedule.docx",
    fields=(
        FieldSpec("appeal_ref", "string"),
        FieldSpec("on_behalf_of", "string"),
        ListFieldSpec("documents", _DOCUMENT_ITEM, _document, min_items=1),
        FieldSpec("place", "string"),
        FieldSpec("court_type", "string", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("copies_required", "string", required=False, default=None),
        FieldSpec("counsel_name", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
