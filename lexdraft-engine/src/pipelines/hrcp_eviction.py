"""Eviction petition before the Rent Court — Section 21(2) of the Tamil Nadu
Regulation of Rights and Responsibilities of Landlords and Tenants Act, 2017
(TN Act 42 of 2017; in force from 22.02.2019).

STYLING (TN practice): under the 2017 Act the landlord's application for recovery
of possession is numbered "R.L.T.O.P. No. ___ of 20__" and heard by the Rent
Court (in Chennai, a Judge of the Court of Small Causes notified as the Rent
Court). Older matters under the repealed Tamil Nadu Buildings (Lease and Rent
Control) Act, 1960 were "R.C.O.P." / "H.R.C.O.P." petitions before the Rent
Controller; pending ones continue under the old Act by the savings clause and are
NOT drafted by this pipeline. The doc-type key keeps the familiar "hrcp" name.

The Rent Court follows its own summary procedure: the application is filed with
the landlord's affidavit and documents, notice issues, reply and rejoinder follow
and evidence is by affidavit.

Grounds of s.21(2) (lettering per the enacted Act; source: TN L.A. Bill 38 of 2017
as introduced, cross-checked against the Act as amended by TN Act 39 of 2018):
  (a) no tenancy agreement entered into under s.4(2)        [as substituted 2018]
  (b) arrears of rent for two months not paid within one month of a demand notice
      served as provided in s.106(4) TPA (cure proviso: payment/deposit within the
      month bars eviction, once)
  (c) parting with possession without the landlord's written consent
  (d) continued misuse after notice to stop
  (e) bona fide repairs / rebuilding / demolition needing vacant possession
  (f) works consequent on a change of land use by the competent authority
  (g) own occupation                    [verify: omitted by TN Act 19 of 2022 —
                                         confirm whether that amendment is in force]
  (h) tenant's notice to quit acted upon by the landlord
  (i) tenant refuses to pay rent under s.8   [verify: inserted by TN Act 19 of 2022]
  (j) structural change / permanent structure without written consent
                                             [verify: inserted by TN Act 19 of 2022]

Hard requirements (each refuses, no partial output):
  - At least one ground; every ground must be a known clause.
  - (a) is unavailable where a written tenancy agreement exists.
  - (b) needs the arrears (at least two months) and the date the demand notice was
    served; the petition cannot be filed until one month after service.
  - (d) needs the date of the notice to stop the misuse.
  - (h) needs the date of the tenant's notice to quit.

LLM slot: the facts narrative (para 4).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Sequence

from dateutil.relativedelta import relativedelta

from ..verify.refusals import Refusal, Severity

TEMPLATE = "hrcp_eviction.docx"
SPEC = "tn-rrrlt-21"

_LLM_SLOT_PLACEHOLDER = "[to be drafted]"
ACT = ("the Tamil Nadu Regulation of Rights and Responsibilities of Landlords and "
       "Tenants Act, 2017")

# ground key -> (clause, the ground as pleaded, verify note or "")
GROUNDS: Dict[str, tuple] = {
    "no_written_agreement": (
        "(a)", "the landlord and the tenant have failed to enter into an agreement "
        "of tenancy as required by Section 4(2) of the Act", ""),
    "arrears_of_rent": (
        "(b)", "the tenant has not paid the arrears of rent and other charges "
        "payable for two months, in full, within one month of the notice of demand "
        "served on him", ""),
    "parted_with_possession": (
        "(c)", "the tenant has parted with the possession of the whole or part of "
        "the premises without obtaining the written consent of the landlord", ""),
    "misuse": (
        "(d)", "the tenant has continued the misuse of the premises even after "
        "receipt of notice from the landlord to stop such misuse", ""),
    "repairs_rebuilding": (
        "(e)", "the premises are required by the landlord for carrying out repairs "
        "/ building / rebuilding / additions / alterations / demolition which "
        "cannot be carried out without the premises being vacated", ""),
    "change_of_land_use": (
        "(f)", "the premises are required for carrying out works consequent on a "
        "change of land use by the competent authority", ""),
    "own_occupation": (
        "(g)", "the premises are required by the landlord for his own occupation "
        "or for the occupation of a member of his family, and the landlord is not "
        "in possession of any suitable accommodation within the same urban area",
        "[verify: clause (g) is reported omitted by TN Act 19 of 2022 — confirm "
        "whether that amendment has been brought into force before pleading it]"),
    "tenant_notice_to_quit": (
        "(h)", "the tenant gave written notice to quit and, in consequence, the "
        "landlord has contracted to sell the premises or taken other steps as a "
        "result of which his interests would seriously suffer if he is not put in "
        "possession", ""),
    "refuses_rent_under_s8": (
        "(i)", "the tenant does not agree to pay the rent payable under Section 8 "
        "of the Act",
        "[verify: clause (i) is reported inserted by TN Act 19 of 2022 — confirm "
        "its commencement before pleading it]"),
    "structural_change": (
        "(j)", "the tenant has made a structural change or erected a permanent "
        "structure in the premises without the written consent of the landlord",
        "[verify: clause (j) is reported inserted by TN Act 19 of 2022 — confirm "
        "its commencement before pleading it]"),
}


@dataclass(frozen=True)
class HrcpEvictionResult:
    refused: bool
    reason: str = ""
    context: Optional[Dict[str, Any]] = None
    refusal: Optional[Refusal] = None

    @property
    def may_generate(self) -> bool:
        return not self.refused


def _refuse(reason: str, *, code: str, fields: tuple = (),
            computation: Optional[str] = None,
            remedy_hint: str = "none") -> HrcpEvictionResult:
    return HrcpEvictionResult(
        refused=True, reason=reason, context=None,
        refusal=Refusal(code=code, severity=Severity.HARD, reason=reason,
                        computation=computation, pipeline="hrcp_eviction",
                        spec=SPEC, fields=fields, remedy_hint=remedy_hint),
    )


def build(
    *,
    landlord_names: Sequence[str],
    tenant_names: Sequence[str],
    premises_description: str,
    monthly_rent: int,
    grounds: Sequence[str],
    filing_date: date,
    place: str,
    tenancy_commencement: Optional[date] = None,
    purpose_of_letting: str = "",
    written_tenancy_agreement: bool = False,
    arrears_months: int = 0,
    arrears_amount: int = 0,
    demand_notice_served_date: Optional[date] = None,
    misuse_notice_date: Optional[date] = None,
    tenant_quit_notice_date: Optional[date] = None,
    rent_court: str = "THE RENT COURT",
    court_place: str = "",
    facts_narrative: str = "",
) -> HrcpEvictionResult:
    """Assemble the Rent Court eviction petition under s.21(2), or refuse."""

    keys = [g.strip() for g in grounds if g and g.strip()]
    if not keys:
        return _refuse(
            "an eviction petition must plead at least one ground under Section 21(2) "
            "of the Act; a tenant cannot be evicted except on those grounds "
            "(Section 21(1))",
            code="hrcp_eviction_no_ground", fields=("grounds",),
        )
    unknown = [k for k in keys if k not in GROUNDS]
    if unknown:
        return _refuse(
            "unknown eviction ground(s): " + ", ".join(unknown)
            + "; allowed: " + ", ".join(GROUNDS),
            code="hrcp_eviction_unknown_ground", fields=("grounds",),
        )

    if "no_written_agreement" in keys and written_tenancy_agreement:
        return _refuse(
            "ground (a) of Section 21(2) — failure to enter into a tenancy "
            "agreement — is not available where a written tenancy agreement exists",
            code="hrcp_eviction_agreement_exists",
            fields=("grounds", "written_tenancy_agreement"),
        )

    if "arrears_of_rent" in keys:
        if arrears_months < 2:
            return _refuse(
                "ground (b) of Section 21(2) requires arrears of rent for two "
                f"months; {arrears_months} month(s) pleaded",
                code="hrcp_eviction_arrears_below_two_months",
                fields=("arrears_months",),
            )
        if demand_notice_served_date is None:
            return _refuse(
                "ground (b) of Section 21(2) requires a notice of demand for the "
                "arrears served on the tenant (in the manner of Section 106(4) of "
                "the Transfer of Property Act, 1882); the date of service is absent",
                code="hrcp_eviction_no_demand_notice",
                fields=("demand_notice_served_date",),
            )
        earliest = demand_notice_served_date + relativedelta(months=1)
        if filing_date <= earliest:
            return _refuse(
                "the tenant has one month from service of the demand notice to pay "
                "or deposit the arrears (Section 21(2)(b)); the petition on this "
                f"ground cannot be filed before {earliest + relativedelta(days=1)}",
                code="hrcp_eviction_demand_period_not_elapsed",
                fields=("demand_notice_served_date", "filing_date"),
                computation=f"notice served {demand_notice_served_date}; one month "
                            f"expires {earliest}; filing {filing_date}",
            )

    if "misuse" in keys and misuse_notice_date is None:
        return _refuse(
            "ground (d) of Section 21(2) requires that the misuse continued after "
            "notice from the landlord to stop it; the date of that notice is absent",
            code="hrcp_eviction_no_misuse_notice", fields=("misuse_notice_date",),
        )
    if "tenant_notice_to_quit" in keys and tenant_quit_notice_date is None:
        return _refuse(
            "ground (h) of Section 21(2) rests on the tenant's written notice to "
            "quit; the date of that notice is absent",
            code="hrcp_eviction_no_quit_notice",
            fields=("tenant_quit_notice_date",),
        )

    pleaded: List[Dict[str, str]] = []
    for k in keys:
        clause, text, verify = GROUNDS[k]
        pleaded.append({"key": k, "clause": clause, "text": text, "verify": verify})
    clauses = ", ".join(g["clause"] for g in pleaded)

    context: Dict[str, Any] = {
        "act": ACT,
        "rent_court": rent_court,
        "court_place": court_place,
        "petition_year": filing_date.year,
        "petition_date": filing_date.isoformat(),
        "landlords": [n for n in landlord_names if n.strip()],
        "tenants": [n for n in tenant_names if n.strip()],
        "premises_description": premises_description,
        "monthly_rent": monthly_rent,
        "tenancy_commencement": (tenancy_commencement.isoformat()
                                 if tenancy_commencement else None),
        "purpose_of_letting": purpose_of_letting,
        "written_tenancy_agreement": written_tenancy_agreement,
        "grounds": pleaded,
        "clauses": clauses,
        "arrears_months": arrears_months,
        "arrears_amount": arrears_amount,
        "demand_notice_served_date": (demand_notice_served_date.isoformat()
                                      if demand_notice_served_date else None),
        "misuse_notice_date": misuse_notice_date.isoformat() if misuse_notice_date else None,
        "tenant_quit_notice_date": (tenant_quit_notice_date.isoformat()
                                    if tenant_quit_notice_date else None),
        "facts_slot": facts_narrative if facts_narrative.strip()
                      else _LLM_SLOT_PLACEHOLDER,
        "place": place,
    }
    return HrcpEvictionResult(refused=False, context=context)
