"""Surety affidavit (Criminal Rules of Practice — surety-verification rule).

An affidavit sworn by a proposed surety who offers to stand surety for an accused
who has been ordered released on bail. The deponent affirms his identity, means
and property, his relationship (if any) to the accused, any prior suretyships, and
that he is competent and willing to bind himself to the bail sum. The court name
and place are placeholders — the affidavit adapts to any state. PARTY-FILED (sworn
by the proposed surety, not issued by the court).

Hard requirements (each refuses, no partial output):
  - Bail must already have been granted — a surety affidavit is offered only
    after the accused has been ordered released on bail.
  - The surety who deposes must be named.
  - The bail sum to which the surety offers to bind himself must be stated.
  - At least one identity document must be produced — the surety-verification
    rule requires it.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "surety_affidavit.docx"
SPEC = "tn-surety"


@dataclass(frozen=True)
class SuretyAffidavitResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> SuretyAffidavitResult:
    return SuretyAffidavitResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="surety_affidavit", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    surety_name: str,
    accused_name: str,
    offence_section: str,
    bail_granted: bool,
    bail_sum: str,
    id_proofs: Sequence[str],
    case_ref: str,
    place: str,
    surety_occupation: Optional[str] = None,
    surety_address: Optional[str] = None,
    surety_relationship_to_accused: Optional[str] = None,
    property_particulars: Optional[str] = None,
    monthly_income: Optional[str] = None,
    prior_suretyships: Optional[str] = None,
    affirm_date: Optional[date] = None,
    court_place: Optional[str] = None,
    state_rep_by: Optional[str] = None,
    crime_no: Optional[str] = None,
) -> SuretyAffidavitResult:
    """Assemble the surety affidavit, or refuse."""

    # 1. a surety affidavit is filed only after the accused has been ordered
    #    released on bail.
    if not bail_granted:
        return _refuse(
            "a surety affidavit is filed only after the accused has been ordered "
            "released on bail",
            code="surety_affidavit_bail_not_granted",
            fields=("bail_granted",),
        )

    # 2. the surety who deposes must be named.
    if not surety_name.strip():
        return _refuse(
            "a surety affidavit must name the deponent who offers to stand surety; "
            "the name is absent",
            code="surety_affidavit_surety_missing",
            fields=("surety_name",),
        )

    # 3. the bail sum to which the surety binds himself must be stated.
    if not bail_sum.strip():
        return _refuse(
            "a surety affidavit must state the bail sum to which the surety offers "
            "to bind himself; that sum is absent",
            code="surety_affidavit_bail_sum_missing",
            fields=("bail_sum",),
        )

    # 4. the surety-verification rule requires the surety to produce an identity
    #    document.
    if not any(p.strip() for p in id_proofs):
        return _refuse(
            "the surety-verification rule requires the surety to produce an "
            "identity document",
            code="surety_affidavit_no_id_proof",
            fields=("id_proofs",),
        )

    context: Dict[str, Any] = {
        "surety_name": surety_name,
        "accused_name": accused_name,
        "offence_section": offence_section,
        "bail_granted": bail_granted,
        "bail_sum": bail_sum,
        "id_proofs": [p for p in id_proofs if p.strip()],
        "case_ref": case_ref,
        "place": place,
        "surety_occupation": surety_occupation,
        "surety_address": surety_address,
        "surety_relationship_to_accused": surety_relationship_to_accused,
        "property_particulars": property_particulars,
        "monthly_income": monthly_income,
        "prior_suretyships": prior_suretyships,
        "affirm_date": affirm_date.isoformat() if affirm_date is not None else None,
        "court_place": court_place,
        "state_rep_by": state_rep_by,
        "crime_no": crime_no,
    }
    return SuretyAffidavitResult(refused=False, context=context)
