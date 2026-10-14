"""Petition for substituted service under Order 5 Rule 20 CPC — pipeline.

Where ordinary service of summons or notice cannot be effected because the defendant
is keeping out of the way for the purpose of avoiding service, or cannot for any
other reason be served in the ordinary way, the plaintiff/petitioner moves the court
under Order 5 Rule 20 CPC to order substituted service — by affixing a copy of the
summons on the court notice-board and on some conspicuous part of the defendant's
last known place of residence, and by publication in a daily newspaper circulating
in the locality. The petition is supported by an affidavit swearing to the prior
attempts at ordinary service and to the defendant's evasion. The form is generalised
for any state and any court — the court name and place are placeholders.
PARTY-FILED.

Hard requirements (each refuses, no partial output):
  - The supporting affidavit must swear to at least one prior attempt at ordinary
    service — Order 5 Rule 20 CPC empowers the court to order substituted service
    only after it is satisfied that the defendant is keeping out of the way to avoid
    service (or cannot otherwise be served); a petition that pleads no prior attempt
    lays no foundation for affixture and publication.
  - The newspaper for publication must be named — substituted service under the rule
    is effected by affixture together with publication, and the paper of
    circulation must be identified.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "substituted_service.docx"
SPEC = "tn-subsvc"


@dataclass(frozen=True)
class SubstitutedServiceResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> SubstitutedServiceResult:
    return SubstitutedServiceResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="substituted_service", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    deponent_name: str,
    deponent_role: str,
    petitioner_name: str,
    respondent_name: str,
    prior_service_attempts: int,
    newspaper: str,
    case_ref: str,
    place: str,
    deponent_parentage: Optional[str] = None,
    deponent_age: Optional[str] = None,
    deponent_address: Optional[str] = None,
    court_place: Optional[str] = None,
    filing_date: Optional[date] = None,
    affix_court_notice_board: bool = True,
    affix_last_known_residence: bool = True,
) -> SubstitutedServiceResult:
    """Assemble the O.5 R.20 petition for substituted service, or refuse."""

    # 1. the affidavit must swear to at least one prior attempt at ordinary service.
    if prior_service_attempts < 1:
        return _refuse(
            "Order 5 Rule 20 CPC empowers the court to order substituted service only "
            "after it is satisfied that ordinary service was attempted and that the "
            "defendant is keeping out of the way to avoid service (or cannot otherwise "
            "be served); the affidavit swears to no prior attempt at ordinary service "
            "and lays no foundation for affixture and publication",
            code="substituted_service_no_prior_attempts",
            fields=("prior_service_attempts",),
        )

    # 2. the newspaper for publication must be named.
    if not newspaper.strip():
        return _refuse(
            "substituted service under Order 5 Rule 20 CPC is effected by affixture "
            "together with publication in a daily newspaper circulating in the locality; "
            "the newspaper is not named",
            code="substituted_service_newspaper_missing",
            fields=("newspaper",),
        )

    context: Dict[str, Any] = {
        "deponent_name": deponent_name,
        "deponent_role": deponent_role,
        "deponent_parentage": deponent_parentage,
        "deponent_age": deponent_age,
        "deponent_address": deponent_address,
        "petitioner_name": petitioner_name,
        "respondent_name": respondent_name,
        "prior_service_attempts": prior_service_attempts,
        "newspaper": newspaper,
        "case_ref": case_ref,
        "affix_court_notice_board": affix_court_notice_board,
        "affix_last_known_residence": affix_last_known_residence,
        "filing_date": filing_date.isoformat() if filing_date else None,
        "case_year": filing_date.year if filing_date else None,
        "court_place": court_place,
        "place": place,
    }
    return SubstitutedServiceResult(refused=False, context=context)
