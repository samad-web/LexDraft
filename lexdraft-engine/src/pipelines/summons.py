"""Court summons — document pipeline.

COURT-ISSUED INSTRUMENT. A summons issues from the court/registry under its seal;
the advocate only PREPARES a draft for the court's issue and never authors the
court's own process. The context therefore carries ``"court_issues": True`` so the
template can print the marker banner "[COURT ISSUES THIS — the advocate prepares
this draft for the court's issue]".

Covers three summonses: a summons to a defendant to appear and answer (Order V
CPC), a summons to a witness to give evidence and/or produce documents (Order XVI
CPC), and a summary-suit summons requiring appearance within ten days (Order XXXVII
Rule 2 CPC, Appendix B Form 4).

Hard requirements (each refuses, no partial output):
  - The plaintiff and the defendant/witness must both be named.
  - A witness summons must state what evidence/documents the witness is to give or
    produce and/or the date of attendance.
  - An Order XXXVII summary-suit summons must state the sum claimed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity

TEMPLATE = "summons.docx"
SPEC = "tn-summons"


class SummonsKind(Enum):
    CIVIL_DEFENDANT = "civil_defendant"   # Order V CPC — summons to defendant to appear/answer
    WITNESS = "witness"                   # Order XVI CPC — summons to a witness to give evidence/produce documents
    SUMMARY_SUIT = "summary_suit"         # Order XXXVII Rule 2 CPC, Appendix B Form 4 — appearance within ten days


@dataclass(frozen=True)
class SummonsResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> SummonsResult:
    return SummonsResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="summons", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    kind: SummonsKind,
    case_ref: str,
    plaintiff_name: str,
    defendant_or_witness_name: str,
    place: str,
    court_place: Optional[str] = None,
    cause_of_action: Optional[str] = None,
    appearance_date: Optional[date] = None,
    documents_to_produce: Optional[str] = None,   # witness
    expenses_tendered: Optional[str] = None,       # witness diet money
    claim_amount: Optional[str] = None,            # summary suit
    costs: Optional[str] = None,
    seal_date: Optional[date] = None,
) -> SummonsResult:
    """Assemble the court summons draft for the court's issue, or refuse."""

    # 1. both parties must be named.
    if not plaintiff_name.strip() or not defendant_or_witness_name.strip():
        return _refuse(
            "a summons must name the plaintiff and the defendant/witness to whom it "
            "is addressed; one or both are absent",
            code="summons_parties_missing",
            fields=("plaintiff_name", "defendant_or_witness_name"),
        )

    # 2. a witness summons must state what is to be given/produced and/or when.
    if kind is SummonsKind.WITNESS:
        if not (documents_to_produce or "").strip() and appearance_date is None:
            return _refuse(
                "a witness summons must state what evidence/documents the witness is "
                "to give/produce and when; neither is stated",
                code="summons_witness_no_particulars",
                fields=("documents_to_produce", "appearance_date"),
            )

    # 3. a summary-suit summons must state the sum claimed.
    if kind is SummonsKind.SUMMARY_SUIT:
        if not (claim_amount or "").strip():
            return _refuse(
                "an Order XXXVII summary-suit summons must state the sum claimed; it "
                "is absent",
                code="summons_summary_suit_claim_missing",
                fields=("claim_amount",),
            )

    context: Dict[str, Any] = {
        "court_issues": True,
        "kind": kind.value,
        "case_ref": case_ref,
        "plaintiff_name": plaintiff_name,
        "defendant_or_witness_name": defendant_or_witness_name,
        "place": place,
        "court_place": court_place,
        "cause_of_action": cause_of_action,
        "appearance_date": appearance_date.isoformat() if appearance_date else None,
        "documents_to_produce": documents_to_produce,
        "expenses_tendered": expenses_tendered,
        "claim_amount": claim_amount,
        "costs": costs,
        "seal_date": seal_date.isoformat() if seal_date else None,
    }
    return SummonsResult(refused=False, context=context)
