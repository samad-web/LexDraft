"""Suite r10 senior-advocate review, criminal formats: each test is named
<format>_<defect> and drives the engine end to end (TestClient) with the facts
of the r10 brief for that format."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-R10-CRIM", "version": 1}


def _draft(doc_type, fields):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "generated", body
    return [b["text"] for b in body["blocks"]]


# --- s138_reply -----------------------------------------------------------------

_REPLY = {
    "advocate": "S. Kumar", "client": "Mr. B. Dhanasekaran",
    "opposing_advocate": "T. Ravi", "notice_date": "2026-10-20",
    "defence_narrative": (
        "My client never borrowed any money from Mr. Kannappan\n"
        "In 2023 my client gave Mr. Kannappan two signed blank cheques as security for a chit.\n"
        "My client paid all the chit instalments, the last on 05.12.2024."),
    "liability_denied": True, "cheque_in_discharge_denied": True,
    "place": "Tiruchirappalli",
}


def test_s138_reply_defence_lines_stay_inside_the_lettered_block():
    """r10: the one-per-line defence rendered as loose lines after B., so compose
    rewrote only A-B and the brief's lines + orphan C./D. reached the reply."""
    blocks = _draft("s138_reply", _REPLY)
    b = next(i for i, t in enumerate(blocks) if t.startswith("B. That the true facts are:"))
    assert "borrowed any money from Mr. Kannappan. In 2023" in blocks[b]
    assert blocks[b + 1].startswith("C. ") and blocks[b + 2].startswith("D. ")


def test_s138_reply_demands_return_of_cheques_within_a_time_limit():
    blocks = _draft("s138_reply", {**_REPLY,
                                   "cheques_to_return": "both the signed blank cheques, including Cheque No. 204517"})
    text = "\n".join(blocks)
    assert ("withdraw the said notice and to return both the signed blank cheques, including "
            "Cheque No. 204517 to my client within 7 days of receipt of this reply") in text
    # no cheques named -> no return demand
    assert "to return" not in "\n".join(_draft("s138_reply", _REPLY))


# --- surrender_petition ----------------------------------------------------------

_SURRENDER = {
    "accused_name": "P. Manikandan", "offence_section": "Section 118(1) of the Bharatiya Nyaya Sanhita, 2023",
    "crime_no": "Crime No. 210 of 2026", "identification_marks": ["a mole on the left cheek"],
    "case_ref": "Crl.M.P. No. ____ of 2026", "place": "Thoothukudi",
    "police_station": "Thoothukudi South", "court_name": "Judicial Magistrate No. II, Thoothukudi",
}


def test_surrender_petition_prays_for_remand_or_bail_under_bnss():
    """r10: the prayer was only "accept the surrender", with no BNSS provision."""
    text = "\n".join(_draft("surrender_petition", _SURRENDER))
    assert ("accept the surrender of the petitioner/accused, record the appearance of the "
            "petitioner/accused in Crime No. 210 of 2026") in text
    assert "judicial custody under Section 187 of the Bharatiya Nagarik Suraksha Sanhita, 2023" in text
    assert "on bail under Section 480 of the said Sanhita" in text


def test_surrender_petition_pre_bnss_crime_cites_the_crpc():
    text = "\n".join(_draft("surrender_petition", {**_SURRENDER, "crime_no": "Crime No. 12 of 2024",
                                                    "crime_registered_date": "2024-03-02"}))
    assert "Section 167 of the Code of Criminal Procedure, 1973" in text
    assert "Section 437 of the said Code" in text and "Suraksha" not in text


# --- criminal_appeal --------------------------------------------------------------

_APPEAL = {
    "forum": "high_court", "trial_court_level": "sessions", "appellant_names": ["S. Murugesan"],
    "respondent_names": ["State"], "trial_case_ref": "S.C. No. 112 of 2023",
    "trial_court": "III Additional District and Sessions Court, Tiruchirappalli",
    "judgment_date": "2026-10-20", "convicted_sections": ["Section 304 Part II IPC"],
    "sentence_text": "five years' rigorous imprisonment and a fine of Rs. 10,000",
    "max_sentence_years": 5, "offence_date": "2022-04-14", "filing_date": "2026-11-07",
    "place": "Chennai", "appellant_in_custody": True,
    "court_name": "High Court of Madras", "draft_suspension_petition": True,
    "custody_since": "2026-10-20",
}


def test_criminal_appeal_tiruchirappalli_case_keeps_the_madurai_bench_heading():
    """r10: a Tiruchirappalli appeal named "Madras High Court" lost the Madurai Bench."""
    text = "\n".join(_draft("criminal_appeal", _APPEAL))
    assert "IN THE HIGH COURT OF JUDICATURE AT MADRAS\n(MADURAI BENCH)" in text
    assert "CRL.A.(MD) No. ______ of 2026" in text and "CRL.M.P.(MD) No." in text
    # a Chennai trial court stays at the principal seat
    chennai = "\n".join(_draft("criminal_appeal", {**_APPEAL, "trial_court": "I Additional Sessions Court, Chennai"}))
    assert "MADURAI" not in chennai and "CRL.A. No." in chennai


def test_criminal_appeal_suspension_petition_has_custody_grounds_affidavit_and_alternative_prayer():
    """r10: the s.430 BNSS petition was thin, had no affidavit, and the appeal no
    alternative prayer to reduce the sentence."""
    text = "\n".join(_draft("criminal_appeal", _APPEAL))
    assert "acquit the appellant of all the charges, or, in the alternative, reduce the sentence" in text
    assert "The sentence imposed is imprisonment for a fixed term." in text
    assert "has been in custody since" in text and "fair chance of success" in text
    aff = text[text.index("\nAFFIDAVIT\n"):]
    assert aff.count("I have been in custody since") == 1
    assert "I, S. Murugesan, [age, parentage and address of the deponent], do hereby solemnly affirm" in aff
    assert "BEFORE ME" in aff
