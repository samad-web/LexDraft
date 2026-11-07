"""Memo of Appearance — counsel's entry of appearance (TN/Madras forms set).

A memo of appearance is the short filing by which counsel, having been instructed
(usually under a vakalatnama), formally enters appearance for a party. Distinct
from the vakalatnama itself, which is the appointment/authority; the memo is the
notice to the registry that counsel appears. The forms set carried a generic
(trial/district) version and a High Court Appellate-Side version addressed to the
Deputy Registrar; this pipeline unifies them and generalises the forum.

This is a PARTY-FILED document.

Hard requirements (each refuses, no partial output):
  - The party on whose behalf appearance is entered must be identified (role).
  - Counsel entering appearance must be named.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity
from ._court_form import court_heading, opposite_role

TEMPLATE = "memo_of_appearance.docx"
SPEC = "tn-memo"


@dataclass(frozen=True)
class MemoOfAppearanceResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> MemoOfAppearanceResult:
    return MemoOfAppearanceResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="memo_of_appearance", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    counsel_name: str,
    party_represented: str,        # "Appellant" | "Petitioner" | "Respondent" | etc.
    party_name: str,
    case_ref: str,
    place: str,
    court_name: Optional[str] = None,
    court_place: Optional[str] = None,
    opposite_party_name: Optional[str] = None,
    addressed_to: Optional[str] = None,   # e.g. "The Deputy Registrar, Appellate Side"
    enrolment_no: Optional[str] = None,
    filing_date: Optional[date] = None,
) -> MemoOfAppearanceResult:
    """Assemble the memo of appearance, or refuse."""

    # 1. the party being represented must be identified.
    if not party_represented.strip():
        return _refuse(
            "the memo must state on whose behalf appearance is entered "
            "(Appellant / Petitioner / Respondent / etc.); it is absent",
            code="memo_party_represented_missing",
            fields=("party_represented",),
        )

    # 2. counsel entering appearance must be named.
    if not counsel_name.strip():
        return _refuse(
            "the counsel entering appearance must be named",
            code="memo_counsel_not_named",
            fields=("counsel_name",),
        )

    # Full cause title, petitioner side first: appearing for a respondent still
    # shows who brought the matter (a blank when the brief does not name them).
    rep = party_represented.strip()
    rep = rep[:1].upper() + rep[1:]
    us = (party_name, rep)
    them = ((opposite_party_name or "").strip() or "______", opposite_role(rep) or "Opposite Party")
    first, second = (them, us) if rep.lower() in ("respondent", "defendant", "accused") else (us, them)
    court, court_at = court_heading(court_name, court_place)
    context: Dict[str, Any] = {
        "first_name": first[0], "first_label": first[1],
        "second_name": second[0], "second_label": second[1],
        "filing_date": filing_date.isoformat() if filing_date else None,
        "counsel_name": counsel_name,
        "party_represented": party_represented,
        "party_name": party_name,
        "case_ref": case_ref,
        "place": place,
        "court_name": court,
        "court_place": court_at,
        "opposite_party_name": opposite_party_name,
        "addressed_to": addressed_to,
        "enrolment_no": enrolment_no,
    }
    return MemoOfAppearanceResult(refused=False, context=context)
