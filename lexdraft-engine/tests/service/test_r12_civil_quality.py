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


# ---- summary_suit: Divya v. Harish, loan agreement + cheque ----

def test_summary_suit_article_35_even_when_the_basis_is_the_loan_agreement():
    from tests.service.test_civil_suit_review import SUMMARY
    text = _text("summary_suit", {**SUMMARY, "claim_basis": "written_contract",
                                  "limitation_article": "[limitation article to be provided]"},
                 allow_placeholders=True)
    assert "Article 35 of the Schedule to the Limitation Act, 1963" in text
    assert "computed from 15.07.2026 expires on 15.07.2029" in text
    assert "[limitation article" not in text


def test_summary_suit_order_xxxvii_rule_2_inscription_and_averments():
    from tests.service.test_civil_suit_review import SUMMARY
    text = _text("summary_suit", SUMMARY)
    head = text.split("MOST RESPECTFULLY")[0]
    assert "O.S. No. ______ of 2026\n(Under Order XXXVII of the Code of Civil Procedure, 1908)" in head
    assert "as required by Order XXXVII Rule 2(1)(a)" in text
    assert "No relief which does not fall within the ambit of Order XXXVII Rule 1" in text


# ---- indigent_application: Selvi v. her late husband's two brothers ----

INDIGENT = {
    "applicant_name": "Mrs. V. Selvi", "respondent_name": "Her late husband's two brothers",
    "indigency_pleaded": True, "undertakes_to_pay_if_decreed": True,
    "indigency_particulars": "she earns about Rs. 6,000 a month and owns nothing except "
                             "household articles and jewellery worth about Rs. 15,000",
    "filing_date": "2026-11-07", "place": "Kallakurichi", "civil_court": "Subordinate Court",
    "city": "Kallakurichi", "applicant_address": "Sankarapuram, Kallakurichi District",
    "respondent_count": 2, "property_value": 1800000, "share_claimed": "one-third",
    "relief_claimed": "partition and separate possession of the plaintiff's one-third share",
    "suit_property_schedule": ["About 3 acres of dry land at Sankarapuram village",
                               "A tiled house at Sankarapuram village"],
}


def test_indigent_application_respondents_are_r1_r2_name_gaps_not_a_description():
    text = _text("indigent_application", INDIGENT)
    head = text.split("PETITION FILED UNDER")[0]
    assert ("1. [name of respondent to be provided], brother of the petitioner's late husband\n"
            "2. [name of respondent to be provided], brother of the petitioner's late husband") in head
    assert "Her late husband's two brothers" not in text


def test_indigent_application_annexes_the_proposed_plaint():
    text = _text("indigent_application", INDIGENT)
    plaint = text.split("ANNEXURE: THE PROPOSED PLAINT")[1]
    assert "O.S. No. ______ of 2026" in plaint and "... Defendants" in plaint
    assert "PLAINT FILED UNDER ORDER VII RULE 1 READ WITH ORDER XXXIII" in plaint
    assert "Rs. 6,00,000/- for the purposes of jurisdiction and court fee" in plaint
    assert "(a) for partition and separate possession of the plaintiff's one-third share" in plaint
    assert "2. A tiled house at Sankarapuram village" in plaint
    assert "VERIFICATION:" in plaint


def test_indigent_application_a_real_name_with_son_of_is_kept():
    text = _text("indigent_application", {**INDIGENT, "respondent_name": "Mr. K. Raman, son of Krishnan, aged 45",
                                          "respondent_count": 1})
    assert "Mr. K. Raman, son of Krishnan, aged 45" in text
