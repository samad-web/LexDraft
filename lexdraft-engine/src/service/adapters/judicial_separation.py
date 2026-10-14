"""Adapter for Petition for judicial separation (s.10 HMA) (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines.judicial_separation import Ground
from ...pipelines import judicial_separation as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='judicial_separation', spec='dpc-42-43',
    title='Petition for judicial separation (s.10 HMA)', build=pipeline.build,
    template='judicial_separation.docx',
    fields=(
        FieldSpec('petitioner_name', 'string'),
        FieldSpec('respondent_name', 'string'),
        FieldSpec('marriage_date', 'date'),
        FieldSpec('marriage_place', 'string'),
        FieldSpec('marriage_registered', 'bool'),
        FieldSpec('ground', 'enum', enum_values=tuple(g.value for g in Ground), to_engine=Ground),
        FieldSpec('ground_narrative', 'string'),
        FieldSpec('no_condonation', 'bool'),
        FieldSpec('no_connivance', 'bool'),
        FieldSpec('no_collusion', 'bool'),
        FieldSpec('no_undue_delay', 'bool'),
        FieldSpec('last_resided_together', 'string'),
        FieldSpec('jurisdiction_basis', 'string'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('petitioner_parentage', 'string', required=False, default=None),
        FieldSpec('petitioner_address', 'string', required=False, default=None),
        FieldSpec('respondent_parentage', 'string', required=False, default=None),
        FieldSpec('respondent_address', 'string', required=False, default=None),
        FieldSpec('family_court', 'string', required=False, default=None),
        FieldSpec('city', 'string', required=False, default=None),
    ),
    slots=('ground_narrative',),
)
register(ADAPTER)
