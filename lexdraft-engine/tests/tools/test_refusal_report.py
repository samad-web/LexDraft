"""Tests for tools/refusal_report.py — the generated refusal report.

The report is only trustworthy if EVERY catalogued case genuinely drives its
pipeline into a refusal (and captures a real message), never a raised exception
from a stale kwarg or a case that silently stopped refusing.
"""

import pytest

from tools import refusal_report as rr


def test_every_case_refuses_with_a_real_message():
    for spec in rr._catalogue():
        for case in spec.cases:
            message = rr._apply(spec, case)
            assert message, f"{spec.spec}/{case.trigger}: empty message"
            assert not message.startswith((
                "(did NOT refuse", "(no message")), (
                f"{spec.spec}/{case.trigger}: {message}")
            # A raised exception leaks as 'SomeError: ...'; the report should
            # capture pipeline refusal messages, not accidental crashes.
            assert "Error:" not in message.split(" ", 1)[0], (
                f"{spec.spec}/{case.trigger} raised instead of refusing: {message}")


def test_report_covers_every_document_and_has_no_error_markers():
    text = rr.build_report()
    assert text.startswith("# Section C — Refusal Conditions")
    specs = rr._catalogue()
    for spec in specs:
        assert f"## {spec.spec} — {spec.title}" in text
    # No accidental crash leaked into the generated document.
    for marker in ("Traceback", "did NOT refuse", "no message captured"):
        assert marker not in text


def test_report_is_deterministic():
    assert rr.build_report() == rr.build_report()
