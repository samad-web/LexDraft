"""v3 root cause: one blank or off-list choice field 422'd the draft and sent it to the
AI fallback. Contested divorce and DV must now render on the engine."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from src.pipelines.dv_application import AbuseCategory  # noqa: E402
from src.service.adapters.dv_application import _category  # noqa: E402
from tests.service.test_all_adapters_roundtrip import PAYLOADS  # noqa: E402
from tests.service.test_b3_checklists import _text  # noqa: E402

JUR = "within the local limits"
BASE = {k: v for k, v in PAYLOADS["divorce_contested"].items() if k != "jurisdiction_basis"}


def _para9(fields):
    return next(line for line in _text("divorce_contested", fields).splitlines()
                if "JURISDICTION:" in line)


@pytest.mark.parametrize("bad", [None, "", "wherever the parties live"])
def test_divorce_unreadable_basis_is_derived_from_marriage_place(bad):
    text = _para9({**BASE, "jurisdiction_basis": bad})
    assert "The marriage was solemnised at Chennai" in text and JUR in text


def test_divorce_derives_respondent_residence_when_marriage_elsewhere():
    text = _para9({**BASE, "marriage_place": "Madurai", "respondent_address": "4, Mount Road, Chennai"})
    assert "The respondent resides at 4, Mount Road, Chennai" in text


def test_divorce_nothing_ties_to_court_leaves_a_gap_not_a_guess():
    text = _para9({**BASE, "marriage_place": "Madurai", "petitioner_address": "Salem"})
    assert "[the fact under Section 19" in text
    assert "resides at" not in text and "solemnised at" not in text


def test_divorce_valid_basis_is_kept():
    text = _para9({**BASE, "marriage_place": "Madurai", "jurisdiction_basis": "marriage_solemnised"})
    assert "The marriage was solemnised at Madurai" in text


def test_divorce_court_name_matches_whole_word_only():
    text = _para9({**BASE, "marriage_place": "Chennaiya Nagar, Salem", "petitioner_address": "Salem"})
    assert "[the fact under Section 19" in text


@pytest.mark.parametrize("words,head", [
    ("He beat her with a belt", AbuseCategory.PHYSICAL),
    ("forced sexual relations", AbuseCategory.SEXUAL),
    ("demanded dowry of Rs. 2,00,000", AbuseCategory.ECONOMIC),
    ("wore a white saree and was abused in filthy language", AbuseCategory.VERBAL_EMOTIONAL),
])
def test_dv_blank_category_read_from_the_incident(words, head):
    assert _category(None, words) is head


def test_dv_valid_category_is_kept():
    assert _category("sexual", "He beat her") is AbuseCategory.SEXUAL


@pytest.mark.parametrize("bad", [None, "", "mental torture"])
def test_dv_application_renders_with_unreadable_category(bad):
    incident = {"category": bad, "date": "2024-01-10", "description": "He beat her with a belt"}
    assert "He beat her with a belt" in _text("dv_application", {**PAYLOADS["dv_application"], "incidents": [incident]})


@pytest.mark.parametrize("bad", [None, "", "deny"])
def test_counter_affidavit_unreadable_stance_is_not_admitted(bad):
    payload = PAYLOADS["counter_affidavit"]
    replies = [{**r, "stance": bad} for r in payload["para_replies"]]
    assert "are not admitted" in _text("counter_affidavit", {**payload, "para_replies": replies})
