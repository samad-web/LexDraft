"""b1 (criminal) senior-advocate checklist FAILs (benchmark-h2h/b1-scores.md), pinned on
the engine render of each brief's facts through the real /v1/draft endpoint. One test
per item, named test_<format>_item<N>."""

import re

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from tests.service.test_r16_checklists import _text  # noqa: E402

ALTS = re.compile(r"\b(?:he/she|his/her|him/her|himself/herself)\b|C\.C\. / Crime No\.|"
                  r"stood surety before / stood surety")

# --- criminal_appeal --------------------------------------------------------

APPEAL = {
    "forum": "high_court", "trial_court_level": "sessions",
    "appellant_names": ["Mr. S. Murugesan"], "respondent_names": ["State"],
    "police_station": "Manachanallur Police Station",
    "trial_case_ref": "S.C. No. 112 of 2023",
    "trial_court": "III Additional District and Sessions Court, Tiruchirappalli",
    "judgment_date": "2026-10-20", "convicted_sections": ["Section 304 Part II IPC"],
    "sentence_text": "five years' rigorous imprisonment and a fine of Rs. 10,000",
    "max_sentence_years": 10, "offence_date": "2022-04-14", "filing_date": "2026-11-08",
    "place": "Madurai", "court_name": "High Court of Judicature at Madras, Madurai Bench",
}


def test_criminal_appeal_item10():
    # Art. 115(b)(i): 60 days to the High Court from a sentence other than death
    text = _text("criminal_appeal", APPEAL, allow_placeholders=True)
    assert ("within the period prescribed by Art. 115(b)(i) of the Schedule to the Limitation "
            "Act, 1963, which allows sixty days for an appeal to the High Court from a sentence "
            "other than a sentence of death.") in text
    assert "115(b)(ii)" not in text
    sessions = _text("criminal_appeal", {**APPEAL, "forum": "sessions", "trial_court_level": "magistrate",
                                         "court_name": None, "max_sentence_years": 3},
                     allow_placeholders=True)
    assert "Art. 115(b)(ii)" in sessions and "thirty days for an appeal to a court other" in sessions


# --- criminal_revision ------------------------------------------------------

REVISION = {
    "forum": "high_court", "petitioner_names": ["Mr. R. Kathiresan"],
    "respondent_names": ["[respondent names to be provided]"],
    "impugned_order_ref": "C.A. No. 22 of 2025", "impugned_order_date": "2026-09-30",
    "lower_court": "Additional District and Sessions Court, Srivilliputhur",
    "case_ref": "S.T.C. No. 340 of 2021", "filing_date": "2026-11-08", "place": "Madurai",
    "is_fresh_action": True, "offence_date": "2021-01-01",
    "sentence_text": "six months' simple imprisonment and compensation of Rs. 4,00,000",
    "facts_narrative": "The petitioner was convicted by the Judicial Magistrate No. I, Sivakasi in "
                       "S.T.C. No. 340 of 2021 for dishonour of a cheque for Rs. 4,00,000.",
    "draft_suspension_petition": True,
}


def test_criminal_revision_item4():
    text = _text("criminal_revision", REVISION, allow_placeholders=True)
    assert "convicted for the offence under Section 138 of the Negotiable Instruments Act, 1881" in text


def test_criminal_revision_item11():
    text = _text("criminal_revision", REVISION, allow_placeholders=True)
    assert ("set aside the same as well as the judgment of conviction and sentence dated "
            "[date of the trial court's judgment] passed by the Judicial Magistrate No. I, Sivakasi "
            "in S.T.C. No. 340 of 2021, and acquit the petitioner of the offence under Section 138 "
            "of the Negotiable Instruments Act, 1881") in text
    # no trial court in the facts: the trial judgment is still set aside
    bare = _text("criminal_revision", {**REVISION, "facts_narrative": "dishonour of a cheque"},
                 allow_placeholders=True)
    assert "as well as the judgment of conviction and sentence passed by the trial court in S.T.C. No. 340 of 2021, and acquit" in bare


def test_criminal_revision_item13():
    text = _text("criminal_revision", REVISION, allow_placeholders=True)
    aff = text.split("PETITION UNDER SECTION 430")[1].split("AFFIDAVIT", 1)[1]
    assert aff.lstrip().startswith("I, Mr. R. Kathiresan,")
    assert "suspend the sentence pending disposal of the revision and release me on bail" in aff
    assert "BEFORE ME" in aff and "DEPONENT" in aff


# --- quash_petition ---------------------------------------------------------

QUASH = {
    "petitioner_names": ["Mr. K. Rajesh", "Mrs. K. Valli", "Mrs. S. Deepa"],
    "respondent_names": ["Mrs. R. Sangeetha"], "target": "fir",
    "proceeding_ref": "Crime No. 45 of 2026", "proceeding_forum": "All Women Police Station, Salem Town",
    "sections": ["[sections to be provided]"], "offence_date": "2026-02-14",
    "filing_date": "2026-11-08", "place": "Chennai",
    "facts_narrative": "complaint by his wife alleging cruelty and dowry harassment",
    "alternative_quash_against": ["Mrs. K. Valli", "Mrs. S. Deepa"],
}


def test_quash_petition_item5():
    text = _text("quash_petition", QUASH, allow_placeholders=True)
    assert ("Section 85 of the Bharatiya Nyaya Sanhita, 2023 [to be confirmed against the FIR], "
            "Section 4 of the Dowry Prohibition Act, 1961 [to be confirmed against the FIR]") in text
    given = _text("quash_petition", {**QUASH, "sections": ["Section 85 BNS"]}, allow_placeholders=True)
    assert "to be confirmed" not in given


def test_quash_petition_item12():
    text = _text("quash_petition", QUASH, allow_placeholders=True)
    stay = text.split("CRL.M.P. No. ______ of 2026\nin\nCRL.O.P. No. ______ of 2026", 1)[1]
    assert "Mr. K. Rajesh" in stay and "Mrs. R. Sangeetha" in stay
    assert "PETITION UNDER SECTION 528 BNSS" in stay
    assert ("stay all further proceedings in Crime No. 45 of 2026 on the file of All Women Police "
            "Station, Salem Town, pending disposal of the Criminal Original Petition") in stay
    assert "[NOTE: An accompanying Crl.M.P." not in text
    assert "CRL.M.P." not in _text("quash_petition", {**QUASH, "stay_sought": False}, allow_placeholders=True)


def test_quash_petition_item13():
    text = _text("quash_petition", QUASH, allow_placeholders=True)
    aff = text.split("\nAFFIDAVIT\n", 1)[1]
    assert aff.startswith("I, Mr. K. Rajesh,")
    assert "I swear to this affidavit on behalf of the other petitioners also" in aff
    assert "A copy of the First Information Report is annexed" in aff
    assert "To be supported by the petitioner's affidavit" not in text


# --- affidavit_of_surety ----------------------------------------------------

AOS = {"court_name": "Judicial Magistrate No. II, Salem", "crime_no": "Crime No. 310 of 2026",
       "police_station": "Hasthampatti Police Station", "accused_name": "Mr. R. Vinoth",
       "surety_name": "Mr. P. Ganesan", "surety_parentage": "Palanisamy", "surety_age": "52",
       "surety_address": "No. 7, Market Street, Salem", "bail_order_date": "30.10.2026",
       "surety_occupation": "Textile merchant", "place": "Salem", "filing_date": "2026-11-08"}


def test_affidavit_of_surety_item10():
    text = _text("affidavit_of_surety", AOS)
    assert "I hereby declare that I have not stood surety in any other case." in text
    assert not ALTS.search(text)
    told = _text("affidavit_of_surety", {**AOS, "prior_suretyship": "stood surety for Mr. A. Kumar in C.C. No. 5 of 2025"})
    assert "I hereby declare that I have stood surety for Mr. A. Kumar in C.C. No. 5 of 2025." in told


# --- call_for_memo ----------------------------------------------------------

CFM = {"court_name": "No. I", "court_place": "Coimbatore", "case_ref": "C.C. No. 340 of 2025",
       "documents": ["the case records of S.T.C. No. 118 of 2024"],
       "purpose": "comparison of the signatures of the accused", "place": "Coimbatore",
       "filing_date": "2026-11-08"}


def test_call_for_memo_item2():
    text = _text("call_for_memo", CFM)
    assert "\nC.C. No. 340 of 2025\n" in text
    assert "C.C.No." not in text and " .\n" not in text


def test_call_for_memo_item8():
    text = _text("call_for_memo", CFM)
    assert "The complainant above named respectfully submits" in text
    assert "COUNSEL FOR THE COMPLAINANT" in text
    # a role the advocate gave wins
    assert "The accused above named" in _text("call_for_memo", {**CFM, "applicant_role": "accused"})


# --- court_warrant ----------------------------------------------------------

WARRANT = {"kind": "arrest", "case_ref": "C.C. No. 412 of 2025", "place": "Madurai",
           "court_name": "Judicial Magistrate No. I, Madurai", "accused_name": "Mr. B. Senthil",
           "accused_address": "No. 8, Simmakkal, Madurai", "default_date": "2026-10-15",
           "despite_summons": True, "return_date": "2026-11-20",
           "addressed_to": "The Inspector of Police, Thallakulam Police Station"}


def test_court_warrant_item10():
    text = _text("court_warrant", WARRANT, allow_placeholders=True)
    assert "summons duly issued to him, you are hereby directed" in text
    assert "to produce him before this Court" in text
    assert not ALTS.search(text)


# --- memorandum_furnish_sureties --------------------------------------------

MFS = {"accused_name": "Mr. R. Vinoth", "granting_court": "Judicial Magistrate No. II, Salem",
       "bail_granted": True, "bail_order_date": "2026-10-30", "case_ref": "Crime No. 310 of 2026",
       "police_station": "Hasthampatti Police Station", "place": "Salem", "filing_date": "2026-11-08",
       "sureties": [{"name": "Mr. P. Ganesan", "address": "Salem", "amount": "10,000"},
                    {"name": "Mr. K. Mohan", "address": "Attur", "amount": "10,000"}]}


def test_memorandum_furnish_sureties_item7():
    text = _text("memorandum_furnish_sureties", MFS)
    assert ("The affidavits of the sureties, with their property documents and proof of identity, "
            "are filed herewith.") in text


def test_memorandum_furnish_sureties_item8():
    text = _text("memorandum_furnish_sureties", MFS)
    assert ("pleased to accept the sureties offered and order the release of the petitioner on bail "
            "and render justice") in text


# --- recall_petition --------------------------------------------------------

RECALL = {"court_name": "No. I", "court_place": "Madurai", "cc_no": "412 of 2025",
          "case_ref": "C.C. No. 412 of 2025", "accused_name": "Mr. B. Senthil",
          "warrant_type": "non-bailable warrant", "warrant_date": "2026-10-15",
          "absence_reason": "he was admitted in Meenakshi Mission Hospital, Madurai from 13.10.2026 to 18.10.2026 for dengue",
          "undertakes_to_appear": True, "place": "Madurai", "filing_date": "2026-11-08"}


def test_recall_petition_item2():
    text = _text("recall_petition", RECALL)
    assert "C.C. No. 412 of 2025" in text
    assert "I am the accused in C.C. No. 412 of 2025 on the file" in text
    assert not ALTS.search(text)
    assert "Crime No. 5 of 2026" in _text("recall_petition", {**RECALL, "cc_no": "Crime No. 5 of 2026", "case_ref": ""})


# --- recall_warrant ---------------------------------------------------------

RW = {"accused_name": "Mr. B. Senthil", "warrant_pending": True, "undertaking_future_appearance": True,
      "absence_reason": "hospitalised for dengue from 13.10.2026 to 18.10.2026 at Meenakshi Mission Hospital, Madurai",
      "case_ref": "C.C. No. 412 of 2025", "place": "Madurai", "court_name": "Judicial Magistrate No. I, Madurai",
      "warrant_date": "2026-10-15", "documents": ["Medical certificate"], "filing_date": "2026-11-08"}


def test_recall_warrant_item11():
    text = _text("recall_warrant", RW, allow_placeholders=True)
    aff = text.split("\nAFFIDAVIT\n", 1)[1]
    assert aff.startswith("I, Mr. B. Senthil, [age, parentage and address of the deponent],")
    assert "I am the accused in C.C. No. 412 of 2025" in aff
    assert ("I could not appear before this Hon'ble Court on 15.10.2026, as I was hospitalised for dengue "
            "from 13.10.2026 to 18.10.2026 at Meenakshi Mission Hospital, Madurai") in aff
    assert "I file herewith Medical certificate" in aff
    assert "BEFORE ME" in aff and "DEPONENT" in aff


# --- s256_condone_absence ---------------------------------------------------

S256 = {"complainant_name": "M/s. Sri Murugan Traders", "accused_name": "[accused name to be provided]",
        "absence_reason": "the proprietor, Mr. K. Senthil, was travelling to Delhi for a family wedding",
        "case_ref": "S.T.C. No. 118 of 2026", "place": "Coimbatore",
        "court_designation": "Judicial Magistrate No. I, Coimbatore", "absence_date": "2026-10-28",
        "post_for": "evidence", "case_nature": "s.138 NI Act", "filing_date": "2026-11-08"}


def test_s256_condone_absence_item9():
    text = _text("s256_condone_absence", {**S256, "restore_sought": True}, allow_placeholders=True)
    assert "represented by counsel, restore the case to file and post the case for evidence" in text
    assert ("[NOTE to the advocate: if the complaint has already been dismissed and the accused acquitted "
            "under Section 279, the Magistrate cannot restore it; the remedy is an appeal or revision.]") in text
    assert "restore the case to file and post the case for evidence." in text   # affidavit too
    plain = _text("s256_condone_absence", S256, allow_placeholders=True)
    assert "restore" not in plain and "NOTE to the advocate" not in plain
    assert "restore the case to file" in _text("s256_condone_absence", {**S256, "case_dismissed": True},
                                               allow_placeholders=True)


# --- s317_dispense_presence -------------------------------------------------

S317 = {"accused_name": "Mr. P. Ravi", "complainant_name": "[complainant name to be provided]",
        "absence_reason": "he is undergoing knee surgery at Ganga Hospital, Coimbatore",
        "absence_not_wanton": True, "case_ref": "S.T.C. No. 118 of 2026", "place": "Coimbatore",
        "magistrate_designation": "Judicial Magistrate No. I", "court_place": "Coimbatore",
        "hearing_date": "2026-11-20", "identity_not_disputed": True, "filing_date": "2026-11-08"}


def test_s317_dispense_presence_item9():
    text = _text("s317_dispense_presence", S317, allow_placeholders=True)
    assert "undertakes that he will not dispute his identity" in text
    assert "permit counsel for the accused to represent him in this case on 20.11.2026" in text
    assert not ALTS.search(text)


def test_s317_dispense_presence_item10():
    text = _text("s317_dispense_presence", S317, allow_placeholders=True)
    aff = text.split("\nAFFIDAVIT\n", 1)[1]
    assert aff.startswith("I, Mr. P. Ravi, [age, parentage and address of the deponent],")
    assert "I am the accused in S.T.C. No. 118 of 2026" in aff
    assert ("I am unable to appear before this Hon'ble Court on 20.11.2026, as I am undergoing knee "
            "surgery at Ganga Hospital, Coimbatore") in aff
    assert "I will not dispute my identity" in aff
    assert "BEFORE ME" in aff and "DEPONENT" in aff


def test_s317_dispense_presence_item11():
    text = _text("s317_dispense_presence", S317, allow_placeholders=True)
    assert "Place: Coimbatore          Dated: 08.11.2026" in text
    undated = _text("s317_dispense_presence", {**S317, "filing_date": None}, allow_placeholders=True)
    assert "Dated: ____________" in undated


# --- surety_affidavit -------------------------------------------------------

SA = {"surety_name": "Mr. K. Mohan", "surety_parentage": "Kandasamy", "surety_age": "47",
      "surety_address": "No. 3, Main Road, Attur", "surety_occupation": "Shop owner",
      "property_particulars": "Rs. 15,00,000", "accused_name": "Mr. R. Vinoth",
      "offence_section": "[offence section to be provided]", "bail_granted": True, "bail_sum": "10,000",
      "id_proofs": ["[id proofs to be provided]"], "case_ref": "Crime No. 310 of 2026",
      "police_station": "Hasthampatti Police Station", "place": "Salem",
      "court_name": "Judicial Magistrate No. II, Salem", "filing_date": "2026-11-08"}


def test_surety_affidavit_item11():
    text = _text("surety_affidavit", SA, allow_placeholders=True)
    assert ("The above proof of identity is produced as required by sub-rule (4) of Rule 14 of the "
            "Criminal Rules of Practice, and two copies of my latest passport size photograph are "
            "produced as required by sub-rule (6) of that Rule.") in text
    assert "[identity document listed in Rule 14(4), e.g. Passport, Voter ID or PAN card]" in text
    assert "[id proofs to be provided]" not in text
    assert "(a) PAN card" in _text("surety_affidavit", {**SA, "id_proofs": ["PAN card"]}, allow_placeholders=True)


# --- surety_memo ------------------------------------------------------------

SM = {"court_name": "Judicial Magistrate No. II", "court_place": "Salem", "crime_no": "Crime No. 310 of 2026",
      "police_station": "Hasthampatti Police Station", "accused_name": "Mr. R. Vinoth", "place": "Salem",
      "filing_date": "2026-11-08",
      "sureties": [{"name": "Mr. P. Ganesan", "address": "Salem", "amount": "10,000"},
                   {"name": "Mr. K. Mohan", "address": "Attur", "amount": "10,000"}],
      "documents": ["property documents of the sureties", "identity proofs of the sureties"]}


def test_surety_memo_item2():
    text = _text("surety_memo", SM)
    assert "--- Complainant\n- Versus -\nMr. R. Vinoth  --- Accused\n" in text
    assert "--- Accused\nMr. R. Vinoth" not in text


def test_surety_memo_item8():
    text = _text("surety_memo", SM)
    assert ("the sureties are being furnished for the accused above named; they may be accepted and the "
            "accused may be released on bail") in text
    assert "sureties is" not in text
    one = _text("surety_memo", {**SM, "sureties": SM["sureties"][:1]})
    assert "the surety is being furnished for the accused above named; the surety may be accepted" in one
