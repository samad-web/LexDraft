"""Adapter for the first appeal u/s 96 + O.XLI R.1 CPC."""
from __future__ import annotations
from ...pipelines import civil_first_appeal as pipeline
from ...pipelines.civil_first_appeal import AppellateForum
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='civil_first_appeal', spec='cpc-96-o41',
    title='First appeal u/s 96 & O.XLI CPC', build=pipeline.build,
    template='civil_first_appeal.docx',
    fields=(
        FieldSpec('forum', 'enum', enum_values=tuple(f.value for f in AppellateForum),
                  to_engine=AppellateForum),
        FieldSpec('appellant_names', 'string_list'),
        FieldSpec('respondent_names', 'string_list'),
        FieldSpec('appellant_trial_role', 'string'),
        FieldSpec('suit_ref', 'string'),
        FieldSpec('trial_court', 'string'),
        FieldSpec('decree_date', 'date'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('is_consent_decree', 'bool', required=False, default=False),
        FieldSpec('judgment_date', 'date', required=False, default=None),
        FieldSpec('valuation', 'string', required=False, default=''),
        FieldSpec('court_fee', 'string', required=False, default=''),
        FieldSpec('copy_applied_date', 'date', required=False, default=None),
        FieldSpec('copy_ready_date', 'date', required=False, default=None),
        FieldSpec('condone_delay_application_filed', 'bool', required=False, default=False),
        FieldSpec('court_name', 'string', required=False, default=None),
        FieldSpec('facts_narrative', 'string', required=False, default=''),
        FieldSpec('grounds_narrative', 'string', required=False, default=''),
        FieldSpec('grounds_list', 'string_list', required=False, default=None),
    ),
    slots=('facts_narrative', 'grounds_narrative'),
)
register(ADAPTER)
