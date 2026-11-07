"""x1 deed review (2026-11-07): each deed rendered from the suite brief must state
every particular given, read the right pronoun/number for each party, keep the
consideration arithmetic true, and leave a bracketed gap for any missing fact."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-DEEDS-X1", "version": 1}
W = ["Mr. P. Kannan, S/o Palani, Thanjavur", "Mr. R. Siva, S/o Raju, Thanjavur"]


def draft(doc_type, fields):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


SALE = {
    "vendor_name": "Mr. T. Rajendran", "vendor_description": "aged 60 years, residing at No. 4, North Street, Thanjavur",
    "vendee_name": "Mrs. A. Meena", "vendee_description": "aged 38 years, residing at No. 19, Medical College Road, Thanjavur",
    "property_desc": "House site measuring 2,400 sq.ft. in S.F. No. 145/3, Vilar village, Thanjavur Taluk",
    "boundary_north": "Road", "boundary_south": "Land of Raman", "boundary_east": "Lane", "boundary_west": "House of Murugan",
    "total_consideration": 3000000, "amount_already_paid": 3000000, "balance_paid_mode": "Demand Draft",
    "advance_amount": 500000, "advance_date": "2026-08-01",
    "prior_title_recital": "a settlement deed dated 10.03.2005 registered as Doc. No. 812/2005 at SRO Thanjavur",
    "to_be_registered": True, "execution_date": "2026-11-07", "witnesses": W, "place": "Thanjavur",
}


def test_sale_deed_consideration_adds_up():
    t = draft("sale_deed", SALE)
    assert "Rs. 5,00,000/- (Rupees five lakh only) paid as advance on 01.08.2026" in t
    assert "balance of Rs. 25,00,000/- (Rupees twenty-five lakh only) paid this day by Demand Draft" in t
    assert "Rs. 0/-" not in t and "part consideration" not in t


def test_sale_deed_female_purchaser_pronoun_and_boundaries_in_schedule():
    t = draft("sale_deed", SALE)
    assert "include her heirs" in t and "include his heirs" in t  # purchaser / vendor
    assert "transferred to her name" in t
    sched = t[t.index("SCHEDULE OF PROPERTY"):]
    assert "North by : Road" in sched and "West by  : House of Murugan" in sched
    assert "SRO Thanjavur" in t[:t.index("SCHEDULE OF PROPERTY")]
    assert "s.17(1)(b)" in t and "s.54" in t


def test_sale_deed_fully_paid_without_breakdown_is_never_balance_zero():
    t = draft("sale_deed", {**SALE, "advance_amount": 0, "advance_date": None})
    assert "entire sale consideration of Rs. 30,00,000/-" in t and "Rs. 0/-" not in t


def test_agreement_for_sale_balance_and_days():
    t = draft("agreement_for_sale", {
        "vendor_name": "Mr. T. Rajendran", "vendor_description": "aged 60 years, No. 4, North Street, Thanjavur",
        "vendee_name": "Mrs. A. Meena", "vendee_description": "aged 38 years, No. 19, Medical College Road, Thanjavur",
        "property_desc": "House site of 2,400 sq.ft. in S.F. No. 145/3, Vilar village, Thanjavur",
        "total_consideration": 3000000, "earnest_money": 500000, "earnest_mode": "bank transfer",
        "completion_days": 90, "execution_date": "2026-11-07", "witnesses": W, "place": "Thanjavur"})
    assert "balance sale consideration of Rs. 25,00,000/-" in t and "within 90 days" in t
    assert "encumbrance certificate" in t and "at her option" in t


def test_gift_deed_acceptance_operative_and_pronouns():
    t = draft("gift_deed", {
        "donor_name": "Mrs. V. Lakshmi", "donor_description": "aged 58 years, widow, No. 40, Fairlands, Salem",
        "donee_name": "Mr. V. Karthik", "donee_description": "aged 32 years, son of Mrs. V. Lakshmi",
        "relation": "Son", "property_desc": "Residential house at Door No. 40, Fairlands, Salem, S.F. No. 210/1",
        "boundary_east": "Road", "boundary_west": "House of Ravi", "boundary_north": "Lane", "boundary_south": "Vacant land",
        "market_value": 4500000, "possession_delivered": True, "to_be_registered": True,
        "prior_title_recital": "a sale deed dated 02.02.1998", "execution_date": "2026-11-07", "witnesses": W, "place": "Salem"})
    assert "The Donee hereby accepts the gift" in t and "DONEE (gift accepted)" in t
    assert "the Donor's son" in t and "his/her" not in t
    assert "claiming through her" in t and "transferred to his name" in t
    assert "North by : Lane" in t


def test_mortgage_deed_no_power_of_sale_out_of_court():
    t = draft("mortgage_deed", {
        "mortgagor_name": "Mr. N. Rajagopal", "mortgagor_description": "aged 55 years, No. 6, Tiruchengode Road, Namakkal",
        "mortgagee_name": "Mr. S. Velu", "mortgagee_description": "aged 61 years, No. 14, Salem Road, Namakkal",
        "property_desc": "Vacant site of 3,000 sq.ft. in Survey No. 56/2, Tiruchengode Road, Namakkal",
        "principal": 800000, "interest_rate": 12, "repayment_terms": "within 3 years from the date hereof",
        "execution_date": "2026-11-07", "witnesses": W, "place": "Namakkal"})
    assert "without the intervention of the Court" in t and "have the power to sell" not in t
    assert "s.58(b)" in t and "REDEMPTION" in t and "s.59" in t
    assert "[mortgagor's title (prior deed) to be provided]" in t and "[east boundary to be provided]" in t
    assert "binds himself personally" in t and "include its successors" not in t


def test_lease_deed_rent_day_term_and_registration():
    t = draft("lease_deed", {
        "lessor_name": "Mr. G. Sundaram", "lessor_description": "aged 70 years, No. 22, Big Bazaar Street, Tiruchirappalli",
        "lessee_name": "M/s. Mobile World", "lessee_description": "represented by Mr. A. Rafiq",
        "property_desc": "Ground-floor shop at No. 22, Big Bazaar Street, Tiruchirappalli",
        "term_months": 36, "commencement_date": "2026-12-01", "monthly_rent": 18000,
        "escalation_note": "5% over the last paid rent at the end of every year", "security_deposit": 100000,
        "notice_months": 3, "rent_due_day": 5, "lease_purpose": "a commercial shop",
        "execution_date": "2026-11-07", "witnesses": W, "place": "Tiruchirappalli"})
    assert "term of 3 years commencing on 01.12.2026 and ending on 30.11.2029" in t
    assert "on or before the 5th day of every month" in t
    assert "include its successors-in-interest" in t and "s.107" in t and "s.17(1)(d)" in t


def test_partnership_deed_capital_remuneration_banking():
    p = lambda n, d, g: {"name": n, "description": d, "share_pct": 50, "capital": 500000,
                         "remuneration": 25000, "gender": g}
    t = draft("partnership_deed", {
        "firm_name": "M/s. Green Leaf Organics",
        "partners": [p("Mrs. S. Priya", "aged 32 years, of Coimbatore", "female"),
                     p("Mr. K. Arun", "aged 35 years, of Coimbatore", "male")],
        "business_nature": "retail of organic produce", "principal_place": "No. 18, RS Puram, Coimbatore",
        "commencement_date": "2026-12-01", "at_will": True, "banking_mode": "jointly by both partners",
        "execution_date": "2026-11-07", "witnesses": W, "place": "Coimbatore"})
    assert "capital of the Firm shall be Rs. 10,00,000/-" in t and "Mrs. S. Priya: Rs. 5,00,000/-" in t
    assert "Rs. 25,000/- (Rupees twenty-five thousand only) per month" in t
    assert "jointly by both partners" in t and "s.43" in t and "(share:" not in t


def test_dissolution_deed_takeover_settlement_liabilities():
    t = draft("dissolution_deed", {
        "firm_name": "M/s. Sri Lakshmi Textiles", "firm_address": "No. 40, Oppanakara Street, Coimbatore",
        "partners": [{"name": "Mr. K. Senthil", "description": "partner", "share_pct": 50},
                     {"name": "Mr. R. Prakash", "description": "partner", "share_pct": 50}],
        "original_deed_ref": "a partnership deed dated 01.04.2019", "dissolution_date": "2026-10-31",
        "continuing_partner": "Mr. K. Senthil", "settlement_amount": 1200000,
        "liabilities_by": "Mr. K. Senthil", "execution_date": "2026-11-07", "witnesses": W, "place": "Coimbatore"})
    assert "at No. 40, Oppanakara Street, Coimbatore" in t and "in equal shares" in t
    assert "stock-in-trade and goodwill" in t
    assert "shall pay to Mr. R. Prakash the sum of Rs. 12,00,000/-" in t and "settlement of his share" in t
    assert "discharged by Mr. K. Senthil" in t and "remain with Mr. K. Senthil" in t


def test_relinquishment_deed_single_releasor_and_male_releasee():
    t = draft("relinquishment_deed", {
        "releasors": [{"name": "Mrs. V. Deepa", "description": "aged 29 years, D/o late K. Venkatesan, No. 40, Fairlands, Salem"}],
        "releasee_name": "Mr. V. Karthik", "releasee_description": "aged 32 years, her brother",
        "property_desc": "House at Door No. 40, Fairlands, Salem (S.F. No. 210/1, Suramangalam village, 1,800 sq.ft.)",
        "deceased_owner": "late K. Venkatesan", "deceased_gender": "male", "releasors_share": "One-third undivided share",
        "death_date": "2026-05-12", "execution_date": "2026-11-07", "witnesses": W, "place": "Salem"})
    assert "Releasors" not in t and "RELEASORS" not in t
    assert "the Releasor hereby" not in t  # verb agreement reads "releases"
    assert "hereby releases and relinquishes" in t and "share share" not in t
    assert "died on 12.05.2026" in t and "on his death" in t and "late late" not in t
    assert "include his heirs" in t and "her own free will" in t


def test_power_of_attorney_exclusion_schedule_and_abroad_note():
    t = draft("power_of_attorney", {
        "poa_kind": "general", "executant_name": "Mr. R. Dinesh",
        "executant_description": "aged 34 years, No. 2, R.S. Puram, Coimbatore, now working in Dubai",
        "attorney_name": "Mr. K. Ramasamy", "attorney_description": "aged 64 years, my father, of the same address",
        "powers": ["To manage the flat", "To let out the said flat", "To collect rent", "To pay taxes",
                   "To represent the executant before the Sub-Registrar and courts", "No power to sell the said flat"],
        "schedule_property": "Flat No. 3B, Sri Sai Apartments, R.S. Puram, Coimbatore", "executed_abroad": True,
        "execution_date": "2026-11-07", "witnesses": W, "place": "Dubai"})
    powers = t[t.index("WITNESSETH"):t.index("PROVIDED ALWAYS")]
    assert "sell" not in powers.lower()
    assert "nothing in these presents authorises the Attorney to sell the said flat, which power I expressly withhold" in t
    assert "Flat No. 3B, Sri Sai Apartments" in t[t.index("SCHEDULE OF PROPERTY"):]
    assert "s.18, Indian Stamp Act" in t and "Consular" in t and "present for registration" in t


def test_will_age_residuary_family_and_schedule():
    t = draft("will", {
        "testator_name": "Mr. K. Venkatesan", "testator_parentage": "S/o Kandasamy",
        "testator_address": "No. 40, Fairlands, Salem", "testator_age": 68, "execution_date": "2026-11-07",
        "bequests": [{"property_desc": "House at Door No. 40, Fairlands, Salem", "beneficiary": "V. Karthik", "relation": "Son"},
                     {"property_desc": "Fixed deposit of Rs. 8,00,000 in SBI Fairlands branch", "beneficiary": "V. Deepa", "relation": "Daughter"},
                     {"property_desc": "500 ITC shares", "beneficiary": "V. Lakshmi", "relation": "Wife"}],
        "sound_mind_declared": True, "executor_name": "V. Lakshmi",
        "witnesses": ["Mr. R. Narayanan, Salem", "Dr. S. Subramanian, Salem"], "place": "Salem"})
    assert "aged 68 years" in t
    assert "RESIDUE" in t and "[residuary legatee to be provided]" in t
    assert "my son V. Karthik, my daughter V. Deepa and my wife V. Lakshmi" in t
    assert "Item 3: 500 ITC shares" in t and "s.63" in t and "self-acquired" not in t
