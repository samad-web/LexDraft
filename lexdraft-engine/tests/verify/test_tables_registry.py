"""Tests for the VERIFY table registry (src.verify.tables).

The central contract: the `verified` flag in a JSON file — and nothing else —
decides whether a consuming document shows the unverified marker. Flipping it to
true removes the marker with no code change.
"""

import json

import pytest

from src.verify import tables as T


# Every table shipped in verify/tables/ must load and validate.
ALL_NAMES = [
    "mact_multiplier_bands",
    "mact_future_prospects",
    "mact_personal_expense_deduction",
    "mact_conventional_heads",
    "court_fee_ad_valorem_slabs",
    "court_fee_fixed_fees",
    "pecuniary_limits",
    "consumer_pecuniary_tiers",
    "section_mappings",
    "custody_default_bail_periods",
    "bail_bars",
    "code_appointed_day",
    "limitation_article_periods",
]


@pytest.fixture(autouse=True)
def _fresh_cache():
    """Every test starts from disk, and leaves the cache clean for the next."""
    T.reload()
    yield
    T.reload()


class TestLoading:
    def test_every_registered_table_loads_and_validates(self):
        for name in ALL_NAMES:
            tbl = T.get(name)
            assert tbl.name == name
            assert tbl.description
            assert "act" in tbl.source and "section" in tbl.source
            assert tbl.source_label  # human 'Act, section' for the review pack

    def test_all_tables_enumerates_the_directory(self):
        names = {t.name for t in T.all_tables()}
        assert set(ALL_NAMES) <= names

    def test_unknown_table_raises(self):
        with pytest.raises(T.VerifyRegistryError):
            T.get("no_such_table")


class TestMarker:
    def test_marker_present_while_unverified(self):
        # Shipped tables are all unverified, so the marker is non-empty.
        assert T.marker_for("court_fee_ad_valorem_slabs") == T.UNVERIFIED_MARKER

    def test_marker_is_empty_only_when_all_named_tables_verified(self, tmp_path,
                                                                 monkeypatch):
        # Point the registry at a temp dir with one verified and one unverified
        # table; the marker is empty only when EVERY named table is verified.
        d = tmp_path / "tables"
        d.mkdir()
        _write(d, "verified_one", verified=True,
               reviewed_by="Adv. R. Rao", reviewed_on="2026-09-01")
        _write(d, "unverified_one", verified=False)
        monkeypatch.setattr(T, "_TABLES_DIR", d)
        T.reload()

        assert T.marker_for("verified_one") == ""                     # signed off
        assert T.marker_for("unverified_one") == T.UNVERIFIED_MARKER    # not yet
        assert T.marker_for("verified_one", "unverified_one") == T.UNVERIFIED_MARKER

    def test_flipping_verified_true_removes_the_marker_no_code_change(
            self, tmp_path, monkeypatch):
        """The acceptance criterion: editing ONLY the JSON flag flips the marker."""
        d = tmp_path / "tables"
        d.mkdir()
        path = _write(d, "some_table", verified=False)
        monkeypatch.setattr(T, "_TABLES_DIR", d)
        T.reload()
        assert T.marker_for("some_table") == T.UNVERIFIED_MARKER

        # Advocate signs it off — the only change is in the file.
        raw = json.loads(path.read_text(encoding="utf-8"))
        raw["verified"] = True
        raw["reviewed_by"] = "Adv. R. Rao"
        raw["reviewed_on"] = "2026-09-01"
        path.write_text(json.dumps(raw), encoding="utf-8")
        T.reload()

        assert T.marker_for("some_table") == ""


class TestSignOffDiscipline:
    def test_verified_without_reviewer_is_rejected(self, tmp_path, monkeypatch):
        d = tmp_path / "tables"
        d.mkdir()
        _write(d, "bad_signoff", verified=True, reviewed_by="", reviewed_on="")
        monkeypatch.setattr(T, "_TABLES_DIR", d)
        T.reload()
        with pytest.raises(T.VerifyRegistryError):
            T.get("bad_signoff")


def _write(directory, name, *, verified, reviewed_by="", reviewed_on=""):
    path = directory / f"{name}.json"
    path.write_text(json.dumps({
        "name": name,
        "description": f"test table {name}",
        "source": {"act": "Test Act", "section": "s.1"},
        "values": [1, 2, 3],
        "verified": verified,
        "reviewed_by": reviewed_by,
        "reviewed_on": reviewed_on,
    }), encoding="utf-8")
    return path
