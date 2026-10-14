"""Adapter for the petition for adjournment (Order XVII Rule 1 CPC)."""

from __future__ import annotations

from ...pipelines import adjournment_petition as pipeline
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="adjournment_petition", spec="tn-adjourn",
    title="Petition for Adjournment (O.XVII R.1 CPC)",
    build=pipeline.build, template="adjournment_petition.docx",
    fields=(
        FieldSpec("petitioner_name", "string"),
        FieldSpec("respondent_name", "string"),
        FieldSpec("posted_for", "string"),
        FieldSpec("adjournment_reason", "string"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("petition_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
