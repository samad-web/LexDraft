"""CI check: make silent template clobber VISIBLE.

The committed .docx templates under templates/shared/ are hand-authored and
advocate-approved (Task 2/3). build_templates.py is scaffold-only and must never be
the source of a committed template's layout. This check regenerates every template
into a temp dir and compares the regenerated output against what is committed.

WHAT "DRIFT" MEANS HERE:
    A committed template whose meaningful OOXML payload MATCHES the generator's output
    has not yet been hand-authored — it is still raw generator output, i.e. it still
    carries the known-bad python-docx defaults (US Letter, faked numbering, no tab
    leaders, no headers). That is the state Task 3 exists to fix. So for the doc types
    that have been inverted to authored Word, this check asserts the committed file
    DIFFERS from the generator (proof a human touched it).

    Conversely, a doc type NOT yet inverted should still match the generator; those are
    listed in NOT_YET_AUTHORED and are allowed to match.

Comparison is on the MEANINGFUL zip members only (word/document.xml, numbering.xml,
styles.xml, header*/footer*), never raw zip bytes or docProps timestamps, so it does
not flake on rebuild nondeterminism.

Exit 0 = OK. Exit 1 = drift detected (a message explains which and why).

Usage:  python tools/check_template_drift.py
"""
from __future__ import annotations

import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / "templates" / "shared"
BUILDER = ROOT / "templates" / "build_templates.py"

# Zip members whose content actually defines the document. docProps/* (timestamps),
# and zip container ordering are deliberately excluded.
MEANINGFUL_PREFIXES = ("word/document.xml", "word/numbering.xml", "word/styles.xml")
MEANINGFUL_GLOBS = ("word/header", "word/footer")

# Doc types that have been inverted to hand-authored Word (Task 3, top-10 first).
# For these, the committed file MUST differ from generator output (a human authored it).
# Start empty; add each doc type's template filename here as it is inverted.
AUTHORED: set[str] = set()

# Doc types not yet inverted — still legitimately raw generator output, allowed to
# match. As Task 3 progresses, filenames move from here into AUTHORED.
# (Populated at runtime as "every committed template not in AUTHORED".)


def _meaningful_members(path: Path) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if name in MEANINGFUL_PREFIXES or name.startswith(MEANINGFUL_GLOBS):
                out[name] = z.read(name)
    return out


def _same_payload(a: Path, b: Path) -> bool:
    return _meaningful_members(a) == _meaningful_members(b)


def main() -> int:
    if not BUILDER.exists():
        print(f"drift-check: builder not found at {BUILDER}", file=sys.stderr)
        return 1

    committed = sorted(SHARED.glob("*.docx"))
    if not committed:
        print("drift-check: no committed templates found", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        proc = subprocess.run(
            [sys.executable, str(BUILDER), "--out", str(tmp_dir)],
            capture_output=True, text=True,
        )
        if proc.returncode != 0:
            print("drift-check: generator failed:\n" + proc.stderr, file=sys.stderr)
            return 1

        problems: list[str] = []
        for c in committed:
            regen = tmp_dir / c.name
            if not regen.exists():
                problems.append(
                    f"  {c.name}: committed but the generator no longer emits it "
                    f"(orphaned template, or a build_* was removed)."
                )
                continue
            matches = _same_payload(c, regen)
            if c.name in AUTHORED and matches:
                problems.append(
                    f"  {c.name}: marked AUTHORED but its payload still equals raw "
                    f"generator output — the hand-authored Word file was NOT committed "
                    f"(it would ship python-docx defaults: US Letter, faked numbering)."
                )
            # A non-authored template that DIFFERS from the generator is fine and
            # expected once someone edits it; we do not fail on that direction, because
            # the whole point of Task 2 is that committed files are authoritative. We
            # only *report* it so the drift is visible.
            elif c.name not in AUTHORED and not matches:
                print(
                    f"drift-check: note — {c.name} differs from generator output "
                    f"(committed file has been hand-edited; treated as authoritative)."
                )

        # Generator emits something never committed? scaffold gap, report it.
        for regen in sorted(tmp_dir.glob("*.docx")):
            if not (SHARED / regen.name).exists():
                problems.append(
                    f"  {regen.name}: generator emits it but it is not committed "
                    f"(run the scaffold to add it, then hand-author it)."
                )

        if problems:
            print("drift-check FAILED:\n" + "\n".join(problems), file=sys.stderr)
            return 1

    print(f"drift-check OK: {len(committed)} committed templates consistent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
