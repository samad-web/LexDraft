"""Blank forms (/v1/blank) and the LAWE library (/v1/lawe-catalog).

  - every doc type either renders a blank form (200) or says it needs facts (409)
    — never a 500 — and no stand-in date/number leaks into a rendered blank;
  - a blank form carries no review banner and keeps the template's layout;
  - a firm's request-supplied spec renders blank too;
  - the LAWE library lists every catalogued form against a served doc type, and
    each variant preset is a valid value for that doc type.
"""

import re

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service import adapters  # noqa: E402
from src.service.app import app  # noqa: E402

client = TestClient(app)
LEAK = re.compile(r"\b1900\b|\b99,?999\b|\{\{|\{%")


@pytest.mark.parametrize("doc_type", sorted(a.doc_type for a in adapters.all_adapters()))
def test_every_doc_type_blank_or_needs_facts(doc_type):
    r = client.post("/v1/blank", json={"doc_type": doc_type})
    assert r.status_code in (200, 409), r.text[:300]
    if r.status_code == 200:
        text = "\n".join(b["text"] for b in r.json()["blocks"])
        assert not LEAK.search(text), LEAK.search(text).group(0)
        assert "for advocate review" not in text.lower()
        assert r.json()["docx_base64"]
    else:
        assert r.json()["error"] == "needs_facts" and r.json()["reason"]


def test_blank_urgent_petition_has_fill_in_lines():
    blocks = client.post("/v1/blank", json={"doc_type": "urgent_petition"}).json()["blocks"]
    text = "\n".join(b["text"] for b in blocks)
    assert "URGENT PETITION" in text and "____________" in text


def test_blank_unknown_doc_type_is_404():
    assert client.post("/v1/blank", json={"doc_type": "no_such_doc"}).status_code == 404


def test_blank_firm_spec():
    spec = {
        "title": "Memo for Return of Original Documents",
        "court_issued": False,
        "fields": [{"key": "case_ref", "kind": "string", "required": True, "label": "Case no.",
                    "help": "", "enum_values": [], "sample": "O.S. 1/2026"}],
        "blocks": [{"style": "title", "text": "MEMO", "bold": True, "condition": ""},
                   {"style": "para", "text": "In {{ case_ref }} the plaintiff prays.", "bold": False,
                    "condition": ""}],
    }
    r = client.post("/v1/blank", json={"doc_type": "firm_format_abc123", "spec": spec})
    assert r.status_code == 200, r.text
    text = "\n".join(b["text"] for b in r.json()["blocks"])
    assert "In ____________ the plaintiff prays." in text


def test_lawe_library_points_at_served_doc_types_with_valid_presets():
    forms = client.get("/v1/lawe-catalog").json()["forms"]
    assert len(forms) >= 50
    served = {a.doc_type: a for a in adapters.all_adapters()}
    for f in forms:
        assert f["doc_type"] in served, f["id"]
        assert f["url"].startswith("https://www.lawe.co.in/downloads/forms/")
        for key, value in f["preset"].items():
            spec = next(s for s in served[f["doc_type"]].fields if getattr(s, "key", None) == key)
            assert value in (spec.enum_values or ()), (f["id"], key, value)
    warrant = next(f for f in forms if f["id"] == "Court_of_Small_Causes/Property.pdf")
    assert warrant["doc_type"] == "court_warrant" and warrant["preset"] == {"kind": "possession"}
