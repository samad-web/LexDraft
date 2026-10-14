"""Adapter for Contempt petition (ss.11-12 CoC Act) (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import contempt_petition as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='contempt_petition', spec='dpc-86-87',
    title='Contempt petition (ss.11-12 CoC Act)', build=pipeline.build,
    template='contempt_petition.docx',
    fields=(
        FieldSpec('petitioner_names', 'string_list'),
        FieldSpec('respondents', 'string_list'),
        FieldSpec('parent_case_ref', 'string'),
        FieldSpec('order_disobeyed_date', 'date'),
        FieldSpec('order_nature', 'string'),
        FieldSpec('contemnors_had_knowledge', 'bool'),
        FieldSpec('disobedience_narrative', 'string'),
        FieldSpec('contempt_committed_date', 'date'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('high_court', 'string', required=False, default=None),
        FieldSpec('petitioner_addresses', 'string_list', required=False, default=None),
    ),
    slots=('disobedience_narrative',),
)
register(ADAPTER)
