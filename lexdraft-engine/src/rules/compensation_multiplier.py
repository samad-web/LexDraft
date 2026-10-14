"""MACT compensation — Sarla Verma / Pranay Sethi. Deterministic. No LLM.

DEATH and INJURY are computed by DIFFERENT formulae and are separate entry points
(compute_death / compute_injury). Do NOT force injury through the death formula.

  DEATH:  multiplicand = (annual income + future prospects) - personal-expenses
          deduction; award = multiplicand * multiplier + conventional heads.
  INJURY: award = loss of earning capacity (income * disability%, * multiplier
          where permanent) + treatment + attendant/special expenses. No
          personal-expenses deduction, no conventional death heads.

VERIFY (advocate review — the HEAVIEST new legal-table module since court_fee; it
joins the SAME review batch). Every table below — multiplier bands, future-
prospects slabs, deduction fractions, conventional-head figures — is INDICATIVE
and MUST be checked against Sarla Verma v. DTC and National Insurance v. Pranay
Sethi before it is relied upon. `TABLES_ARE_VERIFY` is True, and every result
carries `unverified=True` so downstream renders a visible marker: a wrong
multiplier produces a wrong claim amount that reads as authoritative.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Tuple

from ..verify import tables as _reg

# UNVERIFIED_MARKER is the single shared marker string (now owned by the registry).
UNVERIFIED_MARKER = _reg.UNVERIFIED_MARKER

# The four VERIFY tables this module consumes. TABLES_ARE_VERIFY stays True until
# EVERY one of them is signed off in verify/tables/ — flipping the JSON is the only
# change needed to clear it.
_TABLE_NAMES = (
    "mact_multiplier_bands",
    "mact_future_prospects",
    "mact_personal_expense_deduction",
    "mact_conventional_heads",
)
TABLES_ARE_VERIFY = _reg.marker_for(*_TABLE_NAMES) != ""


class CompensationInputError(ValueError):
    pass


class Employment(Enum):
    PERMANENT_SALARIED = "permanent_salaried"
    SELF_EMPLOYED = "self_employed"
    FIXED_WAGE = "fixed_wage"


# --------------------------------------------------------------------------
# VERIFY tables — loaded from verify/tables/ (one JSON file per table).
# --------------------------------------------------------------------------

# Sarla Verma multiplier bands. (age_lo, age_hi_inclusive) -> multiplier.
MULTIPLIER_BANDS: List[Tuple[int, int, int]] = [
    (lo, hi, mult) for lo, hi, mult in _reg.values("mact_multiplier_bands")
]

# Pranay Sethi future-prospects fractions, by age band and employment kind.
# (age_lo, age_hi_inclusive, salaried_pct, self_employed_pct)
FUTURE_PROSPECTS: List[Tuple[int, int, float, float]] = [
    (lo, hi, sal, slf) for lo, hi, sal, slf in _reg.values("mact_future_prospects")
]

# Personal-and-living-expenses deduction fraction by number of dependants.
# Stored in the registry as an exact [numerator, denominator] ratio so the
# arithmetic does not drift (Sarla Verma: 2-3 -> 1/3; 4-6 -> 1/4; >6 -> 1/5).
PERSONAL_EXPENSE_DEDUCTION: List[Tuple[int, int, float]] = [
    (lo, hi, num / den)
    for lo, hi, num, den in _reg.values("mact_personal_expense_deduction")
]

# Pranay Sethi conventional heads (Rs), subject to periodic enhancement.
CONVENTIONAL_HEADS = dict(_reg.values("mact_conventional_heads"))
_ENHANCEMENT_NOTE = (
    "conventional heads are subject to periodic enhancement (Pranay Sethi: by 10% "
    "every three years) — VERIFY the current figures"
)


# --------------------------------------------------------------------------
# Table lookups.
# --------------------------------------------------------------------------

def multiplier_for_age(age: int) -> int:
    if age < 0:
        raise CompensationInputError("age must be non-negative")
    for lo, hi, mult in MULTIPLIER_BANDS:
        if lo <= age <= hi:
            return mult
    raise CompensationInputError(f"no multiplier band for age {age}")


def future_prospects_pct(age: int, employment: Employment) -> float:
    if age < 0:
        raise CompensationInputError("age must be non-negative")
    salaried = employment is Employment.PERMANENT_SALARIED
    for lo, hi, sal_pct, self_pct in FUTURE_PROSPECTS:
        if lo <= age <= hi:
            return sal_pct if salaried else self_pct
    raise CompensationInputError(f"no future-prospects slab for age {age}")


def personal_expense_fraction(dependants: int) -> float:
    if dependants < 1:
        raise CompensationInputError("at least one dependant is required")
    for lo, hi, frac in PERSONAL_EXPENSE_DEDUCTION:
        if lo <= dependants <= hi:
            return frac
    raise CompensationInputError(f"no deduction band for {dependants} dependants")


# --------------------------------------------------------------------------
# Death computation.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class ConventionalHead:
    name: str
    amount: int


@dataclass(frozen=True)
class DeathResult:
    multiplicand: float
    multiplier: int
    loss_of_dependency: float
    conventional_heads: List[ConventionalHead]
    conventional_total: int
    total: float
    enhancement_note: str
    unverified: bool = TABLES_ARE_VERIFY


def compute_death(
    *,
    age: int,
    annual_income: int,
    dependants: int,
    employment: Employment,
) -> DeathResult:
    """Death compensation (Sarla Verma multiplier + Pranay Sethi prospects/heads)."""
    if annual_income < 0:
        raise CompensationInputError("annual income must be non-negative")

    pct = future_prospects_pct(age, employment)
    enhanced_income = annual_income * (1 + pct)

    frac = personal_expense_fraction(dependants)
    multiplicand = enhanced_income * (1 - frac)

    multiplier = multiplier_for_age(age)
    loss_of_dependency = multiplicand * multiplier

    heads = [ConventionalHead(name=k, amount=v) for k, v in CONVENTIONAL_HEADS.items()]
    conventional_total = sum(h.amount for h in heads)

    return DeathResult(
        multiplicand=multiplicand,
        multiplier=multiplier,
        loss_of_dependency=loss_of_dependency,
        conventional_heads=heads,
        conventional_total=conventional_total,
        total=loss_of_dependency + conventional_total,
        enhancement_note=_ENHANCEMENT_NOTE,
    )


# --------------------------------------------------------------------------
# Injury computation — a DIFFERENT formula.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class InjuryResult:
    loss_of_earning_capacity: float
    treatment_expenses: int
    attendant_expenses: int
    total: float
    unverified: bool = TABLES_ARE_VERIFY


def compute_injury(
    *,
    age: int,
    annual_income: int,
    disability_pct: float,
    permanent: bool,
    treatment_expenses: int,
    attendant_expenses: int,
) -> InjuryResult:
    """Injury compensation. Loss of earning capacity = income * disability%,
    capitalised by the multiplier where the disability is permanent. No
    personal-expenses deduction and no conventional death heads."""
    if annual_income < 0:
        raise CompensationInputError("annual income must be non-negative")
    if not (0 <= disability_pct <= 100):
        raise CompensationInputError("disability_pct must be between 0 and 100")

    annual_loss = annual_income * (disability_pct / 100.0)
    if permanent:
        loss_of_earning_capacity = annual_loss * multiplier_for_age(age)
    else:
        loss_of_earning_capacity = annual_loss

    return InjuryResult(
        loss_of_earning_capacity=loss_of_earning_capacity,
        treatment_expenses=treatment_expenses,
        attendant_expenses=attendant_expenses,
        total=loss_of_earning_capacity + treatment_expenses + attendant_expenses,
    )
