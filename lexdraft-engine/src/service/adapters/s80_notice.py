"""Adapter for the s.80 CPC notice to Government (DPC book pp.128-129)."""

from __future__ import annotations

from ...pipelines import s80_notice as pipeline
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="s80_notice",
    spec="dpc-128-129",
    title="Notice u/s 80 CPC to Government",
    build=pipeline.build,
    template="s80_notice.docx",
    fields=(
        FieldSpec("advocate", "string"),
        FieldSpec("client", "string"),
        FieldSpec("addressee", "string"),
        FieldSpec("government_body", "string"),
        FieldSpec("plaintiff_name_description", "string"),
        FieldSpec("cause_of_action", "string"),
        FieldSpec("reliefs", "string_list"),
        FieldSpec("notice_date", "date"),
        FieldSpec("place", "string"),
        FieldSpec("advocate_chamber", "string", required=False, default=None),
        FieldSpec("advocate_phone", "string", required=False, default=None),
        FieldSpec("dispatch_line", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
