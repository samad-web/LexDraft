"""Suite r10 senior-advocate review, criminal formats: each test is named
<format>_<defect> and drives the engine end to end (TestClient) with the facts
of the r10 brief for that format."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from fastapi.testclient import TestClient  # noqa: E402

from src.service.app import app  # noqa: E402

client = TestClient(app)
MATTER = {"matter_id": "M-R10-CRIM", "version": 1}


def _draft(doc_type, fields, **extra):
    r = client.post(f"/v1/draft/{doc_type}", json={"matter": MATTER, "fields": fields, **extra})
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


# --- criminal_revision ------------------------------------------------------------

_REVISION = {
    "forum": "high_court", "petitioner_names": ["Mr. R. Kathiresan"],
    "respondent_names": ["[respondent names to be provided]"],
    "impugned_order_ref": "C.A. No. 22 of 2025", "impugned_order_date": "2026-09-30",
    "lower_court": "Additional District and Sessions Court, Srivilliputhur",
    "case_ref": "S.T.C. No. 340 of 2021", "filing_date": "2026-11-07", "place": "Madurai",
    "offence_date": "2021-01-15",
    "convicted_sections": ["Dishonour of a cheque for Rs. 4,00,000"],
    "sentence_text": "six months' simple imprisonment and compensation of Rs. 4,00,000",
    "court_name": "High Court of Madras", "trial_court": "Judicial Magistrate No. I, Sivakasi",
}


def test_criminal_revision_ni_act_conviction_cites_section_138_not_the_offence_name():
    """r10: the prayer read "acquit ... of the offence under Dishonour of a cheque",
    and Sections 138/139 NI Act were never recited."""
    text = "\n".join(_draft("criminal_revision", _REVISION))
    assert "under Dishonour of a cheque" not in text
    assert "1A. The petitioner stands convicted for the offence under Section 138 of the Negotiable Instruments Act, 1881" in text
    assert "presumption under Section 139" in text
    assert "CRL.R.C.(MD) No. ______ of 2026" in text


def test_criminal_revision_prayer_sets_aside_both_judgments_and_acquits():
    text = "\n".join(_draft("criminal_revision", _REVISION))
    assert ("set aside the same as well as the judgment of conviction and sentence dated "
            "[date of the trial court's judgment] passed by Judicial Magistrate No. I, Sivakasi in "
            "S.T.C. No. 340 of 2021, and acquit the petitioner of the offence under Section 138 "
            "of the Negotiable Instruments Act, 1881") in text


# --- writ_criminal ----------------------------------------------------------------

_WRIT = {
    "petitioner_name": "Mrs. R. Chellammal", "petitioner_address": "Pudukkottai",
    "respondents": ["The District Collector and District Magistrate, Pudukkottai"],
    "impugned_order_ref": "Detention order passed by the District Collector and District Magistrate, Pudukkottai",
    "impugned_order_date": "2026-09-12", "impugned_order_statute": "[impugned order statute to be provided]",
    "facts_narrative": ("Mr. R. Saravanan, aged 26, has been detained as a 'Goonda' and is now in "
                        "Central Prison, Tiruchirappalli."),
    "grounds": ["The representation dated 25.09.2026 was rejected only on 30.10.2026."],
    # the r10 extraction set this wrongly though the detenu is in prison
    "pre_execution_stage": True, "no_similar_petition": True,
    "filing_date": "2026-11-07", "place": "Madurai", "high_court": "Madras High Court",
    "detenu_name": "Mr. R. Saravanan", "police_station": "Pudukkottai Town",
}


def test_writ_criminal_goondas_detenu_in_prison_is_a_habeas_corpus_petition_md():
    """r10: numbered W.P.(Crl.), prayed certiorari, no statute, no prison respondent."""
    text = "\n".join(_draft("writ_criminal", _WRIT, allow_placeholders=True))
    assert "H.C.P.(MD) No. ______ of 2026" in text and "W.P.(Crl.)" not in text
    assert "(MADURAI BENCH)" in text
    assert "HABEAS CORPUS PETITION FILED UNDER ARTICLE 226" in text
    assert "issue a Writ of Habeas Corpus" in text and "Certiorari" not in text
    assert "direct the respondents to produce the detenu, Mr. R. Saravanan," in text
    assert "set the detenu at liberty" in text
    assert "(Tamil Nadu Act 14 of 1982)" in text and "[impugned order statute" not in text
    assert "The Superintendent, Central Prison, Tiruchirappalli" in text
    assert "Alka Subhash Gadia" not in text


# --- quash_petition ---------------------------------------------------------------

_QUASH = {
    "petitioner_names": ["Mr. K. Rajesh", "Mrs. K. Valli", "Mrs. S. Deepa"],
    "respondent_names": ["Mrs. R. Sangeetha"], "target": "fir",
    "proceeding_ref": "Crime No. 45 of 2026", "proceeding_forum": "All Women Police Station, Salem Town",
    "sections": ["[sections to be provided]"], "offence_date": "2026-02-14",
    "filing_date": "2026-11-07", "place": "Chennai",
    "facts_narrative": "The wife lodged a complaint alleging cruelty and dowry harassment after the divorce notice.",
    "alternative_quash_against": ["Mrs. K. Valli (A2)", "Mrs. S. Deepa (A3)"],
}


def test_quash_petition_cruelty_dowry_fir_names_bns_85_and_dp_act_4():
    """r10: the brief says "cruelty and dowry harassment"; the sections stayed blank."""
    text = "\n".join(_draft("quash_petition", _QUASH, allow_placeholders=True))
    assert ("registered for the alleged offences under Section 85 of the Bharatiya Nyaya Sanhita, "
            "2023, Section 4 of the Dowry Prohibition Act, 1961") in text
    assert "[sections to be provided]" not in text


def test_quash_petition_prays_in_the_alternative_against_a2_and_a3():
    text = "\n".join(_draft("quash_petition", _QUASH, allow_placeholders=True))
    assert ("quash the same as against the petitioners, or, in the alternative, quash the same at "
            "least as against Mrs. K. Valli (A2) and Mrs. S. Deepa (A3), and pass") in text
