"""Adapter for the vakalatnama (advocate-appointment instrument)."""

from __future__ import annotations

from ...pipelines import vakalatnama as pipeline
from ...pipelines.vakalatnama import VakalatKind, CourtKind
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type="vakalatnama", spec="tn-vakalat",
    title="Vakalatnama",
    build=pipeline.build, template="vakalatnama.docx",
    fields=(
        FieldSpec("kind", "enum",
                  enum_values=tuple(k.value for k in VakalatKind), to_engine=VakalatKind,
                  required=False, default=VakalatKind.LONG),
        # NOT required: a vakalat drafted FOR a case autofills the executant (the
        # client we represent), the party role and the advocate from what's on
        # record. When one isn't found we render a fill-in blank for the advocate
        # to complete — we never refuse. (User rule: if it isn't in the documents,
        # leave a placeholder — never refuse.)
        FieldSpec("executant_name", "string", required=False, default=""),
        FieldSpec("party_role", "string", required=False, default=""),
        FieldSpec("advocates", "string_list", required=False, default=()),
        # NOT required: the court assigns the case number AFTER filing, so at
        # drafting time it is legitimately blank — the template prints
        # "No. ___ of 20__" as a fill-in-later blank (as on the advocate's own
        # form). Making it required forced the intake to ask for a number that
        # doesn't exist yet.
        FieldSpec("case_ref", "string", required=False, default=""),
        # NOT required: `place` is the town where the vakalat is SIGNED — on the
        # advocate's printed form it is a fill-in-later blank, exactly like the
        # date. Requiring it forced a refusal ("I still need: Place") even when the
        # matter was fully on record. When absent the pipeline renders a blank
        # underline the advocate completes on signing. (User rule: if it isn't in
        # the documents, leave a placeholder — never refuse.)
        FieldSpec("place", "string", required=False, default=""),
        FieldSpec("execution_date", "date", required=False, default=None),
        FieldSpec("court_name", "string", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
        FieldSpec("opposite_party_name", "string", required=False, default=None),
        FieldSpec("enrolment_no", "string", required=False, default=None),
        FieldSpec("address_for_service", "string", required=False, default=None),
        FieldSpec("advocate_mobile", "string", required=False, default=None),
        FieldSpec("advocate_email", "string", required=False, default=None),
        FieldSpec("party_contact", "string", required=False, default=None),
        FieldSpec("party_address", "string", required=False, default=None),
        FieldSpec("state_language", "string", required=False, default=None),
        # Court-specific format: CRIMINAL / SMALL_CAUSES / CIVIL (defaults GENERIC).
        FieldSpec("court_kind", "enum",
                  enum_values=tuple(k.value for k in CourtKind),
                  to_engine=CourtKind, required=False, default=CourtKind.GENERIC),
        # Small-Causes counsel fee amount (Rs.) for the fee clause.
        FieldSpec("counsel_fee", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
