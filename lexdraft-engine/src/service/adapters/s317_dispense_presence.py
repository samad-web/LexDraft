"""Adapter for the petition u/s 317 CrPC to dispense with the accused's presence (from the pipeline signature)."""

from __future__ import annotations

from ...pipelines import s317_dispense_presence as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="s317_dispense_presence", spec="tn-s317",
    title="Petition u/s 317 CrPC (Dispense with Accused Presence)",
    build=pipeline.build, template="s317_dispense_presence.docx",
    fields=(
        FieldSpec("accused_name", "string"),
        FieldSpec("complainant_name", "string"),
        FieldSpec("absence_reason", "string"),
        FieldSpec("absence_not_wanton", "bool"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("magistrate_designation", "string", required=False, default=None),
        FieldSpec("petition_date", "date", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
