"""Golden-file tests for the general notice (2.1) and s.138 complaint (3.1)."""

import os
from datetime import date
from pathlib import Path

import pytest

from src.pipelines import general_notice as gn
from src.pipelines import s138_complaint as complaint
from src.pipelines.s138_notice import Cheque
from src.components.render import render_to_docx, extract_text
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


def test_golden_general_notice(tmp_path):
    result = gn.build(
        client="Ramesh Kumar", advocate="Adv. K. Kannan",
        advocate_enrolment="MS/1234/2010",
        recipient_name="Suresh Babu", recipient_address="8 South Street, Chennai 600001",
        recipient_mode="Registered Post Acknowledgement Due",
        demand_amount=50000, act_required="pay the outstanding sum",
        compliance_days=15, statutory_minimum_days=None,
        civil_consequence="a civil suit for recovery with interest and costs",
        criminal_consequence=None,
        dispatch_tracking_placeholder="{{ rpad_tracking }}",
        transaction_narrative="", breach_narrative="",
        prior_demands_narrative="", loss_narrative="",
        notice_date=date(2024, 5, 1), place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "general_notice.docx"
    render_golden(gn.TEMPLATE, result.context, out)
    _assert_golden("general_notice", extract_text(out))


def test_golden_s138_complaint(tmp_path):
    result = complaint.build(
        complainant_name="Ramesh Kumar", complainant_is_company=False,
        complainant_authorised_rep=None, complainant_resolution_ref=None,
        is_payee=True,
        accused_name="Suresh Babu", accused_is_company=False, s141_averment=None,
        cheques=[Cheque(number="000123", date=date(2024, 1, 1), amount=100000,
                        bank="State Bank of India", branch="Mylapore",
                        drawer="Suresh Babu", payee="Ramesh Kumar")],
        debt_slot="",
        presentation_date=date(2024, 1, 10),
        memo_date=date(2024, 1, 12), memo_received_date=date(2024, 1, 15),
        dishonour_reason="Funds insufficient",
        notice_date=date(2024, 1, 18), notice_dispatch_date=date(2024, 1, 18),
        notice_delivery_date=date(2024, 1, 20),
        notice_refused=False, notice_unclaimed=False,
        filing_date=date(2024, 3, 5),
        payee_bank_branch_in_jurisdiction=True,
        jurisdiction_basis="the payee's bank branch is situated within this court's "
                           "territorial jurisdiction (Section 142(2) NI Act)",
        place="Chennai",
    )
    assert result.refused is False
    out = tmp_path / "s138_complaint.docx"
    render_golden(complaint.TEMPLATE, result.context, out)
    _assert_golden("s138_complaint", extract_text(out))


def test_golden_s138_complaint_tn_full(tmp_path):
    """Tamil-Nadu-practice s.138 complaint exercising every real-filing
    refinement together (derived from the Thoorigai Prints v. Venki
    Publications reference filing): four cheques, a written deferment agreement
    with re-presentation, the itemised per-cheque + per-memo document list with
    service-proof cards, the complainant seeded as CW-1, dd.mm.yyyy body dates,
    and the 'twice the cheque amount' prayer."""
    cheques = [
        Cheque(number="000102", date=date(2026, 4, 25), amount=300000,
               bank="Karur Vysya Bank", branch="Godown Street, Chennai",
               drawer="R. Venkatesh Bhat", payee="Ambeth Arivukarasan"),
        Cheque(number="000103", date=date(2026, 4, 29), amount=200000,
               bank="Karur Vysya Bank", branch="Godown Street, Chennai",
               drawer="R. Venkatesh Bhat", payee="Ambeth Arivukarasan"),
        Cheque(number="000105", date=date(2026, 4, 16), amount=399088,
               bank="Karur Vysya Bank", branch="Godown Street, Chennai",
               drawer="R. Venkatesh Bhat", payee="Ambeth Arivukarasan"),
        Cheque(number="000106", date=date(2026, 5, 15), amount=397899,
               bank="Karur Vysya Bank", branch="Godown Street, Chennai",
               drawer="R. Venkatesh Bhat", payee="Ambeth Arivukarasan"),
    ]
    result = complaint.build(
        complainant_name="Ambeth Arivukarasan (Proprietor, Thoorigai Prints)",
        complainant_is_company=False,
        complainant_authorised_rep=None, complainant_resolution_ref=None,
        is_payee=True,
        accused_name="R. Venkatesh Bhat (Proprietor, Venki Publications)",
        accused_is_company=False, s141_averment=None,
        cheques=cheques,
        debt_slot="the price of books and printed materials supplied on credit",
        presentation_date=date(2026, 7, 15),
        memo_date=date(2026, 7, 15), memo_received_date=date(2026, 7, 15),
        dishonour_reason="Funds Insufficient",
        notice_date=date(2026, 7, 17), notice_dispatch_date=date(2026, 7, 17),
        notice_delivery_date=date(2026, 7, 18),
        notice_refused=False, notice_unclaimed=False,
        filing_date=date(2026, 8, 24),
        payee_bank_branch_in_jurisdiction=True,
        jurisdiction_basis="the cheques were presented for collection through "
                           "Punjab National Bank, Gopalapuram Branch, which falls "
                           "within this court's territorial jurisdiction "
                           "(Section 142(2) NI Act)",
        place="Saidapet, Chennai",
        court_designation="Metropolitan Magistrate, Fast Track Court-III",
        case_number_label="S.T.C. No.",
        advocate_office_address="No. 160, 3rd Floor, Hussain Plaza, Thambu Chetty "
                                "Street, Chennai-600001",
        court_location="Saidapet",
        city="Chennai",
        advocates=["M. Gowtham", "M. Arunkumar", "V. Srihari"],
        advocate_enrolments=["4687/2025", "4717/2025", "4839/2025"],
        advocate_contact="Mobile: 8056618648 | Email: ask2gdr@gmail.com",
        complainant_parentage="S/o Rajendiran",
        complainant_address="No. 8/2, Nair Vardha Pillai Street, Royapettah, "
                            "Chennai-600014",
        accused_address="No. 102, Govindhappa Naicken Street, Parrys, "
                        "Chennai-600001",
        # real-filing refinements
        deferment_agreement_date=date(2026, 5, 7),
        notice_ack_official_date=date(2026, 7, 18),
        notice_ack_residence_date=date(2026, 7, 21),
        itemise_documents=True,
        prayer_twice_amount=True,
        extra_documents=[
            "GST Certificate with address of the Accused (dated 30.12.2025)",
            "Current Account Bank Statement of Complainant "
            "(24.07.2026 to 24.08.2026)",
        ],
        extra_witnesses=[
            "The Manager, Punjab National Bank, Gopalapuram Branch",
            "The Manager, Karur Vysya Bank, Godown Street Branch",
        ],
    )
    assert result.refused is False
    ctx = result.context

    # Prayer: twice the aggregate (2 x 12,96,987 = 25,93,974).
    assert ctx["prayer_twice_amount"] is True
    assert ctx["prayer_twice_figure"] == 2593974
    # Body dates are dd.mm.yyyy, not ISO.
    assert ctx["notice_date_body"] == "17.07.2026"
    assert ctx["deferment_agreement_date_body"] == "07.05.2026"
    # Itemised list: 4 cheques + 4 memos + deferment + notice + 2 acks = 12.
    assert ctx["itemised_documents"] is True
    assert len(ctx["documents"]) == 12
    assert any("deferment agreement" in d.lower() for d in ctx["documents"])
    assert any("acknowledgement card dated 21-07-2026" in d for d in ctx["documents"])
    # Complainant seeded as CW-1.
    assert ctx["witnesses"][0].startswith("Ambeth Arivukarasan")
    assert "Complainant" in ctx["witnesses"][0]
    # Court designation is data-driven (not the hardcoded "Chief Metropolitan
    # Magistrate") and para 1 pleads "payee", not "payee / holder in due course".
    assert ctx["court_designation"] == "Metropolitan Magistrate, Fast Track Court-III"
    assert ctx["is_holder_in_due_course"] is False
    # Advocate block: names paired with enrolment numbers, contact line present.
    assert ctx["advocate_lines"] == [
        "M. Gowtham (Enrl. 4687/2025)",
        "M. Arunkumar (Enrl. 4717/2025)",
        "V. Srihari (Enrl. 4839/2025)",
    ]
    assert ctx["advocate_contact"] == "Mobile: 8056618648 | Email: ask2gdr@gmail.com"
    # Reference structure: S.T.C. case-number label + structured document records.
    assert ctx["case_number_label"] == "S.T.C. No."
    assert len(ctx["document_records"]) == 14  # 12 standard + GST + bank statement
    assert ctx["document_records"][0]["remarks"] == "Original"

    out = tmp_path / "s138_complaint_tn_full.docx"
    render_golden(complaint.TEMPLATE, result.context, out)
    text = extract_text(out)
    # The rendered document follows the reference filing's skeleton.
    assert "S.T.C. No. ______ OF 2026" in text
    assert ("COMPLAINT FILED UNDER SECTION 210 READ WITH SECTION 223 OF THE "
            "BHARATIYA NAGARIK SURAKSHA SANHITA, 2023") in text
    assert "SECTION 138 READ WITH SECTION 142 OF THE NEGOTIABLE INSTRUMENTS ACT" in text
    assert "1. Description of the Complainant" in text
    assert "2. Description of the Accused" in text
    assert "LIST OF DOCUMENTS FILED BY THE COMPLAINANT" in text
    assert "VERIFICATION" in text
    # No backing sheet / bottom counsel-names block (removed per practice choice):
    # the cause-title appears once and the document ends at the verification.
    assert text.count("S.T.C. No. ______ OF 2026") == 1
    assert "Counsel for the Complainant" not in text
    # The advocates are named ONLY in para 1's address-for-service clause.
    assert "the address for service of all notices and process" in text.lower()
    _assert_golden("s138_complaint_tn_full", text)
