"""Court fee — TN Court Fees and Suits Valuation Act 1955. Deterministic. No LLM.

Three modes:
  AD_VALOREM     a slab/percentage of the claim value (money claims).
  FIXED          a fixed fee prescribed by the Act for the relief.
  RELIEF_LINKED  a suit seeking multiple reliefs — the fee is the sum of the
                 per-relief fees.

Every result carries BOTH the computed fee AND a human valuation basis, because
the plaint must plead both.

VERIFY (advocate review — reviewed as a unit with the other VERIFY markers): the
ad valorem slab table and the fixed-fee amounts below are INDICATIVE placeholders
for the structure. The actual TN Act Schedule I / II figures must be substituted
before this is relied upon. `SLABS_ARE_VERIFY` is True to make that explicit.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Tuple

from ..verify import tables as _reg

# SLABS_ARE_VERIFY stays True until BOTH court-fee tables are signed off in
# verify/tables/. Flipping the JSON is the only change needed to clear it.
_TABLE_NAMES = ("court_fee_ad_valorem_slabs", "court_fee_fixed_fees")
SLABS_ARE_VERIFY = _reg.marker_for(*_TABLE_NAMES) != ""


class CourtFeeInputError(ValueError):
    pass


class ReliefKind(Enum):
    MONEY = "money"                          # ad valorem on the sum claimed
    DECLARATION_FIXED = "declaration_fixed"  # fixed-fee declaratory relief
    INJUNCTION_FIXED = "injunction_fixed"    # fixed-fee injunction relief


class FeeMode(Enum):
    AD_VALOREM = "ad_valorem"
    FIXED = "fixed"
    RELIEF_LINKED = "relief_linked"


# Ad valorem slabs — (upper_bound_inclusive_or_None, rate_fraction), loaded from
# verify/tables/court_fee_ad_valorem_slabs.json. A null upper bound is the top slab.
AD_VALOREM_SLABS: List[Tuple[Optional[int], float]] = [
    (upper, rate) for upper, rate in _reg.values("court_fee_ad_valorem_slabs")
]

# Fixed fees per relief kind, loaded from verify/tables/court_fee_fixed_fees.json
# (string keys there -> ReliefKind here).
FIXED_FEES = {
    ReliefKind(kind): fee for kind, fee in _reg.values("court_fee_fixed_fees").items()
}

_FIXED_KINDS = set(FIXED_FEES)


@dataclass(frozen=True)
class Relief:
    kind: ReliefKind
    value: Optional[int] = None   # required for MONEY (ad valorem)


@dataclass(frozen=True)
class FeeComponent:
    kind: ReliefKind
    fee: int
    basis: str


@dataclass(frozen=True)
class CourtFeeResult:
    fee: int
    mode: FeeMode
    valuation_basis: str
    components: List[FeeComponent] = field(default_factory=list)


def _ad_valorem_fee(value: int) -> int:
    """Slab-wise ad valorem fee. VERIFY slabs above."""
    fee = 0.0
    lower = 0
    for upper, rate in AD_VALOREM_SLABS:
        if upper is None:
            fee += (value - lower) * rate
            break
        if value > upper:
            fee += (upper - lower) * rate
            lower = upper
        else:
            fee += (value - lower) * rate
            break
    return int(round(fee))


def _fee_for(relief: Relief) -> FeeComponent:
    if relief.kind is ReliefKind.MONEY:
        if relief.value is None:
            raise CourtFeeInputError("money relief requires a claim value")
        if relief.value < 0:
            raise CourtFeeInputError("claim value must be non-negative")
        fee = _ad_valorem_fee(relief.value)
        return FeeComponent(
            kind=relief.kind, fee=fee,
            basis=f"ad valorem on the sum of Rs. {relief.value}/- claimed",
        )
    # fixed-fee reliefs
    fee = FIXED_FEES[relief.kind]
    return FeeComponent(
        kind=relief.kind, fee=fee,
        basis=f"fixed fee prescribed for {relief.kind.value} relief",
    )


def compute(*, reliefs: List[Relief]) -> CourtFeeResult:
    """Compute the court fee and the valuation basis to be pleaded."""
    if not reliefs:
        raise CourtFeeInputError("at least one relief is required to value a suit")

    components = [_fee_for(r) for r in reliefs]
    total = sum(c.fee for c in components)

    if len(reliefs) > 1:
        mode = FeeMode.RELIEF_LINKED
        basis = "; ".join(f"{c.basis} (Rs. {c.fee}/-)" for c in components)
    elif reliefs[0].kind is ReliefKind.MONEY:
        mode = FeeMode.AD_VALOREM
        basis = components[0].basis
    else:
        mode = FeeMode.FIXED
        basis = components[0].basis

    return CourtFeeResult(fee=total, mode=mode, valuation_basis=basis,
                          components=components)
