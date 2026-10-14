"""Adapter for Execution application (O21 CPC) (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import execution_application as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='execution_application', spec='dpc-36-37',
    title='Execution application (O21 CPC)', build=pipeline.build,
    template='execution_application.docx',
    fields=(
        FieldSpec('decree_holder_name', 'string'),
        FieldSpec('judgment_debtor_name', 'string'),
        FieldSpec('execution_court', 'string'),
        FieldSpec('suit_no', 'string'),
        FieldSpec('decree_date', 'date'),
        FieldSpec('appeal_filed', 'bool'),
        FieldSpec('payment_received', 'string', required=False, default='Nil'),
        FieldSpec('prior_applications', 'string', required=False, default='Nil'),
        FieldSpec('decretal_amount', 'int'),
        FieldSpec('interest_note', 'string', required=False, default=''),
        FieldSpec('costs_amount', 'int'),
        FieldSpec('execution_against', 'string'),
        FieldSpec('mode_of_assistance', 'string'),
        FieldSpec('certified_copy_attached', 'bool'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('police_station', 'string', required=False, default=None),
    ),
    slots=(),
)
register(ADAPTER)
