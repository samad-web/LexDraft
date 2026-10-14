"""Adapter for Application u/O39 R2-A CPC (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import o39_r2a_application as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='o39_r2a_application', spec='dpc-19-20',
    title='Application u/O39 R2-A CPC', build=pipeline.build,
    template='o39_r2a_application.docx',
    fields=(
        FieldSpec('applicant_name', 'string'),
        FieldSpec('respondent_name', 'string'),
        FieldSpec('suit_ref', 'string'),
        FieldSpec('injunction_order_date', 'date'),
        FieldSpec('respondent_had_knowledge', 'bool'),
        FieldSpec('disobedience_narrative', 'string'),
        FieldSpec('disobedience_date', 'date', required=False, default=None),
        FieldSpec('property_list_attached', 'bool'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('civil_court', 'string', required=False, default=None),
        FieldSpec('city', 'string', required=False, default=None),
    ),
    slots=('disobedience_narrative',),
)
register(ADAPTER)
