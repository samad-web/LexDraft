"""Adapter for the Surety Memo (memo furnishing sureties for the accused's bail)."""

from __future__ import annotations

from ...pipelines import surety_memo as pipeline
from . import Adapter, FieldSpec, ListFieldSpec, register

# A surety offered for the accused (shared with memorandum_furnish_sureties).
SURETY_ITEM = (
    FieldSpec("name", "string"),
    FieldSpec("address", "string", required=False, default=None),
    FieldSpec("amount", "string", required=False, default=None),
)

ADAPTER = Adapter(
    doc_type="surety_memo", spec="tn-suretymemo",
    title="Surety Memo",
    build=pipeline.build, template="surety_memo.docx",
    # FILL-IN COURT FORM: every field OPTIONAL so the engine renders the form with
    # blanks instead of 422-ing when a value isn't on record.
    fields=(
        FieldSpec("court_name", "string", required=False, default=""),
        FieldSpec("court_place", "string", required=False, default=""),
        FieldSpec("case_ref", "string", required=False, default=""),
        FieldSpec("crime_no", "string", required=False, default=""),
        FieldSpec("crime_year", "string", required=False, default=""),
        FieldSpec("state_name", "string", required=False, default=""),
        FieldSpec("police_inspector", "string", required=False, default=""),
        FieldSpec("accused_name", "string", required=False, default=""),
        FieldSpec("place", "string", required=False, default=""),
        FieldSpec("filing_date", "date", required=False, default=None),
        FieldSpec("police_station", "string", required=False, default=""),
        ListFieldSpec("sureties", SURETY_ITEM, dict, min_items=0, required=False),
        FieldSpec("documents", "string_list", required=False, default=()),
    ),
    slots=(),
)

register(ADAPTER)
