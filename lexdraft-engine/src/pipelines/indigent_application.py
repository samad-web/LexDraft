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

import re
from dataclasses import dataclass
from datetime import date
from fractions import Fraction
from typing import Any, Dict, Optional, Sequence

from ..rules import court_fee as cf
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from ..verify.signoff import SLOT_PATTERN

_SHARE_WORDS = {"half": Fraction(1, 2), "one-half": Fraction(1, 2), "one-third": Fraction(1, 3),
                "one third": Fraction(1, 3), "two-thirds": Fraction(2, 3),
                "one-fourth": Fraction(1, 4), "one fourth": Fraction(1, 4),
                "quarter": Fraction(1, 4), "one-fifth": Fraction(1, 5)}


_NUMBER_WORDS = {"two": 2, "three": 3, "four": 4, "five": 5, "2": 2, "3": 3, "4": 4, "5": 5}
_KIN = re.compile(r"\b(brother|sister|son|daughter|child|heir|nephew|niece)(?:s|ren)?\b", re.I)
_DESCRIBED = re.compile(r"^\s*(?:her|his|their|the)\b|\b(?:two|three|four|five|[2-5])\s+(?:\w+\s+)?"
                        r"(?:brother|sister|son|daughter|child|heir|nephew|niece)", re.I)


def respondents_from_description(text: str) -> list:
    """"Her late husband's two brothers" is a description, not a name: one
    respondent per person, each a name gap with the relation."""
    kin = _KIN.search(text or "")
    if not (kin and _DESCRIBED.search(text)):
        return [text]
    count = next((v for w, v in _NUMBER_WORDS.items()
                  if re.search(rf"\b{w}\b", text, re.I)), 1)
    owner = re.sub(r"\b(?:two|three|four|five|\d)\b", "", text[:kin.start()], flags=re.I)
    owner = re.sub(r"^\s*(?:her|his|their)\b", "the petitioner's", owner.strip(), flags=re.I)
    owner = re.sub(r"'s\s*$", "", owner.strip()).strip()
    relation = kin.group(1).lower() + (f" of {owner}" if owner else "")
    return [f"[name of respondent to be provided], {relation}"] * count


def share_fraction(share: Optional[str]) -> Optional[Fraction]:
    """'1/3' or 'one-third share' -> Fraction(1, 3); None when not a share."""
    s = (share or "").lower()
    m = re.search(r"(\d+)\s*/\s*(\d+)", s)
    if m and 0 < int(m.group(1)) <= int(m.group(2)):
        return Fraction(int(m.group(1)), int(m.group(2)))
    return next((f for w, f in sorted(_SHARE_WORDS.items(), key=lambda x: -len(x[0]))
                 if w in s), None)

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
    suit_ref: Optional[str],
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
    # O.XXXIII R.2: schedule of the applicant's movable/immovable property with
    # estimated value (rendered as a gap when not given).
    property_schedule: Optional[Sequence[str]] = None,
    # The application IS the plaint (O.XXXIII R.2, R.8): its plaint particulars.
    # `petitioner_assets` is the PETITIONER's own property (preferred over the
    # older `property_schedule`); `suit_property_schedule` is the property sued
    # for. All optional.
    petitioner_assets: Optional[Sequence[str]] = None,
    suit_property_schedule: Optional[Sequence[str]] = None,
    respondent_names: Optional[Sequence[str]] = None,
    relief_claimed: Optional[str] = None,
    cause_of_action: Optional[str] = None,
    suit_valuation: Optional[int] = None,
    # how many defendants the brief names ("her husband's two brothers"), so each
    # unnamed one is impleaded as a visible gap; a partition suit is valued on the
    # market value of the plaintiff's share (s.37(1) TN CF & SV Act 1955).
    respondent_count: Optional[int] = None,
    property_value: Optional[int] = None,
    share_claimed: Optional[str] = None,
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

    names = [n for n in (respondent_names or []) if n.strip() and not SLOT_PATTERN.search(n)]
    if not names and respondent_name.strip() and not SLOT_PATTERN.search(respondent_name):
        names = [respondent_name]
    names = [m for n in names for m in respondents_from_description(n)]
    for i in range(len(names), max(respondent_count or 0, 1)):
        names.append(f"[name of respondent {i + 1} to be provided]")

    share = share_fraction(share_claimed)
    if property_value and share:
        suit_valuation = int(property_value * share)
    court_fee = (cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY,
                                               value=suit_valuation)]).fee
                 if suit_valuation else None)

    context: Dict[str, Any] = {
        "applicant": {"name": applicant_name, "parentage": applicant_parentage,
                      "address": applicant_address},
        "respondent": {"name": respondent_name, "parentage": respondent_parentage,
                       "address": respondent_address},
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "application_date": filing_date.isoformat(),
        "suit_ref": suit_ref if suit_ref and not SLOT_PATTERN.search(suit_ref) else None,
        "indigency_particulars": indigency_particulars,
        "undertakes_to_pay_if_decreed": undertakes_to_pay_if_decreed,
        "property_schedule": [i for i in (petitioner_assets or property_schedule
                                          or []) if i.strip()],
        "suit_property_schedule": [i for i in (suit_property_schedule or [])
                                   if i.strip()],
        "respondents": names,
        "share_claimed": share_claimed if share else None,
        "property_value": property_value if share else None,
        "court_fee": court_fee,
        "unverified_marker": _reg.marker_for("court_fee_ad_valorem_slabs") if court_fee else "",
        "relief_claimed": relief_claimed,
        "cause_of_action": cause_of_action,
        "suit_valuation": suit_valuation,
        "place": place,
    }
    return IndigentResult(refused=False, context=context)
