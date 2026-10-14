"""Prayer clause engine (spec 1.5).

Prayer is generated from the relief set, not free text. THE RULE: every
relief.type must have a matching cause_of_action in the fact sheet. Unmatched
relief REFUSES the whole prayer — it is not printed with a flag, and nothing
partial is emitted.

Standard closers are appended by code, keyed on the proceeding kind.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

TEMPLATE = "prayer.docx"


class Proceeding(Enum):
    CIVIL = "civil"
    WRIT = "writ"
    CRIMINAL = "criminal"


_CLOSERS = {
    Proceeding.CIVIL: (
        "and pass such other and further orders as this Hon'ble Court may deem "
        "fit and proper in the circumstances of the case and thus render justice."
    ),
    Proceeding.WRIT: (
        "and pass such other order or direction as this Hon'ble Court may deem "
        "fit and proper in the facts and circumstances of the case."
    ),
    Proceeding.CRIMINAL: "and thus render justice.",
}


@dataclass(frozen=True)
class Relief:
    type: str
    description: str
    against_party: str
    is_interim: bool = False
    is_alternative: bool = False


@dataclass(frozen=True)
class PrayerResult:
    refused: bool
    reason: str = ""
    reliefs: Sequence[Relief] = ()
    context: Optional[Dict[str, Any]] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def build(
    *,
    reliefs: Sequence[Relief],
    causes_of_action: Sequence[str],
    proceeding: Proceeding,
) -> PrayerResult:
    """Assemble the prayer. Refuses (no partial output) on any unmatched relief
    or an empty relief set."""
    if not reliefs:
        return PrayerResult(
            refused=True,
            reason="prayer has no relief; a prayer must contain at least one relief",
        )

    coa = set(causes_of_action)
    unmatched = [r for r in reliefs if r.type not in coa]
    if unmatched:
        names = ", ".join(sorted({r.type for r in unmatched}))
        return PrayerResult(
            refused=True,
            reason=f"relief '{names}' has no matching cause of action in the fact "
                   f"sheet; prayer refused",
            context=None,
        )

    numbered = [
        {
            "number": i + 1,
            "type": r.type,
            "description": r.description,
            "against_party": r.against_party,
            "is_interim": r.is_interim,
            "is_alternative": r.is_alternative,
        }
        for i, r in enumerate(reliefs)
    ]

    context = {
        "proceeding": proceeding.value,
        "reliefs": numbered,
        "closer": _CLOSERS[proceeding],
    }
    return PrayerResult(refused=False, reliefs=tuple(reliefs), context=context)
