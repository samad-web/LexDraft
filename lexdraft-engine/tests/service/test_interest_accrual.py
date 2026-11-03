"""Interest claimed may not exceed simple interest at the stated rate for the period."""

from fastapi.testclient import TestClient

from src.service.app import app
from tests.service.test_all_adapters_roundtrip import PAYLOADS


def _draft(dt, **over):
    fields = {**PAYLOADS[dt], **over}
    return TestClient(app).post(f"/v1/draft/{dt}", json={"matter": {"matter_id": "M", "version": 1}, "fields": fields}).json()


def test_over_claimed_interest_is_refused():
    # 1,00,000 at 12% from 01.01.2023 to 01.05.2024 (486 days) accrues ~15,978.
    for dt in ("plaint", "summary_suit"):
        b = _draft(dt, interest_rate=12, interest_amount=40000, claimed_total=140000)
        assert b["outcome"] == "refused", dt
        assert b["refusal"]["code"].endswith("_interest_exceeds_accrued"), dt


def test_claiming_less_than_accrued_is_allowed():
    for dt in ("plaint", "summary_suit"):
        assert _draft(dt)["outcome"] == "generated", dt


def test_petitioner_cannot_be_his_own_respondent():
    b = _draft("succession_grant", relatives=[{"relation": "Son", "name": "Ramesh", "address": "Chennai"}])
    assert b["outcome"] == "refused"
    assert b["refusal"]["code"] == "succession_grant_no_kin_to_cite"


def test_acknowledgement_with_description_does_not_crash():
    # Intake sends {date, description}; the engine used to TypeError (HTTP 500).
    for dt in ("plaint", "summary_suit"):
        b = _draft(dt, acknowledgements=[{"date": "2024-02-01", "description": "part payment by letter"}])
        assert b.get("outcome") in ("generated", "refused"), (dt, b)


def _post(dt, **over):
    fields = {**PAYLOADS[dt], **over}
    return TestClient(app).post(f"/v1/draft/{dt}", json={"matter": {"matter_id": "M", "version": 1}, "fields": fields})


def test_bad_territorial_basis_is_422_not_500():
    for dt in ("plaint", "summary_suit"):
        r = _post(dt, territorial_bases=["defendant lives in Chennai"])
        assert r.status_code == 422, (dt, r.status_code)
        assert {i["field"] for i in r.json()["issues"]} == {"territorial_bases"}, dt


def test_territorial_gap_renders_as_gap_and_bases_read_as_pleading():
    for dt in ("plaint", "summary_suit"):
        b = _post(dt, territorial_bases=["[territorial bases to be provided]"]).json()
        assert b["outcome"] == "generated", (dt, b)
        b = _post(dt).json()
        text = str(b)
        assert "resides within the local limits of this Court" in text, dt
        assert "defendant_resides" not in text and "subordinate_judge" not in text, dt
