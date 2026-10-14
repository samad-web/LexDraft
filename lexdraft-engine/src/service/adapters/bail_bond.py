"""Adapter for the bail bond u/ss.389, 437, 438, 439 & 441 CrPC (from the pipeline signature)."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import bail_bond as pipeline
from ...pipelines.bail_bond import Surety
from . import Adapter, FieldSpec, ListFieldSpec, register


_SURETY_ITEM = (
    FieldSpec("name", "string"),
    FieldSpec("address", "string", required=False, default=None),
    FieldSpec("forfeiture_sum", "string", required=False, default=None),
)


def _surety(kw: Dict[str, Any]) -> Surety:
    return Surety(**kw)


ADAPTER = Adapter(
    doc_type="bail_bond", spec="tn-bailbond",
    title="Bail Bond",
    build=pipeline.build, template="bail_bond.docx",
    fields=(
        FieldSpec("accused_name", "string"),
        FieldSpec("offence_section", "string"),
        FieldSpec("bail_granted", "bool"),
        FieldSpec("bail_order_court", "string"),
        FieldSpec("bail_order_date", "date"),
        FieldSpec("forfeiture_sum", "string"),
        ListFieldSpec("sureties", _SURETY_ITEM, _surety, min_items=1),
        FieldSpec("case_ref", "string"),
        FieldSpec("place", "string"),
        FieldSpec("complainant_name", "string", required=False, default=None),
        FieldSpec("committing_magistrate", "string", required=False, default=None),
        FieldSpec("attend_date", "date", required=False, default=None),
        FieldSpec("prison_superintendent", "string", required=False, default=None),
        FieldSpec("bond_date", "date", required=False, default=None),
        FieldSpec("court_place", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
