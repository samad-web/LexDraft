"""Adapter for the Affidavit of Surety (long statutory Rule-14 surety affidavit)."""

from __future__ import annotations

from ...pipelines import affidavit_of_surety as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="affidavit_of_surety", spec="tn-affsurety",
    title="Affidavit of Surety",
    build=pipeline.build, template="affidavit_of_surety.docx",
    # FILL-IN COURT FORM: every field OPTIONAL so the engine renders the form with
    # blanks instead of 422-ing when a value isn't on record.
    fields=(
        FieldSpec("court_name", "string", required=False, default=""),
        FieldSpec("court_place", "string", required=False, default=""),
        FieldSpec("case_ref", "string", required=False, default=""),
        FieldSpec("crime_no", "string", required=False, default=""),
        FieldSpec("crime_year", "string", required=False, default=""),
        FieldSpec("state_name", "string", required=False, default=""),
        FieldSpec("police_station", "string", required=False, default=""),
        FieldSpec("accused_name", "string", required=False, default=""),
        FieldSpec("offence_sections", "string", required=False, default=""),
        FieldSpec("bail_sum", "string", required=False, default=""),
        FieldSpec("bail_sum_words", "string", required=False, default=""),
        FieldSpec("bail_order_date", "string", required=False, default=""),
        FieldSpec("surety_name", "string", required=False, default=""),
        FieldSpec("surety_parentage", "string", required=False, default=""),
        FieldSpec("surety_age", "string", required=False, default=""),
        FieldSpec("surety_address", "string", required=False, default=""),
        FieldSpec("place", "string", required=False, default=""),
        FieldSpec("filing_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
