"""Petition for grant of Probate / Letters of Administration
— document pipeline (DPC book pp.50-52 and pp.53-55).

Both petitions share one 13-paragraph body under the Indian Succession Act 1925;
they differ only in the grant sought (probate = by the named executor; letters of
administration = by a beneficiary where there is no executor / executor declines)
and the filing court (probate: High Court testamentary jurisdiction; LoA: District
Judge). The book pleads the death, the will, its due execution before witnesses,
the bequest, the relatives (all made respondents), the assets schedule, the
undertaking to pay court fees on further assets, no-impediment, and jurisdiction.

Hard requirements (each refuses, no partial output):
  - The deceased and the date/place of death must be pleaded.
  - The will (its date) and its due execution in the presence of witnesses must be
    pleaded — probate/LoA-with-will presuppose a proved will.
  - For PROBATE, the petitioner must be the named executor (book para 11); for LoA
    the petitioner must plead standing as a beneficiary (book para 11).
  - The relatives (next-of-kin) must be listed and made respondents — mandatory
    citation of the kindred is fundamental to a testamentary grant.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "succession_grant.docx"
SPEC = "dpc-50-55"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


class GrantKind(Enum):
    PROBATE = "probate"
    LETTERS_OF_ADMINISTRATION = "letters_of_administration"


@dataclass(frozen=True)
class Relative:
    relation: str      # e.g. "Son", "Widow", "Brother"
    name: str
    address: str


@dataclass(frozen=True)
class SuccessionGrantResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> SuccessionGrantResult:
    return SuccessionGrantResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="succession_grant", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    grant_kind: GrantKind,
    petitioner_name: str,
    deceased_name: str,
    death_date: Optional[date],
    deceased_last_residence: str,
    will_date: Optional[date],
    will_duly_executed: bool,
    bequest_narrative: str,
    relatives: Sequence[Relative],
    petitioner_is_named_executor: bool,
    petitioner_standing: str,
    assets_schedule_ref: str,
    undertakes_further_court_fee: bool,
    no_impediment: bool,
    jurisdiction_basis: str,
    filing_date: date,
    place: str,
    # cause-title header. Optional.
    petitioner_parentage: Optional[str] = None,
    petitioner_address: Optional[str] = None,
    grant_court: Optional[str] = None,
    city: Optional[str] = None,
) -> SuccessionGrantResult:
    """Assemble the probate / letters-of-administration petition, or refuse."""

    # 1. the deceased and death must be pleaded.
    if death_date is None or not deceased_name.strip():
        return _refuse(
            "the petition must plead the deceased and the date of death; it is absent",
            code="succession_grant_death_not_pleaded",
            fields=("deceased_name", "death_date"),
        )

    # 2. the will and its due execution must be pleaded.
    if will_date is None:
        return _refuse(
            "a petition for probate / letters of administration with the will annexed "
            "must plead the will and its date; it is absent",
            code="succession_grant_will_not_pleaded", fields=("will_date",),
        )
    if not will_duly_executed:
        return _refuse(
            "the petition must plead that the will was duly executed by the deceased "
            "in the presence of the attesting witnesses; that averment is absent",
            code="succession_grant_will_execution_not_pleaded",
            fields=("will_duly_executed",),
        )

    # 3. standing depends on the grant sought.
    if grant_kind is GrantKind.PROBATE and not petitioner_is_named_executor:
        return _refuse(
            "probate can be granted only to an executor named in the will; the "
            "petitioner has not pleaded that he is the named executor (a beneficiary "
            "seeking a grant should apply for letters of administration with the will "
            "annexed)",
            code="succession_grant_probate_petitioner_not_executor",
            fields=("petitioner_is_named_executor",),
        )
    if (grant_kind is GrantKind.LETTERS_OF_ADMINISTRATION
            and not petitioner_standing.strip()):
        return _refuse(
            "a petition for letters of administration must plead the petitioner's "
            "standing (as a beneficiary named in the will); it is absent",
            code="succession_grant_loa_standing_not_pleaded",
            fields=("petitioner_standing",),
        )

    # 4. the kindred must be cited (listed + made respondents).
    if not relatives:
        return _refuse(
            "the description of the relatives of the deceased (the next-of-kin, to be "
            "made respondents and cited) must be set out; it is absent",
            code="succession_grant_relatives_not_listed", fields=("relatives",),
        )

    context: Dict[str, Any] = {
        "grant_kind": grant_kind.value,
        "grant_label": ("Probate" if grant_kind is GrantKind.PROBATE
                        else "Letters of Administration"),
        "is_probate": grant_kind is GrantKind.PROBATE,
        "petitioner": {"name": petitioner_name, "parentage": petitioner_parentage,
                       "address": petitioner_address},
        "deceased_name": deceased_name,
        "death_date": death_date,
        "deceased_last_residence": deceased_last_residence,
        "will_date": will_date,
        "will_duly_executed": will_duly_executed,
        "bequest_slot": bequest_narrative if bequest_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "relatives": [{"relation": r.relation, "name": r.name, "address": r.address}
                      for r in relatives],
        "petitioner_is_named_executor": petitioner_is_named_executor,
        "petitioner_standing": petitioner_standing,
        "assets_schedule_ref": assets_schedule_ref,
        "undertakes_further_court_fee": undertakes_further_court_fee,
        "no_impediment": no_impediment,
        "jurisdiction_basis": jurisdiction_basis,
        "grant_court": grant_court,
        "city": city,
        "case_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "has_witness_verification": True,
        "place": place,
    }
    return SuccessionGrantResult(refused=False, context=context)
