"""Adapter for the default bail application (spec 3.4).

The engine's `offence` is a structured descriptor (max punishment / death / life),
and `special_statute` is a custody-computation enum; `application_ts` and
`chargesheet_filed_ts` are datetimes (the sequence hard-stop turns on them). A thin
build wrapper assembles the Offence and coerces the datetime/enum inputs so the
inbound contract stays flat.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from ...pipelines import default_bail as pipeline
from ...rules import custody_computation as cc
from . import Adapter, AdapterValidationError, FieldIssue, FieldSpec, register


def _dt(v: Optional[str], key: str) -> Optional[datetime]:
    if v is None or v == "":
        return None
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        raise AdapterValidationError(
            [FieldIssue(key, "malformed", f"'{v}' is not an ISO datetime")])


def _build(**kw: Any):
    kw["offence"] = cc.Offence(
        max_punishment_years=kw.pop("offence_max_punishment_years"),
        punishable_with_death=kw.pop("offence_punishable_with_death", False),
        punishable_with_life=kw.pop("offence_punishable_with_life", False),
    )
    ss = kw.pop("special_statute", None)
    kw["special_statute"] = cc.SpecialStatute(ss) if ss else None
    kw["application_ts"] = _dt(kw.pop("application_ts", None), "application_ts")
    kw["chargesheet_filed_ts"] = _dt(
        kw.pop("chargesheet_filed_ts", None), "chargesheet_filed_ts")
    return pipeline.build(**kw)


ADAPTER = Adapter(
    doc_type="default_bail", spec="3.4",
    title="Application for default bail (s.167(2))", build=_build,
    template="default_bail.docx",
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
        FieldSpec("first_remand_date", "date"),
        FieldSpec("offence_max_punishment_years", "int"),
        FieldSpec("offence_punishable_with_death", "bool", required=False, default=False),
        FieldSpec("offence_punishable_with_life", "bool", required=False, default=False),
        FieldSpec("special_statute", "enum",
                  enum_values=tuple(s.value for s in cc.SpecialStatute),
                  required=False, default=None),
        FieldSpec("as_on", "date"),
        # datetimes handled in the build wrapper (kept as strings in the contract).
        FieldSpec("application_ts", "string", required=False, default=None),
        FieldSpec("chargesheet_filed_ts", "string", required=False, default=None),
        FieldSpec("readiness_to_furnish_bail", "bool"),
        FieldSpec("place", "string"),
        FieldSpec("accused_parentage", "string", required=False, default=None),
        FieldSpec("bail_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
        FieldSpec("application_date", "date", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
