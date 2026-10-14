"""Advocate review pack — the single document the advocate reviews in session.

Assembles, all GENERATED from the code / registries so it never drifts:

  Section A  VERIFY reference tables (verify/tables/) — court fee, pecuniary
             limits, custody/default-bail periods, bail bars, section mappings,
             consumer tiers, MACT compensation. Source + sign-off state.
  Section B  Mandatory averments (verify/averments/) — per document.
  Section C  Refusal conditions — every trigger and the exact advocate-facing
             message, captured by driving each pipeline into the refusal.

Usage:
    python tools/build_review_pack.py                 # Markdown to stdout
    python tools/build_review_pack.py -o pack.md      # write Markdown
    python tools/build_review_pack.py --docx pack.docx
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List, Optional

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.verify import tables as _tables  # noqa: E402
from src.verify import averments as _averments  # noqa: E402
from tools import refusal_report as _refusals  # noqa: E402


def build_pack() -> str:
    parts = [
        "# LexDraft — Advocate Review Pack",
        "",
        "Everything in this pack is generated from the engine's code and registries "
        "(`verify/tables/`, `verify/averments/`, and the pipelines themselves), so "
        "it always reflects the current state. Review each section, correct what is "
        "wrong, and sign off by editing the JSON registries.",
        "",
        _tables.section_a(),
        _averments.section_b(),
        _refusals.build_report(),
    ]
    return "\n".join(parts)


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Build the advocate review pack.")
    ap.add_argument("-o", "--out", type=Path, help="write Markdown to this path")
    ap.add_argument("--docx", type=Path, help="write a .docx to this path")
    args = ap.parse_args(argv)

    pack = build_pack()
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(pack, encoding="utf-8")
        print(f"wrote {args.out}")
    if args.docx:
        _refusals._write_docx(pack, args.docx)
        print(f"wrote {args.docx}")
    if not args.out and not args.docx:
        sys.stdout.reconfigure(encoding="utf-8")
        print(pack)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
