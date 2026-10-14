"""Affidavit of service — proof that notice was taken out and returned unserved.

Where a court notice has been taken out on a respondent and the registered cover has
come back unserved, the party (through the registered clerk of, or counsel for, the
petitioner) files an affidavit deposing to the fact — that the notice returnable on
a stated date was duly taken out by registered post, and that the cover was returned
with the postal endorsement (the addressee having "left", or having "refused" the
cover, or the cover being "unclaimed"). The affidavit lays the foundation for the
court to treat service as complete or to order substituted service. The form is
generalised for any state and any court — the court name and place are placeholders.
PARTY-FILED (affidavit of the advocate's registered clerk / counsel).

Hard requirements (each refuses, no partial output):
  - The deponent must be named — an affidavit is the sworn statement of an
    identified person and is a nullity without a deponent.
  - The returnable date of the notice must be given — an affidavit of service must
    identify the very notice whose return it proves; without it there is nothing to
    depose to.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "affidavit_of_service.docx"
SPEC = "tn-affsvc"


class Endorsement(Enum):
    LEFT = "left"
    REFUSED = "refused"
    UNCLAIMED = "unclaimed"


@dataclass(frozen=True)
class AffidavitOfServiceResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> AffidavitOfServiceResult:
    return AffidavitOfServiceResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="affidavit_of_service", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    # All optional — this is a fill-in court form; a missing value renders as the
    # form's blank line for the advocate to complete. Defaults keep the blanks
    # empty so the template prints its underscore fill-in.
    deponent_name: str = "",
    deponent_role: str = "",
    petitioner_name: str = "",
    respondent_name: str = "",
    notice_returnable_date: Optional[date] = None,
    endorsement: Optional[Endorsement] = None,
    case_ref: str = "",
    place: str = "",
    deponent_parentage: Optional[str] = None,
    deponent_age: Optional[str] = None,
    deponent_address: Optional[str] = None,
    religion: Optional[str] = None,
    court_place: Optional[str] = None,
    court_name: Optional[str] = None,
    affirm_date: Optional[date] = None,
    # The advocate form carries TWO case-reference lines — the interlocutory
    # application number (I.A. No.) and the suit number (O.S. No.) — each with its
    # year. All optional: a blank renders as a fill-in "___ of 20__" on the form.
    ia_no: Optional[str] = None,
    ia_year: Optional[str] = None,
    os_no: Optional[str] = None,
    os_year: Optional[str] = None,
) -> AffidavitOfServiceResult:
    """Assemble the affidavit of service.

    This is a FILL-IN COURT FORM (the advocate's printed form has blank lines for
    the deponent, dates, and endorsement). So a missing value is NOT a refusal —
    it renders as the form's blank fill-in line for the advocate to complete by
    hand or in the editor. The template guards every field with `{% if %}` and
    prints an underscore blank when absent. (Contrast the standalone `affidavit`
    doc-type, which is free-form and does require a named deponent.)
    """

    context: Dict[str, Any] = {
        # Missing name/role render as blank fill-in lines on the form (never a
        # refusal — the advocate completes them).
        "deponent_name": deponent_name,
        "deponent_role": deponent_role,
        "deponent_parentage": deponent_parentage,
        "deponent_age": deponent_age,
        "deponent_address": deponent_address,
        "religion": religion,
        "petitioner_name": petitioner_name,
        "respondent_name": respondent_name,
        # Returnable date optional: blank -> the form's "returnable by ___ 20__".
        "notice_returnable_date": (
            notice_returnable_date.isoformat() if notice_returnable_date else None
        ),
        # Endorsement optional: blank -> the form's "has left / has refused to
        # receive / has not claimed" (all three, for the advocate to strike out).
        "endorsement": endorsement.value if endorsement else None,
        "case_ref": case_ref,
        "affirm_date": affirm_date.isoformat() if affirm_date else None,
        "case_year": affirm_date.year if affirm_date else None,
        "court_place": court_place,
        "court_name": court_name,
        "place": place,
        # Two case-reference lines on the advocate form (I.A. No. / O.S. No.).
        "ia_no": ia_no,
        "ia_year": ia_year,
        "os_no": os_no,
        "os_year": os_year,
    }
    return AffidavitOfServiceResult(refused=False, context=context)
