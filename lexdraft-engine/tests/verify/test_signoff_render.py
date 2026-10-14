"""End-to-end: the review banner in rendered .docx output, and its suppression.

Proves against real rendered documents that:
  1. a generated draft carries the review banner;
  2. for a figure-bearing document, the banner and the table marker BOTH appear;
  3. after an explicit, recorded sign-off, the SAME document renders with the
     banner gone (the table marker, if any, is unaffected — a different signal);
  4. revising the fact sheet after sign-off restores the banner (stale sign-off);
  5. a document with an unfilled slot cannot be signed off, so it always shows it.
"""

from datetime import datetime, timezone

import pytest

from src.components.render import extract_text
from src.verify import signoff as S
from samples import generate_samples as gs

BANNER = S.REVIEW_BANNER
MARKER = "[figures unverified — pending advocate review]"


def test_draft_shows_banner_signoff_removes_it_and_revision_restores_it(tmp_path):
    audit = tmp_path / "audit.jsonl"
    # The s.138 notice is entirely rule-driven (no narrative slots), so it is
    # fully drafted and therefore signable.
    name, template, result, sheet = gs._s138_notice()
    assert not result.refused
    assert not S.has_unfilled_slots(result.context), \
        "s.138 notice must be fully drafted to be signable"

    out = tmp_path / "notice.docx"
    S.render_document(template, result.context, out,
                      document=name, factsheet=sheet, audit_path=audit)
    assert BANNER in extract_text(out)

    # Explicit, recorded sign-off against this fact-sheet version.
    S.sign_off(document=name, factsheet=sheet, reviewer="Adv. R. Rao",
               signed_on="2026-09-01", context=result.context, audit_path=audit)

    out2 = tmp_path / "notice_final.docx"
    S.render_document(template, result.context, out2,
                      document=name, factsheet=sheet, audit_path=audit)
    text = extract_text(out2)
    assert BANNER not in text
    assert "Thiru. K. Murugan" in text  # the rest of the document is intact

    # The facts are revised -> the signed document no longer matches; banner back.
    revised = sheet.revise(created_by="intake",
                           revised_at=datetime(2026, 9, 2, tzinfo=timezone.utc))
    out3 = tmp_path / "notice_revised.docx"
    S.render_document(template, result.context, out3,
                      document=name, factsheet=revised, audit_path=audit)
    assert BANNER in extract_text(out3)


def test_figure_document_shows_both_signals_as_a_draft(tmp_path):
    audit = tmp_path / "audit.jsonl"
    name, template, result, sheet = gs._plaint()
    out = tmp_path / "plaint.docx"
    S.render_document(template, result.context, out,
                      document=name, factsheet=sheet, audit_path=audit)
    text = extract_text(out)
    assert BANNER in text          # review banner (rule 6)
    assert MARKER in text          # table marker (unverified figures)


def test_slotted_document_cannot_be_finalised(tmp_path):
    audit = tmp_path / "audit.jsonl"
    # The MACT sample leaves the accident narrative slot ([to be drafted]).
    name, template, result, sheet = gs._mact_claim()
    assert S.has_unfilled_slots(result.context)
    with pytest.raises(S.SignOffError):
        S.sign_off(document=name, factsheet=sheet, reviewer="Adv. Rao",
                   signed_on="2026-09-01", context=result.context, audit_path=audit)
    out = tmp_path / "mact.docx"
    S.render_document(template, result.context, out,
                      document=name, factsheet=sheet, audit_path=audit)
    assert BANNER in extract_text(out)
