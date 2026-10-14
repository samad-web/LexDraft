"""The supporting s.138 affidavit is DERIVED from the built complaint (spec 3.1).

Chain under test: build the complaint -> derive affidavit kwargs from its context
-> build the affidavit. The derivation must (a) carry every legal fact from the
complaint verbatim, (b) render first-person averments, and (c) pass the
cheque/date facts through so the affidavit pipeline re-runs the SAME window hard
stops the complaint's facts already passed.
"""

from datetime import date

import pytest

from src.pipelines import s138_complaint as complaint
from src.pipelines import affidavit as affidavit
from src.pipelines import s138_affidavit_from_complaint as derive
from src.pipelines.s138_notice import Cheque


def _complaint_base(**over):
    kw = dict(
        complainant_name="Ramesh", complainant_is_company=False,
        complainant_authorised_rep=None, complainant_resolution_ref=None,
        is_payee=True,
        accused_name="Suresh", accused_is_company=False,
        s141_averment=None,
        cheques=[Cheque(number="000123", date=date(2024, 1, 1), amount=100000,
                        bank="SBI", branch="Mylapore", drawer="Suresh",
                        payee="Ramesh")],
        debt_slot="a hand loan of Rs.1,00,000 advanced on 01-12-2023",
        presentation_date=date(2024, 1, 10),
        memo_date=date(2024, 1, 12), memo_received_date=date(2024, 1, 15),
        dishonour_reason="Funds insufficient",
        notice_date=date(2024, 1, 18),
        notice_dispatch_date=date(2024, 1, 18),
        notice_delivery_date=date(2024, 1, 20),
        notice_refused=False, notice_unclaimed=False,
        filing_date=date(2024, 2, 20),
        payee_bank_branch_in_jurisdiction=True,
        jurisdiction_basis="s.142(2) NI Act",
        place="Chennai",
        complainant_parentage="Krishnan",
        complainant_address="12 North Street, Mylapore, Chennai",
    )
    kw.update(over)
    return kw


def _derive_kwargs(ctx, **over):
    kw = dict(
        deponent_age=42, deponent_occupation="business",
        attestor="Notary Public, Chennai",
    )
    kw.update(over)
    return derive.build_affidavit_kwargs(ctx, **kw)


# ---- the happy chain -------------------------------------------------------

def test_complaint_to_affidavit_builds_and_is_first_person():
    c = complaint.build(**_complaint_base())
    assert c.may_generate, c.reason

    kwargs = _derive_kwargs(c.context)
    a = affidavit.build(**kwargs)
    assert not a.refused, getattr(a, "reason", "")

    # First person throughout; never the complaint's third-person voice. The
    # deponent's competence ("I am the complainant ... well acquainted") is stated
    # by the affidavit template's para 1, so the derived body goes straight to the
    # first-person averments and must NOT repeat a standing para.
    body = a.context["numbered_body"]
    joined = " ".join(p["text"] for p in body)
    assert "I further state that" in joined
    assert "The complainant states" not in joined
    assert "The complainant further states" not in joined
    # No duplicated competence averment in the body (the template's para 1 owns it).
    assert joined.count("well acquainted with the facts") == 0


def test_facts_carry_from_complaint_verbatim():
    c = complaint.build(**_complaint_base())
    a = affidavit.build(**_derive_kwargs(c.context))
    joined = " ".join(p["text"] for p in a.context["numbered_body"])

    # Cheque particulars, dishonour reason, and the accused name all come through.
    assert "000123" in joined
    assert "Funds insufficient" in joined
    assert "Suresh" in joined
    # Deponent is the complainant, in the complainant's own capacity.
    assert a.context["deponent_name"] == "Ramesh"
    assert a.context["role"] == "complainant"
    # It is a proof affidavit (s.145), so the template drops the prayer paragraph.
    assert a.context["affidavit_kind"] == "s145_proof"


def test_deponent_parentage_and_address_default_from_complaint():
    c = complaint.build(**_complaint_base())
    a = affidavit.build(**_derive_kwargs(c.context))
    assert a.context["parentage_name"] == "Krishnan"
    assert "North Street" in a.context["address"]


# ---- the window stops re-run on the affidavit ------------------------------

def test_derived_affidavit_reruns_presentation_stop():
    # A cheque presented beyond its 3-month validity. The COMPLAINT pipeline does
    # not itself gate presentation validity (that is the notice/affidavit stop), so
    # it still builds; the DERIVED affidavit must refuse when the pipeline re-runs
    # the presentation window on the same fact.
    c = complaint.build(**_complaint_base(
        cheques=[Cheque(number="999001", date=date(2024, 1, 1), amount=100000,
                        bank="SBI", branch="Mylapore", drawer="Suresh",
                        payee="Ramesh")],
        presentation_date=date(2024, 5, 10),   # > 3 months after cheque date
        memo_date=date(2024, 5, 12), memo_received_date=date(2024, 5, 14),
        notice_date=date(2024, 5, 20),
        notice_dispatch_date=date(2024, 5, 20),
        notice_delivery_date=date(2024, 5, 22),
        filing_date=date(2024, 6, 1),
    ))
    assert c.may_generate, c.reason  # complaint itself does not gate presentation

    a = affidavit.build(**_derive_kwargs(c.context))
    assert a.refused
    assert a.refusal.code == "s138_affidavit_cheque_presented_after_validity"
    assert "999001" in a.reason


def test_derived_affidavit_reruns_notice_window_stop():
    # Notice issued > 30 days after memo receipt. The complaint builds (its
    # limitation runs off the filing date, auto-condoned); the affidavit's 30-day
    # notice window must still refuse.
    c = complaint.build(**_complaint_base(
        memo_received_date=date(2024, 1, 15),
        notice_date=date(2024, 3, 1),          # > 30 days after memo receipt
        notice_dispatch_date=date(2024, 3, 1),
        notice_delivery_date=date(2024, 3, 3),
        filing_date=date(2024, 3, 20),
    ))
    a = affidavit.build(**_derive_kwargs(c.context))
    assert a.refused
    assert a.refusal.code == "s138_notice_out_of_30_day_window"


# ---- deemed service carries into the affidavit -----------------------------

def test_deemed_service_averment_appears_in_affidavit():
    c = complaint.build(**_complaint_base(
        notice_refused=True, notice_delivery_date=None,
        deemed_delivery_date=date(2024, 1, 25),
        deemed_service_averment="the notice returned refused is deemed duly served.",
    ))
    assert c.may_generate, c.reason
    a = affidavit.build(**_derive_kwargs(c.context))
    assert not a.refused, getattr(a, "reason", "")
    joined = " ".join(p["text"] for p in a.context["numbered_body"])
    assert "deemed duly served" in joined


# ---- list of documents carries into the affidavit -------------------------

def test_advocate_added_documents_appear_in_both_complaint_and_affidavit():
    c = complaint.build(**_complaint_base(
        extra_documents=["The Agreement dated 01-12-2023",
                         "Invoice No. INV-2023-88 dated 01-12-2023"],
    ))
    assert c.may_generate, c.reason
    # Complaint context: standard set + advocate additions, offset preserved.
    assert c.context["standard_document_count"] == len(c.context["documents"])
    assert "The Agreement dated 01-12-2023" in c.context["extra_documents"]

    a = affidavit.build(**_derive_kwargs(c.context))
    joined = " ".join(p["text"] for p in a.context["numbered_body"])
    # The affidavit recites the SAME documents (standard + advocate-added).
    assert "rely upon the following documents" in joined
    assert "The Agreement dated 01-12-2023" in joined
    assert "Invoice No. INV-2023-88 dated 01-12-2023" in joined
    # The standard set is recited too.
    assert "cheque return memo" in joined


def test_no_extra_documents_still_recites_standard_set():
    c = complaint.build(**_complaint_base())
    a = affidavit.build(**_derive_kwargs(c.context))
    joined = " ".join(p["text"] for p in a.context["numbered_body"])
    assert "rely upon the following documents" in joined
    assert "statutory demand notice" in joined


# ---- multi-cheque ----------------------------------------------------------

def test_multi_cheque_all_appear_in_affidavit():
    c = complaint.build(**_complaint_base(cheques=[
        Cheque(number="C1", date=date(2024, 1, 1), amount=60000, bank="SBI",
               branch="Mylapore", drawer="Suresh", payee="Ramesh"),
        Cheque(number="C2", date=date(2024, 1, 1), amount=40000, bank="SBI",
               branch="Mylapore", drawer="Suresh", payee="Ramesh"),
    ]))
    a = affidavit.build(**_derive_kwargs(c.context))
    assert not a.refused, getattr(a, "reason", "")
    joined = " ".join(p["text"] for p in a.context["numbered_body"])
    assert "C1" in joined and "C2" in joined


# ---- doc-5 Item 4: deponent = CW-1 invariant -------------------------------

def test_complainant_seeded_as_cw1_in_complaint():
    # The complaint auto-seeds the complainant as the first witness (CW-1).
    c = complaint.build(**_complaint_base())
    assert c.context["witnesses"][0] == "Ramesh, Complainant"


def test_deponent_defaults_to_complainant():
    c = complaint.build(**_complaint_base())
    kw = _derive_kwargs(c.context)
    assert kw["deponent_name"] == "Ramesh"


def test_deponent_mismatch_refused():
    # Doc-5 invariant: the s.138 proof affidavit must be sworn by the complainant
    # (CW-1). A different deponent is rejected at derivation.
    c = complaint.build(**_complaint_base())
    with pytest.raises(ValueError, match="sworn by the complainant"):
        derive.build_affidavit_kwargs(
            c.context, deponent_age=42, deponent_occupation="business",
            attestor="Notary Public, Chennai", deponent_name="Someone Else",
        )


# ---- doc-5 Item 6: Thoorigai bundle regression fixture ---------------------
# Builds the reference filing end-to-end (complaint -> derived affidavit) and
# asserts every doc-5 refinement carries across BOTH documents: the multi-round
# deferment/re-presentation history, the twice-the-cheque-amount prayer, the
# multi-counsel backing sheet, and matching document lists. Protects all of it
# from regression in one place.

def _thoorigai_complaint():
    kv = dict(bank="Karur Vysya Bank", branch="Godown Street, Chennai",
              drawer="R. Venkatesh Bhat", payee="Ambeth Arivukarasan")
    cheques = [
        Cheque(number="000102", date=date(2026, 4, 25), amount=300000, **kv),
        Cheque(number="000103", date=date(2026, 4, 29), amount=200000, **kv),
        Cheque(number="000105", date=date(2026, 4, 16), amount=399088, **kv),
        Cheque(number="000106", date=date(2026, 5, 15), amount=397899, **kv),
    ]
    from src.pipelines.s138_complaint import PresentationRound
    return complaint.build(
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
        jurisdiction_basis="presented for collection through PNB, Gopalapuram "
                           "Branch (s.142(2) NI Act)",
        place="Saidapet, Chennai",
        court_designation="Metropolitan Magistrate, Fast Track Court-III",
        court_location="Saidapet", city="Chennai",
        complainant_parentage="S/o Rajendiran",
        deferment_agreement_date=date(2026, 5, 7),
        presentation_rounds=[
            PresentationRound(date(2026, 4, 30), date(2026, 5, 2)),
            PresentationRound(date(2026, 7, 15), date(2026, 7, 15)),
        ],
        notice_ack_official_date=date(2026, 7, 18),
        notice_ack_residence_date=date(2026, 7, 21),
        itemise_documents=True, prayer_twice_amount=True,
        advocates=["M. Gowtham", "M. Arunkumar", "V. Srihari"],
        advocate_enrolments=["4687/2025", "4717/2025", "4839/2025"],
        advocate_contact="Mobile: 8056618648 | Email: ask2gdr@gmail.com",
    )


def test_thoorigai_bundle_carries_all_refinements():
    c = _thoorigai_complaint()
    assert c.may_generate, c.reason
    cc = c.context

    # Correct cheque figures (no 2,04,202 / no 000104).
    nums = [ch["number"] for ch in cc["cheques"]]
    assert nums == ["000102", "000103", "000105", "000106"]
    assert cc["cheques"][1]["amount"] == 200000  # 000103 is 2,00,000
    assert cc["demand_amount"] == 1296987

    # Multi-round history: last round (15.07.2026) is operative; CoA = 03.08.2026.
    assert cc["has_presentation_rounds"] is True
    assert cc["presentation_rounds"][-1]["is_last"] is True
    assert cc["cause_of_action_date"] == date(2026, 8, 3)

    # Within limitation (filed 24.08.2026) — NOT condoned.
    assert cc["condonation_required"] is False

    # Twice-amount prayer: 2 x 12,96,987 = 25,93,974.
    assert cc["prayer_twice_figure"] == 2593974

    # Multi-counsel block with enrolments + contact.
    assert cc["advocate_lines"] == [
        "M. Gowtham (Enrl. 4687/2025)",
        "M. Arunkumar (Enrl. 4717/2025)",
        "V. Srihari (Enrl. 4839/2025)",
    ]
    assert "8056618648" in cc["advocate_contact"]

    # Court designation is data-driven (not "Chief Metropolitan Magistrate").
    assert cc["court_designation"] == "Metropolitan Magistrate, Fast Track Court-III"

    # Complainant seeded as CW-1.
    assert cc["witnesses"][0].startswith("Ambeth Arivukarasan")


def test_thoorigai_affidavit_matches_complaint_docs_and_prayer():
    c = _thoorigai_complaint()
    a = affidavit.build(**_derive_kwargs(c.context))
    assert not a.refused, getattr(a, "reason", "")

    # Deponent is the complainant (CW-1 invariant).
    assert a.context["deponent_name"].startswith("Ambeth Arivukarasan")

    # Counsel block carried to the affidavit's backing sheet (doc-5: BOTH docs).
    assert a.context["advocate_lines"] == c.context["advocate_lines"]
    assert a.context["advocate_contact"] == c.context["advocate_contact"]

    # Prayer relief matches (twice-amount + S.395 BNSS) though voice differs.
    assert "twice the amount" in a.context["prayer"]
    assert "Section 395 of BNSS" in a.context["prayer"]
