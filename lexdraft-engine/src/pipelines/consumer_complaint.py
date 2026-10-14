"""Consumer complaint — Consumer Protection Act 2019 — pipeline (spec 7.1).

Hard checks / behaviours:
  - Consumer status (s.2(7)): a COMMERCIAL PURPOSE refuses with an explanation.
    EXCEPTION — goods/services obtained for self-employment to earn a livelihood
    are NOT a commercial purpose and must NOT refuse.
  - Pecuniary tier from the CONSIDERATION PAID (not the compensation claimed):
    District / State / National.
  - Limitation: two years from the cause of action (via src.rules.limitation).
    Exceeded -> auto-attach the condonation application, NOT refuse (same pattern
    as the s.142(b) proviso in the s.138 complaint).
  - Compensation, where a figure is claimed, must have a stated basis.
  - Both the affidavit and the evidence affidavit are required.

LLM slots are paragraphs 4 (defect/deficiency) and 5 (complaints made and response).

VERIFY (advocate review — joins the court-fee slab batch): the pecuniary tier
thresholds below are indicative and must be checked against the current CPA 2019
notifications. `TIERS_ARE_VERIFY` is True.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional

from ..rules import limitation as lim
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity

TEMPLATE = "consumer_complaint.docx"
SPEC = "7.1"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_LIMITATION_YEARS = 2

# TIERS_ARE_VERIFY stays True until the tier table is signed off in
# verify/tables/consumer_pecuniary_tiers.json.
TIERS_ARE_VERIFY = _reg.marker_for("consumer_pecuniary_tiers") != ""


class Purpose(Enum):
    PERSONAL = "personal"
    SELF_EMPLOYMENT_LIVELIHOOD = "self_employment_livelihood"  # NOT commercial
    COMMERCIAL = "commercial"                                   # -> refuse


class ForumTier(Enum):
    DISTRICT = "district"
    STATE = "state"
    NATIONAL = "national"


# Pecuniary tier ceilings (Rs), by CONSIDERATION paid. Loaded from
# verify/tables/consumer_pecuniary_tiers.json (string keys -> ForumTier). A
# consideration above the State ceiling routes to National (no ceiling).
PECUNIARY_TIERS = {
    ForumTier(tier): ceiling
    for tier, ceiling in _reg.values("consumer_pecuniary_tiers").items()
}


@dataclass(frozen=True)
class ConsumerResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(
    reason: str,
    *,
    code: str,
    fields: tuple = (),
    computation: Optional[str] = None,
    remedy_hint: str = "none",
) -> ConsumerResult:
    return ConsumerResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            computation=computation, pipeline="consumer_complaint", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def _forum_tier(consideration_paid: int) -> ForumTier:
    if consideration_paid <= PECUNIARY_TIERS[ForumTier.DISTRICT]:
        return ForumTier.DISTRICT
    if consideration_paid <= PECUNIARY_TIERS[ForumTier.STATE]:
        return ForumTier.STATE
    return ForumTier.NATIONAL


def build(
    *,
    complainant_name: str,
    opposite_party_name: str,
    purpose: Purpose,
    consideration_paid: int,
    transaction_date: date,
    invoice_ref: str,
    cause_of_action_date: date,
    filing_date: date,
    compensation: int,
    compensation_basis: str,
    affidavit_present: bool,
    evidence_affidavit_present: bool,
    territorial_basis: str,
    place: str,
    defect_narrative: str,
    complaints_narrative: str,
    # cause-title header (DPC book). Optional.
    commission_place: Optional[str] = None,
) -> ConsumerResult:
    """Assemble the consumer complaint, or refuse."""

    # 1. consumer status (s.2(7)) — commercial purpose refuses; self-employment
    #    for livelihood is the statutory exception and does NOT refuse.
    if purpose is Purpose.COMMERCIAL:
        return _refuse(
            "the goods/services were obtained for a commercial purpose; the "
            "complainant is not a 'consumer' under s.2(7) of the Consumer "
            "Protection Act 2019. (Note: purchase for self-employment to earn a "
            "livelihood is not a commercial purpose.)",
            code="consumer_commercial_purpose_not_consumer",
            fields=("purpose",),
        )

    # 2. compensation basis (only where a figure is claimed).
    if compensation > 0 and not compensation_basis.strip():
        return _refuse(
            "the compensation claimed must have a stated basis, not a bare figure",
            code="consumer_compensation_no_basis",
            fields=("compensation", "compensation_basis"),
        )

    # 3. both affidavits required.
    if not affidavit_present:
        return _refuse(
            "the complaint must be supported by an affidavit",
            code="consumer_affidavit_absent", fields=("affidavit_present",),
        )
    if not evidence_affidavit_present:
        return _refuse(
            "an evidence affidavit is required and is absent",
            code="consumer_evidence_affidavit_absent",
            fields=("evidence_affidavit_present",),
        )

    # 4. pecuniary tier from the consideration paid (not the compensation).
    tier = _forum_tier(consideration_paid)

    # 5. limitation — 2 years from cause of action (reuse the module). Exceeded ->
    #    auto-attach condonation, NOT refuse.
    lim_result = lim.compute(
        accrual_date=cause_of_action_date,
        period_years=_LIMITATION_YEARS,
        proceeding_class=lim.ProceedingClass.APPLICATION,
    )
    in_time = lim.is_within_time(lim_result, filing_date=filing_date)
    condonation_required = not in_time

    context: Dict[str, Any] = {
        "complainant": {"name": complainant_name},
        "opposite_party": {"name": opposite_party_name},
        # cause-title header fields (render only when present).
        "commission_place": commission_place,
        "complaint_year": filing_date.year,
        "complaint_date": filing_date.isoformat(),
        "is_consumer": True,
        "purpose": purpose.value,
        "consideration_paid": consideration_paid,
        "transaction_date": transaction_date,
        "invoice_ref": invoice_ref,
        "forum_tier": tier,
        "forum_tier_label": tier.value,
        # unverified marker — set while the consumer pecuniary-tier table is not
        # advocate-verified (the tier drives the forum this is filed in).
        "unverified_marker": _reg.marker_for("consumer_pecuniary_tiers"),
        "cause_of_action_date": cause_of_action_date,
        "limitation_expiry": lim_result.expiry_date,
        "condonation_required": condonation_required,
        "compensation": compensation,
        "compensation_basis": compensation_basis,
        "affidavit_present": affidavit_present,
        "evidence_affidavit_present": evidence_affidavit_present,
        "territorial_basis": territorial_basis,
        # LLM slots (paras 4, 5)
        "defect_slot": defect_narrative if defect_narrative.strip()
                       else _LLM_SLOT_PLACEHOLDER,
        "complaints_slot": complaints_narrative if complaints_narrative.strip()
                           else _LLM_SLOT_PLACEHOLDER,
        "place": place,
    }
    return ConsumerResult(refused=False, context=context)
