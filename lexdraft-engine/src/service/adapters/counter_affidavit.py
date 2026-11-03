"""Adapter for the counter affidavit (para-wise reply in a writ / IA)."""
from __future__ import annotations

from typing import Any, Dict

from ...pipelines import counter_affidavit as pipeline
from ...pipelines.counter_affidavit import ParaReply, Stance
from . import Adapter, FieldSpec, ListFieldSpec, register

_REPLY_ITEM = (
    FieldSpec('para', 'int'),
    FieldSpec('stance', 'enum', enum_values=tuple(s.value for s in Stance)),
    FieldSpec('text', 'string', required=False, default=''),
)


def _reply(kw: Dict[str, Any]) -> ParaReply:
    kw = dict(kw)
    kw['stance'] = Stance(kw['stance'])
    kw['text'] = kw.get('text') or ''
    return ParaReply(**kw)


ADAPTER = Adapter(
    doc_type='counter_affidavit', spec='mhc-counter',
    title='Counter affidavit (para-wise reply)', build=pipeline.build,
    template='counter_affidavit.docx',
    fields=(
        FieldSpec('petition_ref', 'string'),
        FieldSpec('petitioner_names', 'string_list'),
        FieldSpec('respondent_names', 'string_list'),
        FieldSpec('answering_respondent_serial', 'int'),
        FieldSpec('deponent_name', 'string'),
        FieldSpec('deponent_description', 'string'),
        FieldSpec('petition_para_count', 'int'),
        ListFieldSpec('para_replies', _REPLY_ITEM, _reply, min_items=1),
        FieldSpec('affirm_date', 'date'),
        FieldSpec('place', 'string'),
        FieldSpec('deponent_designation', 'string', required=False, default=''),
        FieldSpec('preliminary_objections', 'string_list', required=False, default=()),
        FieldSpec('main_case_ref', 'string', required=False, default=''),
        FieldSpec('court_name', 'string', required=False,
                  default='THE HIGH COURT OF JUDICATURE AT MADRAS'),
        FieldSpec('jurisdiction_line', 'string', required=False, default=''),
        FieldSpec('prayer_text', 'string', required=False, default=''),
    ),
    slots=(),
)
register(ADAPTER)
