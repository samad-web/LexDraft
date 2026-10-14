"""Adapter for the court-issued notice (court-issued instrument)."""

from __future__ import annotations

from ...pipelines import court_notice as pipeline
from ...pipelines.court_notice import NoticeKind
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="court_notice", spec="tn-courtnotice",
    title="Court Notice",
    build=pipeline.build, template="court_notice.docx",
    fields=(
        FieldSpec("kind", "enum",
                  enum_values=tuple(k.value for k in NoticeKind), to_engine=NoticeKind),
        FieldSpec("case_ref", "string"),
        FieldSpec("applicant_or_petitioner_name", "string"),
        FieldSpec("addressee_name", "string"),
        FieldSpec("place", "string"),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("application_or_relief", "string", required=False, default=None),
        FieldSpec("appearance_date", "date", required=False, default=None),
        FieldSpec("documents_description", "string", required=False, default=None),
        FieldSpec("written_statement_date", "date", required=False, default=None),
        FieldSpec("seal_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
