"""Coding Sheet — High Court registry cover / metadata sheet (TN/Madras forms set).

A coding sheet is the filing cover the registry uses to code a matter: case type,
filing/presentation dates (registry-filled), the parties and their counsel, the
value and court fee, the Act/provision involved, a subject-category code, connected
cases, and lower-court details. The forms set carried six side-specific variants
(Original / Appellate / Criminal / Writ / Caveat-Original / Caveat-Appellate); this
pipeline unifies them under `side` and forks the side-specific blocks in the
template. Generalised so the court name/place are placeholders.

This is a PARTY-FILED cover sheet (the party fills the black-ink portion; the
registry fills the case number and dates).

Hard requirements (each refuses, no partial output):
  - The side must be one of the recognised sides.
  - The petitioner/appellant and respondent parties must be named.
  - The Act / subject-matter must be stated (the sheet exists to code the matter;
    an uncoded sheet is useless to the registry).
  - CRIMINAL side, where an HCP (habeas corpus) is indicated, must name the
    detaining authority — an HCP coding sheet without the detaining authority is
    incomplete.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "coding_sheet.docx"
SPEC = "tn-coding"


class CodingSide(Enum):
    ORIGINAL = "original"
    APPELLATE = "appellate"
    CRIMINAL = "criminal"
    WRIT = "writ"
    CAVEAT_ORIGINAL = "caveat_original"
    CAVEAT_APPELLATE = "caveat_appellate"


@dataclass(frozen=True)
class CodingSheetResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> CodingSheetResult:
    return CodingSheetResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="coding_sheet", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    side: CodingSide,
    petitioner_name: str,
    respondent_name: str,
    act_and_provision: str,
    subject_matter: str,
    court_place: str,
    case_type: Optional[str] = None,
    petitioner_counsel: Optional[str] = None,
    respondent_counsel: Optional[str] = None,
    subject_category_code: Optional[str] = None,
    value_of_claim: Optional[str] = None,
    court_fee: Optional[str] = None,
    connected_case: Optional[str] = None,
    lower_court_details: Optional[str] = None,
    # criminal side
    in_jail: bool = False,
    crime_no: Optional[str] = None,
    police_station: Optional[str] = None,
    is_hcp: bool = False,
    detaining_authority: Optional[str] = None,
    # contempt sub-block (original side)
    order_violated: Optional[str] = None,
    senior_citizen: bool = False,
) -> CodingSheetResult:
    """Assemble the registry coding sheet, or refuse."""

    # 1. parties must be named.
    if not petitioner_name.strip() or not respondent_name.strip():
        return _refuse(
            "the coding sheet must name both the petitioner/appellant and the "
            "respondent; a party is missing",
            code="coding_sheet_parties_missing",
            fields=("petitioner_name", "respondent_name"),
        )

    # 2. the sheet exists to CODE the matter; the Act/subject must be present.
    if not act_and_provision.strip() or not subject_matter.strip():
        return _refuse(
            "the coding sheet must state the Act/provision of law involved and the "
            "subject-matter; these are the fields the registry codes the matter by",
            code="coding_sheet_subject_missing",
            fields=("act_and_provision", "subject_matter"),
        )

    # 3. criminal HCP must name the detaining authority.
    if side is CodingSide.CRIMINAL and is_hcp and not (
        detaining_authority and detaining_authority.strip()
    ):
        return _refuse(
            "a criminal-side coding sheet marked as an HCP (habeas corpus) must name "
            "the detaining authority; it is absent",
            code="coding_sheet_hcp_detaining_authority_missing",
            fields=("detaining_authority",),
        )

    context: Dict[str, Any] = {
        "side": side.value,
        "petitioner_name": petitioner_name,
        "respondent_name": respondent_name,
        "act_and_provision": act_and_provision,
        "subject_matter": subject_matter,
        "court_place": court_place,
        "case_type": case_type,
        "petitioner_counsel": petitioner_counsel,
        "respondent_counsel": respondent_counsel,
        "subject_category_code": subject_category_code,
        "value_of_claim": value_of_claim,
        "court_fee": court_fee,
        "connected_case": connected_case,
        "lower_court_details": lower_court_details,
        "in_jail": in_jail,
        "crime_no": crime_no,
        "police_station": police_station,
        "is_hcp": is_hcp,
        "detaining_authority": detaining_authority,
        "order_violated": order_violated,
        "senior_citizen": senior_citizen,
    }
    return CodingSheetResult(refused=False, context=context)
