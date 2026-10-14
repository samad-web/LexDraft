"""Adapter for Application to sue as an indigent person (generated from the pipeline signature)."""
from __future__ import annotations
from ...pipelines import indigent_application as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='indigent_application', spec='dpc-21',
    title='Application to sue as an indigent person', build=pipeline.build,
    template='indigent_application.docx',
    fields=(
        FieldSpec('applicant_name', 'string'),
        FieldSpec('respondent_name', 'string'),
        FieldSpec('suit_ref', 'string'),
        FieldSpec('indigency_pleaded', 'bool'),
        FieldSpec('indigency_particulars', 'string'),
        FieldSpec('undertakes_to_pay_if_decreed', 'bool'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('applicant_parentage', 'string', required=False, default=None),
        FieldSpec('applicant_address', 'string', required=False, default=None),
        FieldSpec('respondent_parentage', 'string', required=False, default=None),
        FieldSpec('respondent_address', 'string', required=False, default=None),
        FieldSpec('civil_court', 'string', required=False, default=None),
        FieldSpec('city', 'string', required=False, default=None),
    ),
    slots=(),
)
register(ADAPTER)
