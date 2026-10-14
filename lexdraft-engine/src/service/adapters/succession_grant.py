"""Adapter for the probate / letters-of-administration petition (DPC pp.50-55)."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import succession_grant as pipeline
from ...pipelines.succession_grant import GrantKind, Relative
from . import Adapter, FieldSpec, ListFieldSpec, register


_RELATIVE_ITEM = (
    FieldSpec("relation", "string"),
    FieldSpec("name", "string"),
    FieldSpec("address", "string"),
)


def _relative(kw: Dict[str, Any]) -> Relative:
    return Relative(**kw)


ADAPTER = Adapter(
    doc_type="succession_grant", spec="dpc-50-55",
    title="Petition for probate / letters of administration",
    build=pipeline.build, template="succession_grant.docx",
    fields=(
        FieldSpec("grant_kind", "enum",
                  enum_values=tuple(g.value for g in GrantKind), to_engine=GrantKind),
        FieldSpec("petitioner_name", "string"),
        FieldSpec("deceased_name", "string"),
        FieldSpec("death_date", "date"),
        FieldSpec("deceased_last_residence", "string"),
        FieldSpec("will_date", "date"),
        FieldSpec("will_duly_executed", "bool"),
        FieldSpec("bequest_narrative", "string", required=False, default=""),
        ListFieldSpec("relatives", _RELATIVE_ITEM, _relative, min_items=1),
        FieldSpec("petitioner_is_named_executor", "bool"),
        FieldSpec("petitioner_standing", "string", required=False, default=""),
        FieldSpec("assets_schedule_ref", "string"),
        FieldSpec("undertakes_further_court_fee", "bool"),
        FieldSpec("no_impediment", "bool"),
        FieldSpec("jurisdiction_basis", "string"),
        FieldSpec("filing_date", "date"),
        FieldSpec("place", "string"),
        FieldSpec("petitioner_parentage", "string", required=False, default=None),
        FieldSpec("petitioner_address", "string", required=False, default=None),
        FieldSpec("grant_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
    ),
    slots=("bequest_narrative",),
)

register(ADAPTER)
