"""The s.138 shadow-mode harness must surface the engine-vs-TS divergences."""

from tools import shadow_s138 as sh


def _fields(cheque_date="2024-11-04"):
    return {
        "client": "L", "advocate": "S", "advocate_enrolment": "E",
        "recipient_name": "M", "recipient_address": "addr",
        "cheques": [{"number": "1", "date": cheque_date, "amount": 450000,
                     "bank": "IOB", "branch": "TH", "drawer": "M", "payee": "L"}],
        "debt_nature": "loan", "presentation_date": "2024-11-08",
        "presentation_bank": "CUB", "memo_date": "2024-11-11",
        "memo_received_date": "2024-11-13", "dishonour_reason": "FI",
        "notice_date": "2024-11-25", "dispatch_mode": "RPAD",
        "dispatch_tracking_placeholder": "{{t}}", "place": "Cbe",
    }


def test_engine_refusal_vs_ts_draft_is_flagged_as_engine_win():
    pair = {"matter_id": "M1", "version": 1,
            "fields": _fields(cheque_date="2024-05-04"),   # presented after validity
            "ts": {"blocked": False}}
    out = sh.run_pair(pair)
    assert out["engine"]["status"] == "refused"
    assert any("ENGINE_REFUSES_TS_DRAFTS" in f for f in out["findings"])


def test_both_generate_is_flagged_for_citation_comparison():
    pair = {"matter_id": "M2", "version": 1, "fields": _fields(),
            "ts": {"blocked": False}}
    out = sh.run_pair(pair)
    assert out["engine"]["status"] == "generated"
    assert any("BOTH_GENERATE" in f for f in out["findings"])


def test_old_law_refs_in_ts_are_flagged():
    pair = {"matter_id": "M3", "version": 1, "fields": _fields(),
            "ts": {"blocked": False, "verify": {"old_law_references": ["Section 439 CrPC"]}}}
    out = sh.run_pair(pair)
    assert any("TS_OLD_LAW_REFS" in f for f in out["findings"])


def test_missing_ts_baseline_is_noted_not_crashed():
    pair = {"matter_id": "M4", "version": 1, "fields": _fields(), "ts": None}
    out = sh.run_pair(pair)
    assert any("NO_TS_BASELINE" in f for f in out["findings"])
