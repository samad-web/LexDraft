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

Contractual interest is pleaded as the agreed rate; a missing document reference
is a visible gap, never a relabel to "statutory" (2026-11-07 senior review: an 18%
claim called "statutory" contradicted itself). The article, its trigger date and
the cause of action are derived when the brief fixes them (Art. 14 runs from the
delivery of the goods; each invoice date is a date of the cause of action).
LLM slots are paragraphs 3, 5, 6, 9 only.
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
from ..rules.limitation import Acknowledgement  # re-export for callers
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from ..verify.signoff import SLOT_PATTERN

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


# A firm or company does not "reside" anywhere: it has a place of business.
_ENTITY = re.compile(r"^\s*m/s\b|\b(?:ltd|limited|llp|pvt|private|company|corporation|"
                     r"bank|firm|enterprises?|traders|industries)\b|&\s*co\b", re.I)


_HONORIFIC = r"(?:Mr|Mrs|Ms|Dr|Thiru|Tmt|Selvi|Sri|Smt)\.?\s"


def rep_by(representative: Optional[str]) -> Optional[str]:
    """'Mr. G. Venkatesh, managing partner' / 'managing partner Mr. G. Venkatesh' ->
    'rep. by its Managing Partner Mr. G. Venkatesh' for a firm's cause title (b2 item 2)."""
    rep = (representative or "").strip().rstrip(".,;")
    if not rep or rep.startswith("["):
        return None
    m = (re.match(rf"^(?P<name>{_HONORIFIC}.+?)\s*,\s*(?:its\s+|the\s+)?(?P<role>[A-Za-z ]+)$", rep)
         or re.match(rf"^(?:its\s+|the\s+)?(?P<role>[A-Za-z ]+?)\s*,?\s+(?P<name>{_HONORIFIC}.+)$", rep, re.I))
    if not m:
        return f"rep. by {rep}"
    return f"rep. by its {m['role'].strip().title()} {m['name'].strip()}"


def address_lead(name: str, is_entity: bool = False) -> str:
    """'residing at' for a person, 'having its place of business at' for a firm."""
    return ("having its place of business at" if is_entity or _ENTITY.search(name or "")
            else "residing at")


# What a money suit is for -> (Limitation Act article, what that article provides).
CLAIM_ARTICLES = {
    "price_of_goods_sold": ("14", "for the price of goods sold and delivered where no "
                                  "fixed period of credit is agreed upon, three years "
                                  "from the date of delivery of the goods"),
    "money_lent": ("19", "for money payable for money lent, three years from when "
                         "the loan is made"),
}
ARTICLE_GAP = "[limitation article to be provided]"

# Commercial Courts Act, 2015: a commercial dispute (s.2(1)(c)) of a specified value
# of Rs. 3,00,000 or more (s.2(1)(i), as amended in 2018) goes to a Commercial Court.
SPECIFIED_VALUE = 300000
S12A_GAP = ("[particulars of the s.12A pre-institution mediation (non-starter or failure "
            "report of the Legal Services Authority) to be provided]")


def commercial_basis(variant: "Variant", defendant_names: Sequence[str],
                     claim_for: Optional[str], value: int) -> Optional[str]:
    """Why the suit is a commercial dispute, or None. Shortcut: only the sale of goods
    between business entities is recognised; other s.2(1)(c) heads need the flag."""
    firms = variant in (Variant.PARTNERSHIP, Variant.COMPANY) and defendant_names and all(
        _ENTITY.search(n or "") for n in defendant_names)
    if not (firms and claim_for == "price_of_goods_sold" and value >= SPECIFIED_VALUE):
        return None
    return ("The dispute arises out of an ordinary transaction of merchants and traders, "
            "namely the sale and supply of goods between business entities, and is a "
            "commercial dispute within Section 2(1)(c)(i) of the Commercial Courts Act, "
            f"2015, of a specified value of Rs. {value}/-, which is not less than "
            "Rs. 3,00,000/-.")


def commercial_court(forum: jur.Forum, city: Optional[str]) -> tuple:
    """(heading, case-number prefix) for a commercial suit in Tamil Nadu."""
    if forum is jur.Forum.HIGH_COURT_OS:
        return ("IN THE HIGH COURT OF JUDICATURE AT MADRAS (ORDINARY ORIGINAL CIVIL "
                "JURISDICTION) (COMMERCIAL DIVISION)", "C.S. (Comm. Div.)")
    c = (city or "").strip()
    if forum is jur.Forum.CITY_CIVIL_COURT or c.lower() == "chennai":
        return "IN THE COMMERCIAL COURT AT CHENNAI", "C.O.S."
    where = c.upper() if c and not c.startswith("[") else "[district to be provided]"
    return f"IN THE COURT OF THE PRINCIPAL DISTRICT JUDGE (COMMERCIAL COURT), {where}", "C.O.S."
RATE_DOC_GAP = "[document fixing the agreed rate of interest to be provided]"
_AGREEMENT_DATED = re.compile(r"\b((?:written\s+|registered\s+)?(?:loan\s+)?agreement\s+dated\s+\d{2}\.\d{2}\.\d{4})", re.I)


def rate_document(ref: Optional[str], *texts: str) -> Optional[str]:
    """The document fixing an agreed rate; none given -> the agreement the facts name
    ("the written loan agreement dated 15.01.2026"), never a gap the brief answers (b2)."""
    if (ref or "").strip() and not (ref or "").strip().startswith("["):
        return ref
    m = next((m for t in texts if (m := _AGREEMENT_DATED.search(t or ""))), None)
    return f"the {m.group(1)}" if m else ref


_INTEREST_AGREED = re.compile(r"\bagreed\b[^.]*\binterest\b|\binterest\b[^.]*\bagreed\b", re.I)


def rate_is_agreed(contractual: bool, ref: Optional[str], *texts: str) -> bool:
    """An interest rate is pleaded as agreed only when a document fixes it or the facts
    say it was agreed. Otherwise it is the rate claimed: no invented agreement (b2)."""
    if not contractual:
        return False
    named = (ref or "").strip()
    return (bool(named) and not named.startswith("[")) or any(_INTEREST_AGREED.search(t or "") for t in texts)


def interest_basis_text(rate: float, contractual: bool, ref: Optional[str], claimed: bool = False) -> str:
    """How the interest claim is pleaded. An agreed rate stays agreed; its missing
    document is a gap for the advocate, never a relabel to 'statutory'."""
    at = f"at {rate:g}% per annum"
    if not contractual:
        return f"{at}, being the rate claimed by the plaintiff" if claimed else at
    return f"{at}, the rate agreed between the parties, vide {(ref or '').strip() or RATE_DOC_GAP}"


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
    interest_amount: Optional[int],
    claimed_total: Optional[int],
    interest_rate: float,
    interest_is_contractual: bool,
    interest_document_ref: Optional[str],
    limitation_article: Optional[str],
    limitation_trigger_date: Optional[date],
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
    plaintiff_representative: Optional[str] = None,
    plaintiff_address: Optional[str] = None,
    defendant_addresses: Optional[Sequence[str]] = None,
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
    # interest runs from this date (default: the cause of action), or each sum
    # from its own date — [(amount, from_date), ...] — e.g. two invoices.
    interest_from_date: Optional[date] = None,
    interest_tranches: Optional[Sequence[tuple]] = None,
    # what the money is due for (a CLAIM_ARTICLES key) — fixes the article when
    # none is pleaded; and the date the legal notice was served, if any.
    claim_for: Optional[str] = None,
    legal_notice_served_date: Optional[date] = None,
) -> PlaintResult:
    """Assemble the plaint, or refuse."""

    # 0. the date of each transaction sued on (each invoice) is a date of the cause
    #    of action; with none pleaded, the earliest one is the cause of action.
    tranches = [(int(a), d) for a, d in (interest_tranches or []) if a and d]
    coa_dates = sorted({d for _, d in tranches})
    if cause_of_action_date is None and coa_dates:
        cause_of_action_date = coa_dates[0]

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

    # 1a. missing interest / total are computed, never left blank or zero:
    #     simple interest at the stated rate up to the date of the plaint.
    interest_amount, claimed_total, interest_working = intr.fill_claim(
        principal, interest_amount, claimed_total, interest_rate,
        interest_from_date or cause_of_action_date, filing_date, tranches)

    # 2. jurisdiction — both limbs, expressly. Delegated refusals carry their
    # own coded Refusal; surface it without restating the code.
    pecuniary_text = jur.pecuniary_basis(claimed_total, forum, civil_court)
    forum, civil_court, city = jur.original_side_forum(forum, claimed_total, civil_court, city)
    # 2a. a commercial dispute of a specified value -> Commercial Court, s.12A, O.VI R.15A.
    basis = commercial_basis(variant, defendant_names, claim_for, claimed_total)
    if basis and not is_commercial_suit:
        is_commercial_suit, s12a_ref = True, (s12a_ref or "").strip() or S12A_GAP
    heading, case_prefix = commercial_court(forum, city) if is_commercial_suit else (None, None)
    # the cause of action arises where both parties carry on business, when they share the city
    if SLOT_PATTERN.search(cause_of_action_place or "") and city and not city.strip().startswith("[")             and all(city.lower() in (a or "").lower()
                    for a in [plaintiff_address, *(defendant_addresses or [])]):
        cause_of_action_place = city.strip()
    pec =jur.check_pecuniary(value=claimed_total, forum=forum)
    if pec.refused:
        return _refuse_delegated(pec.reason, pec.computation, pec.refusal)
    ter = jur.check_territorial(bases=list(territorial_bases))
    if ter.refused:
        return _refuse_delegated(ter.reason, None, ter.refusal)

    # 3. limitation — reuse the module; s.18 acknowledgements restart. The article
    #    follows from what the claim is for; Art. 14 runs from the delivery of the
    #    goods (the earliest invoice), otherwise time runs from the cause of action.
    article_for, article_desc = CLAIM_ARTICLES.get(claim_for or "", (None, None))
    limitation_article = (limitation_article or "").strip() or article_for or ARTICLE_GAP
    if limitation_article != article_for:
        article_desc = None
    if limitation_trigger_date is None:
        limitation_trigger_date = (coa_dates[0] if limitation_article == "14" and coa_dates
                                   else cause_of_action_date)
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

    # 4a. interest can't exceed simple interest at the stated rate for the period
    #     the suit covers (cause of action -> filing). Claiming LESS is the plaintiff's
    #     choice; claiming more than has accrued is a defective plaint.
    accrual_start = interest_from_date or cause_of_action_date
    if (interest_amount and interest_rate and not interest_working and not tranches
            and filing_date > accrual_start):
        days = (filing_date - accrual_start).days
        accrued = principal * interest_rate / 100 * days / 365
        if interest_amount > accrued * 1.01 + 1:
            return _refuse(
                f"interest claimed (Rs. {interest_amount}) exceeds simple interest at "
                f"{interest_rate}% on Rs. {principal} for {days} days (Rs. {round(accrued)})",
                code="plaint_interest_exceeds_accrued",
                fields=("interest_amount", "interest_rate", "principal"),
                computation=f"{principal} x {interest_rate}% x {days}/365 = {accrued:.2f}; "
                            f"claimed {interest_amount}",
            )

    # 5. interest — an agreed rate is pleaded as agreed (its document, or a gap).
    agreed = rate_is_agreed(interest_is_contractual, interest_document_ref, transaction_narrative,
                            performance_narrative, default_narrative, notice_narrative)
    rate_only_claimed, interest_is_contractual = interest_is_contractual and not agreed, agreed
    interest_basis = "contractual" if interest_is_contractual else "claimed"

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
                      "address": plaintiff_address,
                      "representative": plaintiff_representative,
                      "rep_by": (rep_by(plaintiff_representative)
                                 if variant in (Variant.PARTNERSHIP, Variant.COMPANY)
                                 or _ENTITY.search(plaintiff_name or "") else None),
                      "address_lead": address_lead(
                          plaintiff_name, variant in (Variant.PARTNERSHIP, Variant.COMPANY))},
        "defendants": [
            {"name": n,
             "address": (defendant_addresses[i]
                         if defendant_addresses and i < len(defendant_addresses)
                         else None),
             "address_lead": address_lead(n)}
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
        "cause_of_action_dates": coa_dates if len(coa_dates) > 1 else [],
        "legal_notice_served_date": legal_notice_served_date,
        "cause_of_action_place": cause_of_action_place,
        # jurisdiction (both limbs)
        "forum": forum.value,
        "pecuniary_basis": pecuniary_text,
        "territorial_bases": [jur.basis_text(b) for b in ter.bases],
        # account statement
        "principal": principal,
        "interest_amount": interest_amount,
        "interest_working": interest_working,
        "claimed_total": claimed_total,
        "interest_rate": interest_rate,
        "interest_basis": interest_basis,
        "interest_basis_text": interest_basis_text(interest_rate, interest_is_contractual,
                                                   interest_document_ref, rate_only_claimed),
        "interest_document_ref": interest_document_ref,
        "interest_fallback_note": None,
        # limitation
        "limitation_article": limitation_article,
        "limitation_article_desc": article_desc,
        "limitation_trigger_date": limitation_trigger_date,
        # an expiry is pleaded only once the article is known
        "limitation_expiry": (lim_result.expiry_date
                              if limitation_article != ARTICLE_GAP else None),
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
        "commercial_basis": basis,
        "commercial_heading": heading,
        "commercial_case_no": case_prefix,
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
