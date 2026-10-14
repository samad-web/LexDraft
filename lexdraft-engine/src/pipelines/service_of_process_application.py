"""Application listing respondents to be served with court process — pipeline.

When a proceeding is admitted the petitioner files an application, together with the
requisite process fee, listing the respondents on whom the court process (notice /
summons) is to be served, with sufficient particulars to enable service: the
respondent's name and parentage or guardian, occupation, and the full territorial
address — district, taluk and the village/town street address. The court's process
serving agency takes out service on the persons so listed. The form is generalised
for any state and any court — the court name and place of sitting are placeholders.
PARTY-FILED.

Hard requirements (each refuses, no partial output):
  - At least one respondent must be listed with a non-blank name; an application to
    serve process that names no person to be served is meaningless.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "service_of_process_application.docx"
SPEC = "tn-service"


@dataclass(frozen=True)
class RespondentToServe:
    name: str
    father_or_guardian: Optional[str] = None
    occupation: Optional[str] = None
    district: Optional[str] = None
    taluk: Optional[str] = None
    village_town_address: Optional[str] = None


@dataclass(frozen=True)
class ServiceOfProcessApplicationResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> ServiceOfProcessApplicationResult:
    return ServiceOfProcessApplicationResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="service_of_process_application", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    case_ref: str,
    respondents: Sequence[RespondentToServe],
    place: str,
    court_place: Optional[str] = None,
    court_fee_amount: Optional[str] = None,
    hearing_date: Optional[date] = None,
) -> ServiceOfProcessApplicationResult:
    """Assemble the application to serve process on the listed respondents, or refuse."""

    # 1. at least one respondent must be listed with a name.
    if not any(r.name.strip() for r in respondents):
        return _refuse(
            "an application to take out service of process must list at least one "
            "respondent, by name, on whom the court process is to be served; no "
            "respondent is listed",
            code="service_of_process_no_respondents",
            fields=("respondents",),
        )

    context: Dict[str, Any] = {
        "case_ref": case_ref,
        "respondents": [
            {
                "name": r.name,
                "father_or_guardian": r.father_or_guardian,
                "occupation": r.occupation,
                "district": r.district,
                "taluk": r.taluk,
                "village_town_address": r.village_town_address,
            }
            for r in respondents
        ],
        "court_fee_amount": court_fee_amount,
        "hearing_date": hearing_date.isoformat() if hearing_date else None,
        "case_year": hearing_date.year if hearing_date else None,
        "court_place": court_place,
        "place": place,
    }
    return ServiceOfProcessApplicationResult(refused=False, context=context)
