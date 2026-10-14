"""Adapter for the written statement (DPC book pp.27-29)."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import written_statement as pipeline
from ...pipelines.written_statement import (MeritReply, PreliminaryObjection,
                                            Stance)
from . import Adapter, FieldSpec, ListFieldSpec, register


_OBJECTION_ITEM = (
    FieldSpec("text", "string"),
)


def _objection(kw: Dict[str, Any]) -> PreliminaryObjection:
    return PreliminaryObjection(**kw)


_REPLY_ITEM = (
    FieldSpec("plaint_para", "int"),
    FieldSpec("stance", "enum", enum_values=tuple(s.value for s in Stance)),
    FieldSpec("text", "string"),
)


def _reply(kw: Dict[str, Any]) -> MeritReply:
    kw = dict(kw)
    kw["stance"] = Stance(kw["stance"])
    return MeritReply(**kw)


ADAPTER = Adapter(
    doc_type="written_statement", spec="dpc-27-29",
    title="Written statement on behalf of the defendant", build=pipeline.build,
    template="written_statement.docx",
    fields=(
        FieldSpec("plaintiff_name", "string"),
        FieldSpec("defendant_name", "string"),
        FieldSpec("suit_ref", "string"),
        FieldSpec("plaint_para_count", "int"),
        ListFieldSpec("preliminary_objections", _OBJECTION_ITEM, _objection,
                      required=False),
        ListFieldSpec("merit_replies", _REPLY_ITEM, _reply, min_items=1),
        FieldSpec("filing_date", "date"),
        FieldSpec("place", "string"),
        FieldSpec("counter_claim_or_setoff", "bool", required=False, default=False),
        FieldSpec("civil_court", "string", required=False, default=None),
        FieldSpec("city", "string", required=False, default=None),
    ),
    slots=(),
)

register(ADAPTER)
