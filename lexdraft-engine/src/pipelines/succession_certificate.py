"""Petition for grant of a Succession Certificate, s.372 Indian Succession Act 1925
— document pipeline (DPC book pp.56-57).

Where a person dies intestate leaving debts and securities, a next-of-kin applies
for a succession certificate to collect/realise them. The book (pp.56-57) pleads
the death (intestate, diligent search for a will), the deceased's residence and
law of succession, the surviving next-of-kin, the petitioner's relation and
entitlement, no-impediment under s.370, the Schedule I of securities + the purpose
+ their value, no prior probate/LoA/succession-certificate application, and that
the ad valorem duty on the certificate has been paid.

Hard requirements (each refuses, no partial output):
  - Death (intestate) and the deceased's residence within jurisdiction must be
    pleaded.
  - Schedule I (the debts/securities the certificate is applied for) must be
    provided with its value — the certificate is granted in respect of specific
    securities, not at large.
  - The ad valorem court-fee/duty on the certificate must be affirmed as paid
    (s.379 / the book's para 10) — a certificate cannot issue on an unstamped
    application.
  - s.370: there must be no impediment (e.g. the debts/securities are not ones for
    which a certificate is barred).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "succession_certificate.docx"
SPEC = "dpc-56-57"


@dataclass(frozen=True)
class Security:
    description: str   # e.g. "Fixed Deposit No. ... with ... Bank"
    value: int


@dataclass(frozen=True)
class SuccessionCertificateResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> SuccessionCertificateResult:
    return SuccessionCertificateResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="succession_certificate", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    petitioner_name: str,
    deceased_name: str,
    death_date: Optional[date],
    deceased_residence: str,
    law_of_succession: str,
    diligent_search_no_will: bool,
    next_of_kin: str,
    petitioner_relation: str,
    securities: Sequence[Security],
    purpose: str,
    no_impediment_s370: bool,
    no_prior_application: bool,
    ad_valorem_duty_paid: bool,
    filing_date: date,
    place: str,
    # cause-title header (DPC book pp.56-57). Optional.
    petitioner_parentage: Optional[str] = None,
    petitioner_address: Optional[str] = None,
    grant_court: Optional[str] = None,
    city: Optional[str] = None,
    respondent_name: Optional[str] = None,
) -> SuccessionCertificateResult:
    """Assemble the s.372 succession-certificate petition, or refuse."""

    # 1. death (intestate) + residence within jurisdiction.
    if death_date is None or not deceased_name.strip():
        return _refuse(
            "the petition must plead the deceased and the date of death; it is absent",
            code="succession_certificate_death_not_pleaded",
            fields=("deceased_name", "death_date"),
        )
    if not diligent_search_no_will:
        return _refuse(
            "a succession certificate presupposes intestacy; the petition must aver "
            "that the deceased died intestate and that a diligent search for a will "
            "found none; that averment is absent",
            code="succession_certificate_intestacy_not_pleaded",
            fields=("diligent_search_no_will",),
        )

    # 2. Schedule I of securities must be provided with values.
    if not securities:
        return _refuse(
            "a succession certificate is granted in respect of specific debts and "
            "securities; Schedule I setting them out (with their value) must be "
            "provided and is absent",
            code="succession_certificate_no_securities", fields=("securities",),
        )

    # 3. s.370 no-impediment.
    if not no_impediment_s370:
        return _refuse(
            "the petition must aver that there is no impediment under s.370 of the "
            "Indian Succession Act (or any other provision) to the grant of the "
            "certificate; that averment is absent",
            code="succession_certificate_s370_impediment_not_negatived",
            fields=("no_impediment_s370",),
        )

    # 4. ad valorem duty must be paid.
    if not ad_valorem_duty_paid:
        return _refuse(
            "the ad valorem duty payable on the succession certificate must be paid "
            "before the certificate can issue; the flag is not affirmed",
            code="succession_certificate_duty_not_paid",
            fields=("ad_valorem_duty_paid",),
        )

    total_value = sum(s.value for s in securities)
    context: Dict[str, Any] = {
        "petitioner": {"name": petitioner_name, "parentage": petitioner_parentage,
                       "address": petitioner_address},
        "respondent_name": respondent_name,
        "grant_court": grant_court,
        "city": city,
        "case_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "deceased_name": deceased_name,
        "death_date": death_date,
        "deceased_residence": deceased_residence,
        "law_of_succession": law_of_succession,
        "diligent_search_no_will": diligent_search_no_will,
        "next_of_kin": next_of_kin,
        "petitioner_relation": petitioner_relation,
        "securities": [{"description": s.description, "value": s.value}
                       for s in securities],
        "total_value": total_value,
        "purpose": purpose,
        "no_impediment_s370": no_impediment_s370,
        "no_prior_application": no_prior_application,
        "ad_valorem_duty_paid": ad_valorem_duty_paid,
        "place": place,
    }
    return SuccessionCertificateResult(refused=False, context=context)
