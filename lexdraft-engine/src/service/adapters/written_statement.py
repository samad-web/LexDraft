"""Adapter for the written statement (DPC book pp.27-29)."""

from __future__ import annotations

from typing import Any, Dict

from ...pipelines import written_statement as pipeline
from ...pipelines.written_statement import (MeritReply, PreliminaryObjection,
                                            Stance)
from . import Adapter, FieldSpec, ListFieldSpec, register
from ..blank import _INT_SENTINEL


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


def _build(**kw: Any):
    """Service path: a plaint paragraph the advocate did not answer is pleaded
    "not admitted" (strict proof) instead of being deemed admitted (O.VIII R.5),
    and an unknown paragraph count is the highest paragraph answered."""
    replies = list(kw["merit_replies"])
    n = kw["plaint_para_count"] or 0
    if n <= 0 and replies:
        n = max(r.plaint_para for r in replies)
    if n == _INT_SENTINEL:  # a blank form, not a real pleading: nothing to fill
        return pipeline.build(**kw)
    have = {r.plaint_para for r in replies}
    replies += [MeritReply(plaint_para=i, stance=Stance.NOT_ADMITTED, text=(
        f"The averments in paragraph {i} of the plaint are not admitted, save as "
        "expressly admitted herein, and the plaintiff is put to strict proof of the same."))
        for i in range(1, n + 1) if i not in have]
    replies.sort(key=lambda r: r.plaint_para)
    return pipeline.build(**{**kw, "plaint_para_count": n, "merit_replies": replies})


ADAPTER = Adapter(
    doc_type="written_statement", spec="dpc-27-29",
    title="Written statement on behalf of the defendant", build=_build,
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
        # The defendant's own case beyond the para-wise traverse (r12).
        FieldSpec("additional_pleas", "string_list", required=False, default=()),
        FieldSpec("summons_served_date", "date", required=False, default=None),
        FieldSpec("plaint_claims", "string", required=False, default=""),
    ),
    slots=(),
)

register(ADAPTER)
