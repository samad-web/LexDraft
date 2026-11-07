"""Bail bond (ss.478-485 BNSS; ss.436-441 CrPC for a pre-1.7.2024 case) — document pipeline.

A bail bond is the instrument executed by the accused, together with one or more
sureties, AFTER a court has granted bail. By it the accused binds himself (and the
sureties bind themselves) to a forfeiture sum, undertaking that the accused will
attend the court on the appointed dates and abide by the conditions of the grant;
on default the bond is forfeited under s.446 CrPC. The court name and place are
placeholders — the bond adapts to any state. PARTY-FILED (executed by the accused
and the sureties, not issued by the court).

Hard requirements (each refuses, no partial output):
  - Bail must actually have been granted, and the grant (with its order date)
    must be shown — a bond executed before any grant is meaningless.
  - The accused who binds himself must be named.
  - The forfeiture sum the bond secures must be stated (a bond for no sum binds
    nothing).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional, Sequence

from ..verify.refusals import Refusal, Severity
from ._code_framework import provision
from ._court import bare_sum, court_and_place, parentage
from ._state_party import state_respondent

TEMPLATE = "bail_bond.docx"
SPEC = "tn-bailbond"


@dataclass(frozen=True)
class Surety:
    name: str
    address: Optional[str] = None
    forfeiture_sum: Optional[str] = None


@dataclass(frozen=True)
class BailBondResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> BailBondResult:
    return BailBondResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="bail_bond", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    accused_name: str,
    offence_section: str,
    bail_granted: bool,
    bail_order_court: str,
    bail_order_date: Optional[date],
    forfeiture_sum: str,
    sureties: Sequence[Surety],
    case_ref: str,
    place: str,
    complainant_name: Optional[str] = None,
    committing_magistrate: Optional[str] = None,
    attend_date: Optional[date] = None,
    prison_superintendent: Optional[str] = None,
    bond_date: Optional[date] = None,
    court_place: Optional[str] = None,
    court_name: Optional[str] = None,
    accused_age: Optional[str] = None,
    accused_parentage: Optional[str] = None,
    accused_address: Optional[str] = None,
    police_station: Optional[str] = None,
) -> BailBondResult:
    """Assemble the bail bond, or refuse."""

    # 1. a bail bond is executed only AFTER bail has been granted; the grant
    #    (with its order date) must be shown.
    if not (bail_granted and bail_order_date is not None):
        return _refuse(
            "a bail bond is executed only AFTER bail has been granted; the grant "
            "(with its order date) is not shown",
            code="bail_bond_bail_not_granted",
            fields=("bail_granted", "bail_order_date"),
        )

    # 2. the accused who binds himself must be named.
    if not accused_name.strip():
        return _refuse(
            "a bail bond must name the accused who binds himself to attend the "
            "court; the name is absent",
            code="bail_bond_accused_missing",
            fields=("accused_name",),
        )

    # 3. the forfeiture sum the bond secures must be stated.
    if not forfeiture_sum.strip():
        return _refuse(
            "a bail bond must state the sum on forfeiture of which the accused "
            "and sureties bind themselves; that sum is absent",
            code="bail_bond_forfeiture_sum_missing",
            fields=("forfeiture_sum",),
        )

    # The bond is executed before the court that granted bail unless another is named.
    court, at = court_and_place(court_name or bail_order_court, court_place)
    particulars = "".join(
        f", {v}" for v in (
            parentage(accused_parentage, accused_name),
            f"aged {str(accused_age).strip()} years" if (accused_age or "").strip() else "",
            f"residing at {accused_address.strip()}" if (accused_address or "").strip() else "",
        ) if v)
    if not (complainant_name or "").strip() and (police_station or "").strip():
        complainant_name = state_respondent(police_station)

    context: Dict[str, Any] = {
        "court_name": court,
        "bond_provision": provision("bail_bond", case_ref),
        "accused_particulars": particulars,
        "accused_name": accused_name,
        "offence_section": offence_section,
        "bail_granted": bail_granted,
        "bail_order_court": court_and_place(bail_order_court, None)[0],
        "bail_order_date": bail_order_date.isoformat(),
        "forfeiture_sum": bare_sum(forfeiture_sum),
        "sureties": [
            {"name": s.name, "address": s.address,
             "forfeiture_sum": bare_sum(s.forfeiture_sum) or None}
            for s in sureties
        ],
        "case_ref": case_ref,
        "place": place,
        "complainant_name": complainant_name,
        "committing_magistrate": committing_magistrate,
        "attend_date": attend_date.isoformat() if attend_date is not None else None,
        "prison_superintendent": prison_superintendent,
        "bond_date": bond_date.isoformat() if bond_date is not None else None,
        "court_place": at,
    }
    return BailBondResult(refused=False, context=context)
