"""Every s.138-notice refusal must carry a complete, stable Refusal (Phase 1).

Nothing routes until every refusal has a code + severity + fields_implicated +
(where the engine computes one) a computation. This pins that for the lead
document end to end, including the refusals delegated to s138_windows.
"""

from datetime import date

import pytest

from src.pipelines import s138_notice as n
from src.pipelines.s138_notice import Cheque
from src.verify.refusals import Refusal, Severity


def _cheque(number="452118", d=date(2024, 1, 1), amount=100000):
    return Cheque(number=number, date=d, amount=amount, bank="IOB",
                  branch="Town Hall", drawer="Murugan", payee="Lakshmi")


def _base(**over):
    kw = dict(
        client="Lakshmi", advocate="Sundaravadivel", advocate_enrolment="MS/1/11",
        recipient_name="Murugan", recipient_address="addr",
        cheques=[_cheque()], debt_nature="hand loan", debt_documents=["pronote"],
        presentation_date=date(2024, 1, 10), presentation_bank="CUB",
        memo_date=date(2024, 1, 12), memo_received_date=date(2024, 1, 15),
        dishonour_reason="Funds insufficient", notice_date=date(2024, 1, 20),
        dispatch_mode="RPAD", dispatch_tracking_placeholder="{{ track }}",
        place="Coimbatore",
    )
    kw.update(over)
    return kw


# (label, mutation, expected code) — one per s.138 refusal path.
CASES = [
    ("no cheques", {"cheques": []},
     "s138_notice_no_cheque_particulars"),
    ("memo receipt missing", {"memo_received_date": None},
     "s138_notice_memo_receipt_date_missing"),
    ("dishonour reason blank", {"dishonour_reason": "  "},
     "s138_notice_dishonour_reason_missing"),
    ("dispatch proof blank", {"dispatch_tracking_placeholder": "  "},
     "s138_notice_dispatch_proof_missing"),
    ("compliance != 15", {"compliance_days": 20},
     "s138_notice_compliance_period_not_15_days"),
    ("override demand mismatch", {"override_demand_amount": 999},
     "s138_notice_override_demand_not_equal_cheque_total"),
    ("presented after validity", {"presentation_date": date(2024, 6, 1)},
     "s138_notice_cheque_presented_after_validity"),
    ("out of 30-day window", {"notice_date": date(2024, 4, 1)},
     "s138_notice_out_of_30_day_window"),
]


@pytest.mark.parametrize("label,mutation,code", CASES)
def test_each_refusal_has_a_complete_code(label, mutation, code):
    result = n.build(**_base(**mutation))
    assert result.refused, f"{label}: expected a refusal"
    rf = result.refusal
    assert isinstance(rf, Refusal), f"{label}: no structured Refusal attached"
    assert rf.code == code, f"{label}: code {rf.code!r} != {code!r}"
    assert rf.severity is Severity.HARD
    assert rf.pipeline == "s138_notice"
    assert rf.spec == "2.2"
    assert rf.fields, f"{label}: fields_implicated is empty"
    # reason on the result and on the refusal are the same verbatim string
    assert rf.reason == result.reason


def test_codes_are_unique_across_paths():
    seen = {}
    for label, mutation, code in [c for c in CASES if c[2]]:
        result = n.build(**_base(**mutation))
        c = result.refusal.code
        assert c not in seen, f"duplicate code {c!r} for {label} and {seen[c]}"
        seen[c] = label


def test_computation_present_where_the_engine_computes_one():
    # The window and presentation refusals carry the shown arithmetic.
    late = n.build(**_base(notice_date=date(2024, 4, 1)))
    assert late.refusal.computation and "deadline" in late.refusal.computation
    stale = n.build(**_base(presentation_date=date(2024, 6, 1)))
    assert stale.refusal.computation and "valid_to" in stale.refusal.computation


def test_wire_shape_serialises():
    rf = n.build(**_base(cheques=[])).refusal
    d = rf.to_dict()
    assert d["code"] == "s138_notice_no_cheque_particulars"
    assert d["severity"] == "hard"
    assert d["pipeline"] == "s138_notice"
    assert d["fields_implicated"] == ["cheques"]
    assert set(d) == {"code", "severity", "reason", "computation", "pipeline",
                      "spec", "fields_implicated", "remedy_hint"}
