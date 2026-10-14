"""Verification clause — context + set-coverage validation (spec 1.2).

Verification validation is a SET-COVERAGE check over paragraph numbers:
  - knowledge ∪ belief must equal the full range 1..total  (no gaps)
  - knowledge ∩ belief must be empty                        (no overlap)
  - every referenced paragraph is within 1..total           (in range)

Variants:
  CIVIL      — Order VI Rule 15 verification.
  WRIT       — declaration form; MUST carry the no-similar-petition declaration.
  COMMERCIAL — verification AND the Commercial Courts Act statement of truth.

Paragraph lists render to human ranges by code (never model-written).
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Iterable, List, Sequence, Tuple, Union

from ..rules._result import Assessment

TEMPLATE = "verification.docx"

ParaSpec = Union[int, Tuple[int, int]]


class VerificationInputError(ValueError):
    pass


class Variant(Enum):
    CIVIL = "civil"
    WRIT = "writ"
    COMMERCIAL = "commercial"


def _expand(paras: Sequence[ParaSpec]) -> List[int]:
    """Expand a mix of ints and (start, end) inclusive ranges to a sorted list."""
    out: List[int] = []
    for item in paras:
        if isinstance(item, tuple):
            start, end = item
            if end < start:
                raise VerificationInputError(f"inverted range {item}")
            out.extend(range(start, end + 1))
        else:
            out.append(int(item))
    return out


def validate_coverage(
    *,
    total_paras: int,
    knowledge_paras: Sequence[ParaSpec],
    belief_paras: Sequence[ParaSpec],
) -> Assessment:
    """Set-coverage check. Refuses on any gap, overlap, or out-of-range paragraph."""
    if total_paras < 1:
        return Assessment.refuse(reason="document has no paragraphs to verify")

    full = set(range(1, total_paras + 1))
    know = _expand(knowledge_paras)
    bel = _expand(belief_paras)

    know_set, bel_set = set(know), set(bel)
    computation = (
        f"total 1..{total_paras}; knowledge={sorted(know_set)}; "
        f"belief={sorted(bel_set)}"
    )

    # in range
    out_of_range = (know_set | bel_set) - full
    if out_of_range:
        return Assessment.refuse(
            reason=f"paragraph(s) {sorted(out_of_range)} are outside the range "
                   f"1..{total_paras}",
            computation=computation,
        )

    # no overlap
    overlap = know_set & bel_set
    if overlap:
        return Assessment.refuse(
            reason=f"paragraph(s) {sorted(overlap)} appear in both the knowledge "
                   f"and belief sets",
            computation=computation,
        )

    # no gaps
    missing = full - (know_set | bel_set)
    if missing:
        return Assessment.refuse(
            reason=f"paragraph(s) {sorted(missing)} are unverified (in neither the "
                   f"knowledge nor belief set)",
            computation=computation,
        )

    return Assessment.allow(computation=computation)


def format_para_list(paras: Sequence[ParaSpec]) -> str:
    """Render paragraph numbers as human ranges: [1,2,3,5] -> '1 to 3 and 5'."""
    nums = sorted(set(_expand(paras)))
    if not nums:
        return ""
    # collapse consecutive runs
    runs: List[Tuple[int, int]] = []
    start = prev = nums[0]
    for n in nums[1:]:
        if n == prev + 1:
            prev = n
        else:
            runs.append((start, prev))
            start = prev = n
    runs.append((start, prev))

    parts = [str(a) if a == b else f"{a} to {b}" for a, b in runs]
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def render_context(
    *,
    variant: Variant,
    name: str,
    role: str,
    place: str,
    day: str,
    month: str,
    year: str,
    total_paras: int,
    knowledge_paras: Sequence[ParaSpec],
    belief_paras: Sequence[ParaSpec],
    no_similar_petition: bool = False,
    document_kind: str = "",
) -> Dict[str, Any]:
    """Build the docxtpl context. Runs coverage validation first and refuses to
    build a context for an uncovered set."""
    coverage = validate_coverage(
        total_paras=total_paras,
        knowledge_paras=knowledge_paras,
        belief_paras=belief_paras,
    )
    if coverage.refused:
        raise VerificationInputError(coverage.reason)

    if variant is Variant.WRIT and not no_similar_petition:
        raise VerificationInputError(
            "writ verification must carry the no-similar-petition declaration"
        )

    ctx: Dict[str, Any] = {
        "variant": variant.value,
        "name": name,
        "role": role,
        "place": place,
        "day": day,
        "month": month,
        "year": year,
        "knowledge_paras": format_para_list(knowledge_paras),
        "belief_paras": format_para_list(belief_paras),
        "no_similar_petition": no_similar_petition,
        "has_verification": True,
    }

    if variant is Variant.COMMERCIAL:
        ctx["has_statement_of_truth"] = True
        ctx["document_kind"] = document_kind

    return ctx
