"""Adapter for Suit for ejectment and damages (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import ejectment as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='ejectment', spec='dpc-22-24',
    title='Suit for ejectment and damages', build=pipeline.build,
    template='ejectment.docx',
    fields=(
        FieldSpec('plaintiff_names', 'string_list'),
        FieldSpec('defendant_name', 'string'),
        FieldSpec('suit_premises', 'string'),
        FieldSpec('lease_ref', 'string'),
        FieldSpec('lease_expiry_date', 'date'),
        FieldSpec('s106_notice_ref', 'string'),
        FieldSpec('s106_notice_served_date', 'date'),
        FieldSpec('tenancy_end_date', 'date'),
        FieldSpec('damages_rate_per_day', 'int'),
        FieldSpec('wrongful_occupation_since', 'date', required=False, default=None),
        FieldSpec('annual_rent', 'int'),
        FieldSpec('court_fee', 'int'),
        FieldSpec('cause_of_action_date', 'date'),
        FieldSpec('cause_of_action_place', 'string'),
        FieldSpec('jurisdiction_basis', 'string'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('outside_rent_control', 'bool', required=False, default=True),
        FieldSpec('plaintiff_address', 'string', required=False, default=None),
        FieldSpec('defendant_address', 'string', required=False, default=None),
        FieldSpec('civil_court', 'string', required=False, default=None),
        FieldSpec('city', 'string', required=False, default=None),
    ),
    slots=(),
)
register(ADAPTER)
