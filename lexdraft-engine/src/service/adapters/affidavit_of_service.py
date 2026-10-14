"""Adapter for the affidavit of service (proof of notice returned unserved)."""

from __future__ import annotations

from ...pipelines import affidavit_of_service as pipeline
from ...pipelines.affidavit_of_service import Endorsement
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="affidavit_of_service", spec="tn-affsvc",
    title="Affidavit of Service",
    build=pipeline.build, template="affidavit_of_service.docx",
    # This is a FILL-IN COURT FORM: every field is OPTIONAL so the engine never
    # 422s for a missing value — it renders the form's blank line instead, which
    # the advocate autofills from the case or completes by hand. (The old
    # required fields made the app say "I still need …" instead of drafting.)
    fields=(
        FieldSpec("deponent_name", "string", required=False, default=""),
        FieldSpec("deponent_role", "string", required=False, default=""),
        FieldSpec("petitioner_name", "string", required=False, default=""),
        FieldSpec("respondent_name", "string", required=False, default=""),
        FieldSpec("notice_returnable_date", "date", required=False, default=None),
        FieldSpec("endorsement", "enum",
                  enum_values=tuple(e.value for e in Endorsement), to_engine=Endorsement,
                  required=False, default=None),
        FieldSpec("case_ref", "string", required=False, default=""),
        FieldSpec("place", "string", required=False, default=""),
        FieldSpec("deponent_parentage", "string", required=False, default=None),
        FieldSpec("deponent_age", "string", required=False, default=None),
        FieldSpec("deponent_address", "string", required=False, default=None),
        FieldSpec("religion", "string", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("court_name", "string", required=False, default=None),
        FieldSpec("affirm_date", "date", required=False, default=None),
        # Two case-reference lines on the advocate form (I.A. No. / O.S. No.).
        FieldSpec("ia_no", "string", required=False, default=None),
        FieldSpec("ia_year", "string", required=False, default=None),
        FieldSpec("os_no", "string", required=False, default=None),
        FieldSpec("os_year", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
