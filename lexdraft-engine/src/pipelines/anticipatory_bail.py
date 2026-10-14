"""Anticipatory bail application — document pipeline (spec 3.3).

Structurally different from regular bail: apprehension replaces custody.

Validation:
  - Reasonable apprehension must be stated — a bare/blank assertion is refused.
  - SC/ST s.18/18A bar and the already-arrested route are delegated to
    custody_computation.assess_anticipatory_bail (already tested).
  - Transit anticipatory bail adds a jurisdiction paragraph.

The [LLM] prosecution-case paragraph is a NAMED EMPTY SLOT ("[to be drafted]"
when the caller supplies nothing). This layer calls no LLM.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from ..rules import custody_computation as cc
from ..rules import dual_code_router as router
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from . import _code_framework as cf

TEMPLATE = "anticipatory_bail.docx"
SPEC = "3.3"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"

# VERIFY tables consumed: section-mapping labels + appointed day (via the router)
# and the bail-bar provenance (the SC/ST s.18/18A bar).
_CONSUMED_TABLES = ("section_mappings", "code_appointed_day", "bail_bars")


@dataclass(frozen=True)
class AnticipatoryBailDoc:
    refused: bool
    reason: str = ""
    route_to: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def build(
    *,
    accused_name: str,
    age: int,
    occupation: str,
    address: str,
    fir_no: str,
    police_station: str,
    district: str,
    sections: Sequence[str],
    offence_date: Optional[date],
    proceeding_start_date: Optional[date],
    is_fresh_action: bool,
    apprehension_basis: str,
    already_arrested: bool,
    is_scst_offence: bool,
    is_transit: bool,
    prosecution_case: str,
    place: str,
    # cause-title header (DPC book pp.77-78). Optional.
    accused_parentage: Optional[str] = None,
    bail_court: Optional[str] = None,
    application_date: Optional[date] = None,
) -> AnticipatoryBailDoc:
    """Assemble the anticipatory-bail application, or refuse / route."""

    # 0. code framework via the dual-code router. Precedes all other checks.
    routed = router.route(
        offence_date=offence_date,
        proceeding_start_date=proceeding_start_date,
        is_fresh_action=is_fresh_action,
    )
    if routed.refused:
        return AnticipatoryBailDoc(refused=True, reason=routed.reason, context=None,
                                   refusal=routed.refusal)
    code_framework = routed.code_framework
    sections_map = cf.resolve_sections(code_framework)

    # 1. statutory bars (already-arrested route + SC/ST s.18/18A bar).
    bar = cc.assess_anticipatory_bail(
        already_arrested=already_arrested,
        is_scst_offence=is_scst_offence,
    )
    if bar.refused:
        return AnticipatoryBailDoc(
            refused=True, reason=bar.reason, route_to=bar.route_to, context=None,
            refusal=bar.refusal,
        )

    # 2. reasonable apprehension must be stated (not a bare assertion).
    if not apprehension_basis.strip():
        reason = ("a reasonable apprehension of arrest must be stated with its "
                  "basis; a bare assertion is not sufficient")
        return AnticipatoryBailDoc(
            refused=True,
            reason=reason,
            context=None,
            refusal=Refusal(
                code="anticipatory_bail_apprehension_basis_not_stated",
                severity=Severity.HARD, reason=reason, pipeline="anticipatory_bail",
                spec=SPEC, fields=("apprehension_basis",),
            ),
        )

    context: Dict[str, Any] = {
        "accused": {"name": accused_name, "age": age, "occupation": occupation,
                    "address": address, "parentage": accused_parentage},
        "fir_no": fir_no,
        "police_station": police_station,
        "district": district,
        # cause-title header fields (render only when present).
        "city": district,
        "bail_court": bail_court,
        "bail_year": (application_date or offence_date).year
                     if (application_date or offence_date) else None,
        "bail_date": (application_date or offence_date).isoformat()
                     if (application_date or offence_date) else None,
        "sections": list(sections),
        "code_framework": code_framework,
        "anticipatory_bail_section": sections_map["anticipatory_bail"],
        "unverified_marker": _reg.marker_for(*_CONSUMED_TABLES),
        "apprehension_basis": apprehension_basis,
        "prosecution_case_slot": prosecution_case if prosecution_case.strip()
                                 else _LLM_SLOT_PLACEHOLDER,
        "is_transit": is_transit,
        "jurisdiction_paragraph": is_transit,
        "no_arrest_so_far": True,
        "place": place,
    }
    return AnticipatoryBailDoc(refused=False, context=context)
