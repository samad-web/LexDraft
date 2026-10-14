"""Memorandum for furnishing sureties — document pipeline.

Where a superior court has granted bail but directed that the sureties be
furnished before the committing/trial magistrate, the petitioner/accused files
this memorandum before that magistrate. By it, bail HAVING BEEN GRANTED by the
superior court, the accused offers to furnish the sureties required by the order
so that he may be released on execution of the bond. The court name and place are
placeholders — the memorandum adapts to any state. PARTY-FILED (tendered by the
accused, not issued by the court).

Hard requirements (each refuses, no partial output):
  - Bail must actually have been granted by the superior court, and the grant
    (with its order date) must be shown — this memorandum only executes the
    furnishing of sureties after such a grant.
  - The court that granted bail must be named.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "memorandum_furnish_sureties.docx"
SPEC = "tn-suretymemo"


@dataclass(frozen=True)
class MemorandumFurnishSuretiesResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> MemorandumFurnishSuretiesResult:
    return MemorandumFurnishSuretiesResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="memorandum_furnish_sureties", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    accused_name: str,
    granting_court: str,
    bail_granted: bool,
    bail_order_ref: str,
    bail_order_date: Optional[date],
    case_ref: str,
    place: str,
    complainant_name: Optional[str] = None,
    memo_date: Optional[date] = None,
    court_place: Optional[str] = None,
) -> MemorandumFurnishSuretiesResult:
    """Assemble the memorandum for furnishing sureties, or refuse."""

    # 1. this memorandum only executes furnishing of sureties after a superior
    #    court has granted bail; the grant (with its order date) must be shown.
    if not (bail_granted and bail_order_date is not None):
        return _refuse(
            "this memorandum only executes furnishing of sureties after a superior "
            "court has granted bail",
            code="memorandum_sureties_bail_not_granted",
            fields=("bail_granted", "bail_order_date"),
        )

    # 2. the court that granted bail must be named.
    if not granting_court.strip():
        return _refuse(
            "this memorandum must name the superior court that granted bail; the "
            "granting court is absent",
            code="memorandum_sureties_granting_court_missing",
            fields=("granting_court",),
        )

    context: Dict[str, Any] = {
        "accused_name": accused_name,
        "granting_court": granting_court,
        "bail_granted": bail_granted,
        "bail_order_ref": bail_order_ref,
        "bail_order_date": bail_order_date.isoformat(),
        "case_ref": case_ref,
        "place": place,
        "complainant_name": complainant_name,
        "memo_date": memo_date.isoformat() if memo_date is not None else None,
        "court_place": court_place,
    }
    return MemorandumFurnishSuretiesResult(refused=False, context=context)
