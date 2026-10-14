"""Adapter for the surety affidavit (Criminal Rules of Practice) — from the pipeline signature."""

from __future__ import annotations

from ...pipelines import surety_affidavit as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="surety_affidavit", spec="tn-surety",
    title="Surety Affidavit",
    build=pipeline.build, template="surety_affidavit.docx",
    fields=(
        FieldSpec("surety_name", "string"),
        FieldSpec("accused_name", "string"),
        FieldSpec("offence_section", "string"),
        FieldSpec("bail_granted", "bool"),
        FieldSpec("bail_sum", "string"),
        FieldSpec("id_proofs", "string_list"),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("surety_occupation", "string", required=False, default=None),
        FieldSpec("surety_address", "string", required=False, default=None),
        FieldSpec("surety_relationship_to_accused", "string", required=False, default=None),
        FieldSpec("property_particulars", "string", required=False, default=None),
        FieldSpec("monthly_income", "string", required=False, default=None),
        FieldSpec("prior_suretyships", "string", required=False, default=None),
        FieldSpec("affirm_date", "date", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("state_rep_by", "string", required=False, default=None),
        FieldSpec("crime_no", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
