"""Cause title — context builder + validation (spec 1.1).

Variants (structural forks, not styling):
  DISTRICT_CIVIL     — Plaintiff / Defendant.
  WRIT               — Petitioner / Respondents, Article 226.
  SESSIONS_CRIMINAL  — Accused / State, custody line.
  APPEAL             — Appellant / Respondent + lower-court reference line.
  (further variants — original/appellate side, division bench, NCLT, family,
   tribunal, execution — extend from these skeletons.)

Validation (deterministic, spec 1.1):
  - Party serial numbers continuous per role, no gaps.
  - Minor -> guardian block; company -> CIN + rep. (enforced at Party level)
  - Writ respondent order: authority first, private parties last.
  - Custody line present if in_custody true.
  - Lower-court reference present for all appeals/revisions.
"""

from __future__ import annotations

from collections import defaultdict
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..factsheet import Party, PartyRole, Court, Case
from ..rules._result import Assessment

TEMPLATE = "cause_title.docx"


class Variant(Enum):
    DISTRICT_CIVIL = "district_civil"
    WRIT = "writ"
    SESSIONS_CRIMINAL = "sessions_criminal"
    APPEAL = "appeal"


def _party_ctx(p: Party) -> Dict[str, Any]:
    return {
        "serial": p.serial,
        "name": p.name,
        "age": p.age,
        "parentage_type": p.parentage_type,
        "parentage_name": p.parentage_name,
        "occupation": p.occupation,
        "address": p.address,
        "is_minor": p.is_minor,
        "guardian": (
            {"name": p.guardian.name, "relation": p.guardian.relation,
             "capacity": p.guardian.capacity}
            if p.guardian else None
        ),
        "is_company": p.is_company,
        "cin": p.cin,
        "rep_by": p.rep_by,
        "rep_designation": p.rep_designation,
        "is_authority": p.is_authority,
        "in_custody": p.in_custody,
        "prison": p.prison,
    }


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def validate(
    *,
    variant: Variant,
    parties: Sequence[Party],
    lower_court_reference: Optional[str] = None,
) -> Assessment:
    # 1. serial continuity per role
    by_role: Dict[PartyRole, List[int]] = defaultdict(list)
    for p in parties:
        by_role[p.role].append(p.serial)
    for role, serials in by_role.items():
        ordered = sorted(serials)
        expected = list(range(1, len(ordered) + 1))
        if ordered != expected:
            return Assessment.refuse(
                reason=f"party serial numbers for {role.value} are not continuous: "
                       f"got {ordered}, expected {expected}",
                computation=f"{role.value} serials={ordered}",
            )

    # 2. custody line present if in_custody
    for p in parties:
        if p.in_custody and not p.prison:
            return Assessment.refuse(
                reason=f"party {p.name!r} is in custody but no place of custody "
                       f"(prison) is supplied; the custody line cannot be printed",
            )

    # 3. writ respondent ordering: authority first, private last
    if variant is Variant.WRIT:
        respondents = [p for p in parties if p.role == PartyRole.RESPONDENT]
        ordered = sorted(respondents, key=lambda p: p.serial)
        seen_private = False
        for r in ordered:
            if r.is_authority and seen_private:
                return Assessment.refuse(
                    reason="writ respondent order invalid: an authority respondent "
                           "follows a private respondent; authorities must come first",
                    computation=f"order={[(r.serial, r.is_authority) for r in ordered]}",
                )
            if not r.is_authority:
                seen_private = True

    # 4. appeal / revision must carry a lower-court reference
    if variant is Variant.APPEAL and not lower_court_reference:
        return Assessment.refuse(
            reason="appeal/revision cause title requires a lower court case "
                   "reference line",
        )

    return Assessment.allow()


# --------------------------------------------------------------------------
# Context builder
# --------------------------------------------------------------------------

def build_context(
    *,
    variant: Variant,
    court: Court,
    case: Case,
    parties: Sequence[Party],
    court_place: str,
    court_side: Optional[str] = None,
    court_bench: Optional[str] = None,
    writ_type: Optional[str] = None,
    prayer_short: Optional[str] = None,
    crime_ref: Optional[str] = None,
    crime_no: Optional[str] = None,
    crime_year: Optional[str] = None,
    police_station: Optional[str] = None,
    district: Optional[str] = None,
    lower_court_reference: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the docxtpl context. Validation is run first; a refused title raises
    so no defective context is ever handed to the renderer."""
    verdict = validate(variant=variant, parties=parties,
                       lower_court_reference=lower_court_reference)
    if verdict.refused:
        raise ValueError(verdict.reason)

    ctx: Dict[str, Any] = {
        "variant": variant.value,
        "court": {
            "name": court.name,
            "place": court_place,
            "side": court_side,
            "bench": court_bench,
        },
        "case": {
            "type": case.document_type,
            "number": case.case_number,
            "year": case.year,
        },
        "lower_court_reference": lower_court_reference,
    }

    def in_role(role: PartyRole) -> List[Dict[str, Any]]:
        return [_party_ctx(p) for p in
                sorted((x for x in parties if x.role == role), key=lambda x: x.serial)]

    if variant is Variant.DISTRICT_CIVIL:
        ctx["plaintiffs"] = in_role(PartyRole.PLAINTIFF)
        ctx["defendants"] = in_role(PartyRole.DEFENDANT)
    elif variant is Variant.WRIT:
        ctx["petitioners"] = in_role(PartyRole.PETITIONER)
        ctx["respondents"] = in_role(PartyRole.RESPONDENT)
        ctx["writ_type"] = writ_type
        ctx["prayer_short"] = prayer_short
    elif variant is Variant.SESSIONS_CRIMINAL:
        accused = in_role(PartyRole.ACCUSED)
        ctx["accused"] = accused[0] if accused else None
        ctx["all_accused"] = accused
        ctx["crime_ref"] = crime_ref
        ctx["crime_no"] = crime_no
        ctx["crime_year"] = crime_year
        ctx["police_station"] = police_station
        ctx["district"] = district
    elif variant is Variant.APPEAL:
        ctx["appellants"] = in_role(PartyRole.APPELLANT)
        ctx["respondents"] = in_role(PartyRole.RESPONDENT)

    return ctx
