"""Adapter for Suit for specific performance (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import specific_performance as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='specific_performance', spec='dpc-25-26',
    title='Suit for specific performance', build=pipeline.build,
    template='specific_performance.docx',
    fields=(
        FieldSpec('plaintiff_name', 'string'),
        FieldSpec('defendant_name', 'string'),
        FieldSpec('suit_property', 'string'),
        FieldSpec('agreement_date', 'date'),
        FieldSpec('agreement_ref', 'string'),
        FieldSpec('total_consideration', 'int'),
        FieldSpec('earnest_paid', 'int'),
        FieldSpec('balance_amount', 'int'),
        FieldSpec('readiness_and_willingness', 'bool'),
        FieldSpec('refusal_narrative', 'string', required=False, default=''),
        FieldSpec('notice_ref', 'string'),
        FieldSpec('cause_of_action_date', 'date'),
        FieldSpec('cause_of_action_place', 'string'),
        FieldSpec('court_fee', 'int'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('plaintiff_parentage', 'string', required=False, default=None),
        FieldSpec('plaintiff_address', 'string', required=False, default=None),
        FieldSpec('defendant_parentage', 'string', required=False, default=None),
        FieldSpec('defendant_address', 'string', required=False, default=None),
        FieldSpec('civil_court', 'string', required=False, default=None),
        FieldSpec('city', 'string', required=False, default=None),
    ),
    slots=('refusal_narrative',),
)
register(ADAPTER)
