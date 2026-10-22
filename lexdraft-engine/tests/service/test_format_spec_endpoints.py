"""HTTP contract for a firm's OWN format (spec sent with each request).

  - /v1/format-spec/contract exposes the transcriber prompt + schema the API uses;
  - /v1/format-spec/check rejects a broken spec and previews a good one;
  - /v1/draft-spec drafts exactly like /v1/draft (422 on missing facts / bad spec,
    generated docx otherwise) and never collides with a built-in doc type.
"""

import base64
import copy
import io

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from docx import Document  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-SPEC-1", "version": 1}
DOC_TYPE = "firm_format_0123456789abcdef"

SPEC = {
    "title": "Memo for Return of Original Documents",
    "court_issued": False,
    "fields": [
        {"key": "court_name", "kind": "string", "required": False, "label": "Court", "help": "",
         "enum_values": [], "sample": "Principal District Munsif"},
        {"key": "case_ref", "kind": "string", "required": True, "label": "Case number", "help": "",
         "enum_values": [], "sample": "O.S. No. 45 of 2024"},
        {"key": "plaintiff_name", "kind": "string", "required": True, "label": "Plaintiff", "help": "",
         "enum_values": [], "sample": "Anand"},
        {"key": "disposal_date", "kind": "date", "required": False, "label": "Disposed on", "help": "",
         "enum_values": [], "sample": "2026-02-10"},
        {"key": "documents", "kind": "string_list", "required": False, "label": "Documents", "help": "",
         "enum_values": [], "sample": "Sale deed dated 01.02.2001 | Patta No. 12"},
    ],
    "blocks": [
        {"style": "title", "text": "IN THE COURT OF THE {{ court_name }}", "bold": True, "condition": ""},
        {"style": "center", "text": "{{ case_ref }}", "bold": False, "condition": ""},
        {"style": "left", "text": "{{ plaintiff_name }} .... Plaintiff", "bold": False, "condition": ""},
        {"style": "heading", "text": "MEMO FOR RETURN OF ORIGINAL DOCUMENTS", "bold": True, "condition": ""},
        {"style": "para", "text": "The suit was disposed of on {{ disposal_date }}.", "bold": False,
         "condition": ""},
        {"style": "list", "text": "documents", "bold": False, "condition": ""},
        {"style": "signature", "text": "Counsel for Plaintiff", "bold": False, "condition": ""},
    ],
}


def _text(b64):
    return "\n".join(p.text for p in Document(io.BytesIO(base64.b64decode(b64))).paragraphs)


def test_contract_carries_prompt_schema_and_vocabulary():
    c = client.get("/v1/format-spec/contract").json()
    assert "Indian court" in c["system_prompt"]
    assert c["schema"]["required"] and "blocks" in c["schema"]["properties"]
    assert "case_ref" in c["common_keys"]
    assert ["urgent_petition", "Urgent Petition (s.151 CPC)"] in c["existing"]


def test_check_previews_a_valid_spec():
    r = client.post("/v1/format-spec/check", json={"doc_type": DOC_TYPE, "spec": SPEC}).json()
    assert r["ok"] is True, r["problems"]
    preview = "\n".join(r["preview"])
    assert "MEMO FOR RETURN OF ORIGINAL DOCUMENTS" in preview and "Patta No. 12" in preview
    assert {f["key"] for f in r["describe"]["fields"]} == {f["key"] for f in SPEC["fields"]}
    assert r["spec"]["fields"][4]["sample"] == ["Sale deed dated 01.02.2001", "Patta No. 12"]


def test_check_reports_a_broken_spec():
    bad = copy.deepcopy(SPEC)
    bad["blocks"].append({"style": "para", "text": "{{ ghost }}", "bold": False, "condition": ""})
    r = client.post("/v1/format-spec/check", json={"doc_type": DOC_TYPE, "spec": bad}).json()
    assert r["ok"] is False and any("ghost" in p for p in r["problems"])


def test_builtin_doc_type_cannot_be_overridden():
    r = client.post("/v1/draft-spec", json={"doc_type": "urgent_petition", "spec": SPEC,
                                           "matter": MATTER, "fields": {}})
    assert r.status_code == 422


def test_draft_spec_generates_and_validates():
    r = client.post("/v1/draft-spec", json={
        "doc_type": DOC_TYPE, "spec": SPEC, "matter": MATTER,
        "fields": {"case_ref": "O.S. No. 9 of 2025", "plaintiff_name": "Meena",
                   "documents": ["Original sale deed"]}})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated" and body["doc_type"] == DOC_TYPE
    assert body["template_id"].startswith("spec:")
    text = _text(body["docx_base64"])
    assert "Meena .... Plaintiff" in text and "Original sale deed" in text
    assert "not yet approved" not in text          # an approved firm format: no marker
    assert "____________" in text                  # optional court name left as a blank

    missing = client.post("/v1/draft-spec", json={
        "doc_type": DOC_TYPE, "spec": SPEC, "matter": MATTER, "fields": {"case_ref": "x"}})
    assert missing.status_code == 422
    assert {i["field"] for i in missing.json()["issues"]} == {"plaintiff_name"}

    broken = client.post("/v1/draft-spec", json={
        "doc_type": DOC_TYPE, "spec": {"title": "x"}, "matter": MATTER, "fields": {}})
    assert broken.status_code == 422 and broken.json()["error"] == "invalid_spec"
