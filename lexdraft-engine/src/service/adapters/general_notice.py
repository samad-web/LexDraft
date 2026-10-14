"""Adapter for the general demand notice (spec 2.1)."""

from __future__ import annotations

from ...pipelines import general_notice as pipeline
from . import Adapter, FieldSpec, register


ADAPTER = Adapter(
    doc_type="general_notice",
    spec="2.1",
    title="General demand notice",
    build=pipeline.build,
    template="general_notice.docx",
    fields=(
        FieldSpec("client", "string"),
        FieldSpec("advocate", "string"),
        FieldSpec("advocate_enrolment", "string"),
        FieldSpec("recipient_name", "string"),
        FieldSpec("recipient_address", "string"),
        FieldSpec("recipient_mode", "string"),
        FieldSpec("demand_amount", "int"),
        FieldSpec("act_required", "string"),
        FieldSpec("compliance_days", "int"),
        FieldSpec("statutory_minimum_days", "int", required=False, default=None),
        FieldSpec("civil_consequence", "string"),
        FieldSpec("criminal_consequence", "string", required=False, default=None),
        FieldSpec("dispatch_tracking_placeholder", "string"),
        FieldSpec("transaction_narrative", "string", required=False, default=""),
        FieldSpec("breach_narrative", "string", required=False, default=""),
        FieldSpec("prior_demands_narrative", "string", required=False, default=""),
        FieldSpec("loss_narrative", "string", required=False, default=""),
        FieldSpec("notice_date", "date"),
        FieldSpec("place", "string"),
    ),
    slots=("transaction_narrative", "breach_narrative", "prior_demands_narrative",
           "loss_narrative"),
)

register(ADAPTER)
