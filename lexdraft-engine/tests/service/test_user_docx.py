"""import-edit-document: an advocate's own .docx — read for editing, edits written back
with their layout (acceptance 1, 2, 9 of features/import-edit-document.md)."""

import base64
import io
import zipfile

import pytest

pytest.importorskip("fastapi", reason="service extras not installed (pip install -e .[service])")

from docx import Document  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402
from docx.oxml import OxmlElement  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.shared import Inches, Pt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.service import user_docx  # noqa: E402
from src.service.app import app  # noqa: E402
from src.service.apply_edits import apply_edits  # noqa: E402

client = TestClient(app)

# 1x1 PNG
_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")


def _own_docx(*, font="Times New Roman", tracked=False) -> bytes:
    d = Document()
    s = d.sections[0]
    s.left_margin = Inches(1.5)
    s.header.paragraphs[0].text = "ANAND & CO., ADVOCATES"
    s.footer.paragraphs[0].text = "Page footer"
    h = d.add_paragraph()
    h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = h.add_run("IN THE COURT OF THE DISTRICT JUDGE, MADURAI")
    r.bold = True
    for i in range(1, 5):
        p = d.add_paragraph()
        p.paragraph_format.first_line_indent = Inches(0.5)
        run = p.add_run(f"{i}. The petitioner states fact number {i}.")
        run.font.name = font
        run.font.size = Pt(14)
    t = d.add_table(rows=2, cols=2)
    t.cell(0, 0).text, t.cell(0, 1).text = "S.No", "Document"
    t.cell(1, 0).text, t.cell(1, 1).text = "1", "Sale deed"
    d.add_paragraph().add_run().add_picture(io.BytesIO(_PNG), width=Inches(0.5))
    d.add_paragraph("Advocate for the Petitioner").alignment = WD_ALIGN_PARAGRAPH.RIGHT
    if tracked:
        p = d.paragraphs[1]._p
        ins = OxmlElement("w:ins")
        ins.set(qn("w:id"), "1")
        ins.set(qn("w:author"), "x")
        r = OxmlElement("w:r")
        t_el = OxmlElement("w:t")
        t_el.text = " inserted"
        r.append(t_el)
        ins.append(r)
        p.append(ins)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _read(raw: bytes):
    return client.post("/v1/read-docx", json={"docx_base64": base64.b64encode(raw).decode()})


def _texts(raw: bytes):
    return [b["text"] for b in _read(raw).json()["blocks"]]


def _doc(raw: bytes):
    return Document(io.BytesIO(raw))


# ---- reading (acceptance 1) ---------------------------------------------------

def test_read_docx_returns_layout_blocks_and_warnings():
    r = _read(_own_docx())
    assert r.status_code == 200
    body = r.json()
    first = body["blocks"][0]
    assert first["text"].startswith("IN THE COURT") and first["align"] == "center" and first["bold"]
    assert any(b.get("table") and "Sale deed" in b["text"] for b in body["blocks"])
    assert body["blocks"][-1]["align"] == "right"
    assert {"header_footer", "images"} <= set(body["warnings"])
    assert "legacy_tamil_font" not in body["warnings"]


def test_read_docx_flags_legacy_tamil_font():
    assert "legacy_tamil_font" in _read(_own_docx(font="Bamini")).json()["warnings"]


# ---- refusals (acceptance 9) --------------------------------------------------

@pytest.mark.parametrize("raw,code", [
    (b"%PDF-1.7 not a word file", "not_docx"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 100, "encrypted_or_doc"),
])
def test_read_docx_refuses_non_docx(raw, code):
    r = _read(raw)
    assert r.status_code == 422 and r.json()["detail"]["error"] == code


def test_read_docx_refuses_macro_file():
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(_own_docx())) as src, zipfile.ZipFile(buf, "w") as out:
        for n in src.namelist():
            out.writestr(n, src.read(n))
        out.writestr("word/vbaProject.bin", b"macro")
    assert _read(buf.getvalue()).json()["detail"]["error"] == "macro"


def test_read_docx_refuses_zip_bomb(monkeypatch):
    monkeypatch.setattr(user_docx, "MAX_UNZIPPED_BYTES", 1000)
    assert _read(_own_docx()).json()["detail"]["error"] == "too_large"


def test_read_docx_refuses_tracked_changes():
    assert _read(_own_docx(tracked=True)).json()["detail"]["error"] == "tracked_changes"


def test_read_docx_refuses_empty_document():
    buf = io.BytesIO()
    Document().save(buf)
    assert _read(buf.getvalue()).json()["detail"]["error"] == "empty"


def test_read_docx_rejects_bad_base64():
    r = client.post("/v1/read-docx", json={"docx_base64": "***"})
    assert r.status_code == 422


# ---- writing back with paragraphs added / removed (acceptance 2) ---------------

def test_added_paragraph_keeps_header_footer_margins_and_neighbour_format():
    raw = _own_docx()
    lines = _texts(raw)
    i = lines.index("2. The petitioner states fact number 2.")
    edited = lines[:i + 1] + ["2A. A new fact the advocate typed."] + lines[i + 1:]
    out = _doc(apply_edits(raw, edited))
    before = _doc(raw)
    assert out.sections[0].header.paragraphs[0].text == "ANAND & CO., ADVOCATES"
    assert out.sections[0].footer.paragraphs[0].text == "Page footer"
    assert out.sections[0].left_margin == before.sections[0].left_margin
    texts = [p.text for p in out.paragraphs]
    k = texts.index("2A. A new fact the advocate typed.")
    assert texts[k - 1] == "2. The petitioner states fact number 2."
    new = out.paragraphs[k]
    assert new.runs[0].font.name == "Times New Roman" and new.runs[0].font.size == Pt(14)
    assert new.paragraph_format.first_line_indent == Inches(0.5)
    # untouched paragraphs are byte-identical XML
    assert out.paragraphs[0]._p.xml == before.paragraphs[0]._p.xml
    assert len(out.inline_shapes) == 1  # the logo/stamp survives


def test_deleted_paragraph_is_removed_and_the_rest_kept():
    raw = _own_docx()
    lines = [l for l in _texts(raw) if l != "3. The petitioner states fact number 3."]
    out = _doc(apply_edits(raw, lines))
    texts = [p.text for p in out.paragraphs]
    assert "3. The petitioner states fact number 3." not in texts
    assert "4. The petitioner states fact number 4." in texts
    assert out.sections[0].header.paragraphs[0].text == "ANAND & CO., ADVOCATES"


def test_added_and_edited_lines_together():
    raw = _own_docx()
    lines = _texts(raw)
    edited = [l.replace("fact number 1", "fact number one") for l in lines]
    edited.insert(len(edited) - 1, "Place: Madurai")
    texts = [p.text for p in _doc(apply_edits(raw, edited)).paragraphs]
    assert "1. The petitioner states fact number one." in texts
    # a plain line typed after the table lands after the table, before the signature
    assert texts.index("Place: Madurai") < texts.index("Advocate for the Petitioner")
    assert texts.count("Place: Madurai") == 1


def test_added_table_row_clones_the_row():
    raw = _own_docx()
    lines = _texts(raw)
    i = next(k for k, l in enumerate(lines) if "Sale deed" in l)
    edited = lines[:i + 1] + ["| 2 | Patta |"] + lines[i + 1:]
    t = _doc(apply_edits(raw, edited)).tables[0]
    assert [c.text for c in t.rows[2].cells] == ["2", "Patta"]
    assert len(t.rows) == 3


def test_new_paragraph_after_a_heading_takes_body_format():
    raw = _own_docx()
    lines = _texts(raw)
    edited = lines[:1] + ["The humble petition of the petitioner."] + lines[1:]
    out = _doc(apply_edits(raw, edited))
    p = next(p for p in out.paragraphs if p.text == "The humble petition of the petitioner.")
    assert p.alignment != WD_ALIGN_PARAGRAPH.CENTER
    assert not p.runs[0].bold


def test_unrelated_text_is_not_forced_into_the_document():
    raw = _own_docx()
    assert apply_edits(raw, ["Completely different", "content", "here"]) is None


def test_same_count_path_is_unchanged():
    raw = _own_docx()
    lines = _texts(raw)
    edited = [l.replace("fact number 4", "fact number four") for l in lines]
    out = _doc(apply_edits(raw, edited))
    before = _doc(raw)
    assert len(out.paragraphs) == len(before.paragraphs)
    assert "4. The petitioner states fact number four." in [p.text for p in out.paragraphs]


def test_start_end_alignment_from_libreoffice_or_new_word_is_read():
    # LibreOffice / newer Word write w:jc="start"/"end"; python-docx raises on them.
    d = Document()
    for text, jc in (("Left text", "start"), ("Signed", "end"), ("TITLE", "center")):
        p = d.add_paragraph(text)
        ppr = p._p.get_or_add_pPr()
        el = OxmlElement("w:jc")
        el.set(qn("w:val"), jc)
        ppr.append(el)
    buf = io.BytesIO()
    d.save(buf)
    blocks = _read(buf.getvalue()).json()["blocks"]
    assert [b.get("align") for b in blocks] == [None, "right", "center"]
    lines = [b["text"] for b in blocks]
    out = _doc(apply_edits(buf.getvalue(), lines[:1] + ["Added line"] + lines[1:]))
    assert [p.text for p in out.paragraphs] == ["Left text", "Added line", "Signed", "TITLE"]
