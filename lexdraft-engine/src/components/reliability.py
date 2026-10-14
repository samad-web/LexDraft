"""Per-paragraph reliability annotation. Deterministic. No LLM.

Generalises the MACT unverified marker: every generated document can carry a
reliability layer marking which paragraphs are machine-certain and which need the
advocate's eye. Rendered as a margin/footer note, and TOGGLEABLE so the final
filed version renders clean.

Levels:
  CERTAIN          template + deterministic rules — machine-certain.
  LLM_SLOT         narrative the model writes (the [to be drafted] slots).
  VERIFY_DEPENDENT a figure/section that depends on a VERIFY table (court fee,
                   compensation multiplier, section mapping, consumer tiers).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Mapping, Optional, Set

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"


class Level(Enum):
    CERTAIN = ("certain", False)
    LLM_SLOT = ("llm_slot", True)
    VERIFY_DEPENDENT = ("verify_dependent", True)

    def __init__(self, code: str, needs_review: bool):
        self.code = code
        self.needs_review = needs_review


@dataclass(frozen=True)
class Para:
    number: str
    level: Level
    note: str = ""


@dataclass(frozen=True)
class ReliabilityReport:
    items: List[Para] = field(default_factory=list)

    def needs_review(self) -> List[Para]:
        return [p for p in self.items if p.level.needs_review]

    @property
    def machine_certain(self) -> bool:
        """True iff no paragraph needs the advocate's eye."""
        return not self.needs_review()

    def counts(self) -> Dict[Level, int]:
        out: Dict[Level, int] = {l: 0 for l in Level}
        for p in self.items:
            out[p.level] += 1
        return out


def _default_note(p: Para) -> str:
    if p.note:
        return f"Para {p.number}: {p.note}"
    if p.level is Level.LLM_SLOT:
        return f"Para {p.number}: narrative to be drafted / reviewed by the advocate"
    if p.level is Level.VERIFY_DEPENDENT:
        return (f"Para {p.number}: figure/section depends on a table pending "
                f"advocate verification")
    return f"Para {p.number}: machine-certain"


def annotate_context(
    context: Mapping[str, Any],
    report: ReliabilityReport,
    *,
    show: bool,
) -> Dict[str, Any]:
    """Return a copy of `context` with reliability annotations attached.

    When `show` is False the notes list is empty, so the template renders clean —
    the final filed version carries no annotation.
    """
    ctx = dict(context)
    ctx["reliability_show"] = show
    if show:
        ctx["reliability_notes"] = [
            {"para": p.number, "level": p.level.code, "text": _default_note(p)}
            for p in report.needs_review()
        ]
    else:
        ctx["reliability_notes"] = []
    return ctx


def infer_from_context(
    context: Mapping[str, Any],
    *,
    verify_dependent_paras: Optional[Set[str]] = None,
) -> ReliabilityReport:
    """Build a report by inference: any value equal to the [to be drafted] marker
    is an LLM_SLOT; paragraphs named in `verify_dependent_paras` are
    VERIFY_DEPENDENT; everything else is CERTAIN.

    Keys of the form 'para_<n>' or '<n>' contribute paragraph numbers.
    """
    verify = verify_dependent_paras or set()
    items: List[Para] = []
    seen: Set[str] = set()

    for key, value in context.items():
        num = _para_number(key)
        if num is None:
            continue
        seen.add(num)
        if isinstance(value, str) and value.strip() == _LLM_SLOT_PLACEHOLDER:
            items.append(Para(number=num, level=Level.LLM_SLOT))
        elif num in verify:
            items.append(Para(number=num, level=Level.VERIFY_DEPENDENT))
        else:
            items.append(Para(number=num, level=Level.CERTAIN))

    for num in verify - seen:
        items.append(Para(number=num, level=Level.VERIFY_DEPENDENT))

    items.sort(key=lambda p: _sort_key(p.number))
    return ReliabilityReport(items=items)


def _para_number(key: str) -> Optional[str]:
    if key.startswith("para_"):
        return key[len("para_"):]
    if key.isdigit():
        return key
    return None


def _sort_key(num: str):
    return (0, int(num)) if num.isdigit() else (1, num)
