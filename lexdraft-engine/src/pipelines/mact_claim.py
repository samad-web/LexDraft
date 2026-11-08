"""MACT claim petition — MV Act s.166 — pipeline (spec 7.2).

Consumes src.rules.compensation_multiplier (Sarla Verma / Pranay Sethi). DEATH
and INJURY use the module's SEPARATE entry points — injury is not forced through
the death formula.

Hard checks / behaviours:
  - Rash and negligent driving pleaded expressly — jurisdictional; refuse without.
  - Arithmetic recomputed end to end; the claimed total must equal the computed
    total. Mismatch -> refuse. (A None claimed_total adopts the computation.)
  - Policy validity checked against the accident date. Invalid/lapsed -> still
    GENERATE, but the pleading addresses it (the claim proceeds against owner and
    driver regardless).
  - Income asserted without proof -> the computation SAYS SO (income not treated
    as established silently).
  - Computed figures carry a visible unverified marker (same treatment as court
    fee) — a wrong multiplier produces a wrong claim amount that reads as
    authoritative.

LLM slot at paragraph 2 (accident narrative) only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from fractions import Fraction
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from dateutil.relativedelta import relativedelta

from ..rules import compensation_multiplier as cm
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity

TEMPLATE = "mact_claim.docx"
SPEC = "7.2"

# The MACT compensation tables this document's figures depend on.
_CONSUMED_TABLES = (
    "mact_multiplier_bands", "mact_future_prospects",
    "mact_personal_expense_deduction", "mact_conventional_heads",
)

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"

# the personal-expenses deduction as pleaded ("less one-third ...")
_FRACTION_WORDS = {Fraction(1, 2): "one-half", Fraction(1, 3): "one-third",
                   Fraction(1, 4): "one-fourth", Fraction(1, 5): "one-fifth"}


class ClaimKind(Enum):
    DEATH = "death"
    INJURY = "injury"


@dataclass(frozen=True)
class MactResult:
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
) -> MactResult:
    return MactResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            computation=computation, pipeline="mact_claim", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


# "(6)" or "(son, 6)": b3 item 2 lost the next friend to the second form.
_MINOR = re.compile(r"\bminor\b|\((?:[^)]*[,\s])?(\d{1,2})\)")


def _with_next_friend(claimants: Sequence[str]) -> List[str]:
    """A minor claimant sues by a next friend (O.XXXII CPC): name the mother when
    the 1st claimant is the deceased's wife and the minor is the deceased's child."""
    out = []
    first = claimants[0].lower() if claimants else ""
    for i, c in enumerate(claimants):
        m = _MINOR.search(c)
        minor = m and (m.group(1) is None or int(m.group(1)) < 18)
        if not minor or i == 0 or "next friend" in c.lower() or "guardian" in c.lower():
            out.append(c)
            continue
        low = c.lower()
        child = re.search(r"\b(son|daughter)\b", low)
        if child and re.search(r"\bwife\b", first):
            pron = "his" if child.group(1) == "son" else "her"
            out.append(f"{c}, minor, represented by {pron} mother and next friend, "
                       f"the 1st petitioner")
        else:
            out.append(f"{c}, minor, represented by [guardian / next friend to be named]")
    return out


def _tribunal_heading(name: Optional[str], place: Optional[str]) -> str:
    """The Tribunal exactly as briefed ("Motor Accidents Claims Tribunal (Special District
    Court), Chennai"), upper-cased; a full name put in tribunal_place counts as the name."""
    name, place = (name or "").strip(), (place or "").strip()
    if not name and "TRIBUNAL" in place.upper():
        name, place = place, ""
    name = re.sub(r"^(before\s+)?the\s+", "", name or "Motor Accident Claims Tribunal", flags=re.I)
    if place and place.upper() not in name.upper():
        name = f"{name}, {place}"
    return name.upper()


def build(
    *,
    claim_kind: ClaimKind,
    claimants: Sequence[str],
    accident_date: date,
    rash_negligent_pleaded: bool,
    fir_ref: str,
    vehicle_number: str,
    owner: str,
    driver: str,
    insurer: str,
    policy_no: str,
    policy_valid_on_accident: bool,
    victim_age: int,
    victim_annual_income: int,
    income_proof_present: bool,
    employment: cm.Employment,
    dependants: int,
    disability_pct: Optional[float],
    permanent: Optional[bool],
    treatment_expenses: int,
    attendant_expenses: int,
    claimed_total: Optional[int],
    jurisdiction_basis: str,
    place: str,
    accident_narrative: str,
    # cause-title header (DPC book). Optional.
    tribunal_place: Optional[str] = None,
    tribunal_name: Optional[str] = None,
    filing_date: Optional[date] = None,
    # where the accident happened — the s.166(2) MV Act jurisdiction fact. Optional.
    accident_place: Optional[str] = None,
) -> MactResult:
    """Assemble the MACT claim petition, or refuse."""

    # 1. rash and negligent driving — jurisdictional.
    if not rash_negligent_pleaded:
        return _refuse(
            "rash and negligent driving must be pleaded expressly; it is the "
            "jurisdictional averment for a claim under s.166 MV Act",
            code="mact_claim_rash_negligent_not_pleaded",
            fields=("rash_negligent_pleaded",),
        )

    # 2. compute — DEATH and INJURY by their separate formulae.
    if claim_kind is ClaimKind.DEATH:
        # The claimants of a death claim are the dependants when no count is given
        # (r11: an unset count reached compute_death as 0 and crashed with a 500).
        dependants = dependants or len(claimants)
        if dependants < 1:
            return _refuse("a death claim needs at least one dependant claimant",
                           code="mact_claim_no_dependants", fields=("dependants", "claimants"))
        d = cm.compute_death(
            age=victim_age, annual_income=victim_annual_income,
            dependants=dependants, employment=employment,
            # heads as revised on the date of filing (accident date if undated).
            as_of=filing_date or accident_date,
            # shortcut: every claimant is counted for consortium (spouse, child,
            # parent per Magma); a sibling claimant would need excluding by hand.
            consortium_claimants=max(1, len(claimants)),
        )
        computation: Dict[str, Any] = {
            "kind": "death",
            "annual_income": victim_annual_income,
            "future_prospects_pct": round(d.future_prospects_pct * 100),
            "future_prospects": round(d.enhanced_income - victim_annual_income),
            "enhanced_income": round(d.enhanced_income),
            "deduction_label": _FRACTION_WORDS.get(
                Fraction(d.deduction_fraction).limit_denominator(10),
                f"{round(d.deduction_fraction * 100)}%"),
            "deduction": round(d.enhanced_income * d.deduction_fraction),
            "multiplicand": round(d.multiplicand),
            "multiplier": d.multiplier,
            "loss_of_dependency": round(d.loss_of_dependency),
            "conventional_heads": [
                {"name": h.name, "amount": h.amount} for h in d.conventional_heads
            ],
            "conventional_total": d.conventional_total,
            "enhancement_note": d.enhancement_note,
            "total": round(d.total),
        }
        computed_total = round(d.total)
        unverified = d.unverified
    else:  # INJURY
        if disability_pct is None or permanent is None:
            return _refuse(
                "an injury claim requires the disability percentage and whether it "
                "is permanent",
                code="mact_claim_injury_missing_disability_or_permanence",
                fields=("disability_pct", "permanent"),
            )
        inj = cm.compute_injury(
            age=victim_age, annual_income=victim_annual_income,
            disability_pct=disability_pct, permanent=permanent,
            treatment_expenses=treatment_expenses,
            attendant_expenses=attendant_expenses,
        )
        computation = {
            "kind": "injury",
            "loss_of_earning_capacity": round(inj.loss_of_earning_capacity),
            "treatment_expenses": inj.treatment_expenses,
            "attendant_expenses": inj.attendant_expenses,
            "total": round(inj.total),
        }
        computed_total = round(inj.total)
        unverified = inj.unverified

    # 3. arithmetic — claimed total must equal the computation.
    if claimed_total is None:
        claimed_total = computed_total
    elif claimed_total != computed_total:
        return _refuse(
            f"claimed total Rs. {claimed_total}/- does not equal the recomputed "
            f"compensation of Rs. {computed_total}/-",
            code="mact_claim_claimed_total_mismatch",
            fields=("claimed_total",),
            computation=f"claimed={claimed_total}; computed={computed_total}",
        )

    # 4. income proof — say so when absent.
    income_established = income_proof_present
    income_note = (
        None if income_proof_present
        else "the income is asserted but not supported by documentary proof; the "
             "computation proceeds on the asserted figure, to be established at trial"
    )

    context: Dict[str, Any] = {
        "claim_kind": claim_kind.value,
        "claimants": _with_next_friend(claimants),
        "accident_place": (accident_place or "").strip() or None,
        # cause-title header fields (render only when present).
        "tribunal_place": tribunal_place,
        "tribunal_heading": _tribunal_heading(tribunal_name, tribunal_place),
        "petition_year": filing_date.year if filing_date else None,
        "petition_date": filing_date.isoformat() if filing_date else None,
        "accident_date": accident_date,
        # s.166(3) MV Act (inserted by the MV (Amendment) Act, 2019): the claim
        # within six months of the accident. None = filing date unknown.
        "within_six_months": (None if filing_date is None
                              else filing_date <= accident_date + relativedelta(months=6)),
        "fir_ref": fir_ref,
        "vehicle": {"number": vehicle_number, "owner": owner, "driver": driver,
                    "insurer": insurer, "policy_no": policy_no},
        # policy validity — addressed, never a refusal.
        "policy_valid": policy_valid_on_accident,
        "policy_addressed": not policy_valid_on_accident,
        # income proof
        "income_established": income_established,
        "income_note": income_note,
        "victim": {"age": victim_age, "annual_income": victim_annual_income,
                   "dependants": dependants, "employment": employment.value},
        # computation + unverified marker
        "computation": computation,
        "claimed_total": claimed_total,
        "computation_unverified": unverified,
        # Marker is the registry-driven string: non-empty while any MACT table is
        # unverified, "" once all are signed off (removing the marker, no code
        # change). `unverified` from the module tracks the same registry state.
        "unverified_marker": _reg.marker_for(*_CONSUMED_TABLES),
        "jurisdiction_basis": jurisdiction_basis,
        # LLM slot (para 2)
        "accident_slot": accident_narrative if accident_narrative.strip()
                         else _LLM_SLOT_PLACEHOLDER,
        "place": place,
    }
    return MactResult(refused=False, context=context)
