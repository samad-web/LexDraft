"""b3 senior-advocate checklist FAILs (benchmark-h2h/b3-scores.md), pinned on the engine
render of the brief's facts through the real /v1/draft endpoint. One test per item."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402
from tests.service.test_all_adapters_roundtrip import PAYLOADS  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-B3", "version": 1}
HMA_HINDUS = "Both the parties are Hindus and are governed by the Hindu Marriage Act, 1955."


def _text(doc_type, fields, **top):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **top})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


def _head(text):
    return text.split("MOST RESPECTFULLY SHOWETH")[0]


def _body(text):
    return text.split("MOST RESPECTFULLY SHOWETH")[1].split("PRAYER:")[0]


# --- divorce_contested ----------------------------------------------------

DIV = {**PAYLOADS["divorce_contested"], "petitioner_name": "Mr. R. Dinesh",
       "respondent_name": "Mrs. D. Kavya", "marriage_date": "2021-02-10",
       "marriage_place": "Sri Koniamman Temple, Coimbatore"}


def test_divorce_contested_item3():
    assert HMA_HINDUS in _body(_text("divorce_contested", DIV))


# --- judicial_separation --------------------------------------------------

JS = {**PAYLOADS["judicial_separation"], "petitioner_name": "Mrs. R. Gomathi",
      "respondent_name": "Mr. S. Ganesan", "petitioner_age": "38",
      "petitioner_address": "Palayamkottai, Tirunelveli", "marriage_registered": False,
      "family_court": "Family Court", "city": "Tirunelveli"}


def test_judicial_separation_item1():
    head = _head(_text("judicial_separation", JS))
    assert "Mrs. R. Gomathi, aged about 38 years, residing at Palayamkottai, Tirunelveli." in head


def test_judicial_separation_item3():
    text = _text("judicial_separation", JS)
    assert "UNDER SECTION 10 READ WITH SECTION 13(1)(ia) OF THE HINDU MARRIAGE ACT" in _head(text)
    assert ("on the ground of cruelty under Section 13(1)(ia) read with Section 10 of the "
            "Hindu Marriage Act, 1955") in _body(text)
    other = _text("judicial_separation", {**JS, "ground": "other"})
    assert "READ WITH SECTION" not in other and "13(1)" not in other


def test_judicial_separation_item4():
    assert HMA_HINDUS in _body(_text("judicial_separation", JS))


# --- restitution_conjugal_rights ------------------------------------------

RCR = {**PAYLOADS["restitution_conjugal_rights"], "petitioner_name": "Mr. M. Arunkumar",
       "respondent_name": "Mrs. A. Priyadharshini", "petitioner_age": "31",
       "petitioner_occupation": "Software Engineer",
       "petitioner_address": "Ramanathapuram, Coimbatore",
       "respondent_address": "her parents' house at Erode", "marriage_registered": False}


def test_restitution_conjugal_rights_item1():
    head = _head(_text("restitution_conjugal_rights", RCR))
    assert ("Mr. M. Arunkumar, aged about 31 years, Software Engineer, residing at "
            "Ramanathapuram, Coimbatore.") in head


def test_restitution_conjugal_rights_item2():
    text = _text("restitution_conjugal_rights", RCR)
    assert "Mrs. A. Priyadharshini, residing at her parents' house at Erode." in _head(text)
    assert "the respondent resides at her parents' house at Erode" in text
    assert "[the respondent's residence to be stated]" not in text


def test_restitution_conjugal_rights_item4():
    assert HMA_HINDUS in _body(_text("restitution_conjugal_rights", RCR))


# --- maintenance ----------------------------------------------------------

MAINT = {**PAYLOADS["maintenance"], "petitioner_name": "Mrs. M. Revathi",
         "respondent_name": "Mr. S. Raghu", "child_name": "R. Nila", "child_quantum": 15000,
         "quantum": 25000, "magistrate_court": "Family Court", "city": "Chennai",
         "filing_date": "2026-11-08", "marriage_date": "2020-11-20", "marriage_place": "Chennai",
         "neglect_narrative": "The respondent drove the petitioners out on 15.03.2026 and has paid nothing since."}


def test_maintenance_item10():
    text = _text("maintenance", MAINT)
    assert ("JURISDICTION: This Hon'ble Court has jurisdiction under Section 145 of the "
            "Bharatiya Nagarik Suraksha Sanhita, 2023") in text
    assert "Section 7(2)(a) of the Family Courts Act, 1984" in text


def test_maintenance_item12():
    import re
    for line in _body(_text("maintenance", MAINT)).splitlines():
        assert not re.fullmatch(r"\s*\d+[A-Z]?\.\s*\[[^\]]*\]\s*", line), line


def test_maintenance_item13():
    text = _text("maintenance", MAINT)
    tail = text.split("PRAYER:")[1]
    assert "VERIFICATION:" in tail
    assert ("The above-named petitioner No. 1, for herself and on behalf of the minor petitioner "
            "No. 2, states on solemn affirmation that the contents of paras 1 to 8") in tail
    assert "Verified at Chennai on this 08.11.2026." in tail


# --- dv_application -------------------------------------------------------

DV = {**PAYLOADS["dv_application"], "aggrieved_name": "Mrs. J. Anitha",
      "shared_household_pleaded": True,
      "shared_household_particulars": "No. 44, Ashok Nagar, Chennai 600083"}


def test_dv_application_item7():
    body = _body(_text("dv_application", DV))
    assert ("right to reside in the shared household under Section 17 of the Protection of "
            "Women from Domestic Violence Act, 2005") in body
    assert "save in accordance with the procedure established by law." in body


def test_dv_application_item13():
    assert ("JURISDICTION: This Hon'ble Court has jurisdiction under Section 27 of the "
            "Protection of Women from Domestic Violence Act, 2005") in _text("dv_application", DV)


# --- mact_claim -----------------------------------------------------------

MACT = {**PAYLOADS["mact_claim"],
        "claimants": ["Mrs. K. Priya (31), wife", "K. Arjun (6), son, minor", "Mrs. S. Lakshmi (60), mother"],
        "tribunal_name": "Motor Accidents Claims Tribunal (Special District Court)",
        "tribunal_place": "Chennai"}


def test_mact_claim_item1():
    head = _text("mact_claim", MACT).split("M.C.O.P.")[0]
    assert "BEFORE THE MOTOR ACCIDENTS CLAIMS TRIBUNAL (SPECIAL DISTRICT COURT), CHENNAI" in head
    # the whole name given as tribunal_place is the name, not a place suffix
    whole = _text("mact_claim", {**MACT, "tribunal_name": None, "tribunal_place":
                                 "Motor Accidents Claims Tribunal (Special District Court), Chennai"})
    assert "BEFORE THE MOTOR ACCIDENTS CLAIMS TRIBUNAL (SPECIAL DISTRICT COURT), CHENNAI\n" in whole
    bare = _text("mact_claim", {**MACT, "tribunal_name": None})
    assert "BEFORE THE MOTOR ACCIDENT CLAIMS TRIBUNAL, CHENNAI" in bare


def test_mact_claim_item14():
    tail = _text("mact_claim", MACT).split("PRAYER:")[1]
    assert "VERIFICATION:" in tail and "We, the petitioners above named, do hereby verify" in tail
    assert "AFFIDAVIT OF THE 1st PETITIONER IN SUPPORT OF THE CLAIM PETITION" in tail
    assert "for myself and on behalf of the other petitioners" in tail
    assert "I, Mrs. K. Priya, the 1st petitioner herein" in tail
    assert "DEPONENT" in tail
    assert "must be supported by an Affidavit" not in tail
