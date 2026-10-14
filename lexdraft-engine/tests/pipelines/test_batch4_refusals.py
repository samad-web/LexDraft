"""Refusal-path tests for the Batch-4 conveyancing deeds + notices."""

from datetime import date

import pytest

from src.pipelines import conveyancing as cv
from src.pipelines import s106_notice as s106
from src.pipelines import s80_notice as s80
from src.pipelines import s138_reply as s138r


# --- will ---
def _will(**o):
    kw = dict(testator_name="T", testator_parentage="S/o X", testator_address="addr",
              execution_date=date(2024, 1, 1),
              bequests=[cv.Bequest("house", "son", "son")], sound_mind_declared=True,
              witnesses=["A", "B"], place="Chennai")
    kw.update(o)
    return kw


def test_will_needs_bequest():
    r = cv.build_will(**_will(bequests=[]))
    assert r.refused and r.refusal.code == "will_no_bequest"


def test_will_needs_two_witnesses():
    r = cv.build_will(**_will(witnesses=["A"]))
    assert r.refused and r.refusal.code == "will_insufficient_witnesses"


def test_will_needs_sound_mind():
    r = cv.build_will(**_will(sound_mind_declared=False))
    assert r.refused and r.refusal.code == "will_sound_mind_not_declared"


def test_will_ok():
    assert cv.build_will(**_will()).refused is False


# --- POA ---
def test_gpa_needs_powers():
    r = cv.build_power_of_attorney(
        poa_kind=cv.POAKind.GENERAL, executant_name="E", executant_description="d",
        attorney_name="A", attorney_description="d", powers=[],
        execution_date=date(2024, 1, 1), witnesses=["a", "b"], place="Chennai")
    assert r.refused and r.refusal.code == "poa_general_no_powers"


def test_spa_needs_property():
    r = cv.build_power_of_attorney(
        poa_kind=cv.POAKind.SPECIAL_SALE, executant_name="E",
        executant_description="d", attorney_name="A", attorney_description="d",
        powers=[], execution_date=date(2024, 1, 1), witnesses=["a", "b"],
        place="Chennai", sale_property="  ")
    assert r.refused and r.refusal.code == "poa_special_sale_property_missing"


def test_spa_ok():
    r = cv.build_power_of_attorney(
        poa_kind=cv.POAKind.SPECIAL_SALE, executant_name="E",
        executant_description="d", attorney_name="A", attorney_description="d",
        powers=[], execution_date=date(2024, 1, 1), witnesses=["a", "b"],
        place="Chennai", sale_property="Plot 1", sale_price=100, purchaser_name="P")
    assert r.refused is False


# --- agreement for sale / sale deed ---
def _sale(**o):
    kw = dict(vendor_name="A", vendor_description="d", vendee_name="B",
              vendee_description="d", property_desc="plot",
              boundaries={"east": "", "west": "", "north": "", "south": ""},
              total_consideration=1000, amount_already_paid=500,
              balance_paid_mode="cash", prior_title_recital="x",
              to_be_registered=True, execution_date=date(2024, 1, 1),
              witnesses=["a", "b"], place="Chennai")
    kw.update(o)
    return kw


def test_sale_deed_needs_consideration():
    r = cv.build_sale_deed(**_sale(total_consideration=0))
    assert r.refused and r.refusal.code == "sale_deed_no_consideration"


def test_sale_deed_needs_registration():
    r = cv.build_sale_deed(**_sale(to_be_registered=False))
    assert r.refused and r.refusal.code == "sale_deed_registration_not_intended"


def test_sale_deed_paid_cannot_exceed_total():
    r = cv.build_sale_deed(**_sale(amount_already_paid=2000))
    assert r.refused and r.refusal.code == "sale_deed_paid_exceeds_consideration"


def test_sale_deed_ok():
    assert cv.build_sale_deed(**_sale()).refused is False


def test_agreement_for_sale_needs_consideration():
    r = cv.build_agreement_for_sale(
        vendor_name="A", vendor_description="d", vendee_name="B",
        vendee_description="d", property_desc="plot", total_consideration=0,
        earnest_money=0, earnest_mode="cash", completion_months=6,
        execution_date=date(2024, 1, 1), witnesses=["a", "b"], place="Chennai")
    assert r.refused and r.refusal.code == "agreement_for_sale_no_consideration"


# --- lease ---
def test_lease_needs_rent():
    r = cv.build_lease_deed(
        lessor_name="L", lessor_description="d", lessee_name="T",
        lessee_description="d", property_desc="flat", term_months=24,
        commencement_date=date(2024, 1, 1), monthly_rent=0, escalation_note="",
        security_deposit=0, notice_months=3, execution_date=date(2024, 1, 1),
        witnesses=["a", "b"], place="Chennai")
    assert r.refused and r.refusal.code == "lease_deed_no_rent"


# --- mortgage ---
def test_mortgage_needs_principal():
    r = cv.build_mortgage_deed(
        mortgagor_name="M", mortgagor_description="d", mortgagee_name="G",
        mortgagee_description="d", property_desc="plot", principal=0,
        interest_rate=12.0, repayment_terms="x", purpose_recital="x",
        execution_date=date(2024, 1, 1), witnesses=["a", "b"], place="Chennai")
    assert r.refused and r.refusal.code == "mortgage_deed_no_principal"


# --- partnership / dissolution ---
def test_partnership_shares_must_total_100():
    r = cv.build_partnership_deed(
        firm_name="F", partners=[cv.Partner("X", "d", 60), cv.Partner("Y", "d", 60)],
        business_nature="x", principal_place="Chennai",
        commencement_date=date(2024, 1, 1), capital_note="x", at_will=True,
        execution_date=date(2024, 1, 1), witnesses=["a", "b"], place="Chennai")
    assert r.refused and r.refusal.code == "partnership_deed_shares_not_100"


def test_partnership_needs_two_partners():
    r = cv.build_partnership_deed(
        firm_name="F", partners=[cv.Partner("X", "d", 100)], business_nature="x",
        principal_place="Chennai", commencement_date=date(2024, 1, 1),
        capital_note="x", at_will=True, execution_date=date(2024, 1, 1),
        witnesses=["a", "b"], place="Chennai")
    assert r.refused and r.refusal.code == "partnership_deed_insufficient_partners"


def test_dissolution_needs_date():
    r = cv.build_dissolution_deed(
        firm_name="F", partners=[cv.Partner("A", "d", 50), cv.Partner("B", "d", 50)],
        original_deed_ref="deed", dissolution_date=None, accounts_settled=True,
        records_custodian="A", execution_date=date(2024, 1, 1),
        witnesses=["a", "b"], place="Chennai")
    assert r.refused and r.refusal.code == "dissolution_deed_no_date"


# --- relinquishment ---
def test_relinquishment_needs_releasors():
    r = cv.build_relinquishment_deed(
        releasors=[], releasee_name="R", releasee_description="d",
        property_desc="house", deceased_owner="X", releasors_share="4/5th",
        for_consideration=False, execution_date=date(2024, 1, 1),
        witnesses=["a", "b"], place="Chennai")
    assert r.refused and r.refusal.code == "relinquishment_deed_no_releasors"


# --- gift ---
def _gift(**o):
    kw = dict(donor_name="A", donor_description="d", donee_name="B",
              donee_description="d", relation="son", property_desc="house",
              boundaries={"east": "", "west": "", "north": "", "south": ""},
              market_value=100, possession_delivered=True, to_be_registered=True,
              prior_title_recital="x", execution_date=date(2024, 1, 1),
              witnesses=["a", "b"], place="Chennai")
    kw.update(o)
    return kw


def test_gift_needs_registration():
    r = cv.build_gift_deed(**_gift(to_be_registered=False))
    assert r.refused and r.refusal.code == "gift_deed_registration_not_intended"


def test_gift_needs_possession():
    r = cv.build_gift_deed(**_gift(possession_delivered=False))
    assert r.refused and r.refusal.code == "gift_deed_possession_not_delivered"


def test_gift_ok():
    assert cv.build_gift_deed(**_gift()).refused is False


# --- s.106 notice ---
def test_s106_short_notice():
    r = s106.build(advocate="A", client="C", recipient_name="R",
                   recipient_address="addr", property_desc="house", monthly_rent=5000,
                   notice_date=date(2024, 1, 1), quit_date=date(2024, 1, 5),
                   damages_rate_note="Rs 200/day", place="Chennai")
    assert r.refused and r.refusal.code == "s106_notice_short"


def test_s106_ok():
    r = s106.build(advocate="A", client="C", recipient_name="R",
                   recipient_address="addr", property_desc="house", monthly_rent=5000,
                   notice_date=date(2024, 1, 1), quit_date=date(2024, 1, 31),
                   damages_rate_note="Rs 200/day", place="Chennai")
    assert r.refused is False


# --- s.80 notice ---
def test_s80_needs_all_particulars():
    r = s80.build(advocate="A", client="C", addressee="Sec", government_body="GoI",
                  plaintiff_name_description="X", cause_of_action="Y", reliefs=[],
                  notice_date=date(2024, 1, 1), place="Chennai")
    assert r.refused and r.refusal.code == "s80_notice_relief_missing"


def test_s80_ok():
    r = s80.build(advocate="A", client="C", addressee="Sec", government_body="GoI",
                  plaintiff_name_description="X", cause_of_action="Y",
                  reliefs=["reinstatement"], notice_date=date(2024, 1, 1),
                  place="Chennai")
    assert r.refused is False


# --- s.138 reply ---
def test_s138_reply_needs_notice():
    r = s138r.build(advocate="A", client="C", opposing_advocate="O",
                    notice_date=None, defence_narrative="x", liability_denied=True,
                    cheque_in_discharge_denied=True, place="Chennai")
    assert r.refused and r.refusal.code == "s138_reply_notice_not_identified"


def test_s138_reply_needs_defence():
    r = s138r.build(advocate="A", client="C", opposing_advocate="O",
                    notice_date=date(2024, 1, 1), defence_narrative="  ",
                    liability_denied=True, cheque_in_discharge_denied=True,
                    place="Chennai")
    assert r.refused and r.refusal.code == "s138_reply_no_defence"


def test_s138_reply_ok():
    r = s138r.build(advocate="A", client="C", opposing_advocate="O",
                    notice_date=date(2024, 1, 1), defence_narrative="blank cheque",
                    liability_denied=True, cheque_in_discharge_denied=True,
                    place="Chennai")
    assert r.refused is False
