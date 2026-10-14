"""Regular bail application — document pipeline (spec 3.2).

Consumes:
  - dual_code_router  : the three inputs (offence_date, proceeding_start_date,
    is_fresh_action) resolve the procedural code_framework. Bail is procedural, so
    the router's procedural axis is what the document cites. A router refusal
    (unknown provenance) refuses the document.
  - bail_bar_detector : a special statute makes the bail-bar paragraph MANDATORY;
    the pipeline blocks if the caller has not addressed it (spec 3.2).

Other spec 3.2 validations:
  - Custody days recomputed from custody_since at generation time (never stale).
  - Successive application -> prior order reference AND change-of-circumstance
    both mandatory.
  - Parity claims require an order reference; unreferenced parity is refused.

The [LLM] prosecution-case and structured-grounds paragraphs are named empty
slots ("[to be drafted]"). This layer calls no LLM.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Mapping, Optional, Sequence

from ..rules import custody_computation as cc
from ..rules import dual_code_router as router
from ..rules import bail_bar_detector as bars
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from . import _code_framework as cf

TEMPLATE = "regular_bail.docx"
SPEC = "3.2"

# VERIFY tables consumed: section-mapping labels + appointed day (via the router)
# and the bail-bar provenance (special-statute bar paragraph).
_CONSUMED_TABLES = ("section_mappings", "code_appointed_day", "bail_bars")

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


@dataclass(frozen=True)
class RegularBailDoc:
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
) -> RegularBailDoc:
    return RegularBailDoc(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            computation=computation, pipeline="regular_bail", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def _refuse_delegated(reason: str, refusal: Optional[Refusal]) -> RegularBailDoc:
    """Surface a rule-module refusal (already carrying its own Refusal) without
    restating the code."""
    return RegularBailDoc(refused=True, reason=reason, context=None, refusal=refusal)


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
    # router inputs
    offence_date: Optional[date],
    proceeding_start_date: Optional[date],
    is_fresh_action: bool,
    # custody
    custody_since: date,
    as_on: date,
    prison: str,
    chargesheet_filed: bool,
    # special statute / bars
    special_statute: Optional[bars.Statute],
    bail_bar_addressed: bool,
    # successive
    is_successive: bool,
    prior_order_ref: Optional[str],
    change_of_circumstance: Optional[str],
    # parity
    parity_claims: Sequence[Mapping[str, Any]],
    # court / narrative
    court_level: str,
    prosecution_case: str,
    grounds: str,
    place: str,
    # cause-title header (DPC book pp.75-76). Optional — the header renders these
    # when present and derives the rest from data already supplied.
    accused_parentage: Optional[str] = None,
    bail_court: Optional[str] = None,
    application_date: Optional[date] = None,
) -> RegularBailDoc:
    """Assemble the regular-bail application, or refuse."""

    # 0. code framework via the dual-code router (no caller-supplied framework).
    routed = router.route(
        offence_date=offence_date,
        proceeding_start_date=proceeding_start_date,
        is_fresh_action=is_fresh_action,
    )
    if routed.refused:
        return _refuse_delegated(routed.reason, routed.refusal)
    code_framework = routed.code_framework
    sections_map = cf.resolve_sections(code_framework)

    # 1. special-statute bail bar -> mandatory paragraph, block if unaddressed.
    bar = bars.detect(statute=special_statute, remedy=bars.Remedy.REGULAR)
    if bar.bar_applies and bar.mandatory_paragraph and not bail_bar_addressed:
        return _refuse(
            f"special statute {bar.section} engages a statutory bail bar that must "
            f"be addressed head-on; the application does not address it",
            code="regular_bail_special_statute_bar_unaddressed",
            fields=("special_statute", "bail_bar_addressed"),
        )

    # 2. successive application -> prior order reference + change of circumstance.
    if is_successive:
        if not prior_order_ref:
            return _refuse(
                "successive bail application requires a reference to the prior "
                "order (disclosure is mandatory)",
                code="regular_bail_successive_without_prior_order",
                fields=("is_successive", "prior_order_ref"),
            )
        if not change_of_circumstance:
            return _refuse(
                "successive bail application requires a change-of-circumstance "
                "averment since the prior refusal",
                code="regular_bail_successive_without_change_of_circumstance",
                fields=("is_successive", "change_of_circumstance"),
            )

    # 3. parity claims require an order reference; unreferenced parity is refused.
    for claim in parity_claims:
        if not claim.get("order_ref"):
            return _refuse(
                f"parity claim for co-accused {claim.get('co_accused', '?')!r} has "
                f"no order reference; unreferenced parity is refused",
                code="regular_bail_parity_without_order_ref",
                fields=("parity_claims",),
            )

    # 4. custody days recomputed now.
    custody_days = cc.days_in_custody(custody_start=custody_since, as_on=as_on)

    _app_date = application_date or as_on
    context: Dict[str, Any] = {
        "accused": {"name": accused_name, "age": age, "occupation": occupation,
                    "address": address, "prison": prison,
                    "parentage": accused_parentage},
        "fir_no": fir_no,
        "police_station": police_station,
        "district": district,
        # cause-title header fields (derived; render only when present).
        "city": district,
        "bail_court": bail_court,
        "bail_year": _app_date.year,
        "bail_date": _app_date.isoformat(),
        "sections": list(sections),
        "code_framework": code_framework,
        "regular_bail_section": sections_map.get("regular_bail",
                                                 sections_map["default_bail"]),
        "unverified_marker": _reg.marker_for(*_CONSUMED_TABLES),
        "custody_since": custody_since,
        "as_on": as_on,
        "custody_days": custody_days,
        "chargesheet_filed": chargesheet_filed,
        "court_level": court_level,
        # bail bar — carry the bar's OWN paragraph text (twin-conditions vs
        # prima-facie-true differ), not a generic one.
        "bail_bar_paragraph": bool(bar.bar_applies and bar.mandatory_paragraph),
        "bail_bar_section": bar.section if bar.bar_applies else None,
        "bail_bar_text": bar.paragraph_text if bar.bar_applies else None,
        # successive
        "is_successive": is_successive,
        "prior_order_ref": prior_order_ref,
        "change_of_circumstance": change_of_circumstance,
        # parity
        "parity_claims": [dict(c) for c in parity_claims],
        # narrative slots
        "prosecution_case_slot": prosecution_case if prosecution_case.strip()
                                 else _LLM_SLOT_PLACEHOLDER,
        "grounds_slot": grounds if grounds.strip() else _LLM_SLOT_PLACEHOLDER,
        "undertaking": True,
        "place": place,
    }
    return RegularBailDoc(refused=False, context=context)
