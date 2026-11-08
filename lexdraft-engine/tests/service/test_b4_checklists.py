"""b4: benchmark-h2h batch-4 checklist FAILs (deeds, notices, court forms), carried by
the engine output. One test per item, through the real /v1/draft endpoint."""

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from tests.service.test_all_adapters_roundtrip import PAYLOADS  # noqa: E402
from tests.service.test_court_forms_quality_r12 import _BATTA  # noqa: E402
from tests.service.test_r16_checklists import _text  # noqa: E402


def test_general_notice_item5_subject_line():
    notice = {**PAYLOADS["general_notice"],
              "act_required": "refund the security deposit of Rs. 1,50,000 to my client, together "
                              "with interest at 12% p.a. from 31.08.2026"}
    text = _text("general_notice", notice)
    assert "Sub: Demand for refund of the security deposit of Rs. 1,50,000\n" in text
    assert text.index("LEGAL NOTICE") < text.index("Sub: ") < text.index("1. Under instructions")
    stated = _text("general_notice", {**notice, "subject": "Subject: Refund of security deposit"})
    assert "Sub: Refund of security deposit\n" in stated


def test_appeal_record_cost_schedule_item5_typed_matter_pages():
    sched = {**PAYLOADS["appeal_record_cost_schedule"], "documents": [
        {"description": "Typed matter of the record", "pages": "120 pages"},
        {"description": "Exhibits to be copied", "count": "4"}]}
    text = _text("appeal_record_cost_schedule", sched)
    assert "1. Typed matter of the record (120 pages); estimated cost" in text
    assert "Form 476" not in text  # item 8 left: the form number is unverified


def test_batta_witness_item8_unknown_side_is_one_named_gap():
    text = _text("batta_witness", {k: v for k, v in _BATTA.items() if k != "applicant_role"})
    assert "above named [Plaintiff / Defendant] for issue of Process" in text
    assert "Counsel for [Plaintiff / Defendant]" in text
    assert "above named Plaintiff" not in text and "Plaintiff - Defendant" not in text
    assert "above named Defendant for issue" in _text("batta_witness", {**_BATTA, "applicant_role": "defendant"})


def test_coding_sheet_item7_counsel_signature_and_date():
    sheet = {**PAYLOADS["coding_sheet"], "petitioner_counsel": "Mr. S. Arun", "filing_date": "2026-11-08"}
    text = _text("coding_sheet", sheet)
    assert "Place: Chennai\nDate: 08.11.2026\nMr. S. Arun\nCounsel for the Petitioner/Appellant" in text
    bare = _text("coding_sheet", PAYLOADS["coding_sheet"])
    assert "Date: [date]\n[name of counsel]\nCounsel for the Petitioner/Appellant" in bare


def test_copy_application_item7_rule_is_a_named_gap_and_documents_in_body():
    app = {**PAYLOADS["copy_application"], "rule_ref": None, "applicant_role": "Defendant",
           "documents": [{"description": "Judgment and decree", "date_of_document": "10.10.2026"}]}
    text = _text("copy_application", app)
    assert "UNDER [rule under the Civil Rules of Practice]" in text
    assert "UNDER RULE ______" not in text
    assert "of the document hereunder mentioned, namely the judgment and decree dated 10.10.2026," in text
    # a supplied rule_ref is not trusted (often the case's sections): still the gap
    assert "UNDER [rule under the Civil Rules of Practice]" in _text("copy_application", PAYLOADS["copy_application"])


def test_power_of_attorney_item12_executed_abroad_at_the_foreign_place():
    poa = {**PAYLOADS["power_of_attorney"], "executant_name": "Mr. R. Dinesh",
           "executant_description": "aged 34 years, residing at No. 2, R.S. Puram, Coimbatore, now working in Dubai",
           "place": "Coimbatore", "executed_abroad": True}
    text = _text("power_of_attorney", poa)
    assert "execute this GENERAL POWER OF ATTORNEY at Dubai on" in text
    assert "at Coimbatore on" not in text
    unknown = {**poa, "executant_description": "aged 34 years, residing at No. 2, R.S. Puram, Coimbatore"}
    assert "at [place of execution outside India] on" in _text("power_of_attorney", unknown)
    assert "at Coimbatore on" in _text("power_of_attorney", {**poa, "executed_abroad": False})


def test_summons_item9_order_viii_rule_1a_documents():
    summ = {**PAYLOADS["summons"], "kind": "civil_defendant", "case_ref": "O.S. No. 212 of 2026",
            "cause_of_action": "permanent injunction"}
    text = _text("summons", summ)
    assert ("to produce on that day, along with the written statement, all documents in your possession "
            "or power upon which you base your defence") in text
    assert "as required by Order VIII Rule 1A of the Code of Civil Procedure, 1908" in text


URGENT = {**PAYLOADS["urgent_petition"], "underlying_application": "I.A. No. 610 of 2026",
          "urgency_grounds": "the defendant started construction on the suit property on 01.11.2026"}


def test_urgent_petition_item7_prejudice_pleaded():
    text = _text("urgent_petition", URGENT)
    plea = ("If the construction is allowed to proceed before I.A. No. 610 of 2026 is heard, the nature of "
            "the suit property will be altered irretrievably and I.A. No. 610 of 2026 itself will be "
            "rendered infructuous")
    assert text.count(plea) == 2  # petition and affidavit
    assert "infructuous" not in _text("urgent_petition", PAYLOADS["urgent_petition"])  # no grounds, no plea


def test_urgent_petition_item10_date_line():
    assert "Place: Chennai          Dated: 08.11.2026" in _text("urgent_petition", {**URGENT, "filing_date": "2026-11-08"})
    assert "Place: Chennai          Dated: ______" in _text("urgent_petition", URGENT)
