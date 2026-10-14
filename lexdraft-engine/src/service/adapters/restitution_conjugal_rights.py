"""Adapter for Petition for restitution of conjugal rights (s.9 HMA) (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import restitution_conjugal_rights as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='restitution_conjugal_rights', spec='dpc-40-41',
    title='Petition for restitution of conjugal rights (s.9 HMA)', build=pipeline.build,
    template='restitution_conjugal_rights.docx',
    fields=(
        FieldSpec('petitioner_name', 'string'),
        FieldSpec('respondent_name', 'string'),
        FieldSpec('marriage_date', 'date'),
        FieldSpec('marriage_place', 'string'),
        FieldSpec('marriage_registered', 'bool'),
        FieldSpec('withdrawal_date', 'date'),
        FieldSpec('withdrawal_narrative', 'string'),
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
    slots=('withdrawal_narrative',),
)
register(ADAPTER)
