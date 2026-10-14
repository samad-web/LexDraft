"""STEP 4: an s.138 affidavit runs the SAME notice-time window hard stops the
s.138 notice runs (src/pipelines/s138_notice.py:168-195), delegated to
src.rules.s138_windows. Presentation validity per cheque against the set-wide
presentation_date; the 30-day notice window from memo receipt; demand == the
consolidated cheque total. A non-s138 affidavit runs none of it.
"""

from src.service import adapters


A = adapters.get_adapter("affidavit")


def _base(**over):
    """A valid s.138 affidavit payload (all windows in time)."""
    payload = {
        "matter_type": "s138",
        "affidavit_kind": "s145_proof",
        "deponent_name": "S. Karthik",
        "age": 45,
        "parentage_type": "S/o",
        "parentage_name": "Subramaniam",
        "occupation": "business",
        "address": "22, Mint Street, Chennai",
        "role": "power agent of the complainant",
        "proceeding": "C.C. No. 512 of 2026 under s.138 NI Act",
        "place": "Chennai",
        "attestor": "Notary Public, Chennai",
        "body_paras": ["The accused issued the cheque in discharge of a debt."],
        "prayer": "take this proof affidavit on record",
        "cheques": [{
            "number": "452118", "date": "2026-04-16", "amount": 399088,
            "bank": "IOB", "branch": "Town Hall", "drawer": "Murugan",
            "payee": "Lakshmi",
        }],
        "presentation_date": "2026-04-20",
        "presentation_bank": "CUB",
        "memo_date": "2026-04-22",
        "memo_received_date": "2026-04-24",
        "dishonour_reason": "Funds insufficient",
        "notice_date": "2026-05-02",
    }
    payload.update(over)
    return payload


def _build(payload):
    return A.build(**A.coerce(payload))


# ---- presentation validity (per cheque) ----------------------------------

def test_s138_cheque_presented_within_validity_no_refusal():
    res = _build(_base())
    assert not res.refused, getattr(res, "reason", "")


def test_s138_cheque_presented_after_validity_refuses_and_names_cheque():
    # Cheque dated 2026-01-01; presented 2026-05-10 (> 3 months) -> beyond validity.
    res = _build(_base(
        cheques=[{"number": "999001", "date": "2026-01-01", "amount": 399088,
                  "bank": "IOB", "branch": "Town Hall", "drawer": "Murugan",
                  "payee": "Lakshmi"}],
        presentation_date="2026-05-10",
        memo_date="2026-05-12", memo_received_date="2026-05-14",
        notice_date="2026-05-20",
    ))
    assert res.refused
    assert res.refusal.code == "s138_affidavit_cheque_presented_after_validity"
    assert "999001" in res.reason  # names the offending cheque
    assert "cheque_dates" in res.refusal.fields


def test_s138_second_cheque_after_validity_names_the_SECOND_cheque():
    # First cheque valid; SECOND presented beyond its own validity. The refusal must
    # name the second, not the first.
    res = _build(_base(
        cheques=[
            {"number": "AAA111", "date": "2026-04-16", "amount": 100000,
             "bank": "IOB", "branch": "TH", "drawer": "M", "payee": "L"},
            {"number": "BBB222", "date": "2026-01-01", "amount": 299088,
             "bank": "IOB", "branch": "TH", "drawer": "M", "payee": "L"},
        ],
        presentation_date="2026-04-20",  # valid for AAA111 (Apr 16 +3m), NOT for BBB222 (Jan 1 +3m = Apr 1)
    ))
    assert res.refused
    assert "BBB222" in res.reason
    assert "AAA111" not in res.reason


# ---- 30-day notice window + demand ---------------------------------------

def test_s138_notice_beyond_30_day_window_refuses():
    # memo received 2026-04-24; notice 2026-06-10 (> 30 days) -> out of window.
    res = _build(_base(notice_date="2026-06-10"))
    assert res.refused
    assert res.refusal.code == "s138_notice_out_of_30_day_window"


def test_s138_demand_is_the_consolidated_cheque_total():
    # The affidavit has NO separate demand field: demand == sum(cheque amounts), passed
    # to check_notice as BOTH cheque_amount and demand_amount, so the notice's
    # demand==amount rule can never fire from the affidavit side (unreachable by
    # construction — see STEP 4 report). This asserts the SUM path is what runs: two
    # in-time cheques totalling a valid demand -> no refusal.
    res = _build(_base(cheques=[
        {"number": "C1", "date": "2026-04-16", "amount": 200000,
         "bank": "IOB", "branch": "TH", "drawer": "M", "payee": "L"},
        {"number": "C2", "date": "2026-04-16", "amount": 199088,
         "bank": "IOB", "branch": "TH", "drawer": "M", "payee": "L"},
    ]))
    assert not res.refused, getattr(res, "reason", "")


# ---- non-s138: nothing runs ----------------------------------------------

def test_non_s138_affidavit_no_cheque_data_unchanged():
    # matter_type "other", no cheque fields -> the s.138 block never runs.
    payload = {
        "matter_type": "other",
        "affidavit_kind": "supporting",
        "deponent_name": "Ramesh",
        "age": 42,
        "parentage_type": "S/o",
        "parentage_name": "Suresh",
        "occupation": "business",
        "address": "12 Anna Salai, Chennai",
        "role": "deponent",
        "proceeding": "the above suit",
        "place": "Chennai",
        "attestor": "Notary Public, Chennai",
        "body_paras": ["That the facts are true."],
        "prayer": "take the affidavit on record",
    }
    res = A.build(**A.coerce(payload))
    assert not res.refused
