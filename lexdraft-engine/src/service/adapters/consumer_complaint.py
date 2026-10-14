"""Adapter for Consumer complaint (CPA 2019) (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines.consumer_complaint import Purpose
from ...pipelines import consumer_complaint as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='consumer_complaint', spec='7.1',
    title='Consumer complaint (CPA 2019)', build=pipeline.build,
    template='consumer_complaint.docx',
    fields=(
        FieldSpec('complainant_name', 'string'),
        FieldSpec('opposite_party_name', 'string'),
        FieldSpec('purpose', 'enum', enum_values=tuple(p.value for p in Purpose), to_engine=Purpose),
        FieldSpec('consideration_paid', 'int'),
        FieldSpec('transaction_date', 'date'),
        FieldSpec('invoice_ref', 'string'),
        FieldSpec('cause_of_action_date', 'date'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('compensation', 'int'),
        FieldSpec('compensation_basis', 'string'),
        FieldSpec('affidavit_present', 'bool'),
        FieldSpec('evidence_affidavit_present', 'bool'),
        FieldSpec('territorial_basis', 'string'),
        FieldSpec('place', 'string'),
        FieldSpec('defect_narrative', 'string', required=False, default=''),
        FieldSpec('complaints_narrative', 'string', required=False, default=''),
        FieldSpec('commission_place', 'string', required=False, default=None),
    ),
    slots=('defect_narrative', 'complaints_narrative'),
)
register(ADAPTER)
