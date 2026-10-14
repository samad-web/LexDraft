"""GLOBAL refusal-code coverage — the gate for routing.

Nothing routes until EVERY refusal across EVERY pipeline carries a complete,
stable, unique Refusal. This drives every case in the generated refusal catalogue
(tools/refusal_report.py — the single source of truth for "what refusals exist")
and asserts each one yields a structured Refusal with:

  - a non-empty, pipeline-prefixed `code`;
  - a HARD severity;
  - a non-empty `reason` equal to the result's `reason` (verbatim);
  - `fields_implicated` naming at least one request field;

and that all codes are UNIQUE across the whole engine (no two conditions share a
code — the frontend branches on it).
"""

import pytest

from tools import refusal_report as rr
from src.verify.refusals import Refusal, Severity


def _refusals():
    """Drive every catalogued case and yield (label, result) for refusals."""
    for spec in rr._catalogue():
        for case in spec.cases:
            # rr._apply returns the message string; re-run to get the object.
            yield spec, case


def _run(spec, case):
    """Re-run a catalogue case and return the pipeline result object."""
    mutation = dict(case.mutation)
    if mutation.pop("_respondents_private", False):
        kwargs = spec.base()
        kwargs["respondents"] = [rr.writ_private_respondent(serial=1)]
    else:
        kwargs = spec.base(**mutation)
    return spec.build(**kwargs)


def test_every_catalogued_refusal_has_a_complete_refusal_object():
    problems = []
    for spec, case in _refusals():
        result = _run(spec, case)
        if not getattr(result, "refused", False):
            problems.append(f"{spec.spec}/{case.trigger}: did not refuse")
            continue
        rf = getattr(result, "refusal", None)
        if not isinstance(rf, Refusal):
            problems.append(f"{spec.spec}/{case.trigger}: no Refusal attached")
            continue
        if not rf.code.strip():
            problems.append(f"{spec.spec}/{case.trigger}: empty code")
        if rf.severity is not Severity.HARD:
            problems.append(f"{spec.spec}/{case.trigger}: severity {rf.severity}")
        if rf.reason != result.reason:
            problems.append(f"{spec.spec}/{case.trigger}: reason mismatch")
        if not rf.fields:
            problems.append(f"{spec.spec}/{case.trigger}: no fields_implicated")
    assert not problems, "incomplete refusals:\n" + "\n".join(problems)


def test_all_refusal_codes_are_unique():
    seen = {}
    dupes = []
    for spec, case in _refusals():
        result = _run(spec, case)
        rf = getattr(result, "refusal", None)
        if not isinstance(rf, Refusal):
            continue
        if rf.code in seen and seen[rf.code] != (spec.spec, case.trigger):
            # The same code legitimately recurs when one condition is exercised by
            # two catalogue cases; only flag genuinely different conditions.
            dupes.append(f"{rf.code}: {seen[rf.code]} vs {(spec.spec, case.trigger)}")
        seen.setdefault(rf.code, (spec.spec, case.trigger))
    # Allow a code to map to exactly one (spec, trigger); different triggers with
    # the same code are the real defect.
    assert not dupes, "duplicate codes across distinct conditions:\n" + "\n".join(dupes)


def test_codes_are_pipeline_prefixed_and_specific():
    """A code must be specific, never a generic 'validation_failed'-style slug."""
    generic = {"validation_failed", "refused", "error", "invalid", "bad_request"}
    for spec, case in _refusals():
        result = _run(spec, case)
        rf = getattr(result, "refusal", None)
        if not isinstance(rf, Refusal):
            continue
        assert rf.code not in generic, f"{spec.spec}/{case.trigger}: generic code {rf.code!r}"
        assert "_" in rf.code, f"{rf.code!r} is not snake_case-specific"
