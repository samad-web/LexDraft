"""Every format in the library opens as a blank form (/v1/blank). Formats whose
legal checks refuse stand-in facts fall back to the template with fill-in lines."""

import pytest
from fastapi.testclient import TestClient

from src.service import adapters
from src.service.app import app
from src.service.blank import BLANK

client = TestClient(app)


@pytest.mark.parametrize("doc_type", [a.doc_type for a in adapters.all_adapters()])
def test_blank_form_opens(doc_type):
    r = client.post("/v1/blank", json={"doc_type": doc_type})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["docx_base64"] and body["blocks"]


def test_refused_format_falls_back_to_fill_in_lines():
    # Regular bail refuses stand-ins (no offence date); the blank still renders.
    r = client.post("/v1/blank", json={"doc_type": "regular_bail"})
    text = "\n".join(b["text"] for b in r.json()["blocks"])
    assert "MOST RESPECTFULLY SHOWETH" in text and BLANK in text
    assert "1900" not in text and "99999" not in text
