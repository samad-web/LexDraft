"""Statutory bail-bar detector. Deterministic. No LLM.

Four P0 bars:
  NDPS  s.37       twin conditions for bail — governs REGULAR bail.
  PMLA  s.45       twin conditions for bail — governs REGULAR bail.
  UAPA  s.43D(5)   no bail if the accusation is prima facie true — REGULAR bail.
  SC/ST s.18 / 18A bars ANTICIPATORY bail outright.

The detector reports:
  - bar_applies         : a statutory bar is engaged.
  - section             : the section to address.
  - mandatory_paragraph : the pleading must address the bar head-on.
  - refused             : True only for the SC/ST outright anticipatory bar; the
                          NDPS/PMLA/UAPA thresholds are conditions to be met, not
                          outright refusals, so the document is generated WITH the
                          mandatory paragraph.

It does NOT adjudicate whether the threshold is satisfied on the merits — that is
the court's. The SC/ST anticipatory check here is the single source of truth,
absorbing the inline check formerly in the 3.3 pipeline.

VERIFY (advocate review — reviewed as a unit with the other VERIFY markers):
statute list and section numbers are indicative and must be checked against the
bare Acts; the SC/ST s.18/18A bar is not absolute in every fact pattern post-
*Prathvi Raj Chauhan*.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity


class Statute(Enum):
    NDPS = "ndps"
    PMLA = "pmla"
    UAPA = "uapa"
    SCST = "scst"


class Remedy(Enum):
    REGULAR = "regular"
    ANTICIPATORY = "anticipatory"


class BarTest(Enum):
    """The legal test each bar imposes — they are NOT interchangeable.

    TWIN_CONDITIONS  : the court must be satisfied there are reasonable grounds
                       for believing the accused is not guilty AND is not likely
                       to commit an offence while on bail. (NDPS s.37, PMLA s.45.)
    PRIMA_FACIE_TRUE : bail is refused if, on the case diary / report, the court
                       is of the opinion that the accusation is prima facie true.
                       (UAPA s.43D(5).) This is a different, lower threshold for
                       the prosecution — reciting the twin-condition test here
                       would address the wrong test.
    OUTRIGHT_BAR     : the remedy is barred outright (SC/ST s.18/18A vs
                       anticipatory bail).
    """

    TWIN_CONDITIONS = "twin_conditions"
    PRIMA_FACIE_TRUE = "prima_facie_true"
    OUTRIGHT_BAR = "outright_bar"


# Section provenance + test classification, loaded from verify/tables/bail_bars.json
# (string keys there -> Statute here).
_BARS = _reg.values("bail_bars")
_SECTIONS = {Statute(k): v for k, v in _BARS["sections"].items()}

# Each bar's own paragraph is matched to its actual test. Do NOT share a single
# paragraph shape — the UAPA test differs from the NDPS/PMLA twin test.
_TWIN_CONDITIONS_TESTS = {Statute(k) for k in _BARS["twin_conditions_statutes"]}


def _twin_conditions_paragraph(section: str) -> str:
    return (
        f"The petitioner addresses the bar under {section} head-on and submits "
        f"that the twin conditions are satisfied: there are reasonable grounds for "
        f"believing that the petitioner is not guilty of the alleged offence, and "
        f"that the petitioner is not likely to commit any offence while on bail."
    )


def _prima_facie_paragraph(section: str) -> str:
    return (
        f"The petitioner addresses the bar under {section} head-on and submits "
        f"that, on a consideration of the case diary and the report, the "
        f"accusation against the petitioner is not prima facie true, and the bar "
        f"to the grant of bail is therefore not attracted."
    )


@dataclass(frozen=True)
class BarResult:
    bar_applies: bool
    refused: bool
    section: Optional[str] = None
    mandatory_paragraph: bool = False
    test_kind: Optional[BarTest] = None
    paragraph_text: str = ""
    reason: str = ""
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def detect(*, statute: Optional[Statute], remedy: Remedy) -> BarResult:
    """Detect the bail bar for a statute/remedy combination."""
    if statute is None:
        return BarResult(bar_applies=False, refused=False)

    section = _SECTIONS[statute]

    # SC/ST s.18/18A: outright bar on ANTICIPATORY bail only.
    if statute is Statute.SCST:
        if remedy is Remedy.ANTICIPATORY:
            reason = (
                "Anticipatory bail barred: the offence is under the SC/ST "
                "(Prevention of Atrocities) Act; section 18 / 18A bars the "
                "grant of anticipatory bail."
            )
            return BarResult(
                bar_applies=True,
                refused=True,
                section=section,
                mandatory_paragraph=False,
                test_kind=BarTest.OUTRIGHT_BAR,
                reason=reason,
                refusal=Refusal(
                    code="anticipatory_bail_scst_barred",
                    severity=Severity.HARD, reason=reason,
                    pipeline="anticipatory_bail", spec="3.3",
                    fields=("is_scst_offence",),
                ),
            )
        # On regular bail the SC/ST Act is not an outright bail bar.
        return BarResult(bar_applies=False, refused=False, section=section)

    # NDPS / PMLA / UAPA: a threshold to be met, addressed head-on in the pleading.
    # Each bar carries its OWN test and paragraph — the tests are not the same.
    if statute in _TWIN_CONDITIONS_TESTS:
        test_kind = BarTest.TWIN_CONDITIONS
        paragraph = _twin_conditions_paragraph(section)
    else:  # UAPA s.43D(5)
        test_kind = BarTest.PRIMA_FACIE_TRUE
        paragraph = _prima_facie_paragraph(section)

    return BarResult(
        bar_applies=True,
        refused=False,
        section=section,
        mandatory_paragraph=True,
        test_kind=test_kind,
        paragraph_text=paragraph,
        reason=(
            f"{section} imposes a statutory test for bail ({test_kind.value}) that "
            f"must be addressed head-on in the application."
        ),
    )
