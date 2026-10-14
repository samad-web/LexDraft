"""Matter Fact Sheet — the single fact entry per matter.

Everything downstream reads from this. It is versioned: every edit produces a new
immutable version; the matter keeps its full history; earlier versions never
mutate.

NOTE ON THE CAUSE-TITLE SCHEMA: the fine field set of the cause title (Part 1.1
of specs/format-specs-p0.md) is authoritative and supplied separately. Per the
CLAUDE.md rule 'if a spec field is empty, stop and ask — do not infer', this
model carries only the coarse court/case/party fields named in Task 1. Area- and
document-specific facts (e.g. cheque details for s.138) live in per-area
extensions so the core schema is not polluted with inferred fields. A
schema-conformance layer is added when the spec lands.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Mapping, Optional, Tuple


class PartyRole(Enum):
    PLAINTIFF = "plaintiff"
    DEFENDANT = "defendant"
    PETITIONER = "petitioner"
    RESPONDENT = "respondent"
    APPELLANT = "appellant"
    APPLICANT = "applicant"
    COMPLAINANT = "complainant"
    ACCUSED = "accused"


# Court types recognised by the model. Kept coarse deliberately — the fine
# cause-title variants come from the doc spec.
_COURT_TYPES = {
    "district",
    "high_court",       # writ / original side
    "sessions",
    "magistrate",
    "district_fora",    # consumer
    "city_civil",
    "tribunal",
}


@dataclass(frozen=True)
class Court:
    court_type: str
    name: str
    state: str

    def __post_init__(self) -> None:
        if self.court_type not in _COURT_TYPES:
            raise ValueError(
                f"unknown court_type {self.court_type!r}; "
                f"expected one of {sorted(_COURT_TYPES)}"
            )


@dataclass(frozen=True)
class Case:
    category: str          # C1..C5 document class
    document_type: str     # e.g. 'suit_for_recovery'
    case_number: Optional[str] = None
    year: Optional[int] = None


@dataclass(frozen=True)
class Guardian:
    """Guardian / next-friend block for a minor party (spec 1.1)."""

    name: str
    relation: str            # e.g. 'father', 'mother'
    capacity: str            # 'next friend' | 'guardian ad litem'


@dataclass(frozen=True)
class Party:
    """A party to the matter. Field set is the Part 1.1 cause-title schema.

    Natural-person fields (age, parentage, occupation, address) are optional at
    the model level because not every variant needs them (e.g. a State authority
    respondent in a writ); the per-document specs enforce presence where a
    variant requires it. The minor and company guards below ARE enforced here
    because spec 1.1 makes them unconditional structural requirements.
    """

    role: PartyRole
    serial: int                              # ordering within the role (P1, D2, ...)
    name: str

    # natural-person attributes
    age: Optional[int] = None
    parentage_type: Optional[str] = None     # 'son of' | 'daughter of' | 'wife of' ...
    parentage_name: Optional[str] = None
    occupation: Optional[str] = None
    address_lines: Tuple[str, ...] = ()
    pin: Optional[str] = None

    # minor
    is_minor: bool = False
    guardian: Optional[Guardian] = None

    # company
    is_company: bool = False
    cin: Optional[str] = None
    rep_by: Optional[str] = None             # authorised representative name
    rep_designation: Optional[str] = None

    # writ / criminal helpers used by cause-title validation
    is_authority: bool = False               # writ: State / statutory authority
    in_custody: bool = False                 # criminal: accused confined
    prison: Optional[str] = None

    def __post_init__(self) -> None:
        if self.is_minor and self.is_company:
            raise ValueError(
                f"party {self.name!r} cannot be both a minor and a company"
            )
        if self.is_minor and self.guardian is None:
            raise ValueError(
                f"minor party {self.name!r} requires a guardian / next-friend block"
            )
        if self.is_company:
            if not self.cin:
                raise ValueError(
                    f"company party {self.name!r} requires a CIN"
                )
            if not (self.rep_by and self.rep_designation):
                raise ValueError(
                    f"company party {self.name!r} requires an authorised "
                    f"representative (rep_by + rep_designation)"
                )
        # normalise address_lines to a tuple for hashability/immutability
        if not isinstance(self.address_lines, tuple):
            object.__setattr__(self, "address_lines", tuple(self.address_lines))

    @property
    def address(self) -> str:
        """Address lines + PIN joined into a single displayable string."""
        parts = list(self.address_lines)
        if self.pin:
            parts.append(self.pin)
        return ", ".join(p for p in parts if p)


@dataclass(frozen=True)
class MatterFactSheet:
    """An immutable snapshot of a matter at one version.

    Use `create()` for the first version and `revise()` to produce the next.
    History is threaded through `_prev` so any version can walk its lineage.
    """

    matter_id: str
    version: int
    court: Court
    case: Case
    parties: Tuple[Party, ...]
    created_by: str                     # who created the matter (version 1 author)
    revised_by: Optional[str]           # who authored THIS version
    created_at: datetime
    extensions: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)
    _prev: Optional["MatterFactSheet"] = field(default=None, repr=False, compare=False)

    # ----------------------------------------------------------------- create

    @classmethod
    def create(
        cls,
        *,
        court: Court,
        case: Case,
        parties: List[Party],
        created_by: str,
        created_at: Optional[datetime] = None,
        extensions: Optional[Mapping[str, Mapping[str, Any]]] = None,
    ) -> "MatterFactSheet":
        if not parties:
            raise ValueError("a fact sheet requires at least one party")
        return cls(
            matter_id=str(uuid.uuid4()),
            version=1,
            court=court,
            case=case,
            parties=tuple(parties),
            created_by=created_by,
            revised_by=None,
            created_at=created_at or datetime.now(timezone.utc),
            extensions=dict(extensions or {}),
            _prev=None,
        )

    # ----------------------------------------------------------------- revise

    def revise(
        self,
        *,
        created_by: str,
        court: Optional[Court] = None,
        case: Optional[Case] = None,
        parties: Optional[List[Party]] = None,
        extensions: Optional[Mapping[str, Mapping[str, Any]]] = None,
        revised_at: Optional[datetime] = None,
    ) -> "MatterFactSheet":
        """Produce the next version. The current object is left untouched.

        `created_by` here names the author of THIS revision (stored as
        `revised_by`); the matter's original author is carried forward unchanged.
        """
        new_parties = tuple(parties) if parties is not None else self.parties
        if not new_parties:
            raise ValueError("a fact sheet requires at least one party")
        return MatterFactSheet(
            matter_id=self.matter_id,
            version=self.version + 1,
            court=court or self.court,
            case=case or self.case,
            parties=new_parties,
            created_by=self.created_by,            # matter origin, preserved
            revised_by=created_by,                 # this revision's author
            created_at=revised_at or datetime.now(timezone.utc),
            extensions=dict(extensions) if extensions is not None else dict(self.extensions),
            _prev=self,
        )

    # ------------------------------------------------------------- extensions

    def with_extension(self, key: str, value: Mapping[str, Any]) -> "MatterFactSheet":
        """Return a copy with a per-area extension set. Does not bump the version
        or mutate self — it is a within-version derivation used while assembling a
        sheet. Use revise() to commit a new version."""
        if not key:
            raise ValueError("extension key must be non-empty")
        merged = dict(self.extensions)
        merged[key] = dict(value)
        return replace(self, extensions=merged)

    def extension(self, key: str) -> Optional[Mapping[str, Any]]:
        return self.extensions.get(key)

    # ---------------------------------------------------------------- queries

    def parties_in_role(self, role: PartyRole) -> List[Party]:
        return [p for p in self.parties if p.role == role]

    def history(self) -> List["MatterFactSheet"]:
        """All versions of this matter, oldest first."""
        chain: List[MatterFactSheet] = []
        node: Optional[MatterFactSheet] = self
        while node is not None:
            chain.append(node)
            node = node._prev
        chain.reverse()
        return chain


__all__ = [
    "MatterFactSheet",
    "Party",
    "PartyRole",
    "Guardian",
    "Court",
    "Case",
]
