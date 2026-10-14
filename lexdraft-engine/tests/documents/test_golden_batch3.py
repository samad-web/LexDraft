"""Golden-file tests for the Batch-3 pleadings (new-from-DPC-book pipelines).

One test per document. Each builds a non-refused result with realistic Tamil Nadu
inputs and pins the rendered text. Refusal-path coverage lives in the per-pipeline
unit tests; these golden tests pin the faithful book structure.
"""

import os
from datetime import date
from pathlib import Path

import pytest

from src.components.render import extract_text
from ._golden import render_golden

GOLDEN_DIR = Path(__file__).parent / "golden"
UPDATE = os.environ.get("LEXDRAFT_UPDATE_GOLDEN") == "1"


def _assert_golden(name: str, text: str):
    GOLDEN_DIR.mkdir(exist_ok=True)
    path = GOLDEN_DIR / f"{name}.txt"
    if UPDATE or not path.exists():
        path.write_text(text, encoding="utf-8")
        if not UPDATE:
            pytest.skip(f"golden {name} created; rerun to assert")
        return
    assert text == path.read_text(encoding="utf-8"), f"{name} drifted from golden"


def _render(template, context, tmp_path, name):
    out = tmp_path / f"{name}.docx"
    render_golden(template, context, out)
    return extract_text(out)


def test_golden_permanent_injunction(tmp_path):
    from src.pipelines import permanent_injunction as pi
    r = pi.build(
        plaintiff_name="Om Veer Singh", defendant_names=["Dr. U. Basu", "Tapan Kumar"],
        suit_property="the tenanted premises at 12 North Street, Mylapore, Chennai",
        possession_basis="the plaintiff is a tenant in settled possession for many years",
        act_restrained="dispossessing the plaintiff forcibly and illegally from the "
                       "tenanted premises and interfering with his peaceful possession",
        threat_narrative="",
        cause_of_action_date=date(2024, 3, 1), cause_of_action_place="Chennai",
        court_fee=200, valuation="Rs. 2,00,000/-",
        jurisdiction_basis="the suit property is situated within the territorial "
                           "jurisdiction of this Court",
        filing_date=date(2024, 5, 1), place="Chennai",
        civil_court="THE CIVIL JUDGE (SENIOR DIVISION)", city="Chennai",
    )
    assert r.refused is False
    _assert_golden("permanent_injunction",
                   _render(pi.TEMPLATE, r.context, tmp_path, "permanent_injunction"))


def test_golden_specific_performance(tmp_path):
    from src.pipelines import specific_performance as sp
    r = sp.build(
        plaintiff_name="Ravi Kumar", defendant_name="Suresh Babu",
        suit_property="Plot No. 45, admeasuring 2400 sq.ft., Anna Nagar, Chennai",
        agreement_date=date(2023, 6, 1),
        agreement_ref="agreement to sell dated 01-06-2023",
        total_consideration=5000000, earnest_paid=1000000, balance_amount=4000000,
        readiness_and_willingness=True, refusal_narrative="",
        notice_ref="legal notice dated 01-12-2023",
        cause_of_action_date=date(2023, 9, 1), cause_of_action_place="Chennai",
        court_fee=50000, filing_date=date(2024, 2, 1), place="Chennai",
        civil_court="THE SUBORDINATE JUDGE", city="Chennai",
    )
    assert r.refused is False
    _assert_golden("specific_performance",
                   _render(sp.TEMPLATE, r.context, tmp_path, "specific_performance"))


def test_golden_ejectment(tmp_path):
    from src.pipelines import ejectment as ej
    r = ej.build(
        plaintiff_names=["Surjit Kaur Sahi", "Avinder Singh Sahi"],
        defendant_name="Power Grid Corporation of India Ltd.",
        suit_premises="Flat No. 7, Nehru Place Towers, Chennai",
        lease_ref="unregistered lease deed dated 01-04-2020",
        lease_expiry_date=date(2023, 3, 31),
        s106_notice_ref="notice dated 20-11-2023",
        s106_notice_served_date=date(2023, 11, 25),
        tenancy_end_date=date(2023, 12, 31),
        damages_rate_per_day=1000, wrongful_occupation_since=date(2024, 1, 1),
        annual_rent=81696, court_fee=6000,
        cause_of_action_date=date(2024, 1, 1), cause_of_action_place="Chennai",
        jurisdiction_basis="the premises are situated within the territorial "
                           "jurisdiction of this Court",
        filing_date=date(2024, 3, 1), place="Chennai",
        civil_court="SUBORDINATE JUDGE", city="Chennai",
        defendant_address="Nehru Place Towers, Chennai",
    )
    assert r.refused is False
    _assert_golden("ejectment", _render(ej.TEMPLATE, r.context, tmp_path, "ejectment"))


def test_golden_indigent(tmp_path):
    from src.pipelines import indigent_application as ia
    r = ia.build(
        applicant_name="Murugan", respondent_name="Selvam",
        suit_ref="the suit for recovery of possession",
        indigency_pleaded=True,
        indigency_particulars="the applicant has no movable or immovable property "
                              "and no source of income",
        undertakes_to_pay_if_decreed=True,
        filing_date=date(2024, 4, 1), place="Chennai",
        civil_court="THE CIVIL JUDGE (SENIOR DIVISION)", city="Chennai",
    )
    assert r.refused is False
    _assert_golden("indigent_application",
                   _render(ia.TEMPLATE, r.context, tmp_path, "indigent_application"))


def test_golden_o39_r2a(tmp_path):
    from src.pipelines import o39_r2a_application as o39
    r = o39.build(
        applicant_name="ABC", respondent_name="XYZ",
        suit_ref="O.S. No. 200 of 2023",
        injunction_order_date=date(2023, 8, 1), respondent_had_knowledge=True,
        disobedience_narrative="took forcible possession of the suit premises with "
                               "the help of anti-social elements and threw the "
                               "applicant's household goods on the roadside",
        disobedience_date=date(2024, 1, 15), property_list_attached=True,
        filing_date=date(2024, 2, 1), place="Chennai",
        civil_court="THE SENIOR CIVIL JUDGE", city="Chennai",
    )
    assert r.refused is False
    _assert_golden("o39_r2a_application",
                   _render(o39.TEMPLATE, r.context, tmp_path, "o39_r2a_application"))


def test_golden_caveat(tmp_path):
    from src.pipelines import caveat as cv
    r = cv.build(
        caveator_name="ABC", expected_petitioner_name="XYZ",
        impugned_order_ref="the order in Civil Suit No. 100 of 2023",
        impugned_order_date=date(2024, 1, 10),
        lower_court="the Civil Judge, Chennai District",
        apprehended_proceeding="a Civil Misc. (Main) Petition under Article 227 of "
                               "the Constitution of India",
        copy_served_on_petitioner=True,
        filing_date=date(2024, 2, 1), place="Chennai",
        court_name="HIGH COURT OF JUDICATURE AT MADRAS",
    )
    assert r.refused is False
    _assert_golden("caveat", _render(cv.TEMPLATE, r.context, tmp_path, "caveat"))


def test_golden_transfer_petition(tmp_path):
    from src.pipelines import transfer_petition as tp
    r = tp.build(
        petitioner_name="J. Mishra",
        respondents=["Union of India, through its Secretary, Ministry of Defence",
                     "Chief of Air Staff, New Delhi"],
        case_to_transfer="Civil Writ Petition No. 727 of 2015",
        from_court="the High Court of Delhi at New Delhi", from_state="Delhi",
        to_court="the High Court of Judicature at Madras", to_state="Tamil Nadu",
        brief_facts="",
        grounds=["the petitioner has no means to travel to Delhi for the conduct of "
                 "the case",
                 "it would be in the interest of justice to transfer the case"],
        no_other_transfer_petition=True,
        filing_date=date(2024, 3, 1), place="New Delhi",
    )
    assert r.refused is False
    _assert_golden("transfer_petition",
                   _render(tp.TEMPLATE, r.context, tmp_path, "transfer_petition"))


def test_golden_execution(tmp_path):
    from src.pipelines import execution_application as ex
    r = ex.build(
        decree_holder_name="A", judgment_debtor_name="B",
        execution_court="the Principal District Judge, Chennai",
        suit_no="Civil Suit No. 150 of 2015", decree_date=date(2023, 12, 1),
        appeal_filed=False, payment_received="Nil", prior_applications="Nil",
        decretal_amount=419200, interest_note="with interest at 18% per annum",
        costs_amount=15000, execution_against="the judgment-debtor B",
        mode_of_assistance="attachment and sale of the judgment-debtor's property",
        certified_copy_attached=True,
        filing_date=date(2024, 2, 1), place="Chennai",
    )
    assert r.refused is False
    _assert_golden("execution_application",
                   _render(ex.TEMPLATE, r.context, tmp_path, "execution_application"))


def test_golden_rcr(tmp_path):
    from src.pipelines import restitution_conjugal_rights as rcr
    r = rcr.build(
        petitioner_name="Ramesh", respondent_name="Lakshmi",
        marriage_date=date(2018, 5, 1), marriage_place="Chennai",
        marriage_registered=True, withdrawal_date=date(2023, 6, 1),
        withdrawal_narrative="the respondent left the matrimonial home and has "
                             "refused to return despite repeated requests",
        no_collusion=True, no_undue_delay=True,
        last_resided_together="12 South Street, T. Nagar, Chennai",
        jurisdiction_basis="the parties last resided together within the "
                           "jurisdiction of this Court",
        filing_date=date(2024, 1, 1), place="Chennai",
        family_court="THE PRINCIPAL JUDGE, FAMILY COURT", city="Chennai",
    )
    assert r.refused is False
    _assert_golden("restitution_conjugal_rights",
                   _render(rcr.TEMPLATE, r.context, tmp_path, "rcr"))


def test_golden_judicial_separation(tmp_path):
    from src.pipelines import judicial_separation as js
    r = js.build(
        petitioner_name="Ramesh", respondent_name="Lakshmi",
        marriage_date=date(2018, 5, 1), marriage_place="Chennai",
        marriage_registered=True, ground=js.Ground.CRUELTY,
        ground_narrative="the respondent subjected the petitioner to mental and "
                         "physical cruelty on several occasions",
        no_condonation=True, no_connivance=True, no_collusion=True,
        no_undue_delay=True,
        last_resided_together="12 South Street, T. Nagar, Chennai",
        jurisdiction_basis="the parties last resided together within the "
                           "jurisdiction of this Court",
        filing_date=date(2024, 1, 1), place="Chennai",
        family_court="THE PRINCIPAL JUDGE, FAMILY COURT", city="Chennai",
    )
    assert r.refused is False
    _assert_golden("judicial_separation",
                   _render(js.TEMPLATE, r.context, tmp_path, "judicial_separation"))


def test_golden_probate(tmp_path):
    from src.pipelines import succession_grant as sg
    r = sg.build(
        grant_kind=sg.GrantKind.PROBATE, petitioner_name="Ramesh Kumar",
        deceased_name="Krishnan", death_date=date(2023, 4, 1),
        deceased_last_residence="15 Gandhi Road, Adyar, Chennai",
        will_date=date(2020, 1, 15), will_duly_executed=True,
        bequest_narrative="the residential house to the petitioner (son) and the "
                          "bank deposits to the widow",
        relatives=[sg.Relative("Son (Petitioner)", "Ramesh Kumar", "Adyar, Chennai"),
                   sg.Relative("Widow", "Kamala", "Adyar, Chennai")],
        petitioner_is_named_executor=True, petitioner_standing="",
        assets_schedule_ref="Schedule-A annexed",
        undertakes_further_court_fee=True, no_impediment=True,
        jurisdiction_basis="the deceased had a fixed abode within the jurisdiction "
                           "of this Court",
        filing_date=date(2024, 1, 1), place="Chennai",
        grant_court="HIGH COURT OF JUDICATURE AT MADRAS "
                    "(TESTAMENTARY & INTESTATE JURISDICTION)",
    )
    assert r.refused is False
    _assert_golden("succession_probate",
                   _render(sg.TEMPLATE, r.context, tmp_path, "probate"))


def test_golden_letters_of_administration(tmp_path):
    from src.pipelines import succession_grant as sg
    r = sg.build(
        grant_kind=sg.GrantKind.LETTERS_OF_ADMINISTRATION,
        petitioner_name="Kamala", deceased_name="Krishnan",
        death_date=date(2023, 4, 1),
        deceased_last_residence="15 Gandhi Road, Adyar, Chennai",
        will_date=date(2020, 1, 15), will_duly_executed=True,
        bequest_narrative="the estate to the widow and the son in equal shares",
        relatives=[sg.Relative("Widow (Petitioner)", "Kamala", "Adyar, Chennai"),
                   sg.Relative("Son", "Ramesh Kumar", "Adyar, Chennai")],
        petitioner_is_named_executor=False,
        petitioner_standing="the beneficiary named in the will",
        assets_schedule_ref="Schedule-A annexed",
        undertakes_further_court_fee=True, no_impediment=True,
        jurisdiction_basis="the deceased had a fixed abode within the jurisdiction "
                           "of this Court",
        filing_date=date(2024, 1, 1), place="Chennai",
        grant_court="THE PRINCIPAL DISTRICT JUDGE", city="Chennai",
    )
    assert r.refused is False
    _assert_golden("succession_letters_of_administration",
                   _render(sg.TEMPLATE, r.context, tmp_path, "loa"))


def test_golden_succession_certificate(tmp_path):
    from src.pipelines import succession_certificate as sc
    r = sc.build(
        petitioner_name="Kamala", deceased_name="Krishnan",
        death_date=date(2023, 4, 1), deceased_residence="Adyar, Chennai",
        law_of_succession="the Mitakshara School of Hindu Law",
        diligent_search_no_will=True, next_of_kin="the widow and the son",
        petitioner_relation="widow",
        securities=[sc.Security("Fixed Deposit No. 12345 with State Bank of India, "
                                "Adyar Branch", 500000),
                    sc.Security("Savings Account No. 67890 with Indian Bank", 200000)],
        purpose="collecting the debts and securities of the deceased",
        no_impediment_s370=True, no_prior_application=True,
        ad_valorem_duty_paid=True,
        filing_date=date(2024, 1, 1), place="Chennai",
        grant_court="THE PRINCIPAL DISTRICT JUDGE", city="Chennai",
    )
    assert r.refused is False
    _assert_golden("succession_certificate",
                   _render(sc.TEMPLATE, r.context, tmp_path, "succession_certificate"))


def test_golden_writ_criminal(tmp_path):
    from src.pipelines import writ_criminal as wc
    r = wc.build(
        petitioner_name="Mr. N",
        respondents=["Union of India, through the Secretary, Ministry of Finance",
                     "The Joint Secretary (PITNDPS)"],
        impugned_order_ref="Detention Order No. U-11011/1/2012-PITNDPS",
        impugned_order_date=date(2013, 9, 10),
        impugned_order_statute="s.3(1) of the Prevention of Illicit Traffic in "
                               "Narcotic Drugs and Psychotropic Substances Act, 1988",
        facts_narrative="",
        grounds=["there has been long and undue delay in the execution of the "
                 "impugned detention order",
                 "the detention order was passed on a stale incident"],
        pre_execution_stage=True, no_similar_petition=True,
        filing_date=date(2016, 5, 1), place="Chennai",
        high_court="Madras",
    )
    assert r.refused is False
    _assert_golden("writ_criminal",
                   _render(wc.TEMPLATE, r.context, tmp_path, "writ_criminal"))


def test_golden_slp_civil(tmp_path):
    from src.pipelines import special_leave_petition as slp
    r = slp.build(
        slp_kind=slp.SLPKind.CIVIL, petitioner_name="Vasant Bhavsar",
        respondents=["Digambar", "Hari"],
        impugned_court="the High Court of Judicature at Madras",
        impugned_judgment_date=date(2015, 12, 14),
        impugned_case_ref="Civil Writ Petition No. 5427 of 2004",
        questions_of_law=["Whether the High Court was justified in dismissing the "
                          "writ petition"],
        grounds=["the High Court erred in passing the impugned judgment",
                 "the impugned judgment suffers from an error apparent on the face "
                 "of the record"],
        no_other_slp=True, annexures_true_copies=True,
        filing_date=date(2016, 2, 1), brief_facts="",
        interim_relief_sought="the petitioner apprehends that the respondents may "
                              "alienate the property",
        place="New Delhi",
    )
    assert r.refused is False
    _assert_golden("slp_civil", _render(slp.TEMPLATE, r.context, tmp_path, "slp_civil"))


def test_golden_slp_criminal(tmp_path):
    from src.pipelines import special_leave_petition as slp
    r = slp.build(
        slp_kind=slp.SLPKind.CRIMINAL, petitioner_name="N. Singh",
        respondents=["State of Tamil Nadu, through the Home Secretary"],
        impugned_court="the High Court of Judicature at Madras",
        impugned_judgment_date=date(2015, 11, 26),
        impugned_case_ref="Criminal Appeal No. 305 of 2013",
        questions_of_law=[],
        grounds=["the judgment of the High Court is contrary to law and facts",
                 "the prosecution failed to prove its case beyond reasonable doubt"],
        no_other_slp=True, annexures_true_copies=True,
        filing_date=date(2016, 2, 1), brief_facts="",
        interim_relief_sought="",
        place="New Delhi",
    )
    assert r.refused is False
    _assert_golden("slp_criminal",
                   _render(slp.TEMPLATE, r.context, tmp_path, "slp_criminal"))


def test_golden_contempt(tmp_path):
    from src.pipelines import contempt_petition as cp
    r = cp.build(
        petitioner_names=["X", "Y"],
        respondents=["Union of India", "The Development Authority, through its "
                     "Vice-Chairman"],
        parent_case_ref="Civil Writ Petition No. 2420 of 2023",
        order_disobeyed_date=date(2023, 10, 1),
        order_nature="an order granting status quo and restraining the respondents "
                     "from demolishing the construction",
        contemnors_had_knowledge=True,
        disobedience_narrative="demolished the construction raised on the "
                               "petitioners' plots",
        contempt_committed_date=date(2024, 1, 4),
        filing_date=date(2024, 6, 1), place="Chennai",
        high_court="Madras",
        petitioner_addresses=["Anna Nagar, Chennai", "Anna Nagar, Chennai"],
    )
    assert r.refused is False
    _assert_golden("contempt_petition",
                   _render(cp.TEMPLATE, r.context, tmp_path, "contempt_petition"))
