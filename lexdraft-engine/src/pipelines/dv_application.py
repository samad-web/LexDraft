"""Protection of Women from Domestic Violence Act s.12 application — pipeline (spec 6.4).

Hard checks (each refuses, no partial output):
  - Domestic relationship is the JURISDICTIONAL FACT — pleaded expressly or refuse.
  - Shared household must be pleaded if a residence order under s.19 is sought.
  - Each relief head (s.18/19/20/21/22) needs supporting averments; a relief
    sought without support is REFUSED, not flagged — the same discipline as the
    prayer engine.
  - Abuse instances are dated where possible and categorised.

LLM slot at paragraph 4 (domestic incidents) only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "dv_application.docx"
SPEC = "6.4"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


class AbuseCategory(Enum):
    PHYSICAL = "physical"
    SEXUAL = "sexual"
    VERBAL_EMOTIONAL = "verbal_emotional"
    ECONOMIC = "economic"


class ReliefHead(Enum):
    PROTECTION_18 = "s.18 protection"
    RESIDENCE_19 = "s.19 residence"
    MONETARY_20 = "s.20 monetary"
    CUSTODY_21 = "s.21 custody"
    COMPENSATION_22 = "s.22 compensation"


# The operative words of each order, for the lettered prayer ({rs} = respondent/s).
_PRAYER_LEAD = {
    ReliefHead.PROTECTION_18: "pass a protection order under Section 18 of the Act "
                              "prohibiting the {rs} from committing any act of "
                              "domestic violence against the aggrieved person",
    ReliefHead.RESIDENCE_19: "pass a residence order under Section 19 of the Act "
                             "restraining the {rs} from dispossessing the aggrieved "
                             "person from the shared household",
    ReliefHead.MONETARY_20: "direct the {rs} to pay monetary relief under Section 20 "
                            "of the Act",
    ReliefHead.CUSTODY_21: "grant temporary custody of the child to the aggrieved "
                           "person under Section 21 of the Act",
    ReliefHead.COMPENSATION_22: "direct the {rs} to pay compensation and damages "
                                "under Section 22 of the Act",
}


@dataclass(frozen=True)
class AbuseIncident:
    category: AbuseCategory
    date: Optional[str]           # ISO date string, or None where not datable
    description: str


@dataclass(frozen=True)
class ReliefSought:
    head: ReliefHead
    averment: str                 # supporting averment; empty -> unsupported


@dataclass(frozen=True)
class DvResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(
    reason: str,
    *,
    code: str,
    fields: tuple = (),
    computation: Optional[str] = None,
    remedy_hint: str = "none",
) -> DvResult:
    return DvResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            computation=computation, pipeline="dv_application", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def build(
    *,
    aggrieved_name: str,
    respondent_name: str,
    domestic_relationship_pleaded: bool,
    domestic_relationship_basis: str,
    shared_household_pleaded: bool,
    shared_household_particulars: str,
    reliefs: Sequence[ReliefSought],
    incidents: Sequence[AbuseIncident],
    jurisdiction_basis: str,
    place: str,
    incidents_narrative: str,
    # cause-title header (DPC book). Optional.
    magistrate_court: Optional[str] = None,
    city: Optional[str] = None,
    filing_date: Optional[date] = None,
    # every respondent (husband, mother-in-law, ...) when more than one. Optional.
    respondent_names: Optional[Sequence[str]] = None,
    # cause-title particulars. Optional.
    aggrieved_age: Optional[int] = None,
    aggrieved_address: Optional[str] = None,
    respondent_address: Optional[str] = None,  # the shared household, as a rule
) -> DvResult:
    """Assemble the DV s.12 application, or refuse."""

    # 1. domestic relationship — the jurisdictional fact.
    if not domestic_relationship_pleaded or not domestic_relationship_basis.strip():
        return _refuse(
            "the domestic relationship is the jurisdictional fact under the DV Act "
            "and must be pleaded expressly with its basis; it is absent",
            code="dv_domestic_relationship_not_pleaded",
            fields=("domestic_relationship_pleaded", "domestic_relationship_basis"),
        )

    # 2. at least one relief.
    if not reliefs:
        return _refuse(
            "no relief is sought; a s.12 application must claim relief",
            code="dv_no_relief_sought", fields=("reliefs",),
        )

    # 3. residence order -> shared household must be pleaded.
    seeks_residence = any(r.head is ReliefHead.RESIDENCE_19 for r in reliefs)
    if seeks_residence and not shared_household_pleaded:
        return _refuse(
            "a residence order under s.19 is sought but the shared household is not "
            "pleaded; the shared household is a precondition for a residence order",
            code="dv_residence_order_no_shared_household",
            fields=("shared_household_pleaded", "reliefs"),
        )

    # 4. per-relief-head support — refuse (not flag) any unsupported relief.
    for r in reliefs:
        if not r.averment.strip():
            return _refuse(
                f"relief under {r.head.value} is sought without any supporting "
                f"averment; unsupported relief is refused",
                code="dv_relief_head_unsupported", fields=("reliefs",),
            )

    # One entry per person: "Mr. V. Sathish" and "Mr. V. Sathish (husband)" are the
    # same respondent (r10 listed him twice).
    def _key(n: str) -> str:
        n = re.sub(r"\([^)]*\)", " ", n.lower())
        n = re.sub(r"\b(mr|mrs|ms|smt|thiru|tmt|dr)\b\.?", " ", n)
        return " ".join(re.sub(r"[^a-z0-9]+", " ", n).split())

    respondents: List[str] = []
    for n in [respondent_name, *(respondent_names or [])]:
        n = n.strip()
        if not n:
            continue
        same = next((i for i, r in enumerate(respondents) if _key(r) == _key(n)), None)
        if same is None:
            respondents.append(n)
        elif len(n) > len(respondents[same]):
            respondents[same] = n  # keep the fuller description
    # The prayer is the operative order alone; a monetary figure in its averment is
    # carried ("of Rs. 30,000 per month"), never the averment glued on after a colon.
    def _prayer(r: ReliefSought) -> str:
        lead = _PRAYER_LEAD[r.head].format(rs=rs)
        if r.head is ReliefHead.MONETARY_20:
            m = re.search(r"Rs\.?\s*[\d,]+(?:/-)?(?:\s+per\s+(?:month|mensem|annum))?",
                          r.averment, re.I)
            if m:
                per = (" per month" if " per " not in m.group(0)
                       and re.search(r"\bmonthly\b", r.averment, re.I) else "")
                lead += f" of {m.group(0)}{per}"
        return lead
    rs = "respondents" if len(respondents) > 1 else "respondent"

    context: Dict[str, Any] = {
        "aggrieved": {"name": aggrieved_name},
        "respondent": {"name": respondent_name},
        "respondents": respondents,
        # one lettered prayer clause per order sought (ss.18-22)
        "relief_prayers": [_prayer(r) for r in reliefs],
        "aggrieved_age": aggrieved_age,
        "aggrieved_address": aggrieved_address,
        "respondent_address": respondent_address,
        # cause-title header fields (render only when present).
        "magistrate_court": magistrate_court,
        "city": city,
        "application_year": filing_date.year if filing_date else None,
        "application_date": filing_date.isoformat() if filing_date else None,
        "domestic_relationship_basis": domestic_relationship_basis,
        "shared_household_pleaded": shared_household_pleaded,
        "shared_household_particulars": shared_household_particulars,
        "reliefs": [
            {"head": r.head.value, "averment": r.averment} for r in reliefs
        ],
        "incidents": [
            {"category": i.category.value, "date": i.date,
             "description": i.description}
            for i in incidents
        ],
        "jurisdiction_basis": jurisdiction_basis,
        # LLM slot (para 4)
        # the slot marker only when nothing is pleaded (r10: a stray "[to be drafted]"
        # survived beside the listed incidents).
        "incidents_slot": incidents_narrative if incidents_narrative.strip()
                          else ("" if incidents else _LLM_SLOT_PLACEHOLDER),
        "place": place,
    }
    return DvResult(refused=False, context=context)
