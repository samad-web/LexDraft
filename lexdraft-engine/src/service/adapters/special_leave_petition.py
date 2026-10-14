"""Adapter for Special leave petition (Art.136) (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines.special_leave_petition import SLPKind
from ...pipelines import special_leave_petition as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='special_leave_petition', spec='dpc-67-74',
    title='Special leave petition (Art.136)', build=pipeline.build,
    template='special_leave_petition.docx',
    fields=(
        FieldSpec('slp_kind', 'enum', enum_values=tuple(k.value for k in SLPKind), to_engine=SLPKind),
        FieldSpec('petitioner_name', 'string'),
        FieldSpec('respondents', 'string_list'),
        FieldSpec('impugned_court', 'string'),
        FieldSpec('impugned_judgment_date', 'date'),
        FieldSpec('impugned_case_ref', 'string'),
        FieldSpec('questions_of_law', 'string_list', required=False, default=[]),
        FieldSpec('grounds', 'string_list'),
        FieldSpec('no_other_slp', 'bool'),
        FieldSpec('annexures_true_copies', 'bool'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('brief_facts', 'string', required=False, default=''),
        FieldSpec('interim_relief_sought', 'string', required=False, default=''),
        FieldSpec('place', 'string'),
        FieldSpec('petitioner_parentage', 'string', required=False, default=None),
        FieldSpec('petitioner_address', 'string', required=False, default=None),
    ),
    slots=('brief_facts',),
)
register(ADAPTER)
