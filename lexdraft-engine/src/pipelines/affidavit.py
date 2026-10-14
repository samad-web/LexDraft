"""Standalone affidavit doc-type pipeline.

The affidavit *component* (src/components/affidavit.py) already holds the correctness
logic — the competence clause, the corporate/third-party validation rules, and the
computed paragraph numbering. This pipeline REUSES that component wholesale (it does not
re-implement the rules) and wraps it in the pipeline Result shape the adapter expects, so
`affidavit` becomes a routable doc-type whose primary output is the affidavit itself.

Refusals mirror the component's validate():
  - corporate deponent -> authority reference required,
  - third-party deponent -> source-of-knowledge averment required,
  - attestation block -> attestor required.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, Optional, Sequence

from ..components import affidavit as component
from ..rules import s138_windows as windows
from ..verify.refusals import Refusal, Severity

TEMPLATE = "affidavit.docx"
SPEC = "p0#1.3"


@dataclass(frozen=True)
class AffidavitResult:
    refused: bool
    reason: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def ok(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = ()) -> AffidavitResult:
    return AffidavitResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        pipeline="affidavit", spec=SPEC,
                        fields=fields, remedy_hint="none"),
    )


def _refuse_delegated(assessment) -> AffidavitResult:
    """Surface a rule-module refusal (already carrying its own coded Refusal) as an
    AffidavitResult without restating the code — mirrors s138_notice._refuse_delegated."""
    return AffidavitResult(
        refused=True, reason=assessment.reason, context=None,
        refusal=assessment.refusal,
    )


def build(
    *,
    deponent_name: str,
    age: int,
    parentage_type: str,
    parentage_name: str,
    occupation: str,
    address: str,
    role: str,
    proceeding: str,
    place: str,
    attestor: str,
    body_paras: Sequence[str],
    prayer: str,
    affirm_date: Optional[date] = None,
    court_place: Optional[str] = None,
    religion: Optional[str] = None,
    is_corporate: bool = False,
    authority_ref: Optional[str] = None,
    is_third_party: bool = False,
    source_of_knowledge: Optional[str] = None,
    # court cause-title + parties (full court affidavit format)
    court_name: Optional[str] = None,
    court_district: Optional[str] = None,
    suit_no: Optional[str] = None,
    suit_year: Optional[str] = None,
    suit_under: Optional[str] = None,
    plaintiff_name: Optional[str] = None,
    plaintiff_description: Optional[str] = None,
    defendant_name: Optional[str] = None,
    defendant_description: Optional[str] = None,
    deponent_capacity: Optional[str] = None,
    verification_place: Optional[str] = None,
    # Matter dimension + s.138 cheque/dishonour particulars. When matter_type ==
    # "s138" the cheque/presentation/memo/notice fields drive the s.138 window hard
    # stops below (delegated to s138_windows); affidavit_kind is carried for the
    # template. A non-s138 affidavit ignores all of these.
    matter_type: Optional[str] = None,
    affidavit_kind: Optional[str] = None,
    cheques: Sequence[Any] = (),
    presentation_date: Optional[date] = None,
    presentation_bank: Optional[str] = None,
    memo_date: Optional[date] = None,
    memo_received_date: Optional[date] = None,
    dishonour_reason: Optional[str] = None,
    notice_date: Optional[date] = None,
    # OPTIONAL counsel backing-sheet block, carried over from a derived s.138
    # proof affidavit so it names the same advocates as the complaint (doc-5:
    # rendered on the backing sheet of BOTH documents). Additive; empty by
    # default, so every other affidavit type is unaffected.
    advocate_lines: Optional[Sequence[str]] = None,
    advocate_contact: Optional[str] = None,
) -> AffidavitResult:
    """Assemble the affidavit via the shared component, or refuse.

    The component's validate() is the single source of the correctness rules; we surface
    its refusal reasons as the pipeline's HARD refusals (mapping each to the implicated
    field so the form can highlight it)."""
    # The body must carry at least one averment beyond the structural competence clause.
    if not any(str(p).strip() for p in body_paras):
        return _refuse(
            "an affidavit must state at least one averment of fact; the body is empty",
            code="affidavit_body_empty", fields=("body_paras",),
        )

    # --- s.138 matter: the SAME notice-time window hard stops the notice runs ---
    # (src/pipelines/s138_notice.py:168-195). Presentation validity per cheque against
    # the set-wide presentation_date; then the 30-day notice window + demand==amount.
    # All arithmetic is delegated to s138_windows — no date math here. A non-s138
    # affidavit skips this entirely (matter_type gate), so its behaviour is unchanged.
    #
    # Presentation + the 30-day window are computed HERE because they are facts the
    # affidavit itself avers. Cause-of-action and s.142(b) limitation are deliberately
    # NOT computed here: they are complaint-level findings — limitation attaches to the
    # complaint's FILING, not the affidavit's swearing (see s138_complaint.py).
    if matter_type == "s138":
        # Presentation validity, PER CHEQUE. First failing cheque refuses the whole
        # affidavit (no partial) and names that cheque — mirrors the notice loop.
        for c in cheques:
            pres = windows.check_presentation(cheque_date=c.date,
                                              presented_date=presentation_date)
            if not pres.valid:
                return _refuse(
                    f"cheque {c.number} presented beyond validity: presented "
                    f"{presentation_date}, cheque dated {c.date}, valid to "
                    f"{pres.last_valid_date}",
                    code="s138_affidavit_cheque_presented_after_validity",
                    # Name the cheque DATE sub-field, as the notice does.
                    fields=("cheque_dates", "presentation_date"),
                )
        # Notice window + demand==amount. Demand is the consolidated cheque total,
        # exactly as the notice computes it. check_notice attaches its own coded
        # Refusal (30-day window OR demand mismatch); surface it verbatim.
        demand_amount = sum(c.amount for c in cheques)
        notice_check = windows.check_notice(
            memo_received=memo_received_date,
            notice_date=notice_date,
            cheque_amount=demand_amount,
            demand_amount=demand_amount,
        )
        if notice_check.refused:
            return _refuse_delegated(notice_check)

    # Reuse the component's validation verbatim (do not re-implement the rules).
    verdict = component.validate(
        is_corporate=is_corporate, authority_ref=authority_ref,
        is_third_party=is_third_party, source_of_knowledge=source_of_knowledge,
        attestor=attestor,
    )
    if verdict.refused:
        # Map the component reason to the implicated field for the form.
        reason = verdict.reason or "affidavit refused"
        if "authority reference" in reason:
            return _refuse(reason, code="affidavit_corporate_authority", fields=("authority_ref",))
        if "source-of-knowledge" in reason:
            return _refuse(reason, code="affidavit_third_party_source", fields=("source_of_knowledge",))
        return _refuse(reason, code="affidavit_attestation_incomplete", fields=("attestor",))

    # Build the docxtpl context via the component (computed numbering, competence clause).
    date_str = affirm_date.isoformat() if affirm_date else "____"
    ctx = component.build_context(
        deponent_name=deponent_name, age=age,
        parentage_type=parentage_type, parentage_name=parentage_name,
        occupation=occupation, address=address, role=role, proceeding=proceeding,
        place=place, date=date_str, attestor=attestor,
        body_paras=[str(p).strip() for p in body_paras if str(p).strip()],
        prayer=prayer,
        is_corporate=is_corporate, authority_ref=authority_ref,
        is_third_party=is_third_party, source_of_knowledge=source_of_knowledge,
    )
    # Extra fields the gold template can use (kept additive; the component context is
    # authoritative for everything it sets).
    ctx.setdefault("court_place", court_place)
    ctx.setdefault("religion", religion)

    # Court cause-title + party block for the full court-affidavit format. The template
    # renders these only when a court is present (has_court); a bare affidavit omits the
    # top block. "AFFIDAVIT OF <name>, S/o <parent>, aged <age>, R/o <address>[, in the
    # capacity of <capacity>]" is assembled here so the template stays declarative.
    ctx["has_court"] = bool(court_name)
    ctx["court_name"] = court_name
    ctx["court_district"] = court_district
    ctx["suit_no"] = suit_no
    ctx["suit_year"] = suit_year
    ctx["suit_under"] = suit_under
    ctx["plaintiff_name"] = plaintiff_name
    ctx["plaintiff_description"] = plaintiff_description
    ctx["defendant_name"] = defendant_name
    ctx["defendant_description"] = defendant_description
    ctx["deponent_capacity"] = deponent_capacity
    # Verification clause place defaults to the swearing place if not given separately.
    ctx["verification_place"] = verification_place or place
    # The template drops the prayer paragraph for a proof affidavit
    # ({%p if affidavit_kind != 's145_proof' %}), so the kind must reach the context.
    ctx["affidavit_kind"] = affidavit_kind
    # Counsel backing-sheet block (empty for a bare affidavit).
    ctx["advocate_lines"] = list(advocate_lines) if advocate_lines else []
    ctx["advocate_contact"] = advocate_contact
    return AffidavitResult(refused=False, context=ctx)
