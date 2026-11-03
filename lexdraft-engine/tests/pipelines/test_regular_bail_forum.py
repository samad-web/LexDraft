"""Regular bail cites the provision for its forum: s.480 BNSS before a Magistrate,
s.483 BNSS before the Sessions Court / High Court."""

from datetime import date

import pytest

from src.pipelines import regular_bail as rb


def _build(**over):
    args = dict(
        accused_name="Arun Prasad", age=29, occupation="mechanic",
        address="3 Lake View Road, Chennai 600020",
        fir_no="55/2024", police_station="Adyar", district="Chennai",
        sections=["BNS s.115"],
        offence_date=date(2024, 8, 1), proceeding_start_date=date(2024, 8, 5),
        is_fresh_action=False,
        custody_since=date(2024, 8, 10), as_on=date(2024, 9, 10),
        prison="Puzhal Central Prison", chargesheet_filed=True,
        special_statute=None, bail_bar_addressed=False,
        is_successive=False, prior_order_ref=None, change_of_circumstance=None,
        parity_claims=[], court_level="sessions", prosecution_case="", grounds="",
        place="Chennai",
    )
    args.update(over)
    result = rb.build(**args)
    assert result.refused is False
    return result.context


@pytest.mark.parametrize("bail_court, court_level, expected", [
    ("Judicial Magistrate No. I, Avadi", "magistrate", "Section 480 BNSS"),
    ("Metropolitan Magistrate, Egmore", "", "Section 480 BNSS"),
    (None, "Principal Sessions Judge, Tiruvallur", "Section 483 BNSS"),
    (None, "sessions", "Section 483 BNSS"),
    ("High Court of Madras", "high_court", "Section 483 BNSS"),
])
def test_bail_section_follows_forum(bail_court, court_level, expected):
    ctx = _build(bail_court=bail_court, court_level=court_level)
    assert ctx["regular_bail_section"] == expected


def test_named_court_level_becomes_the_cause_title():
    ctx = _build(bail_court=None, court_level="Principal Sessions Judge, Tiruvallur")
    assert ctx["bail_court"] == "Principal Sessions Judge, Tiruvallur"
