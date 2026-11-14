"""The remaining benchmark-h2h v2 checklist FAILs (b1-b4 scores-v2), pinned on the engine
render. One test per item: test_<format>_item<N>."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from tests.service.test_b1_checklists import APPEAL, SM  # noqa: E402
from tests.service.test_r16_checklists import _text  # noqa: E402
from tests.service.test_all_adapters_roundtrip import PAYLOADS  # noqa: E402


def test_criminal_appeal_item2():
    text = _text("criminal_appeal", {**APPEAL, "appellant_age": "45", "appellant_occupation": "lorry driver",
                                     "appellant_address": "Manachanallur, Tiruchirappalli District"},
                 allow_placeholders=True)
    assert "Mr. S. Murugesan, aged 45 years, lorry driver, residing at Manachanallur, Tiruchirappalli District" in text


REPLY = PAYLOADS["s138_reply"]


def test_s138_reply_item11():
    text = _text("s138_reply", {**REPLY, "cheques_to_return": "both signed blank cheques given as security",
                                "return_within_days": 7}, allow_placeholders=True)
    assert "That your client is called upon to return both signed blank cheques given as security to my client within 7 days" in text


def test_surety_memo_item8():
    text = _text("surety_memo", {**SM, "documents": ["Property documents of the sureties", "Identity proofs of the sureties"]})
    assert "The suretys produce" not in text
    assert "The sureties produce their property documents and identity proofs." in text


PLAINT = {**PAYLOADS["plaint"], "interest_is_contractual": True, "interest_document_ref": None, "interest_rate": 18}


def test_plaint_item6():
    text = _text("plaint", PLAINT, allow_placeholders=True)
    assert "being the rate claimed by the plaintiff" in text
    assert "rate agreed" not in text and "document fixing" not in text
    # an agreement the facts do state stays agreed
    agreed = _text("plaint", {**PLAINT, "transaction_narrative": "The parties agreed interest at 18% per annum on the supply."},
                   allow_placeholders=True)
    assert "the rate agreed between the parties" in agreed


SUMMARY = {**PAYLOADS["summary_suit"], "limitation_article": "[limitation article to be provided]"}


def test_summary_suit_item8():
    assert "Article 35" in _text("summary_suit", SUMMARY, allow_placeholders=True)
    loan = {**SUMMARY, "claim_basis": "written_contract",
            "instrument_ref": "written loan agreement dated 15.01.2024", "limitation_article": None,
            "interest_document_ref": "written loan agreement dated 15.01.2024"}
    text = _text("summary_suit", loan, allow_placeholders=True)
    assert "Article 19" in text and "[limitation article" not in text


HRCP = {**PAYLOADS["hrcp_eviction"], "arrears_months": 7, "monthly_rent": 15000, "arrears_amount": 0}


def test_hrcp_eviction_item8():
    assert "arrears of rent for 7 months amounting to Rs. 1,05,000/-" in _text("hrcp_eviction", HRCP, allow_placeholders=True)


def test_hrcp_eviction_item11():
    text = _text("hrcp_eviction", HRCP, allow_placeholders=True)
    assert "direct the respondent to pay the arrears of rent of Rs. 1,05,000/- for 7 months" in text


SP = {**PAYLOADS["specific_performance"], "agreement_registered": True, "agreement_date": "2023-03-15"}


def test_specific_performance_item3():
    text = _text("specific_performance", SP, allow_placeholders=True)
    assert "entered into a registered agreement of sale" in text
    assert "specific performance of the registered agreement of sale dated" in text   # prayer
    assert "registered agreement" not in _text("specific_performance", PAYLOADS["specific_performance"], allow_placeholders=True)


INDIGENT = {**PAYLOADS["indigent_application"], "applicant_name": "Mrs. V. Selvi", "property_value": 1800000,
            "share_claimed": "one-third share", "suit_property_schedule": ["About 3 acres of dry land at Sankarapuram"],
            "cause_of_action": "Her husband died on 11.02.2025 and his brothers refused to give any share",
            "co_heirs": ["her two minor children"]}


def test_indigent_application_item9():
    text = _text("indigent_application", INDIGENT, allow_placeholders=True)
    assert "VALUATION" in text and "6,00,000" in text and "court fee" in text.lower()


def test_indigent_application_item10():
    text = _text("indigent_application", INDIGENT, allow_placeholders=True)
    assert "jurisdiction under Section 16 of the Code of Civil Procedure" in text
    assert "[the jurisdiction of this Hon'ble Court" not in text
    assert "[valuation of the suit" not in text


def test_indigent_application_item11():
    text = _text("indigent_application", INDIGENT, allow_placeholders=True)
    assert "namely the plaintiff and her two minor children. The plaintiff claims her own share" in text
    assert "[names of her two minor children to be provided]" in text
    named = _text("indigent_application", {**INDIGENT, "co_heirs": ["Selvan K. Arjun"]}, allow_placeholders=True)
    assert "[names of" not in named


CONDONE = {**PAYLOADS["condone_delay_petition"], "impugned_order_ref": "Dismissal of O.S. No. 73 of 2023 on the file of the Subordinate Court, Vellore"}


def test_condone_delay_petition_item12():
    text = _text("condone_delay_petition", CONDONE, allow_placeholders=True)
    assert "The judgment and decree in O.S. No. 73 of 2023 on the file of the Subordinate Court, Vellore was passed" in text
    assert "in Dismissal of" not in text


def test_special_leave_petition_item13():
    text = _text("special_leave_petition", PAYLOADS["special_leave_petition"], allow_placeholders=True)
    assert "| P-1 | True copy of the impugned judgment dated" in text  # evidence-tables
    assert "WP 5427/2004" in text.split("INDEX OF ANNEXURES")[1]


@pytest.mark.parametrize("fmt,item", [("divorce_contested", 13), ("judicial_separation", 14),
                                      ("restitution_conjugal_rights", 14), ("succession_certificate", 13)])
def test_b3_supporting_affidavit_drafted(fmt, item):
    text = _text(fmt, PAYLOADS[fmt], allow_placeholders=True)
    assert "AFFIDAVIT OF THE PETITIONER IN SUPPORT OF THE PETITION" in text
    assert "do hereby solemnly affirm and sincerely state as follows:" in text
    assert "DEPONENT" in text
    assert "[NOTE:" not in text.split("AFFIDAVIT OF THE PETITIONER")[1]


def test_divorce_contested_item13():
    test_b3_supporting_affidavit_drafted("divorce_contested", 13)


def test_judicial_separation_item14():
    test_b3_supporting_affidavit_drafted("judicial_separation", 14)


def test_restitution_conjugal_rights_item14():
    test_b3_supporting_affidavit_drafted("restitution_conjugal_rights", 14)


def test_succession_certificate_item13():
    test_b3_supporting_affidavit_drafted("succession_certificate", 13)


SECOND = PAYLOADS["divorce_mutual_second"]


def test_divorce_mutual_second_item6():
    gap = _text("divorce_mutual_second", SECOND, allow_placeholders=True)
    assert "within eighteen months of the presentation of the first-motion petition on [date of presentation of the first-motion petition to be provided]" in gap
    assert gap.count("within eighteen months of the presentation") == 2   # body and joint affidavit
    known = _text("divorce_mutual_second", {**SECOND, "first_motion_presented_date": "2023-12-15"}, allow_placeholders=True)
    assert "on 15.12.2023" in known and "[date of presentation" not in known


MACT = {**PAYLOADS["mact_claim"], "claimants": ["Mrs. K. Priya (wife, 31)", "K. Arjun (son, 6)", "Mrs. S. Lakshmi (mother, 60)"]}


def test_mact_claim_item2():
    text = _text("mact_claim", MACT, allow_placeholders=True)
    assert "K. Arjun (son, 6), minor, represented by his mother and next friend, the 1st petitioner" in text


def test_mact_claim_item13():
    text = _text("mact_claim", MACT, allow_placeholders=True)
    assert "liable to indemnify the 2nd respondent" in text and "Sections 147 and 149 of the Motor Vehicles Act, 1988" in text
    assert text.split("PRAYER", 1)[1].count("Sections 147 and 149") == 1


def test_general_notice_item9():
    with_interest = _text("general_notice", {**PAYLOADS["general_notice"], "act_required": "refund the security deposit of Rs. 1,00,000 with interest at 12% p.a. from 31.08.2026"},
                          allow_placeholders=True)
    assert "being the principal sum of Rs. 1,00,000/-" in with_interest and "together with the said interest" in with_interest
    assert "being the sum of Rs. 1,00,000" not in with_interest
    assert "being the sum of" in _text("general_notice", PAYLOADS["general_notice"], allow_placeholders=True)


def test_s106_notice_item9():
    text = _text("s106_notice", PAYLOADS["s106_notice"], allow_placeholders=True)
    assert "expiring with the end of a month" not in text
    assert "as amended in 2002 by Act 3 of 2003" in text and "expiry of fifteen days" in text


def test_writ_criminal_detenu_not_doubled():
    text = _text("writ_criminal", {**PAYLOADS["writ_criminal"], "detenu_name": "Mr. R. Saravanan",
                                   "petitioner_relation": "Mother of the detenu"}, allow_placeholders=True)
    assert "of the detenu of the detenu" not in text
