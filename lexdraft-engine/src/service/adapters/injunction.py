"""Adapter for Application for temporary injunction (O39 R1&2) (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import injunction as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='injunction', spec='4.2',
    title='Application for temporary injunction (O39 R1&2)', build=pipeline.build,
    template='injunction.docx',
    fields=(
        FieldSpec('suit_ref', 'string'),
        FieldSpec('subject_matter', 'string'),
        FieldSpec('applicant_name', 'string'),
        FieldSpec('applicant_role', 'string'),
        FieldSpec('brief_facts', 'string', required=False, default=''),
        FieldSpec('prima_facie_case', 'string'),
        FieldSpec('balance_of_convenience', 'string'),
        FieldSpec('irreparable_injury', 'string'),
        FieldSpec('urgency_conduct', 'string'),
        FieldSpec('undertaking_as_to_damages', 'bool'),
        FieldSpec('act_restrained', 'string'),
        FieldSpec('is_ex_parte', 'bool'),
        FieldSpec('notice_futility', 'string', required=False, default=None),
        FieldSpec('place', 'string'),
        FieldSpec('opposite_party_name', 'string', required=False, default=''),
        FieldSpec('civil_court', 'string', required=False, default=None),
        FieldSpec('city', 'string', required=False, default=None),
        FieldSpec('application_date', 'date', required=False, default=None),
    ),
    slots=('brief_facts',),
)
register(ADAPTER)
