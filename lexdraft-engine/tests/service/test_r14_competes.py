"""r14 reviewer defects pinned on the engine render of the suite brief's facts,
through the real /v1/draft endpoint (one test per defect)."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.pipelines.condone_delay_petition import unexplained_stretches  # noqa: E402
from src.pipelines.conveyancing import payment_mode  # noqa: E402
from src.service.app import app  # noqa: E402
from tests.service.test_civil_suit_review import EJECTMENT  # noqa: E402
from tests.service.test_court_forms_quality_r12 import _AFF, _CFM  # noqa: E402
from tests.service.test_r12_civil_quality import CONDONE, HRCP, INDIGENT  # noqa: E402
from tests.service.test_succession_contempt_quality import _SC  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-R14", "version": 1}

SALE = dict(
    vendor_name="Mr. T. Rajendran", vendor_description="aged 60 years, residing at No. 4, North Street, Thanjavur",
    vendee_name="Mrs. A. Meena", vendee_description="aged 38 years, residing at No. 19, Medical College Road, Thanjavur",
    property_desc="House site of 2,400 sq.ft. in S.F. No. 145/3, Vilar village", boundary_east="lane",
    boundary_west="house of Murugan", boundary_north="road", boundary_south="land of Raman",
    total_consideration=3000000, amount_already_paid=3000000, advance_amount=500000, advance_date="2026-08-01",
    balance_paid_mode="Balance Rs. 25,00,000 paid today by DD", prior_title_recital="a settlement deed",
    to_be_registered=True, execution_date="2026-11-07", witnesses=["W1", "W2"], place="Thanjavur")


def _text(doc_type, fields, **top):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **top})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


def test_sale_deed_balance_mode_prose_becomes_its_instrument():
    text = _text("sale_deed", SALE)
    assert "paid this day by Demand Draft." in text
    assert "paid this day by Balance" not in text
    # a real mode is kept whole
    assert payment_mode("cheque No. 010806 dated 29-09-2024 drawn on Indian Bank") == \
        "cheque No. 010806 dated 29-09-2024 drawn on Indian Bank"
    assert payment_mode("Rs. 5,00,000 paid today by bank transfer") == "bank transfer"
    assert payment_mode("balance paid today") == ""


def test_call_for_memo_case_ref_names_the_case_to_call_for():
    # live extraction: own case in cc_no/cc_year, the case to call for in case_ref
    text = _text("call_for_memo", {**_CFM, "documents": [], "kind": "records", "case_ref": "S.T.C. No. 118 of 2024",
                                   "cc_no": "340", "cc_year": "2025",
                                   "purpose": "comparison of the signatures of the accused"})
    assert "[case to be provided]" not in text
    assert "call for the records of S.T.C. No. 118 of 2024" in text


def test_hrcp_eviction_prose_own_occupation_ground_is_pleaded():
    text = _text("hrcp_eviction", {**HRCP, "grounds": [
        "Default in payment of rent from May 2026 despite notice dated 10.08.2026",
        "Landlord's son, who was working in Dubai and has returned for good, requires the premises to "
        "start a hardware business; the family owns no other non-residential premises in Tiruchirappalli"]})
    assert "clause (b)" in text
    assert "own occupation" in text
    assert "confirm" not in text.lower()


def test_ejectment_schedule_always_rendered():
    text = _text("ejectment", EJECTMENT)
    assert ("SCHEDULE OF THE SUIT PROPERTY\nVacant site of 3,000 sq.ft. in Survey No. 56/2, "
            "Tiruchengode Road, Namakkal.") in text


def test_affidavit_no_kind_still_drafts_name_correction_request():
    fields = {k: v for k, v in _AFF.items() if k != "affidavit_kind"}
    text = _text("affidavit", {**fields, "role": "[role to be provided]"}, allow_placeholders=True)
    assert ("I therefore request the Tahsildar, Erode to correct the patta for S.F. No. 88/2, "
            "Chithode village to read my name as K. Ramesh.") in text
    assert "Affidavit kind" not in text and "affidavit kind" not in text


def test_succession_certificate_age_and_no_nominee():
    text = _text("succession_certificate", {**_SC, "petitioner_age": 52, "no_nominee": True})
    assert "Mrs. K. Malathi, aged 52 years, residing at Tiruvannamalai." in text
    assert "The deceased made no nomination in respect of any of the said securities." in text
    plain = _text("succession_certificate", _SC)
    assert "nomination" not in plain and "aged" not in plain.split("... Petitioner")[0]


def test_condone_delay_petition_gap_periods_named():
    cause = ("Earlier counsel, who undertook to apply for the decree copy, fell ill and did not do so; the "
             "petitioner was herself admitted at CMC Hospital, Vellore from 20.07.2026 to 02.09.2026 for a "
             "cardiac procedure and could approach the present counsel only on 25.09.2026; certified copies "
             "were applied for on 26.09.2026 and received on 08.10.2026")
    text = _text("condone_delay_petition", {**CONDONE, "sufficient_cause": cause}, allow_placeholders=True)
    for a, b in (("12.07.2026", "20.07.2026"), ("02.09.2026", "25.09.2026"), ("08.10.2026", "07.11.2026")):
        assert f"[cause of delay from {a} to {b} to be provided]" in text
    assert "from 25.09.2026 to 26.09.2026" not in text  # a single day is no gap
    from datetime import date
    assert unexplained_stretches(date(2026, 7, 12), date(2026, 7, 20), "on 15.07.2026 to 20.07.2026") == \
        [(date(2026, 7, 12), date(2026, 7, 15))]


def test_indigent_application_plaint_noun_phrase_cause():
    text = _text("indigent_application", {**INDIGENT, "cause_of_action": (
        "Refusal by the late husband's brothers to give any share to her or her two minor children "
        "after his death on 11.02.2025")})
    assert "states that Refusal" not in text
    assert ("2. The cause of action for the suit is the refusal by the late husband's brothers to give any "
            "share to her or her two minor children after his death on 11.02.2025.") in text
    assert "paragraphs 1 to 4 of the plaint" in text
