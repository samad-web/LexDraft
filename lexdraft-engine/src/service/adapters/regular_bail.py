"""Adapter for the regular bail application (spec 3.2).

`special_statute` maps an inbound enum string ('ndps'|'pmla'|'uapa'|'scst') to the
bail-bar Statute; `parity_claims` is a list of {co_accused, order_ref} dicts passed
through as plain mappings (the pipeline consumes them as Mapping).
"""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import regular_bail as pipeline
from ...rules import bail_bar_detector as bars
from . import Adapter, FieldSpec, ListFieldSpec, register


def _statute(v: str):
    return bars.Statute(v) if v else None


_PARITY_ITEM = (
    FieldSpec("co_accused", "string"),
    FieldSpec("order_ref", "string"),
)


def _parity(kw: Dict[str, Any]) -> Dict[str, Any]:
    return dict(kw)


ADAPTER = Adapter(
    doc_type="regular_bail", spec="3.2",
    title="Application for regular bail (s.437/439)", build=pipeline.build,
    template="regular_bail.docx",
    fields=(
        FieldSpec("accused_name", "string"),
        FieldSpec("age", "int"),
        FieldSpec("occupation", "string"),
        FieldSpec("address", "string"),
        FieldSpec("fir_no", "string"),
        FieldSpec("police_station", "string"),
        FieldSpec("district", "string"),
        FieldSpec("sections", "string_list"),
        FieldSpec("offence_date", "date", required=False, default=None),
        FieldSpec("proceeding_start_date", "date", required=False, default=None),
        FieldSpec("is_fresh_action", "bool", required=False, default=False),
        FieldSpec("custody_since", "date"),
        FieldSpec("as_on", "date"),
        FieldSpec("prison", "string"),
        FieldSpec("chargesheet_filed", "bool"),
        FieldSpec("special_statute", "enum",
                  enum_values=tuple(s.value for s in bars.Statute),
                  required=False, default=None, to_engine=_statute),
        FieldSpec("bail_bar_addressed", "bool", required=False, default=False),
        FieldSpec("is_successive", "bool", required=False, default=False),
        FieldSpec("prior_order_ref", "string", required=False, default=None),
        FieldSpec("change_of_circumstance", "string", required=False, default=None),
        ListFieldSpec("parity_claims", _PARITY_ITEM, _parity, required=False),
        FieldSpec("court_level", "string"),
        FieldSpec("prosecution_case", "string", required=False, default=""),
        FieldSpec("grounds", "string", required=False, default=""),
        FieldSpec("place", "string"),
        FieldSpec("accused_parentage", "string", required=False, default=None),
        FieldSpec("bail_court", "string", required=False, default=None),
        FieldSpec("application_date", "date", required=False, default=None),
    ),
    slots=("prosecution_case", "grounds"),
)

register(ADAPTER)
