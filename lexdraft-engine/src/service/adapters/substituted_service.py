"""Adapter for the petition for substituted service u/O.5 R.20 CPC (from the pipeline signature)."""

from __future__ import annotations

from ...pipelines import substituted_service as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="substituted_service", spec="tn-subsvc",
    title="Petition for Substituted Service (O.5 R.20 CPC)",
    build=pipeline.build, template="substituted_service.docx",
    fields=(
        FieldSpec("deponent_name", "string"),
        FieldSpec("deponent_role", "string"),
        FieldSpec("petitioner_name", "string"),
        FieldSpec("respondent_name", "string"),
        FieldSpec("prior_service_attempts", "int"),
        FieldSpec("newspaper", "string"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("deponent_parentage", "string", required=False, default=None),
        FieldSpec("deponent_age", "string", required=False, default=None),
        FieldSpec("deponent_address", "string", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("filing_date", "date", required=False, default=None),
        FieldSpec("affix_court_notice_board", "bool", required=False, default=True),
        FieldSpec("affix_last_known_residence", "bool", required=False, default=True),
    ),
    slots=(),
)

register(ADAPTER)
