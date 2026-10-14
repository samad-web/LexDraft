"""Adapter for Summary suit (O37 CPC) (generated from the pipeline signature)."""
from __future__ import annotations
from typing import Any, Dict
from ...pipelines.summary_suit import ClaimBasis
from ...rules import jurisdiction as jur
from ...rules.limitation import Acknowledgement
from ...pipelines import summary_suit as pipeline
from . import Adapter, FieldSpec, ListFieldSpec, register


_ACK_ITEM = (
    FieldSpec("date", "date"),
    FieldSpec("description", "string", required=False, default=""),
)


def _ack(kw: Dict[str, Any]) -> Acknowledgement:
    return Acknowledgement(**kw)


ADAPTER = Adapter(
    doc_type='summary_suit', spec='4.1',
    title='Summary suit (O37 CPC)', build=pipeline.build,
    template='summary_suit.docx',
    fields=(
        FieldSpec('plaintiff_name', 'string'),
        FieldSpec('defendant_names', 'string_list'),
        FieldSpec('claim_basis', 'enum', enum_values=tuple(c.value for c in ClaimBasis), to_engine=ClaimBasis),
        FieldSpec('instrument_ref', 'string'),
        FieldSpec('cause_of_action_date', 'date'),
        FieldSpec('cause_of_action_place', 'string'),
        FieldSpec('forum', 'enum', enum_values=tuple(f.value for f in jur.Forum), to_engine=jur.Forum),
        FieldSpec('territorial_bases', 'string_list', to_engine=lambda vs: [jur.TerritorialBasis(v) for v in vs]),
        FieldSpec('principal', 'int'),
        FieldSpec('interest_amount', 'int'),
        FieldSpec('claimed_total', 'int'),
        FieldSpec('interest_rate', 'int'),
        FieldSpec('interest_is_contractual', 'bool'),
        FieldSpec('interest_document_ref', 'string', required=False, default=None),
        FieldSpec('limitation_article', 'string'),
        FieldSpec('limitation_trigger_date', 'date'),
        ListFieldSpec('acknowledgements', _ACK_ITEM, _ack, required=False),
        FieldSpec('filing_date', 'date'),
        FieldSpec('transaction_narrative', 'string', required=False, default=''),
        FieldSpec('place', 'string'),
        FieldSpec('plaintiff_parentage', 'string', required=False, default=None),
        FieldSpec('plaintiff_address', 'string', required=False, default=None),
        FieldSpec('defendant_addresses', 'string_list', required=False, default=None),
        FieldSpec('civil_court', 'string', required=False, default=None),
        FieldSpec('city', 'string', required=False, default=None),
    ),
    slots=('transaction_narrative',),
)
register(ADAPTER)
