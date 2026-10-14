"""Maintenance under BNSS 144 / CrPC 125 — document pipeline (spec 6.3).

The framework is resolved by the dual_code_router (three inputs), NOT a
caller-supplied string — same pattern as the bail pipelines.

Hard checks (each refuses, no partial output):
  - Neglect or refusal to maintain — the statutory trigger, pleaded expressly.
  - Rajnesh affidavit of assets and liabilities — mandatory. Both parties file
    one; the PETITIONER's is the one we control, so that is what we check.
  - Divorced wife -> not-remarried averment required.
  - Child claimant >= 18 -> maintainable only if unable to maintain themselves due
    to a physical or mental abnormality.
  - Quantum needs a stated computation basis, not a bare figure.

LLM slots are paragraphs 3 (neglect narrative) and 6 (quantum basis narrative).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional

from ..rules import dual_code_router as router
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from . import _code_framework as cf

TEMPLATE = "maintenance.docx"
SPEC = "6.3"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_ADULT_AGE = 18

# VERIFY tables consumed: the section-mapping labels and the appointed day (router).
_CONSUMED_TABLES = ("section_mappings", "code_appointed_day")


class Relationship(Enum):
    WIFE = "wife"
    DIVORCED_WIFE = "divorced_wife"
    CHILD = "child"
    PARENT = "parent"


@dataclass(frozen=True)
class MaintenanceResult:
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
) -> MaintenanceResult:
    return MaintenanceResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            computation=computation, pipeline="maintenance", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def _refuse_delegated(routed) -> MaintenanceResult:
    """Surface a rule-module refusal (already carrying its own Refusal) without
    restating the code."""
    return MaintenanceResult(
        refused=True, reason=routed.reason, context=None,
        refusal=routed.refusal,
    )


def build(
    *,
    petitioner_name: str,
    relationship: Relationship,
    respondent_name: str,
    offence_date: Optional[date],
    proceeding_start_date: Optional[date],
    is_fresh_action: bool,
    neglect_or_refusal_pleaded: bool,
    petitioner_rajnesh_affidavit: bool,
    respondent_means: str,
    petitioner_inability: str,
    quantum: int,
    quantum_basis: str,
    divorced_not_remarried: Optional[bool],
    child_age: Optional[int],
    child_unable_due_to_abnormality: Optional[bool],
    jurisdiction_basis: str,
    place: str,
    neglect_narrative: str,
    quantum_narrative: str,
    # cause-title header (DPC book). Optional.
    magistrate_court: Optional[str] = None,
    city: Optional[str] = None,
    filing_date: Optional[date] = None,
) -> MaintenanceResult:
    """Assemble the maintenance petition, or refuse."""

    # 0. code framework via the router.
    routed = router.route(
        offence_date=offence_date,
        proceeding_start_date=proceeding_start_date,
        is_fresh_action=is_fresh_action,
    )
    if routed.refused:
        return _refuse_delegated(routed)
    sections = cf.resolve_sections(routed.code_framework)

    # 1. neglect or refusal — statutory trigger.
    if not neglect_or_refusal_pleaded:
        return _refuse(
            "neglect or refusal to maintain is the statutory trigger under "
            "s.144 BNSS / s.125 CrPC and must be pleaded expressly; it is absent",
            code="maintenance_neglect_not_pleaded",
            fields=("neglect_or_refusal_pleaded",),
        )

    # 2. Rajnesh affidavit (petitioner's — the one we control).
    if not petitioner_rajnesh_affidavit:
        return _refuse(
            "the petitioner's affidavit of assets and liabilities (Rajnesh v. Neha) "
            "is mandatory and is absent",
            code="maintenance_rajnesh_affidavit_absent",
            fields=("petitioner_rajnesh_affidavit",),
        )

    # 3. divorced wife -> not-remarried averment.
    if relationship is Relationship.DIVORCED_WIFE:
        if divorced_not_remarried is None:
            return _refuse(
                "a divorced wife must aver that she has not remarried; the averment "
                "is missing",
                code="maintenance_divorced_wife_not_remarried_missing",
                fields=("divorced_not_remarried",),
            )
        if divorced_not_remarried is False:
            return _refuse(
                "a divorced wife who has remarried is not entitled to maintenance "
                "under this provision",
                code="maintenance_divorced_wife_remarried",
                fields=("divorced_not_remarried",),
            )

    # 4. adult child -> only if unable due to abnormality.
    if relationship is Relationship.CHILD and child_age is not None:
        if child_age >= _ADULT_AGE and not child_unable_due_to_abnormality:
            return _refuse(
                f"a child aged {child_age} (>= {_ADULT_AGE}) is maintainable only if "
                f"unable to maintain themselves due to a physical or mental "
                f"abnormality; that is not pleaded",
                code="maintenance_adult_child_no_abnormality",
                fields=("child_age", "child_unable_due_to_abnormality"),
            )

    # 5. quantum -> stated computation basis.
    if quantum <= 0:
        return _refuse(
            "a positive quantum of maintenance must be sought",
            code="maintenance_quantum_non_positive",
            fields=("quantum",),
        )
    if not quantum_basis.strip():
        return _refuse(
            "the quantum of maintenance requires a stated computation basis, not a "
            "bare figure",
            code="maintenance_quantum_no_basis",
            fields=("quantum_basis",),
        )

    context: Dict[str, Any] = {
        "petitioner": {"name": petitioner_name},
        "respondent": {"name": respondent_name},
        # cause-title header fields (render only when present).
        "magistrate_court": magistrate_court,
        "city": city,
        "petition_year": filing_date.year if filing_date else None,
        "petition_date": filing_date.isoformat() if filing_date else None,
        "relationship": relationship.value,
        "code_framework": routed.code_framework,
        "maintenance_section": sections["maintenance"],
        "unverified_marker": _reg.marker_for(*_CONSUMED_TABLES),
        "respondent_means": respondent_means,
        "petitioner_inability": petitioner_inability,
        "quantum": quantum,
        "quantum_basis": quantum_basis,
        "petitioner_rajnesh_affidavit": petitioner_rajnesh_affidavit,
        "divorced_not_remarried": divorced_not_remarried,
        "child_age": child_age,
        "jurisdiction_basis": jurisdiction_basis,
        # LLM slots (paras 3, 6)
        "neglect_slot": neglect_narrative if neglect_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "quantum_slot": quantum_narrative if quantum_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "place": place,
    }
    return MaintenanceResult(refused=False, context=context)
