"""A template prefix the value already carries is printed once, not twice."""

import pytest
from docx import Document

from src.components.render import collapse_doubled_tokens


def _clean(*runs: str) -> str:
    doc = Document()
    p = doc.add_paragraph()
    for t in runs:
        p.add_run(t).bold = True
    collapse_doubled_tokens(doc)
    assert all(r.bold for r in p.runs)  # run formatting survives
    return p.text


@pytest.mark.parametrize("runs, want", [
    (("I, P. Ganesan S/o ", "S/o Palanisamy"), "I, P. Ganesan S/o Palanisamy"),
    (("daughter D/o ", "D/o Murugan"), "daughter D/o Murugan"),
    (("W/o W/o Ravi",), "W/o Ravi"),
    (("bail in the sum of Rs. ", "Rs. 10,000."), "bail in the sum of Rs. 10,000."),
    (("the accused Mr ", "Mr. R. Vinoth"), "the accused Mr. R. Vinoth"),
    (("Mr. Mr. S. Arun",), "Mr. S. Arun"),
    (("Mr./Ms. ", "Mr. S. Arun"), "Mr. S. Arun"),
    (("Hasthampatti Police Station ", "Police Station"), "Hasthampatti Police Station"),
    (("O.S. No. 77 of 20", "2025"), "O.S. No. 77 of 2025"),
    (("I.A. No. 245\tof 20", "2026"), "I.A. No. 245\tof 2026"),
])
def test_render_collapses_doubled_prefix(runs, want):
    assert _clean(*runs) == want


@pytest.mark.parametrize("text", [
    "K. Ramesh S/o Kandasamy and D/o Murugan",
    "a sum of Rs. 4,00,000 (Rupees Four Lakhs only)",
    "Mr. A. Kumar and Mr. B. Ravi, Mrs. C. Devi",
    "Mr./Ms. S. Arun",
    "Hasthampatti Police Station, Salem",
    "O.S. No. 156 of 2022; Crime No. 202026; PIN 641001; of 2020",
    "that that is so",
])
def test_render_leaves_legitimate_text_untouched(text):
    assert _clean(text) == text


def test_render_collapses_in_tables_and_headers():
    doc = Document()
    doc.add_table(rows=1, cols=1).cell(0, 0).paragraphs[0].add_run("Rs. Rs. 500")
    doc.sections[0].header.paragraphs[0].add_run("of 202026")
    collapse_doubled_tokens(doc)
    assert doc.tables[0].cell(0, 0).text == "Rs. 500"
    assert doc.sections[0].header.paragraphs[0].text == "of 2026"
