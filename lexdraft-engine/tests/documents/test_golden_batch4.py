"""Golden-file tests for the Batch-4 conveyancing deeds + notices (DPC book Part B)."""

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


def _r(template, context, tmp_path, name):
    out = tmp_path / f"{name}.docx"
    render_golden(template, context, out)
    return extract_text(out)


def test_golden_will(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_will(
        testator_name="Rajan", testator_parentage="S/o Late Krishnan",
        testator_address="13 Gandhi Street, Adyar, Chennai",
        execution_date=date(2024, 1, 1),
        bequests=[cv.Bequest("the residential house at 13 Gandhi Street", "my wife "
                             "Kamala", "wife"),
                  cv.Bequest("all my movable property and bank deposits", "my son "
                             "Ramesh", "son")],
        sound_mind_declared=True, witnesses=["A. Menon, Advocate", "B. Iyer, Doctor"],
        place="Chennai", executor_name="Ramesh",
    )
    assert r.refused is False
    _assert_golden("will", _r(r.template, r.context, tmp_path, "will"))


def test_golden_gpa(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_power_of_attorney(
        poa_kind=cv.POAKind.GENERAL, executant_name="M/s Tinrin Pvt. Ltd.",
        executant_description="through its Managing Director",
        attorney_name="S. Y.", attorney_description="Executive Director",
        powers=["To institute and conduct legal proceedings on behalf of the company",
                "To defend all suits and proceedings brought against the company",
                "To appear and represent the company before any court or tribunal"],
        execution_date=date(2024, 1, 1),
        witnesses=["Witness A", "Witness B"], place="Chennai",
        recitals="the company requires an attorney to manage its legal affairs",
    )
    assert r.refused is False
    _assert_golden("power_of_attorney_general",
                   _r(r.template, r.context, tmp_path, "gpa"))


def test_golden_spa(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_power_of_attorney(
        poa_kind=cv.POAKind.SPECIAL_SALE, executant_name="AB",
        executant_description="S/o CD, R/o Chennai",
        attorney_name="EF", attorney_description="S/o GH, R/o Chennai",
        powers=[], execution_date=date(2024, 1, 1),
        witnesses=["Witness A", "Witness B"], place="Chennai",
        sale_property="Plot No. 45, Anna Nagar, Chennai", sale_price=5000000,
        purchaser_name="XY", sale_agreement_ref="agreement dated 01-01-2024",
    )
    assert r.refused is False
    _assert_golden("power_of_attorney_special",
                   _r(r.template, r.context, tmp_path, "spa"))


def test_golden_agreement_for_sale(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_agreement_for_sale(
        vendor_name="A", vendor_description="S/o X, R/o Chennai",
        vendee_name="B", vendee_description="S/o Y, R/o Chennai",
        property_desc="Plot No. 45, admeasuring 2400 sq.ft., Anna Nagar, Chennai",
        total_consideration=5000000, earnest_money=500000,
        earnest_mode="cheque No. 010806 drawn on Indian Bank",
        completion_months=6, execution_date=date(2024, 1, 1),
        witnesses=["Witness A", "Witness B"], place="Chennai",
    )
    assert r.refused is False
    _assert_golden("agreement_for_sale",
                   _r(r.template, r.context, tmp_path, "agreement_for_sale"))


def test_golden_sale_deed(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_sale_deed(
        vendor_name="A", vendor_description="S/o X, R/o Chennai",
        vendee_name="B", vendee_description="S/o Y, R/o Chennai",
        property_desc="the residential flat, part of Basement and one Bed Room of "
                      "First Floor, at M-170, Anna Nagar, Chennai",
        boundaries={"east": "Road", "west": "Service Lane",
                    "north": "Plot No. M-168", "south": "Plot No. M-172"},
        total_consideration=2500000, amount_already_paid=2000000,
        balance_paid_mode="cheque No. 010806 dated 29-09-2024 drawn on Indian Bank",
        prior_title_recital="the Vendor purchased the said plot vide sale deed dated "
                            "06-08-2015 registered as document No. 5560",
        to_be_registered=True, execution_date=date(2024, 1, 1),
        witnesses=["Witness A", "Witness B"], place="Chennai",
    )
    assert r.refused is False
    _assert_golden("sale_deed", _r(r.template, r.context, tmp_path, "sale_deed"))


def test_golden_lease_deed(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_lease_deed(
        lessor_name="Sudarshan Kaur", lessor_description="W/o Paramjit Singh, R/o "
                                                         "Chennai",
        lessee_name="M/s Dave Thomson Associates (India) Pvt. Ltd.",
        lessee_description="through its Director",
        property_desc="the basement portion, admeasuring 760 sq.ft., at M-170, Anna "
                      "Nagar, Chennai",
        term_months=24, commencement_date=date(2024, 1, 1), monthly_rent=4000,
        escalation_note="the rent shall be increased by 10% per annum after every 12 "
                        "months",
        security_deposit=36000, notice_months=3, execution_date=date(2024, 1, 1),
        witnesses=["Witness A", "Witness B"], place="Chennai",
    )
    assert r.refused is False
    _assert_golden("lease_deed", _r(r.template, r.context, tmp_path, "lease_deed"))


def test_golden_mortgage_deed(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_mortgage_deed(
        mortgagor_name="A", mortgagor_description="S/o X, R/o Chennai",
        mortgagee_name="M/s ABC Ltd.", mortgagee_description="a company incorporated "
                                                            "under the Companies Act",
        property_desc="a vacant residential plot bearing Municipal No. A-25, Anna "
                      "Nagar, Chennai",
        principal=200000, interest_rate=12.0,
        repayment_terms="in equal monthly instalments of Rs. 2000/-",
        purpose_recital="the Mortgagor wants to construct a residential building on "
                        "the said plot",
        execution_date=date(2024, 1, 1),
        witnesses=["Witness A", "Witness B"], place="Chennai",
    )
    assert r.refused is False
    _assert_golden("mortgage_deed", _r(r.template, r.context, tmp_path, "mortgage_deed"))


def test_golden_partnership_deed(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_partnership_deed(
        firm_name="M/s XYZ",
        partners=[cv.Partner("X", "S/o A, R/o Chennai", 51),
                  cv.Partner("Y", "S/o B, R/o Chennai", 49)],
        business_nature="interior decoration, furnishing and the manufacture and "
                        "sale of furniture",
        principal_place="E-1 Ram Nagar, Chennai",
        commencement_date=date(2024, 1, 1),
        capital_note="the initial capital of Rs. 15,000/- has been contributed by "
                     "each partner",
        at_will=True, execution_date=date(2024, 1, 1),
        witnesses=["Witness A", "Witness B"], place="Chennai",
    )
    assert r.refused is False
    _assert_golden("partnership_deed",
                   _r(r.template, r.context, tmp_path, "partnership_deed"))


def test_golden_dissolution_deed(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_dissolution_deed(
        firm_name="M/s ABC",
        partners=[cv.Partner("A", "S/o X, R/o Chennai", 50),
                  cv.Partner("B", "S/o Y, R/o Chennai", 50)],
        original_deed_ref="the partnership deed dated 01-01-2020",
        dissolution_date=date(2024, 1, 1), accounts_settled=True,
        records_custodian="the First Party", execution_date=date(2024, 1, 1),
        witnesses=["Witness A", "Witness B"], place="Chennai",
    )
    assert r.refused is False
    _assert_golden("dissolution_deed",
                   _r(r.template, r.context, tmp_path, "dissolution_deed"))


def test_golden_relinquishment_deed(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_relinquishment_deed(
        releasors=[cv.Releasor("Avadh", "D/o Late X, R/o Chennai"),
                   cv.Releasor("Bala", "D/o Late X, R/o Chennai"),
                   cv.Releasor("Devilal", "S/o Late X, R/o Chennai")],
        releasee_name="Ragini", releasee_description="W/o Late X, R/o Chennai",
        property_desc="the double-storey house built over 200 sq.yds at Chennai",
        deceased_owner="X", releasors_share="4/5th", for_consideration=False,
        execution_date=date(2024, 1, 1),
        witnesses=["Mr. P, S/o Q", "Mr. R, S/o S"], place="Chennai",
    )
    assert r.refused is False
    _assert_golden("relinquishment_deed",
                   _r(r.template, r.context, tmp_path, "relinquishment_deed"))


def test_golden_gift_deed(tmp_path):
    from src.pipelines import conveyancing as cv
    r = cv.build_gift_deed(
        donor_name="XYZ", donor_description="S/o ABC, R/o Chennai",
        donee_name="PQR", donee_description="S/o XYZ, R/o Chennai",
        relation="son",
        property_desc="the residential house bearing No. 13, Anna Nagar, Chennai",
        boundaries={"east": "Road", "west": "Park", "north": "House No. 12",
                    "south": "House No. 14"},
        market_value=5000000, possession_delivered=True, to_be_registered=True,
        prior_title_recital="the Donor is the owner of the said property, having "
                            "purchased it vide registered sale deed dated 01-01-2010",
        execution_date=date(2024, 1, 1),
        witnesses=["Mr. P, S/o Q", "Mr. R, S/o S"], place="Chennai",
    )
    assert r.refused is False
    _assert_golden("gift_deed", _r(r.template, r.context, tmp_path, "gift_deed"))


def test_golden_s106_notice(tmp_path):
    from src.pipelines import s106_notice as n
    r = n.build(
        advocate="A. Menon", client="Ramesh",
        recipient_name="Suresh", recipient_address="12 North Street, Chennai",
        property_desc="the house bearing No. 7, T. Nagar, Chennai",
        monthly_rent=5000, notice_date=date(2024, 1, 1), quit_date=date(2024, 1, 31),
        damages_rate_note="at Rs. 200/- per day",
        place="Chennai", advocate_chamber="Ch. No. 5, Madras High Court",
        advocate_phone="044-2338XXXX",
    )
    assert r.refused is False
    _assert_golden("s106_notice", _r(n.TEMPLATE, r.context, tmp_path, "s106_notice"))


def test_golden_s80_notice(tmp_path):
    from src.pipelines import s80_notice as n
    r = n.build(
        advocate="A. Menon", client="Sri Kumar",
        addressee="The Secretary", government_body="Government of Tamil Nadu, "
                                                   "Education Department, Chennai",
        plaintiff_name_description="Sri Kumar, S/o Rajan, an employee of the "
                                   "Education Department, residing at Chennai",
        cause_of_action="the plaintiff was illegally dismissed from service with "
                        "effect from 01-06-2023",
        reliefs=["reinstatement of the plaintiff in service",
                 "recovery of salary for the period of dismissal"],
        notice_date=date(2024, 1, 1), place="Chennai",
        advocate_chamber="Ch. No. 5, Madras High Court", advocate_phone="044-2338XXXX",
    )
    assert r.refused is False
    _assert_golden("s80_notice", _r(n.TEMPLATE, r.context, tmp_path, "s80_notice"))


def test_golden_s138_reply(tmp_path):
    from src.pipelines import s138_reply as n
    r = n.build(
        advocate="B. Gupta", client="Suresh",
        opposing_advocate="A. Menon", notice_date=date(2015, 6, 9),
        defence_narrative="the cheque in question was handed over blank as security "
                          "and was to be used only upon my client's instructions "
                          "after the goods were sold; your client has misused it",
        liability_denied=True, cheque_in_discharge_denied=True,
        place="Chennai", advocate_chamber="Ch. No. 8, Madras High Court",
        advocate_phone="044-2338XXXX", client_address="Connaught Place, Chennai",
    )
    assert r.refused is False
    _assert_golden("s138_reply", _r(n.TEMPLATE, r.context, tmp_path, "s138_reply"))
