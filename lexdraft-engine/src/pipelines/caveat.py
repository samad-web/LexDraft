"""Caveat under s.148-A CPC — document pipeline (DPC book p.30).

A caveator who apprehends that an adverse party will file a proceeding (here, a
Civil Misc. (Main) Petition under Art.227) against an order files a caveat so that
no ex-parte order/stay is granted without notice to the caveator. The book (p.30)
recites the order sought to be challenged, the apprehended proceeding, the
caveator's right to be heard, and that a copy has been served on the other side.

Hard requirements (each refuses, no partial output):
  - The order/judgment giving rise to the apprehended proceeding must be
    identified (a caveat in the air is meaningless).
  - The caveator must aver that a copy of the caveat has been served on the
    expected petitioner (s.148-A(2) CPC — a mandatory step for a valid caveat).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "caveat.docx"
SPEC = "dpc-30"


@dataclass(frozen=True)
class CaveatResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> CaveatResult:
    return CaveatResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="caveat", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    caveator_name: str,
    expected_petitioner_name: str,
    impugned_order_ref: str,
    impugned_order_date: Optional[date],
    lower_court: str,
    apprehended_proceeding: str,
    copy_served_on_petitioner: bool,
    filing_date: date,
    place: str,
    court_name: Optional[str] = None,
    # cause-title header (DPC book p.30). Optional.
    caveator_parentage: Optional[str] = None,
    caveator_address: Optional[str] = None,
    petitioner_parentage: Optional[str] = None,
    petitioner_address: Optional[str] = None,
) -> CaveatResult:
    """Assemble the s.148-A caveat, or refuse."""

    # 1. the order giving rise to the apprehended proceeding must be identified.
    if not impugned_order_ref.strip() or impugned_order_date is None:
        return _refuse(
            "a caveat must identify the order/judgment against which a proceeding is "
            "apprehended (its reference and date); it is absent",
            code="caveat_impugned_order_not_identified",
            fields=("impugned_order_ref", "impugned_order_date"),
        )

    # 2. s.148-A(2) CPC — a copy of the caveat must be served on the expected
    #    petitioner; a caveat without service is ineffective.
    if not copy_served_on_petitioner:
        return _refuse(
            "s.148-A(2) CPC requires the caveator to serve a copy of the caveat, by "
            "registered post, on the person by whom the application is expected to "
            "be made; that averment is absent and the caveat would be ineffective",
            code="caveat_copy_not_served",
            fields=("copy_served_on_petitioner",),
        )

    context: Dict[str, Any] = {
        "caveator": {"name": caveator_name, "parentage": caveator_parentage,
                     "address": caveator_address},
        "petitioner": {"name": expected_petitioner_name,
                       "parentage": petitioner_parentage,
                       "address": petitioner_address},
        "court_name": court_name,
        "caveat_year": filing_date.year,
        "caveat_date": filing_date.isoformat(),
        "impugned_order_ref": impugned_order_ref,
        "impugned_order_date": impugned_order_date,
        "lower_court": lower_court,
        "apprehended_proceeding": apprehended_proceeding,
        "copy_served_on_petitioner": copy_served_on_petitioner,
        "place": place,
    }
    return CaveatResult(refused=False, context=context)
