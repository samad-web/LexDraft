"""Adapter for the amendment application (O.VI R.17 CPC)."""
from __future__ import annotations
from ...pipelines import amendment_ia as pipeline
from ...pipelines.amendment_ia import Pleading
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='amendment_ia', spec='cpc-o6r17',
    title='Application to amend pleadings (O.VI R.17 CPC)', build=pipeline.build,
    template='amendment_ia.docx',
    fields=(
        FieldSpec('applicant_name', 'string'),
        FieldSpec('applicant_role', 'string'),
        FieldSpec('respondent_name', 'string'),
        FieldSpec('suit_ref', 'string'),
        FieldSpec('pleading', 'enum', enum_values=tuple(p.value for p in Pleading),
                  to_engine=Pleading),
        FieldSpec('proposed_amendments', 'string_list'),
        FieldSpec('trial_commenced', 'bool'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('pleading_date', 'date', required=False, default=None),
        FieldSpec('due_diligence_explanation', 'string', required=False, default=None),
        FieldSpec('civil_court', 'string', required=False, default=None),
        FieldSpec('city', 'string', required=False, default=None),
        FieldSpec('reasons_narrative', 'string', required=False, default=''),
        FieldSpec('respondent_names', 'string_list', required=False, default=None),
    ),
    slots=('reasons_narrative',),
)
register(ADAPTER)
