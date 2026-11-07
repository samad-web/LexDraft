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

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..components.amount_words import rupees_in_words
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


# --- party grammar: gender/number so pronouns read correctly ---------------
_MALE = {"mr", "thiru", "thiruvalar", "shri", "sri", "master"}
_FEMALE = {"mrs", "ms", "smt", "tmt", "selvi", "kumari", "miss", "km"}
_ENTITY = re.compile(r"^\s*m/s\b|\b(ltd|limited|llp|bank|company|corporation|trust|"
                     r"society|firm)\b", re.I)
_PRON = {"male": ("he", "his", "him"), "female": ("she", "her", "her"),
         "entity": ("it", "its", "it"), "": ("he/she", "his/her", "him/her")}


def gender_of(name: str, gender: str = "") -> str:
    """Explicit gender ('male'/'female'/'entity') wins; else the honorific
    (Mr./Mrs./Smt./Thiru/Selvi, M/s.) decides; else '' (pronoun reads his/her)."""
    g = (gender or "").strip().lower()
    if g in ("male", "female", "entity"):
        return g
    if _ENTITY.search(name or ""):
        return "entity"
    m = re.match(r"\s*([A-Za-z]+)", name or "")
    tok = m.group(1).lower() if m else ""
    return "male" if tok in _MALE else "female" if tok in _FEMALE else ""


def party(name: str, description: str = "", gender: str = "") -> Dict[str, Any]:
    """A deed party with its pronouns and the 'which expression shall include …'
    tail (heirs for a person, successors for a firm/company)."""
    g = gender_of(name, gender)
    he, his, him = _PRON[g]
    succ = ("its successors-in-interest and assigns" if g == "entity" else
            f"{his} heirs, executors, administrators, legal representatives and assigns")
    return {"name": name, "description": description, "gender": g,
            "he": he, "his": his, "him": him, "succ": succ}


def group(parties: Sequence[Dict[str, Any]], singular: str, plural: str) -> Dict[str, Any]:
    """Number for a list of parties: 'Releasor'/'Releasors' and the matching
    pronouns (one party takes that party's own pronouns)."""
    if len(parties) == 1:
        p = parties[0]
        return {"label": singular, "plural": False, "he": p["he"], "his": p["his"],
                "him": p["him"], "has": "has", "is": "is", "s": "s", "es": "es",
                "succ": p["succ"]}
    return {"label": plural, "plural": True, "he": "they", "his": "their",
            "him": "them", "has": "have", "is": "are", "s": "", "es": "",
            "succ": "their respective heirs, executors, administrators, legal "
                    "representatives and assigns"}


def rs(amount: int) -> str:
    """'Rs. 3000000/- (Rupees thirty lakh only)' — the served copy groups digits."""
    return f"Rs. {amount}/- (Rupees {rupees_in_words(amount)} only)"


def gap(value: Any, what: str) -> Any:
    """A missing fact never gets invented: it renders as a bracketed gap."""
    if isinstance(value, str):
        value = value.strip()
    return value if value else f"[{what} to be provided]"


def _lower1(s: str) -> str:
    return s[:1].lower() + s[1:]


def _ordinal(n: int) -> str:
    return "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def bounds(boundaries: Dict[str, str]) -> Dict[str, str]:
    return {k: gap((boundaries or {}).get(k, ""), f"{k} boundary")
            for k in ("north", "south", "east", "west")}


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
    testator_age: Optional[int] = None,
    residuary_beneficiary: str = "",
    family_recital: str = "",
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

    # Without a stated family, recite only what the will itself shows: who the
    # beneficiaries are and how they are related (never a guessed full family).
    if not family_recital.strip():
        named = [f"my {b.relation.strip().lower()} {b.beneficiary}" if b.relation.strip()
                 else b.beneficiary for b in bequests]
        named = list(dict.fromkeys(named))
        family_recital = ("The beneficiaries under this Will are "
                          + (", ".join(named[:-1]) + " and " + named[-1]
                             if len(named) > 1 else named[0]) + ".")
    ctx = _base_ctx("WILL", execution_date, place,
                    testator={"name": testator_name, "parentage": testator_parentage,
                              "address": testator_address,
                              "age": gap(testator_age, "age of the testator")},
                    bequests=[{"property_desc": b.property_desc,
                               "beneficiary": b.beneficiary, "relation": b.relation}
                              for b in bequests],
                    family_recital=family_recital.strip(),
                    residuary_beneficiary=gap(residuary_beneficiary,
                                              "residuary legatee"),
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
    schedule_property: str = "",
    executed_abroad: bool = False,
    excluded_powers: Sequence[str] = (),
) -> DeedResult:
    """Assemble a General / Special Power of Attorney, or refuse."""
    # A limitation the brief states ("no power to sell") is NOT a power: it goes
    # to the proviso, never into the list of acts the attorney may do.
    excluded = [e.strip() for e in excluded_powers if e.strip()]
    kept = []
    for p in powers:
        (excluded if _NEGATIVE_POWER.match(p) else kept).append(p.strip())
    powers = kept
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
        if schedule_property.strip():  # the full forms speak of "the Schedule Property"
            powers_out = _expand_powers(powers_out)
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
                    # "No power to sell the flat" -> "sell the flat" (the proviso says
                    # "nothing ... authorises the Attorney to …").
                    excluded_powers=[_lower1(_NEGATIVE_LEAD.sub("", e).rstrip(" .;"))
                                     for e in excluded],
                    schedule_property=schedule_property.strip(),
                    executed_abroad=executed_abroad,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="power_of_attorney.docx", context=ctx)


_NEGATIVE_LEAD = re.compile(r"^\s*(?:(?:no power|no authority|shall not|cannot|not)\s+)?"
                            r"(?:to\s+)?", re.I)
_NEGATIVE_POWER = re.compile(r"\s*(no power|not to|shall not|cannot|no authority)\b", re.I)

# A terse power from the brief ("collect rent") is written out in full conveyancing
# form — each expansion stays inside the power stated, it never adds a new one.
_POWER_FORMS = (
    (re.compile(r"\bmanag|look after|maint", re.I),
     "To manage, look after, maintain and supervise the Schedule Property, to carry "
     "out necessary repairs, and to engage persons for its upkeep;"),
    (re.compile(r"\blet\b|\blet out|\blease|\brent out|tenan", re.I),
     "To let out the Schedule Property on such rent and terms as the Attorney thinks "
     "fit, to sign, execute and, where required, register rental or lease agreements, "
     "and to receive advances and security deposits and issue receipts for them;"),
    (re.compile(r"\bcollect|\brent\b|\brents\b", re.I),
     "To demand, collect and receive the rents, deposits and other moneys due in "
     "respect of the Schedule Property, to give valid receipts and discharges, and to "
     "take steps to recover arrears of rent;"),
    (re.compile(r"\btax|\bdues|\bcharges|\bbills", re.I),
     "To pay property tax, water and sewerage charges, electricity charges, "
     "maintenance and association charges and all other dues in respect of the "
     "Schedule Property, and to obtain receipts;"),
    (re.compile(r"sub-?registrar|registration|registering", re.I),
     "To appear before the Sub-Registrar and any other registering officer, to "
     "present for registration any document executed by the Attorney under these "
     "presents, and to admit its execution;"),
    (re.compile(r"\bcourt|\btribunal|\blitigat|\bsuit|\bcase", re.I),
     "To appear and represent me before all courts and tribunals in respect of the "
     "Schedule Property; to institute, prosecute and defend suits and proceedings; to "
     "sign and verify plaints, written statements, petitions, affidavits and "
     "vakalatnamas; and to engage advocates;"),
    (re.compile(r"\bauthorit|\bgovernment|\bcorporation|\bmunicipal|\bdepartment|"
                r"\boffice", re.I),
     "To appear and represent me before the municipal, revenue, electricity and other "
     "Government authorities in respect of the Schedule Property, and to sign and "
     "submit applications and other papers for that purpose;"),
)


def _expand_powers(powers: Sequence[str]) -> List[str]:
    out: List[str] = []
    for p in powers:
        forms = [f for rx, f in _POWER_FORMS if rx.search(p)]
        for f in forms or [p]:
            if f not in out:
                out.append(f)
    return out


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
    completion_days: int = 0,
    vendor_gender: str = "",
    vendee_gender: str = "",
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

    if earnest_money > total_consideration:
        return _refuse("agreement_for_sale",
                       f"the advance ({earnest_money}) exceeds the total "
                       f"consideration ({total_consideration})",
                       code="agreement_for_sale_advance_exceeds_price",
                       fields=("earnest_money", "total_consideration"))

    # The period the brief states, in its own unit ("within 90 days" stays days).
    period = (f"{completion_days} days" if completion_days and completion_days > 0
              else f"{completion_months} months" if completion_months and completion_months > 0
              else "[period for completion to be provided]")
    balance = total_consideration - earnest_money
    if earnest_money > 0:
        advance_clause = (
            f"The Purchaser has this day paid to the Vendor {rs(earnest_money)} as "
            f"advance and part of the sale consideration by "
            f"{gap(earnest_mode, 'mode of payment')}, the receipt of which the Vendor "
            f"hereby acknowledges.")
        balance_clause = (
            f"The balance sale consideration of {rs(balance)} shall be paid by the "
            f"Purchaser to the Vendor within {period} from the date hereof, at the time "
            f"of execution and registration of the sale deed.")
    else:
        advance_clause = "No advance has been paid on the date of this agreement."
        balance_clause = (
            f"The entire sale consideration of {rs(total_consideration)} shall be paid "
            f"by the Purchaser to the Vendor within {period} from the date hereof, at "
            f"the time of execution and registration of the sale deed.")
    ctx = _base_ctx("AGREEMENT FOR SALE", execution_date, place,
                    vendor=party(vendor_name, vendor_description, vendor_gender),
                    vendee=party(vendee_name, vendee_description, vendee_gender),
                    property_desc=property_desc,
                    total_consideration=total_consideration,
                    total_rs=rs(total_consideration),
                    earnest_money=earnest_money, earnest_mode=earnest_mode,
                    completion_months=completion_months, period=period,
                    advance_clause=advance_clause, balance_clause=balance_clause,
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
    advance_amount: int = 0,
    advance_date: Optional[date] = None,
    vendor_gender: str = "",
    vendee_gender: str = "",
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

    if advance_amount and advance_amount > total_consideration:
        return _refuse("sale_deed",
                       f"the advance ({advance_amount}) exceeds the total "
                       f"consideration ({total_consideration})",
                       code="sale_deed_paid_exceeds_consideration",
                       fields=("advance_amount", "total_consideration"))

    # Consideration must add up: advance (paid earlier) + balance (paid now) = price.
    # "Fully paid" read into amount_already_paid (== price) is no advance at all.
    advance = advance_amount or (amount_already_paid
                                 if amount_already_paid < total_consideration else 0)
    balance = total_consideration - advance
    mode = gap(balance_paid_mode, "mode of payment")
    T = rs(total_consideration)
    if 0 < advance < total_consideration:
        on = f" on {advance_date.isoformat()}" if advance_date else ""
        consideration_clause = (
            f"The total sale consideration of {T} has been paid by the Purchaser to the "
            f"Vendor in full, as follows: (a) {rs(advance)} paid as advance{on}; and "
            f"(b) the balance of {rs(balance)} paid this day by {mode}. The Vendor "
            f"hereby admits and acknowledges the receipt of the entire sale "
            f"consideration of Rs. {total_consideration}/-, and nothing remains due "
            f"from the Purchaser.")
    else:
        consideration_clause = (
            f"The Purchaser has paid the entire sale consideration of {T} to the Vendor "
            f"by {mode}, the receipt of which the Vendor hereby admits and acknowledges; "
            f"nothing remains due from the Purchaser.")
    ctx = _base_ctx("SALE DEED", execution_date, place,
                    vendor=party(vendor_name, vendor_description, vendor_gender),
                    vendee=party(vendee_name, vendee_description, vendee_gender),
                    property_desc=property_desc, boundaries=bounds(boundaries),
                    total_consideration=total_consideration, total_rs=T,
                    amount_already_paid=advance, balance=balance,
                    consideration_clause=consideration_clause,
                    balance_paid_mode=balance_paid_mode,
                    prior_title_recital=prior_title_recital,
                    to_be_registered=to_be_registered,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="sale_deed.docx", context=ctx)


# ==========================================================================
# 6. LEASE DEED (pp.112-115)
# ==========================================================================

_LABEL_PURPOSE = re.compile(r"^\s*(commercial|residential|non-residential|business)\s*"
                            r"(?:\(\s*([^)]+?)\s*\))?\s*(?:purposes?|use)?\s*$", re.I)


def lease_purpose_phrase(purpose: str) -> str:
    """A form label ("Commercial (shop)") reads "for use as a commercial shop";
    a stated purpose ("running a mobile phone shop") reads "for the purpose of ..."."""
    p = (purpose or "").strip().rstrip(".")
    if not p:
        return "for the purpose of [purpose of the lease to be provided]"
    m = _LABEL_PURPOSE.match(p)
    if m:
        kind = m.group(1).lower()
        return f"for use as a {kind} {m.group(2).lower()}" if m.group(2) else f"for {kind} use"
    return p if re.match(r"(?i)for\b", p) else f"for the purpose of {p}"


def _mid(description: str) -> str:
    """'Aged 70 years' / 'Represented by ...' read mid-sentence after the name."""
    d = (description or "").strip()
    return d[:1].lower() + d[1:] if re.match(r"(Aged|Represented|Residing|Having)\b", d) else d


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
    rent_due_day: int = 0,
    lease_purpose: str = "",
    lessor_gender: str = "",
    lessee_gender: str = "",
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

    term = (f"{term_months // 12} year{'s' if term_months > 12 else ''}"
            if term_months % 12 == 0 else f"{term_months} months")
    expiry = None
    if commencement_date:
        y, m = divmod(commencement_date.month - 1 + term_months, 12)
        y += commencement_date.year
        d = min(commencement_date.day, calendar.monthrange(y, m + 1)[1])
        expiry = (date(y, m + 1, d) - timedelta(days=1)).isoformat()
    due = (f"on or before the {rent_due_day}{_ordinal(rent_due_day)} day of every "
           f"month" if 0 < rent_due_day <= 31
           else "on or before [day of the month on which rent is due to be provided]")
    # s.107 TPA / s.17(1)(d) Registration Act: a lease for a term exceeding one
    # year (or from year to year) can be made only by a registered instrument.
    registration_note = (
        "This lease is for a term exceeding one year and can be made only by a "
        "registered instrument (s.107, Transfer of Property Act, 1882; s.17(1)(d), "
        "Registration Act, 1908)." if term_months > 12 else
        "This lease does not exceed one year; registration is not compulsory under "
        "s.17(1)(d) of the Registration Act, 1908.")
    ctx = _base_ctx("LEASE DEED", execution_date, place,
                    lessor=party(lessor_name, _mid(lessor_description), lessor_gender),
                    lessee=party(lessee_name, _mid(lessee_description), lessee_gender),
                    lease_for=lease_purpose_phrase(lease_purpose),
                    property_desc=property_desc, term_months=term_months, term=term,
                    commencement_date=(commencement_date.isoformat()
                                       if commencement_date else
                                       "[date of commencement to be provided]"),
                    expiry_date=expiry or "[date of expiry to be provided]",
                    rent_rs=rs(monthly_rent), rent_due=due,
                    deposit_rs=rs(security_deposit) if security_deposit > 0 else "",
                    lease_purpose=gap(lease_purpose, "purpose of the lease"),
                    notice=(f"{notice_months} months'" if notice_months > 0
                            else "[period of notice to be provided]"),
                    registration_note=registration_note,
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
    prior_title_recital: str = "",
    boundaries: Optional[Dict[str, str]] = None,
    mortgagor_gender: str = "",
    mortgagee_gender: str = "",
) -> DeedResult:
    """Assemble a simple Mortgage Deed (s.58(b) TPA), or refuse. A simple mortgage
    carries no possession and no power of sale out of court: on default the
    mortgagee's remedy is to have the property sold through the Court."""
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
                    mortgagor=party(mortgagor_name, mortgagor_description,
                                    mortgagor_gender),
                    mortgagee=party(mortgagee_name, mortgagee_description,
                                    mortgagee_gender),
                    prior_title_recital=gap(prior_title_recital,
                                            "mortgagor's title (prior deed)"),
                    boundaries=bounds(boundaries or {}), principal_rs=rs(principal),
                    repayment=gap(repayment_terms, "repayment terms"),
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
    capital: int = 0
    remuneration: int = 0
    gender: str = ""


def _partner_ctx(p: Partner) -> Dict[str, Any]:
    d = party(p.name, p.description, p.gender)
    d.update(share_pct=p.share_pct,
             capital_rs=rs(p.capital) if p.capital > 0 else "",
             remuneration_rs=rs(p.remuneration) if p.remuneration > 0 else "")
    return d


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
    banking_mode: str = "",
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
                    partners=[_partner_ctx(p) for p in partners],
                    business_nature=business_nature, principal_place=principal_place,
                    commencement_date=(commencement_date.isoformat()
                                       if commencement_date else
                                       "[date of commencement to be provided]"),
                    capital_note=capital_note, at_will=at_will,
                    capital_listed=any(p.capital > 0 for p in partners),
                    capital_total_rs=rs(sum(p.capital for p in partners)),
                    working_partners=[_partner_ctx(p) for p in partners
                                      if p.remuneration > 0],
                    equal_shares=len({p.share_pct for p in partners}) == 1,
                    banking_mode=banking_mode.strip(),
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
    firm_address: str = "",
    continuing_partner: str = "",
    settlement_amount: int = 0,
    settlement_payee: str = "",
    liabilities_by: str = "",
) -> DeedResult:
    """Assemble a Deed of Dissolution of Partnership, or refuse."""
    # Two partners, one continuing: the settlement goes to the other one.
    if settlement_amount > 0 and not settlement_payee.strip() and             continuing_partner.strip() and len(partners) == 2:
        cont = continuing_partner.strip().lower()
        others = [p.name for p in partners
                  if cont not in p.name.lower() and p.name.lower() not in cont]
        settlement_payee = others[0] if len(others) == 1 else ""
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
                    firm_address=firm_address.strip(),
                    partners=[_partner_ctx(p) for p in partners],
                    shares_note=_shares_note(partners),
                    continuing=party(continuing_partner) if continuing_partner.strip() else None,
                    settlement_rs=rs(settlement_amount) if settlement_amount > 0 else "",
                    payee=party(gap(settlement_payee, "partner receiving the settlement")),
                    liabilities_by=liabilities_by.strip(),
                    original_deed_ref=original_deed_ref,
                    dissolution_date=dissolution_date.isoformat(),
                    accounts_settled=accounts_settled,
                    records_custodian=gap(records_custodian or continuing_partner,
                                          "partner keeping the records"),
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="dissolution_deed.docx", context=ctx)


def _shares_note(partners: Sequence[Partner]) -> str:
    shares = [p.share_pct for p in partners]
    if not all(shares):
        return ""
    if len(set(shares)) == 1:
        return " sharing the profits and losses in equal shares"
    return " sharing the profits and losses in the ratio " + ":".join(map(str, shares))


# ==========================================================================
# 10. RELINQUISHMENT DEED (pp.122-123)
# ==========================================================================

@dataclass(frozen=True)
class Releasor:
    name: str
    description: str
    gender: str = ""


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
    death_date: Optional[date] = None,
    deceased_gender: str = "",
    releasee_gender: str = "",
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
                    releasors=[party(r.name, r.description, r.gender)
                               for r in releasors],
                    R=group([party(r.name, r.description, r.gender) for r in releasors],
                            "Releasor", "Releasors"),
                    releasee=party(releasee_name, releasee_description, releasee_gender),
                    deceased=party(deceased_owner, "", deceased_gender),
                    death_date=(death_date.isoformat() if death_date
                                else "[date of death to be provided]"),
                    property_desc=property_desc,
                    deceased_owner=re.sub(r"^\s*(the\s+)?late\s+", "", deceased_owner,
                                          flags=re.I),
                    # "one-third undivided share" + the template's "share" read "share share"
                    releasors_share=_lower1(re.sub(r"\s+shares?\s*$", "",
                                                   gap(releasors_share, "share relinquished"))),
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
    donor_gender: str = "",
    donee_gender: str = "",
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
                    donor=party(donor_name, donor_description, donor_gender),
                    donee=party(donee_name, donee_description, donee_gender),
                    relation=_lower1(relation.strip()),
                    property_desc=property_desc,
                    boundaries=bounds(boundaries), market_value=market_value,
                    market_value_rs=(rs(market_value) if market_value > 0 else
                                     "[market value to be provided]"),
                    possession_delivered=possession_delivered,
                    to_be_registered=to_be_registered,
                    prior_title_recital=prior_title_recital,
                    witnesses=list(witnesses))
    return DeedResult(refused=False, template="gift_deed.docx", context=ctx)
