"""Adapter for the MACT claim petition (spec 7.2)."""

from __future__ import annotations

from ...pipelines import mact_claim as pipeline
from ...pipelines.mact_claim import ClaimKind
from ...rules import compensation_multiplier as cm
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="mact_claim", spec="7.2",
    title="MACT claim petition (s.166 MV Act)", build=pipeline.build,
    template="mact_claim.docx",
    fields=(
        FieldSpec("claim_kind", "enum",
                  enum_values=tuple(k.value for k in ClaimKind), to_engine=ClaimKind),
        FieldSpec("claimants", "string_list"),
        FieldSpec("accident_date", "date"),
        FieldSpec("rash_negligent_pleaded", "bool"),
        FieldSpec("fir_ref", "string"),
        FieldSpec("vehicle_number", "string"),
        FieldSpec("owner", "string"),
        FieldSpec("driver", "string"),
        FieldSpec("insurer", "string"),
        FieldSpec("policy_no", "string"),
        FieldSpec("policy_valid_on_accident", "bool"),
        FieldSpec("victim_age", "int"),
        FieldSpec("victim_annual_income", "int"),
        FieldSpec("income_proof_present", "bool"),
        FieldSpec("employment", "enum",
                  enum_values=tuple(e.value for e in cm.Employment),
                  to_engine=cm.Employment),
        FieldSpec("dependants", "int"),
        FieldSpec("disability_pct", "int", required=False, default=None),
        FieldSpec("permanent", "bool", required=False, default=None),
        FieldSpec("treatment_expenses", "int"),
        FieldSpec("attendant_expenses", "int"),
        FieldSpec("claimed_total", "int", required=False, default=None),
        FieldSpec("jurisdiction_basis", "string"),
        FieldSpec("place", "string"),
        FieldSpec("accident_narrative", "string", required=False, default=""),
        FieldSpec("tribunal_place", "string", required=False, default=None),
        FieldSpec("filing_date", "date", required=False, default=None),
    ),
    slots=("accident_narrative",),
)

register(ADAPTER)
