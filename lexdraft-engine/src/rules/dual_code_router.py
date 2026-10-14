"""Dual-code router — BNS/BNSS/BSA ↔ IPC/CrPC/IEA. Deterministic. No LLM.

Three inputs, two independent axes, no default:

  route(offence_date, proceeding_start_date, is_fresh_action) -> RouteResult

  SUBSTANTIVE axis — the OFFENCE DATE decides (Art. 20(1), no ex-post-facto law;
    BNS s.358 savings). Offence before the appointed day -> IPC/IEA; on or after
    -> BNS/BSA.

  PROCEDURAL axis — pending proceedings continue under the OLD procedure
    (BNSS s.531(2)(a)); FRESH actions take BNSS even on old facts:
      - is_fresh_action True  -> BNSS. Freshness dominates; any proceeding start
        date is irrelevant. (The canonical trap: a NEW quashing petition on a
        2023 FIR cites BNSS, not CrPC s.482.)
      - is_fresh_action False -> the matter is a pending proceeding; its START
        DATE decides. Started before the appointed day -> CrPC; on/after -> BNSS.
        A pending proceeding with an UNKNOWN start date cannot be routed —
        REFUSE (unknown provenance is a real state for inherited matters).

Bail is procedural, so `code_framework` (what the bail pipelines consume) tracks
the PROCEDURAL axis, not the substantive one.

VERIFY (advocate review — reviewed as a unit with the other VERIFY markers):
the appointed day, the substantive/procedural split, the fresh-action rule, and
the section provenance below are indicative and must be checked against the bare
Acts (BNS s.358; BNSS s.531; General Clauses Act s.6).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Optional

from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity

# Appointed day on which BNS / BNSS / BSA came into force, loaded from
# verify/tables/code_appointed_day.json (ISO date string there).
APPOINTED_DAY = date.fromisoformat(_reg.values("code_appointed_day"))


class Substantive(Enum):
    IPC = "ipc"   # Indian Penal Code / Indian Evidence Act (pre-appointed offence)
    BNS = "bns"   # Bharatiya Nyaya Sanhita / Bharatiya Sakshya Adhiniyam


class Procedural(Enum):
    CRPC = "crpc"  # Code of Criminal Procedure (pending proceeding, old start)
    BNSS = "bnss"  # Bharatiya Nagarik Suraksha Sanhita


@dataclass(frozen=True)
class RouteResult:
    refused: bool
    substantive: Optional[Substantive]
    procedural: Optional[Procedural]
    reason: str = ""
    computation: Optional[str] = None
    refusal: Optional[Refusal] = None

    @property
    def code_framework(self) -> Optional[str]:
        """The procedural framework string the bail pipelines consume
        ('bnss' | 'crpc'), or None when refused."""
        return self.procedural.value if self.procedural is not None else None


def _refuse(reason: str, *, code: str, fields: tuple,
            computation: Optional[str] = None) -> RouteResult:
    return RouteResult(
        refused=True, substantive=None, procedural=None,
        reason=reason, computation=computation,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="dual_code_router",
                        spec="BNSS s.531", fields=fields),
    )


def route(
    *,
    offence_date: Optional[date],
    proceeding_start_date: Optional[date],
    is_fresh_action: bool,
) -> RouteResult:
    """Resolve the substantive and procedural frameworks, or refuse."""

    # --- substantive axis: needs the offence date, always. ---
    if offence_date is None:
        return _refuse(
            "substantive framework cannot be determined without the offence date "
            "(Art. 20(1) fixes substantive law to the date of the offence)",
            code="code_framework_offence_date_missing",
            fields=("offence_date",),
        )
    substantive = (
        Substantive.BNS if offence_date >= APPOINTED_DAY else Substantive.IPC
    )

    # --- procedural axis ---
    if is_fresh_action:
        # Freshness dominates: BNSS even on old facts. Start date irrelevant, and
        # a missing start date is EXPECTED (a fresh action has no prior proceeding).
        procedural = Procedural.BNSS
        computation = (
            f"offence {offence_date} -> substantive {substantive.value}; "
            f"fresh action -> procedural bnss (freshness dominates)"
        )
        return RouteResult(refused=False, substantive=substantive,
                           procedural=procedural, computation=computation)

    # Not fresh -> a pending proceeding. Its start date decides; unknown -> refuse.
    if proceeding_start_date is None:
        return _refuse(
            "pending (non-fresh) proceeding has an unknown start date; provenance "
            "cannot be established, so the procedural framework cannot be routed. "
            "Establish whether the proceeding commenced before or on/after the "
            "appointed day before proceeding.",
            code="code_framework_unknown_provenance",
            fields=("proceeding_start_date", "is_fresh_action"),
            computation=f"offence {offence_date}; proceeding_start=unknown; "
                        f"is_fresh_action=False",
        )
    procedural = (
        Procedural.BNSS if proceeding_start_date >= APPOINTED_DAY else Procedural.CRPC
    )
    computation = (
        f"offence {offence_date} -> substantive {substantive.value}; "
        f"pending proceeding from {proceeding_start_date} -> "
        f"procedural {procedural.value}"
    )
    return RouteResult(refused=False, substantive=substantive,
                       procedural=procedural, computation=computation)
