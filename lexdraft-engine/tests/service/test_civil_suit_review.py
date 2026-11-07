"""2026-11-07 senior-advocate review of the civil-suit formats, drafted from the
suite briefs through the real /v1/draft endpoint. Each test is named after the
format and the defect it pins."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-CIVIL-REVIEW", "version": 1}


def _text(doc_type, fields, **body):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **body})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


# Lotus Electricals v. Bright Homes Builders: two invoices, 18% from the invoice dates.
PLAINT = {
    "plaintiff_name": "M/s. Lotus Electricals", "defendant_names": ["M/s. Bright Homes Builders"],
    "variant": "partnership", "cause_of_action_place": "Chennai", "forum": "city_civil_court",
    "territorial_bases": ["defendant_carries_on_business"], "principal": 840000,
    "interest_rate": 18, "interest_is_contractual": True, "acknowledgements": [],
    "filing_date": "2026-11-07", "place": "Chennai", "civil_court": "City Civil Court",
    "city": "Chennai", "plaintiff_address": "No. 31, Ritchie Street, Chennai 600002",
    "defendant_addresses": ["No. 12, OMR, Sholinganallur, Chennai 600119"],
    "interest_tranches": [{"amount": 410000, "from_date": "2026-01-05"},
                          {"amount": 430000, "from_date": "2026-02-18"}],
    "claim_for": "price_of_goods_sold", "legal_notice_served_date": "2026-07-14",
}


def test_plaint_firms_have_a_place_of_business_not_a_residence():
    text = _text("plaint", PLAINT)
    assert "M/s. Lotus Electricals, having its place of business at No. 31, Ritchie Street" in text
    assert "M/s. Bright Homes Builders, having its place of business at No. 12, OMR" in text
    assert "residing at" not in text


def test_plaint_agreed_18_percent_is_never_called_statutory():
    text = _text("plaint", PLAINT)
    assert "statutory" not in text
    assert "at 18% per annum, the rate agreed between the parties, vide [document fixing" in text


def test_plaint_cause_of_action_comes_from_the_invoice_and_notice_dates():
    text = _text("plaint", PLAINT)
    assert ("arose at Chennai on 05.01.2026 and 18.02.2026, the dates of the transactions "
            "sued upon, and on 14.07.2026, when the legal notice") in text


def test_plaint_article_14_runs_from_delivery_not_a_stand_in_date():
    text = _text("plaint", PLAINT)
    assert "Article 14 of the Schedule to the Limitation Act, 1963" in text
    assert "price of goods sold and delivered" in text
    assert "computed from 05.01.2026 expires on 05.01.2029" in text


def test_plaint_without_claim_nature_leaves_the_article_as_a_visible_gap():
    text = _text("plaint", {**PLAINT, "claim_for": None})
    assert "Article [limitation article to be provided]" in text
    assert "expires on" not in text


# Divya v. Harish: loan agreement + cheque for Rs. 45,00,000, 12% agreed from 15.07.2026.
SUMMARY = {
    "plaintiff_name": "Ms. R. Divya", "defendant_names": ["Mr. J. Harish"],
    "instrument_ref": "written loan agreement dated 15.01.2026 and cheque No. 300871 "
                      "dated 15.07.2026 drawn on Axis Bank, Teynampet branch",
    "instrument_date": "2026-07-15", "cause_of_action_date": "2026-07-18",
    "cause_of_action_place": "Chennai", "forum": "high_court_os",
    "civil_court": "High Court of Madras (Original Side)", "city": "Chennai",
    "territorial_bases": ["defendant_resides"], "principal": 4500000, "interest_rate": 12,
    "interest_is_contractual": True, "interest_from_date": "2026-07-15",
    "acknowledgements": [], "filing_date": "2026-11-07", "place": "Chennai",
    "plaintiff_address": "No. 2, Boat Club Road, Chennai 600028",
    "defendant_addresses": ["No. 40, Poes Garden, Chennai 600086"],
}


def test_summary_suit_under_one_crore_goes_to_the_city_civil_court():
    text = _text("summary_suit", SUMMARY)
    assert "IN THE CITY CIVIL COURT, CHENNAI" in text
    assert "HIGH COURT" not in text and "C.S. No." not in text
    assert "O.S. No. ______ of 2026" in text


def test_summary_suit_interest_and_total_computed_from_the_agreed_date():
    text = _text("summary_suit", SUMMARY)
    # Rs. 45,00,000 x 12% x 115 days (15.07.2026 -> 07.11.2026) / 365 = Rs. 1,70,137
    assert "interest Rs. 1,70,137/- at 12% per annum, the rate agreed between the parties" in text
    assert "total claimed Rs. 46,70,137/-" in text
    assert "statutory" not in text
    assert "court fee of Rs." in text and "court fee of Rs. 0/-" not in text


def test_summary_suit_cheque_basis_and_article_35_from_the_cheque_date():
    text = _text("summary_suit", SUMMARY)
    assert "The claim arises on a bill of exchange" in text
    assert "Article 35 of the Schedule to the Limitation Act, 1963" in text
    assert "computed from 15.07.2026 expires on 15.07.2029" in text
    assert "cause of action arose on 18.07.2026" in text


# Rajagopal v. Sekar: vacant site let month to month, s.106 notice, arrears + damages.
EJECTMENT = {
    "plaintiff_names": ["Mr. N. Rajagopal"], "defendant_name": "Mr. K. Sekar",
    "suit_premises": "a vacant site of 3,000 sq.ft. in Survey No. 56/2, Tiruchengode Road, Namakkal",
    "lease_ref": "an oral lease from 01.04.2019", "s106_notice_ref": "notice dated 05.08.2026",
    "s106_notice_served_date": "2026-08-08", "tenancy_end_date": "2026-08-23",
    "monthly_rent": 12000, "arrears_from_date": "2026-01-01", "damages_rate_per_month": 20000,
    "wrongful_occupation_since": "2026-08-24", "cause_of_action_date": "2026-08-24",
    "cause_of_action_place": "Namakkal", "filing_date": "2026-11-07", "place": "Namakkal",
    "civil_court": "District Munsif Court", "city": "Namakkal",
}


def test_ejectment_vacant_site_is_outside_the_2017_tenancy_act():
    text = _text("ejectment", EJECTMENT)
    assert "is a vacant site and not a building" in text
    assert ("Tamil Nadu Regulation of Rights and Responsibilities of Landlords and Tenants "
            "Act, 2017 governs the tenancy of premises, that is, buildings") in text
    assert "Section 16 of the Code of Civil Procedure, 1908" in text
    assert "[to be drafted]" not in text and "Rent Control Act" not in text


def test_ejectment_valuation_under_s50_with_arrears_and_damages_and_fee_computed():
    text = _text("ejectment", EJECTMENT)
    assert "under Section 50 of the Tamil Nadu Court Fees and Suits Valuation Act, 1955" in text
    assert "Rs. 1,44,000/-" in text and "Rs. 96,000/-" in text and "Rs. 49,333/-" in text
    assert "in all Rs. 2,89,333/-" in text
    # VERIFY slabs: 5% on the first Rs. 50,000 + 7.5% on the rest = Rs. 20,450
    assert "court fee of Rs. 20,450/- is paid" in text


def test_ejectment_month_to_month_tenancy_has_no_invented_expiry():
    text = _text("ejectment", EJECTMENT)
    assert "That the tenancy is one from month to month." in text
    assert "lease expired" not in text


# Vijayakumar v. Nagaraj: Rs. 36,00,000 sale agreement, completion by 14.12.2025.
SPECIFIC = {
    "plaintiff_name": "Mr. S. Vijayakumar", "defendant_name": "Mr. R. Nagaraj",
    "suit_property": "house site of 2,400 sq.ft. in Survey No. 175/2, Mathigiri village, Hosur taluk",
    "agreement_date": "2025-03-15", "agreement_ref": "registered sale agreement dated 15.03.2025",
    "total_consideration": 3600000, "earnest_paid": 1000000, "balance_amount": 2600000,
    "readiness_and_willingness": True, "notice_ref": "lawyer's notice dated 05.01.2026",
    "cause_of_action_date": "2026-01-20", "cause_of_action_place": "Hosur",
    "filing_date": "2026-11-07", "place": "Hosur", "civil_court": "Subordinate Court",
    "city": "Hosur", "alternative_refund": True, "injunction_against_alienation": True,
    "performance_date": "2025-12-14",
}


def test_specific_performance_valued_on_the_price_with_fee_computed():
    text = _text("specific_performance", SPECIFIC)
    assert ("valued under Section 45(a) of the Tamil Nadu Court Fees and Suits Valuation "
            "Act, 1955 on the amount of the consideration, Rs. 36,00,000/-") in text
    assert "court fee of Rs. 0/-" not in text and "[to be drafted]" not in text.split("PRAYER")[1]
    assert "Section 16 of the Code of Civil Procedure, 1908" in text


def test_specific_performance_article_54_from_the_date_fixed_for_performance():
    text = _text("specific_performance", SPECIFIC)
    assert "Article 54 of the Schedule to the Limitation Act, 1963" in text
    assert "the date fixed for performance was 14.12.2025, and the period expires on 14.12.2028" in text


def test_specific_performance_alternative_refund_prays_interest():
    text = _text("specific_performance", SPECIFIC)
    assert ("refund the earnest money of Rs. 10,00,000/- to the plaintiff with interest at "
            "such rate as this Hon'ble Court may deem fit from the date of its payment") in text


# Balaji v. Coolwave + Metro Digital: Rs. 62,000 fridge, refusal on 01.08.2026.
CONSUMER = {
    "complainant_name": "Mr. H. Balaji",
    "opposite_party_name": "Coolwave Appliances Ltd.; Metro Digital Store",
    "purpose": "personal", "consideration_paid": 62000, "transaction_date": "2026-04-12",
    "invoice_ref": "invoice No. MDS/1182", "cause_of_action_date": "2026-08-01",
    "filing_date": "2026-11-07", "compensation": 50000,
    "compensation_basis": "food loss and mental agony", "affidavit_present": True,
    "evidence_affidavit_present": True, "place": "Chennai",
    "territorial_basis": "the opposite parties carry on business within its limits",
    "commission_place": "Chennai (South)", "refund_amount": 62000, "costs_claimed": 10000,
}


def test_consumer_complaint_prayer_asks_refund_with_interest_compensation_and_costs():
    prayer = _text("consumer_complaint", CONSUMER).split("PRAYER")[1]
    assert "jointly and severally, to refund Rs. 62,000/- paid by the complainant, with interest" in prayer
    assert "compensation of Rs. 50,000/-" in prayer
    assert "costs of Rs. 10,000/-" in prayer


def test_consumer_complaint_limitation_under_s69_from_the_cause_of_action():
    text = _text("consumer_complaint", CONSUMER)
    assert "Section 69(1) of the Act" in text
    assert "The cause of action arose on 01.08.2026; the period expires on 01.08.2028" in text


def test_consumer_complaint_law_is_in_the_skeleton_and_parties_listed():
    text = _text("consumer_complaint", CONSUMER)
    for law in ("Section 2(10)", "Section 2(11)", "Section 34(1)", "Section 34(2)"):
        assert law in text
    assert "1. Coolwave Appliances Ltd." in text and "2. Metro Digital Store" in text
    assert "... Opposite Parties" in text


# Sundaram v. Rafiq: rent unpaid from May 2026; only "a notice dated 10.08.2026".
HRCP = {
    "landlord_names": ["Mr. G. Sundaram"], "tenant_names": ["Mr. A. Rafiq"],
    "premises_description": "ground-floor shop at No. 22, Big Bazaar Street, Tiruchirappalli",
    "monthly_rent": 15000, "grounds": ["arrears_of_rent"], "filing_date": "2026-11-07",
    "place": "Tiruchirappalli", "written_tenancy_agreement": True, "arrears_months": 7,
    "arrears_amount": 105000, "demand_notice_date": "2026-08-10",
}


def test_hrcp_eviction_demand_notice_date_only_drafts_with_a_service_gap():
    text = _text("hrcp_eviction", HRCP)
    assert ("A notice of demand dated 10.08.2026 was served on the respondent on "
            "[date of service to be provided]") in text


def test_hrcp_eviction_premature_from_the_notice_date_still_refuses():
    r = client.post("/v1/draft/hrcp_eviction", json={"matter": MATTER, "fields": {
        **HRCP, "filing_date": "2026-09-05"}})
    assert r.json()["outcome"] == "refused"
    assert r.json()["refusal"]["code"] == "hrcp_eviction_demand_period_not_elapsed"


# Selvi: partition of her late husband's 1/3 share against his two (unnamed) brothers.
INDIGENT = {
    "applicant_name": "Mrs. V. Selvi", "respondent_name": "[respondent name to be provided]",
    "indigency_pleaded": True,
    "indigency_particulars": "she earns about Rs. 6,000 a month and owns only household "
                             "articles and jewellery worth about Rs. 15,000",
    "undertakes_to_pay_if_decreed": True, "filing_date": "2026-11-07", "place": "Kallakurichi",
    "civil_court": "Subordinate Court", "city": "Kallakurichi", "respondent_count": 2,
    "relief_claimed": "partition and separate possession of her one-third share",
    "property_value": 1800000, "share_claimed": "one-third",
}


def test_indigent_application_impleads_both_brothers():
    text = _text("indigent_application", INDIGENT, allow_placeholders=True)
    assert "1. [name of respondent 1 to be provided]" in text
    assert "2. [name of respondent 2 to be provided]" in text
    assert "Respondents/Defendants" in text


def test_indigent_application_values_only_her_one_third_share():
    text = _text("indigent_application", INDIGENT, allow_placeholders=True)
    assert "Section 37(1) of the Tamil Nadu Court Fees and Suits Valuation Act, 1955" in text
    assert "namely Rs. 6,00,000/- for the purposes of jurisdiction and court fee" in text
    assert "Rs. 18,00,000/- for the purposes" not in text


def test_indigent_application_refers_to_the_proposed_plaint_not_a_suit_ref_gap():
    text = _text("indigent_application", INDIGENT, allow_placeholders=True)
    assert "the suit set out in the proposed plaint filed along with this petition" in text
    assert "[suit ref" not in text
