"""Civil revision petition — Section 115 of the Code of Civil Procedure, 1908, or
Article 227 of the Constitution of India (supervisory jurisdiction).

Madras High Court practice: "C.R.P. (PD) / (NPD) No. ___ of 20__" — the
PD / NPD tag is a registry classification the advocate selects; it is an INPUT
(left as "PD/NPD" to strike out when not given) [verify: Madras HC registry
meaning of the PD / NPD case-type tag].

Statute:
  s.115(1) CPC   the High Court may call for the record of a case decided by a
                 subordinate court in which no appeal lies, where the court has
                 exercised a jurisdiction not vested in it, failed to exercise a
                 jurisdiction so vested, or acted illegally / with material
                 irregularity;
  proviso        no order varying or reversing an order made in the course of a
                 suit, except where the order, had it been made in the
                 applicant's favour, would have finally disposed of the suit;
  s.115(2)       no revision against a decree or order against which an appeal
                 lies.
  Article 227    superintendence over all subordinate courts — no statutory
                 period, but delay must be explained.
Limitation (s.115 only): Limitation Act Art. 131 — 90 days from the order sought
to be revised (VERIFY table appeal_revision_periods), s.12(2) copy time excluded.

Hard requirements (each refuses, no partial output):
  - The impugned order must be identified (description, date, court, the
    proceeding it was passed in).
  - s.115: an appeal lies -> refuse (s.115(2)); an interlocutory order that would
    not finally dispose of the suit -> refuse (proviso) with the hint that the
    remedy is Article 227.
  - s.115 out of time without a s.5 condone-delay petition -> refuse.
  - Article 227 not filed within 90 days of the order -> the delay must be
    explained (laches).

LLM slots: facts (para 3) and grounds (para 5).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional, Sequence

from ..rules import limitation as lim
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity
from . import _appeal_window as aw
from .writ_petition import _letter

TEMPLATE = "civil_revision.docx"
SPEC = "cpc-115-art227"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_CONSUMED_TABLES = (aw.PERIODS_TABLE,)


class RevisionBasis(Enum):
    S115 = "s115"
    ART227 = "art227"


_BASIS_LABEL = {
    RevisionBasis.S115: "Section 115 of the Code of Civil Procedure, 1908",
    RevisionBasis.ART227: "Article 227 of the Constitution of India",
}


@dataclass(frozen=True)
class CivilRevisionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> CivilRevisionResult:
    return CivilRevisionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="civil_revision",
                        spec=SPEC, fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    basis: Optional[RevisionBasis],
    petitioner_names: Sequence[str],
    respondent_names: Sequence[str],
    impugned_order_ref: str,
    impugned_order_date: Optional[date],
    lower_court: str,
    proceeding_ref: str,
    filing_date: date,
    place: str,
    appeal_lies: bool = False,
    order_would_finally_dispose: bool = False,
    copy_applied_date: Optional[date] = None,
    copy_ready_date: Optional[date] = None,
    condone_delay_petition_filed: bool = False,
    delay_explanation: Optional[str] = None,
    crp_category: str = "",
    court_name: str = "THE HIGH COURT OF JUDICATURE AT MADRAS",
    facts_narrative: str = "",
    grounds_narrative: str = "",
    grounds_list: Optional[Sequence[str]] = None,
) -> CivilRevisionResult:
    """Assemble the civil revision petition, or refuse."""

    # No basis given: an order that would not finally dispose of the suit (an
    # interlocutory order) is revisable only under Article 227; otherwise s.115.
    if basis is None:
        basis = (RevisionBasis.S115 if order_would_finally_dispose and not appeal_lies
                 else RevisionBasis.ART227)

    missing = [f for f, v in (("impugned_order_ref", impugned_order_ref),
                              ("lower_court", lower_court),
                              ("proceeding_ref", proceeding_ref)) if not v.strip()]
    if impugned_order_date is None:
        missing.append("impugned_order_date")
    if missing:
        return _refuse(
            "a civil revision petition must identify the order sought to be revised "
            "— its description, date, the court that passed it and the proceeding "
            "in which it was passed; missing: " + ", ".join(missing),
            code="civil_revision_order_not_identified", fields=tuple(missing),
        )

    win = None
    if basis is RevisionBasis.S115:
        if appeal_lies:
            return _refuse(
                "no revision lies under Section 115 CPC against a decree or order "
                "against which an appeal lies (Section 115(2) CPC); file an appeal",
                code="civil_revision_appeal_lies", fields=("appeal_lies",),
            )
        if not order_would_finally_dispose:
            return _refuse(
                "under the proviso to Section 115(1) CPC an order made in the course "
                "of a suit can be revised only if, had it been made in the "
                "petitioner's favour, it would have finally disposed of the suit; "
                "for any other interlocutory order the remedy is a petition under "
                "Article 227 of the Constitution",
                code="civil_revision_s115_proviso_bar",
                fields=("order_would_finally_dispose", "basis"),
            )
        try:
            win = aw.window(order_date=impugned_order_date, filing_date=filing_date,
                            period_days=aw.period("art131_revision"),
                            proceeding_class=lim.ProceedingClass.REVISION,
                            copy_applied=copy_applied_date, copy_ready=copy_ready_date)
        except lim.LimitationInputError as exc:
            return _refuse(str(exc), code="civil_revision_copy_dates_invalid",
                           fields=("copy_applied_date", "copy_ready_date"))
        if not win.in_time and not condone_delay_petition_filed:
            return _refuse(
                f"the revision is filed {win.delay_days} day(s) beyond the 90-day "
                f"period (Limitation Act Art. 131; last day {win.expiry}); it must "
                f"be accompanied by a petition under Section 5 of the Limitation Act "
                f"to condone the delay",
                code="civil_revision_time_barred_no_condonation",
                fields=("impugned_order_date", "filing_date",
                        "condone_delay_petition_filed"),
                computation=win.computation,
            )
    else:
        # Article 227 — no statutory period; a stale petition must explain delay.
        elapsed = (filing_date - impugned_order_date).days
        if elapsed > aw.period("art131_revision") and not (
                delay_explanation and delay_explanation.strip()):
            return _refuse(
                f"the petition under Article 227 is filed {elapsed} days after the "
                f"impugned order; though no statutory period applies, the delay "
                f"must be explained (laches)",
                code="civil_revision_art227_delay_unexplained",
                fields=("delay_explanation", "impugned_order_date"),
            )

    # Madras numbering follows the basis: C.R.P.(PD) under Article 227, C.R.P.(NPD)
    # under s.115 CPC (crp_category is kept for the inbound contract).
    cat = "PD" if basis is RevisionBasis.ART227 else "NPD"
    context: Dict[str, Any] = {
        "basis": basis.value,
        "basis_label": _BASIS_LABEL[basis],
        "court_name": court_name,
        "case_label": f"C.R.P.({cat}) No.",
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "petitioners": [p for p in petitioner_names if p.strip()],
        "respondents": [r for r in respondent_names if r.strip()],
        "impugned_order_ref": impugned_order_ref,
        "impugned_order_date": impugned_order_date.isoformat(),
        "lower_court": lower_court,
        "proceeding_ref": proceeding_ref,
        "is_s115": basis is RevisionBasis.S115,
        "limitation_expiry": win.expiry.isoformat() if win else None,
        "delay_days": win.delay_days if win else 0,
        "delay_explanation": delay_explanation,
        "facts_slot": facts_narrative if facts_narrative.strip()
                      else _LLM_SLOT_PLACEHOLDER,
        "lettered_grounds": [{"letter": _letter(i), "text": g} for i, g in
                             enumerate([g for g in (grounds_list or []) if g.strip()])],
        "grounds_slot": grounds_narrative if grounds_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "place": place,
        "unverified_marker": (_reg.marker_for(*_CONSUMED_TABLES)
                              if basis is RevisionBasis.S115 else ""),
        "computation": win.computation if win else "",
    }
    return CivilRevisionResult(refused=False, context=context)
