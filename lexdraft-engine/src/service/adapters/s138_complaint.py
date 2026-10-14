"""Adapter for the s.138 NI Act complaint (spec 3.1)."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import s138_complaint as pipeline
from ...pipelines.s138_notice import Cheque
from ...pipelines.s138_complaint import PresentationRound
from . import Adapter, FieldSpec, ListFieldSpec, register


_CHEQUE_ITEM = (
    FieldSpec("number", "string"),
    FieldSpec("date", "date"),
    FieldSpec("amount", "int"),
    FieldSpec("bank", "string"),
    FieldSpec("branch", "string"),
    FieldSpec("drawer", "string"),
    FieldSpec("payee", "string"),
)

# Multi-round presentation history (doc-5 E1). Each row: when presented, when the
# dishonour memo was received, and the reason. The last row is the operative one.
_PRESENTATION_ROUND_ITEM = (
    FieldSpec("presented_on", "date"),
    FieldSpec("memo_received", "date"),
    FieldSpec("reason", "string", required=False, default="Funds Insufficient"),
)


def _cheque(kw: Dict[str, Any]) -> Cheque:
    return Cheque(**kw)


def _presentation_round(kw: Dict[str, Any]) -> PresentationRound:
    return PresentationRound(**kw)


ADAPTER = Adapter(
    doc_type="s138_complaint", spec="3.1",
    title="Complaint under s.138 NI Act", build=pipeline.build,
    template="s138_complaint.docx",
    fields=(
        FieldSpec("complainant_name", "string"),
        FieldSpec("complainant_is_company", "bool", required=False, default=False),
        FieldSpec("complainant_authorised_rep", "string", required=False, default=None),
        FieldSpec("complainant_resolution_ref", "string", required=False, default=None),
        FieldSpec("is_payee", "bool"),
        FieldSpec("accused_name", "string"),
        FieldSpec("accused_is_company", "bool", required=False, default=False),
        FieldSpec("s141_averment", "string", required=False, default=None),
        ListFieldSpec("cheques", _CHEQUE_ITEM, _cheque, min_items=1),
        FieldSpec("debt_slot", "string", required=False, default=""),
        FieldSpec("presentation_date", "date"),
        FieldSpec("memo_date", "date"),
        FieldSpec("memo_received_date", "date"),
        FieldSpec("dishonour_reason", "string"),
        FieldSpec("notice_date", "date"),
        FieldSpec("notice_dispatch_date", "date"),
        FieldSpec("notice_delivery_date", "date", required=False, default=None),
        FieldSpec("notice_refused", "bool", required=False, default=False),
        FieldSpec("notice_unclaimed", "bool", required=False, default=False),
        FieldSpec("filing_date", "date"),
        FieldSpec("payee_bank_branch_in_jurisdiction", "bool"),
        FieldSpec("jurisdiction_basis", "string"),
        FieldSpec("place", "string"),
        FieldSpec("deemed_delivery_date", "date", required=False, default=None),
        FieldSpec("deemed_service_averment", "string", required=False, default=None),
        FieldSpec("court_location", "string", required=False, default=None),
        FieldSpec("court_designation", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
        FieldSpec("police_station", "string", required=False, default=None),
        FieldSpec("complainant_parentage", "string", required=False, default=None),
        FieldSpec("complainant_address", "string", required=False, default=None),
        FieldSpec("accused_parentage", "string", required=False, default=None),
        FieldSpec("accused_address", "string", required=False, default=None),
        FieldSpec("extra_witnesses", "string_list", required=False, default=None),
        FieldSpec("extra_documents", "string_list", required=False, default=None),
        # Real-filing refinements (all optional; defaults preserve prior output).
        FieldSpec("deferment_agreement_date", "date", required=False, default=None),
        ListFieldSpec("presentation_rounds", _PRESENTATION_ROUND_ITEM,
                      _presentation_round, required=False),
        FieldSpec("notice_ack_official_date", "date", required=False, default=None),
        FieldSpec("notice_ack_residence_date", "date", required=False, default=None),
        FieldSpec("itemise_documents", "bool", required=False, default=False),
        FieldSpec("prayer_twice_amount", "bool", required=False, default=False),
        FieldSpec("is_holder_in_due_course", "bool", required=False, default=False),
        FieldSpec("advocates", "string_list", required=False, default=None),
        FieldSpec("advocate_enrolments", "string_list", required=False, default=None),
        FieldSpec("advocate_contact", "string", required=False, default=None),
        FieldSpec("advocate_office_address", "string", required=False, default=None),
        FieldSpec("case_number_label", "string", required=False, default=None),
    ),
    slots=("debt_slot",),
    extra_reverse={"cheque_dates": "cheques[].date"},
)

register(ADAPTER)
