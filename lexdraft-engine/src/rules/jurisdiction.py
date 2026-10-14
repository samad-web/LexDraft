"""Jurisdiction — two independent limbs. Deterministic. No LLM.

PECUNIARY: the suit value against the forum's ceiling. Over the ceiling ->
REFUSE, and name the correct forum (do not generate for the wrong court).

TERRITORIAL (s.20 CPC): jurisdiction lies where the defendant resides / carries
on business, OR where the cause of action wholly or in part arose. Multiple bases
are fine; NONE is a refusal.

Built as standalone functions (not plaint helpers) so both 4.1 and the written
statement's preliminary-objections stage can invoke either limb independently.

VERIFY (advocate review): the pecuniary ceilings below are indicative and must be
checked against the current TN notifications.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

from ._result import Assessment
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity

# LIMITS_ARE_VERIFY stays True until the pecuniary-limits table is signed off in
# verify/tables/pecuniary_limits.json.
LIMITS_ARE_VERIFY = _reg.marker_for("pecuniary_limits") != ""


class Forum(Enum):
    DISTRICT_MUNSIF = "district_munsif"       # lowest pecuniary ceiling
    SUBORDINATE_JUDGE = "subordinate_judge"   # higher ceiling
    DISTRICT_COURT = "district_court"         # unlimited (original civil)
    CITY_CIVIL_COURT = "city_civil_court"     # unlimited (Chennai)
    HIGH_COURT_OS = "high_court_os"           # unlimited (original side)


# Pecuniary ceilings (Rs). None = unlimited. Loaded from
# verify/tables/pecuniary_limits.json (string keys there -> Forum here).
PECUNIARY_LIMITS = {
    Forum(forum): limit for forum, limit in _reg.values("pecuniary_limits").items()
}

# Ascending ceiling order for naming the correct forum when over-limit.
_ESCALATION = [
    Forum.DISTRICT_MUNSIF,
    Forum.SUBORDINATE_JUDGE,
    Forum.DISTRICT_COURT,
]


class TerritorialBasis(Enum):
    DEFENDANT_RESIDES = "defendant_resides"
    DEFENDANT_BUSINESS = "defendant_carries_on_business"
    CAUSE_WHOLLY_AROSE = "cause_of_action_wholly_arose"
    CAUSE_PART_AROSE = "cause_of_action_part_arose"


@dataclass(frozen=True)
class PecuniaryResult:
    refused: bool
    reason: str = ""
    correct_forum: Optional[Forum] = None
    computation: Optional[str] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


@dataclass(frozen=True)
class TerritorialResult:
    refused: bool
    reason: str = ""
    bases: List[TerritorialBasis] = field(default_factory=list)
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _smallest_forum_that_fits(value: int) -> Optional[Forum]:
    for forum in _ESCALATION:
        limit = PECUNIARY_LIMITS[forum]
        if limit is None or value <= limit:
            return forum
    return None


def check_pecuniary(*, value: int, forum: Forum) -> PecuniaryResult:
    """Whether `forum` has pecuniary jurisdiction over a suit valued at `value`."""
    limit = PECUNIARY_LIMITS[forum]
    computation = (
        f"suit value Rs. {value}/-; {forum.value} ceiling "
        f"{'unlimited' if limit is None else f'Rs. {limit}/-'}"
    )
    if limit is None or value <= limit:
        return PecuniaryResult(refused=False, computation=computation)

    correct = _smallest_forum_that_fits(value)
    reason = (
        f"suit value Rs. {value}/- exceeds the pecuniary limit of "
        f"{forum.value} (Rs. {limit}/-); the suit must be filed before "
        f"{correct.value if correct else 'a forum of competent pecuniary jurisdiction'}"
    )
    return PecuniaryResult(
        refused=True,
        reason=reason,
        correct_forum=correct,
        computation=computation,
        refusal=Refusal(
            code="jurisdiction_pecuniary_over_limit",
            severity=Severity.HARD, reason=reason, computation=computation,
            pipeline="jurisdiction", spec="s.15 CPC",
            fields=("claimed_total", "forum"),
        ),
    )


def check_territorial(*, bases: List[TerritorialBasis]) -> TerritorialResult:
    """Whether at least one s.20 CPC territorial basis is pleaded. Multiple bases
    are fine; none is a refusal."""
    if not bases:
        reason = (
            "no territorial jurisdiction basis pleaded; s.20 CPC requires that "
            "the defendant reside or carry on business within the court's "
            "limits, or that the cause of action wholly or in part arose there"
        )
        return TerritorialResult(
            refused=True,
            reason=reason,
            bases=[],
            refusal=Refusal(
                code="jurisdiction_no_territorial_basis",
                severity=Severity.HARD, reason=reason,
                pipeline="jurisdiction", spec="s.20 CPC",
                fields=("territorial_bases",),
            ),
        )
    return TerritorialResult(refused=False, bases=list(bases))
