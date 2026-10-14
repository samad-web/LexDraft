"""Contempt Petition under ss.11-12 of the Contempt of Courts Act 1971
— document pipeline (DPC book pp.86-87).

Where a party wilfully disobeys a court order (here, a status-quo order in a writ
petition), the aggrieved party petitions the High Court to initiate contempt. The
book (pp.86-87) recites the order disobeyed, the contemnors' knowledge of it, the
acts of disobedience (demolition despite status quo), and prays for contempt
proceedings.

Hard requirements (each refuses, no partial output):
  - The order alleged to be disobeyed (its date) must be identified.
  - The contemnors must be shown to have had knowledge of the order (wilful
    disobedience is the gravamen of civil contempt, s.2(b)).
  - LIMITATION: s.20 of the Contempt of Courts Act bars initiation of contempt
    after ONE YEAR from the date on which the contempt is alleged to have been
    committed. Filing beyond one year is a HARD refusal (unlike condonable
    limitation, s.20 is an absolute bar on the court's jurisdiction).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "contempt_petition.docx"
SPEC = "dpc-86-87"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_CONTEMPT_LIMITATION_DAYS = 365  # s.20 Contempt of Courts Act: one year, absolute


@dataclass(frozen=True)
class ContemptResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> ContemptResult:
    return ContemptResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="contempt_petition",
                        spec=SPEC, fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    petitioner_names: Sequence[str],
    respondents: Sequence[str],
    parent_case_ref: str,
    order_disobeyed_date: Optional[date],
    order_nature: str,
    contemnors_had_knowledge: bool,
    disobedience_narrative: str,
    contempt_committed_date: Optional[date],
    filing_date: date,
    place: str,
    high_court: Optional[str] = None,
    # cause-title header (DPC book pp.86-87). Optional.
    petitioner_addresses: Optional[Sequence[str]] = None,
) -> ContemptResult:
    """Assemble the contempt petition, or refuse."""

    # 1. the order disobeyed must be identified.
    if order_disobeyed_date is None:
        return _refuse(
            "a contempt petition must identify the order alleged to be disobeyed (its "
            "date); it is absent",
            code="contempt_order_not_identified",
            fields=("order_disobeyed_date",),
        )

    # 2. knowledge of the order is the gravamen of civil contempt.
    if not contemnors_had_knowledge:
        return _refuse(
            "civil contempt requires wilful disobedience — the contemnors must be "
            "shown to have had knowledge of the order; that averment is absent",
            code="contempt_knowledge_not_pleaded",
            fields=("contemnors_had_knowledge",),
        )
    if not disobedience_narrative.strip():
        return _refuse(
            "the acts of disobedience constituting the contempt must be pleaded "
            "specifically; a bare allegation is refused",
            code="contempt_disobedience_not_specific",
            fields=("disobedience_narrative",),
        )

    # 3. s.20 LIMITATION — one year, an absolute jurisdictional bar (no condonation).
    if contempt_committed_date is None:
        return _refuse(
            "the date on which the contempt is alleged to have been committed must be "
            "pleaded — it is the anchor for the one-year limitation under s.20 of the "
            "Contempt of Courts Act",
            code="contempt_committed_date_missing",
            fields=("contempt_committed_date",),
        )
    bar_date = contempt_committed_date + timedelta(days=_CONTEMPT_LIMITATION_DAYS)
    if filing_date > bar_date:
        days_late = (filing_date - bar_date).days
        return _refuse(
            "s.20 of the Contempt of Courts Act 1971 bars the initiation of contempt "
            "proceedings after one year from the date on which the contempt was "
            f"allegedly committed ({contempt_committed_date}); the one-year period "
            f"expired on {bar_date} and filing on {filing_date} is {days_late} day(s) "
            "out of time. Unlike ordinary limitation, this bar is absolute and cannot "
            "be condoned",
            code="contempt_barred_by_s20_one_year",
            fields=("contempt_committed_date", "filing_date"),
            computation=f"committed={contempt_committed_date}, "
                        f"bar_date={bar_date}, filed={filing_date}, "
                        f"days_late={days_late}",
        )

    context: Dict[str, Any] = {
        "petitioners": list(petitioner_names),
        "petitioner_addresses": list(petitioner_addresses)
                                if petitioner_addresses else [],
        "respondents": list(respondents),
        "high_court": high_court,
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "parent_case_ref": parent_case_ref,
        "order_disobeyed_date": order_disobeyed_date,
        "order_nature": order_nature,
        "contemnors_had_knowledge": contemnors_had_knowledge,
        "disobedience_slot": disobedience_narrative,
        "contempt_committed_date": contempt_committed_date,
        "limitation_bar_date": bar_date,
        "place": place,
    }
    return ContemptResult(refused=False, context=context)
