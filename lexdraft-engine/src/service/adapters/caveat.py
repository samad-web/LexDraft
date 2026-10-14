"""Adapter for Caveat u/s 148-A CPC (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import caveat as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='caveat', spec='dpc-30',
    title='Caveat u/s 148-A CPC', build=pipeline.build,
    template='caveat.docx',
    fields=(
        FieldSpec('caveator_name', 'string'),
        FieldSpec('expected_petitioner_name', 'string'),
        FieldSpec('impugned_order_ref', 'string'),
        FieldSpec('impugned_order_date', 'date'),
        FieldSpec('lower_court', 'string'),
        FieldSpec('apprehended_proceeding', 'string'),
        FieldSpec('copy_served_on_petitioner', 'bool'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('court_name', 'string', required=False, default=None),
        FieldSpec('caveator_parentage', 'string', required=False, default=None),
        FieldSpec('caveator_address', 'string', required=False, default=None),
        FieldSpec('petitioner_parentage', 'string', required=False, default=None),
        FieldSpec('petitioner_address', 'string', required=False, default=None),
    ),
    slots=(),
)
register(ADAPTER)
