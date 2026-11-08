"""r15 reviewer defects pinned on the engine render of the suite brief's facts,
through the real /v1/draft endpoint (one test per defect, every wording seen r12-r15)."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402
from tests.service.test_court_forms_quality_r12 import _AFF  # noqa: E402
from tests.service.test_r10_writs_appeals_ias import SS  # noqa: E402
from tests.service.test_r12_civil_quality import INDIGENT  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-R15", "version": 1}


def _text(doc_type, fields, **top):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **top})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return "\n".join(b["text"] for b in body["blocks"])


@pytest.mark.parametrize("role_name", [
    "the plaintiff (client in O.S. No. 66 of 2026)", "the plaintiff (client)", "my client",
    "Plaintiff in O.S. No. 66 of 2026 (client)", "Plaintiff", "the plaintiff, my client"])
def test_substituted_service_role_string_plaintiff_is_a_name_gap(role_name):
    text = _text("substituted_service", {**SS, "petitioner_name": role_name, "deponent_name": role_name})
    assert "client" not in text.lower()
    assert "[name of the plaintiff to be provided]                          ... Petitioner/Plaintiff" in text


@pytest.mark.parametrize("described", [
    "Her late husband's two brothers", "The two brothers of her late husband",
    "Brothers of her late husband (names not stated)",
    "Brother of the petitioner's late husband (two brothers; names not given)", "husband's brothers"])
def test_indigent_application_descriptive_respondent_is_r1_r2_gaps(described):
    text = _text("indigent_application", {**INDIGENT, "respondent_name": described, "respondent_count": 2})
    head = text.split("PETITION FILED UNDER")[0]
    assert "1. [name of respondent 1 to be provided], son of [father's name to be provided], brother of the petitioner's" in head
    assert "2. [name of respondent 2 to be provided], son of [father's name to be provided], brother of the petitioner's" in head
    assert "3. " not in head and "names not" not in head and "Brothers of" not in head


def test_indigent_application_named_respondent_kept():
    text = _text("indigent_application", {**INDIGENT, "respondent_names": ["Murugan, son of Raman", "K. Ravi"]})
    head = text.split("PETITION FILED UNDER")[0]
    assert "1. Murugan, son of Raman" in head and "2. K. Ravi" in head


@pytest.mark.parametrize("court_name,proceeding", [
    (None, "Correction of name in patta for S.F. No. 88/2, Chithode village, before the Tahsildar, Erode"),
    ("[court to be provided]", "application to the Tahsildar, Erode for correction of name in the patta"),
    ("Tahsildar, Erode", "application")])
def test_affidavit_tahsildar_heading_role_and_request_derived(court_name, proceeding):
    fields = {**{k: v for k, v in _AFF.items() if k not in ("affidavit_kind", "court_name")},
              "role": "[role to be provided]", "proceeding": proceeding}
    if court_name:
        fields["court_name"] = court_name
    text = _text("affidavit", fields, allow_placeholders=True)
    assert "BEFORE THE TAHSILDAR, ERODE" in text
    assert "1. I am the deponent herein and the applicant before the Tahsildar, Erode, and am well" in text
    assert ("I therefore request the Tahsildar, Erode to correct the patta for S.F. No. 88/2, "
            "Chithode village to read my name as K. Ramesh.") in text
    assert "Hon'ble Court" not in text and "[role to be provided]" not in text


@pytest.mark.parametrize("name,names", [
    ("Mr. V. Sathish; Mrs. V. Kamala", ["Mr. V. Sathish", "Mrs. V. Kamala"]),
    ("Mr. V. Sathish and Mrs. V. Kamala", ["Mr. V. Sathish (husband)", "Mrs. V. Kamala (mother-in-law)"]),
    ("Mr. V. Sathish", ["Mr. V. Sathish (husband); Mrs. V. Kamala (mother-in-law)"]),
    ("Mr. V. Sathish, Mrs. V. Kamala", [])])
def test_dv_application_joined_respondents_split_and_deduplicated(name, names):
    from tests.service.test_dv_mact_quality import _DV
    text = _text("dv_application", {**_DV, "respondent_name": name, "respondent_names": names})
    head = text.split("PETITION FILED UNDER")[0]
    assert head.count("Sathish") == 1 and head.count("Kamala") == 1 and "\n3. " not in head
    assert "1. Mr. V. Sathish" in head and "2. Mrs. V. Kamala" in head
    assert ";" not in head.split("-Vs-")[1]


_CAUSE = ("Earlier counsel, who undertook to apply for the decree copy, fell ill and did not do so; the "
          "petitioner was herself admitted at CMC Hospital, Vellore from 20.07.2026 to 02.09.2026 for a "
          "cardiac procedure and could approach the present counsel only on 25.09.2026; certified copies "
          "were applied for on 26.09.2026 and received on 08.10.2026")


@pytest.mark.parametrize("role", ["Plaintiff", "Appellant", "Petitioner", ""])
@pytest.mark.parametrize("narrative", ["", "(a) The earlier counsel fell ill. (b) 20.07.2026 to 02.09.2026: in hospital."])
def test_condone_delay_petition_gaps_named_even_with_narrative_and_appellant_role(role, narrative):
    from tests.service.test_r12_civil_quality import CONDONE
    text = _text("condone_delay_petition", {**CONDONE, "sufficient_cause": _CAUSE, "petitioner_role": role,
                                            "delay_narrative": narrative}, allow_placeholders=True)
    for a, b in (("12.07.2026", "20.07.2026"), ("02.09.2026", "25.09.2026"), ("08.10.2026", "07.11.2026")):
        assert f"[cause of delay from {a} to {b} to be provided]" in text
    assert "Mrs. P. Meena                          ... PETITIONER/APPELLANT" in text
    assert "... PLAINTIFF" not in text


def test_criminal_revision_para1_identifies_the_impugned_appellate_judgment():
    from tests.service.test_criminal_quality_r10 import _REVISION
    text = _text("criminal_revision", _REVISION)
    assert ("\n1. This revision is directed against the judgment dated 30.09.2026 passed by the Additional "
            "District and Sessions Court, Srivilliputhur in C.A. No. 22 of 2025, arising out of the judgment "
            "of conviction and sentence passed by the Judicial Magistrate No. I, Sivakasi in S.T.C. No. 340 "
            "of 2021, which is not an interlocutory order.") in text
