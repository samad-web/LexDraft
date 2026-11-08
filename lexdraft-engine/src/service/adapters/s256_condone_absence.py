"""Adapter for the petition u/s 256 CrPC to condone the complainant's absence (from the pipeline signature)."""

from __future__ import annotations

from ...pipelines import s256_condone_absence as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="s256_condone_absence", spec="tn-s256",
    title="Petition u/s 279 BNSS (s.256 CrPC) (Condone Complainant Absence)",
    build=pipeline.build, template="s256_condone_absence.docx",
    fields=(
        FieldSpec("complainant_name", "string"),
        FieldSpec("accused_name", "string"),
        FieldSpec("absence_reason", "string"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("court_designation", "string", required=False, default=None),
        FieldSpec("petition_date", "date", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("absence_date", "date", required=False, default=None),
        FieldSpec("post_for", "string", required=False, default=None),
        FieldSpec("case_dismissed", "bool", required=False, default=False),
        FieldSpec("restore_sought", "bool", required=False, default=False),
        FieldSpec("case_nature", "string", required=False, default=None),
        FieldSpec("deponent_name", "string", required=False, default=None),
        FieldSpec("deponent_description", "string", required=False, default=None),
        FieldSpec("documents", "string_list", required=False, default=()),
        FieldSpec("filing_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
