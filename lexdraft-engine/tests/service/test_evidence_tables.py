"""Evidence tables (build-docs/features/evidence-tables.md): a list of documents or a
summary of admissions written as pipe rows becomes a ruled Word table, reads back as
one "| a | b |" line per row, and survives edits and body splices."""

import io
from pathlib import Path

from docx import Document

from src.service.app import _extract_blocks
from src.service.apply_edits import apply_edits, splice_lines
from src.service.compose import compose_docx
from src.service.tables import expand, is_row, runs_of

DOCS = [
    "| Sr. No | Date | Description of document | Remarks |",
    "| 01. | 13-02-2026 | Copy of CSR No.262/2026 issued by Respondent Police | Xerox |",
    "| 02. | 29-03-2025 | Bank Transaction Details | Xerox |",
]


def _compose(lines, tmp_path: Path, kind=None):
    out = compose_docx(lines, tmp_path / "t.docx", kind)
    return out, Document(str(out))


def test_list_of_documents_becomes_a_ruled_table_with_heading_row(tmp_path):
    out, doc = _compose(["IN THE COURT OF THE JUDICIAL MAGISTRATE", "LIST OF DOCUMENTS", *DOCS], tmp_path)
    assert len(doc.tables) == 1
    t = doc.tables[0]
    assert [c.text for c in t.rows[0].cells] == ["Sr. No", "Date", "Description of document", "Remarks"]
    assert t.rows[2].cells[2].text == "Bank Transaction Details"
    assert all(r.bold for r in t.rows[0].cells[0].paragraphs[0].runs)  # heading row bold
    assert t.rows[0]._tr.trPr.find("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tblHeader") is not None
    xml = t._tbl.xml
    assert "w:tblBorders" in xml and 'w:val="single"' in xml  # ruled


def test_table_written_as_one_markdown_paragraph_with_rule_line(tmp_path):
    md = "| Point | Admission / Position |\n|---|---|\n| Mother's salary | Rs.96,000/- per month |\n| Salary proof | Not filed |"
    _, doc = _compose(["SUMMARY OF ADMISSIONS", md], tmp_path)
    assert len(doc.tables) == 1
    assert len(doc.tables[0].rows) == 3  # rule dropped, heading + 2 rows
    assert doc.tables[0].rows[1].cells[1].text == "Rs.96,000/- per month"


def test_blocks_read_back_one_pipe_line_per_row_in_reading_order(tmp_path):
    out, _ = _compose(["1. The Petitioner relies on:", *DOCS, "2. Hence this petition."], tmp_path)
    texts = [b["text"] for b in _extract_blocks(out)]
    i = texts.index(DOCS[0])
    assert texts[i:i + 3] == DOCS
    assert texts[i - 1].startswith("1.") and texts[i + 3].startswith("2.")
    rows = [b for b in _extract_blocks(out) if b.get("table")]
    assert len(rows) == 3 and rows[0].get("bold")


def test_uneven_rows_padded_or_folded_to_heading_width():
    (table,) = runs_of(["| A | B | C |", "| 1 | 2 |", "| x | y | z | w |"])
    assert table == [["A", "B", "C"], ["1", "2", ""], ["x", "y", "z w"]]


def test_prose_with_a_pipe_and_a_lone_row_stay_text():
    assert not is_row("The cheque | was dishonoured")
    assert runs_of(["| only one row |x|"]) == ["| only one row |x|"]
    assert expand(["Para one.\nPara two."]) == ["Para one.\nPara two."]


def test_no_table_draft_unchanged(tmp_path):
    _, doc = _compose(["IN THE COURT OF X", "1. The facts are these.", "PRAYER"], tmp_path)
    assert doc.tables == []


def test_cell_edit_written_back_into_the_table(tmp_path):
    out, _ = _compose(["1. Documents:", *DOCS], tmp_path)
    blocks = [b["text"] for b in _extract_blocks(out)]
    edited = [t.replace("Bank Transaction Details", "Bank Statement") for t in blocks]
    new = Document(io.BytesIO(apply_edits(out.read_bytes(), edited)))
    assert new.tables[0].rows[2].cells[2].text == "Bank Statement"
    assert len(new.tables[0].rows) == 3


def test_splice_inserts_a_composed_table_and_keeps_the_rest(tmp_path):
    out, _ = _compose(["IN THE COURT OF X", "1. Old para.", "2. Old para two.", "PRAYER"], tmp_path)
    blocks = [b["text"] for b in _extract_blocks(out)]
    s, e = blocks.index("1. Old para."), blocks.index("2. Old para two.")
    spliced = splice_lines(out.read_bytes(), s, e, ["1. New para.", "\n".join(DOCS), "2. After table."])
    doc = Document(io.BytesIO(spliced))
    assert len(doc.tables) == 1 and len(doc.tables[0].rows) == 3
    path = tmp_path / "s.docx"
    path.write_bytes(spliced)
    texts = [b["text"] for b in _extract_blocks(path)]
    assert texts[texts.index("1. New para.") + 1] == DOCS[0]
    assert "PRAYER" in texts and "1. Old para." not in texts


def test_splice_over_an_existing_table_replaces_it(tmp_path):
    out, _ = _compose(["1. Docs:", *DOCS, "2. End."], tmp_path)
    blocks = [b["text"] for b in _extract_blocks(out)]
    s = blocks.index(DOCS[1])
    spliced = splice_lines(out.read_bytes(), s, s, ["| 01. | 14-02-2026 | Corrected CSR copy | Original |"])
    doc = Document(io.BytesIO(spliced))
    assert len(doc.tables) == 1
    assert [r.cells[2].text for r in doc.tables[0].rows] == ["Description of document", "Corrected CSR copy", "Bank Transaction Details"]
