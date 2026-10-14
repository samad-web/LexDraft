"""Writ petition under Article 226 — document pipeline (spec 5.1).

Hard checks (each refuses, no partial output):
  - Writ-type <-> relief matching (mandamus: legal right + public duty + prior
    demand and refusal; certiorari: quasi-judicial order; quo warranto: public
    office).
  - Alternative remedy addressed (refuse, not warn).
  - At least one State / public-function respondent (maintainability).
  - Impugned order identified by number AND date, and annexed.
  - Delay explained where the impugned action is not recent (laches threshold
    CONFIGURABLE — laches has no fixed period).

Reused components (not reimplemented):
  - cause_title.validate(variant=WRIT): respondent ordering (authority first).
  - verification.render_context(variant=WRIT): the no-similar-petition declaration.

LLM slots are paragraphs 3 (facts) and 6 (grounds) only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..factsheet import Party
from ..components import cause_title as ct
from ..components import verification as ver
from ..verify.refusals import Refusal, Severity

TEMPLATE = "writ_petition.docx"
SPEC = "5.1"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


def _letter(index: int) -> str:
    """0 -> 'A', 1 -> 'B', ... 26 -> 'AA'. Code-generated ground lettering."""
    label = ""
    n = index
    while True:
        label = chr(ord("A") + n % 26) + label
        n = n // 26 - 1
        if n < 0:
            break
    return label


class WritType(Enum):
    MANDAMUS = "mandamus"
    CERTIORARI = "certiorari"
    QUO_WARRANTO = "quo_warranto"
    PROHIBITION = "prohibition"
    HABEAS_CORPUS = "habeas_corpus"


@dataclass(frozen=True)
class WritResult:
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
    remedy_hint: str = "none",
) -> WritResult:
    return WritResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            pipeline="writ_petition", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def _check_writ_type(
    writ_type: WritType,
    legal_right: str,
    public_duty: str,
    prior_demand_and_refusal: str,
    quasi_judicial_order: Optional[str],
    public_office: Optional[str],
) -> Optional[Tuple[str, str, Tuple[str, ...]]]:
    """Return (reason, code, fields) if the writ type's requisites are unmet, else
    None. The caller turns the tuple into a coded refusal."""
    if writ_type is WritType.MANDAMUS:
        if not legal_right.strip():
            return ("mandamus requires a legal right in the petitioner; none pleaded",
                    "writ_mandamus_no_legal_right", ("legal_right",))
        if not public_duty.strip():
            return (("mandamus requires a corresponding public duty on the "
                     "respondent; none pleaded"),
                    "writ_mandamus_no_public_duty", ("public_duty",))
        if not prior_demand_and_refusal.strip():
            return (("mandamus requires a prior demand for performance and its "
                     "refusal; none pleaded"),
                    "writ_mandamus_no_prior_demand", ("prior_demand_and_refusal",))
    elif writ_type is WritType.CERTIORARI:
        if not (quasi_judicial_order and quasi_judicial_order.strip()):
            return (("certiorari requires a quasi-judicial order to be quashed; "
                     "none identified"),
                    "writ_certiorari_no_quasi_judicial_order", ("quasi_judicial_order",))
    elif writ_type is WritType.QUO_WARRANTO:
        if not (public_office and public_office.strip()):
            return ("quo warranto requires a public office to be in question; none pleaded",
                    "writ_quo_warranto_no_public_office", ("public_office",))
    return None


def build(
    *,
    petitioner: Party,
    respondents: Sequence[Party],
    court_place: str,
    court_side: str,
    writ_type: WritType,
    legal_right: str,
    public_duty: str,
    prior_demand_and_refusal: str,
    quasi_judicial_order: Optional[str],
    public_office: Optional[str],
    impugned_order_number: str,
    impugned_order_date: Optional[date],
    impugned_order_annexed: bool,
    alternative_remedy_addressed: bool,
    alternative_remedy_basis: str,
    impugned_action_recent: bool,
    delay_explanation: Optional[str],
    laches_threshold_days: int,
    impugned_action_date: Optional[date],
    filing_date: date,
    petitioner_name: str,
    no_similar_petition: bool,
    place: str,
    day: str,
    month: str,
    year: str,
    facts_narrative: str,
    grounds_narrative: str,
    grounds_list: Optional[Sequence[str]] = None,
) -> WritResult:
    """Assemble the Article 226 writ petition, or refuse.

    Writ grounds are LETTERED (A, B, C...) in practice. If `grounds_list` is
    supplied, the lettering is generated BY CODE (never by the model — a CLAUDE.md
    non-negotiable). Otherwise the free-text `grounds_narrative` slot is used, into
    which the model writes its own already-lettered grounds.
    """

    # 1. writ-type <-> relief matching.
    wt_error = _check_writ_type(writ_type, legal_right, public_duty,
                                prior_demand_and_refusal, quasi_judicial_order,
                                public_office)
    if wt_error:
        wt_reason, wt_code, wt_fields = wt_error
        return _refuse(wt_reason, code=wt_code, fields=wt_fields)

    # 2. maintainability: at least one State / public-function respondent.
    if not any(r.is_authority for r in respondents):
        return _refuse(
            "writ petition not maintainable: the respondent(s) are private parties "
            "with no State / instrumentality (Art. 12) or public-function "
            "respondent",
            code="writ_no_state_respondent", fields=("respondents",),
        )

    # 3. respondent ordering (authority first) — reuse cause_title. cause_title
    #    is not itself coded, so mint a writ-layer code for its verdict.
    ct_verdict = ct.validate(variant=ct.Variant.WRIT, parties=[petitioner, *respondents])
    if ct_verdict.refused:
        return _refuse(ct_verdict.reason, code="writ_cause_title_invalid",
                       fields=("respondents",))

    # 4. impugned order: number AND date, annexed. (quo warranto is office-based,
    #    but where an order is impugned it must be fully identified.)
    if writ_type is not WritType.QUO_WARRANTO:
        if not impugned_order_number.strip():
            return _refuse("the impugned order must be identified by its number",
                           code="writ_impugned_order_no_number",
                           fields=("impugned_order_number",))
        if impugned_order_date is None:
            return _refuse("the impugned order must be identified by its date",
                           code="writ_impugned_order_no_date",
                           fields=("impugned_order_date",))
        if not impugned_order_annexed:
            return _refuse("the impugned order must be annexed to the petition",
                           code="writ_impugned_order_not_annexed",
                           fields=("impugned_order_annexed",))

    # 5. alternative remedy addressed — refuse, not warn.
    if not alternative_remedy_addressed:
        return _refuse(
            "the availability of an alternative remedy is not addressed; an "
            "unaddressed alternative remedy is a maintainability failure, not a "
            "stylistic gap",
            code="writ_alternative_remedy_not_addressed",
            fields=("alternative_remedy_addressed",),
        )

    # 6. delay / laches — explained where the action is not recent. Threshold is
    #    configurable (laches has no fixed period).
    stale = False
    if not impugned_action_recent:
        if impugned_action_date is not None:
            elapsed = (filing_date - impugned_action_date).days
            stale = elapsed > laches_threshold_days
        else:
            stale = True
    if stale and not (delay_explanation and delay_explanation.strip()):
        return _refuse(
            "the impugned action is not recent (beyond the configured laches "
            "threshold) and the delay is not explained; laches must be accounted "
            "for",
            code="writ_laches_delay_unexplained",
            fields=("delay_explanation", "impugned_action_date",
                    "laches_threshold_days"),
        )

    # 7. verification — reuse the writ variant (carries the no-similar-petition
    #    declaration; raises if absent).
    try:
        verification_ctx = ver.render_context(
            variant=ver.Variant.WRIT,
            name=petitioner_name, role="Petitioner",
            place=place, day=day, month=month, year=year,
            total_paras=12, knowledge_paras=[(1, 12)], belief_paras=[],
            no_similar_petition=no_similar_petition,
        )
    except ver.VerificationInputError as exc:
        return _refuse(str(exc), code="writ_verification_invalid",
                       fields=("no_similar_petition",))

    context: Dict[str, Any] = {
        "petitioner": {"name": petitioner.name},
        "respondents": [{"serial": r.serial, "name": r.name,
                         "is_authority": r.is_authority} for r in respondents],
        "court_place": court_place,
        "court_side": court_side,
        "writ_type": writ_type.value,
        "legal_right": legal_right,
        "public_duty": public_duty,
        "prior_demand_and_refusal": prior_demand_and_refusal,
        "quasi_judicial_order": quasi_judicial_order,
        "public_office": public_office,
        "impugned_order_number": impugned_order_number,
        "impugned_order_date": impugned_order_date,
        "alternative_remedy_basis": alternative_remedy_basis,
        "delay_explanation": delay_explanation,
        "no_similar_petition": no_similar_petition,
        "verification": verification_ctx,
        # LLM slots (paras 3, 6)
        "facts_slot": facts_narrative if facts_narrative.strip()
                      else _LLM_SLOT_PLACEHOLDER,
        # grounds: lettered A/B/C BY CODE when supplied as a list, else the slot.
        "lettered_grounds": [
            {"letter": _letter(i), "text": g}
            for i, g in enumerate(grounds_list)
        ] if grounds_list else [],
        "grounds_slot": grounds_narrative if grounds_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "place": place,
    }
    return WritResult(refused=False, context=context)
