"""Default bail application — document pipeline (spec 3.4).

Purely computational; least LLM involvement. The pipeline delegates:
  - the statutory period + accrual date to custody_computation.default_bail_period
    (from FIRST REMAND; NDPS/UAPA/PMLA overrides),
  - custody days to custody_computation.days_in_custody (recomputed at generation
    time via `as_on`),
  - the sequence/readiness verdict to custody_computation.assess_default_bail
    (SURVIVES / EXTINGUISHED / INDETERMINATE / NO_READINESS).

Any refusal carries the distinct reason_code and the computation; no partial
output is produced.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Sequence

from ..rules import custody_computation as cc
from ..rules import dual_code_router as router
from ..verify import tables as _reg
from ..verify.refusals import Refusal
from . import _code_framework as cf

TEMPLATE = "default_bail.docx"
SPEC = "3.4"

# VERIFY tables this document consumes: the section-mapping labels, the appointed
# day (both via the router), and the default-bail period table.
_CONSUMED_TABLES = (
    "section_mappings", "code_appointed_day", "custody_default_bail_periods",
)


@dataclass(frozen=True)
class DefaultBailDoc:
    refused: bool
    reason: str = ""
    reason_code: Optional[cc.DefaultBailCode] = None
    computation: Optional[str] = None
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
    first_remand_date: date,
    offence: cc.Offence,
    special_statute: Optional[cc.SpecialStatute],
    as_on: date,
    application_ts: Optional[datetime],
    chargesheet_filed_ts: Optional[datetime],
    readiness_to_furnish_bail: bool,
    place: str,
    # cause-title header (DPC book pp.75-78). Optional.
    accused_parentage: Optional[str] = None,
    bail_court: Optional[str] = None,
    city: Optional[str] = None,
    application_date: Optional[date] = None,
) -> DefaultBailDoc:
    """Assemble the default-bail application, or refuse with the distinct code."""

    # 0. code framework via the dual-code router (no caller-supplied framework;
    #    the router refuses on unknown provenance). This gate precedes all others.
    routed = router.route(
        offence_date=offence_date,
        proceeding_start_date=proceeding_start_date,
        is_fresh_action=is_fresh_action,
    )
    if routed.refused:
        return DefaultBailDoc(refused=True, reason=routed.reason, context=None,
                              refusal=routed.refusal)
    code_framework = routed.code_framework
    sections_map = cf.resolve_sections(code_framework)

    # 1. sequence / readiness verdict — the gating hard stop.
    verdict = cc.assess_default_bail(
        application_ts=application_ts,
        chargesheet_filed_ts=chargesheet_filed_ts,
        readiness_to_furnish_bail=readiness_to_furnish_bail,
    )
    if verdict.refused:
        return DefaultBailDoc(
            refused=True,
            reason=verdict.reason,
            reason_code=verdict.reason_code,
            computation=verdict.computation,
            context=None,
            refusal=verdict.refusal,
        )

    # 2. statutory period + accrual (from first remand).
    period = cc.default_bail_period(
        first_remand_date=first_remand_date,
        offence=offence,
        special_statute=special_statute,
    )

    # 3. custody days — recomputed now, never stale.
    custody_days = cc.days_in_custody(custody_start=first_remand_date, as_on=as_on)

    context: Dict[str, Any] = {
        "accused": {"name": accused_name, "age": age, "occupation": occupation,
                    "address": address, "parentage": accused_parentage},
        # cause-title header fields (render only when present).
        "bail_court": bail_court,
        "city": city,
        "bail_year": (application_date.year if application_date
                      else first_remand_date.year),
        "bail_date": application_date.isoformat() if application_date else None,
        "fir_no": fir_no,
        "police_station": police_station,
        "district": district,
        "sections": list(sections),
        "code_framework": code_framework,
        "default_bail_section": sections_map["default_bail"],
        "unverified_marker": _reg.marker_for(*_CONSUMED_TABLES),
        "first_remand_date": first_remand_date,
        "as_on": as_on,
        "custody_days": custody_days,
        "period_days": period.period_days,
        "period_statute": period.statute,
        "accrual_date": period.accrual_date,
        "extension_procedure": period.extension_procedure,
        "extendable_to": period.extendable_to,
        "chargesheet_not_filed_in_period": chargesheet_filed_ts is None,
        "readiness_averred": True,               # gated above
        "application_preceded_chargesheet": verdict.application_preceded_chargesheet,
        "place": place,
    }
    return DefaultBailDoc(refused=False, reason_code=verdict.reason_code,
                          computation=verdict.computation, context=context)
