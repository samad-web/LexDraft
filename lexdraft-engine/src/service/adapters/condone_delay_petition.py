"""Adapter for the petition to condone delay (s.5 Limitation Act)."""
from __future__ import annotations
from ...pipelines import condone_delay_petition as pipeline
from ...pipelines.condone_delay_petition import MainProceeding
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='condone_delay_petition', spec='lim-5',
    title='Petition to condone delay (s.5 Limitation Act)', build=pipeline.build,
    template='condone_delay_petition.docx',
    fields=(
        FieldSpec('main_proceeding', 'enum',
                  enum_values=tuple(m.value for m in MainProceeding),
                  to_engine=MainProceeding),
        FieldSpec('main_proceeding_desc', 'string'),
        FieldSpec('petitioner_name', 'string'),
        FieldSpec('respondent_names', 'string_list'),
        FieldSpec('court_name', 'string'),
        FieldSpec('impugned_order_ref', 'string'),
        FieldSpec('impugned_order_date', 'date'),
        FieldSpec('period_days', 'int'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('sufficient_cause', 'string'),
        FieldSpec('place', 'string'),
        FieldSpec('is_order_xxi_application', 'bool', required=False, default=False),
        FieldSpec('copy_applied_date', 'date', required=False, default=None),
        FieldSpec('copy_ready_date', 'date', required=False, default=None),
        FieldSpec('petitioner_role', 'string', required=False, default='Petitioner'),
        FieldSpec('case_ref', 'string', required=False, default=''),
        FieldSpec('delay_narrative', 'string', required=False, default=''),
        FieldSpec('supporting_documents', 'string', required=False, default=''),
    ),
    slots=('delay_narrative',),
)
register(ADAPTER)
