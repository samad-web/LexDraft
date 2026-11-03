"""Adapter for the criminal revision petition (BNSS ss.438/442, ss.438/440)."""
from __future__ import annotations
from ...pipelines import criminal_revision as pipeline
from ...pipelines.criminal_revision import RevisionForum
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='criminal_revision', spec='bnss-438-442',
    title='Criminal revision petition (ss.438/442 BNSS)', build=pipeline.build,
    template='criminal_revision.docx',
    fields=(
        FieldSpec('forum', 'enum', enum_values=tuple(f.value for f in RevisionForum),
                  to_engine=RevisionForum),
        FieldSpec('petitioner_names', 'string_list'),
        FieldSpec('respondent_names', 'string_list'),
        FieldSpec('impugned_order_ref', 'string'),
        FieldSpec('impugned_order_date', 'date'),
        FieldSpec('lower_court', 'string'),
        FieldSpec('case_ref', 'string', required=False, default=''),
        FieldSpec('offence_date', 'date', required=False, default=None),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('impugned_order_is_interlocutory', 'bool', required=False, default=False),
        FieldSpec('revision_before_other_forum', 'bool', required=False, default=False),
        FieldSpec('appeal_lies', 'bool', required=False, default=False),
        FieldSpec('copy_applied_date', 'date', required=False, default=None),
        FieldSpec('copy_ready_date', 'date', required=False, default=None),
        FieldSpec('condone_delay_petition_filed', 'bool', required=False, default=False),
        FieldSpec('is_fresh_action', 'bool', required=False, default=True),
        FieldSpec('proceeding_start_date', 'date', required=False, default=None),
        FieldSpec('court_name', 'string', required=False, default=None),
        FieldSpec('facts_narrative', 'string', required=False, default=''),
        FieldSpec('grounds_narrative', 'string', required=False, default=''),
        FieldSpec('grounds_list', 'string_list', required=False, default=None),
    ),
    slots=('facts_narrative', 'grounds_narrative'),
)
register(ADAPTER)
