"""Summary suit under Order XXXVII CPC — document pipeline (spec 4.1, separate skeleton).

A SEPARATE skeleton from the ordinary plaint (src.pipelines.plaint), not a
variant. O37 has its own scope and its own structural averments:

  - The claim must arise on a written contract, a bill of exchange, a promissory
    note, or a debt / liquidated demand arising from an enactment (O37 R1(2)).
    Any other basis -> refuse; O37 is unavailable.
  - The plaint must STATE (a) that it is filed under Order XXXVII, and (b) that no
    relief outside the scope of the Order is claimed.
  - Summons for judgment follows institution.
  - The defendant has NO right to defend without leave.

The general suit checks (cause of action date+place, jurisdiction both limbs,
limitation with s.18 restart, arithmetic, court fee) are the SAME as the ordinary
plaint and reuse the same rules modules.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..rules import court_fee as cf
from ..rules import jurisdiction as jur
from ..rules import limitation as lim
from ..rules.limitation import Acknowledgement
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from .plaint import _ARTICLE_PERIOD_YEARS, _DEFAULT_ARTICLE_YEARS

TEMPLATE = "summary_suit.docx"
SPEC = "4.1"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


class ClaimBasis(Enum):
    WRITTEN_CONTRACT = "written_contract"
    BILL_OF_EXCHANGE = "bill_of_exchange"
    PROMISSORY_NOTE = "promissory_note"
    ENACTMENT_DEBT = "enactment_debt"       # debt/liquidated demand under an enactment
    OTHER = "other"                          # NOT within O37 scope


# Bases that require a specific instrument reference to be pleaded.
_INSTRUMENT_BASES = {
    ClaimBasis.BILL_OF_EXCHANGE,
    ClaimBasis.PROMISSORY_NOTE,
    ClaimBasis.WRITTEN_CONTRACT,
}
_IN_SCOPE = {
    ClaimBasis.WRITTEN_CONTRACT,
    ClaimBasis.BILL_OF_EXCHANGE,
    ClaimBasis.PROMISSORY_NOTE,
    ClaimBasis.ENACTMENT_DEBT,
}


@dataclass(frozen=True)
class SummarySuitResult:
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
) -> SummarySuitResult:
    """Build a refused result carrying a stable code. Every summary-suit refusal
    goes through here so none can be code-less."""
    return SummarySuitResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            computation=computation, pipeline="summary_suit", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def _refuse_delegated(reason: str, computation: Optional[str],
                      refusal: Optional[Refusal]) -> SummarySuitResult:
    """Surface a rules-module refusal (already carrying its own Refusal) without
    restating the code."""
    return SummarySuitResult(
        refused=True, reason=reason, context=None, refusal=refusal,
    )


def build(
    *,
    plaintiff_name: str,
    defendant_names: Sequence[str],
    claim_basis: ClaimBasis,
    instrument_ref: str,
    cause_of_action_date: Optional[date],
    cause_of_action_place: str,
    forum: jur.Forum,
    territorial_bases: Sequence[jur.TerritorialBasis],
    principal: int,
    interest_amount: int,
    claimed_total: int,
    interest_rate: float,
    interest_is_contractual: bool,
    interest_document_ref: Optional[str],
    limitation_article: str,
    limitation_trigger_date: date,
    acknowledgements: Sequence[Acknowledgement],
    filing_date: date,
    transaction_narrative: str,
    place: str,
    # cause-title header (DPC book pp.10-12). Optional.
    plaintiff_parentage: Optional[str] = None,
    plaintiff_address: Optional[str] = None,
    defendant_addresses: Optional[Sequence[str]] = None,
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
) -> SummarySuitResult:
    """Assemble the O37 summary suit plaint, or refuse."""

    # 0. O37 scope — the claim must be within Order XXXVII Rule 1(2).
    if claim_basis not in _IN_SCOPE:
        return _refuse(
            "the claim does not fall within the scope of Order XXXVII (written "
            "contract, bill of exchange, promissory note, or a liquidated demand "
            "arising from an enactment); a summary suit is not maintainable",
            code="summary_suit_out_of_o37_scope",
            fields=("claim_basis",),
        )
    if claim_basis in _INSTRUMENT_BASES and not instrument_ref.strip():
        return _refuse(
            f"a summary suit on a {claim_basis.value} requires the instrument to be "
            f"identified",
            code="summary_suit_instrument_ref_missing",
            fields=("claim_basis", "instrument_ref"),
        )

    # 1. cause of action: date AND place.
    if cause_of_action_date is None:
        return _refuse(
            "cause of action requires a date; it is missing",
            code="summary_suit_cause_of_action_date_missing",
            fields=("cause_of_action_date",),
        )
    if not cause_of_action_place.strip():
        return _refuse(
            "cause of action requires a place; it is missing",
            code="summary_suit_cause_of_action_place_missing",
            fields=("cause_of_action_place",),
        )

    # 2. jurisdiction — both limbs. Delegated refusals carry their own coded
    # Refusal; surface it without restating the code.
    pec = jur.check_pecuniary(value=claimed_total, forum=forum)
    if pec.refused:
        return _refuse_delegated(pec.reason, pec.computation, pec.refusal)
    ter = jur.check_territorial(bases=list(territorial_bases))
    if ter.refused:
        return _refuse_delegated(ter.reason, None, ter.refusal)

    # 3. limitation — reuse the module (s.18 restart).
    period_years = _ARTICLE_PERIOD_YEARS.get(limitation_article, _DEFAULT_ARTICLE_YEARS)
    lim_result = lim.compute(
        accrual_date=limitation_trigger_date,
        period_years=period_years,
        proceeding_class=lim.ProceedingClass.SUIT,
        acknowledgements=list(acknowledgements),
    )
    if not lim.is_within_time(lim_result, filing_date=filing_date):
        return _refuse(
            f"suit is barred by limitation: Article {limitation_article} "
            f"({period_years} years) from {limitation_trigger_date} expired on "
            f"{lim_result.expiry_date}; filing on {filing_date} is out of time",
            code="summary_suit_limitation_time_barred",
            fields=("limitation_article", "limitation_trigger_date",
                    "acknowledgements", "filing_date"),
            computation=lim_result.computation,
        )

    # 4. arithmetic.
    if principal + interest_amount != claimed_total:
        return _refuse(
            f"account statement arithmetic does not reconcile: principal "
            f"{principal} + interest {interest_amount} = "
            f"{principal + interest_amount}, but the claimed total is {claimed_total}",
            code="summary_suit_arithmetic_mismatch",
            fields=("principal", "interest_amount", "claimed_total"),
            computation=f"principal {principal} + interest {interest_amount} = "
                        f"{principal + interest_amount}; claimed total {claimed_total}",
        )

    # 5. interest basis (same rule as the ordinary plaint).
    if interest_is_contractual and interest_document_ref and interest_document_ref.strip():
        interest_basis = "contractual"
        interest_fallback_note = None
    else:
        interest_basis = "statutory"
        interest_fallback_note = (
            "the contractual rate is not supported by a document reference; "
            "interest is therefore claimed at the statutory rate"
            if interest_is_contractual else None
        )

    # 6. court fee.
    fee = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY, value=claimed_total)])

    context: Dict[str, Any] = {
        "plaintiff": {"name": plaintiff_name, "parentage": plaintiff_parentage,
                      "address": plaintiff_address},
        "defendants": [
            {"name": n,
             "address": (defendant_addresses[i]
                         if defendant_addresses and i < len(defendant_addresses)
                         else None)}
            for i, n in enumerate(defendant_names)
        ],
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "plaint_date": filing_date.isoformat(),
        "knowledge_para_last": 11,
        "claim_basis": claim_basis.value.replace("_", " "),
        "instrument_ref": instrument_ref,
        # O37 structural averments
        "under_order_37": True,
        "no_relief_outside_scope": True,
        "summons_for_judgment": True,
        "no_defence_without_leave": True,
        # cause of action
        "cause_of_action_date": cause_of_action_date,
        "cause_of_action_place": cause_of_action_place,
        # jurisdiction
        "forum": forum.value,
        "pecuniary_basis": f"the suit is valued at Rs. {claimed_total}/-, within "
                           f"the pecuniary jurisdiction of the {forum.value}",
        "territorial_bases": [b.value for b in ter.bases],
        # account statement
        "principal": principal,
        "interest_amount": interest_amount,
        "claimed_total": claimed_total,
        "interest_rate": interest_rate,
        "interest_basis": interest_basis,
        "interest_document_ref": interest_document_ref,
        "interest_fallback_note": interest_fallback_note,
        # limitation
        "limitation_article": limitation_article,
        "limitation_trigger_date": limitation_trigger_date,
        "limitation_expiry": lim_result.expiry_date,
        "limitation_restarted": lim_result.acknowledgement_applied,
        # court fee
        "court_fee": fee.fee,
        "valuation_basis": fee.valuation_basis,
        # unverified marker — same consumed VERIFY tables as the ordinary plaint.
        "unverified_marker": _reg.marker_for(
            "court_fee_ad_valorem_slabs", "court_fee_fixed_fees",
            "pecuniary_limits", "limitation_article_periods",
        ),
        "has_verification": True,
        # LLM slot
        "transaction_slot": transaction_narrative if transaction_narrative.strip()
                            else _LLM_SLOT_PLACEHOLDER,
        "place": place,
    }
    return SummarySuitResult(refused=False, context=context)
