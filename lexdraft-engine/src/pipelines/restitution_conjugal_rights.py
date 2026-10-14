"""Petition for Restitution of Conjugal Rights, s.9 HMA
— document pipeline (DPC book pp.40-41).

Filed before the Family Court where a spouse has, without reasonable excuse,
withdrawn from the society of the petitioner. The book (pp.40-41) pleads the
marriage (with registration + affidavit), the status/residence particulars, the
withdrawal, no-collusion, no-delay, and jurisdiction.

Hard requirements (each refuses, no partial output):
  - Marriage solemnisation (date + place, Hindu rites) must be pleaded — the
    foundational fact of a matrimonial cause.
  - The withdrawal from society, without reasonable excuse, with its effective
    date, is the statutory trigger of s.9 and must be pleaded.
  - The no-collusion averment is a mandatory HMA pleading (matrimonial intro p.39).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "restitution_conjugal_rights.docx"
SPEC = "dpc-40-41"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


@dataclass(frozen=True)
class RCRResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> RCRResult:
    return RCRResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="restitution_conjugal_rights", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    petitioner_name: str,
    respondent_name: str,
    marriage_date: Optional[date],
    marriage_place: str,
    marriage_registered: bool,
    withdrawal_date: Optional[date],
    withdrawal_narrative: str,
    no_collusion: bool,
    no_undue_delay: bool,
    last_resided_together: str,
    jurisdiction_basis: str,
    filing_date: date,
    place: str,
    # cause-title header (DPC book pp.40-41). Optional.
    petitioner_parentage: Optional[str] = None,
    petitioner_address: Optional[str] = None,
    respondent_parentage: Optional[str] = None,
    respondent_address: Optional[str] = None,
    family_court: Optional[str] = None,
    city: Optional[str] = None,
) -> RCRResult:
    """Assemble the s.9 HMA restitution petition, or refuse."""

    # 1. marriage is the foundational fact.
    if marriage_date is None or not marriage_place.strip():
        return _refuse(
            "a matrimonial petition must plead the solemnisation of the marriage "
            "(its date and place, according to Hindu rites and ceremonies); it is "
            "absent",
            code="rcr_marriage_not_pleaded",
            fields=("marriage_date", "marriage_place"),
        )

    # 2. withdrawal from society is the statutory trigger of s.9.
    if withdrawal_date is None or not withdrawal_narrative.strip():
        return _refuse(
            "restitution under s.9 HMA requires the respondent's withdrawal from the "
            "society of the petitioner, without reasonable excuse, to be pleaded with "
            "its effective date; it is absent",
            code="rcr_withdrawal_not_pleaded",
            fields=("withdrawal_date", "withdrawal_narrative"),
        )

    # 3. no-collusion is a mandatory HMA averment.
    if not no_collusion:
        return _refuse(
            "the petition must aver that it is not presented in collusion with the "
            "respondent; that averment is absent",
            code="rcr_collusion_not_negatived", fields=("no_collusion",),
        )

    context: Dict[str, Any] = {
        "petitioner": {"name": petitioner_name, "parentage": petitioner_parentage,
                       "address": petitioner_address},
        "respondent": {"name": respondent_name, "parentage": respondent_parentage,
                       "address": respondent_address},
        "family_court": family_court,
        "city": city,
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "knowledge_para_last": 7,
        "marriage_date": marriage_date,
        "marriage_place": marriage_place,
        "marriage_registered": marriage_registered,
        "withdrawal_date": withdrawal_date,
        "withdrawal_slot": withdrawal_narrative,
        "no_collusion": no_collusion,
        "no_undue_delay": no_undue_delay,
        "last_resided_together": last_resided_together,
        "jurisdiction_basis": jurisdiction_basis,
        "has_matrimonial_verification": True,
        "place": place,
    }
    return RCRResult(refused=False, context=context)
