"""Adapter for Transfer petition (Civil) u/s 25 CPC (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import transfer_petition as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='transfer_petition', spec='dpc-31-35',
    title='Transfer petition (Civil) u/s 25 CPC', build=pipeline.build,
    template='transfer_petition.docx',
    fields=(
        FieldSpec('petitioner_name', 'string'),
        FieldSpec('respondents', 'string_list'),
        FieldSpec('case_to_transfer', 'string'),
        FieldSpec('from_court', 'string'),
        FieldSpec('from_state', 'string'),
        FieldSpec('to_court', 'string'),
        FieldSpec('to_state', 'string'),
        FieldSpec('brief_facts', 'string', required=False, default=''),
        FieldSpec('grounds', 'string_list'),
        FieldSpec('no_other_transfer_petition', 'bool'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('petitioner_parentage', 'string', required=False, default=None),
        FieldSpec('petitioner_address', 'string', required=False, default=None),
    ),
    slots=('brief_facts',),
)
register(ADAPTER)
