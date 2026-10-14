"""Application to sue as an indigent person, O33 r/w s.151 CPC
— document pipeline (DPC book p.21).

A short interlocutory application accompanying a suit: the applicant, having no
means to pay court fee, seeks leave to sue as an indigent person. The book (p.21)
pleads that the applicant has no movable/immovable property and no source of
income, undertakes to pay the fee if the suit is decreed, and prays for leave.

Hard requirement (refuses, no partial output):
  - The indigency averment (no property + no source of income) must be pleaded —
    it is the jurisdictional fact under O33 and the whole basis of the leave.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "indigent_application.docx"
SPEC = "dpc-21"


@dataclass(frozen=True)
class IndigentResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> IndigentResult:
    return IndigentResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="indigent_application", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    applicant_name: str,
    respondent_name: str,
    suit_ref: str,
    indigency_pleaded: bool,
    indigency_particulars: str,
    undertakes_to_pay_if_decreed: bool,
    filing_date: date,
    place: str,
    # cause-title header (DPC book p.21). Optional.
    applicant_parentage: Optional[str] = None,
    applicant_address: Optional[str] = None,
    respondent_parentage: Optional[str] = None,
    respondent_address: Optional[str] = None,
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
) -> IndigentResult:
    """Assemble the indigent-person application, or refuse."""

    # 1. indigency is the jurisdictional fact under O33.
    if not indigency_pleaded or not indigency_particulars.strip():
        return _refuse(
            "leave to sue as an indigent person under Order XXXIII requires the "
            "applicant to plead that he has no sufficient means (no movable/"
            "immovable property and no source of income) to pay the court fee; that "
            "averment is absent",
            code="indigent_indigency_not_pleaded",
            fields=("indigency_pleaded", "indigency_particulars"),
        )

    # 2. the undertaking to pay the fee if the suit is decreed (book para 4).
    if not undertakes_to_pay_if_decreed:
        return _refuse(
            "the applicant must undertake to pay the entire court fee if the suit is "
            "decreed in his favour; the undertaking is absent",
            code="indigent_undertaking_missing",
            fields=("undertakes_to_pay_if_decreed",),
        )

    context: Dict[str, Any] = {
        "applicant": {"name": applicant_name, "parentage": applicant_parentage,
                      "address": applicant_address},
        "respondent": {"name": respondent_name, "parentage": respondent_parentage,
                       "address": respondent_address},
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "application_date": filing_date.isoformat(),
        "suit_ref": suit_ref,
        "indigency_particulars": indigency_particulars,
        "undertakes_to_pay_if_decreed": undertakes_to_pay_if_decreed,
        "place": place,
    }
    return IndigentResult(refused=False, context=context)
