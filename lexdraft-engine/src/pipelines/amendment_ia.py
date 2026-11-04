"""Interlocutory application to amend a pleading — Order VI Rule 17 read with
Section 151 of the Code of Civil Procedure, 1908.

Tamil Nadu practice: "I.A. No. ___ of 20__ in O.S. No. ___ of 20__", supported by
the applicant's affidavit, with the proposed amendments set out precisely (what
is inserted / substituted / deleted, and where) so the court can allow them
verbatim.

Statute: O.VI R.17 — the court may at any stage allow either party to alter or
amend his pleadings as may be necessary for determining the real questions in
controversy; PROVISO: no application for amendment shall be allowed after the
trial has commenced, unless the court comes to the conclusion that in spite of
due diligence the party could not have raised the matter before the commencement
of trial.

Hard requirements (each refuses, no partial output):
  - The suit and the pleading to be amended must be identified.
  - The proposed amendments must be set out (a bare prayer to "amend the plaint"
    is refused — the court allows a specific text).
  - Trial commenced -> the due-diligence averment (why the matter could not be
    raised earlier) is mandatory (proviso).

LLM slot: the reasons for the amendment / necessity narrative (para 3).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from typing import Any, Dict, Optional, Sequence

from ..verify.refusals import Refusal, Severity

TEMPLATE = "amendment_ia.docx"
SPEC = "cpc-o6r17"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


class Pleading(Enum):
    PLAINT = "plaint"
    WRITTEN_STATEMENT = "written_statement"


_PLEADING_LABEL = {Pleading.PLAINT: "plaint",
                   Pleading.WRITTEN_STATEMENT: "written statement"}


@dataclass(frozen=True)
class AmendmentIAResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            remedy_hint: str = "none") -> AmendmentIAResult:
    return AmendmentIAResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="amendment_ia", spec=SPEC,
                        fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    applicant_name: str,
    applicant_role: str,
    respondent_name: str,
    suit_ref: str,
    pleading: Pleading,
    proposed_amendments: Sequence[str],
    trial_commenced: bool,
    filing_date: date,
    place: str,
    pleading_date: Optional[date] = None,
    due_diligence_explanation: Optional[str] = None,
    civil_court: Optional[str] = None,
    city: Optional[str] = None,
    reasons_narrative: str = "",
    # every respondent, when there is more than one (e.g. two brother-defendants).
    respondent_names: Optional[Sequence[str]] = None,
) -> AmendmentIAResult:
    """Assemble the O.VI R.17 amendment application, or refuse."""

    if not suit_ref.strip():
        return _refuse(
            "the suit in which the pleading is to be amended must be identified",
            code="amendment_ia_suit_not_identified", fields=("suit_ref",),
        )
    amendments = [a for a in proposed_amendments if a.strip()]
    if not amendments:
        return _refuse(
            "the proposed amendments must be set out precisely (what is to be "
            "inserted, substituted or deleted, and where); a bare prayer to amend "
            "the pleading is refused",
            code="amendment_ia_no_proposed_amendment",
            fields=("proposed_amendments",),
        )
    if trial_commenced and not (due_diligence_explanation
                                and due_diligence_explanation.strip()):
        return _refuse(
            "the trial has commenced; under the proviso to Order VI Rule 17 CPC the "
            "amendment cannot be allowed unless the applicant shows that in spite of "
            "due diligence the matter could not have been raised before the "
            "commencement of trial — that averment is absent",
            code="amendment_ia_due_diligence_not_pleaded",
            fields=("trial_commenced", "due_diligence_explanation"),
        )

    role = applicant_role.strip().lower() or "plaintiff"
    opp_role = {"plaintiff": "defendant", "defendant": "plaintiff"}.get(role, "respondent")

    context: Dict[str, Any] = {
        "applicant": {"name": applicant_name, "role": role},
        "respondent": {"name": respondent_name, "role": opp_role},
        "respondents": [n for n in (respondent_names or []) if n.strip()]
                       or [respondent_name],
        "civil_court": civil_court,
        "city": city,
        "suit_ref": suit_ref,
        "application_year": filing_date.year,
        "application_date": filing_date.isoformat(),
        "pleading": pleading.value,
        "pleading_label": _PLEADING_LABEL[pleading],
        "pleading_date": pleading_date.isoformat() if pleading_date else None,
        "proposed_amendments": amendments,
        "trial_commenced": trial_commenced,
        "due_diligence_explanation": due_diligence_explanation,
        "reasons_slot": reasons_narrative if reasons_narrative.strip()
                        else _LLM_SLOT_PLACEHOLDER,
        "place": place,
    }
    return AmendmentIAResult(refused=False, context=context)
