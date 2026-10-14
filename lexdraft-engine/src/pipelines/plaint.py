"""Plaint for money recovery — document pipeline (spec 4.1).

Consumes standalone rules modules:
  - court_fee   : ad valorem / fixed / relief-linked fee + valuation basis.
  - jurisdiction: pecuniary (refuse + name forum if over limit) + territorial
    (s.20 CPC, >=1 basis).
  - limitation  : article-period computation and s.18 acknowledgement restart —
    REUSED, not reimplemented.

Hard requirements (each refuses, no partial output):
  - Cause of action needs date AND place.
  - Jurisdiction pleaded expressly, both limbs.
  - Limitation within time (s.18 acknowledgements restart the period).
  - principal + interest == claimed total (recomputed).
  - Government defendant -> s.80 CPC notice averment.
  - Commercial suit -> s.12A mediation certificate/exemption (+ statement of truth).

Contractual interest without a document reference falls back to statutory and
says so (does NOT refuse). LLM slots are paragraphs 3, 5, 6, 9 only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..rules import court_fee as cf
from ..rules import jurisdiction as jur
from ..rules import limitation as lim
from ..rules.limitation import Acknowledgement  # re-export for callers
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity

TEMPLATE = "plaint.docx"
SPEC = "4.1"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"

# Limitation Act Schedule — article -> period in years, loaded from
# verify/tables/limitation_article_periods.json (with a default for unlisted
# articles). Summary suit re-imports both names from here.
_ARTICLE_PERIODS = _reg.values("limitation_article_periods")
_ARTICLE_PERIOD_YEARS = dict(_ARTICLE_PERIODS["articles"])
_DEFAULT_ARTICLE_YEARS = _ARTICLE_PERIODS["default_years"]


class Variant(Enum):
    INDIVIDUAL = "individual"
    PARTNERSHIP = "partnership"     # O30
    COMPANY = "company"
    GOVERNMENT = "government"        # O27 + s.80
    MINOR = "minor"                 # O32
    # NB: O37 summary suit is a SEPARATE skeleton — deliberately not here.


@dataclass(frozen=True)
class PlaintResult:
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
) -> PlaintResult:
    """Build a refused result carrying a stable code. Every plaint refusal
    goes through here so none can be code-less."""
    return PlaintResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            computation=computation, pipeline="plaint", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def _refuse_delegated(reason: str, computation: Optional[str],
                      refusal: Optional[Refusal]) -> PlaintResult:
    """Surface a rules-module refusal (already carrying its own Refusal) without
    restating the code."""
    return PlaintResult(
        refused=True, reason=reason, context=None, refusal=refusal,
    )


def _slot(text: str) -> str:
    return text if text.strip() else _LLM_SLOT_PLACEHOLDER


def build(
    *,
    plaintiff_name: str,
    defendant_names: Sequence[str],
    variant: Variant,
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
    is_government_defendant: bool,
    s80_notice_ref: Optional[str],
    is_commercial_suit: bool,
    s12a_ref: Optional[str],
    transaction_narrative: str,
    performance_narrative: str,
    default_narrative: str,
    notice_narrative: str,
    place: str,
    # cause-title header (DPC book). Optional.
    plaintiff_parentage: Optional[str] = None,
    plaintiff_address: Optional[str] = None,
    defendant_addresses: Optional[Sequence[str]] = None,
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
) -> PlaintResult:
    """Assemble the plaint, or refuse."""

    # 1. cause of action: date AND place.
    if cause_of_action_date is None:
        return _refuse(
            "cause of action requires a date; it is missing",
            code="plaint_cause_of_action_date_missing",
            fields=("cause_of_action_date",),
        )
    if not cause_of_action_place.strip():
        return _refuse(
            "cause of action requires a place; it is missing",
            code="plaint_cause_of_action_place_missing",
            fields=("cause_of_action_place",),
        )

    # 2. jurisdiction — both limbs, expressly. Delegated refusals carry their
    # own coded Refusal; surface it without restating the code.
    pec = jur.check_pecuniary(value=claimed_total, forum=forum)
    if pec.refused:
        return _refuse_delegated(pec.reason, pec.computation, pec.refusal)
    ter = jur.check_territorial(bases=list(territorial_bases))
    if ter.refused:
        return _refuse_delegated(ter.reason, None, ter.refusal)

    # 3. limitation — reuse the module; s.18 acknowledgements restart.
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
            code="plaint_limitation_time_barred",
            fields=("limitation_article", "limitation_trigger_date",
                    "acknowledgements", "filing_date"),
            computation=lim_result.computation,
        )

    # 4. arithmetic — principal + interest == claimed total.
    if principal + interest_amount != claimed_total:
        return _refuse(
            f"account statement arithmetic does not reconcile: principal "
            f"{principal} + interest {interest_amount} = "
            f"{principal + interest_amount}, but the claimed total is {claimed_total}",
            code="plaint_arithmetic_mismatch",
            fields=("principal", "interest_amount", "claimed_total"),
            computation=f"principal {principal} + interest {interest_amount} = "
                        f"{principal + interest_amount}; claimed total {claimed_total}",
        )

    # 5. interest — contractual needs a document ref; else statutory fallback.
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

    # 6. s.80 CPC — Government defendant.
    if is_government_defendant and not (s80_notice_ref and s80_notice_ref.strip()):
        return _refuse(
            "the defendant is the Government/a public officer; a notice under "
            "s.80 CPC is mandatory and its averment is missing",
            code="plaint_s80_cpc_notice_missing",
            fields=("is_government_defendant", "s80_notice_ref"),
        )

    # 7. s.12A — commercial suit.
    if is_commercial_suit and not (s12a_ref and s12a_ref.strip()):
        return _refuse(
            "commercial suit requires a s.12A pre-institution mediation "
            "certificate or a pleaded exemption; it is missing",
            code="plaint_s12a_mediation_missing",
            fields=("is_commercial_suit", "s12a_ref"),
        )

    # 8. court fee (money relief).
    fee = cf.compute(reliefs=[cf.Relief(kind=cf.ReliefKind.MONEY, value=claimed_total)])

    context: Dict[str, Any] = {
        "variant": variant.value,
        "plaintiff": {"name": plaintiff_name, "parentage": plaintiff_parentage,
                      "address": plaintiff_address},
        "defendants": [
            {"name": n,
             "address": (defendant_addresses[i]
                         if defendant_addresses and i < len(defendant_addresses)
                         else None)}
            for i, n in enumerate(defendant_names)
        ],
        # cause-title header fields (render only when present).
        "civil_court": civil_court,
        "city": city,
        "case_year": filing_date.year,
        "plaint_date": filing_date.isoformat(),
        "knowledge_para_last": 13,
        # cause of action
        "cause_of_action_date": cause_of_action_date,
        "cause_of_action_place": cause_of_action_place,
        # jurisdiction (both limbs)
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
        "limitation_computation": lim_result.computation,
        # court fee
        "court_fee": fee.fee,
        "valuation_basis": fee.valuation_basis,
        # unverified marker — set while any consumed VERIFY table (court-fee slabs,
        # pecuniary limits, limitation-article periods) is not advocate-verified.
        # Empty string once all are signed off; the banner then renders blank.
        "unverified_marker": _reg.marker_for(
            "court_fee_ad_valorem_slabs", "court_fee_fixed_fees",
            "pecuniary_limits", "limitation_article_periods",
        ),
        # conditional averments
        "is_government_defendant": is_government_defendant,
        "s80_notice_ref": s80_notice_ref,
        "is_commercial_suit": is_commercial_suit,
        "s12a_ref": s12a_ref,
        "has_verification": True,
        "has_statement_of_truth": bool(is_commercial_suit),
        # LLM slots (paras 3, 5, 6, 9)
        "transaction_slot": _slot(transaction_narrative),
        "performance_slot": _slot(performance_narrative),
        "default_slot": _slot(default_narrative),
        "notice_slot": _slot(notice_narrative),
        "place": place,
    }
    return PlaintResult(refused=False, context=context)
