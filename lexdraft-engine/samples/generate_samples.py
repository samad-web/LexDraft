"""Generate the five sample documents with realistic facts, as .docx.

    s.138 notice, regular bail, plaint (money recovery), writ petition, MACT claim.

Each is a fully-specified, realistic Tamil Nadu matter run through the real
pipeline and rendered with the committed templates. The VERIFY tables are still
unverified, so the figure-bearing documents (plaint, MACT) carry the unverified
banner — that is the intended, honest state until the advocate signs the tables off.

Usage:
    python samples/generate_samples.py            # writes samples/*.docx
    python samples/generate_samples.py --out DIR   # writes to DIR
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import List, Optional

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from src.factsheet import Case, Court, MatterFactSheet, Party, PartyRole  # noqa: E402
from src.verify import signoff  # noqa: E402
from src.pipelines import (  # noqa: E402
    mact_claim, plaint, regular_bail, s138_notice, writ_petition,
)
from src.pipelines.s138_notice import Cheque  # noqa: E402
from src.rules import compensation_multiplier as cm  # noqa: E402
from src.rules import jurisdiction as jur  # noqa: E402

# A fixed timestamp keeps the samples deterministic (no wall-clock in the id/version).
_CREATED_AT = datetime(2026, 9, 1, tzinfo=timezone.utc)


def _sheet(*, court_type, court_name, category, document_type, party):
    """A minimal fact sheet: the versioned source of the matter id + version that
    sign-off keys and stamps against (the same source as the document's facts)."""
    return MatterFactSheet.create(
        court=Court(court_type=court_type, name=court_name, state="Tamil Nadu"),
        case=Case(category=category, document_type=document_type),
        parties=[party],
        created_by="intake",
        created_at=_CREATED_AT,
    )


def _s138_notice():
    """A hand-loan cheque dishonour, single cheque, within the notice window."""
    result = s138_notice.build(
        client="Tmt. Lakshmi Narayanan",
        advocate="R. Sundaravadivel",
        advocate_enrolment="MS/2287/2011",
        recipient_name="Thiru. K. Murugan",
        recipient_address="12, Bharathi Street, Variety Hall Road, Coimbatore 641001",
        cheques=[Cheque(
            number="452118", date=date(2024, 11, 4), amount=450000,
            bank="Indian Overseas Bank", branch="Town Hall, Coimbatore",
            drawer="K. Murugan", payee="Lakshmi Narayanan",
        )],
        debt_nature="a hand loan of Rs. 4,50,000/- advanced on 10-06-2024 towards "
                    "working capital for the drawer's textile business",
        debt_documents=["on-demand promissory note dated 10-06-2024",
                        "acknowledgement of debt dated 10-06-2024"],
        presentation_date=date(2024, 11, 8),
        presentation_bank="City Union Bank, R.S. Puram",
        memo_date=date(2024, 11, 11),
        memo_received_date=date(2024, 11, 13),
        dishonour_reason="Funds insufficient",
        notice_date=date(2024, 11, 25),
        dispatch_mode="Registered Post Acknowledgement Due",
        dispatch_tracking_placeholder="{{ rpad_consignment_no }}",
        place="Coimbatore",
    )
    sheet = _sheet(
        court_type="magistrate", court_name="Judicial Magistrate No. I, Coimbatore",
        category="C2", document_type="s138_statutory_notice",
        party=Party(role=PartyRole.COMPLAINANT, serial=1, name="Lakshmi Narayanan"),
    )
    return "s138_notice", s138_notice.TEMPLATE, result, sheet


def _regular_bail():
    """Post-arrest regular bail, BNS/BNSS offence, chargesheet filed, no bar."""
    result = regular_bail.build(
        accused_name="Dinesh Kumar @ Dinesh",
        age=34, occupation="lorry driver",
        address="47, Kamaraj Nagar, Avadi, Chennai 600054",
        fir_no="812/2024", police_station="Avadi", district="Tiruvallur",
        sections=["BNS s.303(2)", "BNS s.317(2)"],
        offence_date=date(2024, 9, 12),
        proceeding_start_date=date(2024, 9, 14),
        is_fresh_action=False,
        custody_since=date(2024, 9, 16),
        as_on=date(2024, 12, 20),
        prison="Puzhal Central Prison, Chennai",
        chargesheet_filed=True,
        special_statute=None,
        bail_bar_addressed=False,
        is_successive=False,
        prior_order_ref=None,
        change_of_circumstance=None,
        parity_claims=[],
        court_level="Principal Sessions Judge, Tiruvallur",
        prosecution_case="",
        grounds="",
        place="Chennai",
    )
    sheet = _sheet(
        court_type="sessions", court_name="Principal Sessions Court, Tiruvallur",
        category="C3", document_type="regular_bail",
        party=Party(role=PartyRole.ACCUSED, serial=1, name="Dinesh Kumar"),
    )
    return "regular_bail", regular_bail.TEMPLATE, result, sheet


def _plaint():
    """Money recovery on a business supply account, within the SubJudge ceiling."""
    result = plaint.build(
        plaintiff_name="M/s Anand Steel Traders, rep. by its Proprietor R. Anand",
        defendant_names=["Thiru. S. Balaji, Proprietor, Balaji Constructions"],
        variant=plaint.Variant.INDIVIDUAL,
        cause_of_action_date=date(2023, 3, 15),
        cause_of_action_place="Madurai",
        forum=jur.Forum.SUBORDINATE_JUDGE,
        territorial_bases=[jur.TerritorialBasis.DEFENDANT_RESIDES,
                           jur.TerritorialBasis.CAUSE_PART_AROSE],
        principal=680000, interest_amount=122400, claimed_total=802400,
        interest_rate=18.0, interest_is_contractual=True,
        interest_document_ref="credit-supply agreement dated 02-01-2023, clause 7",
        limitation_article="19",
        limitation_trigger_date=date(2023, 3, 15),
        acknowledgements=[],
        filing_date=date(2025, 1, 20),
        is_government_defendant=False, s80_notice_ref=None,
        is_commercial_suit=False, s12a_ref=None,
        transaction_narrative="",
        performance_narrative="",
        default_narrative="",
        notice_narrative="",
        place="Madurai",
    )
    sheet = _sheet(
        court_type="district", court_name="Subordinate Judge's Court, Madurai",
        category="C4", document_type="suit_for_recovery",
        party=Party(role=PartyRole.PLAINTIFF, serial=1, name="R. Anand"),
    )
    return "plaint_money_recovery", plaint.TEMPLATE, result, sheet


def _writ_petition():
    """Mandamus against a State authority for withholding a licence renewal."""
    petitioner = Party(role=PartyRole.PETITIONER, serial=1,
                       name="Tmt. P. Revathi")
    respondents = [
        Party(role=PartyRole.RESPONDENT, serial=1, is_authority=True,
              name="The District Collector, Salem"),
        Party(role=PartyRole.RESPONDENT, serial=2, is_authority=True,
              name="The Tahsildar, Salem Taluk"),
    ]
    result = writ_petition.build(
        petitioner=petitioner,
        respondents=respondents,
        court_place="Madras", court_side="Principal Seat",
        writ_type=writ_petition.WritType.MANDAMUS,
        legal_right="the petitioner's right to renewal of her quarrying lease, the "
                    "conditions for renewal being admittedly satisfied",
        public_duty="the respondents' statutory duty under Rule 8-A of the TN Minor "
                    "Mineral Concession Rules to decide the renewal application",
        prior_demand_and_refusal="renewal application submitted on 04-03-2024; "
                                 "reminder on 20-05-2024; not disposed of despite "
                                 "the statutory period",
        quasi_judicial_order=None,
        public_office=None,
        impugned_order_number="Na.Ka. 3421/2024/A2",
        impugned_order_date=date(2024, 7, 18),
        impugned_order_annexed=True,
        alternative_remedy_addressed=True,
        alternative_remedy_basis="the statutory appeal lies to the same department "
                                 "whose inaction is impugned and is not an efficacious "
                                 "alternative remedy",
        impugned_action_recent=True,
        delay_explanation=None,
        laches_threshold_days=180,
        impugned_action_date=date(2024, 7, 18),
        filing_date=date(2024, 9, 2),
        petitioner_name="P. Revathi",
        no_similar_petition=True,
        place="Chennai", day="2", month="September", year="2024",
        facts_narrative="",
        grounds_list=[
            "The impugned inaction is contrary to Rule 8-A of the TN Minor Mineral "
            "Concession Rules, which mandates disposal within the prescribed period.",
            "The respondents have acted arbitrarily and in violation of Article 14 "
            "by treating the petitioner differently from similarly placed lessees.",
            "The failure to decide the renewal application amounts to a failure to "
            "exercise jurisdiction vested in the respondents.",
        ],
        grounds_narrative="",
    )
    sheet = _sheet(
        court_type="high_court", court_name="High Court of Judicature at Madras",
        category="C5", document_type="writ_petition",
        party=Party(role=PartyRole.PETITIONER, serial=1, name="P. Revathi"),
    )
    return "writ_petition", writ_petition.TEMPLATE, result, sheet


def _mact_claim():
    """Death claim; salaried victim, three dependants; policy valid."""
    result = mact_claim.build(
        claim_kind=mact_claim.ClaimKind.DEATH,
        claimants=["Tmt. S. Kavitha (widow)", "Minor K. Harish (son), aged 9",
                   "Minor K. Divya (daughter), aged 6"],
        accident_date=date(2024, 5, 22),
        rash_negligent_pleaded=True,
        fir_ref="Crime No. 231/2024, Sriperumbudur Traffic Investigation Wing",
        vehicle_number="TN 20 CH 4587",
        owner="Thiru. M. Ganesan",
        driver="Thiru. R. Selvam",
        insurer="United India Insurance Co. Ltd.",
        policy_no="1305003124P109876543",
        policy_valid_on_accident=True,
        victim_age=36,
        victim_annual_income=420000,
        income_proof_present=True,
        employment=cm.Employment.PERMANENT_SALARIED,
        dependants=3,
        disability_pct=None, permanent=None,
        treatment_expenses=0, attendant_expenses=0,
        claimed_total=None,
        jurisdiction_basis="the accident occurred at Sriperumbudur, within the "
                           "jurisdiction of this Tribunal (s.166(2) MV Act)",
        place="Kancheepuram",
        accident_narrative="",
    )
    sheet = _sheet(
        court_type="tribunal",
        court_name="Motor Accidents Claims Tribunal, Kancheepuram",
        category="C7", document_type="mact_claim",
        party=Party(role=PartyRole.PETITIONER, serial=1, name="S. Kavitha"),
    )
    return "mact_claim", mact_claim.TEMPLATE, result, sheet


_SAMPLES = [_s138_notice, _regular_bail, _plaint, _writ_petition, _mact_claim]


def generate(out_dir: Path, *, audit_path: Optional[Path] = None) -> List[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: List[Path] = []
    for factory in _SAMPLES:
        name, template, result, sheet = factory()
        if result.refused:
            raise SystemExit(
                f"sample {name!r} unexpectedly refused: {result.reason}"
            )
        out = out_dir / f"{name}.docx"
        # Render through the rule-6 sign-off path: every draft carries the review
        # banner (these samples are unsigned drafts) alongside any table marker.
        # The matter id + version come from the fact sheet, not the caller.
        signoff.render_document(
            template, result.context, out,
            document=name, factsheet=sheet, audit_path=audit_path,
        )
        written.append(out)
        print(f"wrote {out}")
    return written


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Generate the five sample documents.")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent,
                    help="output directory (default: samples/)")
    args = ap.parse_args(argv)
    generate(args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
