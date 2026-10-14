"""Structured refusals — the typed contract for "this document may not be generated".

A refusal is NOT an error. It is a legal finding: no document, here is the ground,
here is the computation behind it. The API layer serialises it as HTTP 200 with
`outcome:"refused"`, and the frontend renders it as a conversational message. For
that the frontend must be able to BRANCH on a stable, specific code — never on the
wording of `reason`, which is display text that may be reworded.

Every refusal therefore carries:

    code            stable, specific slug the frontend branches on. Specific
                    enough to be useful ('cheque_presented_after_validity'), never
                    generic ('validation_failed'). Unique across the whole engine.
    severity        HARD  -> no document is produced.
                    (auto-attach cases are NOT refusals — they generate WITH an
                     extra application; they never reach this object.)
    reason          the exact advocate-facing sentence (unchanged wording).
    computation     the shown working (dates, counts, amounts, sections).
    fields          which request fields the refusal turns on, so the UI can
                    highlight them / target the clarify question.
    pipeline, spec  provenance (which document, which spec clause).
    remedy_hint     'none' | a named remedy the caller could offer.

`reason` and `computation` are kept byte-identical to what the engine produced
before codes were added — they are load-bearing for goldens and the UI.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple


class Severity(Enum):
    HARD = "hard"          # no document is produced


@dataclass(frozen=True)
class Refusal:
    code: str
    severity: Severity
    reason: str
    pipeline: str
    spec: str
    computation: Optional[str] = None
    fields: Tuple[str, ...] = ()
    remedy_hint: str = "none"

    def __post_init__(self) -> None:
        if not self.code or not self.code.strip():
            raise ValueError("a refusal requires a stable, non-empty code")
        if not self.reason or not self.reason.strip():
            raise ValueError(f"refusal {self.code!r} requires a reason")
        # normalise fields to a tuple for hashability/immutability
        if not isinstance(self.fields, tuple):
            object.__setattr__(self, "fields", tuple(self.fields))

    def to_dict(self) -> Dict[str, Any]:
        """The wire shape the API layer serialises (see docs/api-layer-plan.md §4.2)."""
        return {
            "code": self.code,
            "severity": self.severity.value,
            "reason": self.reason,
            "computation": self.computation,
            "pipeline": self.pipeline,
            "spec": self.spec,
            "fields_implicated": list(self.fields),
            "remedy_hint": self.remedy_hint,
        }
