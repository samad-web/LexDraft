"""Adapter for the Rent Court eviction petition (TN Act 42 of 2017, s.21(2)).

`grounds` is a list of ground keys (see the pipeline's GROUNDS); an unknown key
is a coded refusal from the pipeline that names the allowed keys."""
from __future__ import annotations
from ...pipelines import hrcp_eviction as pipeline
from . import Adapter, FieldSpec, register

ADAPTER = Adapter(
    doc_type='hrcp_eviction', spec='tn-rrrlt-21',
    title='Eviction petition before the Rent Court (TN Act 42 of 2017, s.21)',
    build=pipeline.build,
    template='hrcp_eviction.docx',
    fields=(
        FieldSpec('landlord_names', 'string_list'),
        FieldSpec('tenant_names', 'string_list'),
        FieldSpec('premises_description', 'string'),
        FieldSpec('monthly_rent', 'int'),
        FieldSpec('grounds', 'string_list'),
        FieldSpec('filing_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('tenancy_commencement', 'date', required=False, default=None),
        FieldSpec('purpose_of_letting', 'string', required=False, default=''),
        FieldSpec('written_tenancy_agreement', 'bool', required=False, default=False),
        FieldSpec('arrears_months', 'int', required=False, default=0),
        FieldSpec('arrears_amount', 'int', required=False, default=0),
        FieldSpec('demand_notice_served_date', 'date', required=False, default=None),
        FieldSpec('misuse_notice_date', 'date', required=False, default=None),
        FieldSpec('tenant_quit_notice_date', 'date', required=False, default=None),
        FieldSpec('rent_court', 'string', required=False, default='THE RENT COURT'),
        FieldSpec('court_place', 'string', required=False, default=''),
        FieldSpec('facts_narrative', 'string', required=False, default=''),
    ),
    slots=('facts_narrative',),
)
register(ADAPTER)
