"""Render a gold template to PDF with the pinned LibreOffice and assert its page
count + layout checksum against a committed baseline.

WHY
    A LibreOffice or font bump can silently shift line-breaking and pagination — the
    advocate approves an N-page document and later files an N+1-page one. This makes
    that drift LOUD: CI renders the gold template in the SAME pinned Alpine image the
    render worker uses, computes (page_count, layout_checksum), and fails if either
    differs from tools/pagination_baseline.json.

WHAT THE CHECKSUM COVERS
    The PDF's text layout: for each page, the ordered (rounded x, rounded y, text)
    of every text span, hashed. This captures reflow (a word moving to the next line
    or page) without being brittle to non-layout PDF metadata (creation date, ids).

USAGE
    Render + compare (CI):   python tools/pagination_baseline.py --check
    Re-baseline (deliberate, after an intended LibreOffice/font/template change):
                             python tools/pagination_baseline.py --update

    Requires: a `soffice` on PATH (or SOFFICE_BIN) and `pdftotext` (poppler) OR
    pypdf for text extraction. In CI this runs inside the pinned image where both
    LibreOffice and poppler-utils are installed. Locally without them it SKIPS with a
    clear message (so a dev machine without LibreOffice doesn't fail the suite).

    This is intentionally a standalone tool, NOT a pytest test — it needs the pinned
    container to be meaningful. CI invokes it explicitly in the engine job.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
GOLD = ROOT / "templates" / "gold" / "regular_bail.docx"
BASELINE = ROOT / "tools" / "pagination_baseline.json"
SOFFICE = os.environ.get("SOFFICE_BIN", "soffice")

# The doc types with a committed gold template + fixed engine fields to render them. As
# each gold template is added, register it here so its pagination is baselined too. The
# fields go through the real adapter (same path the golden tests use) so the baseline
# reflects the production render. The gold template path is resolved by slug.
from tests.fixtures_gold import (  # noqa: E402
    REGULAR_BAIL_ENGINE_FIELDS, S138_NOTICE_ENGINE_FIELDS, AFFIDAVIT_ENGINE_FIELDS,
)

_GOLD_DIR = ROOT / "templates" / "gold"
TARGETS = {
    "regular_bail": (_GOLD_DIR / "regular_bail.docx", REGULAR_BAIL_ENGINE_FIELDS),
    "s138_notice": (_GOLD_DIR / "s138_notice.docx", S138_NOTICE_ENGINE_FIELDS),
    "affidavit": (_GOLD_DIR / "affidavit.docx", AFFIDAVIT_ENGINE_FIELDS),
}


def _have(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def _render_pdf(docx: Path, out_dir: Path) -> Path:
    """gold .docx (already rendered with facts) -> pdf via soffice, private profile."""
    profile = out_dir / "profile"
    profile.mkdir(parents=True, exist_ok=True)
    profile_url = "file://" + str(profile).replace("\\", "/")
    subprocess.run(
        [SOFFICE, "--headless", "--norestore", "--nolockcheck", "--nodefault",
         "--nofirststartwizard", f"-env:UserInstallation={profile_url}",
         "--convert-to", "pdf", "--outdir", str(out_dir), str(docx)],
        check=True, capture_output=True, timeout=120,
    )
    pdf = out_dir / (docx.stem + ".pdf")
    if not pdf.exists():
        raise RuntimeError(f"soffice produced no PDF for {docx.name}")
    return pdf


def _layout_signature(pdf: Path) -> tuple[int, str]:
    """(page_count, layout_checksum) from the PDF's text layout via pypdf."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pypdf required for layout signature") from exc
    reader = PdfReader(str(pdf))
    spans: list[str] = []
    for i, page in enumerate(reader.pages):
        # extract_text with layout gives ordered text; we bucket by rounded position
        # via the visitor to catch reflow. Fall back to plain text if visitor unsupported.
        parts: list[str] = []

        def visitor(text, cm, tm, font_dict, font_size, _parts=parts):
            if text and text.strip():
                x = round(tm[4] / 5) * 5
                y = round(tm[5] / 5) * 5
                _parts.append(f"{x},{y}:{text.strip()}")

        try:
            page.extract_text(visitor_text=visitor)
        except TypeError:
            parts.append(page.extract_text() or "")
        spans.append(f"PAGE{i}|" + "|".join(parts))
    checksum = hashlib.sha256("\n".join(spans).encode("utf-8")).hexdigest()[:16]
    return len(reader.pages), checksum


def _signature_for(name: str) -> tuple[int, str]:
    gold, engine_fields = TARGETS[name]
    from docxtpl import DocxTemplate
    from datetime import datetime, timezone
    from src.service import adapters
    from src.verify import signoff
    from src.factsheet import Case, Court, MatterFactSheet, Party, PartyRole

    # Render through the REAL adapter (same path as production + the golden tests), so
    # the baselined pagination reflects the document advocates actually file.
    adapter = adapters.get_adapter(name)
    result = adapter.build(**adapter.coerce(engine_fields))
    if getattr(result, "refused", False):
        raise RuntimeError(f"{name}: fixture refused: {getattr(result, 'reason', '')}")
    sheet = MatterFactSheet.create(
        court=Court(court_type="sessions", name="Court", state="Tamil Nadu"),
        case=Case(category="C3", document_type=name),
        parties=[Party(role=PartyRole.ACCUSED, serial=1, name="Party")],
        created_by="pagination-baseline",
        created_at=datetime(2026, 9, 4, tzinfo=timezone.utc),
    )
    ctx = signoff.resolve_context(result.context, document=name, factsheet=sheet)
    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        rendered = tmp_dir / f"{name}.docx"
        t = DocxTemplate(str(gold))
        t.render(ctx)
        t.save(str(rendered))
        pdf = _render_pdf(rendered, tmp_dir)
        return _layout_signature(pdf)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Gold-template pagination baseline.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--check", action="store_true", help="compare against the baseline")
    g.add_argument("--update", action="store_true", help="re-write the baseline")
    args = ap.parse_args(argv)

    if not (_have(SOFFICE) or _have("soffice")):
        print(f"pagination-baseline: SKIP — no LibreOffice ({SOFFICE}) available. "
              "This check is meaningful only in the pinned container.", file=sys.stderr)
        return 0  # skip, don't fail, on a machine without LibreOffice

    # Record the soffice build so the baseline says which LibreOffice it was made with.
    try:
        ver = subprocess.run([SOFFICE, "--version"], capture_output=True, text=True,
                             timeout=30).stdout.split("\n")[0].strip()
    except Exception:
        ver = "unknown"

    current = {name: {"pages": p, "checksum": c}
               for name in TARGETS
               for (p, c) in [_signature_for(name)]}

    if args.update:
        BASELINE.write_text(
            json.dumps({"soffice_version": ver, "targets": current}, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"pagination-baseline: updated ({ver})")
        for n, s in current.items():
            print(f"  {n}: {s['pages']} pages, checksum {s['checksum']}")
        return 0

    # --check
    if not BASELINE.exists():
        print("pagination-baseline: no baseline committed. Run --update in the pinned "
              "image and commit tools/pagination_baseline.json.", file=sys.stderr)
        return 1
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    problems: list[str] = []
    if baseline.get("soffice_version") != ver:
        # A version change is a WARNING surfaced loudly, but the checksum comparison is
        # the hard gate — a version bump that doesn't move layout is allowed after a
        # deliberate --update.
        print(f"pagination-baseline: NOTE soffice changed "
              f"{baseline.get('soffice_version')!r} -> {ver!r}", file=sys.stderr)
    for name, sig in current.items():
        want = baseline.get("targets", {}).get(name)
        if not want:
            problems.append(f"{name}: no baseline entry (run --update)")
            continue
        if sig["pages"] != want["pages"]:
            problems.append(f"{name}: PAGE COUNT changed {want['pages']} -> {sig['pages']} "
                            f"— advocates approve {want['pages']} pages, would file {sig['pages']}")
        elif sig["checksum"] != want["checksum"]:
            problems.append(f"{name}: layout reflowed (same page count, checksum "
                            f"{want['checksum']} -> {sig['checksum']})")
    if problems:
        print("pagination-baseline FAILED — pagination drift detected:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        print("\nIf this change is intended (LibreOffice/font/template bump), re-baseline "
              "with --update in the pinned image and commit the new baseline.", file=sys.stderr)
        return 1
    print(f"pagination-baseline OK ({ver}): "
          + ", ".join(f"{n} {s['pages']}p" for n, s in current.items()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
