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
import re
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..rules import court_fee as cf
from ..rules import interest as intr
from ..rules import jurisdiction as jur
from ..rules import limitation as lim
from ..rules.limitation import Acknowledgement
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from .plaint import (_ARTICLE_PERIOD_YEARS, _DEFAULT_ARTICLE_YEARS, ARTICLE_GAP,
                     address_lead, interest_basis_text)

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
# The instrument named in instrument_ref fixes the basis when none is given.
_BASIS_WORDS = (
    (ClaimBasis.BILL_OF_EXCHANGE, re.compile(r"\bcheque|bill of exchange|hundi", re.I)),
    (ClaimBasis.PROMISSORY_NOTE, re.compile(r"promissory|pro-?note", re.I)),
    (ClaimBasis.WRITTEN_CONTRACT, re.compile(r"agreement|contract|deed", re.I)),
)
# Art. 35: a bill of exchange or promissory note payable on demand (a cheque is one).
_ARTICLE_35 = ("35", "on a bill of exchange or promissory note payable on demand, "
                     "three years from the date of the bill or note")
_BASIS_GAP = "[claim basis under Order XXXVII Rule 1(2) to be provided]"

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
    claim_basis: Optional[ClaimBasis],
    instrument_ref: str,
    cause_of_action_date: Optional[date],
    cause_of_action_place: str,
    forum: jur.Forum,
    territorial_bases: Sequence[jur.TerritorialBasis],
    principal: int,
    interest_amount: Optional[int],
    claimed_total: Optional[int],
    interest_rate: float,
    interest_is_contractual: bool,
    interest_document_ref: Optional[str],
    limitation_article: Optional[str],
    limitation_trigger_date: Optional[date],
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
    # interest runs from this date (default: the cause of action), or each sum
    # from its own date — [(amount, from_date), ...] — e.g. two invoices.
    interest_from_date: Optional[date] = None,
    interest_tranches: Optional[Sequence[tuple]] = None,
    # the date of the bill / note (a cheque's date): Art. 35 runs from it.
    instrument_date: Optional[date] = None,
) -> SummarySuitResult:
    """Assemble the O37 summary suit plaint, or refuse."""

    if claim_basis is None:
        claim_basis = next((b for b, rx in _BASIS_WORDS if rx.search(instrument_ref or "")),
                           None)

    # 0. O37 scope — the claim must be within Order XXXVII Rule 1(2).
    if claim_basis is not None and claim_basis not in _IN_SCOPE:
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

    # 1a. missing interest / total are computed, never left blank or zero:
    #     simple interest at the stated rate up to the date of the plaint.
    tranches = [(int(a), d) for a, d in (interest_tranches or []) if a and d]
    interest_amount, claimed_total, interest_working = intr.fill_claim(
        principal, interest_amount, claimed_total, interest_rate,
        interest_from_date or cause_of_action_date, filing_date, tranches)

    # 2. jurisdiction — both limbs. Delegated refusals carry their own coded
    # Refusal; surface it without restating the code.
    forum, civil_court, city = jur.original_side_forum(forum, claimed_total, civil_court, city)
    pec = jur.check_pecuniary(value=claimed_total, forum=forum)
    if pec.refused:
        return _refuse_delegated(pec.reason, pec.computation, pec.refusal)
    ter = jur.check_territorial(bases=list(territorial_bases))
    if ter.refused:
        return _refuse_delegated(ter.reason, None, ter.refusal)

    # 3. limitation — reuse the module (s.18 restart). On a bill or note payable
    #    on demand, Art. 35 runs from the date of the instrument.
    on_instrument = claim_basis in (ClaimBasis.BILL_OF_EXCHANGE, ClaimBasis.PROMISSORY_NOTE)
    limitation_article = ((limitation_article or "").strip()
                          or (_ARTICLE_35[0] if on_instrument else ARTICLE_GAP))
    article_desc = _ARTICLE_35[1] if limitation_article == "35" else None
    if limitation_trigger_date is None:
        limitation_trigger_date = ((instrument_date if limitation_article == "35" else None)
                                   or cause_of_action_date)
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

    # 4a. interest can't exceed simple interest at the stated rate for the period
    #     (cause of action -> filing); claiming less is the plaintiff's choice.
    accrual_start = interest_from_date or cause_of_action_date
    if (interest_amount and interest_rate and not interest_working and not tranches
            and filing_date > accrual_start):
        days = (filing_date - accrual_start).days
        accrued = principal * interest_rate / 100 * days / 365
        if interest_amount > accrued * 1.01 + 1:
            return _refuse(
                f"interest claimed (Rs. {interest_amount}) exceeds simple interest at "
                f"{interest_rate}% on Rs. {principal} for {days} days (Rs. {round(accrued)})",
                code="summary_suit_interest_exceeds_accrued",
                fields=("interest_amount", "interest_rate", "principal"),
                computation=f"{principal} x {interest_rate}% x {days}/365 = {accrued:.2f}; "
                            f"claimed {interest_amount}",
            )

    # 5. interest basis (same rule as the ordinary plaint: agreed stays agreed).
    interest_basis = "contractual" if interest_is_contractual else "claimed"

    # 6. court fee.
    fee = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY, value=claimed_total)])

    context: Dict[str, Any] = {
        "plaintiff": {"name": plaintiff_name, "parentage": plaintiff_parentage,
                      "address": plaintiff_address,
                      "address_lead": address_lead(plaintiff_name)},
        "defendants": [
            {"name": n,
             "address": (defendant_addresses[i]
                         if defendant_addresses and i < len(defendant_addresses)
                         else None),
             "address_lead": address_lead(n)}
            for i, n in enumerate(defendant_names)
        ],
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "plaint_date": filing_date.isoformat(),
        "knowledge_para_last": 11,
        "claim_basis": claim_basis.value.replace("_", " ") if claim_basis else _BASIS_GAP,
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
                           "the pecuniary jurisdiction of this Hon'ble Court",
        "territorial_bases": [jur.basis_text(b) for b in ter.bases],
        # account statement
        "principal": principal,
        "interest_amount": interest_amount,
        "interest_working": interest_working,
        "claimed_total": claimed_total,
        "interest_rate": interest_rate,
        "interest_basis": interest_basis,
        "interest_basis_text": interest_basis_text(interest_rate, interest_is_contractual,
                                                   interest_document_ref),
        "interest_document_ref": interest_document_ref,
        "interest_fallback_note": None,
        # limitation
        "limitation_article": limitation_article,
        "limitation_article_desc": article_desc,
        "limitation_trigger_date": limitation_trigger_date,
        "limitation_expiry": (lim_result.expiry_date
                              if limitation_article != ARTICLE_GAP else None),
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
