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
from typing import Any, Dict, Mapping, Optional, Sequence

from ..verify.refusals import Refusal, Severity
from ._court import bare_sum, court_and_place, pronouns
from ._state_party import state_respondent

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
    bail_order_date: Optional[date],
    case_ref: str,
    place: str,
    bail_order_ref: str = "",
    complainant_name: Optional[str] = None,
    memo_date: Optional[date] = None,
    court_place: Optional[str] = None,
    court_name: Optional[str] = None,
    police_station: Optional[str] = None,
    sureties: Sequence[Mapping[str, Any]] = (),   # {name, address, amount}
    accused_gender: Optional[str] = None,          # resolves his/her when no title
    filing_date: Optional[date] = None,            # the intake's date of filing (today)
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

    # Sureties are furnished before the court that granted bail unless another is named.
    court, at = court_and_place(court_name or granting_court, court_place)
    if not (complainant_name or "").strip() and (police_station or "").strip():
        complainant_name = state_respondent(police_station)

    context: Dict[str, Any] = {
        "court_name": court,
        "sureties": [{"name": x.get("name") or "", "address": x.get("address"),
                      "amount": bare_sum(x.get("amount")) or None} for x in sureties],
        "accused_name": accused_name,
        "pr": pronouns(accused_name, accused_gender),
        "granting_court": court_and_place(granting_court, None)[0],
        "bail_granted": bail_granted,
        "bail_order_ref": (bail_order_ref or "").strip(),
        "bail_order_date": bail_order_date.isoformat(),
        "case_ref": case_ref,
        "place": place,
        "complainant_name": complainant_name,
        "memo_date": ((memo_date or filing_date).isoformat()
                      if (memo_date or filing_date) else None),
        "court_place": at,
    }
    return MemorandumFurnishSuretiesResult(refused=False, context=context)
