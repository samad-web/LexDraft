"""Adapter for the s.106 TPA ejectment notice (DPC book p.127)."""

from __future__ import annotations

from ...pipelines import s106_notice as pipeline
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="s106_notice",
    spec="dpc-127",
    title="Notice of ejectment u/s 106 TPA",
    build=pipeline.build,
    template="s106_notice.docx",
    fields=(
        FieldSpec("advocate", "string"),
        FieldSpec("client", "string"),
        FieldSpec("recipient_name", "string"),
        FieldSpec("recipient_address", "string"),
        FieldSpec("property_desc", "string"),
        FieldSpec("monthly_rent", "int"),
        FieldSpec("notice_date", "date"),
        FieldSpec("quit_date", "date"),
        FieldSpec("damages_rate_note", "string"),
        FieldSpec("place", "string"),
        FieldSpec("advocate_chamber", "string", required=False, default=None),
        FieldSpec("advocate_phone", "string", required=False, default=None),
        FieldSpec("dispatch_line", "string", required=False, default=None),
        FieldSpec("client_parentage", "string", required=False, default=None),
        FieldSpec("client_address", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
