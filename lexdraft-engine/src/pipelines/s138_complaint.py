"""s.138 NI Act complaint — document pipeline (spec 3.1).

Inherits 2.2's cheque/debt facts. Adds:
  - s.141 HARD REFUSAL: a company accused without the "in charge of and
    responsible for the conduct of the business at the relevant time" averment
    gets no document (directors are routinely discharged on this defect).
  - Deemed service: a refused/unclaimed notice needs an explicit deemed-service
    averment, and the cause of action STILL runs from the deemed delivery date —
    the refused/unclaimed flag must not skip the date computation.
  - Filing window = one calendar month from the cause of action, computed via
    src.rules.s138_windows (reuses its relativedelta month path). Exceeded ->
    auto-attach the s.142(b)-proviso condonation application (does NOT refuse).

Paragraph 3's legally-enforceable-debt slot is the SAME named slot as 2.2
paragraph 2, expanded. This layer calls no LLM.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Dict, List, Optional, Sequence

from ..rules import s138_windows as windows
from ..components.amount_words import rupees_in_words
from ..components.date_format import body_date, table_date
from ..verify.refusals import Refusal, Severity
from .s138_notice import Cheque

TEMPLATE = "s138_complaint.docx"
SPEC = "3.1"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
_CONDONATION_SECTION = "proviso to s.142(b) NI Act"


@dataclass(frozen=True)
class PresentationRound:
    """One presentation of the cheque(s) in a multi-round history.

    A real s.138 filing may present the cheque(s), have them dishonoured, hold
    them at the drawer's request (deferment), and re-present them. Each round has
    a presentation date, the date its dishonour memo was received, and the
    dishonour reason. The LAST round is the operative one — its memo receipt
    starts the notice clock and drives the s.138 cause-of-action window. Earlier
    rounds are pleaded as narrative history only.
    """
    presented_on: date
    memo_received: date
    reason: str = "Funds Insufficient"


@dataclass(frozen=True)
class ComplaintResult:
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
) -> ComplaintResult:
    return ComplaintResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(
            code=code, severity=Severity.HARD, reason=reason,
            computation=computation, pipeline="s138_complaint", spec=SPEC,
            fields=fields, remedy_hint=remedy_hint,
        ),
    )


def build(
    *,
    complainant_name: str,
    complainant_is_company: bool,
    complainant_authorised_rep: Optional[str],
    complainant_resolution_ref: Optional[str],
    is_payee: bool,
    accused_name: str,
    accused_is_company: bool,
    s141_averment: Optional[str],
    cheques: Sequence[Cheque],
    debt_slot: str,
    presentation_date: date,
    memo_date: date,
    memo_received_date: date,
    dishonour_reason: str,
    notice_date: date,
    notice_dispatch_date: date,
    notice_delivery_date: Optional[date],
    notice_refused: bool,
    notice_unclaimed: bool,
    filing_date: date,
    payee_bank_branch_in_jurisdiction: bool,
    jurisdiction_basis: str,
    place: str,
    deemed_delivery_date: Optional[date] = None,
    deemed_service_averment: Optional[str] = None,
    # cause-title header (DPC book pp.79-80). Optional.
    court_location: Optional[str] = None,
    # The court's designation, e.g. "Metropolitan Magistrate, Fast Track
    # Court-III" (TN) or "Judicial Magistrate No. II". Defaults to
    # "Chief Metropolitan Magistrate" so existing callers are unaffected. The
    # template renders "IN THE COURT OF THE {court_designation}", so this must
    # NOT be pre-fixed with "the Court of".
    court_designation: Optional[str] = None,
    city: Optional[str] = None,
    police_station: Optional[str] = None,
    complainant_parentage: Optional[str] = None,
    complainant_address: Optional[str] = None,
    accused_parentage: Optional[str] = None,
    accused_address: Optional[str] = None,
    extra_witnesses: Optional[Sequence[str]] = None,
    extra_documents: Optional[Sequence[str]] = None,
    # --- optional real-filing refinements (all default to prior behaviour) ---
    # A written deferment/holding agreement date, where the cheques were held on
    # the accused's request and re-presented. Pleaded in the narrative and added
    # to the document list when present.
    deferment_agreement_date: Optional[date] = None,
    # OPTIONAL ordered multi-round presentation history (doc-5 gap E1). When given,
    # the cheque(s) were presented, dishonoured, (optionally) held under the
    # deferment agreement, and re-presented; the LAST round is the operative
    # presentation whose memo receipt drives the s.138 window. When absent, the
    # single presentation_date / memo_received_date path is used unchanged, so
    # every existing caller is unaffected.
    presentation_rounds: Optional[Sequence[PresentationRound]] = None,
    # Postal acknowledgement / service-proof dates (official + residence). Added
    # to the document list when present.
    notice_ack_official_date: Optional[date] = None,
    notice_ack_residence_date: Optional[date] = None,
    # Whether to itemise the List of Documents per-cheque + per-return-memo
    # (Tamil Nadu practice) instead of the terse grouped set. Default False keeps
    # the existing 4-item behaviour for every current caller/test.
    itemise_documents: bool = False,
    # The prayer's compensation relief. The conventional s.138 prayer directs the
    # accused to pay "twice the amount" of the dishonoured cheque(s) (the s.138
    # fine ceiling). Default False keeps the prior generic-compensation prayer.
    prayer_twice_amount: bool = False,
    # Whether the complainant sues as a "holder in due course" (s.9 NI Act)
    # rather than the payee. Most s.138 complainants are the payee; this flag is
    # for the narrower case where the cheque was negotiated to the complainant.
    # Para 1 pleads whichever is set; it does NOT plead "payee / holder in due
    # course" indiscriminately. Default False keeps the payee wording.
    is_holder_in_due_course: bool = False,
    # --- advocate / counsel block (format-layer, per-matter) -------------------
    # The advocate(s) on record for the complainant. `advocates` is a list so a
    # firm can name a team (as in TN practice: "M/s. A, B and C"); each entry is
    # the display name. `advocate_enrolments` (parallel list, optional) carries
    # the Bar enrolment number for each, rendered as "(Enrl. ####/YYYY)". The
    # contact line (mobile/email) is a single optional string. When no advocate
    # is supplied the template falls back to the generic "Through / Advocate"
    # line, so every existing caller is unaffected.
    advocates: Optional[Sequence[str]] = None,
    advocate_enrolments: Optional[Sequence[str]] = None,
    advocate_contact: Optional[str] = None,
    # The advocates' office address, pleaded in para 1 as the complainant's
    # address for service of notices/process (TN practice). Optional.
    advocate_office_address: Optional[str] = None,
    # Case-number label for the cause-title. TN cheque cases are numbered
    # "S.T.C. No. ___ of <year>"; other forums differ. Defaults to the generic
    # "CRIMINAL COMPLAINT NO." so existing callers are unaffected.
    case_number_label: Optional[str] = None,
) -> ComplaintResult:
    """Assemble the s.138 complaint, or refuse."""

    # --- mandatory averments: complainant standing ---
    if not is_payee:
        return _refuse(
            "the complainant must be the payee or holder in due course of the "
            "cheque(s); this is a mandatory averment",
            code="s138_complaint_complainant_not_payee_or_holder",
            fields=("is_payee",),
        )
    if complainant_is_company and not complainant_authorised_rep:
        return _refuse(
            "a company complainant must plead the authorisation of the person "
            "representing it (authorised representative / resolution)",
            code="s138_complaint_company_complainant_no_authorisation",
            fields=("complainant_is_company", "complainant_authorised_rep"),
        )

    # --- s.141 HARD REFUSAL for company accused ---
    if accused_is_company and not (s141_averment and s141_averment.strip()):
        return _refuse(
            "company accused without the s.141 averment that the person(s) sought "
            "to be made vicariously liable were in charge of and responsible for "
            "the conduct of the business at the relevant time; the complaint is "
            "defective and will not be generated",
            code="s138_complaint_company_accused_no_s141_averment",
            fields=("accused_is_company", "s141_averment"),
        )

    # --- jurisdiction (s.142(2)): payee bank branch within territory ---
    if not payee_bank_branch_in_jurisdiction:
        return _refuse(
            "the payee's bank branch does not fall within this court's territorial "
            "jurisdiction (s.142(2) NI Act); the complaint cannot be filed here",
            code="s138_complaint_payee_bank_branch_outside_jurisdiction",
            fields=("payee_bank_branch_in_jurisdiction",),
        )

    # --- multi-round presentation: the LAST round is operative (doc-5 E1) -------
    # When an ordered presentation history is supplied, the final round's
    # presentation date and memo-receipt date replace the single-round values for
    # every downstream computation (sanity guards, the s.138 window, the narrative
    # dates). Earlier rounds are carried into the context as pleaded history. The
    # rounds must be in chronological order and each not precede the one before it.
    rounds = list(presentation_rounds or [])
    if rounds:
        prev: Optional[date] = None
        for i, r in enumerate(rounds):
            if prev is not None and r.presented_on < prev:
                return _refuse(
                    f"presentation round {i + 1} ({r.presented_on.isoformat()}) is "
                    f"before the previous round ({prev.isoformat()}); presentation "
                    f"rounds must be in chronological order",
                    code="s138_complaint_presentation_rounds_out_of_order",
                    fields=("presentation_rounds",),
                )
            if r.memo_received < r.presented_on:
                return _refuse(
                    f"presentation round {i + 1}: the memo receipt "
                    f"({r.memo_received.isoformat()}) is before the presentation "
                    f"({r.presented_on.isoformat()}); a dishonour memo cannot be "
                    f"received before the cheque is presented",
                    code="s138_complaint_round_memo_before_presentation",
                    fields=("presentation_rounds",),
                )
            prev = r.presented_on
        _last = rounds[-1]
        # The operative (last) round drives every downstream date: the sanity
        # guards, the s.138 window, and the narrative presentation/memo dates.
        presentation_date = _last.presented_on
        memo_received_date = _last.memo_received
        memo_date = _last.memo_received

    # --- input-sanity guards (data-corruption / chronology) --------------------
    # These catch GARBAGE INPUT the downstream statutory logic would otherwise
    # trust and render silently — the class of defect seen in a real botched draft
    # (a service date that preceded the notice, an inflated cheque amount, a cheque
    # number duplicated across the list). None of these are statutory-window
    # checks; they are "these facts cannot be true" checks. All HARD refuse.
    for c in cheques:
        if c.amount <= 0:
            return _refuse(
                f"cheque No. {c.number} has a non-positive amount ({c.amount}); "
                f"the cheque amount is required and must be greater than zero",
                code="s138_complaint_cheque_amount_not_positive",
                fields=("cheques",),
            )
        if presentation_date < c.date:
            return _refuse(
                f"cheque No. {c.number} is dated {c.date.isoformat()} but the "
                f"presentation date is {presentation_date.isoformat()}, which is "
                f"before the cheque was drawn; a cheque cannot be presented before "
                f"its own date",
                code="s138_complaint_presentation_before_cheque_date",
                fields=("presentation_date", "cheques"),
                computation=f"cheque date {c.date}; presentation {presentation_date}",
            )

    _cheque_numbers = [c.number for c in cheques]
    _dupes = sorted({n for n in _cheque_numbers if _cheque_numbers.count(n) > 1})
    if _dupes:
        return _refuse(
            f"the cheque list contains duplicate cheque number(s): "
            f"{', '.join(_dupes)}; each cheque in the complaint must be distinct",
            code="s138_complaint_duplicate_cheque_number",
            fields=("cheques",),
        )

    # Chronology of the memo -> notice -> service chain. Each step must not
    # precede the one before it. (The 30-day notice window itself is enforced by
    # s138_windows in the notice pipeline; here we only reject impossible order.)
    if notice_date < memo_received_date:
        return _refuse(
            f"the statutory notice is dated {notice_date.isoformat()} but the "
            f"dishonour memo was received on {memo_received_date.isoformat()}; the "
            f"notice cannot predate receipt of the memo it responds to",
            code="s138_complaint_notice_before_memo_received",
            fields=("notice_date", "memo_received_date"),
            computation=f"memo received {memo_received_date}; notice {notice_date}",
        )
    if notice_dispatch_date < notice_date:
        return _refuse(
            f"the notice dispatch date ({notice_dispatch_date.isoformat()}) is "
            f"before the notice date ({notice_date.isoformat()}); a notice cannot "
            f"be dispatched before it is issued",
            code="s138_complaint_dispatch_before_notice",
            fields=("notice_dispatch_date", "notice_date"),
        )
    # Actual (non-deemed) service cannot precede dispatch. Checked here against the
    # raw input; the deemed-service branch computes its own delivery date below.
    if (
        not (notice_refused or notice_unclaimed)
        and notice_delivery_date is not None
        and notice_delivery_date < notice_dispatch_date
    ):
        return _refuse(
            f"the notice service/delivery date "
            f"({notice_delivery_date.isoformat()}) is before the dispatch date "
            f"({notice_dispatch_date.isoformat()}); the notice cannot be served "
            f"before it was dispatched",
            code="s138_complaint_service_before_dispatch",
            fields=("notice_delivery_date", "notice_dispatch_date"),
            computation=(
                f"dispatch {notice_dispatch_date}; service {notice_delivery_date}"
            ),
        )

    # --- service + cause-of-action date ---
    # The date must ALWAYS be computed. Refused/unclaimed notice runs from the
    # deemed delivery date and requires an explicit deemed-service averment.
    deemed = notice_refused or notice_unclaimed
    if deemed:
        if not (deemed_service_averment and deemed_service_averment.strip()):
            return _refuse(
                "the notice was returned refused/unclaimed; an explicit "
                "deemed-service averment is required before the complaint can be "
                "generated",
                code="s138_complaint_deemed_service_averment_missing",
                fields=("deemed_service_averment", "notice_refused",
                        "notice_unclaimed"),
            )
        if deemed_delivery_date is None:
            return _refuse(
                "the notice was returned refused/unclaimed; the deemed delivery "
                "date is required to compute the cause of action",
                code="s138_complaint_deemed_delivery_date_missing",
                fields=("deemed_delivery_date", "notice_refused",
                        "notice_unclaimed"),
            )
        delivery_date = deemed_delivery_date
    else:
        if notice_delivery_date is None:
            return _refuse(
                "the notice delivery date is required to compute the cause of action",
                code="s138_complaint_notice_delivery_date_missing",
                fields=("notice_delivery_date",),
            )
        delivery_date = notice_delivery_date

    # Cause of action = delivery + 15-day pay period + 1 (reuse windows).
    coa = windows.cause_of_action_date(notice_received=delivery_date)
    window = windows.complaint_window(notice_received=delivery_date)
    in_time = windows.complaint_in_time(window, filing_date=filing_date)
    condonation_required = not in_time

    demand_amount = sum(c.amount for c in cheques)

    # --- advocate block: pair each name with its enrolment (if given) ----------
    # Produces e.g. ["M. Gowtham (Enrl. 4687/2025)", "M. Arunkumar (Enrl. ...)"].
    # A name with no matching enrolment renders bare. Empty -> None so the
    # template shows the generic "Through / Advocate" fallback.
    _adv_names = [a.strip() for a in (advocates or []) if str(a).strip()]
    _adv_enrols = list(advocate_enrolments or [])
    advocate_lines: List[str] = []
    for i, name in enumerate(_adv_names):
        enrol = _adv_enrols[i].strip() if i < len(_adv_enrols) and str(_adv_enrols[i]).strip() else ""
        advocate_lines.append(f"{name} (Enrl. {enrol})" if enrol else name)

    # --- List of documents (para 12: "the documents are listed herewith") ------
    # The standard s.138 documentary set, computed from the facts. Advocate-added
    # documents (extra_documents) number continuously AFTER these — the template
    # uses standard_document_count to offset their index. The affidavit derivation
    # reads the same two fields so both documents recite an identical list.
    # Structured document RECORDS (date / description / remarks) for the
    # reference-style 4-column table. Built alongside the string `standard_documents`
    # (kept for back-compat with callers/tests that read the flat list). Each record
    # is {date_body, description, remarks}.
    document_records: List[Dict[str, Any]] = []
    if itemise_documents:
        # Tamil-Nadu practice: each cheque and its return memo are listed as
        # separate, consecutively-numbered items, followed by any holding
        # agreement, the notice, its service proofs, and advocate additions.
        standard_documents = []
        for c in cheques:
            standard_documents.append(
                f"Cheque No. {c.number} dated {table_date(c.date)} for "
                f"Rs. {c.amount}/- issued to the complainant"
            )
            document_records.append({
                "date_body": table_date(c.date),
                "description": f"Cheque issued to the complainant, Cheque No. "
                               f"{c.number} for Rs. {c.amount}/-",
                "remarks": "Original",
            })
            standard_documents.append(
                f"Return memo of the bank on Cheque No. {c.number} dated "
                f"{table_date(memo_date)}"
            )
            document_records.append({
                "date_body": table_date(memo_date),
                "description": f"Return memo of the bank on Cheque No. {c.number}",
                "remarks": "Original",
            })
        if deferment_agreement_date is not None:
            standard_documents.append(
                f"Cheque presentation deferment agreement dated "
                f"{table_date(deferment_agreement_date)}"
            )
            document_records.append({
                "date_body": table_date(deferment_agreement_date),
                "description": "Cheque Presentation Deferment Agreement",
                "remarks": "Original",
            })
        standard_documents.append(
            f"Statutory notice issued by the complainant dated "
            f"{table_date(notice_date)}"
        )
        document_records.append({
            "date_body": table_date(notice_date),
            "description": "Statutory Notice issued by the Complainant",
            "remarks": "Office copy",
        })
        if notice_ack_official_date is not None:
            standard_documents.append(
                f"Proof of notice served to the official address of the accused — "
                f"acknowledgement card dated {table_date(notice_ack_official_date)}"
            )
            document_records.append({
                "date_body": table_date(notice_ack_official_date),
                "description": "Proof of Notice served to official address — "
                               "Acknowledgement Card",
                "remarks": "Original",
            })
        if notice_ack_residence_date is not None:
            standard_documents.append(
                f"Proof of notice served to the residence of the accused — "
                f"acknowledgement card dated {table_date(notice_ack_residence_date)}"
            )
            document_records.append({
                "date_body": table_date(notice_ack_residence_date),
                "description": "Proof of Notice served to residence of the Accused — "
                               "Acknowledgement Card",
                "remarks": "Original",
            })
    else:
        cheque_doc = (
            "The dishonoured cheque"
            + ("s" if len(cheques) > 1 else "")
            + " ("
            + ", ".join(f"No. {c.number} dated {c.date.isoformat()}" for c in cheques)
            + ")"
        )
        standard_documents = [
            cheque_doc,
            f"The bank's cheque return memo dated {memo_date.isoformat()}",
            f"The statutory demand notice dated {notice_date.isoformat()}",
            "The postal dispatch receipt and acknowledgement / returned cover for the "
            "statutory notice",
        ]
        document_records = [
            {"date_body": table_date(c.date) if len(cheques) == 1 else "",
             "description": cheque_doc, "remarks": "Original"},
            {"date_body": table_date(memo_date),
             "description": "The bank's cheque return memo", "remarks": "Original"},
            {"date_body": table_date(notice_date),
             "description": "The statutory demand notice", "remarks": "Office copy"},
            {"date_body": "",
             "description": "The postal dispatch receipt and acknowledgement / "
                            "returned cover for the statutory notice", "remarks": ""},
        ]
    extra_documents_list = [d for d in (extra_documents or []) if str(d).strip()]
    # Advocate-added documents extend the structured records too (no date/remarks).
    for d in extra_documents_list:
        document_records.append({"date_body": "", "description": str(d), "remarks": ""})

    context: Dict[str, Any] = {
        "complainant": {"name": complainant_name,
                        "is_company": complainant_is_company,
                        "authorised_rep": complainant_authorised_rep,
                        "resolution_ref": complainant_resolution_ref,
                        "parentage": complainant_parentage,
                        "address": complainant_address},
        "is_payee": is_payee,
        "is_holder_in_due_course": is_holder_in_due_course,
        # Advocate block (format-layer). `advocate_lines` is the fully-rendered
        # name(+enrolment) list; `advocate_contact` the optional contact line.
        "advocate_lines": advocate_lines,
        "advocate_contact": advocate_contact.strip() if advocate_contact and advocate_contact.strip() else None,
        "advocate_office_address": advocate_office_address.strip() if advocate_office_address and advocate_office_address.strip() else None,
        # Case-number label for the cause-title (e.g. "S.T.C. No."); defaults generic.
        "case_number_label": (case_number_label.strip() if case_number_label and case_number_label.strip() else "CRIMINAL COMPLAINT NO."),
        "accused": {"name": accused_name, "is_company": accused_is_company,
                    "parentage": accused_parentage, "address": accused_address},
        # cause-title header fields (render only when present). Suppress `city`
        # when `court_location` already ends with (or contains) it, so the header
        # never reads "... Magistrate, Saidapet, Chennai, Chennai" — a doubled city
        # the extractor triggers when it fills BOTH the court location (which names
        # the city) and the standalone city field.
        "court_location": court_location,
        "court_designation": court_designation,
        "city": (
            None
            if (city and court_location and city.strip().lower() in court_location.lower())
            else city
        ),
        "police_station": police_station,
        "complaint_year": filing_date.year,
        "complaint_date": filing_date.isoformat(),
        "complaint_date_body": body_date(filing_date),
        "extra_witnesses": list(extra_witnesses) if extra_witnesses else [],
        # Witness list with the complainant seeded as CW-1 (deponent of the proof
        # affidavit). The banker witnesses follow, then any advocate additions.
        # `witnesses` is the fully-assembled list; the template may use it directly.
        "witnesses": (
            [f"{complainant_name}, Complainant"]
            + ["The Manager, banker of the complainant (collecting bank)"]
            + ["The Manager, banker of the accused (drawee bank)"]
            + [w for w in (extra_witnesses or []) if str(w).strip()]
        ),
        "documents": standard_documents,
        # Structured records for the reference-style 4-column document table.
        "document_records": document_records,
        "extra_documents": extra_documents_list,
        "standard_document_count": len(standard_documents),
        "itemised_documents": itemise_documents,
        "deferment_agreement_date": deferment_agreement_date,
        "deferment_agreement_date_body": body_date(deferment_agreement_date) if deferment_agreement_date else None,
        # Multi-round presentation history (doc-5 E1). Empty when the single-round
        # path is used. Body-formatted dates so the template pleads them directly.
        "presentation_rounds": [
            {
                "presented_on_body": body_date(r.presented_on),
                "memo_received_body": body_date(r.memo_received),
                "reason": r.reason,
                "is_last": idx == len(rounds) - 1,
            }
            for idx, r in enumerate(rounds)
        ],
        "has_presentation_rounds": bool(rounds),
        "s141_averment": s141_averment,
        "cheques": [
            {
                "number": c.number,
                "date": c.date.isoformat(),
                "date_body": body_date(c.date),
                "amount": c.amount,
                "amount_words": rupees_in_words(c.amount),
                "bank": c.bank,
                "branch": c.branch,
                "drawer": c.drawer,
                "payee": c.payee,
            }
            for c in cheques
        ],
        "demand_amount": demand_amount,
        "demand_words": rupees_in_words(demand_amount),
        "debt_slot": debt_slot if debt_slot.strip() else _LLM_SLOT_PLACEHOLDER,
        "presentation_date": presentation_date,
        "memo_date": memo_date,
        "memo_received_date": memo_received_date,
        "dishonour_reason": dishonour_reason,
        "notice_date": notice_date,
        "notice_dispatch_date": notice_dispatch_date,
        "delivery_date": delivery_date,
        "deemed_service": deemed,
        "deemed_service_averment": deemed_service_averment,
        "cause_of_action_date": coa,
        "cause_of_action_date_body": body_date(coa),
        "filing_deadline": window.filing_deadline,
        "filing_date": filing_date,
        "condonation_required": condonation_required,
        "condonation_section": _CONDONATION_SECTION if condonation_required else None,
        "jurisdiction_basis": jurisdiction_basis,
        "place": place,
        # Body-formatted (dd.mm.yyyy) copies of the key narrative dates, so the
        # template can render Indian-practice dates without leaking ISO.
        "presentation_date_body": body_date(presentation_date),
        "memo_date_body": body_date(memo_date),
        "memo_received_date_body": body_date(memo_received_date),
        "notice_date_body": body_date(notice_date),
        "notice_dispatch_date_body": body_date(notice_dispatch_date),
        "delivery_date_body": body_date(delivery_date),
        # Prayer relief. When prayer_twice_amount is set, the prayer directs the
        # accused to pay twice the aggregate cheque amount (the conventional
        # s.138 relief), and cites S.395 BNSS for execution. The affidavit
        # derivation reads these same fields so both documents pray identically.
        "prayer_twice_amount": prayer_twice_amount,
        "prayer_twice_words": rupees_in_words(demand_amount * 2) if prayer_twice_amount else None,
        "prayer_twice_figure": demand_amount * 2 if prayer_twice_amount else None,
    }
    return ComplaintResult(refused=False, context=context)
