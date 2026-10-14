"""Shared result primitive for the deterministic rules engine.

Every hard stop returns a *refusal object*, never a warning flag. Per CLAUDE.md:
producing a time-barred / right-extinguished document is worse than producing
nothing. Downstream code keys off `may_generate`; a refused assessment yields no
document and always carries the computation that justifies the refusal.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from ..verify.refusals import Refusal


@dataclass(frozen=True)
class Assessment:
    """Outcome of a hard-stop check.

    refused:      True when generation must be blocked.
    may_generate: convenience inverse of `refused`; downstream gate.
    reason:       human-readable ground; shown in the UI on refusal.
    computation:  the shown working (dates, counts, sections) behind the verdict.
    refusal:      the structured Refusal (code/severity/fields) when refused. Rides
                  ALONGSIDE `reason`/`computation` (which are unchanged) so existing
                  callers keep working and the API layer gets a typed contract.
    """

    refused: bool
    reason: str = ""
    computation: Optional[str] = None
    refusal: Optional["Refusal"] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused

    @classmethod
    def allow(cls, computation: Optional[str] = None) -> "Assessment":
        return cls(refused=False, reason="", computation=computation)

    @classmethod
    def refuse(
        cls,
        reason: str,
        computation: Optional[str] = None,
        refusal: Optional["Refusal"] = None,
    ) -> "Assessment":
        return cls(refused=True, reason=reason, computation=computation,
                   refusal=refusal)
