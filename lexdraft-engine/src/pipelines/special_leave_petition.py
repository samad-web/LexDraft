"""Special Leave Petition (Civil / Criminal) under Art.136 of the Constitution
— document pipeline (DPC book pp.67-70 and pp.71-74).

An SLP seeks leave to appeal to the Supreme Court against a final judgment/order of
a High Court (or tribunal). Civil and criminal SLPs share one structure — impugned
judgment, questions of law (civil) / important question (criminal), the r.3(2)/r.2(2)
declaration of no other SLP, the r.5/r.4 declaration that annexures are true copies,
brief facts, grounds, and interim relief — and differ only in the governing Order of
the Supreme Court Rules 2013 and party nomenclature.

Hard requirements (each refuses, no partial output):
  - The impugned judgment/order (court + date + case) must be identified.
  - LIMITATION: an SLP against a High Court judgment must be filed within 90 days of
    that judgment (Art.136 / Limitation Act Art.133, civil) or within 90 days
    (criminal, SC Rules O.XXII r.2 read with Art.115) — filing beyond 90 days
    without a condonation application is barred. Exceeded -> auto-attach a
    condonation-of-delay application (does NOT refuse; mirrors the s.142(b) pattern).
  - The r.3(2)/r.2(2) declaration (no other SLP filed) is mandatory.
  - At least one ground must be pleaded.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from enum import Enum
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "special_leave_petition.docx"
SPEC = "dpc-67-74"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_SLP_LIMITATION_DAYS = 90


class SLPKind(Enum):
    CIVIL = "civil"
    CRIMINAL = "criminal"


@dataclass(frozen=True)
class SLPResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> SLPResult:
    return SLPResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="special_leave_petition",
                        spec=SPEC, fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    slp_kind: SLPKind,
    petitioner_name: str,
    respondents: Sequence[str],
    impugned_court: str,
    impugned_judgment_date: Optional[date],
    impugned_case_ref: str,
    questions_of_law: Sequence[str],
    grounds: Sequence[str],
    no_other_slp: bool,
    annexures_true_copies: bool,
    filing_date: date,
    brief_facts: str,
    interim_relief_sought: str,
    place: str,
    # cause-title header. Optional.
    petitioner_parentage: Optional[str] = None,
    petitioner_address: Optional[str] = None,
) -> SLPResult:
    """Assemble the Special Leave Petition, or refuse."""

    # 1. the impugned judgment must be identified.
    if impugned_judgment_date is None or not impugned_court.strip() \
            or not impugned_case_ref.strip():
        return _refuse(
            "a Special Leave Petition must identify the impugned judgment/order (the "
            "court, the case reference and the date); it is absent",
            code="slp_impugned_judgment_not_identified",
            fields=("impugned_court", "impugned_judgment_date", "impugned_case_ref"),
        )

    # 2. LIMITATION — 90 days from the impugned judgment. Exceeded -> auto-attach a
    #    condonation application (does NOT refuse); the date is always computed.
    deadline = impugned_judgment_date + timedelta(days=_SLP_LIMITATION_DAYS)
    days_elapsed = (filing_date - impugned_judgment_date).days
    condonation_required = filing_date > deadline

    # 3. no-other-SLP declaration (r.3(2) civil / r.2(2) criminal) is mandatory.
    if not no_other_slp:
        return _refuse(
            "the petition must declare (Order XXI Rule 3(2) / Order XXII Rule 2(2) of "
            "the Supreme Court Rules) that no other petition for special leave has "
            "been filed against the impugned judgment; that declaration is absent",
            code="slp_no_other_slp_declaration_missing",
            fields=("no_other_slp",),
        )

    # 4. at least one ground.
    if not grounds or not any(g.strip() for g in grounds):
        return _refuse(
            "the grounds on which special leave is sought must be pleaded; a bare "
            "leave prayer is refused",
            code="slp_no_grounds", fields=("grounds",),
        )

    is_civil = slp_kind is SLPKind.CIVIL
    context: Dict[str, Any] = {
        "slp_kind": slp_kind.value,
        "is_civil": is_civil,
        "slp_label": "CIVIL" if is_civil else "CRIMINAL",
        "jurisdiction_label": ("CIVIL APPELLATE JURISDICTION" if is_civil
                               else "CRIMINAL APPELLATE JURISDICTION"),
        "order_rule": ("Order XXI, Rule 3(1)(a)" if is_civil
                       else "Order XXII, Rule 2(1)"),
        "declaration_rule": ("Rule 3(2)" if is_civil else "Rule 2(2)"),
        "annexure_rule": ("Rule 5" if is_civil else "Rule 4"),
        "petitioner": {"name": petitioner_name, "parentage": petitioner_parentage,
                       "address": petitioner_address},
        "respondents": list(respondents),
        "slp_year": filing_date.year,
        "slp_date": filing_date.isoformat(),
        "impugned_court": impugned_court,
        "impugned_judgment_date": impugned_judgment_date,
        "impugned_case_ref": impugned_case_ref,
        "questions_of_law": [q for q in questions_of_law if q.strip()],
        "grounds": [g for g in grounds if g.strip()],
        "no_other_slp": no_other_slp,
        "annexures_true_copies": annexures_true_copies,
        "limitation_deadline": deadline,
        "days_elapsed": days_elapsed,
        "condonation_required": condonation_required,
        "brief_facts_slot": brief_facts if brief_facts.strip()
                            else _LLM_SLOT_PLACEHOLDER,
        "interim_relief_sought": interim_relief_sought,
        "place": place,
    }
    return SLPResult(refused=False, context=context)
