"""Adapter for the succession-certificate petition (s.372, DPC pp.56-57)."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import succession_certificate as pipeline
from ...pipelines.succession_certificate import Security
from . import Adapter, FieldSpec, ListFieldSpec, register


_SECURITY_ITEM = (
    FieldSpec("description", "string"),
    FieldSpec("value", "int"),
)


# the other legal heirs, arrayed as respondents (name/address may be unknown).
_HEIR_ITEM = (
    FieldSpec("relation", "string"),
    FieldSpec("name", "string", required=False, default=""),
    FieldSpec("address", "string", required=False, default=""),
    FieldSpec("consented", "bool", required=False, default=False),
)


def _security(kw: Dict[str, Any]) -> Security:
    return Security(**kw)


ADAPTER = Adapter(
    doc_type="succession_certificate", spec="dpc-56-57",
    title="Petition for a succession certificate", build=pipeline.build,
    template="succession_certificate.docx",
    fields=(
        FieldSpec("petitioner_name", "string"),
        FieldSpec("deceased_name", "string"),
        FieldSpec("death_date", "date"),
        FieldSpec("deceased_residence", "string"),
        # optional: unstated -> a marked gap in the petition, not a blocked draft.
        FieldSpec("law_of_succession", "string", required=False, default=""),
        FieldSpec("diligent_search_no_will", "bool"),
        FieldSpec("next_of_kin", "string"),
        FieldSpec("petitioner_relation", "string"),
        ListFieldSpec("securities", _SECURITY_ITEM, _security, min_items=1),
        FieldSpec("purpose", "string"),
        FieldSpec("no_impediment_s370", "bool"),
        FieldSpec("no_prior_application", "bool"),
        FieldSpec("ad_valorem_duty_paid", "bool"),
        FieldSpec("filing_date", "date"),
        FieldSpec("place", "string"),
        FieldSpec("petitioner_parentage", "string", required=False, default=None),
        FieldSpec("petitioner_address", "string", required=False, default=None),
        # r14: the brief's age and "no nominee" were dropped by the composer.
        FieldSpec("petitioner_age", "int", required=False, default=None),
        FieldSpec("no_nominee", "bool", required=False, default=False),
        FieldSpec("grant_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
        FieldSpec("respondent_name", "string", required=False, default=None),
        ListFieldSpec("respondents", _HEIR_ITEM, dict, required=False),
    ),
    slots=(),
)

register(ADAPTER)
