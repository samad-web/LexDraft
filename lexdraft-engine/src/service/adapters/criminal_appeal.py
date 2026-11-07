"""Adapter for the criminal appeal against conviction (s.415 BNSS)."""
from __future__ import annotations
from ...pipelines import criminal_appeal as pipeline
from ...pipelines.criminal_appeal import AppealForum, TrialCourt
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='criminal_appeal', spec='bnss-415',
    title='Criminal appeal against conviction (s.415 BNSS)', build=pipeline.build,
    template='criminal_appeal.docx',
    fields=(
        FieldSpec('forum', 'enum', enum_values=tuple(f.value for f in AppealForum),
                  to_engine=AppealForum),
        FieldSpec('trial_court_level', 'enum',
                  enum_values=tuple(t.value for t in TrialCourt), to_engine=TrialCourt),
        FieldSpec('appellant_names', 'string_list'),
        FieldSpec('respondent_names', 'string_list'),
        FieldSpec('trial_case_ref', 'string'),
        FieldSpec('trial_court', 'string'),
        FieldSpec('judgment_date', 'date'),
        FieldSpec('convicted_sections', 'string_list'),
        FieldSpec('sentence_text', 'string'),
        FieldSpec('max_sentence_years', 'int'),
        FieldSpec('offence_date', 'date', required=False, default=None),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('death_sentence', 'bool', required=False, default=False),
        FieldSpec('pleaded_guilty', 'bool', required=False, default=False),
        FieldSpec('appeal_limited_to_sentence', 'bool', required=False, default=False),
        FieldSpec('appellant_in_custody', 'bool', required=False, default=False),
        FieldSpec('copy_applied_date', 'date', required=False, default=None),
        FieldSpec('copy_ready_date', 'date', required=False, default=None),
        FieldSpec('condone_delay_petition_filed', 'bool', required=False, default=False),
        FieldSpec('suspension_petition_filed', 'bool', required=False, default=True),
        FieldSpec('is_fresh_action', 'bool', required=False, default=True),
        FieldSpec('proceeding_start_date', 'date', required=False, default=None),
        FieldSpec('court_name', 'string', required=False, default=None),
        FieldSpec('facts_narrative', 'string', required=False, default=''),
        FieldSpec('grounds_narrative', 'string', required=False, default=''),
        FieldSpec('grounds_list', 'string_list', required=False, default=None),
        FieldSpec('police_station', 'string', required=False, default=None),
        FieldSpec('crime_no', 'string', required=False, default=None),
        FieldSpec('private_complaint', 'bool', required=False, default=False),
        FieldSpec('draft_suspension_petition', 'bool', required=False, default=False),
        FieldSpec('custody_since', 'date', required=False, default=None),
        FieldSpec('deponent_description', 'string', required=False, default=None),
    ),
    slots=('facts_narrative', 'grounds_narrative'),
)
register(ADAPTER)
