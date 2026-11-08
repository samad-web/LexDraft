"""Petition for adjournment/postponement (Order XVII Rule 1 CPC) — pipeline.

PARTY-FILED. Order XVII Rule 1 CPC empowers the court, if sufficient cause is
shown, to grant time to the parties or to any of them and, from time to time, to
adjourn the hearing of the suit. This petition prays the court to adjourn the
hearing to a subsequent date, stating the purpose for which the case stands
posted today and the ground on which time/adjournment is sought. Generalised for
any state.

Hard requirements (each refuses, no partial output):
  - The petition must state the purpose for which the case is posted today; an
    adjournment prayer must fix what stage the case is at.
  - The petition must state the ground on which time/adjournment is sought;
    Order XVII Rule 1 requires sufficient cause to be shown.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity
from ._court_form import deponent_particulars, his_her, opposite_role

TEMPLATE = "adjournment_petition.docx"
SPEC = "tn-adjourn"


_ROLE_ONLY = re.compile(r"\s*(the\s+)?(plaintiff|defendant)s?\s*", re.I)
_ON_DATE = re.compile(r"\s+on\s+(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4}-\d{2}-\d{2})$", re.I)


@dataclass(frozen=True)
class AdjournmentPetitionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> AdjournmentPetitionResult:
    return AdjournmentPetitionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="adjournment_petition", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def _suit_nature(text: Optional[str]) -> Optional[str]:
    """'Declaration and injunction over a cart-track' -> 'a suit for declaration and
    injunction over a cart-track' (b2 item 3); a gap or nothing -> None."""
    t = (text or "").strip().rstrip(".")
    if not t or t.startswith("["):
        return None
    t = t[0].lower() + t[1:]
    if re.match(r"(?:a|an|the)\s", t):
        return t
    return ("a " + t) if t.startswith("suit") else f"a suit for {re.sub(r'^for\s+', '', t)}"


def build(
    *,
    petitioner_name: str,
    respondent_name: str,
    posted_for: str,
    adjournment_reason: str,
    case_ref: str,
    place: str,
    court_place: Optional[str] = None,
    petition_date: Optional[date] = None,
    court_name: Optional[str] = None,
    hearing_date: Optional[date] = None,
    adjournment_period: str = "",
    petitioner_role: Optional[str] = None,    # "defendant" / "plaintiff" in the suit
    petitioner_age: Optional[str] = None,     # b2: the deponent's age in the affidavit
    suit_nature: Optional[str] = None,        # b2: "a suit for declaration and injunction ..."
) -> AdjournmentPetitionResult:
    """Assemble the Order XVII Rule 1 adjournment petition, or refuse."""

    # 1. the petition must state the purpose for which the case is posted today.
    if not posted_for.strip():
        return _refuse(
            "the petition must state the purpose for which the case is posted today; "
            "an adjournment prayer must fix the stage at which the case stands",
            code="adjournment_posted_for_missing",
            fields=("posted_for",),
        )

    # 2. Order XVII Rule 1 requires the ground on which time/adjournment is sought.
    if not adjournment_reason.strip():
        return _refuse(
            "Order XVII Rule 1 requires the ground on which time/adjournment is "
            "sought; a bare prayer to adjourn, without sufficient cause shown, is "
            "not maintainable",
            code="adjournment_reason_missing",
            fields=("adjournment_reason",),
        )

    # r10: "posted today for cross-examination of PW1 on 10.11.2026" — the hearing
    # date rode in on posted_for; it is the date the case stands posted to.
    posted = posted_for.strip().rstrip(".")
    m = _ON_DATE.search(posted)
    when = hearing_date.isoformat() if hearing_date else (m.group(1) if m else None)
    if m:
        posted = posted[:m.start()].rstrip(" ,")
    # A multi-line reason (a textarea) rendered its later lines as loose paragraphs
    # outside para 2, which compose then left behind as stray text (r10).
    reason = " ".join(adjournment_reason.split()).rstrip(".")

    # r12: "by About four weeks" — the period follows "by" mid-sentence.
    period = adjournment_period.strip().rstrip(".")
    if period[1:2].islower():
        period = period[:1].lower() + period[1:]
    # The petitioner is often the defendant (r12): the cause title reads
    # "Petitioner/Defendant" v "Respondent/Plaintiff"; a bare role word in the
    # respondent slot is a missing name, not a name.
    side = (petitioner_role or "").strip().title()
    if _ROLE_ONLY.fullmatch(respondent_name or ""):
        side = side or opposite_role(_ROLE_ONLY.fullmatch(respondent_name).group(2))
        respondent_name = f"[name of the {opposite_role(side).lower()} to be provided]"
    other = opposite_role(side)
    context: Dict[str, Any] = {
        "petitioner_label": f"Petitioner/{side}" if other else "Petitioner",
        "respondent_label": f"Respondent/{other}" if other else "Respondent",
        "his_her": his_her(petitioner_name),
        "deponent_particulars": deponent_particulars(petitioner_age),
        "suit_nature": _suit_nature(suit_nature),
        "court_name": (court_name or "").strip() or None,
        "hearing_date": when,
        "adjournment_period": period,
        "petitioner_name": petitioner_name,
        "respondent_name": respondent_name,
        "posted_for": posted,
        "adjournment_reason": reason,
        "case_ref": case_ref,
        "court_place": court_place,
        "petition_date": petition_date.isoformat() if petition_date is not None else None,
        "place": place,
    }
    return AdjournmentPetitionResult(refused=False, context=context)
