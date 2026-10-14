"""Tests for src.pipelines.written_statement (DPC book pp.27-29).

The load-bearing rule is Order VIII Rule 5 CPC: every plaint paragraph not
specifically denied is DEEMED ADMITTED. So the pipeline refuses if any plaint
paragraph has no merit-reply (a silent gap concedes the allegation).
"""

from datetime import date

import pytest

from src.pipelines import written_statement as ws
from src.pipelines.written_statement import (MeritReply, PreliminaryObjection,
                                             Stance)


def _replies(n):
    return [MeritReply(i, Stance.DENIED, f"That the contents of para {i} are denied.")
            for i in range(1, n + 1)]


def _base(**over):
    kw = dict(
        plaintiff_name="X", defendant_name="Y", suit_ref="SUIT NO. 100 OF 2024",
        plaint_para_count=5,
        preliminary_objections=[
            PreliminaryObjection("That the suit is barred by limitation."),
            PreliminaryObjection("That this Court has no jurisdiction."),
        ],
        merit_replies=_replies(5),
        filing_date=date(2024, 6, 1), place="Chennai",
        civil_court="THE CIVIL JUDGE (SENIOR DIVISION)", city="Chennai",
    )
    kw.update(over)
    return kw


def test_needs_plaint_identified():
    r = ws.build(**_base(plaint_para_count=0, merit_replies=[]))
    assert r.refused and r.refusal.code == "written_statement_plaint_not_identified"


def test_o8r5_uncovered_paragraph_refuses():
    # 5 plaint paras but only replies to 1-4 -> para 5 deemed admitted -> refuse
    r = ws.build(**_base(merit_replies=_replies(4)))
    assert r.refused
    assert r.refusal.code == "written_statement_o8r5_uncovered_paragraphs"
    assert "5" in r.refusal.reason


def test_reply_out_of_range_refuses():
    replies = _replies(5) + [MeritReply(6, Stance.DENIED, "para 6 denied")]
    r = ws.build(**_base(merit_replies=replies))
    assert r.refused and r.refusal.code == "written_statement_reply_out_of_range"


def test_empty_reply_refuses():
    replies = _replies(4) + [MeritReply(5, Stance.DENIED, "   ")]
    r = ws.build(**_base(merit_replies=replies))
    assert r.refused and r.refusal.code == "written_statement_reply_empty"


def test_full_coverage_ok():
    r = ws.build(**_base())
    assert r.refused is False
    assert r.context["plaint_para_count"] == 5
    assert len(r.context["merit_replies"]) == 5


def test_mixed_stances_tracked():
    replies = [
        MeritReply(1, Stance.ADMITTED, "That the contents of para 1 are admitted."),
        MeritReply(2, Stance.DENIED, "That para 2 is denied."),
        MeritReply(3, Stance.NOT_ADMITTED, "Para 3 not admitted for want of "
                   "knowledge; strict proof demanded."),
        MeritReply(4, Stance.DENIED, "Para 4 denied."),
        MeritReply(5, Stance.DENIED, "Para 5 denied."),
    ]
    r = ws.build(**_base(merit_replies=replies))
    assert r.refused is False
    assert r.context["admitted_paras"] == [1]
    assert r.context["denied_paras"] == [2, 3, 4, 5]
