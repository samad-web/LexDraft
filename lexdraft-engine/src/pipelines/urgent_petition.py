"""Petition for urgent listing (s.151 CPC, inherent powers) — pipeline.

PARTY-FILED. Where a substantive application has already been taken out in a
pending matter and the party apprehends prejudice unless it is heard at once,
this petition invokes the inherent powers of the court under s.151 CPC to have
that application treated as urgent, taken up out of turn, and disposed of
expeditiously. Generalised for any state.

Hard requirements (each refuses, no partial output):
  - There must be a substantive application already taken out in a pending
    matter; an urgent-listing petition rides on an existing application and
    cannot stand alone.
  - The petition must state the orders prayed for on the urgent listing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional

from ..verify.refusals import Refusal, Severity
from ._court_form import his_her, court_heading, opposite_role

TEMPLATE = "urgent_petition.docx"
SPEC = "tn-urgent"


@dataclass(frozen=True)
class UrgentPetitionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> UrgentPetitionResult:
    return UrgentPetitionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="urgent_petition", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    petitioner_name: str,
    respondent_name: str,
    underlying_application: str,
    orders_prayed: str,
    case_ref: str,
    place: str,
    court_place: Optional[str] = None,
    petition_date: Optional[date] = None,
    court_name: Optional[str] = None,
    # why it cannot wait, e.g. "the defendant started construction on 01.11.2026"
    urgency_grounds: Optional[str] = None,
    posted_date: Optional[date] = None,       # date the application now stands posted to
    petitioner_role: Optional[str] = None,    # "plaintiff" / "defendant" in the suit
    # interim order pending the advanced hearing, e.g. "direct the parties to maintain status quo"
    interim_prayer: Optional[str] = None,
) -> UrgentPetitionResult:
    """Assemble the s.151 CPC urgent-listing petition, or refuse."""

    # 1. an urgent-listing petition presupposes a substantive application already
    #    taken out in a pending matter.
    if not underlying_application.strip():
        return _refuse(
            "an urgent-listing petition presupposes a substantive application "
            "already taken out in a pending matter; with no such application "
            "identified the petition has nothing to have listed urgently",
            code="urgent_petition_no_underlying_application",
            fields=("underlying_application",),
        )

    # 2. the petition must state the orders prayed for on the urgent listing.
    if not orders_prayed.strip():
        return _refuse(
            "the petition must state the orders prayed for on the urgent listing; a "
            "bare prayer to treat the matter as urgent, without the orders sought, "
            "is not maintainable",
            code="urgent_petition_orders_prayed_missing",
            fields=("orders_prayed",),
        )

    court, court_at = court_heading(court_name, court_place)
    # "the defendant" is a role, not a name: leave the blank for the advocate.
    if re.fullmatch(r"\s*(the\s+)?(defendant|respondent|plaintiff|petitioner)s?\s*", respondent_name or "", re.I):
        respondent_name = ""
    # The prayer reads "may be pleased to treat the matter as urgent and <orders>".
    # An infinitive ("To advance the hearing ...") follows "and"; a noun phrase
    # ("an interim injunction ...") follows "and grant".
    orders = orders_prayed.strip().rstrip(". ")
    verb = re.match(r"(to\s+)?(advance|list|post|hear|grant|pass|direct|restrain|stay|take|call|issue|order|"
                    r"permit|appoint|extend|dispense|condone|recall|set)\b", orders, re.I)
    orders = re.sub(r"^to\s+", "", orders, flags=re.I) if verb else "grant " + orders
    orders = orders[:1].lower() + orders[1:]
    grounds = re.sub(r"^\s*because\s+", "", (urgency_grounds or "").strip(), flags=re.I).rstrip(". ")
    # r12: "because The defendant started construction" — a clause mid-sentence.
    if grounds[1:2].islower():
        grounds = grounds[:1].lower() + grounds[1:]
    interim = re.sub(r"^\s*(and\s+)?(to\s+)?", "", (interim_prayer or "").strip(), flags=re.I).rstrip(". ")
    side = (petitioner_role or "").strip().title()
    other = opposite_role(side)
    context: Dict[str, Any] = {
        "petitioner_name": petitioner_name,
        "respondent_name": respondent_name or "______",
        "petitioner_label": f"Petitioner/{side}" if other else "Petitioner",
        "respondent_label": f"Respondent/{other}" if other else "Respondent",
        "underlying_application": underlying_application,
        "orders_prayed": orders,
        "urgency_grounds": grounds,
        "interim_prayer": interim[:1].lower() + interim[1:] if not interim or re.match(
            r"(direct|grant|restrain|order|stay|permit|pass)\b", interim, re.I) else "grant " + interim,
        "his_her": his_her(petitioner_name),
        "posted_date": posted_date.isoformat() if posted_date else None,
        "court_name": court,
        "case_ref": case_ref,
        "court_place": court_at,
        "petition_date": petition_date.isoformat() if petition_date is not None else None,
        "place": place,
    }
    return UrgentPetitionResult(refused=False, context=context)
