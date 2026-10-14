"""HTTP contract tests for the FastAPI app, driven through the s.138 lead.

The load-bearing distinctions, at the HTTP layer:
  - a legal refusal is 200 outcome:"refused" (never 500, never 4xx);
  - malformed/missing input is 422 (a different channel);
  - an unknown doc type is 404;
  - a generated document returns BOTH structured blocks and a base64 .docx, both
    carrying the review banner (and any table marker).
"""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)

MATTER = {"matter_id": "M-TEST-1", "version": 1}


def _fields(**over):
    f = {
        "client": "Lakshmi", "advocate": "Sundaravadivel",
        "advocate_enrolment": "MS/1/11", "recipient_name": "Murugan",
        "recipient_address": "12 Bharathi St, Coimbatore",
        "cheques": [{
            "number": "452118", "date": "2024-11-04", "amount": 450000,
            "bank": "IOB", "branch": "Town Hall", "drawer": "Murugan",
            "payee": "Lakshmi",
        }],
        "debt_nature": "hand loan",
        "presentation_date": "2024-11-08", "presentation_bank": "CUB",
        "memo_date": "2024-11-11", "memo_received_date": "2024-11-13",
        "dishonour_reason": "Funds insufficient", "notice_date": "2024-11-25",
        "dispatch_mode": "RPAD", "dispatch_tracking_placeholder": "{{t}}",
        "place": "Coimbatore",
    }
    f.update(over)
    return f


def test_healthz_lists_doc_types():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert "s138_notice" in r.json()["doc_types"]


def test_doc_types_contract():
    r = client.get("/v1/doc-types")
    assert r.status_code == 200
    s138 = next(d for d in r.json()["doc_types"] if d["doc_type"] == "s138_notice")
    keys = {f["key"] for f in s138["fields"]}
    assert {"client", "cheques", "memo_received_date"} <= keys
    cheques = next(f for f in s138["fields"] if f["key"] == "cheques")
    assert cheques["kind"] == "list" and cheques["min_items"] == 1


def test_generated_returns_blocks_and_docx_with_banner():
    r = client.post("/v1/draft/s138_notice",
                    json={"matter": MATTER, "fields": _fields(), "render": True})
    assert r.status_code == 200
    body = r.json()
    assert body["outcome"] == "generated"
    assert body["docx_base64"]
    assert body["blocks"]
    # the review banner is a block AND (decoding not needed) the signal is set
    assert body["signals"]["review_banner"]
    assert any("DRAFT" in b["text"] for b in body["blocks"])


def test_legal_refusal_is_200_not_500():
    # Valid, complete form; a cheque presented after its validity -> legal block.
    r = client.post("/v1/draft/s138_notice", json={
        "matter": MATTER,
        "fields": _fields(cheques=[{
            "number": "452118", "date": "2024-05-04", "amount": 450000,
            "bank": "IOB", "branch": "TH", "drawer": "M", "payee": "L",
        }]),
    })
    assert r.status_code == 200          # NOT 500, NOT 4xx
    body = r.json()
    assert body["outcome"] == "refused"
    assert body["refusal"]["code"] == "s138_notice_cheque_presented_after_validity"
    # fields_implicated are the INBOUND keys/paths, not engine names
    assert "cheques[].date" in body["refusal"]["fields_implicated"]
    assert "cheque_dates" not in body["refusal"]["fields_implicated"]


def test_missing_required_field_is_422_not_a_refusal():
    fields = _fields()
    del fields["memo_received_date"]
    r = client.post("/v1/draft/s138_notice", json={"matter": MATTER, "fields": fields})
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "validation"
    assert any(i["field"] == "memo_received_date" and i["code"] == "required"
               for i in body["issues"])
    # It is NOT a refusal — the response has no refusal channel at all.
    assert "outcome" not in body


def test_malformed_date_is_422():
    r = client.post("/v1/draft/s138_notice",
                    json={"matter": MATTER, "fields": _fields(notice_date="25-11-2024")})
    assert r.status_code == 422
    assert any(i["field"] == "notice_date" and i["code"] == "malformed"
               for i in r.json()["issues"])


def test_unknown_doc_type_is_404():
    r = client.post("/v1/draft/no_such_doc", json={"matter": MATTER, "fields": {}})
    assert r.status_code == 404


def test_missing_matter_identity_is_422():
    r = client.post("/v1/draft/s138_notice", json={"fields": _fields()})
    assert r.status_code == 422


def test_route_code_resolves_and_refuses():
    ok = client.post("/v1/route-code", json={
        "offence_date": "2024-08-01", "proceeding_start_date": "2024-08-05",
        "is_fresh_action": False})
    assert ok.status_code == 200 and ok.json()["code_framework"] == "bnss"

    refused = client.post("/v1/route-code", json={
        "offence_date": "2024-08-01", "is_fresh_action": False})
    assert refused.status_code == 200
    assert refused.json()["outcome"] == "refused"
    assert refused.json()["refusal"]["code"] == "code_framework_unknown_provenance"


def test_sign_off_flow(tmp_path, monkeypatch):
    # Point the audit trail at a temp file so the test never touches the real one.
    monkeypatch.setattr("src.verify.signoff._DEFAULT_AUDIT", tmp_path / "audit.jsonl")
    # The s.138 notice has no narrative slots, so it is signable.
    r = client.post("/v1/sign-off", json={
        "matter": MATTER, "document": "s138_notice",
        "reviewer": "Adv. R. Rao", "signed_on": "2026-09-01",
        "context": {"place": "Coimbatore"},
    })
    assert r.status_code == 200
    assert r.json()["outcome"] == "signed_off"
    assert r.json()["version"] == 1


def test_sign_off_with_unfilled_slot_is_409():
    r = client.post("/v1/sign-off", json={
        "matter": MATTER, "document": "mact_claim",
        "reviewer": "Adv. R. Rao", "signed_on": "2026-09-01",
        "context": {"accident_slot": "[to be drafted]"},
    })
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "signoff_refused"
