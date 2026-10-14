"""Smoke test for samples/generate_samples.py.

The five sample documents must always generate without any pipeline refusing —
they are the advocate-session exhibits, so a silent breakage would be embarrassing.
"""

from src.components.render import extract_text
from samples import generate_samples as gs


def test_five_samples_generate(tmp_path):
    written = gs.generate(tmp_path)
    names = {p.stem for p in written}
    assert names == {
        "s138_notice", "regular_bail", "plaint_money_recovery",
        "writ_petition", "mact_claim",
    }
    for p in written:
        assert p.exists() and p.stat().st_size > 0


def test_figure_bearing_samples_carry_the_marker(tmp_path):
    """Plaint and MACT consume VERIFY tables, so (while unverified) they carry the
    table marker; the s.138 notice and writ do not consume one, so they do not."""
    gs.generate(tmp_path, audit_path=tmp_path / "audit.jsonl")
    marker = "[figures unverified — pending advocate review]"
    assert marker in extract_text(tmp_path / "plaint_money_recovery.docx")
    assert marker in extract_text(tmp_path / "mact_claim.docx")
    assert marker not in extract_text(tmp_path / "s138_notice.docx")
    assert marker not in extract_text(tmp_path / "writ_petition.docx")


def test_every_sample_carries_the_review_banner(tmp_path):
    """The mandatory advocate-review banner is on EVERY generated draft, whatever
    tables it consumes (CLAUDE.md rule 6)."""
    from src.verify.signoff import REVIEW_BANNER
    gs.generate(tmp_path, audit_path=tmp_path / "audit.jsonl")
    for name in ("s138_notice", "regular_bail", "plaint_money_recovery",
                 "writ_petition", "mact_claim"):
        assert REVIEW_BANNER in extract_text(tmp_path / f"{name}.docx"), name
