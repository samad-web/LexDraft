"""Adapter for the reply to a s.138 legal notice (DPC book pp.132-133)."""

from __future__ import annotations

from ...pipelines import s138_reply as pipeline
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="s138_reply",
    spec="dpc-132-133",
    title="Reply to a legal notice u/s 138 NI Act",
    build=pipeline.build,
    template="s138_reply.docx",
    fields=(
        FieldSpec("advocate", "string"),
        FieldSpec("client", "string"),
        FieldSpec("opposing_advocate", "string"),
        FieldSpec("notice_date", "date"),
        FieldSpec("defence_narrative", "string"),
        FieldSpec("liability_denied", "bool"),
        FieldSpec("cheque_in_discharge_denied", "bool"),
        FieldSpec("place", "string"),
        FieldSpec("advocate_chamber", "string", required=False, default=None),
        FieldSpec("advocate_phone", "string", required=False, default=None),
        FieldSpec("dispatch_line", "string", required=False, default=None),
        FieldSpec("client_address", "string", required=False, default=None),
    ),
    slots=("defence_narrative",),
)

register(ADAPTER)
