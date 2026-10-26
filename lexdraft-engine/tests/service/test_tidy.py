"""tidy_docx: no leading blanks, no runs of blank paragraphs, Indian body dates."""

from docx import Document

import pytest

from src.service.tidy import court_heading, tidy_docx


@pytest.mark.parametrize("raw, want", [
    ("IN THE COURT OF Judicial Magistrate No. II, Egmore, Chennai (DISTRICT Chennai), ",
     "IN THE COURT OF JUDICIAL MAGISTRATE NO. II, EGMORE, CHENNAI"),
    ("IN THE COURT OF METROPOLITAN MAGISTRATE (DISTRICT Salem), Salem",
     "IN THE COURT OF METROPOLITAN MAGISTRATE (DISTRICT SALEM)"),
    ("IN THE COURT OF THE CHIEF METROPOLITAN MAGISTRATE, Saidapet (DISTRICT Chennai), Chennai",
     "IN THE COURT OF THE CHIEF METROPOLITAN MAGISTRATE, SAIDAPET (DISTRICT CHENNAI)"),
    ("IN THE COURT OF THE DISTRICT MUNSIF, TAMBARAM", "IN THE COURT OF THE DISTRICT MUNSIF, TAMBARAM"),
])
def test_court_heading(raw, want):
    assert court_heading(raw) == want


def test_collapses_blanks_and_formats_dates(tmp_path):
    d = Document()
    for t in ["", "", "TITLE", "", "", "", "Taken into custody on 2026-10-10.", "", "Date: 2026-10-26"]:
        d.add_paragraph(t)
    table = d.add_table(rows=1, cols=1)
    table.rows[0].cells[0].text = "2026-10-10"
    path = tmp_path / "x.docx"
    d.save(path)

    tidy_docx(path)

    doc = Document(path)
    assert [p.text for p in doc.paragraphs] == [
        "TITLE", "", "Taken into custody on 10.10.2026.", "", "Date: 26.10.2026",
    ]
    assert doc.tables[0].rows[0].cells[0].text == "2026-10-10"  # tables untouched
