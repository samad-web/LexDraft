"""Adapter for the quash petition (s.528 BNSS / s.482 CrPC)."""
from __future__ import annotations
from ...pipelines import quash_petition as pipeline
from ...pipelines.quash_petition import QuashBasis, QuashTarget
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='quash_petition', spec='bnss-528',
    title='Quash petition u/s 528 BNSS (s.482 CrPC)', build=pipeline.build,
    template='quash_petition.docx',
    fields=(
        FieldSpec('petitioner_names', 'string_list'),
        FieldSpec('respondent_names', 'string_list'),
        FieldSpec('target', 'enum', enum_values=tuple(t.value for t in QuashTarget),
                  to_engine=QuashTarget),
        FieldSpec('proceeding_ref', 'string'),
        FieldSpec('proceeding_forum', 'string'),
        FieldSpec('sections', 'string_list'),
        FieldSpec('offence_date', 'date', required=False, default=None),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('quash_basis', 'enum', enum_values=tuple(b.value for b in QuashBasis),
                  to_engine=QuashBasis, required=False, default=QuashBasis.MERITS),
        FieldSpec('is_fresh_action', 'bool', required=False, default=True),
        FieldSpec('proceeding_start_date', 'date', required=False, default=None),
        FieldSpec('de_facto_complainant_is_respondent', 'bool', required=False, default=False),
        FieldSpec('compromise_memo_annexed', 'bool', required=False, default=False),
        FieldSpec('prior_revision_dismissed', 'bool', required=False, default=False),
        FieldSpec('special_circumstances', 'string', required=False, default=None),
        FieldSpec('stay_sought', 'bool', required=False, default=True),
        FieldSpec('high_court', 'string', required=False,
                  default='THE HIGH COURT OF JUDICATURE AT MADRAS'),
        FieldSpec('bench', 'string', required=False, default=None),
        FieldSpec('facts_narrative', 'string', required=False, default=''),
        FieldSpec('grounds_narrative', 'string', required=False, default=''),
        FieldSpec('grounds_list', 'string_list', required=False, default=None),
        FieldSpec('police_station', 'string', required=False, default=None),
        FieldSpec('crime_no', 'string', required=False, default=None),
    ),
    slots=('facts_narrative', 'grounds_narrative'),
)
register(ADAPTER)
