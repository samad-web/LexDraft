"""Conveyancing deeds — document pipelines (DPC book Part B, pp.100-126).

Eleven deed types share one skeleton (component parts pp.91-99): TITLE (caps) →
date+place → parties (hereinafter called ...) → WHEREAS recitals → NOW THIS DEED
WITNESSES → operative clauses → SCHEDULE → IN WITNESS WHEREOF → signatures + two
witnesses. This module hosts all eleven, each a `build_*` returning a typed result;
the shared deed-level hard-stops live in helpers.

Deed-level hard-stops (each deed refuses on the ones that apply to it):
  - Parties must be named.
  - The property/subject must be identified (a deed of nothing is void).
  - Where the deed is FOR CONSIDERATION (sale, agreement-to-sell, mortgage), the
    consideration must be stated (s.27 Indian Stamp Act; and stamp duty turns on it).
  - Registration: a deed transferring immovable property of value > Rs.100 must be
    compulsorily registered (s.17 Registration Act) — the flag is surfaced, and for
    the sale deed / gift deed a missing registration intention is refused.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

SPEC = "dpc-100-126"


@dataclass(frozen=True)
class DeedResult:
    refused: bool
    template: str = ""
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(pipeline: str, reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> DeedResult:
    return DeedResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline=pipeline, spec=SPEC, fields=fields,
                        remedy_hint=remedy_hint),
    )


def _base_ctx(deed_title, execution_date, place, **extra):
    ctx = {
        "deed_title": deed_title,
        "execution_date": execution_date.isoformat() if execution_date else None,
        "place": place,
    }
    ctx.update(extra)
    return ctx


# ==========================================================================
# 1. WILL (pp.100-102) — first person, testator + two attesting witnesses.
# ==========================================================================

@dataclass(frozen=True)
class Bequest:
    property_desc: str
    beneficiary: str
    relation: str


def build_will(
    *,
    testator_name: str,
    testator_parentage: str,
    testator_address: str,
    execution_date: Optional[date],
    bequests: Sequence[Bequest],
    sound_mind_declared: bool,
    witnesses: Sequence[str],
    place: str,
    revokes_prior_wills: bool = True,
    executor_name: Optional[str] = None,
) -> DeedResult:
    """Assemble a Will, or refuse."""
    if not testator_name.strip():
        return _refuse("will", "the testator must be named; it is absent",
                       code="will_testator_not_named", fields=("testator_name",))
    if not bequests:
        return _refuse(
            "will", "a will must contain at least one bequest (to whom, and which "
            "property, is given); none is stated",
            code="will_no_bequest", fields=("bequests",))
    if not sound_mind_declared:
        return _refuse(
            "will", "the will must declare that the testator is of sound mind and "
            "makes it of his own free will; that declaration is absent",
            code="will_sound_mind_not_declared", fields=("sound_mind_declared",))
    if len(witnesses) < 2:
        return _refuse(
            "will", "a will must be attested by at least two witnesses (s.63 Indian "
            "Succession Act); fewer than two are provided",
            code="will_insufficient_witnesses", fields=("witnesses",))

    ctx = _base_ctx("WILL", execution_date, place,
                    testator={"name": testator_name, "parentage": testator_parentage,
                              "address": testator_address},
                    bequests=[{"property_desc": b.property_desc,
                               "beneficiary": b.beneficiary, "relation": b.relation}
                              for b in bequests],
                    revokes_prior_wills=revokes_prior_wills,
                    executor_name=executor_name,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="will.docx", context=ctx)


# ==========================================================================
# 2. GENERAL POWER OF ATTORNEY (pp.103-104)
# 3. SPECIAL POWER OF ATTORNEY to execute a sale deed (p.105)
# ==========================================================================

class POAKind(Enum):
    GENERAL = "general"
    SPECIAL_SALE = "special_sale"


def build_power_of_attorney(
    *,
    poa_kind: POAKind,
    executant_name: str,
    executant_description: str,
    attorney_name: str,
    attorney_description: str,
    powers: Sequence[str],
    execution_date: Optional[date],
    witnesses: Sequence[str],
    place: str,
    recitals: str = "",
    # special-sale specifics
    sale_property: str = "",
    sale_price: Optional[int] = None,
    purchaser_name: str = "",
    sale_agreement_ref: str = "",
) -> DeedResult:
    """Assemble a General / Special Power of Attorney, or refuse."""
    if not executant_name.strip() or not attorney_name.strip():
        return _refuse(
            "power_of_attorney",
            "a power of attorney must name both the executant (principal) and the "
            "attorney; one is absent",
            code="poa_parties_not_named",
            fields=("executant_name", "attorney_name"))

    if poa_kind is POAKind.SPECIAL_SALE:
        if not sale_property.strip():
            return _refuse(
                "power_of_attorney",
                "a special power of attorney to execute a sale deed must identify the "
                "property to be sold; it is absent",
                code="poa_special_sale_property_missing",
                fields=("sale_property",))
        _purchaser = purchaser_name or "or his heirs or assigns"
        _price = str(sale_price) if sale_price else "____"
        _under = f" under {sale_agreement_ref}" if sale_agreement_ref else ""
        powers_out = [
            f"To receive from the purchaser {_purchaser} the sum of Rs. {_price}/- "
            f"being the price agreed for the purchase of {sale_property}{_under}, and "
            f"to give an effectual receipt and discharge for the same;",
            "To execute a proper sale deed of the said property, or any other deed or "
            "assurance necessary for the completion of the sale, and to get the same "
            "duly registered;",
        ]
        title = "SPECIAL POWER OF ATTORNEY TO EXECUTE A SALE DEED"
        witnesseth = "NOW THIS SPECIAL POWER OF ATTORNEY WITNESSETH AS UNDER:"
    else:
        if not powers or not any(p.strip() for p in powers):
            return _refuse(
                "power_of_attorney",
                "a general power of attorney must set out the powers conferred on the "
                "attorney; none are stated",
                code="poa_general_no_powers", fields=("powers",))
        powers_out = [p for p in powers if p.strip()]
        title = "GENERAL POWER OF ATTORNEY"
        witnesseth = "NOW THIS GENERAL POWER OF ATTORNEY WITNESSETH AS UNDER:"

    ctx = _base_ctx(title, execution_date, place,
                    poa_kind=poa_kind.value,
                    witnesseth=witnesseth,
                    executant={"name": executant_name,
                               "description": executant_description},
                    attorney={"name": attorney_name,
                              "description": attorney_description},
                    recitals=recitals,
                    powers=powers_out,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="power_of_attorney.docx", context=ctx)


# ==========================================================================
# 4. AGREEMENT FOR SALE (pp.106-108)
# 5. SALE DEED (pp.109-111)
# ==========================================================================

def build_agreement_for_sale(
    *,
    vendor_name: str,
    vendor_description: str,
    vendee_name: str,
    vendee_description: str,
    property_desc: str,
    total_consideration: int,
    earnest_money: int,
    earnest_mode: str,
    completion_months: int,
    execution_date: Optional[date],
    witnesses: Sequence[str],
    place: str,
) -> DeedResult:
    """Assemble an Agreement for Sale, or refuse."""
    if not vendor_name.strip() or not vendee_name.strip():
        return _refuse("agreement_for_sale",
                       "the agreement must name both the vendor and the vendee; one "
                       "is absent",
                       code="agreement_for_sale_parties_not_named",
                       fields=("vendor_name", "vendee_name"))
    if not property_desc.strip():
        return _refuse("agreement_for_sale",
                       "the agreement must identify the property to be sold; it is "
                       "absent",
                       code="agreement_for_sale_property_missing",
                       fields=("property_desc",))
    if total_consideration <= 0:
        return _refuse("agreement_for_sale",
                       "the consideration for the sale must be stated (s.27 Indian "
                       "Stamp Act); it is absent or non-positive",
                       code="agreement_for_sale_no_consideration",
                       fields=("total_consideration",))

    ctx = _base_ctx("AGREEMENT FOR SALE", execution_date, place,
                    vendor={"name": vendor_name, "description": vendor_description},
                    vendee={"name": vendee_name, "description": vendee_description},
                    property_desc=property_desc,
                    total_consideration=total_consideration,
                    earnest_money=earnest_money, earnest_mode=earnest_mode,
                    completion_months=completion_months,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="agreement_for_sale.docx", context=ctx)


def build_sale_deed(
    *,
    vendor_name: str,
    vendor_description: str,
    vendee_name: str,
    vendee_description: str,
    property_desc: str,
    boundaries: Dict[str, str],           # {"east","west","north","south"}
    total_consideration: int,
    amount_already_paid: int,
    balance_paid_mode: str,
    prior_title_recital: str,
    to_be_registered: bool,
    execution_date: Optional[date],
    witnesses: Sequence[str],
    place: str,
) -> DeedResult:
    """Assemble a Sale Deed, or refuse."""
    if not vendor_name.strip() or not vendee_name.strip():
        return _refuse("sale_deed",
                       "the sale deed must name both the vendor and the vendee; one "
                       "is absent",
                       code="sale_deed_parties_not_named",
                       fields=("vendor_name", "vendee_name"))
    if not property_desc.strip():
        return _refuse("sale_deed",
                       "the sale deed must identify the property conveyed; it is "
                       "absent",
                       code="sale_deed_property_missing", fields=("property_desc",))
    if total_consideration <= 0:
        return _refuse("sale_deed",
                       "the sale consideration must be fully and truly set forth "
                       "(s.27 Indian Stamp Act); it is absent or non-positive",
                       code="sale_deed_no_consideration",
                       fields=("total_consideration",))
    if amount_already_paid > total_consideration:
        return _refuse("sale_deed",
                       f"the amount stated as already paid ({amount_already_paid}) "
                       f"exceeds the total consideration ({total_consideration})",
                       code="sale_deed_paid_exceeds_consideration",
                       fields=("amount_already_paid", "total_consideration"))
    if not to_be_registered:
        return _refuse("sale_deed",
                       "a sale deed of immovable property of value over Rs.100 must "
                       "be compulsorily registered (s.17 Registration Act); the "
                       "intention to register is not affirmed",
                       code="sale_deed_registration_not_intended",
                       fields=("to_be_registered",))

    balance = total_consideration - amount_already_paid
    ctx = _base_ctx("SALE DEED", execution_date, place,
                    vendor={"name": vendor_name, "description": vendor_description},
                    vendee={"name": vendee_name, "description": vendee_description},
                    property_desc=property_desc, boundaries=boundaries,
                    total_consideration=total_consideration,
                    amount_already_paid=amount_already_paid, balance=balance,
                    balance_paid_mode=balance_paid_mode,
                    prior_title_recital=prior_title_recital,
                    to_be_registered=to_be_registered,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="sale_deed.docx", context=ctx)


# ==========================================================================
# 6. LEASE DEED (pp.112-115)
# ==========================================================================

def build_lease_deed(
    *,
    lessor_name: str,
    lessor_description: str,
    lessee_name: str,
    lessee_description: str,
    property_desc: str,
    term_months: int,
    commencement_date: Optional[date],
    monthly_rent: int,
    escalation_note: str,
    security_deposit: int,
    notice_months: int,
    execution_date: Optional[date],
    witnesses: Sequence[str],
    place: str,
) -> DeedResult:
    """Assemble a Lease Deed, or refuse."""
    if not lessor_name.strip() or not lessee_name.strip():
        return _refuse("lease_deed",
                       "the lease must name both the lessor and the lessee; one is "
                       "absent",
                       code="lease_deed_parties_not_named",
                       fields=("lessor_name", "lessee_name"))
    if not property_desc.strip():
        return _refuse("lease_deed",
                       "the lease must identify the demised premises; it is absent",
                       code="lease_deed_property_missing", fields=("property_desc",))
    if term_months <= 0:
        return _refuse("lease_deed",
                       "the term of the lease must be stated; it is absent or "
                       "non-positive",
                       code="lease_deed_no_term", fields=("term_months",))
    if monthly_rent <= 0:
        return _refuse("lease_deed",
                       "the rent reserved by the lease must be stated; it is absent "
                       "or non-positive",
                       code="lease_deed_no_rent", fields=("monthly_rent",))

    ctx = _base_ctx("LEASE DEED", execution_date, place,
                    lessor={"name": lessor_name, "description": lessor_description},
                    lessee={"name": lessee_name, "description": lessee_description},
                    property_desc=property_desc, term_months=term_months,
                    commencement_date=(commencement_date.isoformat()
                                       if commencement_date else None),
                    monthly_rent=monthly_rent, escalation_note=escalation_note,
                    security_deposit=security_deposit, notice_months=notice_months,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="lease_deed.docx", context=ctx)


# ==========================================================================
# 7. MORTGAGE DEED (pp.116-117) — simple mortgage.
# ==========================================================================

def build_mortgage_deed(
    *,
    mortgagor_name: str,
    mortgagor_description: str,
    mortgagee_name: str,
    mortgagee_description: str,
    property_desc: str,
    principal: int,
    interest_rate: float,
    repayment_terms: str,
    purpose_recital: str,
    execution_date: Optional[date],
    witnesses: Sequence[str],
    place: str,
) -> DeedResult:
    """Assemble a simple Mortgage Deed, or refuse."""
    if not mortgagor_name.strip() or not mortgagee_name.strip():
        return _refuse("mortgage_deed",
                       "the mortgage must name both the mortgagor and the mortgagee; "
                       "one is absent",
                       code="mortgage_deed_parties_not_named",
                       fields=("mortgagor_name", "mortgagee_name"))
    if not property_desc.strip():
        return _refuse("mortgage_deed",
                       "the mortgage must identify the mortgaged property; it is "
                       "absent",
                       code="mortgage_deed_property_missing",
                       fields=("property_desc",))
    if principal <= 0:
        return _refuse("mortgage_deed",
                       "the principal sum secured by the mortgage must be stated; it "
                       "is absent or non-positive",
                       code="mortgage_deed_no_principal", fields=("principal",))

    ctx = _base_ctx("DEED OF MORTGAGE", execution_date, place,
                    mortgagor={"name": mortgagor_name,
                               "description": mortgagor_description},
                    mortgagee={"name": mortgagee_name,
                               "description": mortgagee_description},
                    property_desc=property_desc, principal=principal,
                    interest_rate=interest_rate, repayment_terms=repayment_terms,
                    purpose_recital=purpose_recital, witnesses=list(witnesses))
    return DeedResult(refused=False, template="mortgage_deed.docx", context=ctx)


# ==========================================================================
# 8. PARTNERSHIP DEED (pp.118-119)
# 9. DEED OF DISSOLUTION OF PARTNERSHIP (pp.120-121)
# ==========================================================================

@dataclass(frozen=True)
class Partner:
    name: str
    description: str
    share_pct: int


def build_partnership_deed(
    *,
    firm_name: str,
    partners: Sequence[Partner],
    business_nature: str,
    principal_place: str,
    commencement_date: Optional[date],
    capital_note: str,
    at_will: bool,
    execution_date: Optional[date],
    witnesses: Sequence[str],
    place: str,
) -> DeedResult:
    """Assemble a Partnership Deed, or refuse."""
    if len(partners) < 2:
        return _refuse("partnership_deed",
                       "a partnership must have at least two partners; fewer than two "
                       "are provided",
                       code="partnership_deed_insufficient_partners",
                       fields=("partners",))
    if not firm_name.strip():
        return _refuse("partnership_deed",
                       "the name and style of the partnership firm must be stated; it "
                       "is absent",
                       code="partnership_deed_no_firm_name", fields=("firm_name",))
    total_share = sum(p.share_pct for p in partners)
    if total_share != 100:
        return _refuse("partnership_deed",
                       f"the partners' shares in profits and losses must total 100%; "
                       f"they total {total_share}%",
                       code="partnership_deed_shares_not_100",
                       fields=("partners",))

    ctx = _base_ctx("DEED OF PARTNERSHIP", execution_date, place,
                    firm_name=firm_name,
                    partners=[{"name": p.name, "description": p.description,
                               "share_pct": p.share_pct} for p in partners],
                    business_nature=business_nature, principal_place=principal_place,
                    commencement_date=(commencement_date.isoformat()
                                       if commencement_date else None),
                    capital_note=capital_note, at_will=at_will,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="partnership_deed.docx", context=ctx)


def build_dissolution_deed(
    *,
    firm_name: str,
    partners: Sequence[Partner],
    original_deed_ref: str,
    dissolution_date: Optional[date],
    accounts_settled: bool,
    records_custodian: str,
    execution_date: Optional[date],
    witnesses: Sequence[str],
    place: str,
) -> DeedResult:
    """Assemble a Deed of Dissolution of Partnership, or refuse."""
    if len(partners) < 2:
        return _refuse("dissolution_deed",
                       "a dissolution deed must name the partners of the dissolved "
                       "firm (at least two); fewer than two are provided",
                       code="dissolution_deed_insufficient_partners",
                       fields=("partners",))
    if dissolution_date is None:
        return _refuse("dissolution_deed",
                       "the date with effect from which the partnership is dissolved "
                       "must be stated; it is absent",
                       code="dissolution_deed_no_date",
                       fields=("dissolution_date",))
    if not original_deed_ref.strip():
        return _refuse("dissolution_deed",
                       "the original partnership deed being dissolved must be "
                       "identified; it is absent",
                       code="dissolution_deed_original_not_identified",
                       fields=("original_deed_ref",))

    ctx = _base_ctx("DEED OF DISSOLUTION OF PARTNERSHIP", execution_date, place,
                    firm_name=firm_name,
                    partners=[{"name": p.name, "description": p.description}
                              for p in partners],
                    original_deed_ref=original_deed_ref,
                    dissolution_date=dissolution_date.isoformat(),
                    accounts_settled=accounts_settled,
                    records_custodian=records_custodian,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="dissolution_deed.docx", context=ctx)


# ==========================================================================
# 10. RELINQUISHMENT DEED (pp.122-123)
# ==========================================================================

@dataclass(frozen=True)
class Releasor:
    name: str
    description: str


def build_relinquishment_deed(
    *,
    releasors: Sequence[Releasor],
    releasee_name: str,
    releasee_description: str,
    property_desc: str,
    deceased_owner: str,
    releasors_share: str,          # e.g. "4/5th"
    for_consideration: bool,       # relinquishment for love/affection = False
    execution_date: Optional[date],
    witnesses: Sequence[str],
    place: str,
) -> DeedResult:
    """Assemble a Relinquishment Deed, or refuse."""
    if not releasors:
        return _refuse("relinquishment_deed",
                       "a relinquishment deed must name the releasor(s) giving up "
                       "their share; none are provided",
                       code="relinquishment_deed_no_releasors",
                       fields=("releasors",))
    if not releasee_name.strip():
        return _refuse("relinquishment_deed",
                       "the releasee in whose favour the share is relinquished must "
                       "be named; it is absent",
                       code="relinquishment_deed_no_releasee",
                       fields=("releasee_name",))
    if not property_desc.strip():
        return _refuse("relinquishment_deed",
                       "the property in which the share is relinquished must be "
                       "identified; it is absent",
                       code="relinquishment_deed_property_missing",
                       fields=("property_desc",))

    ctx = _base_ctx("DEED OF RELINQUISHMENT", execution_date, place,
                    releasors=[{"name": r.name, "description": r.description}
                               for r in releasors],
                    releasee={"name": releasee_name,
                              "description": releasee_description},
                    property_desc=property_desc, deceased_owner=deceased_owner,
                    releasors_share=releasors_share,
                    for_consideration=for_consideration,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="relinquishment_deed.docx", context=ctx)


# ==========================================================================
# 11. GIFT DEED (pp.124-126)
# ==========================================================================

def build_gift_deed(
    *,
    donor_name: str,
    donor_description: str,
    donee_name: str,
    donee_description: str,
    relation: str,
    property_desc: str,
    boundaries: Dict[str, str],
    market_value: int,
    possession_delivered: bool,
    to_be_registered: bool,
    prior_title_recital: str,
    execution_date: Optional[date],
    witnesses: Sequence[str],
    place: str,
) -> DeedResult:
    """Assemble a Gift Deed, or refuse."""
    if not donor_name.strip() or not donee_name.strip():
        return _refuse("gift_deed",
                       "the gift deed must name both the donor and the donee; one is "
                       "absent",
                       code="gift_deed_parties_not_named",
                       fields=("donor_name", "donee_name"))
    if not property_desc.strip():
        return _refuse("gift_deed",
                       "the gift deed must identify the property gifted; it is absent",
                       code="gift_deed_property_missing", fields=("property_desc",))
    # s.123 TPA: a gift of immovable property must be effected by a registered
    # instrument; and s.122 requires acceptance/delivery.
    if not to_be_registered:
        return _refuse("gift_deed",
                       "a gift of immovable property must be effected by a registered "
                       "instrument (s.123 of the Transfer of Property Act); the "
                       "intention to register is not affirmed",
                       code="gift_deed_registration_not_intended",
                       fields=("to_be_registered",))
    if not possession_delivered:
        return _refuse("gift_deed",
                       "a gift is completed by acceptance and delivery of possession "
                       "during the donor's lifetime (s.122 TPA); delivery of "
                       "possession is not affirmed",
                       code="gift_deed_possession_not_delivered",
                       fields=("possession_delivered",))

    ctx = _base_ctx("GIFT DEED", execution_date, place,
                    donor={"name": donor_name, "description": donor_description},
                    donee={"name": donee_name, "description": donee_description},
                    relation=relation, property_desc=property_desc,
                    boundaries=boundaries, market_value=market_value,
                    possession_delivered=possession_delivered,
                    to_be_registered=to_be_registered,
                    prior_title_recital=prior_title_recital,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="gift_deed.docx", context=ctx)
