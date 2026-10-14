"""Adapter for the s.138 statutory notice (spec 2.2) — the Phase 1 lead document.

Inbound contract (the JSON the frontend posts under `fields`):

    client, advocate, advocate_enrolment            : string
    recipient_name, recipient_address               : string
    cheques: [ { number, date(ISO), amount(int),
                 bank, branch, drawer, payee } ]     : >=1
    debt_nature                                      : string
    debt_documents                                   : [string]   (optional)
    presentation_date, memo_date                     : date
    presentation_bank                                : string
    memo_received_date                               : date (nullable; a missing
                                                       one is a 422, not a refusal)
    dishonour_reason                                 : string
    notice_date                                      : date
    dispatch_mode, dispatch_tracking_placeholder     : string
    place                                            : string
    compliance_days                                  : int (optional; default 15)
    override_demand_amount                           : int (optional)

Inbound keys here are deliberately identical to the engine kwargs where a scalar
maps 1:1; the mapping is still declared explicitly so refusal-field translation is
guaranteed (Rule 2), and so a later contract rename doesn't touch the engine.
"""

from __future__ import annotations

from typing import Any, Dict, List

from ...pipelines import s138_notice as pipeline
from ...pipelines.s138_notice import Cheque
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


def _build_cheque(kw: Dict[str, Any]) -> Cheque:
    return Cheque(**kw)


ADAPTER = Adapter(
    doc_type="s138_notice",
    spec="2.2",
    title="Statutory notice under s.138 NI Act",
    build=pipeline.build,
    fields=(
        FieldSpec("client", "string"),
        FieldSpec("advocate", "string"),
        FieldSpec("advocate_enrolment", "string"),
        FieldSpec("recipient_name", "string"),
        FieldSpec("recipient_address", "string"),
        ListFieldSpec("cheques", _CHEQUE_ITEM, _build_cheque, min_items=1),
        FieldSpec("debt_nature", "string"),
        FieldSpec("debt_documents", "string_list", required=False, default=[]),
        FieldSpec("presentation_date", "date"),
        FieldSpec("presentation_bank", "string"),
        FieldSpec("memo_date", "date"),
        # memo_received_date is Optional in the pipeline, but the CONTRACT makes it
        # required: its absence is an incomplete form (422), never the pipeline's
        # "receipt date required" refusal. (That refusal can still fire if a caller
        # bypasses the adapter; the adapter simply never lets it.)
        FieldSpec("memo_received_date", "date"),
        FieldSpec("dishonour_reason", "string"),
        FieldSpec("notice_date", "date"),
        FieldSpec("dispatch_mode", "string"),
        FieldSpec("dispatch_tracking_placeholder", "string"),
        FieldSpec("place", "string"),
        FieldSpec("compliance_days", "int", required=False, default=15),
        FieldSpec("override_demand_amount", "int", required=False, default=None),
    ),
    slots=(),   # the s.138 notice is fully rule-driven — no narrative slots.
    # Engine fields a refusal may name that are not a 1:1 top-level inbound field.
    # The cheque-presented-after-validity refusal names the logical engine field
    # `cheque_dates`; translate it to the nested inbound path the form renders, so
    # the frontend highlights the cheque DATE column, not the whole cheque list.
    extra_reverse={"cheque_dates": "cheques[].date"},
)

register(ADAPTER)
