"""CI gate: the committed templates must not be silently clobberable.

Wraps tools/check_template_drift.py so it runs inside the normal pytest suite (the
engine's only CI entrypoint today). See that script's docstring for the semantics of
"drift". Kept as a thin wrapper so the check is equally runnable standalone
(`python tools/check_template_drift.py`) and in CI (`pytest`).
"""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from tools import check_template_drift  # noqa: E402


def test_committed_templates_are_consistent():
    """Regenerate into a temp dir and assert no drift/clobber problems.

    Fails (exit 1 -> return 1) when a committed template is orphaned, when an
    AUTHORED template still equals raw generator output (its hand-authored Word file
    was not committed), or when the generator emits a template that is not committed.
    """
    assert check_template_drift.main() == 0, (
        "template drift detected — see the drift-check output above. A committed "
        "template either was not hand-authored (still raw python-docx defaults) or "
        "diverged from the generator's expected set."
    )
