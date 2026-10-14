"""Bail custody computations + hard stops. Deterministic. No LLM.

TWO DISTINCT COMPUTATIONS — deliberately not merged:

  days_in_custody()      Inclusive day count for the bail narrative. Recomputed
                         at generation time (takes an explicit `as_on`).

  default_bail_period()  The statutory period under s.167(2) CrPC / s.187 BNSS
                         (or a special statute), running from FIRST REMAND, not
                         arrest (Chaganti Satyanarayana v. State of AP). Returns
                         the applicable period and its accrual date. NOTHING
                         downstream may compare a day-count to a hardcoded 60/90
                         — the period always comes from here.

DEFAULT-BAIL RIGHT is a SEQUENCE test on timestamps, not a date test
(Uday Mohanlal Acharya; M. Ravindran v. Intelligence Officer, DRI). See
assess_default_bail().
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import Enum
from typing import Optional

from . import bail_bar_detector as _bars

from ._result import Assessment
from ..verify import tables as _reg
from ..verify.refusals import Refusal, Severity

# Default-bail (police-custody) periods, loaded from
# verify/tables/custody_default_bail_periods.json.
_PERIODS = _reg.values("custody_default_bail_periods")


class CustodyInputError(ValueError):
    pass


# --------------------------------------------------------------------------
# days_in_custody — narrative only.
# --------------------------------------------------------------------------

def days_in_custody(custody_start: date, as_on: date) -> int:
    """Inclusive count of days in custody from `custody_start` to `as_on`.

    Both endpoints count: same day = 1 day. Narrative use only — this is NOT the
    statutory default-bail period.
    """
    if as_on < custody_start:
        raise CustodyInputError("as_on precedes custody_start")
    return (as_on - custody_start).days + 1


# --------------------------------------------------------------------------
# default_bail_period — statutory period from FIRST REMAND.
# --------------------------------------------------------------------------

class SpecialStatute(Enum):
    NDPS = "ndps"
    UAPA = "uapa"
    PMLA = "pmla"


@dataclass(frozen=True)
class Offence:
    """The punishment attributes that select the general 60/90-day bucket."""

    max_punishment_years: Optional[int] = None
    punishable_with_death: bool = False
    punishable_with_life: bool = False


@dataclass(frozen=True)
class DefaultBailPeriod:
    period_days: int
    accrual_date: date
    statute: str
    extension_procedure: Optional[str] = None
    extendable_to: Optional[int] = None


def default_bail_period(
    *,
    first_remand_date: date,
    offence: Offence,
    special_statute: Optional[SpecialStatute] = None,
) -> DefaultBailPeriod:
    """Applicable default-bail period and accrual (expiry) date.

    Period runs from FIRST REMAND (Chaganti Satyanarayana v. State of AP), not
    arrest. Accrual date is first_remand + period_days (the day the indefeasible
    right accrues if no final report is filed).

    VERIFY (advocate review — do NOT treat this table as settled in code):
      General s.167(2)/s.187: 90 days where the offence is punishable with death,
      life, or imprisonment not less than 10 years; else 60 days.
      Special statutes override the general period:
        - NDPS   : 180 days, extendable under the s.36A(4) procedure.
        - UAPA   : 90 days, extendable to 90+90 = 180 on a reasoned report of the
                   Public Prosecutor (s.43D(2) UAPA).
        - PMLA   : 60 days.
      Section numbers and the exact NDPS/UAPA extension mechanics must be checked
      against the bare Acts before this is relied upon.
    """
    # Special statutes override the general period. All figures/labels come from
    # the VERIFY registry (verify/tables/custody_default_bail_periods.json).
    if special_statute is not None:
        row = _PERIODS["special"][special_statute.value]
        return DefaultBailPeriod(
            period_days=row["period_days"],
            accrual_date=first_remand_date + timedelta(days=row["period_days"]),
            statute=row["statute"],
            extension_procedure=row["extension_procedure"],
            extendable_to=row["extendable_to"],
        )

    # General s.167(2) / s.187 BNSS: the serious (death/life/>= N years) bucket
    # takes serious_days, else ordinary_days — N and both periods are VERIFY data.
    general = _PERIODS["general"]
    is_serious = (
        offence.punishable_with_death
        or offence.punishable_with_life
        or (offence.max_punishment_years is not None
            and offence.max_punishment_years >= general["serious_min_punishment_years"])
    )
    period = general["serious_days"] if is_serious else general["ordinary_days"]
    return DefaultBailPeriod(
        period_days=period,
        accrual_date=first_remand_date + timedelta(days=period),
        statute=general["statute"],
    )


# --------------------------------------------------------------------------
# HARD STOP: default bail — sequence test on timestamps.
# --------------------------------------------------------------------------

class DefaultBailCode(Enum):
    """Distinct outcome codes. INDETERMINATE and EXTINGUISHED are both refusals
    but carry different pleadings and different advocate follow-up, so the spec
    requires them to be distinguishable — never collapse the tie/missing case
    into 'extinguished'."""

    SURVIVES = "survives"              # application availed before any final report
    EXTINGUISHED = "extinguished"     # chargesheet demonstrably preceded application
    INDETERMINATE = "indeterminate"   # equal or missing timestamps — order unknown
    NO_READINESS = "no_readiness"     # readiness-to-furnish-bail averment absent


@dataclass(frozen=True)
class DefaultBailAssessment:
    refused: bool
    reason: str
    reason_code: DefaultBailCode
    application_preceded_chargesheet: bool
    application_ts: Optional[datetime]
    chargesheet_filed_ts: Optional[datetime]
    computation: Optional[str] = None
    refusal: Optional[Refusal] = None

    def __post_init__(self) -> None:
        # Derive the structured refusal from the reason_code so every refused
        # assessment carries one, without repeating it at each return site.
        if self.refused and self.refusal is None:
            object.__setattr__(
                self, "refusal",
                _default_bail_refusal(self.reason_code, self.reason, self.computation),
            )

    @property
    def may_generate(self) -> bool:
        return not self.refused


# Map the default-bail reason_code to a stable refusal code + implicated fields.
_DEFAULT_BAIL_REFUSAL = {
    DefaultBailCode.NO_READINESS: (
        "default_bail_readiness_not_averred", ("readiness_to_furnish_bail",)),
    DefaultBailCode.INDETERMINATE: (
        "default_bail_precedence_indeterminate",
        ("application_ts", "chargesheet_filed_ts")),
    DefaultBailCode.EXTINGUISHED: (
        "default_bail_right_extinguished",
        ("application_ts", "chargesheet_filed_ts")),
}


def _default_bail_refusal(reason_code: DefaultBailCode, reason: str,
                          computation: Optional[str]) -> Refusal:
    code, fields = _DEFAULT_BAIL_REFUSAL[reason_code]
    return Refusal(code=code, severity=Severity.HARD, reason=reason,
                   computation=computation, pipeline="default_bail", spec="3.4",
                   fields=fields)


def assess_default_bail(
    *,
    application_ts: Optional[datetime],
    chargesheet_filed_ts: Optional[datetime],
    readiness_to_furnish_bail: bool,
) -> DefaultBailAssessment:
    """Whether a default-bail application may be generated.

    SEQUENCE, not date (Uday Mohanlal Acharya; M. Ravindran v. Intelligence
    Officer, DRI): the right accrues on expiry of the period and is AVAILED by
    filing the application. A chargesheet filed AFTER the application — even later
    the same day, even before the court rules — does not defeat it.

    Outcomes (reason_code):
      SURVIVES       application presented before any final report on record.
      EXTINGUISHED   chargesheet demonstrably filed before the application.
      INDETERMINATE  equal timestamps, or a missing application timestamp — the
                     precedence cannot be established. Distinct from EXTINGUISHED:
                     the remedy is not lost, the record is simply insufficient to
                     plead precedence, and the advocate must establish it.
      NO_READINESS   readiness-to-furnish-bail averment absent.

    VERIFY (advocate review — do NOT treat this rule as settled in code):
      - Precedence uses timestamps. Equal timestamps are INDETERMINATE, not
        resolved against the applicant. This must be reviewed.
      - Readiness to furnish bail is a precondition, not merely a template field.

    `application_preceded_chargesheet` is exposed because it is pleaded in the
    application itself.
    """
    computation = (
        f"application at "
        f"{application_ts.isoformat() if application_ts else 'unknown'}; "
        f"chargesheet at "
        f"{chargesheet_filed_ts.isoformat() if chargesheet_filed_ts else 'not filed'}"
    )

    # Precondition: readiness to furnish bail must be expressly averred.
    if not readiness_to_furnish_bail:
        return DefaultBailAssessment(
            refused=True,
            reason_code=DefaultBailCode.NO_READINESS,
            reason=(
                "Default bail not made out: the application lacks the express "
                "averment of readiness to furnish bail, which is required to avail "
                "the right under s.167(2)/s.187."
            ),
            application_preceded_chargesheet=False,
            application_ts=application_ts,
            chargesheet_filed_ts=chargesheet_filed_ts,
            computation=computation,
        )

    # No chargesheet on record yet -> the application is availed before any final
    # report -> survives. (This is NOT indeterminate: absence of a final report is
    # a known state, not an unknown order.)
    if chargesheet_filed_ts is None:
        return DefaultBailAssessment(
            refused=False,
            reason="",
            reason_code=DefaultBailCode.SURVIVES,
            application_preceded_chargesheet=True,
            application_ts=application_ts,
            chargesheet_filed_ts=None,
            computation=computation,
        )

    # A chargesheet exists but we have no application timestamp, or the two are
    # simultaneous -> precedence is indeterminate.
    if application_ts is None or application_ts == chargesheet_filed_ts:
        return DefaultBailAssessment(
            refused=True,
            reason_code=DefaultBailCode.INDETERMINATE,
            reason=(
                "Default bail precedence indeterminate: the application and the "
                "final report cannot be ordered in time from the record "
                "(timestamps equal or missing). Establish which was presented "
                "first before proceeding."
            ),
            application_preceded_chargesheet=False,
            application_ts=application_ts,
            chargesheet_filed_ts=chargesheet_filed_ts,
            computation=computation,
        )

    preceded = application_ts < chargesheet_filed_ts
    if not preceded:
        return DefaultBailAssessment(
            refused=True,
            reason_code=DefaultBailCode.EXTINGUISHED,
            reason=(
                "Default bail right extinguished: the final report (chargesheet) "
                "was filed before the application was presented, so the "
                "indefeasible right under s.167(2)/s.187 was not availed in time."
            ),
            application_preceded_chargesheet=False,
            application_ts=application_ts,
            chargesheet_filed_ts=chargesheet_filed_ts,
            computation=computation,
        )

    return DefaultBailAssessment(
        refused=False,
        reason="",
        reason_code=DefaultBailCode.SURVIVES,
        application_preceded_chargesheet=True,
        application_ts=application_ts,
        chargesheet_filed_ts=chargesheet_filed_ts,
        computation=computation,
    )


# --------------------------------------------------------------------------
# HARD STOP: anticipatory bail when already arrested.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class AnticipatoryBailAssessment:
    refused: bool
    reason: str
    route_to: Optional[str] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def assess_anticipatory_bail(
    *,
    already_arrested: bool,
    is_scst_offence: bool = False,
) -> AnticipatoryBailAssessment:
    """Anticipatory bail presupposes apprehension of arrest.

    Two refusals, in priority order:
      1. Already arrested -> the anticipatory remedy is moot; route to regular
         bail. This takes precedence: once arrested, the SC/ST bar is beside the
         point.
      2. SC/ST (Prevention of Atrocities) Act offence -> s.18 / 18A bars
         anticipatory bail. This is a statutory bar, not a routing case, so no
         route is offered; the refusal carries the explanation.

    VERIFY (advocate review): the SC/ST s.18/18A bar is not absolute in every
    fact pattern post-*Prathvi Raj Chauhan*; this deterministic check flags the
    bar and refuses, leaving any exception to the advocate.
    """
    if already_arrested:
        reason = (
            "Anticipatory bail unavailable: the applicant is already arrested. "
            "Route to a regular bail application."
        )
        return AnticipatoryBailAssessment(
            refused=True,
            reason=reason,
            route_to="regular_bail",
            refusal=Refusal(
                code="anticipatory_bail_already_arrested",
                severity=Severity.HARD, reason=reason,
                pipeline="anticipatory_bail", spec="3.3",
                fields=("already_arrested",), remedy_hint="route_to_regular_bail",
            ),
        )
    # SC/ST s.18/18A bar — single source of truth is bail_bar_detector.
    if is_scst_offence:
        bar = _bars.detect(statute=_bars.Statute.SCST,
                           remedy=_bars.Remedy.ANTICIPATORY)
        if bar.refused:
            return AnticipatoryBailAssessment(
                refused=True, reason=bar.reason, route_to=None,
                refusal=bar.refusal,
            )
    return AnticipatoryBailAssessment(refused=False, reason="")
