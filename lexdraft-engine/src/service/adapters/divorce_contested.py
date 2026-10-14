"""Adapter for the contested divorce petition (spec 6.1, HMA s.13)."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import divorce_contested as pipeline
from ...pipelines.divorce_contested import DatedInstance, Ground, Section19Basis
from . import Adapter, FieldSpec, ListFieldSpec, register


_INSTANCE_ITEM = (
    FieldSpec("date", "date"),
    FieldSpec("description", "string"),
)


def _instance(kw: Dict[str, Any]) -> DatedInstance:
    return DatedInstance(**kw)


ADAPTER = Adapter(
    doc_type="divorce_contested", spec="6.1",
    title="Petition for divorce (contested, s.13 HMA)", build=pipeline.build,
    template="divorce_contested.docx",
    fields=(
        FieldSpec("petitioner_name", "string"),
        FieldSpec("respondent_name", "string"),
        FieldSpec("marriage_date", "date"),
        FieldSpec("marriage_place", "string"),
        FieldSpec("filing_date", "date"),
        FieldSpec("ground", "enum",
                  enum_values=tuple(g.value for g in Ground), to_engine=Ground),
        ListFieldSpec("cruelty_instances", _INSTANCE_ITEM, _instance, required=False),
        FieldSpec("separation_since", "date", required=False, default=None),
        FieldSpec("animus_deserendi", "bool", required=False, default=None),
        FieldSpec("without_consent", "bool", required=False, default=None),
        FieldSpec("without_reasonable_cause", "bool", required=False, default=None),
        FieldSpec("adultery_instance", "string", required=False, default=None),
        FieldSpec("co_respondent_joined", "bool", required=False, default=None),
        FieldSpec("non_joinder_reason", "string", required=False, default=None),
        FieldSpec("no_collusion", "bool"),
        FieldSpec("no_connivance", "bool"),
        FieldSpec("no_condonation", "bool"),
        FieldSpec("children", "string_list", required=False, default=[]),
        FieldSpec("custody_position", "string", required=False, default=None),
        FieldSpec("maintenance_position", "string", required=False, default=None),
        FieldSpec("jurisdiction_basis", "enum",
                  enum_values=tuple(b.value for b in Section19Basis),
                  to_engine=Section19Basis),
        FieldSpec("place", "string"),
        FieldSpec("grounds_narrative", "string", required=False, default=""),
        FieldSpec("family_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
    ),
    slots=("grounds_narrative",),
)

register(ADAPTER)
