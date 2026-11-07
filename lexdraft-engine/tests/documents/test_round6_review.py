"""Round-6 senior-advocate review (44 drafts): affidavits drafted in full, the
State arrayed in criminal matters, co-respondents kept, computed figures, the
corrected law per format and prayers that carry every relief asked for.

Each test renders through the live /v1/draft endpoint (the advocate's view) or
calls the computation directly with a worked example.
"""
from __future__ import annotations

from datetime import date

import pytest

from src.pipelines import _appeal_window as aw
from src.pipelines._state_party import state_respondent, with_state
from src.pipelines.hrcp_eviction import classify_ground
from src.rules import custody_computation as cc
from src.rules import interest as intr
from src.rules import limitation as lim
from tests.documents.test_tn_layout import _draft


# -- 1. supporting affidavits drafted in full --------------------------------

_JURAT = "Solemnly affirmed at"


@pytest.mark.parametrize("doc_type,deponent", [
    ("transfer_petition", None), ("contempt_petition", None), ("injunction", None),
    ("amendment_ia", "Ramesh"), ("consumer_complaint", None),
    ("o39_r2a_application", "A"), ("special_leave_petition", None),
])
def test_affidavit_present_in_full(doc_type, deponent):
    t = _draft(doc_type)
    assert "do hereby solemnly affirm and sincerely state as follows:" in t
    assert "The facts stated in the accompanying" in t
    assert "VERIFICATION: I, the deponent above named" in t
    assert _JURAT in t and "BEFORE ME," in t and "ADVOCATE / NOTARY PUBLIC" in t
    assert "To be supported by an affidavit" not in t
    if deponent:
        assert f"I, {deponent}," in t


def test_affidavit_uses_deponent_particulars_when_given():
    t = _draft("transfer_petition", petitioner_parentage="D/o Late K. Raman",
               petitioner_address="No. 5, Madurai")
    assert "I, " in t and "D/o Late K. Raman, residing at No. 5, Madurai, do hereby" in t
    assert "[age, parentage and address of the deponent to be provided]" not in t.split(
        "AFFIDAVIT FILED IN SUPPORT")[1]


def test_consumer_affidavit_addresses_the_commission():
    t = _draft("consumer_complaint")
    aff = t.split("AFFIDAVIT FILED IN SUPPORT OF THE COMPLAINT")[1]
    assert "this Hon'ble Commission may be pleased" in aff


def test_divorce_mutual_first_joint_affidavit():
    t = _draft("divorce_mutual_first", party_a_age=37,
               party_a_address="No. 21, T. Nagar, Chennai",
               party_b_age=33, party_b_address="No. 5, Besant Nagar, Chennai")
    assert "JOINT AFFIDAVIT OF THE PETITIONERS" in t
    assert "We, 1. Anita, aged about 37 years, residing at No. 21, T. Nagar, Chennai, " \
           "and 2. Rakesh, aged about 33 years" in t
    assert "do hereby jointly and solemnly affirm" in t
    assert "signed their names in my presence" in t
    assert "DEPONENT NO. 1" in t and "DEPONENT NO. 2" in t


# -- 2. parties and cause title ----------------------------------------------

def test_state_respondent_helper_worked_example():
    assert state_respondent("All Women Police Station, Salem Town", "Crime No. 45 of 2026") \
        == ("State rep. by the Inspector of Police, All Women Police Station, Salem "
            "Town, (Crime No. 45 of 2026)")
    assert state_respondent("Egmore") == \
        "State rep. by the Inspector of Police, Egmore Police Station"
    assert state_respondent(None).endswith("[police station to be provided]")
    # an existing State respondent is not doubled; placeholders drop out
    assert with_state(["State rep. by Inspector of Police, E4"], "E4") == \
        ["State rep. by Inspector of Police, E4"]
    assert with_state(["[respondent names to be provided]"], "E4")[0].startswith("State")


def test_quash_fir_arrays_state_first_with_crime_no():
    t = _draft("quash_petition", respondent_names=["Mrs. R. Sangeetha"],
               proceeding_ref="Crime No. 45 of 2026",
               proceeding_forum="All Women Police Station, Salem Town")
    assert ("State rep. by the Inspector of Police, All Women Police Station, Salem "
            "Town, (Crime No. 45 of 2026)\nMrs. R. Sangeetha") in t
    assert "... RESPONDENTS" in t


def test_quash_private_complaint_has_no_state():
    t = _draft("quash_petition", target="private_complaint",
               respondent_names=["K. Kumar"], proceeding_ref="C.C. No. 4 of 2025",
               proceeding_forum="Judicial Magistrate No. I, Salem")
    assert "State rep. by the Inspector of Police" not in t


def test_criminal_appeal_arrays_state():
    t = _draft("criminal_appeal", respondent_names=["[respondent names to be provided]"],
               police_station="Manachanallur", crime_no="Crime No. 88 of 2022")
    assert ("State rep. by the Inspector of Police, Manachanallur Police Station, "
            "(Crime No. 88 of 2022)") in t
    assert "[respondent names to be provided]" not in t


def test_criminal_appeal_private_complaint_keeps_complainant_only():
    t = _draft("criminal_appeal", respondent_names=["K. Kumar"], private_complaint=True)
    assert "State rep. by" not in t and "K. Kumar" in t


def test_surrender_petition_state_and_court_name():
    t = _draft("surrender_petition", police_station="Thoothukudi South Police Station",
               court_name="Judicial Magistrate No. II, Thoothukudi",
               court_place="Thoothukudi")
    assert "IN THE COURT OF THE JUDICIAL MAGISTRATE NO. II, THOOTHUKUDI" in t
    assert "State rep. by the Inspector of Police, Thoothukudi South Police Station" in t
    assert "(Crime No. 55/2026)" in t        # 'Cr. 55/2026' -> no doubled prefix


def test_substituted_service_court_name_from_field():
    t = _draft("substituted_service", court_name="Additional Subordinate Court",
               court_place="Kumbakonam")
    assert "IN THE ADDITIONAL SUBORDINATE COURT, KUMBAKONAM" in t
    assert "IN THE COURT OF ______" not in t


def test_writ_criminal_arrays_state_and_prison():
    t = _draft("writ_criminal",
               respondents=["The District Collector and District Magistrate, Pudukkottai",
                            "The Government (to which the representation was made)"],
               pre_execution_stage=False, detention_place="Central Prison, Tiruchirappalli",
               police_station="Pudukkottai Town", high_court="Madurai Bench")
    assert "The State of Tamil Nadu, rep. by the Additional Chief Secretary" in t
    assert "The Government (to which" not in t
    # 2026-11-07 (suite r10 review): the jailor is "The Superintendent, Central
    # Prison, Tiruchirappalli", not "The Superintendent of Prison, Central Prison, …".
    assert "The Superintendent, Central Prison, Tiruchirappalli" in t
    assert "The Inspector of Police, Pudukkottai Town Police Station (sponsoring authority)" in t


@pytest.mark.parametrize("doc_type,court", [
    ("criminal_appeal", "Madurai Bench of the Madras High Court"),
    ("criminal_revision", "IN MADRAS HIGH COURT"),
])
def test_hc_title_form(doc_type, court):
    t = _draft(doc_type, court_name=court)
    assert "IN THE HIGH COURT OF JUDICATURE AT MADRAS" in t
    assert "IN MADURAI BENCH OF" not in t and "IN MADRAS HIGH COURT" not in t
    assert ("(MADURAI BENCH)" in t) == ("Madurai" in court)


def test_quash_hc_title_form_madurai():
    t = _draft("quash_petition", high_court="Madras High Court", bench="Madurai Bench")
    assert "IN THE HIGH COURT OF JUDICATURE AT MADRAS\n(MADURAI BENCH)" in t \
        or ("IN THE HIGH COURT OF JUDICATURE AT MADRAS" in t and "(MADURAI BENCH)" in t)
    assert "IN MADRAS HIGH COURT" not in t


def test_dv_application_keeps_every_respondent():
    t = _draft("dv_application", respondent_names=["Mr. V. Sathish", "Mrs. V. Kamala"],
               respondent_name="Mr. V. Sathish")
    assert "1. Mr. V. Sathish\n2. Mrs. V. Kamala" in t and "... Respondents" in t
    assert "(2) Mrs. V. Kamala" in t


def test_amendment_ia_two_respondents():
    t = _draft("amendment_ia", respondent_names=["S. Kumar", "S. Ravi"])
    assert "1. S. Kumar\n2. S. Ravi" in t and "RESPONDENTS / DEFENDANTS" in t


@pytest.mark.parametrize("doc_type", ["judicial_separation", "restitution_conjugal_rights"])
def test_no_marriage_registered_without_the_field(doc_type):
    base = _draft(doc_type, marriage_registered=False)
    assert "marriage is registered" not in base
    from tests.service.test_all_adapters_roundtrip import PAYLOADS
    fields = {k: v for k, v in PAYLOADS[doc_type].items() if k != "marriage_registered"}
    from tests.documents.test_tn_layout import _client
    body = _client.post(f"/v1/draft/{doc_type}", json={
        "matter": {"matter_id": "M", "version": 1}, "fields": fields}).json()
    t = "\n".join(b["text"] for b in body["blocks"])
    assert "marriage is registered" not in t
    assert "marriage is registered" in _draft(doc_type, marriage_registered=True)


# -- 3. computed sums and dates ----------------------------------------------

def test_simple_interest_worked_example():
    # Rs. 4,10,000 at 18% from 05.01.2026 to 03.11.2026 = 302 days -> Rs. 61,062
    i = intr.simple(410000, 18, date(2026, 1, 5), date(2026, 11, 3))
    assert (i.days, i.amount) == (302, 61062)
    assert i.text == ("Rs. 4,10,000 at 18% p.a. from 05.01.2026 to 03.11.2026 "
                      "(302 days) = Rs. 61,062")


def test_fill_claim_tranches_and_given_figures():
    # two invoices, each from its own date: 61,062 + 54,710 = 1,15,772
    interest, total, working = intr.fill_claim(
        840000, None, None, 18, date(2026, 7, 14), date(2026, 11, 3),
        [(410000, date(2026, 1, 5)), (430000, date(2026, 2, 18))])
    assert (interest, total, len(working)) == (115772, 955772, 2)
    # given figures are kept, nothing computed
    assert intr.fill_claim(100000, 12000, 112000, 18, date(2023, 1, 1),
                           date(2024, 5, 1)) == (12000, 112000, [])
    # a zero total is "missing" -> computed
    assert intr.fill_claim(100000, 0, 0, 12, date(2025, 1, 1), date(2026, 1, 1))[1] == 112000


def test_plaint_computes_interest_total_and_court_fee():
    t = _draft("plaint", interest_amount=None, claimed_total=None,
               interest_rate=18, cause_of_action_date="2023-01-01",
               filing_date="2024-01-01")
    # 1,00,000 x 18% x 365/365 = 18,000
    assert "interest Rs. 18,000/-" in t and "total claimed Rs. 1,18,000/-" in t
    assert "Rs. 1,00,000 at 18% p.a. from 01.01.2023 to 01.01.2024 (365 days)" in t
    assert "COURT FEE" in t and "Rs. 0/-" not in t


def test_summary_suit_computes_interest_from_given_date():
    t = _draft("summary_suit", interest_amount=None, claimed_total=None,
               interest_rate=12, interest_from_date="2023-07-01",
               filing_date="2024-07-01")
    # 1,00,000 x 12% x 366/365 = 12,033 (2024 is a leap year)
    assert "interest Rs. 12,033/-" in t and "total claimed Rs. 1,12,033/-" in t


def test_arrears_and_damages_worked_examples():
    a = intr.arrears_of_rent(12000, date(2026, 1, 1), date(2026, 8, 23))
    assert (a.days, a.amount) == (8, 96000)       # January to August 2026
    d = intr.damages_for_period(20000, "month", date(2026, 8, 24), date(2026, 11, 3))
    assert d.amount == 46667                       # 2 months + 10/30 of a month
    assert "(2 months and 10 days)" in d.text
    assert intr.damages_for_period(1000, "day", date(2024, 1, 1),
                                   date(2024, 3, 1)).amount == 60000


def test_ejectment_prayer_carries_arrears_and_damages():
    t = _draft("ejectment", damages_rate_per_day=None, monthly_rent=12000,
               arrears_from_date="2023-06-01", damages_rate_per_month=20000,
               wrongful_occupation_since="2024-01-01")
    assert "arrears of rent up to the termination of the tenancy are: Rs. 12,000 per " \
           "month for 7 months (June 2023 to December 2023) = Rs. 84,000" in t
    assert "decree for Rs. 84,000/- towards arrears of rent" in t
    assert "towards damages for use and occupation from 01.01.2024" in t
    assert "future damages for use and occupation at Rs. 20,000/- per month" in t
    assert "Rs. 0/-" not in t


def test_ejectment_optional_reliefs_absent_when_not_given():
    t = _draft("ejectment")
    assert "arrears of rent" not in t
    assert "per day" in t and "Rs. 0/-" not in t


def test_condone_delay_copy_applied_after_expiry_not_excluded():
    # order 12.06.2026, 30 days -> last day 12.07.2026; copy applied 26.09.2026
    # (after expiry) is NOT excluded; filed 04.11.2026 -> delay 115 days
    w = aw.window(order_date=date(2026, 6, 12), filing_date=date(2026, 11, 4),
                  period_days=30, proceeding_class=lim.ProceedingClass.APPEAL,
                  copy_applied=date(2026, 9, 26), copy_ready=date(2026, 10, 8))
    assert (w.expiry, w.delay_days, w.copy_excluded) == (date(2026, 7, 12), 115, False)
    # applied within the period: the 12 days are excluded
    w2 = aw.window(order_date=date(2026, 6, 12), filing_date=date(2026, 11, 4),
                   period_days=30, proceeding_class=lim.ProceedingClass.APPEAL,
                   copy_applied=date(2026, 7, 1), copy_ready=date(2026, 7, 13))
    assert (w2.expiry, w2.delay_days, w2.copy_excluded) == (date(2026, 7, 24), 103, True)


def test_condone_delay_petition_says_copy_time_not_excluded():
    t = _draft("condone_delay_petition", impugned_order_date="2026-06-12",
               filing_date="2026-11-04", copy_applied_date="2026-09-26",
               copy_ready_date="2026-10-08")
    assert "after the period had expired" in t and "DELAY OF 115 DAYS" in t
    assert "excluding the time requisite" not in t


def test_default_bail_period_counts_remand_day():
    # first remand 10.08.2026, 60 days: the remand day is day 1 (Ravi Prakash
    # Singh, SC 2023) -> the 60th day is 08.10.2026; the right accrues 09.10.2026
    p = cc.default_bail_period(first_remand_date=date(2026, 8, 10),
                               offence=cc.Offence(max_punishment_years=7))
    assert (p.period_days, p.last_day, p.accrual_date) == \
        (60, date(2026, 10, 8), date(2026, 10, 9))
    t = _draft("default_bail")
    assert "expired on 01.03.2024" in t and "accrued on 02.03.2024" in t


def test_mact_heads_printed_with_figures():
    t = _draft("mact_claim", victim_age=34, victim_annual_income=540000)
    # 5,40,000 + 50% = 8,10,000; less 1/3 = 5,40,000; x 16 = 86,40,000
    assert "Annual income Rs. 5,40,000/- plus future prospects at 50% (Rs. 2,70,000/-)" \
           " = Rs. 8,10,000/-" in t
    assert "Less one-third towards the personal expenses" in t
    assert "multiplicand of Rs. 5,40,000/- per annum" in t
    assert "Rs. 5,40,000/- x 16 = Rs. 86,40,000/-" in t


def test_execution_interest_under_decree():
    t = _draft("execution_application", decree_interest_rate=9,
               interest_from_date="2022-06-03", filing_date="2026-11-04",
               decretal_amount=780000, costs_amount=42500)
    # 7,80,000 x 9% x 1615/365 = 3,10,611; with costs 11,33,111
    assert "interest: Rs. 3,10,611/-" in t
    assert "(1615 days)" in t and "total due with costs: Rs. 11,33,111/-" in t


def test_s138_reply_date_is_never_the_notice_date():
    t = _draft("s138_reply")
    assert f"Dated: {date.today():%d.%m.%Y}" in t
    assert "Dated: 09.06.2015" not in t
    assert "Dated: 20.06.2015" in _draft("s138_reply", reply_date="2015-06-20")


def test_divorce_mutual_second_date_is_its_own():
    t = _draft("divorce_mutual_second")
    assert "01.09.2024" in t.split("Counsel for the Petitioners")[0].splitlines()[-1]
    from tests.service.test_all_adapters_roundtrip import PAYLOADS
    from src.pipelines import divorce_mutual as dm
    kw = {k: v for k, v in PAYLOADS["divorce_mutual_second"].items()
          if k != "second_motion_date"}
    kw["first_motion_order_date"] = date.today().replace(year=date.today().year - 1)
    r = dm.build_second_motion(second_motion_date=None, **kw)
    assert r.context["petition_date"] == date.today().isoformat()


# -- 4. law per format -------------------------------------------------------

def test_civil_revision_interlocutory_defaults_to_art227():
    t = _draft("civil_revision", basis=None)
    assert "ARTICLE 227 OF THE CONSTITUTION OF INDIA" in t
    assert "C.R.P.(PD)" in t
    assert "would have finally disposed of" not in t


def test_criminal_revision_ni_act_prayer_seeks_acquittal():
    t = _draft("criminal_revision", respondent_names=["K. Ramasamy"],
               convicted_sections=["Section 138 of the NI Act"],
               impugned_order_ref="judgment in C.A. No. 22 of 2025")
    assert "Section 138 of the Negotiable Instruments Act, 1881" in t
    assert "Section 139 of that Act is rebuttable" in t
    assert "and acquit the petitioner of the offence under Section 138 of the " \
           "Negotiable Instruments Act, 1881" in t
    assert "acquit" not in _draft("criminal_revision")


def test_succession_probate_s276_and_testatrix():
    t = _draft("succession_grant", deceased_gender="female")
    assert "SECTION 276 OF THE INDIAN SUCCESSION ACT, 1925 FOR GRANT OF PROBATE" in t
    assert "testatrix affix her signature" in t and " his " not in t.split("VERIFICATION")[0]
    assert "testator/testatrix" in _draft("succession_grant")


def test_quash_prints_sections_from_field():
    t = _draft("quash_petition", sections=["Section 85 BNS", "[sections to be provided]"])
    assert "offences under Section 85 BNS" in t
    assert "[sections to be provided]" not in t


def test_maintenance_family_court_s7_2_a():
    t = _draft("maintenance", magistrate_court="Family Court, Chennai")
    assert "Section 7(2)(a) of the Family Courts Act, 1984" in t
    assert "Explanation (f)" not in t
    assert "Family Courts Act" not in _draft("maintenance",
                                             magistrate_court="Judicial Magistrate No. I")


def test_hrcp_free_text_grounds_map_to_clauses():
    assert classify_ground("Default in payment of rent: no rent since May 2026") \
        == "arrears_of_rent"
    assert classify_ground("Bona fide requirement of the landlord for his son's "
                           "business") == "own_occupation"
    assert classify_ground("The tenant has sub-let a portion") == "parted_with_possession"
    assert classify_ground("arrears_of_rent") == "arrears_of_rent"
    assert classify_ground("something else entirely") is None
    t = _draft("hrcp_eviction", grounds=["Default in payment of rent from May 2026"])
    assert "Clause (b):" in t and "Particulars: Default in payment of rent from May 2026" in t


def test_indigent_schedule_is_petitioners_own_assets():
    t = _draft("indigent_application",
               petitioner_assets=["Household articles and jewellery worth Rs. 15,000"],
               suit_property_schedule=["3 acres of dry land, Sankarapuram"],
               respondent_names=["P. Murugan", "P. Ganesan"],
               relief_claimed="partition and separate possession of a one-third share")
    own = t.split("BELONGING TO THE PETITIONER")[1].split("SCHEDULE OF THE SUIT")[0]
    assert "Household articles" in own and "3 acres" not in own
    assert "SCHEDULE OF THE SUIT PROPERTY:" in t and "3 acres of dry land" in t
    assert "1. P. Murugan\n2. P. Ganesan" in t
    assert "RELIEF CLAIMED IN THE SUIT: partition" in t


# -- prayers carry every relief asked for -------------------------------------

def test_specific_performance_optional_reliefs():
    t = _draft("specific_performance", alternative_refund=True, refund_interest_rate=12,
               injunction_against_alienation=True)
    assert "(b) in the alternative, if specific performance is refused" in t
    assert "refund the earnest money of Rs. 10,00,000/-" in t and "12% per annum" in t
    assert "(c) grant a permanent injunction restraining the defendant" in t
    assert "(d) award the costs of the suit" in t
    base = _draft("specific_performance")
    assert "in the alternative" not in base and "permanent injunction" not in base
    assert "(b) award the costs of the suit" in base


def test_o39_r2a_prayer_matches_the_breach():
    t = _draft("o39_r2a_application",
               construction_to_remove="the brick wall about 5 feet high raised across "
                                      "the common passage")
    assert "remove the brick wall about 5 feet high" in t
    assert "restore the status quo ante" in t
    assert "civil prison for a term not exceeding three months" in t
    assert "restoration of possession" not in t
    assert "remove the" not in _draft("o39_r2a_application")


def test_dv_prayer_lists_each_order_sought():
    t = _draft("dv_application", reliefs=[
        {"head": "s.18 protection", "averment": "restrain violence"},
        {"head": "s.19 residence", "averment": "restrain dispossession"},
        {"head": "s.20 monetary", "averment": "Rs. 30,000 per month"},
        {"head": "s.21 custody", "averment": "of the son, aged 5"},
        {"head": "s.22 compensation", "averment": "Rs. 5,00,000"},
    ], shared_household_pleaded=True, shared_household_particulars="No. 44")
    for s in ("Section 18", "Section 19", "Section 20", "Section 21", "Section 22"):
        assert s in t.split("PRAYER:")[1]
    assert "reliefs set out in para 5" not in t
    one = _draft("dv_application").split("PRAYER:")[1]
    assert "Section 18" in one and "Section 20" not in one


def test_suspension_companion_petition_only_when_flagged():
    t = _draft("criminal_appeal", draft_suspension_petition=True)
    assert "PETITION UNDER SECTION 430 BNSS" in t and "CRL.M.P. No." in t
    assert "suspend the sentence imposed by the judgment dated" in t
    assert "CRL.M.P." not in _draft("criminal_appeal")
    r = _draft("criminal_revision", draft_suspension_petition=True)
    assert "SECTION 430 BNSS READ WITH SECTION 442 BNSS" in r
