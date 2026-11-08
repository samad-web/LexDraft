"""Adapter for the civil revision petition (s.115 CPC / Art.227)."""
from __future__ import annotations
from ...pipelines import civil_revision as pipeline
from ...pipelines.civil_revision import RevisionBasis
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='civil_revision', spec='cpc-115-art227',
    title='Civil revision petition (s.115 CPC / Art.227)', build=pipeline.build,
    template='civil_revision.docx',
    fields=(
        # optional: inferred from order_would_finally_dispose when absent
        FieldSpec('basis', 'enum', enum_values=tuple(b.value for b in RevisionBasis),
                  to_engine=RevisionBasis, required=False, default=None),
        FieldSpec('petitioner_names', 'string_list'),
        FieldSpec('respondent_names', 'string_list'),
        FieldSpec('impugned_order_ref', 'string'),
        FieldSpec('impugned_order_date', 'date'),
        FieldSpec('lower_court', 'string'),
        FieldSpec('proceeding_ref', 'string'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('appeal_lies', 'bool', required=False, default=False),
        FieldSpec('order_would_finally_dispose', 'bool', required=False, default=False),
        FieldSpec('copy_applied_date', 'date', required=False, default=None),
        FieldSpec('copy_ready_date', 'date', required=False, default=None),
        FieldSpec('condone_delay_petition_filed', 'bool', required=False, default=False),
        FieldSpec('delay_explanation', 'string', required=False, default=None),
        FieldSpec('crp_category', 'string', required=False, default=''),
        FieldSpec('court_name', 'string', required=False,
                  default='THE HIGH COURT OF JUDICATURE AT MADRAS'),
        FieldSpec('facts_narrative', 'string', required=False, default=''),
        FieldSpec('grounds_narrative', 'string', required=False, default=''),
        FieldSpec('grounds_list', 'string_list', required=False, default=None),
        # the brief asks to stay the trial pending the revision -> interim prayer
        FieldSpec('stay_of_proceedings_sought', 'bool', required=False, default=False),
        # what follows "set aside the order" ("allow I.A. No. 610 of 2026 and refer ... to an expert")
        FieldSpec('consequential_relief', 'string', required=False, default=None),
    ),
    slots=('facts_narrative', 'grounds_narrative'),
)
register(ADAPTER)
