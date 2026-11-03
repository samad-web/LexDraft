"""Every civil cause title names its defendant (specific performance printed it blank)."""

from fastapi.testclient import TestClient

from src.service.app import app
from tests.service.test_all_adapters_roundtrip import PAYLOADS

CIVIL = ["plaint", "summary_suit", "permanent_injunction", "specific_performance"]


def test_defendant_named_in_cause_title():
    c = TestClient(app)
    for dt in CIVIL:
        fields = PAYLOADS[dt]
        body = c.post(f"/v1/draft/{dt}", json={"matter": {"matter_id": "M", "version": 1}, "fields": fields}).json()
        assert body.get("outcome") == "generated", dt
        # Madras/TN cause title: "... Defendant" (was the Delhi "... DEFENDANT").
        title = [b["text"] for b in body["blocks"] if "... Defendant" in b["text"]][0]
        assert title.split("... Defendant")[0].strip(" .\t"), f"{dt}: blank defendant line: {title!r}"
