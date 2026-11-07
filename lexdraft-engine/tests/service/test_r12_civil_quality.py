"""r12 reviewer findings (2026-11-07) for plaint, condone_delay_petition, summary_suit,
indigent_application, hrcp_eviction, lease_deed, succession_certificate and
succession_grant, drafted through the real /v1/draft endpoint from the suite briefs."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402
from tests.service.test_civil_suit_review import PLAINT  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-R12-CIVIL", "version": 1}


def _text(doc_type, fields, **body):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **body})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


# ---- plaint: Rs. 9.57 lakh goods claim between two firms is a commercial dispute ----

def test_plaint_goods_claim_between_firms_goes_to_the_commercial_court():
    text = _text("plaint", {**PLAINT, "plaintiff_representative": "Mr. G. Venkatesh, managing partner"})
    assert text.startswith("IN THE COMMERCIAL COURT AT CHENNAI") or \
        "\nIN THE COMMERCIAL COURT AT CHENNAI" in text
    assert "C.O.S. No. ______ of 2026" in text
    assert "City Civil Court" not in text.split("PLAINT FILED")[0]
    assert "Section 2(1)(c)(i) of the Commercial Courts Act, 2015" in text
    assert "Section 12A of the Commercial Courts Act, 2015" in text
    assert "[particulars of the s.12A pre-institution mediation" in text
    assert "STATEMENT OF TRUTH" in text and "Order VI Rule 15A" in text
    assert "I, Mr. G. Venkatesh, managing partner, for and on behalf of M/s. Lotus Electricals" in text
    assert "VERIFICATION:" not in text


def test_plaint_below_specified_value_stays_an_ordinary_suit():
    small = {**PLAINT, "principal": 200000,
             "interest_tranches": [{"amount": 200000, "from_date": "2026-01-05"}]}
    text = _text("plaint", small)
    assert "COMMERCIAL COURT" not in text and "STATEMENT OF TRUTH" not in text
    assert "VERIFICATION:" in text


def test_plaint_cause_of_action_place_gap_filled_from_the_shared_city():
    text = _text("plaint", {**PLAINT, "cause_of_action_place": "[cause of action place to be provided]"},
                 allow_placeholders=True)
    assert "arose at Chennai on 05.01.2026" in text


# ---- condone_delay_petition: Meena v. ___, O.S. 73/2023 dismissed 12.06.2026 ----

CONDONE = {
    "main_proceeding": "appeal",
    "main_proceeding_desc": "Appeal against the dismissal of O.S. No. 73 of 2023 (suit for "
                            "recovery of Rs. 6,50,000 on a promissory note) by the Subordinate Court, Vellore",
    "petitioner_name": "Mrs. P. Meena", "respondent_names": ["[respondent names to be provided]"],
    "court_name": "Principal District Court, Vellore",
    "impugned_order_ref": "O.S. No. 73 of 2023, Subordinate Court, Vellore",
    "impugned_order_date": "2026-06-12", "period_days": 115, "filing_date": "2026-11-07",
    "sufficient_cause": "Her earlier counsel undertook to apply for the decree copy but fell ill.",
    "place": "Vellore", "copy_applied_date": "2026-09-26", "copy_ready_date": "2026-10-08",
    "petitioner_role": "Appellant",
    "supporting_documents": "Affidavit of Mrs. P. Meena; hospital records of CMC Hospital, Vellore",
}


def test_condone_delay_petition_copy_applied_after_expiry_gives_no_exclusion():
    text = _text("condone_delay_petition", CONDONE, allow_placeholders=True)
    # Art. 116(b): 30 days from 12.06.2026 -> 12.07.2026; copies applied 26.09.2026, too late
    assert "CONDONE THE DELAY OF 118 DAYS" in text
    assert "is 30 days from the date of the decree under Article 116(b)" in text
    assert "115 days" not in text and "21 days" not in text
    assert "not excluded under Section 12(2)" in text and "The last day for filing was 12.07.2026" in text
    assert text.count("118 days") >= 4  # title, para 2, prayer, affidavit (x2)


def test_condone_delay_petition_affidavit_reads_cleanly():
    text = _text("condone_delay_petition", CONDONE, allow_placeholders=True)
    assert "because her earlier counsel undertook" in text and "ill.." not in text
    assert "The judgment and decree in O.S. No. 73 of 2023" in text
    assert "in filing the appeal against the dismissal" in text and "filing Appeal" not in text
    assert "I produce hospital records of CMC Hospital" in text
    assert "signed her name in my presence" in text and "his/her" not in text
    assert "in A.S. No. ______ of 2026" in text
