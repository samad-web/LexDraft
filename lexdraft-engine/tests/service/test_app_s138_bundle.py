"""HTTP contract tests for POST /v1/draft-bundle/s138_complaint.

The bundle builds the complaint (source of truth) and derives its supporting
proof affidavit in one call. The load-bearing distinctions:
  - complaint + affidavit both come back in the single-doc `generated` shape;
  - a complaint refusal is the WHOLE bundle's outcome (no affidavit attempted);
  - the affidavit re-runs the s.138 window stops, so a defective matter refuses
    on the affidavit even though the complaint built;
  - missing deponent particulars are a 422 (a form problem), never a refusal.
"""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)

MATTER = {"matter_id": "M-BUNDLE-1", "version": 1}


def _fields(**over):
    f = {
        "complainant_name": "Ramesh Kumar",
        "complainant_is_company": False,
        "is_payee": True,
        "accused_name": "Suresh Babu",
        "accused_is_company": False,
        "cheques": [{
            "number": "000123", "date": "2024-01-01", "amount": 125000,
            "bank": "State Bank of India", "branch": "Mylapore",
            "drawer": "Suresh Babu", "payee": "Ramesh Kumar",
        }],
        "presentation_date": "2024-01-10",
        "memo_date": "2024-01-12", "memo_received_date": "2024-01-15",
        "dishonour_reason": "Funds insufficient",
        "notice_date": "2024-01-18", "notice_dispatch_date": "2024-01-18",
        "notice_delivery_date": "2024-01-20",
        "filing_date": "2024-02-20",
        "payee_bank_branch_in_jurisdiction": True,
        "jurisdiction_basis": "s.142(2) NI Act",
        "place": "Chennai",
        "complainant_parentage": "Krishnan",
        "complainant_address": "12 North Street, Mylapore, Chennai 600004",
    }
    f.update(over)
    return f


def _affidavit(**over):
    a = {"deponent_age": 42, "deponent_occupation": "business",
         "attestor": "Notary Public, Chennai"}
    a.update(over)
    return a


def _post(fields=None, affidavit=None, render=True):
    return client.post("/v1/draft-bundle/s138_complaint", json={
        "matter": MATTER,
        "fields": fields if fields is not None else _fields(),
        "affidavit": affidavit if affidavit is not None else _affidavit(),
        "render": render,
    })


# ---- happy path: both documents generated ---------------------------------

def test_bundle_generates_complaint_and_affidavit():
    r = _post()
    assert r.status_code == 200
    body = r.json()
    assert body["outcome"] == "generated"
    assert body["bundle"] == "s138_complaint"

    complaint = body["complaint"]
    affidavit = body["affidavit"]
    assert complaint["outcome"] == "generated"
    assert affidavit["outcome"] == "generated"
    # Both render to a real .docx with blocks + the review banner.
    assert complaint["docx_base64"] and affidavit["docx_base64"]
    assert complaint["signals"]["review_banner"]
    assert affidavit["signals"]["review_banner"]


def test_affidavit_is_first_person_and_carries_complaint_facts():
    r = _post()
    body = r.json()
    aff_text = " ".join(b["text"] for b in body["affidavit"]["blocks"])
    # First-person voice, complaint's third-person voice absent.
    assert "I state that" in aff_text or "I further state that" in aff_text
    assert "The complainant states" not in aff_text
    # A fact from the complaint carried through verbatim.
    assert "000123" in aff_text
    assert "Funds insufficient" in aff_text


# ---- complaint refusal is the whole bundle's outcome ----------------------

def test_complaint_refusal_short_circuits_the_bundle():
    # Company accused with no s.141 averment -> hard refusal on the complaint.
    r = _post(fields=_fields(accused_is_company=True))
    assert r.status_code == 200
    body = r.json()
    assert body["outcome"] == "refused"
    assert body["for"] == "s138_complaint"
    assert body["refusal"]["code"] == "s138_complaint_company_accused_no_s141_averment"
    assert "complaint" not in body and "affidavit" not in body


# ---- affidavit re-runs the window stops -----------------------------------

def test_affidavit_refuses_when_window_stop_fails_even_if_complaint_builds():
    # Cheque presented beyond validity: the complaint does not gate presentation,
    # but the derived affidavit re-runs the presentation window and refuses.
    r = _post(fields=_fields(
        cheques=[{"number": "999001", "date": "2024-01-01", "amount": 125000,
                  "bank": "SBI", "branch": "Mylapore", "drawer": "Suresh Babu",
                  "payee": "Ramesh Kumar"}],
        presentation_date="2024-05-10",
        memo_date="2024-05-12", memo_received_date="2024-05-14",
        notice_date="2024-05-20", notice_dispatch_date="2024-05-20",
        notice_delivery_date="2024-05-22",
        filing_date="2024-06-01",
    ))
    assert r.status_code == 200
    body = r.json()
    assert body["outcome"] == "generated"          # complaint built
    assert body["complaint"]["outcome"] == "generated"
    assert body["affidavit"]["outcome"] == "refused"
    assert body["affidavit"]["refusal"]["code"] == \
        "s138_affidavit_cheque_presented_after_validity"


# ---- deponent particulars are a 422, never a refusal ----------------------

def test_missing_deponent_particulars_is_422():
    r = _post(affidavit={"deponent_age": 42})  # occupation + attestor missing
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "validation"
    fields = {i["field"] for i in body["issues"]}
    assert "affidavit.deponent_occupation" in fields
    assert "affidavit.attestor" in fields
    assert "outcome" not in body


def test_missing_complaint_field_is_422():
    fields = _fields()
    del fields["memo_received_date"]
    r = _post(fields=fields)
    assert r.status_code == 422
    assert any(i["field"] == "memo_received_date" for i in r.json()["issues"])


def test_advocate_added_documents_flow_into_both_docs():
    r = _post(fields=_fields(extra_documents=[
        "The Agreement dated 01-12-2023",
        "Invoice No. INV-2023-88 dated 01-12-2023",
    ]))
    assert r.status_code == 200
    body = r.json()
    complaint_text = " ".join(b["text"] for b in body["complaint"]["blocks"])
    affidavit_text = " ".join(b["text"] for b in body["affidavit"]["blocks"])
    # The complaint's LIST OF DOCUMENTS carries the standard set + advocate items.
    assert "LIST OF DOCUMENTS FILED BY THE COMPLAINANT" in complaint_text
    assert "The Agreement dated 01-12-2023" in complaint_text
    assert "Invoice No. INV-2023-88 dated 01-12-2023" in complaint_text
    # The affidavit recites the same documents.
    assert "The Agreement dated 01-12-2023" in affidavit_text
    assert "Invoice No. INV-2023-88 dated 01-12-2023" in affidavit_text


def test_render_false_omits_docx():
    r = _post(render=False)
    body = r.json()
    assert body["complaint"]["outcome"] == "generated"
    assert "docx_base64" not in body["complaint"]
    assert "docx_base64" not in body["affidavit"]
