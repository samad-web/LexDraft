"""Adapter for Writ petition (Criminal) (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import writ_criminal as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='writ_criminal', spec='dpc-63-66',
    title='Writ petition (Criminal)', build=pipeline.build,
    template='writ_criminal.docx',
    fields=(
        FieldSpec('petitioner_name', 'string'),
        FieldSpec('respondents', 'string_list'),
        FieldSpec('impugned_order_ref', 'string'),
        FieldSpec('impugned_order_date', 'date'),
        FieldSpec('impugned_order_statute', 'string'),
        FieldSpec('facts_narrative', 'string', required=False, default=''),
        FieldSpec('grounds', 'string_list'),
        FieldSpec('pre_execution_stage', 'bool'),
        FieldSpec('no_similar_petition', 'bool'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('high_court', 'string', required=False, default=None),
        FieldSpec('petitioner_parentage', 'string', required=False, default=None),
        FieldSpec('petitioner_address', 'string', required=False, default=None),
    ),
    slots=('facts_narrative',),
)
register(ADAPTER)
