"""Tests for the averment registry (src.verify.averments) and Section B."""

import json

import pytest

from src.verify import averments as A


class TestLoading:
    def test_every_document_loads_and_validates(self):
        docs = A.all_documents()
        assert len(docs) >= 16  # one per document type (mutual divorce is two)
        for d in docs:
            assert d.document and d.spec and d.title
            assert d.entries, f"{d.document} has no averments"
            for e in d.entries:
                assert e.kind in {"mandatory", "advisory"}
                assert e.source_type in {"statute", "case_law", "local_practice"}
                assert e.source_label

    def test_documents_are_sorted_by_spec(self):
        specs = [d.spec for d in A.all_documents()]
        # 2.x before 3.x before 4.x ... (natural spec order, not lexical)
        assert specs == sorted(specs, key=A._spec_key)

    def test_mandatory_and_advisory_partition_the_entries(self):
        d = A.get("plaint")
        assert len(d.mandatory()) + len(d.advisory()) == len(d.entries)
        assert d.mandatory()  # a plaint has mandatory averments

    def test_unknown_document_raises(self):
        with pytest.raises(A.AvermentRegistryError):
            A.get("no_such_document")


class TestSignOffDiscipline:
    def test_verified_entry_without_reviewer_is_rejected(self, tmp_path,
                                                         monkeypatch):
        d = tmp_path
        (d / "bad.json").write_text(json.dumps({
            "document": "bad", "spec": "9.9", "title": "Bad",
            "entries": [{
                "averment": "x", "kind": "mandatory",
                "source": {"type": "statute", "ref": "s.1"},
                "verified": True, "reviewed_by": "", "reviewed_on": "",
            }],
        }), encoding="utf-8")
        monkeypatch.setattr(A, "_AVERMENTS_DIR", d)
        with pytest.raises(A.AvermentRegistryError):
            A.get("bad")


class TestSectionB:
    def test_section_b_lists_every_document_and_averment(self):
        text = A.section_b()
        assert text.startswith("# Section B — Mandatory Averments")
        docs = A.all_documents()
        for d in docs:
            assert f"## {d.spec} — {d.title}" in text
            for e in d.entries:
                # the averment text (minus any escaped pipes) appears in the table
                assert e.averment.split("(")[0].strip()[:30] in text

    def test_section_b_reflects_current_signoff_state(self, tmp_path, monkeypatch):
        d = tmp_path
        (d / "doc.json").write_text(json.dumps({
            "document": "doc", "spec": "1.0", "title": "Doc",
            "entries": [
                {"averment": "first", "kind": "mandatory",
                 "source": {"type": "statute", "ref": "s.1"},
                 "verified": True, "reviewed_by": "Adv. Rao",
                 "reviewed_on": "2026-09-01"},
                {"averment": "second", "kind": "mandatory",
                 "source": {"type": "statute", "ref": "s.2"},
                 "verified": False, "reviewed_by": "", "reviewed_on": ""},
            ],
        }), encoding="utf-8")
        monkeypatch.setattr(A, "_AVERMENTS_DIR", d)
        text = A.section_b()
        assert "1 verified, 1 pending" in text
        # the verified row shows 'yes', the pending row shows 'PENDING'
        assert "| first | mandatory | Statute: s.1 | yes |" in text
        assert "| second | mandatory | Statute: s.2 | PENDING |" in text
