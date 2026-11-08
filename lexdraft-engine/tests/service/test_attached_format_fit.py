"""Attached formats (benchmark-h2h/attached/scores.md): figures and day numbers read
properly after filling, and a number the format typed is not doubled by Word."""

from pathlib import Path

import pytest
from docx import Document

from src.imports import builder
from src.imports.transcribe import SYSTEM_PROMPT
from src.service.tidy import tidy_docx


def _tidied(tmp_path: Path, text: str) -> str:
    path = tmp_path / "t.docx"
    doc = Document()
    doc.add_paragraph(text)
    doc.save(str(path))
    tidy_docx(path)
    return Document(str(path)).paragraphs[0].text


@pytest.mark.parametrize("raw, want", [
    ("an advance of Rs. 110000, which shall be refunded", "an advance of Rs. 1,10,000, which shall be refunded"),
    ("Rs. 110000.", "Rs. 1,10,000."),
    ("Rs. 1,10,000, paid", "Rs. 1,10,000, paid"),
    ("on or before the 5 of every month", "on or before the 5th of every month"),
    ("on the 22 day of March", "on the 22nd day of March"),
    ("on the 11 of each month", "on the 11th of each month"),
    ("the 3 of them agreed", "the 3 of them agreed"),
    ("giving 1 month(s) notice", "giving 1 month notice"),
    ("within 3 month(s)", "within 3 months"),
])
def test_filled_values_read_properly(tmp_path, raw, want):
    assert _tidied(tmp_path, raw) == want


def _built(tmp_path: Path, text: str):
    spec = {"title": "T", "fields": [], "blocks": [{"style": "numbered", "text": text}]}
    path = tmp_path / "s.docx"
    builder.build_docx(spec, path)
    return next(p for p in Document(str(path)).paragraphs if p.text == text)


@pytest.mark.parametrize("text", ["1. The tenant shall pay.", "(a) The tenant shall pay.", "2) Rent."])
def test_typed_number_is_not_auto_numbered_again(tmp_path, text):
    assert _built(tmp_path, text).style.name != "List Number"


def test_untyped_number_keeps_word_numbering(tmp_path):
    assert _built(tmp_path, "The tenant shall pay.").style.name == "List Number"


def test_reader_is_told_to_keep_typed_numbers_and_drop_hints():
    assert "type its number exactly as the source prints it" in SYSTEM_PROMPT
    assert "only says what goes there" in SYSTEM_PROMPT
    assert "letterhead" in SYSTEM_PROMPT and "never a field" in SYSTEM_PROMPT
