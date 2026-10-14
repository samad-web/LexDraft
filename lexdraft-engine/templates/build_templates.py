"""Scaffold the shared-component .docx templates from the spec 1.x skeletons.

HISTORY / IMPORTANT — READ BEFORE RUNNING:
    This script *originally* regenerated the committed templates on every run. That
    was a silent-clobber hazard: the committed templates under templates/shared/ are
    now HAND-AUTHORED and advocate-approved (real court formatting — A4, real
    multilevel numbering, tab leaders, headers/footers — that python-docx cannot
    faithfully emit). A blind regenerate would overwrite those corrections with
    inferior spec-derived output and lose them without a trace.

    Therefore this script is now SCAFFOLD-ONLY. It will:
      * create a NEW template file only if one does not already exist, and
      * REFUSE to overwrite any existing committed template.
    The committed .docx files are the source of truth. This script exists only to
    scaffold a brand-new doc type's starting skeleton, or (via --out) to emit into a
    throwaway directory for the CI drift check.

Usage:
    python templates/build_templates.py                 # scaffold-only into templates/shared/
                                                        #   (skips every file that already exists)
    python templates/build_templates.py --out DIR       # emit ALL templates into DIR
                                                        #   (used by CI to diff against committed)
    python templates/build_templates.py --force-overwrite
                                                        # DANGER: regenerate over committed files.
                                                        #   Only for an intentional version bump;
                                                        #   destroys hand-corrections. Never in CI.
"""

import argparse
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

# Output directory for the generated templates. Defaults to the committed dir but is
# reassigned by main() from --out. Every build_* function saves via _save() (below),
# NOT by touching this path directly, so the overwrite guard is honoured everywhere.
SHARED = Path(__file__).resolve().parent / "shared"

# The canonical committed location, captured once so _save() can tell "am I about to
# clobber a committed template?" regardless of what SHARED is repointed to.
_COMMITTED_DIR = Path(__file__).resolve().parent / "shared"

# Set by main(): may _save() overwrite an existing file? Default False (scaffold-only).
_ALLOW_OVERWRITE = False

# Filled by main() for the end-of-run summary.
_written: list = []
_skipped: list = []


def _save(doc, filename: str) -> None:
    """Save a generated template, honouring the overwrite guard.

    Every build_* function calls this instead of doc.save(SHARED / name). If the
    target already exists and overwrite is not explicitly allowed, the file is left
    UNTOUCHED and recorded as skipped — so a routine run can never silently destroy a
    hand-authored, advocate-approved template.
    """
    target = SHARED / filename
    if target.exists() and not _ALLOW_OVERWRITE:
        _skipped.append(filename)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(target))
    _written.append(filename)


def _center(doc, text, bold=False):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    run.bold = bold
    return p


def _line(doc, text=""):
    return doc.add_paragraph(text)


def _verify_banner(doc):
    """A document-level unverified-figures banner (the TABLE marker).

    Renders `unverified_marker` (from the VERIFY table registry) only when it is
    non-empty — i.e. when a VERIFY table the document consumes is not yet advocate-
    verified. When every consumed table is signed off the pipeline passes an empty
    string and this line renders blank, so the marker disappears with no code or
    template change. Mirrors the MACT inline marker, generalised to a banner.

    This is INDEPENDENT of the review banner below: this one is about figures, the
    review banner is about the whole document needing advocate review.
    """
    _line(doc, "{% if unverified_marker %}{{ unverified_marker }}{% endif %}")


def _review_banner(doc):
    """The mandatory advocate-review banner (CLAUDE.md rule 6).

    On EVERY generated draft regardless of tables. `review_banner` is set by
    src.verify.signoff.resolve_context: the banner string on a draft, or "" once
    the document has been explicitly signed off as final (recorded in the audit
    trail). It renders blank only in the signed-off case, so the line vanishes with
    no template change.
    """
    _line(doc, "{% if review_banner %}{{ review_banner }}{% endif %}")


def _court_issues_banner(doc):
    """A prominent marker for COURT-ISSUED instruments (TN forms set).

    Summonses, court notices and warrants are issued by the court/registry under
    seal; the advocate only prepares the draft. This banner renders on every such
    draft (the pipeline sets `court_issues` True) so the output can never be
    mistaken for an advocate-authored pleading — it honours the rule that the
    engine must not present itself as issuing a court's order.
    """
    _line(doc, "{% if court_issues %}[COURT ISSUES THIS — the advocate prepares "
               "this draft for the court's issue; it is not an advocate-authored "
               "pleading]{% endif %}")


def _tn_court_line(doc, *, prefix="IN THE COURT OF"):
    """The generalised procedural court line + case reference shared by the TN
    forms. Court name/place are placeholders so the template serves any state."""
    _line(doc, "{% if court_name %}" + prefix + " {{ court_name }}"
               "{% else %}" + prefix + " ______{% endif %}"
               "{% if court_place %} AT {{ court_place }}{% endif %}")
    _line(doc, "{{ case_ref }}")
    _line(doc)


# --------------------------------------------------------------------------
# 1.1 Cause title — all variants in one template, forked by {% if variant %}.
# --------------------------------------------------------------------------

def build_cause_title():
    doc = Document()

    # District civil
    _line(doc, "{% if variant == 'district_civil' %}")
    _center(doc, "IN THE COURT OF THE {{ court.name }}", bold=True)
    _center(doc, "AT {{ court.place }}", bold=True)
    _line(doc)
    _center(doc, "{{ case.type }} No. ______ of {{ case.year }}")
    _line(doc)
    _line(doc, "{% for p in plaintiffs %}")
    _line(doc, "{{ p.name }}, aged {{ p.age }} years,")
    _line(doc, "{{ p.parentage_type }} {{ p.parentage_name }},")
    _line(doc, "{{ p.occupation }},")
    _line(doc, "residing at {{ p.address }}"
               "{% if loop.last %}                    ... Plaintiff"
               "{% if plaintiffs|length > 1 %}s{% endif %}{% endif %}")
    _line(doc, "{% endfor %}")
    _center(doc, "Versus")
    _line(doc, "{% for d in defendants %}")
    _line(doc, "{{ d.name }}, aged {{ d.age }} years,")
    _line(doc, "{{ d.parentage_type }} {{ d.parentage_name }},")
    _line(doc, "{{ d.occupation }},")
    _line(doc, "residing at {{ d.address }}"
               "{% if loop.last %}                    ... Defendant"
               "{% if defendants|length > 1 %}s{% endif %}{% endif %}")
    _line(doc, "{% endfor %}")
    _line(doc, "{% endif %}")

    # High Court writ
    _line(doc, "{% if variant == 'writ' %}")
    _center(doc, "IN THE HIGH COURT OF JUDICATURE AT {{ court.place }}", bold=True)
    _center(doc, "({{ court.side }} JURISDICTION)")
    _line(doc)
    _center(doc, "W.P. No. ______ of {{ case.year }}")
    _line(doc)
    _line(doc, "{% for p in petitioners %}")
    _line(doc, "{{ p.serial }}. {{ p.name }}"
               "{% if p.age %}, aged {{ p.age }} years{% endif %}"
               "{% if loop.last %}                    ... Petitioner"
               "{% if petitioners|length > 1 %}s{% endif %}{% endif %}")
    _line(doc, "{% endfor %}")
    _center(doc, "Versus")
    _line(doc, "{% for r in respondents %}")
    _line(doc, "{{ r.serial }}. {{ r.name }}"
               "{% if loop.last %}                    ... Respondent"
               "{% if respondents|length > 1 %}s{% endif %}{% endif %}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "PETITION UNDER ARTICLE 226 OF THE CONSTITUTION OF INDIA")
    _line(doc, "praying for a Writ of {{ writ_type }} {{ prayer_short or '' }}")
    _line(doc, "{% endif %}")

    # Sessions criminal
    _line(doc, "{% if variant == 'sessions_criminal' %}")
    _center(doc, "IN THE COURT OF THE SESSIONS JUDGE, {{ court.place }}", bold=True)
    _line(doc)
    _center(doc, "Crl.M.P. No. ______ of {{ case.year }}")
    _center(doc, "in")
    _center(doc, "{{ crime_ref }}")
    _line(doc)
    _line(doc, "{{ accused.name }}, aged {{ accused.age }},")
    _line(doc, "{{ accused.parentage_type }} {{ accused.parentage_name }}, "
               "{{ accused.address }}")
    _line(doc, "{% if accused.in_custody %}(now confined in {{ accused.prison }})"
               "{% endif %}                    ... Petitioner/Accused")
    _center(doc, "Versus")
    _line(doc, "State represented by")
    _line(doc, "The Inspector of Police,")
    _line(doc, "{{ police_station }},")
    _line(doc, "{{ district }}")
    _line(doc, "(Crime No. {{ crime_no }} of {{ crime_year }})"
               "                    ... Respondent")
    _line(doc, "{% endif %}")

    # Appeal
    _line(doc, "{% if variant == 'appeal' %}")
    _center(doc, "IN THE COURT OF THE {{ court.name }}", bold=True)
    _center(doc, "AT {{ court.place }}", bold=True)
    _line(doc)
    _center(doc, "{{ case.type }} No. ______ of {{ case.year }}")
    _line(doc, "(Against {{ lower_court_reference }})")
    _line(doc)
    _line(doc, "{% for a in appellants %}")
    _line(doc, "{{ a.name }}"
               "{% if loop.last %}                    ... Appellant"
               "{% if appellants|length > 1 %}s{% endif %}{% endif %}")
    _line(doc, "{% endfor %}")
    _center(doc, "Versus")
    _line(doc, "{% for r in respondents %}")
    _line(doc, "{{ r.name }}"
               "{% if loop.last %}                    ... Respondent"
               "{% if respondents|length > 1 %}s{% endif %}{% endif %}")
    _line(doc, "{% endfor %}")
    _line(doc, "{% endif %}")

    _save(doc, "cause_title.docx")


# --------------------------------------------------------------------------
# 1.2 Verification
# --------------------------------------------------------------------------

def build_verification():
    doc = Document()

    # Canonical DPC-book civil verification (pp.12, 16, 25, 29): names the last
    # para as the prayer, and attributes belief paras to "information received and
    # believed to be true". `derived_source` carries the company "records… in the
    # ordinary course of business" clause when applicable (book p.10).
    _line(doc, "{% if variant == 'civil' or variant == 'commercial' %}")
    _line(doc,
          "Verified at {{ place }} on this {{ day }} day of {{ month }}, {{ year }} "
          "that the contents of paras {{ knowledge_paras }} of the "
          "{{ document_kind or 'pleading' }} are true to my knowledge"
          "{% if derived_source %} {{ derived_source }}{% endif %}, those of paras "
          "{{ belief_paras }} are true on information received and believed to be "
          "true, and the last para is the humble prayer to this Hon'ble Court.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("{{ role }}")
    _line(doc, "{% endif %}")

    _line(doc, "{% if variant == 'writ' %}")
    _line(doc,
          "I, {{ name }}, the {{ role }} above named, do hereby declare that the "
          "facts stated above are true to the best of my knowledge, information "
          "and belief, and that no other petition on the same cause of action has "
          "been filed by me before this Hon'ble Court or the Hon'ble Supreme Court.")
    _line(doc)
    _line(doc,
          "Verified at {{ place }} on this {{ day }} day of {{ month }}, {{ year }}.")
    _line(doc, "{% endif %}")

    _line(doc, "{% if variant == 'commercial' %}")
    _line(doc)
    _center(doc, "STATEMENT OF TRUTH", bold=True)
    _line(doc,
          "I, {{ name }}, state that the statements made in this {{ document_kind }} "
          "are true to my knowledge, and that I understand that a false statement "
          "may render me liable for prosecution.")
    _line(doc, "{% endif %}")

    _save(doc, "verification.docx")


# --------------------------------------------------------------------------
# 1.3 Affidavit
# --------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# WARNING — this function does NOT produce the live affidavit template.
#
# templates/shared/affidavit.docx is HAND-AUTHORED (out-of-band) and DIVERGENT
# from what this function emits. build_affidavit() has never produced the file
# that actually renders: the on-disk template carries a court cause-title /
# party block, a standalone VERIFICATION clause, the review-banner header, and a
# docxtpl paragraph-tag body loop ({%p for ... %}) that this scaffold does not
# write. The _ALLOW_OVERWRITE guard (see _save) has kept every scaffold run from
# clobbering it — it is recorded as "skipped", never rewritten.
#
# DO NOT regenerate affidavit.docx from this function to "fix" it: doing so would
# DESTROY the court-cause-title block, the verification clause, and the banner
# header. Edit templates/shared/affidavit.docx directly (python-docx) instead.
# This function is retained only as historical scaffolding.
# ---------------------------------------------------------------------------
def build_affidavit():
    doc = Document()
    _center(doc, "AFFIDAVIT", bold=True)
    _line(doc)
    _line(doc,
          "I, {{ deponent_name }}, aged {{ age }} years, {{ parentage_type }} "
          "{{ parentage_name }}, {{ occupation }}, residing at {{ address }}, do "
          "hereby solemnly affirm and sincerely state as follows:")
    _line(doc)
    _line(doc,
          "1. I am the {{ role }} in the above {{ proceeding }} and am well "
          "acquainted with the facts of the case."
          "{% if authorised %} I am duly authorised to swear this affidavit vide "
          "{{ authority_ref }}.{% endif %}"
          "{% if is_third_party %} My source of knowledge is {{ source_of_knowledge }}."
          "{% endif %}")
    _line(doc, "{% for para in numbered_body %}")
    _line(doc, "{{ para.number }}. {{ para.text }}")
    _line(doc, "{% endfor %}")
    _line(doc,
          "{{ prayer_number }}. It is therefore prayed that this Hon'ble Court may "
          "be pleased to {{ prayer }}.")
    _line(doc)
    _line(doc, "Solemnly affirmed at {{ place }}          }")
    _line(doc, "on this {{ date }}                        }        DEPONENT")
    _line(doc, "and signed his/her name in my presence.   }")
    _line(doc)
    _center(doc, "BEFORE ME")
    _line(doc)
    _line(doc, "{{ attestor }}")
    _save(doc, "affidavit.docx")


# --------------------------------------------------------------------------
# 1.5 Prayer
# --------------------------------------------------------------------------

def build_prayer():
    # Canonical DPC-book prayer (pp.12, 16, 25): "most respectfully" opener,
    # lettered (a)(b)(c) clauses, and the standard catch-all closer as the final
    # lettered clause. Reliefs keep their interim/alternative flags.
    doc = Document()
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc)
    _line(doc, "{% for r in reliefs %}")
    _line(doc,
          "({{ 'abcdefghijklmnop'[loop.index0] }}) "
          "{% if r.is_interim %}(interim) {% endif %}"
          "{% if r.is_alternative %}(in the alternative) {% endif %}"
          "{{ r.description }}, as against {{ r.against_party }};")
    _line(doc, "{% endfor %}")
    # Standard closer as the last lettered clause (book: "pass such other and
    # further order(s)…"). A caller-supplied `closer` is emitted as-is (it carries
    # its own punctuation); the book default supplies its own trailing period.
    _line(doc,
          "({{ 'abcdefghijklmnop'[reliefs|length] }}) "
          "{% if closer %}{{ closer }}"
          "{% else %}pass such other and further order(s) as may be deemed fit and "
          "proper on the facts and in the circumstances of this case.{% endif %}")
    _save(doc, "prayer.docx")


# --------------------------------------------------------------------------
# 2.2 s.138 statutory notice
# --------------------------------------------------------------------------

def build_s138_notice():
    doc = Document()
    _review_banner(doc)
    # --- Advocate letterhead block (DPC book pp.130-131). Optional fields render
    #     only when supplied, so the existing pipeline (which passes advocate name
    #     + enrolment) is unaffected; a chambers address / phone enrich it when
    #     present. ---
    _line(doc, "{{ advocate }}")
    _line(doc, "Advocate")
    _line(doc, "{% if advocate_chamber %}{{ advocate_chamber }}{% endif %}")
    _line(doc, "{% if advocate_phone %}Ph. {{ advocate_phone }}{% endif %}")
    _line(doc)
    # "REGD A/D / U.P.C." dispatch line above the date (book convention). Falls
    # back to the engine's dispatch_mode when the book's exact line isn't supplied.
    _line(doc, "{% if dispatch_line %}{{ dispatch_line }}"
               "{% else %}By {{ dispatch_mode }}{% endif %}")
    _line(doc, "Dispatch proof: {{ dispatch_tracking_placeholder }}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Dated: {{ notice_date }}")
    _line(doc)
    _line(doc, "To,")
    _line(doc, "{{ recipient.name }},")
    _line(doc, "{{ recipient.address }}")
    # Second service address ("And also at:") — the book serves at business +
    # residence. Renders only when the recipient has a second address.
    _line(doc, "{% if recipient.also_at %}And also at:")
    _line(doc, "{{ recipient.also_at }}{% endif %}")
    _line(doc)
    _line(doc, "SUB: LEGAL NOTICE UNDER SECTION 138 OF THE "
               "NEGOTIABLE INSTRUMENTS ACT, 1881")
    _line(doc)
    _line(doc, "Dear Sir,")
    _line(doc)
    _line(doc,
          "1. Under instructions from and on behalf of my client, {{ client }}, "
          "I issue this notice to you as follows:")
    _line(doc,
          "2. My client states that a legally enforceable debt / liability, "
          "namely {{ debt_nature }}, subsists against you"
          "{% if debt_documents %}, evidenced by "
          "{% for d in debt_documents %}{{ d }}"
          "{% if not loop.last %}, {% endif %}{% endfor %}{% endif %}.")
    _line(doc,
          "3. In discharge of the said liability you issued the following "
          "cheque(s):")
    _line(doc, "{% for c in cheques %}")
    _line(doc,
          "   ({{ loop.index }}) Cheque No. {{ c.number }} dated {{ c.date }} "
          "for Rs. {{ c.amount }}/- ({{ c.amount_words }} rupees only), drawn on "
          "{{ c.bank }}, {{ c.branch }}.")
    _line(doc, "{% endfor %}")
    _line(doc,
          "4. The said cheque(s) were presented for encashment on "
          "{{ presentation_date }} through {{ presentation_bank }}, within the "
          "period of their validity.")
    _line(doc,
          "5. The said cheque(s) were returned dishonoured vide memo dated "
          "{{ memo_date }} for the reason “{{ dishonour_reason }}”.")
    _line(doc,
          "6. The dishonour memo was received by my client on "
          "{{ memo_received_date }}.")
    _line(doc,
          "7. I hereby call upon you to pay the sum of Rs. {{ demand_amount }}/- "
          "({{ demand_words }} rupees only) within {{ compliance_days }} days of "
          "receipt of this notice.")
    _line(doc,
          "8. Should you fail to pay the said sum within {{ compliance_days }} "
          "days, my client shall be constrained to prosecute you under Section 138 "
          "of the Negotiable Instruments Act, 1881, at your risk as to costs and "
          "consequences.")
    _line(doc)
    # --- Close (DPC book): salutation sign-off, advocate identity, office-copy
    #     footer. Enrolment + place are kept (the engine collects them). ---
    _line(doc, "Yours Sincerely,")
    _line(doc, "{{ advocate }}")
    _line(doc, "Advocate, Enrolment No. {{ advocate_enrolment }}")
    _line(doc, "Place: {{ place }}")
    _line(doc)
    _line(doc, "Copy kept in my office for future reference and use.")
    _save(doc, "s138_notice.docx")


# --------------------------------------------------------------------------
# 3.4 Default bail
# --------------------------------------------------------------------------

def build_default_bail():
    doc = Document()
    _review_banner(doc)
    _verify_banner(doc)
    _bail_cause_title(doc, "MAGISTRATE / SPECIAL COURT")
    _center(doc, "APPLICATION FOR DEFAULT BAIL UNDER "
                 "{{ default_bail_section|upper }}", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. The petitioner, {{ accused.name }}, aged {{ accused.age }}, "
          "{{ accused.occupation }}, residing at {{ accused.address }}, is the "
          "accused in Crime No. {{ fir_no }} of {{ police_station }}, "
          "{{ district }}.")
    _line(doc,
          "2. The offence is registered under "
          "{% for s in sections %}{{ s }}{% if not loop.last %}, {% endif %}"
          "{% endfor %}. The applicable statutory period for filing the final "
          "report is {{ period_days }} days ({{ period_statute }})"
          "{% if extendable_to %}, extendable to {{ extendable_to }} days by the "
          "prescribed procedure{% endif %}.")
    _line(doc,
          "3. The petitioner was first remanded to custody on "
          "{{ first_remand_date }} and has, as on {{ as_on }}, completed "
          "{{ custody_days }} days in custody. The statutory period expired on "
          "{{ accrual_date }}.")
    _line(doc,
          "4. The final report (charge sheet) has not been filed within the "
          "statutory period of {{ period_days }} days.")
    _line(doc,
          "5. The indefeasible right to be released on default bail has accrued to "
          "the petitioner, who is ready and willing to furnish bail as this "
          "Hon'ble Court may direct.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc,
          "(a) enlarge the petitioner on default bail under "
          "{{ default_bail_section }}, the statutory period for filing the final "
          "report having expired without its being filed, on such terms and "
          "conditions as this Hon'ble Court may deem fit; and")
    _line(doc,
          "(b) pass such other and further order(s) as may be deemed fit and "
          "proper on the facts and in the circumstances of this case.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("APPLICANT")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if bail_date %}{{ bail_date }}{% else %}____________"
               "{% endif %}                      Advocate")
    _line(doc)
    _line(doc, "Note: To be supported by affidavit of Pairokar and Vakalatnama "
               "duly attested by Jail Authorities.")
    _save(doc, "default_bail.docx")


# --------------------------------------------------------------------------
# 3.3 Anticipatory bail
# --------------------------------------------------------------------------

def build_anticipatory_bail():
    doc = Document()
    _review_banner(doc)
    _verify_banner(doc)
    _bail_cause_title(doc, "SESSIONS JUDGE")
    _center(doc, "APPLICATION FOR THE GRANT OF ANTICIPATORY BAIL UNDER "
                 "{{ anticipatory_bail_section|upper }}", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. The petitioner, {{ accused.name }}, aged {{ accused.age }}, "
          "{{ accused.occupation }}, residing at {{ accused.address }}, has not "
          "been arrested so far in Crime No. {{ fir_no }} of {{ police_station }}, "
          "{{ district }}.")
    _line(doc, "2. Prosecution case / apprehension of arrest: "
               "{{ prosecution_case_slot }}")
    _line(doc,
          "3. The petitioner reasonably apprehends arrest for the following "
          "reasons: {{ apprehension_basis }}.")
    _line(doc,
          "4. The offence is registered under "
          "{% for s in sections %}{{ s }}{% if not loop.last %}, {% endif %}"
          "{% endfor %}.")
    _line(doc, "{% if jurisdiction_paragraph %}")
    _line(doc,
          "4A. This is a petition for transit anticipatory bail. This Hon'ble "
          "Court has jurisdiction as the petitioner ordinarily resides within its "
          "territorial limits, pending approach to the court having jurisdiction "
          "over the offence.")
    _line(doc, "{% endif %}")
    _line(doc, "5. GROUNDS:")
    _line(doc, "   (a) The petitioner is falsely implicated / a civil dispute has "
               "been given a criminal colour.")
    _line(doc, "   (b) No custodial interrogation is necessary.")
    _line(doc, "   (c) The petitioner offers to cooperate with the investigation.")
    _line(doc, "   (d) The petitioner has no antecedents.")
    _line(doc, "   (e) The petitioner has roots in society.")
    _line(doc,
          "6. The petitioner undertakes to cooperate with the investigation, "
          "attend as and when required, not tamper with evidence or influence "
          "witnesses, and not leave the jurisdiction without leave.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that the applicant be "
          "released on bail in the event of his arrest, and appropriate directions "
          "in this regard may please be sent to the concerned Investigating "
          "Officer / S.H.O. Any other order which this Hon'ble Court may deem fit "
          "and proper on the facts and circumstances of this case may also be "
          "passed.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("APPLICANT")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {{ bail_date }}                      Advocate")
    _line(doc)
    _line(doc, "Note: To be supported by affidavit.")
    _save(doc, "anticipatory_bail.docx")


# --------------------------------------------------------------------------
# 3.2 Regular bail
# --------------------------------------------------------------------------

def _bail_cause_title(doc, court_default):
    """Cause-title header shared by regular + anticipatory bail (DPC book pp.75-78).
    A complete, self-contained document header; optional fields render when present."""
    _center(doc, "IN THE COURT OF {% if bail_court %}{{ bail_court }}"
                 "{% else %}" + court_default + "{% endif %}"
                 "{% if district %} (DISTRICT {{ district }}){% endif %}"
                 "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "BAIL APPLICATION NO. ______ OF {{ bail_year }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc, "{{ accused.name }}")
    _line(doc, "{% if accused.parentage %}{{ accused.parentage }}{% endif %}")
    _line(doc, "{% if accused.address %}R/o {{ accused.address }}{% endif %}"
               "                          ... APPLICANT")
    _center(doc, "VERSUS")
    _line(doc, "STATE                                       ... RESPONDENT")
    _line(doc, "{% if fir_no %}FIR NO. {{ fir_no }}{% endif %}")
    _line(doc, "{% if sections %}U/S {% for s in sections %}{{ s }}"
               "{% if not loop.last %}, {% endif %}{% endfor %}{% endif %}")
    _line(doc, "{% if police_station %}POLICE STATION: {{ police_station }}"
               "{% endif %}")
    _line(doc)


def build_regular_bail():
    doc = Document()
    _review_banner(doc)
    _verify_banner(doc)
    _bail_cause_title(doc, "METROPOLITAN MAGISTRATE")
    _center(doc, "APPLICATION FOR GRANT OF BAIL UNDER "
                 "{{ regular_bail_section|upper }}", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. The petitioner, {{ accused.name }}, aged {{ accused.age }}, "
          "{{ accused.occupation }}, residing at {{ accused.address }}, is the "
          "accused in Crime No. {{ fir_no }} of {{ police_station }}, "
          "{{ district }}, and is presently in custody at {{ accused.prison }}.")
    _line(doc, "2. Prosecution case in brief: {{ prosecution_case_slot }}")
    _line(doc,
          "3. The offence is registered under "
          "{% for s in sections %}{{ s }}{% if not loop.last %}, {% endif %}"
          "{% endfor %}.")
    _line(doc,
          "4. The petitioner was taken into custody on {{ custody_since }} and has, "
          "as on {{ as_on }}, been in custody for {{ custody_days }} days.")
    _line(doc,
          "5. Investigation status: the charge sheet has "
          "{% if chargesheet_filed %}been filed{% else %}not been filed{% endif %}.")
    _line(doc, "{% if is_successive %}")
    _line(doc,
          "5A. This is a successive application. The prior application "
          "({{ prior_order_ref }}) was disposed of. The following change of "
          "circumstance has since arisen: {{ change_of_circumstance }}.")
    _line(doc, "{% endif %}")
    _line(doc, "{% if bail_bar_paragraph %}")
    _line(doc, "5B. {{ bail_bar_text }}")
    _line(doc, "{% endif %}")
    _line(doc, "6. GROUNDS: {{ grounds_slot }}")
    _line(doc, "{% if parity_claims %}")
    _line(doc, "   Parity is claimed with the following co-accused already enlarged "
               "on bail:")
    _line(doc, "{% for p in parity_claims %}")
    _line(doc, "   - {{ p.co_accused }} (vide {{ p.order_ref }})")
    _line(doc, "{% endfor %}")
    _line(doc, "{% endif %}")
    _line(doc,
          "7. The petitioner undertakes to cooperate with the investigation and "
          "trial, attend court as and when required, not tamper with evidence or "
          "influence witnesses, and not leave the jurisdiction without leave.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that the accused may kindly "
          "be released on bail during the pendency of this case on such terms and "
          "conditions as this Hon'ble Court may deem fit and proper, and any other "
          "order which this Hon'ble Court may deem fit in the facts and "
          "circumstances of this case may also be passed.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("APPLICANT")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {{ bail_date }}                      Advocate")
    _line(doc)
    _line(doc, "Note: To be supported by affidavit of Pairokar and Vakalatnama "
               "duly attested by Jail Authorities.")
    _save(doc, "regular_bail.docx")


# --------------------------------------------------------------------------
# 2.1 General demand notice
# --------------------------------------------------------------------------

def build_general_notice():
    doc = Document()
    _review_banner(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Dated: {{ notice_date }}")
    _line(doc, "By {{ recipient.mode }}")
    _line(doc, "Dispatch proof: {{ dispatch_tracking_placeholder }}")
    _line(doc)
    _line(doc, "To,")
    _line(doc, "{{ recipient.name }},")
    _line(doc, "{{ recipient.address }}")
    _line(doc)
    _center(doc, "LEGAL NOTICE", bold=True)
    _line(doc)
    _line(doc,
          "1. Under instructions from and on behalf of my client, {{ client }}, I "
          "issue this notice to you as follows:")
    _line(doc, "2. My client is {{ client }}; you are the addressee.")
    _line(doc, "3. (Party introduction as above.)")
    _line(doc, "4. {{ transaction_slot }}")                       # LLM
    _line(doc, "5. The obligation owed by you arises from the above.")
    _line(doc, "6. {{ breach_slot }}")                            # LLM
    _line(doc, "7. {{ prior_demands_slot }}")                     # LLM
    _line(doc, "8. {{ loss_slot }}")                              # LLM
    _line(doc,
          "9. I hereby DEMAND that you {{ act_required }}, being the sum of "
          "Rs. {{ demand_amount }}/- ({{ demand_words }} rupees only), within "
          "{{ compliance_days }} days of receipt of this notice.")
    _line(doc,
          "10. Should you fail to comply, my client shall be constrained to "
          "initiate {{ civil_consequence }}"
          "{% if criminal_consequence %}, and further {{ criminal_consequence }}"
          "{% endif %}, at your risk as to costs and interest.")
    _line(doc, "11. The rights of my client are expressly reserved.")
    _line(doc, "12. A copy of this notice is retained in my office for record.")
    _line(doc)
    _line(doc, "{{ advocate }}")
    _line(doc, "Advocate, Enrolment No. {{ advocate_enrolment }}")
    _line(doc, "Place: {{ place }}")
    _save(doc, "general_notice.docx")


# --------------------------------------------------------------------------
# 3.1 s.138 complaint
# --------------------------------------------------------------------------

def build_s138_complaint():
    doc = Document()
    _review_banner(doc)
    # --- Cause-title header (DPC book pp.79-80): complete self-contained document.
    #     Court/case/parties/jurisdiction come from the pipeline context (already
    #     supplied). Court location + police station render when present. ---
    _center(doc, "COMPLAINT UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS "
                 "ACT, 1881", bold=True)
    _line(doc)
    _center(doc, "IN THE COURT OF THE CHIEF METROPOLITAN MAGISTRATE"
                 "{% if court_location %}, {{ court_location }}{% endif %}"
                 "{% if district %} (DISTRICT {{ district }}){% endif %}"
                 "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "CRIMINAL COMPLAINT NO. ______ OF {{ complaint_year }}")
    _line(doc)
    _line(doc, "{{ complainant.name }}")
    _line(doc, "{% if complainant.parentage %}{{ complainant.parentage }}{% endif %}")
    _line(doc, "{% if complainant.address %}R/o {{ complainant.address }}{% endif %}"
               "                                   ... COMPLAINANT")
    _center(doc, "VERSUS")
    _line(doc, "{{ accused.name }}")
    _line(doc, "{% if accused.parentage %}{{ accused.parentage }}{% endif %}")
    _line(doc, "{% if accused.address %}R/o {{ accused.address }}{% endif %}"
               "                                   ... ACCUSED")
    _line(doc, "{% if police_station %}JURISDICTION: P.S. {{ police_station }}"
               "{% endif %}")
    _line(doc)
    _center(doc, "COMPLAINT UNDER SECTION 138 OF THE NEGOTIABLE INSTRUMENTS "
                 "ACT, 1881", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. The complainant, {{ complainant.name }}, is the payee / holder in "
          "due course of the cheque(s) hereinafter described."
          "{% if complainant.is_company %} The complainant is a company represented "
          "by {{ complainant.authorised_rep }}, duly authorised"
          "{% if complainant.resolution_ref %} vide {{ complainant.resolution_ref }}"
          "{% endif %}.{% endif %}")
    _line(doc,
          "2. The accused is {{ accused.name }}."
          "{% if accused.is_company %} {{ s141_averment }}.{% endif %}")
    _line(doc, "3. {{ debt_slot }}")                              # LLM (shared slot)
    _line(doc, "4. Particulars of the cheque(s):")
    _line(doc, "{% for c in cheques %}")
    _line(doc,
          "   ({{ loop.index }}) Cheque No. {{ c.number }} dated "
          "{{ c.date_body or c.date }} for Rs. {{ c.amount }}/- "
          "({{ c.amount_words }} rupees only), drawn on {{ c.bank }}, {{ c.branch }}.")
    _line(doc, "{% endfor %}")
    _line(doc,
          "5. The cheque(s) were presented on {{ presentation_date_body or presentation_date }} "
          "and returned dishonoured vide memo dated {{ memo_date_body or memo_date }} for the "
          "reason “{{ dishonour_reason }}”; the memo was received on "
          "{{ memo_received_date_body or memo_received_date }}.")
    _line(doc,
          "{% if deferment_agreement_date %}5A. On the accused representing financial "
          "difficulty and requesting deferment, the parties reduced their understanding "
          "into a written deferment agreement dated "
          "{{ deferment_agreement_date_body }}, and the complainant, acting bona fide, "
          "refrained from presenting the cheque(s) during the agreed period before "
          "re-presenting the same.{% endif %}")
    _line(doc,
          "6. A statutory notice dated {{ notice_date_body or notice_date }} was dispatched on "
          "{{ notice_dispatch_date_body or notice_dispatch_date }} and "
          "{% if deemed_service %}returned; {{ deemed_service_averment }}, and is "
          "deemed served on {{ delivery_date_body or delivery_date }}"
          "{% else %}served on {{ delivery_date_body or delivery_date }}{% endif %}.")
    _line(doc, "7. The accused failed to pay within 15 days of service of the notice.")
    _line(doc, "8. The cause of action under Section 138 arose on "
               "{{ cause_of_action_date_body or cause_of_action_date }}.")
    _line(doc,
          "9. The offence under Section 138 is made out: a legally enforceable "
          "debt, a cheque issued in discharge thereof, dishonour, statutory "
          "notice, and failure to pay.")
    _line(doc,
          "10. This Hon'ble Court has jurisdiction: {{ jurisdiction_basis }}.")
    _line(doc,
          "11. The complaint is filed within one month of the cause of action "
          "(Section 142(b))."
          "{% if condonation_required %} As the period is exceeded, an application "
          "for condonation of delay under the {{ condonation_section }} is filed "
          "along with this complaint.{% endif %}")
    _line(doc, "12. Court fee is paid and the documents are listed herewith.")
    _line(doc)
    # --- PRAYER (book pp.79-80 wording) ---
    _line(doc, "PRAYER:")
    _line(doc,
          "{% if prayer_twice_amount %}"
          "It is, therefore, most humbly prayed that this Hon'ble Court may be "
          "pleased to summon, prosecute and punish the accused and direct the "
          "accused to pay twice the amount covered under the said dishonoured "
          "cheque(s), being Rs. {{ prayer_twice_figure }}/- ({{ prayer_twice_words }} "
          "rupees only), under the provisions of Section 138 read with Section 142 "
          "of the Negotiable Instruments Act, 1881 (as amended by the Negotiable "
          "Instruments Laws (Amendment and Miscellaneous Provisions) Act, 2002) and "
          "in accordance with Section 395 of BNSS, 2023, and pass such further or "
          "other orders as may be deemed fit and proper by this Hon'ble Court and "
          "thus render justice."
          "{% else %}"
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to summon the accused under Section 138 of the Negotiable "
          "Instruments Act, 1881 (as amended up-to-date), and the accused be tried "
          "and punished in accordance with law for the aforesaid offence, and "
          "further to award such compensation and pass such other order(s) as this "
          "Hon'ble Court may deem fit and proper."
          "{% endif %}")
    _line(doc)
    # --- Signature block ---
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("COMPLAINANT")
    _line(doc, "Place: {{ place }}                                Through")
    _line(doc, "Date:  {{ complaint_date_body or complaint_date }}                       Advocate")
    _line(doc)
    # --- List of documents (para 12 says "listed herewith"; here they are) ---
    # Standard s.138 documentary set, then any advocate-added documents. The count
    # of standard entries is carried in `standard_document_count` so the advocate's
    # additions number continuously after them.
    _line(doc, "LIST OF DOCUMENTS:")
    _line(doc, "{%p for d in documents %}")
    _line(doc, "{{ loop.index }}. {{ d }};")
    _line(doc, "{%p endfor %}")
    _line(doc, "{%p for d in extra_documents %}")
    _line(doc, "{{ loop.index + standard_document_count }}. {{ d }};")
    _line(doc, "{%p endfor %}")
    _line(doc)
    # --- List of witnesses (book's distinctive s.138-complaint tail) ---
    _line(doc, "LIST OF WITNESSES:")
    # Prefer the fully-assembled `witnesses` list (complainant seeded as CW-1,
    # then bankers, then advocate additions). Fall back to the legacy fixed list
    # for any older context that predates the `witnesses` field. Each witness is
    # its own paragraph (paragraph-tag {%p %}), matching the document list.
    _line(doc, "{%p if witnesses %}")
    _line(doc, "{%p for w in witnesses %}")
    _line(doc, "{{ loop.index }}. {{ w }};")
    _line(doc, "{%p endfor %}")
    _line(doc, "{%p else %}")
    _line(doc, "1. Complainant;")
    _line(doc, "2. Banker(s) of the complainant with record of the cheque;")
    _line(doc, "3. Banker(s) of the accused with record of the cheque;")
    _line(doc, "{%p for w in extra_witnesses %}")
    _line(doc, "{{ loop.index + 3 }}. {{ w }};")
    _line(doc, "{%p endfor %}")
    _line(doc, "{%p endif %}")
    _save(doc, "s138_complaint.docx")


# --------------------------------------------------------------------------
# 4.2 Temporary injunction (O39 R1 & 2)
# --------------------------------------------------------------------------

def build_injunction():
    doc = Document()
    _review_banner(doc)
    _center(doc, "APPLICATION UNDER ORDER XXXIX RULES 1 AND 2 READ WITH "
                 "SECTION 151 OF THE CODE OF CIVIL PROCEDURE, 1908", bold=True)
    _line(doc)
    _center(doc,
            "IN THE COURT OF {% if civil_court %}{{ civil_court }}{% else %}"
            "THE CIVIL JUDGE (SENIOR DIVISION){% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "IN {{ suit_ref }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ applicant.name }}"
          "                          ... APPLICANT / {{ applicant.role|upper }}")
    _center(doc, "VERSUS")
    _line(doc,
          "{% if opposite_party_name %}{{ opposite_party_name }}{% else %}"
          "________________________{% endif %}"
          "                          ... "
          "NON-APPLICANT / {{ opposite_party_role|upper }}")
    _line(doc)
    _center(doc, "APPLICATION UNDER ORDER XXXIX RULES 1 AND 2 READ WITH "
                 "SECTION 151 CPC FOR TEMPORARY INJUNCTION", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. This application arises in the above-noted {{ suit_ref }} concerning "
          "{{ subject_matter }}. The applicant is the {{ applicant.role }} in the "
          "said suit.")
    _line(doc, "2. Brief facts: {{ brief_facts_slot }}")           # LLM
    _line(doc, "{% for limb in triad %}")
    _line(doc, "{{ loop.index + 2 }}. {{ limb.heading }}: {{ limb.text }}")
    _line(doc, "{% endfor %}")
    _line(doc, "6. {{ urgency_conduct }} The applicant has not been guilty of "
               "any delay or laches.")
    _line(doc, "{% if is_ex_parte %}")
    _line(doc,
          "6A. This application is made ex parte. The matter is urgent and notice "
          "to the opposite party would defeat the purpose of this application: "
          "{{ notice_futility }} (proviso to Order XXXIX Rule 3 CPC).")
    _line(doc, "{% endif %}")
    _line(doc, "7. The applicant undertakes to compensate the opposite party in "
               "damages should the injunction be found to have been wrongly "
               "obtained.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc,
          "(a) {{ prayer }}, pending the final disposal of the above-noted suit;")
    _line(doc,
          "{% if is_ex_parte %}(b) grant the said injunction ex parte in the first "
          "instance; and\n(c){% else %}(b){% endif %} pass such other and further "
          "order(s) as may be deemed fit and proper on the facts and in the "
          "circumstances of this case.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("APPLICANT")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if application_date %}{{ application_date }}{% else %}"
               "____________{% endif %}                Advocate")
    _line(doc)
    _line(doc, "[NOTE: This application must be supported by an Affidavit "
               "verifying the facts stated herein.]")
    _save(doc, "injunction.docx")


def _civil_cause_title(doc, doc_title, court_default, p_role="PLAINTIFF",
                       d_role="DEFENDANT", case_word="SUIT"):
    """Shared civil cause-title header (DPC book: plaint, WS, injunction, specific
    performance, ejectment, etc.). A complete self-contained document header;
    optional fields render when present. Parties come from plaintiff/defendants."""
    _center(doc, doc_title, bold=True)
    _line(doc)
    _center(doc,
            "IN THE COURT OF {% if civil_court %}{{ civil_court }}{% else %}"
            + court_default
            + "{% endif %}{% if district %} (DISTRICT {{ district }}){% endif %}"
            + "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, case_word + " NO. ______ OF {{ case_year }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc, "{{ plaintiff.name }}")
    _line(doc, "{% if plaintiff.parentage %}{{ plaintiff.parentage }}{% endif %}")
    _line(doc,
          "{% if plaintiff.address %}R/o {{ plaintiff.address }}{% endif %}"
          "                          ... " + p_role)
    _center(doc, "VERSUS")
    _line(doc,
          "{% for d in defendants %}{{ d.name }}"
          "{% if d.address %}, R/o {{ d.address }}{% endif %}"
          "{% if not loop.last %}; {% endif %}{% endfor %}"
          "                          ... " + d_role
          + "{% if defendants|length > 1 %}S{% endif %}")
    _line(doc)


def build_plaint():
    doc = Document()
    _review_banner(doc)
    _verify_banner(doc)
    _civil_cause_title(doc, "PLAINT", "CIVIL JUDGE (SENIOR DIVISION)")
    _center(doc, "PLAINT UNDER ORDER VII CPC", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc, "1. The plaintiff is {{ plaintiff.name }}.")
    _line(doc,
          "2. The defendant(s): "
          "{% for d in defendants %}{{ d.name }}"
          "{% if not loop.last %}, {% endif %}{% endfor %}.")
    _line(doc, "3. {{ transaction_slot }}")                        # LLM
    _line(doc, "4. The terms agreed between the parties were as pleaded above.")
    _line(doc, "5. {{ performance_slot }}")                        # LLM
    _line(doc, "6. {{ default_slot }}")                            # LLM
    _line(doc,
          "7. Part payments and acknowledgements"
          "{% if limitation_restarted %}, including a written acknowledgement that "
          "restarts limitation,{% endif %} are as pleaded.")
    _line(doc,
          "8. ACCOUNT STATEMENT: principal Rs. {{ principal }}/-, interest "
          "Rs. {{ interest_amount }}/- ({{ interest_basis }}"
          "{% if interest_basis == 'contractual' %} at {{ interest_rate }}% per "
          "annum vide {{ interest_document_ref }}{% endif %}), total claimed "
          "Rs. {{ claimed_total }}/-."
          "{% if interest_fallback_note %} ({{ interest_fallback_note }}.)"
          "{% endif %}")
    _line(doc, "9. {{ notice_slot }}")                             # LLM
    _line(doc,
          "10. CAUSE OF ACTION: the cause of action arose on "
          "{{ cause_of_action_date }} at {{ cause_of_action_place }}.")
    _line(doc,
          "11. JURISDICTION: {{ pecuniary_basis }}. This Court has territorial "
          "jurisdiction under s.20 CPC on the following basis(es): "
          "{% for b in territorial_bases %}{{ b }}"
          "{% if not loop.last %}; {% endif %}{% endfor %}.")
    _line(doc,
          "12. LIMITATION: the suit is within time under Article "
          "{{ limitation_article }} of the Limitation Act 1963; the period "
          "computed from {{ limitation_trigger_date }} expires on "
          "{{ limitation_expiry }}.")
    _line(doc, "{% if is_government_defendant %}")
    _line(doc,
          "12A. A notice under s.80 CPC was issued: {{ s80_notice_ref }}.")
    _line(doc, "{% endif %}")
    _line(doc, "{% if is_commercial_suit %}")
    _line(doc,
          "12B. Pre-institution mediation under s.12A of the Commercial Courts "
          "Act: {{ s12a_ref }}.")
    _line(doc, "{% endif %}")
    _line(doc,
          "13. COURT FEE: the suit is valued at {{ valuation_basis }}; court fee "
          "of Rs. {{ court_fee }}/- is paid.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc, "(a) decree the suit for Rs. {{ claimed_total }}/- in favour of the "
               "plaintiff and against the defendant(s);")
    _line(doc, "(b) award interest and costs of the suit; and")
    _line(doc, "(c) pass such other and further order(s) as may be deemed fit and "
               "proper on the facts and in the circumstances of this case.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PLAINTIFF")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {{ plaint_date }}                    Advocate")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc, "Verified at {{ place }} on this {{ plaint_date }} that the contents "
               "of paras 1 to {{ knowledge_para_last }} are true to my knowledge "
               "and the remaining paras are true on information received and "
               "believed to be true, and the last para is the humble prayer to "
               "this Hon'ble Court.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PLAINTIFF")
    _line(doc)
    _line(doc, "[NOTE: The above plaint must be supported by an Affidavit.]")
    _save(doc, "plaint.docx")


def build_summary_suit():
    doc = Document()
    _review_banner(doc)
    _verify_banner(doc)
    _civil_cause_title(doc, "PLAINT (SUMMARY SUIT UNDER ORDER XXXVII CPC)",
                       "DISTRICT JUDGE")
    _center(doc, "SUIT UNDER ORDER XXXVII OF THE CODE OF CIVIL PROCEDURE, 1908",
            bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. This suit is filed under Order XXXVII of the Code of Civil "
          "Procedure. The claim arises on a {{ claim_basis }}"
          "{% if instrument_ref %} ({{ instrument_ref }}){% endif %}.")
    _line(doc,
          "2. No relief is claimed in this suit that falls outside the scope of "
          "Order XXXVII.")
    _line(doc, "3. The plaintiff is {{ plaintiff.name }}.")
    _line(doc,
          "4. The defendant(s): "
          "{% for d in defendants %}{{ d.name }}"
          "{% if not loop.last %}, {% endif %}{% endfor %}.")
    _line(doc, "5. {{ transaction_slot }}")                        # LLM
    _line(doc,
          "6. ACCOUNT STATEMENT: principal Rs. {{ principal }}/-, interest "
          "Rs. {{ interest_amount }}/- ({{ interest_basis }}), total claimed "
          "Rs. {{ claimed_total }}/-."
          "{% if interest_fallback_note %} ({{ interest_fallback_note }}.)"
          "{% endif %}")
    _line(doc,
          "7. CAUSE OF ACTION: the cause of action arose on "
          "{{ cause_of_action_date }} at {{ cause_of_action_place }}.")
    _line(doc,
          "8. JURISDICTION: {{ pecuniary_basis }}. Territorial jurisdiction under "
          "s.20 CPC: "
          "{% for b in territorial_bases %}{{ b }}"
          "{% if not loop.last %}; {% endif %}{% endfor %}.")
    _line(doc,
          "9. LIMITATION: within time under Article {{ limitation_article }} of "
          "the Limitation Act 1963; the period from {{ limitation_trigger_date }} "
          "expires on {{ limitation_expiry }}.")
    _line(doc,
          "10. COURT FEE: valued at {{ valuation_basis }}; court fee of "
          "Rs. {{ court_fee }}/- is paid.")
    _line(doc,
          "11. Upon institution, the plaintiff shall serve summons for judgment "
          "in the prescribed form. The defendant shall not be entitled to defend "
          "the suit unless leave to defend is granted by this Hon'ble Court.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc, "(a) decree the suit for Rs. {{ claimed_total }}/- with interest in "
               "favour of the plaintiff and against the defendant(s);")
    _line(doc, "(b) award pendente lite and future interest and costs of the suit; "
               "and")
    _line(doc, "(c) pass such other and further order(s) as may be deemed fit and "
               "proper on the facts and in the circumstances of this case.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PLAINTIFF")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {{ plaint_date }}                    Advocate")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc, "Verified at {{ place }} on this {{ plaint_date }} that the contents "
               "of paras 1 to {{ knowledge_para_last }} are true to my knowledge "
               "and the remaining paras are true on information received and "
               "believed to be true, and the last para is the humble prayer to "
               "this Hon'ble Court.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PLAINTIFF")
    _line(doc)
    _line(doc, "[NOTE: The above plaint must be supported by an Affidavit.]")
    _save(doc, "summary_suit.docx")


def build_writ_petition():
    doc = Document()
    _review_banner(doc)
    _center(doc, "IN THE HIGH COURT OF {{ court_place|upper }}"
                 "{% if court_side %} ({{ court_side }}){% endif %}", bold=True)
    _center(doc, "CIVIL WRIT PETITION NO. ______ OF {{ verification.year }}")
    _center(doc, "(PETITION UNDER ARTICLE 226 OF THE CONSTITUTION OF INDIA)",
            bold=True)
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ petitioner.name }}"
          "                          ... PETITIONER")
    _center(doc, "VERSUS")
    _line(doc,
          "{% for r in respondents %}{{ r.serial }}. {{ r.name }}"
          "{% if r.is_authority %} (through its authority){% endif %}"
          "{% if not loop.last %}\n{% endif %}{% endfor %}"
          "                          ... RESPONDENT"
          "{% if respondents|length > 1 %}S{% endif %}")
    _line(doc)
    _center(doc, "PETITION UNDER ARTICLE 226 OF THE CONSTITUTION OF INDIA",
            bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. The petitioner, {{ petitioner.name }}, has the locus standi to "
          "maintain this petition.")
    _line(doc,
          "2. The respondent(s): "
          "{% for r in respondents %}({{ r.serial }}) {{ r.name }}"
          "{% if r.is_authority %} [State / public authority]{% endif %}"
          "{% if not loop.last %}; {% endif %}{% endfor %}.")
    _line(doc, "3. {{ facts_slot }}")                             # LLM
    _line(doc,
          "4. IMPUGNED ACTION: "
          "{% if impugned_order_number and impugned_order_number != 'N/A' %}"
          "{{ impugned_order_number }} dated {{ impugned_order_date }}, annexed "
          "hereto{% else %}the action complained of, as set out above{% endif %}.")
    _line(doc, "5. The petitioner made representation and the response, if any, is "
               "as set out above.")
    _line(doc, "6. GROUNDS:")
    _line(doc, "{% if lettered_grounds %}")                       # lettered by code
    _line(doc, "{% for g in lettered_grounds %}")
    _line(doc, "   {{ g.letter }}. {{ g.text }}")
    _line(doc, "{% endfor %}")
    _line(doc, "{% else %}")
    _line(doc, "   {{ grounds_slot }}")                           # LLM (self-lettered)
    _line(doc, "{% endif %}")
    _line(doc, "{% if writ_type == 'mandamus' %}")
    _line(doc,
          "6A. The petitioner has a legal right ({{ legal_right }}); the respondent "
          "is under a corresponding public duty ({{ public_duty }}); and a prior "
          "demand was made and refused ({{ prior_demand_and_refusal }}).")
    _line(doc, "{% endif %}")
    _line(doc, "{% if writ_type == 'certiorari' %}")
    _line(doc, "6A. The order sought to be quashed is a quasi-judicial order: "
               "{{ quasi_judicial_order }}.")
    _line(doc, "{% endif %}")
    _line(doc, "{% if writ_type == 'quo_warranto' %}")
    _line(doc, "6A. The public office in question is {{ public_office }}.")
    _line(doc, "{% endif %}")
    _line(doc,
          "7. ALTERNATIVE REMEDY: {{ alternative_remedy_basis }}.")
    _line(doc, "{% if delay_explanation %}")
    _line(doc, "8. DELAY AND LACHES: {{ delay_explanation }}.")
    _line(doc, "{% endif %}")
    _line(doc,
          "9. No other petition on the same cause of action has been filed before "
          "this Hon'ble Court or the Hon'ble Supreme Court.")
    _line(doc, "10. INTERIM PRAYER: as set out in the accompanying application.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc,
          "(a) issue a Writ of {{ writ_type|replace('_', ' ') }}, or any other "
          "appropriate writ, order or direction, "
          "{% if impugned_order_number and impugned_order_number != 'N/A' %}"
          "quashing {{ impugned_order_number }} dated {{ impugned_order_date }}, "
          "{% endif %}and granting relief to the petitioner;")
    _line(doc,
          "(b) grant interim relief as prayed in the accompanying application; and")
    _line(doc,
          "(c) pass such other and further order(s) as may be deemed fit and "
          "proper on the facts and in the circumstances of this case.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {{ verification.day }} {{ verification.month }} "
               "{{ verification.year }}          Advocate")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc,
          "Verified at {{ verification.place }} on this {{ verification.day }} day "
          "of {{ verification.month }}, {{ verification.year }} that the contents "
          "of paras {{ verification.knowledge_paras }} of the petition are true to "
          "my knowledge and the last para is the humble prayer to this Hon'ble "
          "Court. It is further declared that no other petition on the same cause "
          "of action has been filed by the petitioner before this Hon'ble Court or "
          "the Hon'ble Supreme Court of India.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc)
    _line(doc, "[NOTE: This petition must be supported by an Affidavit and "
               "accompanied by the requisite court fee.]")
    _save(doc, "writ_petition.docx")


def build_maintenance():
    doc = Document()
    _review_banner(doc)
    _verify_banner(doc)
    _center(doc,
            "IN THE COURT OF {% if magistrate_court %}{{ magistrate_court }}"
            "{% else %}THE JUDICIAL MAGISTRATE / FAMILY COURT{% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "MAINTENANCE PETITION NO. ______ OF "
                 "{% if petition_year %}{{ petition_year }}{% else %}______"
                 "{% endif %}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ petitioner.name }}"
          "                          ... PETITIONER")
    _center(doc, "VERSUS")
    _line(doc,
          "{{ respondent.name }}"
          "                          ... RESPONDENT")
    _line(doc)
    _center(doc, "PETITION FOR MAINTENANCE UNDER {{ maintenance_section|upper }}",
            bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. The petitioner {{ petitioner.name }} is the {{ relationship|replace('_', ' ') }} "
          "of the respondent {{ respondent.name }}.")
    _line(doc, "2. The particulars of the marriage / parentage are as set out herein.")
    _line(doc, "3. {{ neglect_slot }}")                           # LLM
    _line(doc, "4. The respondent has sufficient means: {{ respondent_means }}.")
    _line(doc, "5. The petitioner is unable to maintain herself: {{ petitioner_inability }}.")
    _line(doc,
          "6. The maintenance sought is Rs. {{ quantum }}/- per month. Basis: "
          "{{ quantum_basis }}. {{ quantum_slot }}")               # LLM
    _line(doc, "{% if relationship == 'divorced_wife' %}")
    _line(doc, "6A. The petitioner has not remarried.")
    _line(doc, "{% endif %}")
    _line(doc, "7. Standard of living during cohabitation is as set out herein.")
    _line(doc, "8. JURISDICTION: {{ jurisdiction_basis }}.")
    _line(doc,
          "9. The petitioner's affidavit of assets and liabilities "
          "(Rajnesh v. Neha) is filed herewith.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc,
          "(a) direct the respondent to pay maintenance to the petitioner at "
          "Rs. {{ quantum }}/- per month;")
    _line(doc,
          "(b) direct the respondent to pay interim maintenance during the pendency "
          "of this petition and the arrears of maintenance;")
    _line(doc, "(c) award the costs of this petition; and")
    _line(doc,
          "(d) pass such other and further order(s) as may be deemed fit and "
          "proper on the facts and in the circumstances of this case.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}                   Advocate")
    _line(doc)
    _line(doc, "[NOTE: This petition must be supported by an Affidavit and the "
               "petitioner's affidavit of assets and liabilities.]")
    _save(doc, "maintenance.docx")


def build_dv_application():
    doc = Document()
    _review_banner(doc)
    _center(doc,
            "IN THE COURT OF {% if magistrate_court %}{{ magistrate_court }}"
            "{% else %}THE JUDICIAL MAGISTRATE OF THE FIRST CLASS / "
            "METROPOLITAN MAGISTRATE{% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "APPLICATION NO. ______ OF "
                 "{% if application_year %}{{ application_year }}{% else %}______"
                 "{% endif %}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ aggrieved.name }}"
          "                          ... AGGRIEVED PERSON / APPLICANT")
    _center(doc, "VERSUS")
    _line(doc,
          "{{ respondent.name }}"
          "                          ... RESPONDENT")
    _line(doc)
    _center(doc, "APPLICATION UNDER SECTION 12 OF THE PROTECTION OF WOMEN FROM "
                 "DOMESTIC VIOLENCE ACT, 2005", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc, "1. The aggrieved person is {{ aggrieved.name }}.")
    _line(doc,
          "2. The respondent is {{ respondent.name }}. The domestic relationship is "
          "established: {{ domestic_relationship_basis }}.")
    _line(doc, "{% if shared_household_pleaded %}")
    _line(doc, "3. SHARED HOUSEHOLD: {{ shared_household_particulars }}.")
    _line(doc, "{% endif %}")
    _line(doc, "4. DOMESTIC INCIDENTS: {{ incidents_slot }}")     # LLM
    _line(doc, "{% for i in incidents %}")
    _line(doc,
          "   - [{{ i.category|replace('_', ' ') }}]"
          "{% if i.date %} on {{ i.date }}{% endif %}: {{ i.description }}.")
    _line(doc, "{% endfor %}")
    _line(doc, "5. RELIEFS SOUGHT:")
    _line(doc, "{% for r in reliefs %}")
    _line(doc, "   ({{ loop.index }}) {{ r.head }} — {{ r.averment }}.")
    _line(doc, "{% endfor %}")
    _line(doc, "6. Interim relief under s.23 is sought pending disposal.")
    _line(doc, "7. JURISDICTION: {{ jurisdiction_basis }}.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc,
          "(a) grant the reliefs set out in para 5 above under the relevant "
          "provisions of the Protection of Women from Domestic Violence Act, 2005;")
    _line(doc,
          "(b) grant interim and ex parte relief under s.23 of the said Act pending "
          "disposal of this application; and")
    _line(doc,
          "(c) pass such other and further order(s) as may be deemed fit and "
          "proper on the facts and in the circumstances of this case.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("APPLICANT / AGGRIEVED PERSON")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if application_date %}{{ application_date }}{% else %}"
               "____________{% endif %}                Advocate / "
               "Protection Officer")
    _line(doc)
    _line(doc, "[NOTE: This application must be supported by an Affidavit "
               "(Form III, DV Rules) verifying the domestic incidents.]")
    _save(doc, "dv_application.docx")


def build_consumer_complaint():
    doc = Document()
    _review_banner(doc)
    _verify_banner(doc)
    _center(doc,
            "BEFORE THE {{ forum_tier_label|upper }} CONSUMER DISPUTES REDRESSAL "
            "COMMISSION{% if commission_place %}, {{ commission_place }}"
            "{% endif %}", bold=True)
    _center(doc, "CONSUMER COMPLAINT NO. ______ OF {{ complaint_year }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ complainant.name }}"
          "                          ... COMPLAINANT")
    _center(doc, "VERSUS")
    _line(doc,
          "{{ opposite_party.name }}"
          "                          ... OPPOSITE PARTY")
    _line(doc)
    _center(doc, "COMPLAINT UNDER SECTION 35 OF THE CONSUMER PROTECTION ACT, 2019",
            bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. The complainant {{ complainant.name }} is a 'consumer' within the "
          "meaning of s.2(7) of the Act.")
    _line(doc, "2. The opposite party is {{ opposite_party.name }}, a trader / "
               "service provider.")
    _line(doc,
          "3. TRANSACTION: on {{ transaction_date }} the complainant paid "
          "consideration of Rs. {{ consideration_paid }}/- ({{ invoice_ref }}).")
    _line(doc, "4. {{ defect_slot }}")                            # LLM
    _line(doc, "5. {{ complaints_slot }}")                        # LLM
    _line(doc, "6. The complainant has suffered loss, injury and mental agony.")
    _line(doc, "7. CAUSE OF ACTION arose on {{ cause_of_action_date }}.")
    _line(doc,
          "8. JURISDICTION: this is a matter for the {{ forum_tier_label }} "
          "Commission (pecuniary, by the consideration of Rs. "
          "{{ consideration_paid }}/-); {{ territorial_basis }}.")
    _line(doc,
          "9. LIMITATION: the complaint is within two years of the cause of action."
          "{% if condonation_required %} As the two-year period is exceeded, an "
          "application for condonation of delay is filed along with this complaint."
          "{% endif %}")
    _line(doc,
          "10. RELIEF: refund / replacement / repair as appropriate"
          "{% if compensation > 0 %}, and compensation of Rs. {{ compensation }}/- "
          "({{ compensation_basis }}){% endif %}, with costs.")
    _line(doc,
          "11. The complaint is supported by an affidavit and an evidence "
          "affidavit, filed herewith.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Commission "
          "may be pleased to:")
    _line(doc,
          "(a) direct the opposite party to refund / replace / repair as "
          "appropriate and to make good the deficiency in service / defect;")
    _line(doc,
          "{% if compensation > 0 %}(b) award compensation of Rs. "
          "{{ compensation }}/- ({{ compensation_basis }}) for the loss, injury and "
          "mental agony suffered by the complainant;\n(c){% else %}(b){% endif %} "
          "award the costs of this complaint; and")
    _line(doc,
          "{% if compensation > 0 %}(d){% else %}(c){% endif %} pass such other and "
          "further order(s) as may be deemed fit and proper on the facts and in the "
          "circumstances of this case.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("COMPLAINANT")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {{ complaint_date }}                  Advocate")
    _line(doc)
    _line(doc, "[NOTE: This complaint must be supported by an Affidavit and an "
               "evidence affidavit, and accompanied by the prescribed fee.]")
    _save(doc, "consumer_complaint.docx")


def build_mact_claim():
    doc = Document()
    _review_banner(doc)
    _center(doc,
            "BEFORE THE MOTOR ACCIDENTS CLAIMS TRIBUNAL"
            "{% if tribunal_place %}, {{ tribunal_place }}{% endif %}", bold=True)
    _center(doc, "M.A.C.T. CLAIM PETITION NO. ______ OF "
                 "{% if petition_year %}{{ petition_year }}{% else %}______"
                 "{% endif %}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{% for c in claimants %}{{ loop.index }}. {{ c }}"
          "{% if not loop.last %}\n{% endif %}{% endfor %}"
          "                          ... CLAIMANT"
          "{% if claimants|length > 1 %}S{% endif %}")
    _center(doc, "VERSUS")
    _line(doc,
          "1. {{ vehicle.owner }} (owner)\n"
          "2. {{ vehicle.driver }} (driver)\n"
          "3. {{ vehicle.insurer }} (insurer)"
          "                          ... RESPONDENTS")
    _line(doc)
    _center(doc, "CLAIM PETITION UNDER SECTION 166 OF THE MOTOR VEHICLES ACT, 1988",
            bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. The claimant(s): "
          "{% for c in claimants %}{{ c }}{% if not loop.last %}, {% endif %}"
          "{% endfor %}, being the {% if claim_kind == 'death' %}dependants of the "
          "deceased{% else %}injured / on behalf of the injured{% endif %}.")
    _line(doc, "2. {{ accident_slot }}")                          # LLM
    _line(doc,
          "3. The accident on {{ accident_date }} was caused by the rash and "
          "negligent driving of the offending vehicle.")
    _line(doc, "4. FIR and police proceedings: {{ fir_ref }}.")
    _line(doc,
          "5. Vehicle {{ vehicle.number }}; owner {{ vehicle.owner }}; driver "
          "{{ vehicle.driver }}; insurer {{ vehicle.insurer }} (policy "
          "{{ vehicle.policy_no }}).")
    _line(doc, "{% if policy_addressed %}")
    _line(doc,
          "5A. The insurance policy was not valid/subsisting on the date of the "
          "accident. The claim is nonetheless maintainable against the owner and "
          "driver, who are jointly and severally liable.")
    _line(doc, "{% endif %}")
    _line(doc,
          "6. Victim: aged {{ victim.age }}, {{ victim.employment|replace('_', ' ') }}, "
          "annual income Rs. {{ victim.annual_income }}/-."
          "{% if not income_established %} {{ income_note }}.{% endif %}")
    _line(doc, "7. COMPUTATION {{ unverified_marker }}:")
    _line(doc, "{% if computation.kind == 'death' %}")
    _line(doc,
          "   Multiplicand Rs. {{ computation.multiplicand }}/- x multiplier "
          "{{ computation.multiplier }} = loss of dependency Rs. "
          "{{ computation.loss_of_dependency }}/-.")
    _line(doc, "   Conventional heads:")
    _line(doc, "{% for h in computation.conventional_heads %}")
    _line(doc, "     - {{ h.name|replace('_', ' ') }}: Rs. {{ h.amount }}/-.")
    _line(doc, "{% endfor %}")
    _line(doc, "   ({{ computation.enhancement_note }}.)")
    _line(doc, "{% else %}")
    _line(doc,
          "   Loss of earning capacity Rs. {{ computation.loss_of_earning_capacity }}/-; "
          "treatment Rs. {{ computation.treatment_expenses }}/-; attendant Rs. "
          "{{ computation.attendant_expenses }}/-.")
    _line(doc, "{% endif %}")
    _line(doc, "   TOTAL Rs. {{ computation.total }}/-.")
    _line(doc, "8. JURISDICTION: {{ jurisdiction_basis }}.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Tribunal "
          "may be pleased to:")
    _line(doc,
          "(a) award compensation of Rs. {{ claimed_total }}/- "
          "{% if unverified_marker %}{{ unverified_marker }} {% endif %}"
          "to the claimant(s), jointly and severally against the respondents;")
    _line(doc, "(b) award interest on the said amount from the date of the "
               "petition till realisation, and the costs of this petition; and")
    _line(doc,
          "(c) pass such other and further order(s) as may be deemed fit and "
          "proper on the facts and in the circumstances of this case.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("CLAIMANT(S)")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}                   Advocate")
    _line(doc)
    _line(doc, "[NOTE: This petition must be supported by an Affidavit and "
               "accompanied by the FIR, the charge sheet and proof of income.]")
    _save(doc, "mact_claim.docx")


def build_divorce_contested():
    doc = Document()
    _review_banner(doc)
    _center(doc,
            "IN THE COURT OF {% if family_court %}{{ family_court }}{% else %}"
            "THE PRINCIPAL JUDGE, FAMILY COURT{% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "HINDU MARRIAGE PETITION NO. ______ OF "
                 "{% if petition_year %}{{ petition_year }}{% else %}______"
                 "{% endif %}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ petitioner.name }}"
          "                          ... PETITIONER")
    _center(doc, "VERSUS")
    _line(doc,
          "{{ respondent.name }}"
          "                          ... RESPONDENT")
    _line(doc)
    _center(doc, "PETITION FOR DISSOLUTION OF MARRIAGE BY A DECREE OF DIVORCE "
                 "UNDER SECTION 13 OF THE HINDU MARRIAGE ACT, 1955", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. The marriage between the petitioner {{ petitioner.name }} and the "
          "respondent {{ respondent.name }} was solemnised on {{ marriage_date }} "
          "at {{ marriage_place }}.")
    _line(doc, "2. Residence post-marriage and the matrimonial home are as set "
               "out herein.")
    _line(doc, "{% if children %}")
    _line(doc,
          "3. Children of the marriage: "
          "{% for c in children %}{{ c }}{% if not loop.last %}, {% endif %}"
          "{% endfor %}. Custody: {{ custody_position }}. Maintenance: "
          "{{ maintenance_position }}.")
    _line(doc, "{% endif %}")
    _line(doc, "4. The date of separation and the status of the parties are as "
               "set out herein.")
    _line(doc, "5. {{ grounds_slot }}")                           # LLM
    _line(doc, "6. GROUND under s.13(1) — {{ ground }}:")
    _line(doc, "{% if ground == 'cruelty' %}")
    _line(doc, "{% for i in cruelty_instances %}")
    _line(doc, "   - On {{ i.date }}: {{ i.description }}.")
    _line(doc, "{% endfor %}")
    _line(doc, "{% endif %}")
    _line(doc, "{% if ground == 'desertion' %}")
    _line(doc,
          "   The parties have lived separately since {{ separation_since }} "
          "({{ separation_years }} years), with animus deserendi, without the "
          "petitioner's consent and without reasonable cause.")
    _line(doc, "{% endif %}")
    _line(doc, "{% if ground == 'adultery' %}")
    _line(doc, "   {{ adultery_instance }}."
               "{% if not co_respondent_joined %} The co-respondent is not joined: "
               "{{ non_joinder_reason }}.{% endif %}")
    _line(doc, "{% endif %}")
    _line(doc,
          "7. There is no collusion, connivance or condonation between the parties.")
    _line(doc, "8. There are no prior proceedings between the parties, save as "
               "stated herein.")
    _line(doc, "9. JURISDICTION under s.19 HMA: {{ jurisdiction_basis|replace('_', ' ') }}.")
    _line(doc, "{% if leave_required %}")
    _line(doc,
          "10. As the petition is presented within one year of the marriage, an "
          "application for leave under the proviso to s.14 HMA is filed along with "
          "this petition.")
    _line(doc, "{% endif %}")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc,
          "(a) pass a decree of divorce under s.13 of the Hindu Marriage Act, 1955 "
          "dissolving the marriage between the petitioner and the respondent "
          "solemnised on {{ marriage_date }};")
    _line(doc, "(b) award the costs of this petition; and")
    _line(doc,
          "(c) pass such other and further order(s) as may be deemed fit and "
          "proper on the facts and in the circumstances of this case.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}                   Advocate")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc,
          "Verified at {{ place }} on this {% if petition_date %}{{ petition_date }}"
          "{% else %}____________{% endif %} that the contents of paras 1 to 9 are "
          "true to my knowledge and paras 10 to 11, if any, are true on legal "
          "advice received and believed to be true, and the last para is the humble "
          "prayer to this Hon'ble Court.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc)
    _line(doc, "[NOTE: This petition must be supported by an Affidavit verifying "
               "the facts stated herein.]")
    _save(doc, "divorce_contested.docx")


def build_divorce_mutual_first():
    doc = Document()
    _review_banner(doc)
    _center(doc,
            "IN THE COURT OF {% if family_court %}{{ family_court }}{% else %}"
            "THE PRINCIPAL JUDGE, FAMILY COURT{% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "HINDU MARRIAGE PETITION NO. ______ OF "
                 "{% if petition_year %}{{ petition_year }}{% else %}______"
                 "{% endif %}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "1. {{ party_a }}\n2. {{ party_b }}"
          "                          ... PETITIONERS")
    _line(doc)
    _center(doc, "JOINT PETITION FOR DISSOLUTION OF MARRIAGE BY A DECREE OF DIVORCE "
                 "BY MUTUAL CONSENT UNDER SECTION 13B OF THE HINDU MARRIAGE ACT, "
                 "1955 — FIRST MOTION", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. The marriage between {{ party_a }} and {{ party_b }} was solemnised "
          "on {{ marriage_date }} at {{ marriage_place }}.")
    _line(doc,
          "2. The parties have been living separately since "
          "{{ living_separately_since }}, a period of one year or more.")
    _line(doc, "3. The parties have not been able to live together.")
    _line(doc,
          "4. The parties have freely and mutually agreed that the marriage should "
          "be dissolved.")
    _line(doc, "5. SETTLEMENT:")
    _line(doc, "   - Maintenance / alimony: {{ settlement.maintenance }}.")
    _line(doc, "   - Custody: {{ settlement.custody }}.")
    _line(doc, "   - Property / streedhan: {{ settlement.property }}.")
    _line(doc, "6. The consent is free and without coercion, fraud or undue "
               "influence.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc,
          "(a) record the statements of the parties on this first motion under "
          "s.13B(1) of the Hindu Marriage Act, 1955; and")
    _line(doc,
          "(b) pass such other and further order(s) as may be deemed fit and "
          "proper on the facts and in the circumstances of this case.")
    _line(doc)
    _line(doc, "Place: {{ place }}")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}")
    _line(doc)
    _line(doc,
          "Verified and affirmed jointly by {% for d in deponents %}{{ d }}"
          "{% if not loop.last %} and {% endif %}{% endfor %} as deponents, at "
          "{{ place }}.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER NO. 1                    PETITIONER NO. 2")
    _line(doc)
    _line(doc, "[NOTE: This joint petition must be supported by a joint Affidavit "
               "of both parties.]")
    _save(doc, "divorce_mutual_first.docx")


def build_divorce_mutual_second():
    doc = Document()
    _review_banner(doc)
    _center(doc,
            "IN THE COURT OF {% if family_court %}{{ family_court }}{% else %}"
            "THE PRINCIPAL JUDGE, FAMILY COURT{% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "HINDU MARRIAGE PETITION NO. ______ OF "
                 "{% if petition_year %}{{ petition_year }}{% else %}______"
                 "{% endif %}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "1. {{ party_a }}\n2. {{ party_b }}"
          "                          ... PETITIONERS")
    _line(doc)
    _center(doc, "JOINT PETITION FOR DISSOLUTION OF MARRIAGE BY A DECREE OF DIVORCE "
                 "BY MUTUAL CONSENT UNDER SECTION 13B OF THE HINDU MARRIAGE ACT, "
                 "1955 — SECOND MOTION", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. This second motion is in continuation of the first-motion order "
          "dated {{ first_motion_order_date }}, between {{ party_a }} and "
          "{{ party_b }}.")
    _line(doc, "2. The parties reaffirm their free and mutual consent to the "
               "dissolution of the marriage.")
    _line(doc,
          "3. Compliance with the settlement terms: "
          "{% if settlement_implemented %}the settlement has been implemented"
          "{% else %}the settlement is being implemented as recorded{% endif %}.")
    _line(doc, "{% if waiver_attached %}")
    _line(doc,
          "3A. An application for waiver of the cooling-off period under Amardeep "
          "Singh v. Harveen Kaur is filed, the settlement having already been "
          "implemented.")
    _line(doc, "{% endif %}")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may "
          "be pleased to:")
    _line(doc,
          "(a) pass a decree of divorce by mutual consent under s.13B(2) of the "
          "Hindu Marriage Act, 1955, dissolving the marriage between the parties; "
          "and")
    _line(doc,
          "(b) pass such other and further order(s) as may be deemed fit and "
          "proper on the facts and in the circumstances of this case.")
    _line(doc)
    _line(doc, "Place: {{ place }}")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER NO. 1                    PETITIONER NO. 2")
    _line(doc)
    _line(doc, "[NOTE: This joint petition must be supported by a joint Affidavit "
               "of both parties.]")
    _save(doc, "divorce_mutual_second.docx")


# ==========================================================================
# BATCH 3 — new pleadings from the DPC book (verbatim structure).
# ==========================================================================

def _prayer_closer(doc, letter):
    """The book's standard last prayer clause, as a complete lettered clause."""
    _line(doc,
          "(" + letter + ") pass such other and further order(s) as may be deemed "
          "fit and proper on the facts and in the circumstances of this case.")


def _signature_block(doc, role, date_field="date"):
    """The book's signature block: role (right), Place/Through, Date/Advocate."""
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run(role)
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if " + date_field + " %}{{ " + date_field + " }}"
               "{% else %}____________{% endif %}                Advocate")


def _matrimonial_cause_title(doc, doc_title, section_heading):
    """Family-court cause-title shared by RCR + judicial separation (book pp.40-43).
    Petitioner (husband/wife) VERSUS Respondent, HMA petition no."""
    _center(doc, doc_title, bold=True)
    _line(doc)
    _center(doc,
            "IN THE COURT OF {% if family_court %}{{ family_court }}{% else %}"
            "THE PRINCIPAL JUDGE, FAMILY COURT{% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "HMA PETITION NO. ______ OF {{ petition_year }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc, "{{ petitioner.name }}")
    _line(doc, "{% if petitioner.parentage %}{{ petitioner.parentage }}{% endif %}")
    _line(doc,
          "{% if petitioner.address %}R/o {{ petitioner.address }}{% endif %}"
          "                          ... PETITIONER")
    _center(doc, "VERSUS")
    _line(doc, "{{ respondent.name }}")
    _line(doc, "{% if respondent.parentage %}{{ respondent.parentage }}{% endif %}")
    _line(doc,
          "{% if respondent.address %}R/o {{ respondent.address }}{% endif %}"
          "                          ... RESPONDENT")
    _line(doc)
    _center(doc, section_heading, bold=True)
    _line(doc)


def _matrimonial_verification(doc):
    """The book's matrimonial verification: 'states on solemn affirmation'
    (pp.41, 43, 46)."""
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc,
          "The above-named petitioner states on solemn affirmation that the contents "
          "of paras 1 to {{ knowledge_para_last | default(9) }} of the petition are "
          "true to the petitioner's knowledge and the remaining paras are true to the "
          "petitioner's information received and believed to be true.")
    _line(doc, "Verified at {{ place }} on this "
               "{% if petition_date %}{{ petition_date }}{% else %}____________"
               "{% endif %}.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc)
    _line(doc, "[NOTE: An affidavit of the petitioner is to be appended.]")


def build_permanent_injunction():
    doc = Document()
    _review_banner(doc)
    _civil_cause_title(doc, "SUIT FOR PERMANENT INJUNCTION",
                       "CIVIL JUDGE (SENIOR DIVISION)")
    _center(doc, "SUIT FOR PERMANENT INJUNCTION", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That the plaintiff is in settled possession of the suit property, "
          "namely {{ suit_property }}. Basis of possession: {{ possession_basis }}.")
    _line(doc, "2. {{ threat_slot }}")                            # LLM
    _line(doc,
          "3. That the plaintiff has no other efficacious remedy except to approach "
          "this Hon'ble Court for the relief of injunction against the defendant(s).")
    _line(doc,
          "4. That the cause of action arose on {{ cause_of_action_date }} at "
          "{{ cause_of_action_place }}, when the defendant(s) threatened to disturb "
          "the plaintiff's possession, and is a continuing one.")
    _line(doc,
          "5. That the value of this suit for the purposes of court fee and "
          "jurisdiction is {{ valuation }}, on which a court fee of "
          "Rs. {{ court_fee }}/- is paid.")
    _line(doc,
          "6. That this Hon'ble Court has jurisdiction to entertain this suit: "
          "{{ jurisdiction_basis }}.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may be "
          "pleased to:")
    _line(doc,
          "(a) pass a decree for permanent injunction in favour of the plaintiff and "
          "against the defendant(s), their representatives, employees and agents, "
          "restraining them from {{ act_restrained }};")
    _line(doc, "(b) award the costs of the suit; and")
    _prayer_closer(doc, "c")
    _line(doc)
    _signature_block(doc, "PLAINTIFF", "suit_date")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc,
          "Verified at {{ place }} on this "
          "{% if suit_date %}{{ suit_date }}{% else %}____________{% endif %} that "
          "the contents of paras 1 to {{ knowledge_para_last }} of the plaint are "
          "true to my knowledge and the remaining paras are true on information "
          "received and believed to be true, and the last para is the humble prayer "
          "to this Hon'ble Court.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PLAINTIFF")
    _line(doc)
    _line(doc, "[NOTE: This plaint has to be supported by an affidavit.]")
    _save(doc, "permanent_injunction.docx")


def build_specific_performance():
    doc = Document()
    _review_banner(doc)
    _civil_cause_title(doc, "SUIT FOR SPECIFIC PERFORMANCE OF CONTRACT",
                       "CIVIL JUDGE (SENIOR DIVISION)")
    _center(doc, "SUIT FOR SPECIFIC PERFORMANCE OF CONTRACT", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc, "1. That the plaintiff is {{ plaintiff.name }}.")
    _line(doc,
          "2. That the defendant is the absolute owner of the property bearing "
          "{{ suit_property }} (hereinafter referred to as the suit property).")
    _line(doc,
          "3. That on {{ agreement_date }} the plaintiff and the defendant entered "
          "into an agreement in writing ({{ agreement_ref }}) whereby the defendant "
          "agreed to sell the suit property to the plaintiff for "
          "Rs. {{ total_consideration }}/-.")
    _line(doc,
          "4. That the plaintiff paid Rs. {{ earnest_paid }}/- to the defendant as "
          "earnest money, and the balance of Rs. {{ balance_amount }}/- was to be "
          "paid at the time of execution of the sale deed.")
    _line(doc, "5. {{ refusal_slot }}")                          # LLM
    _line(doc,
          "6. That the plaintiff finally issued a legal notice ({{ notice_ref }}) "
          "calling upon the defendant to perform his part of the agreement by "
          "executing the sale deed, to which the defendant failed to comply.")
    _line(doc,
          "7. That the plaintiff is ready and willing to perform his part of the "
          "agreement by paying the balance amount (s.16(c) of the Specific Relief "
          "Act, 1963).")
    _line(doc,
          "8. That the cause of action arose on {{ cause_of_action_date }} at "
          "{{ cause_of_action_place }} and is still subsisting as the defendant has "
          "refused to perform his part of the agreement.")
    _line(doc, "9. That the suit is within the period of limitation.")
    _line(doc,
          "10. That this Hon'ble Court has jurisdiction to entertain this suit as the "
          "cause of action arose within its territorial jurisdiction.")
    _line(doc, "11. That the requisite court fee of Rs. {{ court_fee }}/- has been "
               "paid.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may be "
          "pleased to:")
    _line(doc,
          "(a) pass a decree of specific performance of the agreement in favour of "
          "the plaintiff and against the defendant, directing the defendant to "
          "execute the sale deed and hand over possession of the suit property to the "
          "plaintiff;")
    _line(doc, "(b) award the costs of the suit; and")
    _prayer_closer(doc, "c")
    _line(doc)
    _signature_block(doc, "PLAINTIFF", "suit_date")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc,
          "Verified at {{ place }} on this "
          "{% if suit_date %}{{ suit_date }}{% else %}____________{% endif %} that "
          "the contents of paras 1 to {{ knowledge_para_last }} of the plaint are "
          "true to my knowledge and the remaining paras are true on information "
          "received and believed to be true, and the last para is the humble prayer "
          "to this Hon'ble Court.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PLAINTIFF")
    _line(doc)
    _line(doc, "[NOTE: The above plaint must be supported by an Affidavit.]")
    _save(doc, "specific_performance.docx")


def build_ejectment():
    doc = Document()
    _review_banner(doc)
    _center(doc, "SUIT FOR EJECTMENT AND DAMAGES FOR WRONGFUL USE AND OCCUPATION",
            bold=True)
    _line(doc)
    _center(doc,
            "BEFORE THE {% if civil_court %}{{ civil_court }}{% else %}"
            "CIVIL JUDGE (SENIOR DIVISION){% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "SUIT NO. ______ OF {{ case_year }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{% for p in plaintiffs %}{{ p }}{% if not loop.last %}\n{% endif %}"
          "{% endfor %}"
          "{% if plaintiff_address %}\nR/o {{ plaintiff_address }}{% endif %}"
          "                          ... PLAINTIFF"
          "{% if plaintiffs|length > 1 %}S{% endif %}")
    _center(doc, "VERSUS")
    _line(doc,
          "{{ defendant.name }}"
          "{% if defendant.address %}, {{ defendant.address }}{% endif %}"
          "                          ... DEFENDANT")
    _line(doc)
    _center(doc, "SUIT FOR EJECTMENT AND DAMAGES FOR WRONGFUL USE AND OCCUPATION",
            bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That the plaintiff(s), being the owner(s) of {{ suit_premises }}, let "
          "out the said premises to the defendant vide {{ lease_ref }}.")
    _line(doc,
          "2. That the said lease expired on {{ lease_expiry_date }}, whereafter the "
          "defendant became a month-to-month tenant of the plaintiff(s).")
    _line(doc,
          "3. That the plaintiff(s) served upon the defendant a notice under s.106 of "
          "the Transfer of Property Act, 1882 ({{ s106_notice_ref }}) terminating "
          "the tenancy with effect from {{ tenancy_end_date }}.")
    _line(doc,
          "4. That the defendant received the said notice on "
          "{{ s106_notice_served_date }}, i.e. clear {{ clear_days }} days before the "
          "date of termination, and it is therefore a valid notice under the Transfer "
          "of Property Act.")
    _line(doc,
          "5. That the defendant, having neither vacated the premises nor shown any "
          "intention to vacate, is in wrongful use and occupation "
          "{% if wrongful_occupation_since %}since {{ wrongful_occupation_since }} "
          "{% endif %}at Rs. {{ damages_rate_per_day }}/- per day, the prevailing "
          "rate for such premises.")
    _line(doc, "{% if outside_rent_control %}")
    _line(doc,
          "6. That the suit premises are not governed by the Rent Control Act, and "
          "this Hon'ble Court has jurisdiction to try the matter.")
    _line(doc, "{% endif %}")
    _line(doc,
          "7. That the cause of action arose on {{ cause_of_action_date }} at "
          "{{ cause_of_action_place }} and is a continuing one.")
    _line(doc,
          "8. That this Hon'ble Court has jurisdiction: {{ jurisdiction_basis }}.")
    _line(doc,
          "9. That the court fee has been calculated ad valorem on the annual rent of "
          "Rs. {{ annual_rent }}/-, on which a court fee of Rs. {{ court_fee }}/- is "
          "paid; the plaintiff(s) undertake to pay any additional court fee found "
          "due.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may be "
          "pleased to:")
    _line(doc,
          "(a) pass a decree for ejectment against the defendant and in favour of the "
          "plaintiff(s);")
    _line(doc,
          "(b) pass a decree for damages at Rs. {{ damages_rate_per_day }}/- per day "
          "for the wrongful use and occupation of the premises by the defendant;")
    _line(doc, "(c) award the costs of the suit; and")
    _prayer_closer(doc, "d")
    _line(doc)
    _signature_block(doc, "PLAINTIFF(S)", "suit_date")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc,
          "Verified at {{ place }} on this "
          "{% if suit_date %}{{ suit_date }}{% else %}____________{% endif %} that "
          "the contents of paras 1 to {{ knowledge_para_last }} are true to our "
          "personal knowledge and the remaining paras are true on the basis of legal "
          "advice received and believed to be true; the last para is the prayer to "
          "this Hon'ble Court.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PLAINTIFF(S)")
    _line(doc)
    _line(doc, "[NOTE: This plaint has to be supported by an affidavit.]")
    _save(doc, "ejectment.docx")


def build_indigent_application():
    doc = Document()
    _review_banner(doc)
    _center(doc, "APPLICATION TO SUE AS AN INDIGENT PERSON", bold=True)
    _line(doc)
    _center(doc,
            "IN THE COURT OF {% if civil_court %}{{ civil_court }}{% else %}"
            "THE CIVIL JUDGE (SENIOR DIVISION){% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "SUIT NO. ______ OF {{ case_year }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ applicant.name }}"
          "                          ... APPLICANT / PLAINTIFF")
    _center(doc, "VERSUS")
    _line(doc,
          "{{ respondent.name }}"
          "                          ... RESPONDENT / DEFENDANT")
    _line(doc)
    _center(doc, "APPLICATION UNDER ORDER XXXIII READ WITH SECTION 151 OF THE CODE "
                 "OF CIVIL PROCEDURE, 1908", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That the applicant has filed the above-titled suit ({{ suit_ref }}), "
          "which is pending disposal before this Hon'ble Court.")
    _line(doc,
          "2. That the contents of the accompanying suit may kindly be read as part "
          "and parcel of this application, which are not repeated here for the sake "
          "of brevity.")
    _line(doc,
          "3. That the applicant is an indigent person: {{ indigency_particulars }}. "
          "The applicant is therefore unable to pay the requisite court fee as "
          "required by law.")
    _line(doc,
          "4. That the applicant undertakes to pay the entire court fee if the suit "
          "is decreed in his favour.")
    _line(doc,
          "5. That there are sufficient reasons for granting the applicant permission "
          "to institute the present suit as an indigent person.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may be "
          "pleased to:")
    _line(doc,
          "(a) allow the applicant to sue as an indigent person in the interest of "
          "justice; and")
    _prayer_closer(doc, "b")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("APPLICANT")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if application_date %}{{ application_date }}{% else %}"
               "____________{% endif %}                Advocate")
    _line(doc)
    _line(doc, "[NOTE: The petition must be supported by an affidavit.]")
    _save(doc, "indigent_application.docx")


def build_o39_r2a_application():
    doc = Document()
    _review_banner(doc)
    _center(doc, "APPLICATION UNDER ORDER XXXIX RULE 2-A OF THE CODE OF CIVIL "
                 "PROCEDURE, 1908", bold=True)
    _line(doc)
    _center(doc,
            "IN THE COURT OF {% if civil_court %}{{ civil_court }}{% else %}"
            "THE SENIOR CIVIL JUDGE{% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "IN {{ suit_ref }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ applicant.name }}"
          "                          ... PLAINTIFF / APPLICANT")
    _center(doc, "VERSUS")
    _line(doc,
          "{{ respondent.name }}"
          "                          ... DEFENDANT / RESPONDENT")
    _line(doc)
    _center(doc, "APPLICATION UNDER ORDER XXXIX RULE 2-A READ WITH SECTION 151 CPC "
                 "ON BEHALF OF THE PLAINTIFF", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That the above-noted suit is pending before this Hon'ble Court and the "
          "contents of the plaint may be read as part of this application.")
    _line(doc,
          "2. That on {{ injunction_order_date }} this Hon'ble Court was pleased to "
          "grant an injunction in favour of the plaintiff/applicant and against the "
          "defendant/respondent.")
    _line(doc,
          "3. That the defendant/respondent, in spite of the service and knowledge of "
          "the said injunction order dated {{ injunction_order_date }}, "
          "{{ disobedience_slot }}"
          "{% if disobedience_date %} on {{ disobedience_date }}{% endif %}.")
    _line(doc,
          "4. That the defendant/respondent has thus knowingly and wilfully disobeyed "
          "and violated the injunction order of this Hon'ble Court and has rendered "
          "himself liable to be detained in civil imprisonment and to attachment of "
          "his property."
          "{% if property_list_attached %} The list of properties is attached."
          "{% endif %}")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may be "
          "pleased to:")
    _line(doc,
          "(a) take appropriate action under Order XXXIX Rule 2-A CPC against the "
          "defendant/respondent, attaching his property and detaining him in civil "
          "imprisonment;")
    _line(doc,
          "(b) direct restoration of possession of the suit property to the "
          "plaintiff/applicant; and")
    _prayer_closer(doc, "c")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PLAINTIFF / APPLICANT")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if application_date %}{{ application_date }}{% else %}"
               "____________{% endif %}                Advocate")
    _line(doc)
    _line(doc, "[NOTE: An affidavit, duly attested by an oath commissioner, in "
               "support of this application is to be attached.]")
    _save(doc, "o39_r2a_application.docx")


def build_caveat():
    doc = Document()
    _review_banner(doc)
    _center(doc, "CAVEAT UNDER SECTION 148-A OF THE CODE OF CIVIL PROCEDURE, 1908",
            bold=True)
    _line(doc)
    _center(doc, "IN THE {% if court_name %}{{ court_name }}{% else %}"
                 "HIGH COURT{% endif %}", bold=True)
    _center(doc, "CAVEAT NO. ______ OF {{ caveat_year }}")
    _center(doc,
            "(ARISING OUT OF {{ impugned_order_ref }} DATED {{ impugned_order_date }} "
            "PASSED BY {{ lower_court }})")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ petitioner.name }}"
          "                          ... PETITIONER")
    _center(doc, "VERSUS")
    _line(doc,
          "{{ caveator.name }}"
          "                          ... RESPONDENT / CAVEATOR")
    _line(doc)
    _center(doc, "CAVEAT UNDER SECTION 148-A CPC BY THE RESPONDENT / CAVEATOR",
            bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That {{ lower_court }} passed an order ({{ impugned_order_ref }}) on "
          "{{ impugned_order_date }} against the caveator.")
    _line(doc,
          "2. That the caveator apprehends that the petitioner may file "
          "{{ apprehended_proceeding }} against the said order before this Hon'ble "
          "Court, and as such this caveat is being filed.")
    _line(doc,
          "3. That the caveator has a right to appear and contest the said proceeding "
          "if preferred by the petitioner.")
    _line(doc,
          "4. That the caveator desires notice of the filing of the said proceeding "
          "so as to appear at the hearing, and that no stay may be granted without "
          "hearing the caveator.")
    _line(doc,
          "5. That a copy of this caveat has been sent by registered A/D post to the "
          "petitioner.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that nothing may be done in the "
          "proceeding that may be filed by the petitioner without notice to the "
          "caveator or his counsel.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("CAVEATOR")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if caveat_date %}{{ caveat_date }}{% else %}____________"
               "{% endif %}                Advocate")
    _line(doc)
    _line(doc, "[NOTE: An affidavit of the caveator, duly attested by an oath "
               "commissioner, is to be attached.]")
    _save(doc, "caveat.docx")


def build_transfer_petition():
    doc = Document()
    _review_banner(doc)
    _center(doc, "TRANSFER PETITION (CIVIL) UNDER SECTION 25 OF THE CODE OF CIVIL "
                 "PROCEDURE, 1908", bold=True)
    _line(doc)
    _center(doc, "IN THE SUPREME COURT OF INDIA", bold=True)
    _center(doc, "ORIGINAL CIVIL JURISDICTION")
    _center(doc, "TRANSFER PETITION (CIVIL) NO. ______ OF {{ petition_year }}")
    _center(doc,
            "(UNDER SECTION 25 OF THE CODE OF CIVIL PROCEDURE, READ WITH ORDER XLI, "
            "SUPREME COURT RULES, 2013)")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ petitioner.name }}"
          "{% if petitioner.parentage %} {{ petitioner.parentage }}{% endif %}"
          "                          ... PETITIONER")
    _center(doc, "VERSUS")
    _line(doc,
          "{% for r in respondents %}{{ loop.index }}. {{ r }}"
          "{% if not loop.last %}\n{% endif %}{% endfor %}"
          "                          ... RESPONDENT"
          "{% if respondents|length > 1 %}S{% endif %}")
    _line(doc)
    _center(doc, "AND IN THE MATTER OF: TRANSFER OF {{ case_to_transfer }} FROM "
                 "{{ from_court }}, {{ from_state }} TO {{ to_court }}, "
                 "{{ to_state }}")
    _line(doc)
    _line(doc, "To,")
    _line(doc, "The Hon'ble the Chief Justice of India and His Companion Justices of "
               "the Hon'ble Supreme Court of India.")
    _line(doc)
    _line(doc, "The humble petition of the petitioner above-named "
               "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That the petitioner seeks the transfer of {{ case_to_transfer }}, "
          "pending in {{ from_court }}, {{ from_state }}, to {{ to_court }}, "
          "{{ to_state }}.")
    _line(doc, "2. BRIEF FACTS: {{ brief_facts_slot }}")          # LLM
    _line(doc, "3. GROUNDS:")
    _line(doc, "{% for g in grounds %}")
    _line(doc, "   {{ 'ABCDEFGHIJKLMNOP'[loop.index0] }}. {{ g }}")
    _line(doc, "{% endfor %}")
    _line(doc, "{% if no_other_transfer_petition %}")
    _line(doc,
          "4. That the petitioner has not filed any other similar transfer petition "
          "before this Hon'ble Court in respect of this matter.")
    _line(doc, "{% endif %}")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "In view of the above facts and circumstances, it is respectfully prayed "
          "that this Hon'ble Court may be pleased to:")
    _line(doc,
          "(a) transfer {{ case_to_transfer }} from {{ from_court }}, "
          "{{ from_state }} to {{ to_court }}, {{ to_state }}; and")
    _prayer_closer(doc, "b")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}                Advocate for the Petitioner")
    _line(doc)
    _line(doc, "[NOTE: To be supported by an affidavit.]")
    _save(doc, "transfer_petition.docx")


def build_execution_application():
    doc = Document()
    _review_banner(doc)
    _center(doc, "EXECUTION APPLICATION", bold=True)
    _line(doc)
    _center(doc, "IN THE COURT OF {{ execution_court }}", bold=True)
    _center(doc, "EXECUTION PETITION NO. ______ OF {{ execution_year }}")
    _center(doc, "IN {{ suit_no }}")
    _line(doc)
    _line(doc,
          "{{ decree_holder.name }}"
          "                          ... DECREE HOLDER")
    _center(doc, "VERSUS")
    _line(doc,
          "{{ judgment_debtor.name }}"
          "                          ... JUDGMENT DEBTOR")
    _line(doc)
    _line(doc,
          "The Decree Holder prays for execution of the decree/order dated "
          "{{ decree_date }}, the particulars whereof are stated hereunder:")
    _line(doc, "{% if police_station %}Police Station: {{ police_station }}{% endif %}")
    _line(doc, "1. Number of suit: {{ suit_no }}")
    _line(doc, "2. Name of parties: {{ decree_holder.name }} vs. "
               "{{ judgment_debtor.name }}")
    _line(doc, "3. Date of decree/order of which execution is sought: "
               "{{ decree_date }}")
    _line(doc, "4. Whether an appeal was filed against the decree/order under "
               "execution: {% if appeal_filed %}Yes{% else %}No{% endif %}")
    _line(doc, "5. Whether any payment has been received towards satisfaction of the "
               "decree/order: {{ payment_received }}")
    _line(doc, "6. Whether any application was made previously and, if so, its dates "
               "and results: {{ prior_applications }}")
    _line(doc, "7. Amount of the suit with interest as per the decree or other relief "
               "granted: Rs. {{ decretal_amount }}/- {{ interest_note }}")
    _line(doc, "8. Amount of costs, if allowed by the Court: Rs. {{ costs_amount }}/-")
    _line(doc, "9. Against whom execution is sought: {{ execution_against }}")
    _line(doc, "10. In what manner the Court's assistance is sought: "
               "{{ mode_of_assistance }}")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "The Decree Holder prays that execution of the decree passed in the case "
          "may be granted.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("DECREE HOLDER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if execution_date %}{{ execution_date }}{% else %}"
               "____________{% endif %}                Advocate for the Decree Holder")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc,
          "Verified at {{ place }} on this "
          "{% if execution_date %}{{ execution_date }}{% else %}____________"
          "{% endif %} that the contents of this application are true to my knowledge "
          "and belief.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("DECREE HOLDER")
    _line(doc)
    _line(doc, "[NOTE: The application shall be accompanied by a duly certified copy "
               "of the decree or order (Order XXI Rule 11 CPC).]")
    _save(doc, "execution_application.docx")


def build_restitution_conjugal_rights():
    doc = Document()
    _review_banner(doc)
    _matrimonial_cause_title(
        doc, "PETITION FOR RESTITUTION OF CONJUGAL RIGHTS",
        "PETITION FOR RESTITUTION OF CONJUGAL RIGHTS UNDER SECTION 9 OF THE HINDU "
        "MARRIAGE ACT, 1955")
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That a marriage was solemnised between the parties according to Hindu "
          "rites and ceremonies on {{ marriage_date }} at {{ marriage_place }}."
          "{% if marriage_registered %} The said marriage is registered with the "
          "Registrar of Marriages, and a certified copy of the relevant extract is "
          "filed herewith.{% endif %}")
    _line(doc,
          "2. That the status and place of residence of the parties to the marriage, "
          "before the marriage and at the time of filing this petition, are as set "
          "out herein.")
    _line(doc,
          "3. That the respondent has, without reasonable excuse, withdrawn from the "
          "society of the petitioner with effect from {{ withdrawal_date }}: "
          "{{ withdrawal_slot }}")
    _line(doc, "4. That the petition is not presented in collusion with the "
               "respondent.")
    _line(doc, "{% if no_undue_delay %}")
    _line(doc, "5. That there has not been any unnecessary or improper delay in "
               "filing the petition.")
    _line(doc, "{% endif %}")
    _line(doc, "6. That there is no other legal ground why relief should not be "
               "granted.")
    _line(doc,
          "7. That the parties last resided together at {{ last_resided_together }}, "
          "and this Hon'ble Court has jurisdiction to try and entertain this petition "
          "({{ jurisdiction_basis }}).")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "In view of the above facts and circumstances, it is most respectfully and "
          "humbly prayed that this Hon'ble Court may be pleased to:")
    _line(doc,
          "(a) grant a decree of restitution of conjugal rights under s.9 of the "
          "Hindu Marriage Act, 1955 in favour of the petitioner; and")
    _line(doc,
          "(b) grant any other relief that this Hon'ble Court may deem fit in the "
          "interest of justice and equity.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}                Advocate")
    _matrimonial_verification(doc)
    _save(doc, "restitution_conjugal_rights.docx")


def build_judicial_separation():
    doc = Document()
    _review_banner(doc)
    _matrimonial_cause_title(
        doc, "PETITION FOR JUDICIAL SEPARATION",
        "PETITION FOR JUDICIAL SEPARATION UNDER SECTION 10 OF THE HINDU MARRIAGE "
        "ACT, 1955")
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That the marriage was solemnised between the parties according to "
          "Hindu rites and ceremonies on {{ marriage_date }} at {{ marriage_place }}."
          "{% if marriage_registered %} The said marriage is registered with the "
          "Registrar of Marriages, and a certified copy of the relevant extract is "
          "filed herewith.{% endif %}")
    _line(doc,
          "2. That the status and place of residence of the parties, before the "
          "marriage and at the time of filing this petition, are as set out herein.")
    _line(doc,
          "3. That the respondent has, on the ground of {{ ground|replace('_', ' ') }}"
          ": {{ ground_slot }}")
    _line(doc, "{% if ground == 'adultery' %}")
    _line(doc,
          "4. That the petitioner has not in any manner been accessory to, connived "
          "at, or condoned the act(s) complained of.")
    _line(doc, "{% endif %}")
    _line(doc, "{% if ground == 'cruelty' %}")
    _line(doc, "4. That the petitioner has not in any manner condoned the cruelty.")
    _line(doc, "{% endif %}")
    _line(doc, "5. That the petition is not presented in collusion with the "
               "respondent.")
    _line(doc, "{% if no_undue_delay %}")
    _line(doc, "6. That there has not been any unnecessary or improper delay in "
               "filing the petition.")
    _line(doc, "{% endif %}")
    _line(doc, "7. That there is no other legal ground why relief should not be "
               "granted.")
    _line(doc,
          "8. That the parties last resided together at {{ last_resided_together }}, "
          "and this Hon'ble Court has jurisdiction to try and entertain this petition "
          "({{ jurisdiction_basis }}).")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "In view of the above facts and circumstances, it is most respectfully and "
          "humbly prayed that this Hon'ble Court may be pleased to:")
    _line(doc,
          "(a) grant a decree of judicial separation under s.10 of the Hindu Marriage "
          "Act, 1955 in favour of the petitioner; and")
    _line(doc,
          "(b) grant any other relief that this Hon'ble Court may deem fit in the "
          "interest of justice and equity.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}                Advocate")
    _matrimonial_verification(doc)
    _save(doc, "judicial_separation.docx")


def build_succession_grant():
    doc = Document()
    _review_banner(doc)
    _center(doc, "PETITION FOR GRANT OF {{ grant_label|upper }}", bold=True)
    _line(doc)
    _center(doc,
            "IN THE {% if grant_court %}{{ grant_court }}{% elif is_probate %}"
            "HIGH COURT (TESTAMENTARY & INTESTATE JURISDICTION){% else %}"
            "COURT OF THE DISTRICT JUDGE{% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "{% if is_probate %}PROBATE CASE{% else %}CASE{% endif %} NO. ______ "
                 "OF {{ case_year }}{% if not is_probate %} UNDER ACT XXXIX OF 1925"
                 "{% endif %}")
    _line(doc)
    _line(doc, "IN THE MATTER OF: THE ESTATE OF THE LATE {{ deceased_name }} "
               "(DECEASED)")
    _line(doc, "AND IN THE MATTER OF:")
    _line(doc,
          "{{ petitioner.name }}"
          "                          ... PETITIONER")
    _center(doc, "VERSUS")
    _line(doc, "{% for r in relatives %}{{ loop.index }}. {{ r.relation }}, "
               "{{ r.name }}, R/o {{ r.address }}"
               "{% if not loop.last %}\n{% endif %}{% endfor %}"
               "                          ... RESPONDENTS")
    _line(doc)
    _center(doc, "PETITION FOR GRANT OF {{ grant_label|upper }} UNDER THE INDIAN "
                 "SUCCESSION ACT, 1925", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That this petition is filed for the grant of {{ grant_label|lower }} in "
          "respect of the estate of the deceased Late {{ deceased_name }}, who at the "
          "time of his death on {{ death_date }} was residing at "
          "{{ deceased_last_residence }}.")
    _line(doc,
          "2. That during his lifetime the deceased bequeathed his estate by his last "
          "will and testament dated {{ will_date }}, made in a sound state of mind; "
          "the original will is annexed.")
    _line(doc,
          "3. That the said will was duly made by the deceased in the presence of the "
          "witnesses whose names, addresses and signatures appear at the end of the "
          "will.")
    _line(doc, "4. That by virtue of the said will, the deceased bequeathed: "
               "{{ bequest_slot }}")
    _line(doc, "5. That a description of the relatives of the deceased and their "
               "respective residences is set out in the cause-title above (all such "
               "relatives being made respondents).")
    _line(doc,
          "6. That the assets of the deceased likely to come to the hands of the "
          "petitioner are detailed in Schedule-A ({{ assets_schedule_ref }}), "
          "annexed hereto.")
    _line(doc, "7. That, so far as the petitioner has been able to ascertain, there "
               "are no properties other than those specified in the affidavit of "
               "assets.")
    _line(doc, "{% if undertakes_further_court_fee %}")
    _line(doc, "8. That the petitioner undertakes to pay the court fees payable in "
               "respect of any other properties coming to his hands.")
    _line(doc, "{% endif %}")
    _line(doc, "{% if no_impediment %}")
    _line(doc, "9. That there is no legal impediment to the grant of "
               "{{ grant_label|lower }} in favour of the petitioner.")
    _line(doc, "{% endif %}")
    _line(doc, "{% if is_probate %}")
    _line(doc, "10. That the petitioner is claiming probate of the will, being the "
               "named executor therein.")
    _line(doc, "{% else %}")
    _line(doc, "10. That the petitioner is claiming letters of administration, being "
               "{{ petitioner_standing }}.")
    _line(doc, "{% endif %}")
    _line(doc, "11. That to the best of the petitioner's belief, no petition has been "
               "made to any other court in respect of the said will.")
    _line(doc,
          "12. That the deceased had a fixed abode, and the immovable property is "
          "situated, within the territorial jurisdiction of this Hon'ble Court "
          "({{ jurisdiction_basis }}).")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc, "It is, therefore, most humbly prayed that:")
    _line(doc,
          "(a) the {{ grant_label|lower }} of the will be granted to the petitioner; "
          "and")
    _line(doc,
          "(b) any other or further relief that this Hon'ble Court may deem fit, just "
          "and proper be granted in favour of the petitioner.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}                Advocate")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc,
          "I, the petitioner above-named, declare that what is stated herein is true "
          "to the best of my information and belief; the last para is the prayer to "
          "this Hon'ble Court. Verified at {{ place }} on this "
          "{% if petition_date %}{{ petition_date }}{% else %}____________"
          "{% endif %}.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc)
    _line(doc, "VERIFICATION (WITNESSES TO THE WILL):")
    _line(doc,
          "We, the witnesses to the last will and testament of the testator, declare "
          "that we were present and saw the testator affix his signature on the will "
          "annexed, and we acknowledge the same to be his last will and testament in "
          "our presence.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("WITNESS NO. 1                    WITNESS NO. 2")
    _line(doc)
    _line(doc, "[NOTE: To be supported by an affidavit.]")
    _save(doc, "succession_grant.docx")


def build_succession_certificate():
    doc = Document()
    _review_banner(doc)
    _center(doc, "PETITION FOR THE GRANT OF A SUCCESSION CERTIFICATE", bold=True)
    _line(doc)
    _center(doc,
            "IN THE COURT OF {% if grant_court %}{{ grant_court }}{% else %}"
            "THE DISTRICT JUDGE{% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "SUCCESSION PETITION NO. ______ OF {{ case_year }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ petitioner.name }}"
          "                          ... APPLICANT / PETITIONER")
    _center(doc, "VERSUS")
    _line(doc,
          "{% if respondent_name %}{{ respondent_name }}{% else %}The State and the "
          "legal heirs{% endif %}"
          "                          ... RESPONDENT(S)")
    _line(doc)
    _center(doc, "PETITION FOR THE GRANT OF A SUCCESSION CERTIFICATE IN RESPECT OF "
                 "THE DEBTS AND SECURITIES OF {{ deceased_name }} (DECEASED) UNDER "
                 "SECTION 372 OF THE INDIAN SUCCESSION ACT, 1925", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That {{ deceased_name }} died at {{ deceased_residence }} on or about "
          "{{ death_date }}.")
    _line(doc, "2. That the said deceased died intestate, and due and diligent search "
               "has been made for a will but none has been found.")
    _line(doc,
          "3. That the deceased was, during his lifetime and until his death, "
          "permanently residing within the jurisdiction of this Court, and was "
          "governed by {{ law_of_succession }}.")
    _line(doc,
          "4. That the deceased left surviving him his next-of-kin, namely "
          "{{ next_of_kin }}.")
    _line(doc,
          "5. That the petitioner, being the {{ petitioner_relation }} of the "
          "deceased, claims to be entitled to a share of the estate.")
    _line(doc,
          "6. That there is no impediment under s.370 of the Indian Succession Act, "
          "1925 or under any other provision to the grant of the certificate.")
    _line(doc,
          "7. That the securities in respect of which the certificate is applied for "
          "are set forth in Schedule I hereto. The certificate is required for the "
          "purpose of {{ purpose }}. The said assets are of the value of "
          "Rs. {{ total_value }}/-.")
    _line(doc, "{% if no_prior_application %}")
    _line(doc, "8. That no application for probate, letters of administration, or a "
               "succession certificate in respect of the estate has been made to any "
               "court.")
    _line(doc, "{% endif %}")
    _line(doc, "9. That the ad valorem duty payable on the grant of the succession "
               "certificate has been paid.")
    _line(doc, "10. That this application is made bona fide.")
    _line(doc)
    _line(doc, "SCHEDULE I (DEBTS AND SECURITIES):")
    _line(doc, "{% for s in securities %}")
    _line(doc, "   {{ loop.index }}. {{ s.description }} — Rs. {{ s.value }}/-")
    _line(doc, "{% endfor %}")
    _line(doc, "   TOTAL: Rs. {{ total_value }}/-")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc, "The petitioner therefore prays:")
    _line(doc,
          "(a) that a succession certificate be granted to the petitioner in respect "
          "of the debts and securities set forth in Schedule I, with power to "
          "collect, receive and realise the same together with all interest accrued; "
          "and")
    _line(doc,
          "(b) that the petitioner be exempted from furnishing any security on that "
          "account.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}                Advocate")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc,
          "I, the petitioner above-named, do solemnly declare that what is stated in "
          "the paragraphs above is true to my knowledge, and that what is stated as "
          "to the remaining paragraphs is true to information received and believed "
          "to be true. Verified at {{ place }} on this "
          "{% if petition_date %}{{ petition_date }}{% else %}____________"
          "{% endif %}.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc)
    _line(doc, "[NOTE: To be supported by an affidavit.]")
    _save(doc, "succession_certificate.docx")


def build_writ_criminal():
    doc = Document()
    _review_banner(doc)
    _center(doc, "WRIT PETITION (CRIMINAL) FOR ENFORCEMENT OF FUNDAMENTAL RIGHTS",
            bold=True)
    _line(doc)
    _center(doc, "IN THE HIGH COURT OF {{ high_court|default('___')|upper }}",
            bold=True)
    _center(doc, "WRIT PETITION (CRL.) NO. ______ OF {{ petition_year }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ petitioner.name }}"
          "{% if petitioner.parentage %} {{ petitioner.parentage }}{% endif %}"
          "                          ... PETITIONER")
    _center(doc, "VERSUS")
    _line(doc,
          "{% for r in respondents %}{{ loop.index }}. {{ r }}"
          "{% if not loop.last %}\n{% endif %}{% endfor %}"
          "                          ... RESPONDENT"
          "{% if respondents|length > 1 %}S{% endif %}")
    _line(doc)
    _center(doc, "PETITION UNDER ARTICLES 226 AND 227 OF THE CONSTITUTION OF INDIA "
                 "READ WITH SECTION 482 OF THE CODE OF CRIMINAL PROCEDURE, 1973 "
                 "SEEKING A WRIT OF CERTIORARI / MANDAMUS", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That by the present petition the petitioner challenges "
          "{{ impugned_order_ref }} dated {{ impugned_order_date }}, issued under "
          "{{ impugned_order_statute }} against the petitioner.")
    _line(doc, "2. FACTS: {{ facts_slot }}")                      # LLM
    _line(doc, "3. GROUNDS:")
    _line(doc, "{% for g in grounds %}")
    _line(doc, "   {{ 'ABCDEFGHIJKLMNOP'[loop.index0] }}. {{ g }}")
    _line(doc, "{% endfor %}")
    _line(doc, "{% if pre_execution_stage %}")
    _line(doc,
          "4. That this petition is maintainable at the pre-execution stage, the "
          "petitioner's case being covered by the exceptions laid down in Alka "
          "Subhash Gadia and Deepak Bajaj v. State of Maharashtra.")
    _line(doc, "{% endif %}")
    _line(doc,
          "5. That no similar petition has been filed by the petitioner before this "
          "Hon'ble Court or the Hon'ble Supreme Court.")
    _line(doc, "6. That the petitioner has no other efficacious remedy.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "In view of the foregoing, it is most respectfully prayed that this Hon'ble "
          "Court may be pleased to:")
    _line(doc,
          "(a) issue a writ of mandamus directing the respondents to place on record "
          "{{ impugned_order_ref }} dated {{ impugned_order_date }} together with the "
          "grounds and the relied-upon documents;")
    _line(doc,
          "(b) issue a writ of certiorari, or any other appropriate writ, quashing "
          "{{ impugned_order_ref }} dated {{ impugned_order_date }}; and")
    _prayer_closer(doc, "c")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}                Advocate")
    _line(doc)
    _line(doc, "[NOTE: The petition is to be supported by an affidavit.]")
    _save(doc, "writ_criminal.docx")


def build_special_leave_petition():
    doc = Document()
    _review_banner(doc)
    _center(doc, "SPECIAL LEAVE PETITION ({{ slp_label }})", bold=True)
    _line(doc)
    _center(doc, "IN THE SUPREME COURT OF INDIA", bold=True)
    _center(doc, "{{ jurisdiction_label }}")
    _center(doc, "{{ order_rule }}, SUPREME COURT RULES 2013")
    _center(doc, "(UNDER ARTICLE 136 OF THE CONSTITUTION OF INDIA)")
    _center(doc, "SPECIAL LEAVE PETITION ({{ slp_label }}) NO. ______ OF "
                 "{{ slp_year }}")
    _center(doc, "(Arising out of the judgment and order dated "
                 "{{ impugned_judgment_date }} passed by {{ impugned_court }} in "
                 "{{ impugned_case_ref }})")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{{ petitioner.name }}"
          "                          ... PETITIONER")
    _center(doc, "VERSUS")
    _line(doc,
          "{% for r in respondents %}{{ loop.index }}. {{ r }}"
          "{% if not loop.last %}\n{% endif %}{% endfor %}"
          "                          ... RESPONDENT"
          "{% if respondents|length > 1 %}S{% endif %}")
    _line(doc)
    _center(doc, "SPECIAL LEAVE PETITION UNDER ARTICLE 136 OF THE CONSTITUTION OF "
                 "INDIA", bold=True)
    _line(doc)
    _line(doc, "To, The Hon'ble the Chief Justice of India and His Companion Justices "
               "of the Supreme Court of India.")
    _line(doc)
    _line(doc, "The humble petition of the petitioner above-named "
               "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That the present petition is filed seeking special leave to appeal "
          "against the final judgment and order dated {{ impugned_judgment_date }} "
          "of {{ impugned_court }} in {{ impugned_case_ref }}.")
    _line(doc, "{% if condonation_required %}")
    _line(doc,
          "1A. That as the present petition is filed beyond ninety days of the "
          "impugned judgment (the limitation for a special leave petition), an "
          "application for condonation of delay is filed along with this petition.")
    _line(doc, "{% endif %}")
    _line(doc, "{% if is_civil %}")
    _line(doc, "2. QUESTIONS OF LAW: the following questions of law arise for "
               "consideration:")
    _line(doc, "{% for q in questions_of_law %}")
    _line(doc, "   {{ loop.index }}) {{ q }}")
    _line(doc, "{% endfor %}")
    _line(doc, "{% else %}")
    _line(doc, "2. That the present petition raises an important question of law for "
               "consideration before this Hon'ble Court.")
    _line(doc, "{% endif %}")
    _line(doc,
          "3. DECLARATION (in terms of {{ declaration_rule }}): the petitioner states "
          "that no other petition for special leave to appeal has been filed against "
          "the impugned judgment.")
    _line(doc,
          "4. DECLARATION (in terms of {{ annexure_rule }}): the annexures filed with "
          "this petition are true copies of the pleadings and documents that formed "
          "part of the records of the court below.")
    _line(doc, "5. BRIEF FACTS: {{ brief_facts_slot }}")          # LLM
    _line(doc, "6. GROUNDS: special leave is sought on the following grounds:")
    _line(doc, "{% for g in grounds %}")
    _line(doc, "   {{ 'ABCDEFGHIJKLMNOP'[loop.index0] }}) {{ g }}")
    _line(doc, "{% endfor %}")
    _line(doc, "{% if interim_relief_sought %}")
    _line(doc, "7. GROUNDS FOR INTERIM RELIEF: {{ interim_relief_sought }}")
    _line(doc, "{% endif %}")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may be "
          "pleased to:")
    _line(doc,
          "(a) grant special leave to appeal against the final judgment and order "
          "dated {{ impugned_judgment_date }} of {{ impugned_court }} in "
          "{{ impugned_case_ref }}; and")
    _prayer_closer(doc, "b")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("DRAWN AND FILED BY")
    _line(doc, "Place: {{ place }}                          Advocate for the "
               "Petitioner")
    _line(doc, "Date:  {% if slp_date %}{{ slp_date }}{% else %}____________"
               "{% endif %}")
    _line(doc)
    _line(doc, "[NOTE: To be supported by an affidavit.]")
    _save(doc, "special_leave_petition.docx")


def build_contempt_petition():
    doc = Document()
    _review_banner(doc)
    _center(doc, "CONTEMPT PETITION", bold=True)
    _line(doc)
    _center(doc, "IN THE HIGH COURT OF {{ high_court|default('___')|upper }}",
            bold=True)
    _center(doc, "CONTEMPT PETITION NO. ______ OF {{ petition_year }}")
    _center(doc, "IN {{ parent_case_ref }}")
    _line(doc)
    _line(doc, "IN THE MATTER OF:")
    _line(doc,
          "{% for p in petitioners %}{{ loop.index }}. {{ p }}"
          "{% if petitioner_addresses and petitioner_addresses[loop.index0] %}, "
          "R/o {{ petitioner_addresses[loop.index0] }}{% endif %}"
          "{% if not loop.last %}\n{% endif %}{% endfor %}"
          "                          ... PETITIONER"
          "{% if petitioners|length > 1 %}S{% endif %}")
    _center(doc, "VERSUS")
    _line(doc,
          "{% for r in respondents %}{{ loop.index }}. {{ r }}"
          "{% if not loop.last %}\n{% endif %}{% endfor %}"
          "                          ... RESPONDENT"
          "{% if respondents|length > 1 %}S{% endif %}")
    _line(doc)
    _center(doc, "CONTEMPT PETITION UNDER SECTIONS 11 AND 12 OF THE CONTEMPT OF "
                 "COURTS ACT, 1971", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc,
          "1. That in {{ parent_case_ref }} this Hon'ble Court, on "
          "{{ order_disobeyed_date }}, passed {{ order_nature }}.")
    _line(doc,
          "2. That the respondents/contemnors, in spite of the service and knowledge "
          "of the said order dated {{ order_disobeyed_date }}, {{ disobedience_slot }}"
          "{% if contempt_committed_date %} on {{ contempt_committed_date }}"
          "{% endif %}.")
    _line(doc,
          "3. That the respondents/contemnors have thereby knowingly and wilfully "
          "disobeyed the order of this Hon'ble Court and committed contempt of court.")
    _line(doc,
          "4. That the present petition is within one year of the date on which the "
          "contempt was committed (s.20 of the Contempt of Courts Act, 1971).")
    _line(doc,
          "5. That the cause of action arose when the contemnors, having been "
          "apprised of the order, refused to comply, and is a continuing one.")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may be "
          "pleased to:")
    _line(doc,
          "(a) initiate contempt proceedings against the above-named contemnors and "
          "punish them in accordance with law; and")
    _prayer_closer(doc, "b")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("PETITIONER")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if petition_date %}{{ petition_date }}{% else %}"
               "____________{% endif %}                Advocate")
    _line(doc)
    _line(doc, "[NOTE: The petition must be supported by an affidavit.]")
    _save(doc, "contempt_petition.docx")


# ==========================================================================
# BATCH 4 — conveyancing deeds + notices from the DPC book (Part B).
# ==========================================================================

def _advocate_letterhead(doc):
    """Advocate letterhead + REGD A/D block shared by the notice letters
    (book pp.127-133)."""
    _line(doc, "{{ advocate }}")
    _line(doc, "Advocate")
    _line(doc, "{% if advocate_chamber %}{{ advocate_chamber }}{% endif %}")
    _line(doc, "{% if advocate_phone %}Ph. {{ advocate_phone }}{% endif %}")
    _line(doc)
    _line(doc, "{% if dispatch_line %}{{ dispatch_line }}{% else %}"
               "REGD A/D / U.P.C.{% endif %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Dated: {{ notice_date }}")
    _line(doc)


def _deed_witnesses(doc, signatory_labels):
    """IN WITNESS WHEREOF + signatures + two witnesses (deed tail, book pp.99-126).
    signatory_labels: list of the party labels that sign (e.g. ['VENDOR','VENDEE'])."""
    _line(doc)
    _line(doc,
          "IN WITNESS WHEREOF the parties hereto have signed this deed on the date "
          "and at the place first above written, in the presence of the following "
          "witnesses.")
    _line(doc)
    for lab in signatory_labels:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        p.add_run(lab)
    _line(doc)
    _line(doc, "WITNESSES:")
    _line(doc, "{% for w in witnesses %}")
    _line(doc, "   {{ loop.index }}. {{ w }}")
    _line(doc, "{% endfor %}")


def build_will():
    doc = Document()
    _review_banner(doc)
    _center(doc, "WILL", bold=True)
    _line(doc)
    _line(doc,
          "THIS IS THE LAST WILL AND TESTAMENT of me, {{ testator.name }}, "
          "{{ testator.parentage }}, R/o {{ testator.address }}, made at {{ place }} "
          "on {{ execution_date }}.")
    _line(doc,
          "That life is uncertain, and this is my last Will by which I bequeath "
          "voluntarily, out of my own free will and in a sound state of mind, my "
          "self-acquired properties to the beneficiaries described hereunder.")
    _line(doc, "{% if revokes_prior_wills %}")
    _line(doc, "I hereby revoke all former wills, codicils and testamentary "
               "dispositions made by me.")
    _line(doc, "{% endif %}")
    _line(doc, "I HEREBY WISH that my properties devolve in the following manner:")
    _line(doc, "{% for b in bequests %}")
    _line(doc,
          "   {{ loop.index }}. That my property, namely {{ b.property_desc }}, shall "
          "devolve upon {{ b.beneficiary }} ({{ b.relation }}) absolutely and "
          "unconditionally.")
    _line(doc, "{% endfor %}")
    _line(doc, "{% if executor_name %}")
    _line(doc, "I appoint {{ executor_name }} as the executor of this Will.")
    _line(doc, "{% endif %}")
    _line(doc,
          "That this Will has been drafted in my presence and upon my instructions, "
          "and its contents have been read over and explained to me. I declare the "
          "contents of this Will to be my last Will, arrived at in a sound state of "
          "mind.")
    _line(doc)
    _line(doc,
          "IN WITNESS WHEREOF I, {{ testator.name }}, have signed this Will on this "
          "{{ execution_date }} at {{ place }} in the presence of the following "
          "witnesses, who have attested it in my presence and at my request.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("TESTATOR")
    _line(doc)
    _line(doc,
          "Signed by the above-named testator in our presence at the same time, and "
          "each of us has, in the presence of the testator, signed his name hereunder "
          "as an attesting witness:")
    _line(doc, "{% for w in witnesses %}")
    _line(doc, "   {{ loop.index }}. {{ w }}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "[NOTE: No stamp duty is payable on a will; registration is optional.]")
    _save(doc, "will.docx")


def build_power_of_attorney():
    doc = Document()
    _review_banner(doc)
    _center(doc, "{{ deed_title }}", bold=True)
    _line(doc)
    _line(doc,
          "KNOW ALL MEN BY THESE PRESENTS THAT THIS {{ deed_title }} is executed at "
          "{{ place }} on {{ execution_date }} by {{ executant.name }}, "
          "{{ executant.description }} (hereinafter referred to as the EXECUTANT), "
          "who DO HEREBY APPOINT, NOMINATE, CONSTITUTE AND AUTHORISE "
          "{{ attorney.name }}, {{ attorney.description }} (hereinafter referred to "
          "as the ATTORNEY) as my true and lawful attorney to perform the acts "
          "mentioned hereunder.")
    _line(doc, "{% if recitals %}")
    _line(doc, "WHEREAS {{ recitals }}")
    _line(doc, "{% endif %}")
    _line(doc, "{{ witnesseth }}")
    _line(doc, "{% for p in powers %}")
    _line(doc, "   ({{ loop.index }}) {{ p }}")
    _line(doc, "{% endfor %}")
    _line(doc,
          "AND I hereby agree to ratify and confirm whatsoever the said Attorney "
          "shall lawfully do or cause to be done in or about the premises by virtue "
          "of these presents.")
    _line(doc)
    _line(doc,
          "IN WITNESS WHEREOF I have signed this document on the date and at the "
          "place first above written, in the presence of the following witnesses.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("EXECUTANT")
    _line(doc)
    _line(doc, "WITNESSES:")
    _line(doc, "{% for w in witnesses %}")
    _line(doc, "   {{ loop.index }}. {{ w }}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "[NOTE: A power of attorney is required to be stamped but need not be "
               "mandatorily registered.]")
    _save(doc, "power_of_attorney.docx")


def build_agreement_for_sale():
    doc = Document()
    _review_banner(doc)
    _center(doc, "AGREEMENT FOR SALE", bold=True)
    _line(doc)
    _line(doc,
          "THIS AGREEMENT FOR SALE is made at {{ place }} on {{ execution_date }} "
          "BETWEEN {{ vendor.name }}, {{ vendor.description }} (hereinafter referred "
          "to as the VENDOR, which expression shall include his heirs, executors, "
          "administrators and assigns) of the FIRST PART; AND {{ vendee.name }}, "
          "{{ vendee.description }} (hereinafter referred to as the "
          "VENDEE/PURCHASER, which expression shall include his heirs, executors, "
          "administrators and assigns) of the SECOND PART.")
    _line(doc,
          "WHEREAS the Vendor is the absolute owner of {{ property_desc }} "
          "(hereinafter referred to as the said property).")
    _line(doc,
          "AND WHEREAS the Vendor has agreed to sell the said property to the Vendee "
          "at the price and on the conditions mentioned hereinafter.")
    _line(doc)
    _line(doc, "NOW IT IS AGREED BETWEEN THE PARTIES AS FOLLOWS:")
    _line(doc,
          "1. That the Vendor agrees to sell, transfer and convey the said property "
          "to the Vendee for a total consideration of Rs. {{ total_consideration }}/-.")
    _line(doc,
          "2. That the Vendee has paid Rs. {{ earnest_money }}/- as earnest money "
          "(by {{ earnest_mode }}), the receipt of which the Vendor acknowledges; "
          "the balance shall be paid at the time of the final sale deed.")
    _line(doc,
          "3. That the Vendor shall make out a marketable title to the said property, "
          "free from encumbrances and reasonable doubts.")
    _line(doc,
          "4. That the sale shall be completed within {{ completion_months }} months "
          "from the date hereof.")
    _line(doc,
          "5. That the expenses of stamp duty, registration charges and all incidental "
          "expenses for the agreement and the sale deed shall be borne by the Vendee.")
    _line(doc,
          "6. That if the Vendor fails to make out a clear marketable title, the "
          "Vendee may cancel this agreement on fifteen days' notice, and the Vendor "
          "shall return the earnest money; if the Vendee fails to perform his "
          "obligations, the Vendor may cancel on fifteen days' notice and forfeit the "
          "earnest money.")
    _line(doc)
    _line(doc, "SCHEDULE OF PROPERTY:")
    _line(doc, "{{ property_desc }}")
    _deed_witnesses(doc, ["VENDOR", "VENDEE"])
    _save(doc, "agreement_for_sale.docx")


def build_sale_deed():
    doc = Document()
    _review_banner(doc)
    _center(doc, "SALE DEED", bold=True)
    _line(doc)
    _line(doc,
          "THIS SALE DEED is made at {{ place }} on {{ execution_date }} BETWEEN "
          "{{ vendor.name }}, {{ vendor.description }} (hereinafter referred to as "
          "the VENDOR, which expression shall include his heirs, executors, "
          "administrators and assigns) of the FIRST PART; AND {{ vendee.name }}, "
          "{{ vendee.description }} (hereinafter referred to as the "
          "VENDEE/PURCHASER, which expression shall include his heirs, executors, "
          "administrators and assigns) of the SECOND PART.")
    _line(doc, "WHEREAS {{ prior_title_recital }}")
    _line(doc, "The said property is bounded as under:")
    _line(doc, "   EAST : {{ boundaries.east }}")
    _line(doc, "   WEST : {{ boundaries.west }}")
    _line(doc, "   NORTH: {{ boundaries.north }}")
    _line(doc, "   SOUTH: {{ boundaries.south }}")
    _line(doc,
          "AND WHEREAS the Vendor has agreed to sell, and the Vendee to purchase, "
          "{{ property_desc }} for a total consideration of "
          "Rs. {{ total_consideration }}/- on the terms set forth hereinafter.")
    _line(doc)
    _line(doc, "NOW THIS SALE DEED WITNESSES AS FOLLOWS:")
    _line(doc,
          "1. That in pursuance of this agreement, the Vendor has received from the "
          "Vendee Rs. {{ amount_already_paid }}/- as part consideration, the receipt "
          "of which the Vendor hereby acknowledges.")
    _line(doc,
          "2. That the balance of Rs. {{ balance }}/- has been paid by the Vendee to "
          "the Vendor by {{ balance_paid_mode }}.")
    _line(doc,
          "3. That in consideration of the amount received, the Vendor hereby grants, "
          "conveys and transfers unto the Vendee all his right, title and interest in "
          "the said property, to hold the same absolutely and forever.")
    _line(doc,
          "4. That the Vendor assures that the said property is free from all "
          "encumbrances, attachments, prior sale, mortgage and disputes, and shall "
          "make good any loss suffered by the Vendee if it is proved otherwise.")
    _line(doc,
          "5. That the Vendor has handed over vacant, physical possession of the said "
          "property to the Vendee.")
    _line(doc,
          "6. That all expenses of registration and stamp duty have been borne by the "
          "Vendee, and all taxes up to the date of this deed have been paid by the "
          "Vendor.")
    _line(doc)
    _line(doc, "SCHEDULE OF PROPERTY:")
    _line(doc, "{{ property_desc }}")
    _line(doc, "   (Bounded: East — {{ boundaries.east }}; West — {{ boundaries.west }}; "
               "North — {{ boundaries.north }}; South — {{ boundaries.south }}.)")
    _deed_witnesses(doc, ["VENDOR", "VENDEE"])
    _line(doc, "[NOTE: This sale deed is compulsorily registrable under s.17 of the "
               "Registration Act, 1908.]")
    _save(doc, "sale_deed.docx")


def build_lease_deed():
    doc = Document()
    _review_banner(doc)
    _center(doc, "LEASE DEED", bold=True)
    _line(doc)
    _line(doc,
          "THIS LEASE DEED is made and executed at {{ place }} on {{ execution_date }} "
          "BETWEEN {{ lessor.name }}, {{ lessor.description }} (hereinafter referred "
          "to as the LESSOR, which expression shall include his legal heirs, "
          "successors, representatives and assigns) of the FIRST PART; AND "
          "{{ lessee.name }}, {{ lessee.description }} (hereinafter referred to as "
          "the LESSEE, which expression shall include its successors and assigns) of "
          "the SECOND PART.")
    _line(doc,
          "WHEREAS the Lessor is the owner of {{ property_desc }} (hereinafter the "
          "demised premises) and is desirous of letting out the same; AND WHEREAS the "
          "Lessee has offered to take the demised premises on lease, and the Lessor "
          "has agreed to let out the same on the terms hereinafter specified.")
    _line(doc)
    _line(doc, "NOW THIS AGREEMENT WITNESSETH AS UNDER:")
    _line(doc,
          "1. That the Lessor lets out the demised premises to the Lessee for a term "
          "of {{ term_months }} months with effect from {{ commencement_date }}, at a "
          "monthly rent of Rs. {{ monthly_rent }}/- (exclusive of electricity and "
          "water charges).")
    _line(doc, "{% if escalation_note %}")
    _line(doc, "2. That the rent shall be escalated as follows: {{ escalation_note }}.")
    _line(doc, "{% endif %}")
    _line(doc,
          "3. That the Lessee has paid Rs. {{ security_deposit }}/- as an "
          "interest-free security deposit, refundable on termination of the lease "
          "after adjustment of dues.")
    _line(doc,
          "4. That either party may terminate this lease by giving "
          "{{ notice_months }} months' written notice.")
    _line(doc,
          "5. That the Lessee shall pay the electricity and water charges, keep the "
          "premises in good tenantable condition, use them only for the authorised "
          "purpose, and deliver vacant possession on the expiry or termination of "
          "the lease.")
    _line(doc,
          "6. That the Lessor shall pay all municipal and property taxes, and shall "
          "not interfere with the Lessee's peaceful enjoyment of the demised "
          "premises.")
    _line(doc)
    _line(doc, "SCHEDULE (DEMISED PREMISES):")
    _line(doc, "{{ property_desc }}")
    _deed_witnesses(doc, ["LESSOR", "LESSEE"])
    _line(doc, "[NOTE: Read ss.105-111 of the Transfer of Property Act, 1882.]")
    _save(doc, "lease_deed.docx")


def build_mortgage_deed():
    doc = Document()
    _review_banner(doc)
    _center(doc, "DEED OF MORTGAGE", bold=True)
    _line(doc)
    _line(doc,
          "THIS DEED OF MORTGAGE is executed at {{ place }} on {{ execution_date }} "
          "BY {{ mortgagor.name }}, {{ mortgagor.description }} (hereinafter called "
          "the MORTGAGOR, which expression shall include his heirs, legal "
          "representatives, executors, administrators and assigns) of the FIRST PART; "
          "IN FAVOUR OF {{ mortgagee.name }}, {{ mortgagee.description }} "
          "(hereinafter called the MORTGAGEE, which expression shall include its "
          "successors and assigns).")
    _line(doc, "{% if purpose_recital %}")
    _line(doc, "WHEREAS {{ purpose_recital }}")
    _line(doc, "{% endif %}")
    _line(doc,
          "AND WHEREAS in consideration of the sum of Rs. {{ principal }}/- advanced "
          "by the Mortgagee to the Mortgagor, the Mortgagor has agreed to execute "
          "this mortgage of the property described in the Schedule.")
    _line(doc)
    _line(doc, "NOW THIS DEED WITNESSES AS UNDER:")
    _line(doc,
          "1. That the Mortgagor acknowledges that he owes Rs. {{ principal }}/- to "
          "the Mortgagee, and shall be liable to pay interest thereon at "
          "{{ interest_rate }}% per annum from the date of the loan until payment.")
    _line(doc, "2. That the Mortgagor shall repay the principal and interest as "
               "follows: {{ repayment_terms }}.")
    _line(doc,
          "3. That in consideration of the aforesaid, the Mortgagor hereby transfers "
          "by way of simple mortgage to the Mortgagee the property described in the "
          "Schedule, together with any building or permanent structure erected "
          "thereon.")
    _line(doc,
          "4. That the Mortgagor covenants that the said property is free from "
          "encumbrances and that he shall not, until the entire amount is repaid, "
          "create any fresh mortgage, charge or alienation of the property.")
    _line(doc,
          "5. That if the Mortgagor fails to pay the sum when due, the Mortgagee "
          "shall, in addition to any other remedy at law, have the power to sell the "
          "mortgaged property, without the intervention of the Court, for the "
          "realisation of the money due.")
    _line(doc)
    _line(doc, "SCHEDULE (MORTGAGED PROPERTY):")
    _line(doc, "{{ property_desc }}")
    _deed_witnesses(doc, ["MORTGAGOR", "MORTGAGEE"])
    _save(doc, "mortgage_deed.docx")


def build_partnership_deed():
    doc = Document()
    _review_banner(doc)
    _center(doc, "DEED OF PARTNERSHIP", bold=True)
    _line(doc)
    _line(doc,
          "THIS DEED OF PARTNERSHIP is executed at {{ place }} on {{ execution_date }} "
          "BETWEEN:")
    _line(doc, "{% for p in partners %}")
    _line(doc, "   {{ loop.index }}. {{ p.name }}, {{ p.description }} (share: "
               "{{ p.share_pct }}%);")
    _line(doc, "{% endfor %}")
    _line(doc, "(hereinafter collectively referred to as the PARTNERS, which "
               "expression shall include their respective heirs, successors, "
               "executors and legal representatives).")
    _line(doc,
          "WHEREAS the parties have agreed to commence and carry on business in "
          "partnership on the terms set out hereunder.")
    _line(doc)
    _line(doc, "NOW, THEREFORE, THIS DEED WITNESSES AS UNDER:")
    _line(doc, "1. That the name and style of the partnership shall be "
               "{{ firm_name }}.")
    _line(doc, "2. That the business of the partnership shall be "
               "{{ business_nature }}.")
    _line(doc, "3. That the business shall be deemed to have commenced on "
               "{{ commencement_date }}, and its principal place of business shall be "
               "at {{ principal_place }}.")
    _line(doc, "4. That the shares of the partners in the profits and losses shall be "
               "as follows:")
    _line(doc, "{% for p in partners %}")
    _line(doc, "   - {{ p.name }}: {{ p.share_pct }}%")
    _line(doc, "{% endfor %}")
    _line(doc, "5. CAPITAL: {{ capital_note }}.")
    _line(doc,
          "6. That the partnership shall maintain regular books of account at its "
          "principal place of business, and its accounting year shall run from 1st "
          "April to 31st March.")
    _line(doc, "{% if at_will %}")
    _line(doc,
          "7. That the partnership shall be a partnership at will; any partner "
          "intending to retire or dissolve the firm shall give fifteen days' advance "
          "notice to the other partners.")
    _line(doc, "{% endif %}")
    _line(doc,
          "8. That any dispute between the partners shall be referred to arbitration "
          "under the Arbitration and Conciliation Act, 1996; and in all other matters "
          "not provided herein, the partnership shall be governed by the Indian "
          "Partnership Act, 1932.")
    _deed_witnesses(doc,
                    ["FIRST PARTNER", "SECOND PARTNER"])
    _save(doc, "partnership_deed.docx")


def build_dissolution_deed():
    doc = Document()
    _review_banner(doc)
    _center(doc, "DEED OF DISSOLUTION OF PARTNERSHIP", bold=True)
    _line(doc)
    _line(doc,
          "THIS DEED OF DISSOLUTION is executed at {{ place }} on {{ execution_date }} "
          "BETWEEN:")
    _line(doc, "{% for p in partners %}")
    _line(doc, "   {{ loop.index }}. {{ p.name }}, {{ p.description }};")
    _line(doc, "{% endfor %}")
    _line(doc, "(hereinafter collectively referred to as the PARTNERS).")
    _line(doc,
          "WHEREAS the parties have been carrying on business in partnership under "
          "the firm {{ firm_name }} on the basis of {{ original_deed_ref }}; AND "
          "WHEREAS the parties have mutually decided to dissolve the partnership and "
          "to reduce the terms of dissolution into writing.")
    _line(doc)
    _line(doc, "NOW, THEREFORE, THIS DEED WITNESSES AS UNDER:")
    _line(doc,
          "1. That the partnership constituted under {{ original_deed_ref }}, carried "
          "on under the firm {{ firm_name }}, stands dissolved with effect from "
          "{{ dissolution_date }}.")
    _line(doc, "{% if accounts_settled %}")
    _line(doc,
          "2. That all the accounts of the partnership have been settled, and all "
          "trading results, profits, losses and balances have been checked and "
          "accepted by the parties as per the account books.")
    _line(doc, "{% endif %}")
    _line(doc,
          "3. That all records and account books of the dissolved partnership have "
          "been delivered to {{ records_custodian }}, who shall notify all concerned "
          "authorities of the dissolution.")
    _line(doc,
          "4. That the partners shall be liable for their individual taxes; and each "
          "party releases and discharges the other from all actions, claims and "
          "demands on account of the said partnership.")
    _line(doc,
          "5. That any dispute arising in relation to this deed shall be referred to "
          "a sole arbitrator under the Arbitration and Conciliation Act, 1996.")
    _deed_witnesses(doc, ["FIRST PARTNER", "SECOND PARTNER"])
    _save(doc, "dissolution_deed.docx")


def build_relinquishment_deed():
    doc = Document()
    _review_banner(doc)
    _center(doc, "DEED OF RELINQUISHMENT", bold=True)
    _line(doc)
    _line(doc,
          "THIS DEED OF RELINQUISHMENT is executed at {{ place }} on "
          "{{ execution_date }} BY:")
    _line(doc, "{% for r in releasors %}")
    _line(doc, "   {{ loop.index }}. {{ r.name }}, {{ r.description }};")
    _line(doc, "{% endfor %}")
    _line(doc,
          "(hereinafter collectively called the RELEASORS, which expression shall "
          "include their heirs, successors, legal representatives and executors) of "
          "the FIRST PART; IN FAVOUR OF {{ releasee.name }}, "
          "{{ releasee.description }} (hereinafter called the RELEASEE, which "
          "expression shall include her heirs, successors, legal representatives and "
          "executors) of the SECOND PART.")
    _line(doc,
          "WHEREAS the late {{ deceased_owner }} was the sole and absolute owner of "
          "{{ property_desc }}; AND WHEREAS, on his death, the Releasors and the "
          "Releasee became co-owners of the said property by inheritance; AND WHEREAS "
          "the Releasors are desirous of giving up their {{ releasors_share }} share "
          "in the said property in favour of the Releasee"
          "{% if not for_consideration %}, on account of natural love and affection "
          "and without any consideration{% endif %}.")
    _line(doc)
    _line(doc, "NOW THIS DEED OF RELINQUISHMENT WITNESSES AS UNDER:")
    _line(doc,
          "1. That the Releasors voluntarily, and of their own free will, give up and "
          "release all their right, title and interest to the extent of their "
          "{{ releasors_share }} share in {{ property_desc }} in favour of the "
          "Releasee, who now becomes the sole and absolute owner of the said "
          "property.")
    _line(doc,
          "2. That the Releasors and their heirs are left with no claim, title or "
          "interest in the property hereby relinquished.")
    _line(doc,
          "3. That the possession of the said property is exclusively with the "
          "Releasee, who is entitled to have the property mutated and transferred "
          "into her name on the basis of this deed.")
    _line(doc)
    _line(doc, "SCHEDULE OF PROPERTY:")
    _line(doc, "{{ property_desc }}")
    _deed_witnesses(doc, ["RELEASORS", "RELEASEE"])
    _save(doc, "relinquishment_deed.docx")


def build_gift_deed():
    doc = Document()
    _review_banner(doc)
    _center(doc, "GIFT DEED", bold=True)
    _line(doc)
    _line(doc,
          "THIS GIFT DEED is made and executed at {{ place }} on {{ execution_date }} "
          "BETWEEN {{ donor.name }}, {{ donor.description }} (hereinafter called the "
          "DONOR) of the ONE PART; AND {{ donee.name }}, {{ donee.description }} "
          "(hereinafter called the DONEE) of the OTHER PART. The expressions DONOR "
          "and DONEE shall include their respective heirs, successors, executors, "
          "nominees, assignees and legal representatives.")
    _line(doc, "AND WHEREAS {{ prior_title_recital }}")
    _line(doc,
          "AND WHEREAS the said property is free from all encumbrances, and the Donor "
          "is fully entitled to dispose of the same.")
    _line(doc,
          "AND WHEREAS the Donor has great love and affection for the Donee, being "
          "his/her {{ relation }}, and has agreed to gift, without any monetary "
          "consideration, the property described in the Schedule; and the Donee has "
          "agreed to accept the same.")
    _line(doc)
    _line(doc, "NOW THIS GIFT DEED WITNESSETH AS UNDER:")
    _line(doc,
          "1. That the Donor hereby gifts {{ property_desc }} unto the Donee on "
          "account of natural love and affection.")
    _line(doc,
          "2. That the possession of the gifted property has been handed over and "
          "delivered to the Donee by the Donor.")
    _line(doc,
          "3. That the Donee has become the absolute and exclusive owner of the "
          "gifted property from today, with all rights of ownership therein.")
    _line(doc,
          "4. That the Donor has been left with no right, title, interest or lien "
          "whatsoever in the gifted property henceforth.")
    _line(doc,
          "5. That the market value of the gifted property is assessed at "
          "Rs. {{ market_value }}/-.")
    _line(doc,
          "6. That the Donee shall get the gifted property mutated into his/her name "
          "in the revenue records on the basis of this deed, for which the Donor "
          "conveys his No Objection.")
    _line(doc)
    _line(doc, "SCHEDULE:")
    _line(doc, "{{ property_desc }}")
    _line(doc, "   Boundaries — East: {{ boundaries.east }}; West: "
               "{{ boundaries.west }}; North: {{ boundaries.north }}; South: "
               "{{ boundaries.south }}.")
    _deed_witnesses(doc, ["DONOR", "DONEE"])
    _line(doc, "[NOTE: A gift of immovable property must be effected by a registered "
               "instrument (s.123 of the Transfer of Property Act, 1882).]")
    _save(doc, "gift_deed.docx")


def build_s106_notice():
    doc = Document()
    _review_banner(doc)
    _center(doc, "NOTICE OF EJECTMENT UNDER SECTION 106 OF THE TRANSFER OF PROPERTY "
                 "ACT, 1882", bold=True)
    _line(doc)
    _advocate_letterhead(doc)
    _line(doc, "To,")
    _line(doc, "{{ recipient.name }},")
    _line(doc, "{{ recipient.address }}")
    _line(doc)
    _line(doc, "SUB: NOTICE UNDER SECTION 106 OF THE TRANSFER OF PROPERTY ACT, 1882 "
               "FOR EJECTMENT")
    _line(doc)
    _line(doc, "Dear Sir,")
    _line(doc,
          "Under instructions from and on behalf of my client {{ client }}"
          "{% if client_parentage %}, {{ client_parentage }}{% endif %}"
          "{% if client_address %}, R/o {{ client_address }}{% endif %} (hereinafter "
          "referred to as 'my client'), I serve you with the following notice:")
    _line(doc,
          "1. That {{ property_desc }} is owned by my client, and you were inducted "
          "as a tenant therein at a monthly rent of Rs. {{ monthly_rent }}/-.")
    _line(doc,
          "2. That I hereby give you notice to quit and vacate the said premises, of "
          "which you are in possession as a monthly tenant under my client, on the "
          "expiry of {{ quit_date }}.")
    _line(doc,
          "3. That on and from the day following {{ quit_date }}, the tenancy shall "
          "stand terminated and the relationship of landlord and tenant between my "
          "client and you shall cease.")
    _line(doc,
          "4. That you are called upon to deliver vacant possession of the said "
          "premises to my client on the said date.")
    _line(doc,
          "5. That in case of your failure to quit, you will be treated as a "
          "trespasser and ejected through due process of law, and shall be liable to "
          "pay damages {{ damages_rate_note }} until eviction.")
    _line(doc)
    _line(doc, "Yours faithfully,")
    _line(doc, "{{ advocate }}")
    _line(doc, "Advocate")
    _line(doc, "Place: {{ place }}")
    _line(doc)
    _line(doc, "Copy kept in my office for future reference and use.")
    _save(doc, "s106_notice.docx")


def build_s80_notice():
    doc = Document()
    _review_banner(doc)
    _center(doc, "NOTICE UNDER SECTION 80 OF THE CODE OF CIVIL PROCEDURE, 1908",
            bold=True)
    _line(doc)
    _advocate_letterhead(doc)
    _line(doc, "To,")
    _line(doc, "{{ addressee }},")
    _line(doc, "{{ government_body }}")
    _line(doc)
    _line(doc, "SUB: NOTICE UNDER SECTION 80 OF THE CODE OF CIVIL PROCEDURE, 1908")
    _line(doc)
    _line(doc, "Dear Sir,")
    _line(doc,
          "Under instructions from my client {{ client }}, I hereby give you notice "
          "under s.80 of the Code of Civil Procedure, 1908, and state that my client "
          "intends to sue {{ government_body }} after the expiry of two months from "
          "the service of this notice, unless the reliefs claimed below are granted "
          "within the said period. The particulars required by s.80 are:")
    _line(doc, "(1) Name and description of the plaintiff: "
               "{{ plaintiff_name_description }}.")
    _line(doc, "(2) Cause of action: {{ cause_of_action }}.")
    _line(doc, "(3) Reliefs claimed:")
    _line(doc, "{% for r in reliefs %}")
    _line(doc, "   ({{ 'abcdefghij'[loop.index0] }}) {{ r }}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "Yours faithfully,")
    _line(doc, "{{ advocate }}")
    _line(doc, "Advocate")
    _line(doc, "Place: {{ place }}")
    _line(doc)
    _line(doc, "Copy kept in my office for future reference and use.")
    _save(doc, "s80_notice.docx")


def build_written_statement():
    doc = Document()
    _review_banner(doc)
    _center(doc, "WRITTEN STATEMENT ON BEHALF OF THE DEFENDANT", bold=True)
    _line(doc)
    _center(doc,
            "IN THE COURT OF {% if civil_court %}{{ civil_court }}{% else %}"
            "THE CIVIL JUDGE{% endif %}"
            "{% if city %}, {{ city }}{% endif %}", bold=True)
    _center(doc, "{{ suit_ref }}")
    _line(doc)
    _line(doc,
          "{{ plaintiff.name }}"
          "                          ... PLAINTIFF")
    _center(doc, "VERSUS")
    _line(doc,
          "{{ defendant.name }}"
          "                          ... DEFENDANT")
    _line(doc)
    _center(doc, "WRITTEN STATEMENT ON BEHALF OF THE DEFENDANT", bold=True)
    _line(doc)
    _line(doc, "MOST RESPECTFULLY SHOWETH:")
    _line(doc)
    _line(doc, "PRELIMINARY OBJECTIONS:")
    _line(doc, "{% for o in preliminary_objections %}")
    _line(doc, "   {{ loop.index }}. {{ o.text }}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "ON MERITS:")
    _line(doc,
          "Without prejudice to the preliminary objections stated above, the reply "
          "on merits, which is without prejudice to one another, is as under:")
    _line(doc, "{% for m in merit_replies %}")
    _line(doc, "   {{ m.plaint_para }}. {{ m.text }}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "PRAYER:")
    _line(doc,
          "It is, therefore, most respectfully prayed that this Hon'ble Court may be "
          "pleased to:")
    _line(doc, "(a) dismiss the suit of the plaintiff;")
    _line(doc, "(b) award costs to the defendant; and")
    _prayer_closer(doc, "c")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("DEFENDANT")
    _line(doc, "Place: {{ place }}                          Through")
    _line(doc, "Date:  {% if ws_date %}{{ ws_date }}{% else %}____________"
               "{% endif %}                Advocate")
    _line(doc)
    _line(doc, "VERIFICATION:")
    _line(doc,
          "Verified at {{ place }} on this "
          "{% if ws_date %}{{ ws_date }}{% else %}____________{% endif %} that the "
          "contents of the preliminary objections and the reply on merits are true to "
          "my personal knowledge, save the averments on law which are true on the "
          "basis of legal advice received and believed to be true; the last para is "
          "the prayer to this Hon'ble Court.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("DEFENDANT")
    _line(doc)
    _line(doc, "{% if counter_claim_or_setoff %}[NOTE: A counter-claim / set-off is "
               "joined in this Written Statement and is verified and supported by "
               "affidavit.]{% else %}[NOTE: A counter-claim and set-off may be joined "
               "in the Written Statement, verified and supported by affidavit.]"
               "{% endif %}")
    _save(doc, "written_statement.docx")


def build_s138_reply():
    doc = Document()
    _review_banner(doc)
    _center(doc, "REPLY TO LEGAL NOTICE UNDER SECTION 138 OF THE NEGOTIABLE "
                 "INSTRUMENTS ACT, 1881", bold=True)
    _line(doc)
    _advocate_letterhead(doc)
    _line(doc, "To,")
    _line(doc, "{{ opposing_advocate }}, Advocate")
    _line(doc)
    _line(doc, "SUB: REPLY TO YOUR LEGAL NOTICE UNDER SECTION 138 OF THE NEGOTIABLE "
               "INSTRUMENTS ACT, DATED {{ notice_date }}")
    _line(doc)
    _line(doc, "Dear Sir,")
    _line(doc,
          "Your legal notice dated {{ notice_date }} has been placed before me by my "
          "client {{ client }}"
          "{% if client_address %}, R/o {{ client_address }}{% endif %}, and I am "
          "instructed to reply on his behalf as under:")
    _line(doc,
          "A. That the notice under reply contains false and frivolous facts and "
          "deserves to be withdrawn, as no claim is made out against my client.")
    _line(doc, "B. That the true facts are: {{ defence_slot }}")
    _line(doc, "{% if cheque_in_discharge_denied %}")
    _line(doc,
          "C. That it is specifically denied that the cheque in question was issued "
          "by my client in discharge of any legally enforceable debt or liability "
          "towards your client.")
    _line(doc, "{% endif %}")
    _line(doc, "{% if liability_denied %}")
    _line(doc, "D. That my client denies any liability whatsoever towards your "
               "client.")
    _line(doc, "{% endif %}")
    _line(doc)
    _line(doc,
          "In view of the aforesaid facts, your client is advised to withdraw the "
          "said notice and not to drag my client into frivolous litigation, failing "
          "which my client shall be constrained to contest the same and to proceed "
          "against your client under the relevant provisions of law, at the costs, "
          "risks and consequences of your client.")
    _line(doc)
    _line(doc, "Yours Sincerely,")
    _line(doc, "{{ advocate }}")
    _line(doc, "Advocate")
    _line(doc, "Place: {{ place }}")
    _line(doc)
    _line(doc, "Copy kept in my office for future reference and use.")
    _save(doc, "s138_reply.docx")


# ==========================================================================
# TN / Madras court forms set (generalised for any state).
# Cluster A — advocate appointment / appearance.
# ==========================================================================

def build_vakalatnama():
    doc = Document()
    _review_banner(doc)
    _center(doc, "VAKALATNAMA", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ executant_name }}"
               "                          ... {{ party_role }}")
    _line(doc, "{% if opposite_party_name %}Versus{% endif %}")
    _line(doc, "{% if opposite_party_name %}{{ opposite_party_name }}"
               "                          ... Opposite Party{% endif %}")
    _line(doc)
    _line(doc,
          "I/We, {{ executant_name }}, the {{ party_role }} above-named, do hereby "
          "appoint and retain "
          "{% for a in advocates %}{{ a }}{% if not loop.last %}, {% endif %}"
          "{% endfor %}, Advocate(s), to appear for me/us in the above case and on "
          "my/our behalf to conduct and prosecute (or defend) the same and all "
          "proceedings that may be taken in respect of any application connected "
          "with it{% if kind == 'long' %}, including all proceedings before and "
          "after decree, execution proceedings, and appeals, and to draw any moneys "
          "payable to me/us in the said case, and to depute other counsel to act on "
          "his/their behalf{% endif %}, until the disposal of the case.")
    _line(doc)
    _line(doc,
          "I/We further empower the said Advocate(s) to accept, on my/our behalf, "
          "service of notice of all proceedings in the above case.")
    _line(doc)
    # Read-over-and-explained attestation (long form carries it in full).
    _line(doc,
          "I certify that the contents of this Vakalatnama were read over and "
          "explained{% if state_language %} in {{ state_language }}{% endif %} in my "
          "presence to the executant, who appeared perfectly to understand the same "
          "and signed it in my presence.")
    _line(doc)
    _line(doc, "Executed at {{ place }} on this "
               "{% if execution_date %}{{ execution_date }}{% else %}____________"
               "{% endif %}.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("{{ executant_name }} ({{ party_role }})")
    _line(doc)
    _line(doc, "ACCEPTED,")
    _line(doc, "{% for a in advocates %}{{ a }}{% if not loop.last %}, {% endif %}"
               "{% endfor %}")
    _line(doc, "Advocate(s) for {{ party_role }}")
    _line(doc, "{% if enrolment_no %}Enrolment No.: {{ enrolment_no }}{% endif %}")
    _line(doc, "{% if address_for_service %}Address for service: "
               "{{ address_for_service }}{% endif %}")
    _line(doc, "{% if advocate_mobile %}Mobile: {{ advocate_mobile }}{% endif %}")
    _line(doc, "{% if advocate_email %}Email: {{ advocate_email }}{% endif %}")
    _line(doc, "{% if kind == 'efiling' and party_contact %}Details of the parties: "
               "{{ party_contact }}{% endif %}")
    _save(doc, "vakalatnama.docx")


def build_memo_of_appearance():
    doc = Document()
    _review_banner(doc)
    _center(doc, "MEMO OF APPEARANCE", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ party_name }}"
               "                          ... {{ party_represented }}")
    _line(doc, "{% if opposite_party_name %}Versus{% endif %}")
    _line(doc, "{% if opposite_party_name %}{{ opposite_party_name }}"
               "                          ... Opposite Party{% endif %}")
    _line(doc)
    _line(doc, "{% if addressed_to %}To,{% endif %}")
    _line(doc, "{% if addressed_to %}{{ addressed_to }}{% endif %}")
    _line(doc, "{% if addressed_to %}{% endif %}")
    _line(doc,
          "Please enter my appearance on behalf of the {{ party_represented }} "
          "({{ party_name }}) in the above case, as I have been duly instructed to "
          "appear on their behalf.")
    _line(doc)
    _line(doc, "Place: {{ place }}")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("{{ counsel_name }}")
    _line(doc, "                                        Counsel for "
               "{{ party_represented }}")
    _line(doc, "{% if enrolment_no %}Enrolment No.: {{ enrolment_no }}{% endif %}")
    _save(doc, "memo_of_appearance.docx")


# ==========================================================================
# Cluster B — registry coding sheet.
# ==========================================================================

def build_coding_sheet():
    doc = Document()
    _review_banner(doc)
    _center(doc, "CODING SHEET", bold=True)
    _center(doc, "{% if court_place %}{{ court_place }}{% else %}______{% endif %}")
    _center(doc, "{{ side | upper | replace('_', ' ') }} SIDE")
    _line(doc, "(party portion to be completed by the filing party; case number "
               "and dates are completed by the Registry)")
    _line(doc)
    _line(doc, "{% if senior_citizen %}Senior Citizen: Yes{% endif %}")
    _line(doc, "{% if case_type %}Case Type: {{ case_type }}{% endif %}")
    _line(doc)
    _line(doc, "Petitioner / Appellant: {{ petitioner_name }}")
    _line(doc, "Respondent: {{ respondent_name }}")
    _line(doc, "{% if petitioner_counsel %}Counsel for Petitioner/Appellant: "
               "{{ petitioner_counsel }}{% endif %}")
    _line(doc, "{% if respondent_counsel %}Counsel for Respondent: "
               "{{ respondent_counsel }}{% endif %}")
    _line(doc)
    _line(doc, "Act and provision(s) of law involved: {{ act_and_provision }}")
    _line(doc, "Subject-matter / brief: {{ subject_matter }}")
    _line(doc, "{% if subject_category_code %}Subject / Category Code: "
               "{{ subject_category_code }}{% endif %}")
    _line(doc, "{% if value_of_claim %}Value of the claim/suit/appeal: "
               "{{ value_of_claim }}{% endif %}")
    _line(doc, "{% if court_fee %}Court fee paid: {{ court_fee }}{% endif %}")
    _line(doc, "{% if connected_case %}Connected / previous / covered case: "
               "{{ connected_case }}{% endif %}")
    _line(doc, "{% if lower_court_details %}Lower court details: "
               "{{ lower_court_details }}{% endif %}")
    # Original-side contempt sub-block.
    _line(doc, "{% if order_violated %}Order violated (for contempt petitions): "
               "{{ order_violated }}{% endif %}")
    # Criminal-side block.
    _line(doc, "{% if side == 'criminal' %}Appellant/Petitioner in: "
               "{% if in_jail %}Jail{% else %}Bail{% endif %}{% endif %}")
    _line(doc, "{% if side == 'criminal' and crime_no %}Crime No.: {{ crime_no }}"
               "{% if police_station %}, {{ police_station }} Police Station"
               "{% endif %}{% endif %}")
    _line(doc, "{% if side == 'criminal' and is_hcp %}In case of HCP — Detaining "
               "Authority: {{ detaining_authority }}{% endif %}")
    _save(doc, "coding_sheet.docx")


# ==========================================================================
# Cluster C — process / service applications.
# ==========================================================================

def build_process_application():
    doc = Document()
    _review_banner(doc)
    _center(doc, "APPLICATION FOR ISSUE OF PROCESS", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ applicant_name }}"
               "                          ... {{ applicant_role }}")
    _line(doc, "{% if opposite_party_name %}Versus{% endif %}")
    _line(doc, "{% if opposite_party_name %}{{ opposite_party_name }}"
               "                          ... Opposite Party{% endif %}")
    _line(doc)
    _line(doc, "{% if value_of_claim %}Value of the claim: {{ value_of_claim }}"
               "{% endif %}")
    _line(doc, "{% if court_day %}Court day: {{ court_day }}{% endif %}")
    _line(doc)
    _line(doc,
          "Application is made by the above-named {{ applicant_role }} for the issue "
          "of process (and deposit of witness batta, where applicable) as set out "
          "below:")
    _line(doc, "{% if process_type %}Process sought: {{ process_type }}{% endif %}")
    _line(doc, "{% if service_mode %}Mode of service: {{ service_mode }}{% endif %}")
    _line(doc, "{% if next_hearing_date %}Next date of hearing: "
               "{{ next_hearing_date }}{% endif %}")
    _line(doc)
    _line(doc, "{% for r in rows %}")
    _line(doc, "   {{ loop.index }}. Nature of process: {{ r.nature_of_process }}"
               "{% if r.on_whom %}; on/against: {{ r.on_whom }}{% endif %}"
               "{% if r.place_of_service %}; place of service: "
               "{{ r.place_of_service }}{% endif %}"
               "{% if r.distance_miles %}; distance: {{ r.distance_miles }}{% endif %}"
               "{% if r.travelling_allowance %}; T.A.: {{ r.travelling_allowance }}"
               "{% endif %}"
               "{% if r.subsistence_allowance %}; subsistence: "
               "{{ r.subsistence_allowance }}{% endif %}"
               "{% if r.process_fee %}; process fee: {{ r.process_fee }}{% endif %}"
               "{% if r.remarks %}; remarks: {{ r.remarks }}{% endif %}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "Place: {{ place }}"
               "{% if filing_date %}          Dated: {{ filing_date }}{% endif %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Advocate for {{ applicant_role }}")
    _save(doc, "process_application.docx")


def build_copy_application():
    doc = Document()
    _review_banner(doc)
    _center(doc, "APPLICATION FOR CERTIFIED COPIES", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ applicant_name }}"
               "                          ... {{ applicant_role }}")
    _line(doc, "{% if opposite_party_name %}Versus{% endif %}")
    _line(doc, "{% if opposite_party_name %}{{ opposite_party_name }}"
               "                          ... Opposite Party{% endif %}")
    _line(doc)
    _line(doc, "{% if addressed_to %}To,{% endif %}")
    _line(doc, "{% if addressed_to %}{{ addressed_to }},{% endif %}")
    _line(doc)
    _line(doc,
          "Please furnish me with certified copies of the documents mentioned below"
          "{% if rule_ref %}, under {{ rule_ref }}{% endif %}:")
    _line(doc, "{% for d in documents %}")
    _line(doc, "   {{ loop.index }}. {{ d.description }}"
               "{% if d.date_of_document %} (dated {{ d.date_of_document }})"
               "{% endif %}"
               "{% if d.number_of_copies %}; copies: {{ d.number_of_copies }}"
               "{% endif %}"
               "{% if d.pending_or_final %}; case {{ d.pending_or_final }}{% endif %}"
               "{% if d.order_under_which %}; under order: {{ d.order_under_which }}"
               "{% endif %}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "Place: {{ place }}"
               "{% if filing_date %}          Dated: {{ filing_date }}{% endif %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Counsel for {{ applicant_role }}")
    _save(doc, "copy_application.docx")


def build_call_for_memo():
    # SCAFFOLD ONLY. The committed call_for_memo.docx is hand-authored to the
    # advocate's exact form by templates/build_call_for_memo.py (a standalone
    # builder); this function exists so the drift check sees the template as
    # generator-known (not orphaned) and treats the committed file as authoritative.
    doc = Document()
    _review_banner(doc)
    _center(doc, "CALL FOR MEMO", bold=True)
    _line(doc)
    _line(doc, "In the Court of Hon'ble Judicial Magistrate"
               "{% if court_name %} {{ court_name }}{% endif %}")
    _line(doc, "{{ complainant_name }}"
               "                          ... Complainant")
    _center(doc, "-Versus-")
    _line(doc, "{{ accused_name }}"
               "                          ... Accused")
    _line(doc)
    _line(doc, "It is submitted that the above named accused persons applied for "
               "certified copy of the following documents.")
    _line(doc, "{% for d in documents %}")
    _line(doc, "   {{ loop.index }}) {{ d }}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "For the above and the office called for deposit Court fee of Rs. "
               "{% if court_fee %}{{ court_fee }}{% endif %} /- the same is herewith "
               "deposited it may be accepted and thus render justice.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("COUNSEL FOR ACCUSED")
    _save(doc, "call_for_memo.docx")


def build_batta_witness():
    # SCAFFOLD ONLY. The committed batta_witness.docx is hand-authored to the
    # advocate's exact wide 10-column form by templates/build_batta_witness.py
    # (a standalone builder); this exists so the drift check sees the template as
    # generator-known (not orphaned) and treats the committed file as authoritative.
    doc = Document()
    _review_banner(doc)
    _line(doc, "{% if court_name %}IN THE COURT OF {{ court_name }}"
               "{% else %}IN THE COURT OF ______{% endif %}")
    _line(doc, "{{ plaintiff_name }}                          ... Plaintiff")
    _line(doc, "{{ defendant_name }}                          ... Defendant")
    _line(doc, "Application made by the above named Plaintiff - Defendant for issue "
               "of Process (and Deposit of witness Batta Etc.)")
    _line(doc, "{% for r in rows %}")
    _line(doc, "   {{ r.nature_of_process }} — {{ r.person_description }} — "
               "{{ r.place_of_service }}")
    _line(doc, "{% endfor %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Counsel for {{ applicant_role }}")
    _save(doc, "batta_witness.docx")


def build_recall_petition():
    # SCAFFOLD ONLY. The committed recall_petition.docx is hand-authored to the
    # advocate's exact form by templates/build_recall_petition.py (a standalone
    # builder); this exists so the drift check treats the committed file as
    # authoritative (not orphaned).
    doc = Document()
    _review_banner(doc)
    _line(doc, "{% if court_name %}In the Court of Hon'ble Judicial Magistrate "
               "{{ court_name }}{% else %}In the Court of Hon'ble Judicial "
               "Magistrate{% endif %}")
    _line(doc, "C.C. / Crime No. {{ cc_no }}")
    _line(doc, "{{ accused_name }}                          ... Petitioner / Accused")
    _center(doc, "-Vs-")
    _line(doc, "{{ complainant_name }}                          Complainant / Respondent")
    _center(doc, "PETITION U/S.70 (2) Cr.P.C.", bold=True)
    _line(doc, "The above named accused was / were unable to attend this Honourable "
               "court.")
    _line(doc, "It is therefore prayed that this Honourable Court may be pleased to "
               "recall the warrant of arrest issued against the accused, cancel the "
               "same and release the accused on his / her / their own bond and render "
               "Justice.")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Counsel for the Accused")
    _save(doc, "recall_petition.docx")


def build_process_memo():
    # SCAFFOLD ONLY. The committed process_memo.docx is hand-authored to the
    # advocate's exact form by templates/build_process_memo.py (a standalone
    # builder); this exists so the drift check treats the committed file as
    # authoritative (not orphaned).
    doc = Document()
    _review_banner(doc)
    _line(doc, "{% if court_name %}IN THE COURT OF {{ court_name }} MAGISTRATE"
               "{% else %}IN THE COURT OF ______ MAGISTRATE{% endif %}")
    _line(doc, "DVC No. {{ case_no }} OF 20{{ case_year }}")
    _line(doc, "{{ petitioner_name }}                          - Petitioner")
    _center(doc, "- Vs -")
    _line(doc, "{{ respondent_name }}                          - Respondents")
    _center(doc, "PROCESS MEMO", bold=True)
    _line(doc, "It is prayed that this Hon'ble court may be pleased issue "
               "{% if process_type %}{{ process_type }}{% else %}summons / warrant"
               "{% endif %} to the above named accused / Petitioner in the following "
               "address and thus render justice.")
    _line(doc, "Address for Service {{ address_for_service }}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("COUNSEL FOR THE PETITIONER")
    _save(doc, "process_memo.docx")


def build_surety_memo():
    # SCAFFOLD ONLY. The committed surety_memo.docx is hand-authored to the
    # advocate's exact form by templates/build_surety_memo.py (a standalone
    # builder); this exists so the drift check treats the committed file as
    # authoritative (not orphaned).
    doc = Document()
    _review_banner(doc)
    _line(doc, "{% if court_name %}IN THE COURT OF {{ court_name }} MAGISTRATE"
               "{% else %}IN THE COURT OF ______ MAGISTRATE{% endif %}")
    _line(doc, "Crime No. {{ crime_no }} of {{ crime_year }}")
    _line(doc, "(On the file of the Respondent)")
    _line(doc, "State : {{ state_name }}")
    _line(doc, "Inspector of Police, {{ police_inspector }}                --- Complainant")
    _center(doc, "- Versus -")
    _line(doc, "{{ accused_name }}                --- Accused")
    _center(doc, "SURETY MEMO", bold=True)
    _line(doc, "It is submitted that as per the orders of this Hon'ble Court, the "
               "sureties is being furnished for the accused above named, it may be "
               "accepted and the accused may be released on bail and thus render "
               "justice.")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Counsel For Petitioner / Accused")
    _save(doc, "surety_memo.docx")


def build_affidavit_of_surety():
    # SCAFFOLD ONLY. The committed affidavit_of_surety.docx is hand-authored to the
    # advocate's exact 4-page statutory Rule-14 form by
    # templates/build_affidavit_of_surety.py (a standalone builder); this exists so
    # the drift check treats the committed file as authoritative (not orphaned).
    doc = Document()
    _review_banner(doc)
    _line(doc, "{% if court_name %}IN THE COURT OF {{ court_name }} MAGISTRATE"
               "{% else %}IN THE COURT OF ______ MAGISTRATE{% endif %}")
    _line(doc, "Crime No. {{ crime_no }} of {{ crime_year }}")
    _line(doc, "(On the file of the Complainant)")
    _line(doc, "State : {{ state_name }}")
    _center(doc, "- Versus -")
    _center(doc, "AFFIDAVIT OF SURETY", bold=True)
    _line(doc, "1. I beg to offer myself as a surety for the accused Mr "
               "{{ accused_name }} who is charged under sections {{ offence_sections }} "
               "and who has been ordered to be released on bail in the sum of "
               "Rs {{ bail_sum }}.")
    _line(doc, "2. I give below certain particulars concerning myself:")
    _line(doc, "5. I pray that I may be accepted as a surety for the above mentioned "
               "accused.")
    _line(doc, "Signature of Surety")
    _save(doc, "affidavit_of_surety.docx")


def build_service_of_process_application():
    doc = Document()
    _review_banner(doc)
    _center(doc, "APPLICATION FOR SERVICE OF PROCESS", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{% if court_fee_amount %}Court fee affixed: {{ court_fee_amount }}"
               "{% endif %}")
    _line(doc, "{% if hearing_date %}Date of hearing: {{ hearing_date }}{% endif %}")
    _line(doc)
    _line(doc, "The following respondents are to be served with the process of this "
               "Court:")
    _line(doc, "{% for r in respondents %}")
    _line(doc, "   {{ loop.index }}. {{ r.name }}"
               "{% if r.father_or_guardian %}, {{ r.father_or_guardian }}{% endif %}"
               "{% if r.occupation %}, {{ r.occupation }}{% endif %}"
               "{% if r.village_town_address %}, {{ r.village_town_address }}"
               "{% endif %}"
               "{% if r.taluk %}, Taluk {{ r.taluk }}{% endif %}"
               "{% if r.district %}, District {{ r.district }}{% endif %}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "Place: {{ place }}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Advocate for Petitioner")
    _save(doc, "service_of_process_application.docx")


def build_affidavit_of_service():
    doc = Document()
    _review_banner(doc)
    _center(doc, "AFFIDAVIT OF SERVICE", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ petitioner_name }}"
               "                          ... Petitioner")
    _center(doc, "Versus")
    _line(doc, "{{ respondent_name }}"
               "                          ... Respondent")
    _line(doc)
    _line(doc,
          "I, {{ deponent_name }}"
          "{% if deponent_parentage %}, {{ deponent_parentage }}{% endif %}"
          "{% if religion %}, {{ religion }}{% endif %}"
          "{% if deponent_age %}, aged about {{ deponent_age }} years{% endif %}"
          "{% if deponent_address %}, residing at {{ deponent_address }}{% endif %}, "
          "do hereby solemnly affirm and state as follows:")
    _line(doc)
    _line(doc, "1. I am the {{ deponent_role }} and am well acquainted with the facts "
               "of the case.")
    _line(doc,
          "2. In the above matter, notice to the respondent was ordered, returnable "
          "by {{ notice_returnable_date }}. As per the orders of this Hon'ble Court, "
          "notice was taken out to the respondent.")
    _line(doc,
          "3. The registered cover sent to the respondent has been returned to the "
          "sender with an endorsement that the addressee "
          "{% if endorsement == 'left' %}has left the address"
          "{% elif endorsement == 'refused' %}has refused to receive it"
          "{% else %}has not claimed it{% endif %}. This may kindly be recorded and "
          "further orders passed.")
    _line(doc)
    _line(doc, "Solemnly affirmed at {{ place }} on this "
               "{% if affirm_date %}{{ affirm_date }}{% else %}____________"
               "{% endif %}.")
    _line(doc)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Deponent")
    _line(doc, "Before me,")
    _line(doc, "Advocate")
    _save(doc, "affidavit_of_service.docx")


def build_substituted_service():
    doc = Document()
    _review_banner(doc)
    _center(doc, "PETITION UNDER ORDER V RULE 20 OF THE CODE OF CIVIL PROCEDURE, "
                 "1908", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ petitioner_name }}"
               "                          ... Petitioner/Plaintiff")
    _center(doc, "Versus")
    _line(doc, "{{ respondent_name }}"
               "                          ... Respondent/Defendant")
    _line(doc)
    _line(doc, "AFFIDAVIT")
    _line(doc,
          "I, {{ deponent_name }}"
          "{% if deponent_parentage %}, {{ deponent_parentage }}{% endif %}"
          "{% if deponent_age %}, aged about {{ deponent_age }} years{% endif %}"
          "{% if deponent_address %}, residing at {{ deponent_address }}{% endif %}, "
          "the {{ deponent_role }}, do hereby solemnly affirm and state as follows:")
    _line(doc,
          "1. The plaintiff took out summons to the defendant's address. On "
          "{{ prior_service_attempts }} occasion(s) the defendant evaded receipt of "
          "the summons, and it has not been possible to serve the defendant in the "
          "ordinary course.")
    _line(doc,
          "2. As the defendant is purposely evading service, it is not possible to "
          "serve the defendant in the ordinary way.")
    _line(doc)
    _line(doc,
          "It is, therefore, prayed that this Hon'ble Court may be pleased to order "
          "substituted service on the defendant "
          "{% if affix_court_notice_board %}(a) by affixture on the Court Notice "
          "Board{% endif %}"
          "{% if affix_last_known_residence %} and on the last known residence"
          "{% endif %}, and (b) by publication in one issue of {{ newspaper }}, and "
          "render justice.")
    _line(doc)
    _line(doc, "Place: {{ place }}"
               "{% if filing_date %}          Dated: {{ filing_date }}{% endif %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Advocate for Petitioner/Plaintiff")
    _save(doc, "substituted_service.docx")


# ==========================================================================
# Cluster D — bail-support instruments.
# ==========================================================================

def build_bail_bond():
    doc = Document()
    _review_banner(doc)
    _center(doc, "BAIL BOND", bold=True)
    _center(doc, "(Under Sections 389, 437, 438, 439 & 441 of the Code of Criminal "
                 "Procedure)")
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{% if complainant_name %}{{ complainant_name }}"
               "                          ... Complainant{% endif %}")
    _line(doc, "{% if complainant_name %}Versus{% endif %}")
    _line(doc, "{{ accused_name }}"
               "                          ... Accused")
    _line(doc)
    _line(doc,
          "Whereas I, {{ accused_name }}, have been charged with the offence "
          "punishable under {{ offence_section }}, and whereas I have been admitted "
          "to bail by {{ bail_order_court }} by its order dated {{ bail_order_date }};")
    _line(doc,
          "I do hereby bind myself to attend before this Court "
          "{% if attend_date %}on {{ attend_date }} and thereafter{% endif %} "
          "whenever required by the Court, pending disposal of the matter; and in "
          "case of default I bind myself to forfeit to the Government the sum of "
          "Rs. {{ forfeiture_sum }}.")
    _line(doc)
    _line(doc, "Dated at {{ place }} on this "
               "{% if bond_date %}{{ bond_date }}{% else %}____________{% endif %}.")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Signature of the Accused")
    _line(doc)
    _line(doc, "SURETIES:")
    _line(doc, "{% for s in sureties %}")
    _line(doc, "   {{ loop.index }}. {{ s.name }}"
               "{% if s.address %}, {{ s.address }}{% endif %}"
               "{% if s.forfeiture_sum %} — in the sum of Rs. {{ s.forfeiture_sum }}"
               "{% endif %}, who binds himself/herself to produce the accused before "
               "the Court whenever required, in default whereof to forfeit the said "
               "sum to the Government.")
    _line(doc, "{% endfor %}")
    _save(doc, "bail_bond.docx")


def build_surety_affidavit():
    doc = Document()
    _review_banner(doc)
    _center(doc, "SURETY AFFIDAVIT", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{% if state_rep_by %}{{ state_rep_by }}"
               "                          ... Complainant{% endif %}")
    _line(doc, "{% if crime_no %}(Crime No. {{ crime_no }}){% endif %}")
    _center(doc, "Versus")
    _line(doc, "{{ accused_name }}"
               "                          ... Accused")
    _line(doc)
    _line(doc,
          "I, {{ surety_name }}"
          "{% if surety_address %}, residing at {{ surety_address }}{% endif %}"
          "{% if surety_occupation %}, {{ surety_occupation }}{% endif %}, do hereby "
          "solemnly affirm and state as follows:")
    _line(doc,
          "1. I beg to offer myself as a surety for the accused, "
          "{{ accused_name }}, who is charged under {{ offence_section }} and who has "
          "been ordered to be released on bail in the sum of Rs. {{ bail_sum }}.")
    _line(doc, "2. Particulars concerning myself:")
    _line(doc, "   {% if surety_occupation %}Occupation/business: "
               "{{ surety_occupation }}{% endif %}")
    _line(doc, "   {% if monthly_income %}Monthly income: {{ monthly_income }}"
               "{% endif %}")
    _line(doc, "   {% if property_particulars %}Property owned: "
               "{{ property_particulars }}{% endif %}")
    _line(doc, "   {% if surety_relationship_to_accused %}Relationship to the "
               "accused: {{ surety_relationship_to_accused }}{% endif %}")
    _line(doc, "   {% if prior_suretyships %}Prior suretyships: "
               "{{ prior_suretyships }}{% endif %}")
    _line(doc, "3. In support of the above I produce the following proof of identity "
               "and means:")
    _line(doc, "{% for p in id_proofs %}")
    _line(doc, "   ({{ 'abcdefghij'[loop.index0] }}) {{ p }}")
    _line(doc, "{% endfor %}")
    _line(doc,
          "4. I pray that I may be accepted as a surety for the above-mentioned "
          "accused in the sum of Rs. {{ bail_sum }}.")
    _line(doc)
    _line(doc, "Solemnly affirmed at {{ place }} on this "
               "{% if affirm_date %}{{ affirm_date }}{% else %}____________"
               "{% endif %}.")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Signature of Surety")
    _save(doc, "surety_affidavit.docx")


def build_memorandum_furnish_sureties():
    doc = Document()
    _review_banner(doc)
    _center(doc, "MEMORANDUM", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ accused_name }}"
               "                          ... Petitioner/Accused")
    _line(doc, "{% if complainant_name %}Versus{% endif %}")
    _line(doc, "{% if complainant_name %}{{ complainant_name }}"
               "                          ... Respondent/Complainant{% endif %}")
    _line(doc)
    _line(doc,
          "The petitioner has been granted bail by {{ granting_court }} in "
          "{{ bail_order_ref }} by its order dated {{ bail_order_date }}.")
    _line(doc,
          "In obedience to the above order, the petitioner herein offers sureties "
          "for his/her release on bail.")
    _line(doc,
          "It is, therefore, prayed that this Hon'ble Court may be pleased to permit "
          "the petitioner to furnish sureties for his/her release on bail and render "
          "justice.")
    _line(doc)
    _line(doc, "Dated at {{ place }} on this "
               "{% if memo_date %}{{ memo_date }}{% else %}____________{% endif %}.")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Counsel for the Petitioner/Accused")
    _save(doc, "memorandum_furnish_sureties.docx")


def build_surrender_petition():
    doc = Document()
    _review_banner(doc)
    _center(doc, "SURRENDER PETITION", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ accused_name }}"
               "                          ... Petitioner/Accused")
    _line(doc, "{% if complainant_name or state_rep_by %}Versus{% endif %}")
    _line(doc, "{% if state_rep_by %}{{ state_rep_by }}"
               "{% if police_station %}, {{ police_station }} Police Station"
               "{% endif %}                          ... Respondent/Complainant"
               "{% elif complainant_name %}{{ complainant_name }}"
               "                          ... Respondent/Complainant{% endif %}")
    _line(doc, "{% if crime_no %}(Crime No. {{ crime_no }}){% endif %}")
    _line(doc)
    _line(doc,
          "1. The accused above-named is a law-abiding citizen"
          "{% if accused_address %}, permanently residing at {{ accused_address }}"
          "{% endif %}.")
    _line(doc,
          "2. The name of the accused has been implicated in the above crime number "
          "for an offence under {{ offence_section }}.")
    _line(doc,
          "3. The accused, being a law-abiding citizen, voluntarily surrenders "
          "before this Hon'ble Court.")
    _line(doc,
          "It is, therefore, prayed that this Hon'ble Court may be pleased to accept "
          "the surrender of the accused and render justice.")
    _line(doc)
    _line(doc, "Dated at {{ place }} on this "
               "{% if petition_date %}{{ petition_date }}{% else %}____________"
               "{% endif %}.")
    _line(doc)
    _line(doc, "IDENTIFICATION MARKS OF THE ACCUSED:")
    _line(doc, "{% for m in identification_marks %}")
    _line(doc, "   {{ loop.index }}. {{ m }}")
    _line(doc, "{% endfor %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Petitioner/Accused")
    _save(doc, "surrender_petition.docx")


# ==========================================================================
# Cluster E — criminal interlocutory petitions.
# ==========================================================================

def build_s256_condone_absence():
    doc = Document()
    _review_banner(doc)
    _center(doc, "PETITION UNDER SECTION 256 OF THE CODE OF CRIMINAL PROCEDURE",
            bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ complainant_name }}"
               "                          ... Complainant")
    _center(doc, "Versus")
    _line(doc, "{{ accused_name }}"
               "                          ... Accused")
    _line(doc)
    _line(doc,
          "The complainant above-named is unable to attend this Hon'ble Court today, "
          "as {{ absence_reason }}.")
    _line(doc,
          "It is, therefore, prayed that this Hon'ble Court may be pleased to condone "
          "the absence of the complainant today and permit the complainant to be "
          "represented by counsel under Section 256 of the Code of Criminal "
          "Procedure, and render justice.")
    _line(doc)
    _line(doc, "Place: {{ place }}"
               "{% if petition_date %}          Dated: {{ petition_date }}{% endif %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Counsel for Complainant")
    _save(doc, "s256_condone_absence.docx")


def build_s317_dispense_presence():
    doc = Document()
    _review_banner(doc)
    _center(doc, "PETITION UNDER SECTION 317 OF THE CODE OF CRIMINAL PROCEDURE",
            bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ complainant_name }}"
               "                          ... Complainant")
    _center(doc, "Versus")
    _line(doc, "{{ accused_name }}"
               "                          ... Accused")
    _line(doc)
    _line(doc, "The accused is unable to appear before this Hon'ble Court today, as "
               "{{ absence_reason }}.")
    _line(doc,
          "The absence of the accused is neither wanton nor wilful. It is prayed "
          "that this Hon'ble Court may be pleased to condone the absence of the "
          "accused, dispense with the personal attendance of the accused, and permit "
          "counsel for the accused to represent the accused in this case today.")
    _line(doc)
    _line(doc, "Place: {{ place }}"
               "{% if petition_date %}          Dated: {{ petition_date }}{% endif %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Counsel for the Accused")
    _save(doc, "s317_dispense_presence.docx")


def build_recall_warrant():
    doc = Document()
    _review_banner(doc)
    _center(doc, "PETITION UNDER SECTION 70(2) OF THE CODE OF CRIMINAL PROCEDURE TO "
                 "RECALL WARRANT", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ accused_name }}"
               "                          ... Petitioner/Accused")
    _line(doc, "{% if state_rep_by %}Versus{% endif %}")
    _line(doc, "{% if state_rep_by %}{{ state_rep_by }}"
               "{% if police_station %}, {{ police_station }} Police Station"
               "{% endif %}                          ... Respondent/Complainant"
               "{% endif %}")
    _line(doc)
    _line(doc, "1. The petitioner/accused was unable to appear before this Hon'ble "
               "Court, as {{ absence_reason }}.")
    _line(doc, "2. The absence of the petitioner/accused was neither wilful nor "
               "wanton; it was due to the reason stated above.")
    _line(doc, "3. The petitioner/accused undertakes to appear promptly and "
               "regularly before this Hon'ble Court in future.")
    _line(doc,
          "It is, therefore, prayed that this Hon'ble Court may be pleased to recall "
          "the warrant pending against the petitioner/accused and render justice.")
    _line(doc)
    _line(doc, "Place: {{ place }}"
               "{% if petition_date %}          Dated: {{ petition_date }}{% endif %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Counsel for the Accused")
    _save(doc, "recall_warrant.docx")


# ==========================================================================
# Cluster F — civil interlocutory petitions.
# ==========================================================================

def build_adjournment_petition():
    doc = Document()
    _review_banner(doc)
    _center(doc, "PETITION FOR ADJOURNMENT UNDER ORDER XVII RULE 1 OF THE CODE OF "
                 "CIVIL PROCEDURE", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ petitioner_name }}"
               "                          ... Petitioner")
    _center(doc, "Versus")
    _line(doc, "{{ respondent_name }}"
               "                          ... Respondent")
    _line(doc)
    _line(doc, "The petitioner above-named respectfully submits as follows:")
    _line(doc, "1. The above case is posted today for {{ posted_for }}.")
    _line(doc, "2. {{ adjournment_reason }}.")
    _line(doc,
          "It is, therefore, prayed that this Hon'ble Court may be pleased to adjourn "
          "the above case to some other date and render justice.")
    _line(doc)
    _line(doc, "Place: {{ place }}"
               "{% if petition_date %}          Dated: {{ petition_date }}{% endif %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Counsel for Petitioner")
    _save(doc, "adjournment_petition.docx")


def build_urgent_petition():
    doc = Document()
    _review_banner(doc)
    _center(doc, "URGENT PETITION (UNDER SECTION 151 OF THE CODE OF CIVIL "
                 "PROCEDURE)", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ petitioner_name }}"
               "                          ... Petitioner")
    _center(doc, "Versus")
    _line(doc, "{{ respondent_name }}"
               "                          ... Respondent")
    _line(doc)
    _line(doc,
          "The petitioner above-named prays that the application taken out by the "
          "petitioner herein, namely {{ underlying_application }}, seeking "
          "{{ orders_prayed }}, may be treated as urgent.")
    _line(doc)
    _line(doc, "Place: {{ place }}"
               "{% if petition_date %}          Dated: {{ petition_date }}{% endif %}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Advocate for Petitioner")
    _save(doc, "urgent_petition.docx")


def build_appeal_record_cost_schedule():
    doc = Document()
    _review_banner(doc)
    _center(doc, "LIST OF DOCUMENTS TO BE TRANSLATED AND PRINTED", bold=True)
    _center(doc, "(Estimate of translation and printing cost — Form 476)")
    _line(doc)
    _line(doc, "{% if court_type %}In the {{ court_type }}"
               "{% if court_place %} of {{ court_place }}{% endif %}"
               "{% else %}In the ______ Court{% endif %}")
    _line(doc, "{{ appeal_ref }}")
    _line(doc, "On behalf of: {{ on_behalf_of }}")
    _line(doc)
    _line(doc, "{% for d in documents %}")
    _line(doc, "   {{ loop.index }}. {{ d.description }}"
               "{% if d.mark_in_lower_court %} (mark in lower court: "
               "{{ d.mark_in_lower_court }}){% endif %}"
               "{% if d.whole_or_part %}; {{ d.whole_or_part }}{% endif %}"
               "{% if d.pages_translation %}; pages to translate: "
               "{{ d.pages_translation }}{% endif %}"
               "{% if d.pages_printing %}; pages to print: {{ d.pages_printing }}"
               "{% endif %}"
               "{% if d.cost_estimate %}; estimated cost: {{ d.cost_estimate }}"
               "{% endif %}")
    _line(doc, "{% endfor %}")
    _line(doc)
    _line(doc, "{% if copies_required %}Copies of the record required in addition to "
               "the first copy: {{ copies_required }}{% endif %}")
    _line(doc)
    _line(doc, "Place: {{ place }}")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("{% if counsel_name %}{{ counsel_name }}{% endif %}")
    _line(doc, "                                        Counsel for the Appellant")
    _save(doc, "appeal_record_cost_schedule.docx")


# ==========================================================================
# Cluster G — COURT-ISSUED instruments (advocate prepares the draft).
# ==========================================================================

def build_summons():
    doc = Document()
    _review_banner(doc)
    _court_issues_banner(doc)
    _center(doc, "SUMMONS", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ plaintiff_name }}"
               "                          ... Plaintiff")
    _center(doc, "Versus")
    _line(doc, "{{ defendant_or_witness_name }}"
               "                          ... "
               "{% if kind == 'witness' %}Witness{% else %}Defendant{% endif %}")
    _line(doc)
    _line(doc, "To, {{ defendant_or_witness_name }}")
    _line(doc)
    # Civil defendant summons (Order V CPC).
    _line(doc, "{% if kind == 'civil_defendant' %}")
    _line(doc,
          "Whereas the plaintiff has instituted a suit against you"
          "{% if cause_of_action %} for {{ cause_of_action }}{% endif %}, you are "
          "hereby summoned to appear before this Court, in person or by a pleader "
          "duly instructed, "
          "{% if appearance_date %}on {{ appearance_date }}{% else %}on the date "
          "fixed{% endif %} to answer the claim; and take notice that, in default of "
          "your appearance, the suit will be heard and determined in your absence.")
    _line(doc, "{% endif %}")
    # Witness summons (Order XVI CPC).
    _line(doc, "{% if kind == 'witness' %}")
    _line(doc,
          "You are hereby summoned to appear before this Court "
          "{% if appearance_date %}on {{ appearance_date }}{% else %}on the date "
          "fixed{% endif %} to give evidence"
          "{% if documents_to_produce %} and to produce the following documents: "
          "{{ documents_to_produce }}{% endif %}. "
          "{% if expenses_tendered %}A sum of {{ expenses_tendered }} is tendered "
          "herewith towards your travelling and subsistence expenses. {% endif %}"
          "If you fail to comply, you will be liable to be dealt with according to "
          "law.")
    _line(doc, "{% endif %}")
    # Summary-suit summons (Order XXXVII Rule 2 CPC).
    _line(doc, "{% if kind == 'summary_suit' %}")
    _line(doc,
          "Whereas the plaintiff has instituted a suit against you under Order XXXVII "
          "of the Code of Civil Procedure, 1908, for Rs. {{ claim_amount }}"
          "{% if costs %} and Rs. {{ costs }} for costs{% endif %}, you are hereby "
          "summoned to cause an appearance to be entered for you within ten days "
          "from the service hereof, in default whereof the plaintiff will be "
          "entitled to obtain a decree. If you enter appearance, you may apply for "
          "leave to defend the suit.")
    _line(doc, "{% endif %}")
    _line(doc)
    _line(doc, "Given under the hand and seal of the Court "
               "{% if seal_date %}on {{ seal_date }}{% else %}on the date of issue"
               "{% endif %}.")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("By Order of the Court")
    _save(doc, "summons.docx")


def build_court_notice():
    doc = Document()
    _review_banner(doc)
    _court_issues_banner(doc)
    _center(doc, "NOTICE", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ applicant_or_petitioner_name }}"
               "                          ... Applicant/Petitioner")
    _line(doc)
    _line(doc, "To, {{ addressee_name }}")
    _line(doc)
    # Show-cause / appear-in-person.
    _line(doc, "{% if kind == 'show_cause' or kind == 'appear_person' %}")
    _line(doc,
          "Whereas the above-named applicant has made an application to this Court "
          "for {{ application_or_relief }}, you are hereby warned to appear in this "
          "Court, in person or by a pleader duly instructed, "
          "{% if appearance_date %}on {{ appearance_date }}{% else %}on the date "
          "fixed{% endif %} to show cause against the application, failing which the "
          "said application will be heard and determined ex parte.")
    _line(doc, "{% endif %}")
    # Family court notice.
    _line(doc, "{% if kind == 'family_court' %}")
    _line(doc,
          "Whereas the above-named petitioner has filed a petition against you "
          "seeking {{ application_or_relief }}, you are hereby required to appear in "
          "this Court "
          "{% if appearance_date %}on {{ appearance_date }}{% endif %} in person to "
          "answer all material questions relating to the proceedings, and to file a "
          "written statement "
          "{% if written_statement_date %}on or before {{ written_statement_date }}"
          "{% endif %}. This notice shall be served not less than twenty-one days "
          "before the date fixed for settlement of issues. In default of your "
          "appearance, the petition will be heard and determined in your absence.")
    _line(doc, "{% endif %}")
    # Appeal notice (Order XLI CPC).
    _line(doc, "{% if kind == 'appeal_notice' %}")
    _line(doc,
          "Take notice that an appeal from the decree/order in "
          "{{ application_or_relief }} has been presented and registered in this "
          "Court, and that "
          "{% if appearance_date %}{{ appearance_date }}{% else %}a date{% endif %} "
          "has been fixed for the hearing of the appeal. If no appearance is made on "
          "your behalf, the appeal will be heard and decided in your absence.")
    _line(doc, "{% endif %}")
    # Production summons (Order XVI CPC).
    _line(doc, "{% if kind == 'produce_documents' %}")
    _line(doc,
          "Whereas it has been made to appear that the following documents now in "
          "your custody are of material importance in the above matter, you are "
          "hereby required to produce before this Court "
          "{% if appearance_date %}on {{ appearance_date }}{% endif %} the following "
          "documents: {{ documents_description }}.")
    _line(doc, "{% endif %}")
    _line(doc)
    _line(doc, "Given under the hand and seal of the Court "
               "{% if seal_date %}on {{ seal_date }}{% else %}on the date of issue"
               "{% endif %}.")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("By Order of the Court")
    _save(doc, "court_notice.docx")


def build_court_warrant():
    doc = Document()
    _review_banner(doc)
    _court_issues_banner(doc)
    _center(doc, "{% if kind == 'injunction_order' %}ORDER OF INTERIM INJUNCTION"
                 "{% else %}WARRANT{% endif %}", bold=True)
    _line(doc)
    _tn_court_line(doc)
    _line(doc, "{{ decree_holder_or_petitioner_name }}"
               "                          ... "
               "{% if kind == 'injunction_order' %}Petitioner{% else %}Decree-Holder"
               "{% endif %}")
    _center(doc, "Versus")
    _line(doc, "{{ judgment_debtor_or_respondent_name }}"
               "                          ... "
               "{% if kind == 'injunction_order' %}Respondent{% else %}"
               "Judgment-Debtor{% endif %}")
    _line(doc)
    _line(doc, "{% if addressed_to %}To, {{ addressed_to }}{% endif %}")
    _line(doc)
    # Attachment of immovable property (Order XXI Rule 54).
    _line(doc, "{% if kind == 'attach_immovable' %}")
    _line(doc,
          "Whereas you have failed to satisfy the decree/order in "
          "{{ decree_or_order_ref }} dated {{ decree_or_order_date }}, it is ordered "
          "that you be, and are hereby, prohibited and restrained, until further "
          "order of this Court, from transferring or charging the property specified "
          "in the schedule below, by sale, gift or otherwise, and that all persons "
          "be prohibited from receiving the same by purchase, gift or otherwise.")
    _line(doc, "{% endif %}")
    # Attachment of movable property (Order XXI).
    _line(doc, "{% if kind == 'attach_movable' %}")
    _line(doc,
          "Whereas the decree/order in {{ decree_or_order_ref }} dated "
          "{{ decree_or_order_date }} directing payment"
          "{% if amount_due %} of Rs. {{ amount_due }}{% endif %} has not been "
          "satisfied, you are commanded to attach the movable property of the "
          "judgment-debtor set forth in the schedule below, and to hold the same "
          "until further orders of this Court.")
    _line(doc, "{% endif %}")
    # Delivery of possession.
    _line(doc, "{% if kind == 'possession' %}")
    _line(doc,
          "Whereas the property described in the schedule below, in the occupancy of "
          "the judgment-debtor/respondent, has been ordered to be delivered to the "
          "decree-holder/petitioner in {{ decree_or_order_ref }} dated "
          "{{ decree_or_order_date }}, you are hereby directed to put the said "
          "decree-holder/petitioner in possession of the same, and are authorised to "
          "remove any person bound by the order who refuses to vacate.")
    _line(doc, "{% endif %}")
    # Interim injunction order (Order XXXIX Rules 1 & 2).
    _line(doc, "{% if kind == 'injunction_order' %}")
    _line(doc,
          "Upon the motion made to this Court and upon reading the plaint, the "
          "petition and the affidavit filed in support, this Court doth order that "
          "an interim injunction be granted restraining you, the respondent, from "
          "{{ restraint_text }}, until further orders of this Court.")
    _line(doc, "{% endif %}")
    _line(doc)
    _line(doc, "{% if property_schedule %}SCHEDULE:{% endif %}")
    _line(doc, "{% if property_schedule %}{{ property_schedule }}{% endif %}")
    _line(doc)
    _line(doc, "Given under the hand and seal of the Court "
               "{% if seal_date %}on {{ seal_date }}{% else %}on the date of issue"
               "{% endif %}.")
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("By Order of the Court")
    _save(doc, "court_warrant.docx")


def _build_all():
    """Invoke every build_* function. Each saves via _save(), which enforces the
    overwrite guard, so this is safe to call in scaffold-only mode."""
    build_cause_title()
    build_verification()
    build_affidavit()
    build_prayer()
    build_s138_notice()
    build_default_bail()
    build_anticipatory_bail()
    build_regular_bail()
    build_general_notice()
    build_s138_complaint()
    build_injunction()
    build_plaint()
    build_summary_suit()
    build_writ_petition()
    build_maintenance()
    build_dv_application()
    build_consumer_complaint()
    build_mact_claim()
    build_divorce_contested()
    build_divorce_mutual_first()
    build_divorce_mutual_second()
    # Batch 3 — new pleadings from the DPC book.
    build_permanent_injunction()
    build_specific_performance()
    build_ejectment()
    build_indigent_application()
    build_o39_r2a_application()
    build_caveat()
    build_transfer_petition()
    build_execution_application()
    build_restitution_conjugal_rights()
    build_judicial_separation()
    build_succession_grant()
    build_succession_certificate()
    build_writ_criminal()
    build_special_leave_petition()
    build_contempt_petition()
    # Batch 4 — conveyancing deeds + notices from the DPC book (Part B).
    build_will()
    build_power_of_attorney()
    build_agreement_for_sale()
    build_sale_deed()
    build_lease_deed()
    build_mortgage_deed()
    build_partnership_deed()
    build_dissolution_deed()
    build_relinquishment_deed()
    build_gift_deed()
    build_s106_notice()
    build_s80_notice()
    build_s138_reply()
    build_written_statement()
    # TN / Madras court forms set (generalised for any state).
    build_vakalatnama()
    build_memo_of_appearance()
    build_coding_sheet()
    build_process_application()
    build_copy_application()
    build_call_for_memo()
    build_batta_witness()
    build_recall_petition()
    build_process_memo()
    build_surety_memo()
    build_affidavit_of_surety()
    build_service_of_process_application()
    build_affidavit_of_service()
    build_substituted_service()
    build_bail_bond()
    build_surety_affidavit()
    build_memorandum_furnish_sureties()
    build_surrender_petition()
    build_s256_condone_absence()
    build_s317_dispense_presence()
    build_recall_warrant()
    build_adjournment_petition()
    build_urgent_petition()
    build_appeal_record_cost_schedule()
    build_summons()
    build_court_notice()
    build_court_warrant()


def main(argv=None) -> int:
    global SHARED, _ALLOW_OVERWRITE, _written, _skipped

    ap = argparse.ArgumentParser(
        description="Scaffold shared-component .docx templates (scaffold-only by default).",
    )
    ap.add_argument(
        "--out", type=Path, default=None,
        help="emit ALL templates into this directory (used by the CI drift check). "
             "Implies overwrite within that directory; never targets the committed dir.",
    )
    ap.add_argument(
        "--force-overwrite", action="store_true",
        help="DANGER: regenerate over committed templates, destroying hand-corrections. "
             "Only for an intentional version bump. Refused when --out is given.",
    )
    args = ap.parse_args(argv)

    if args.out is not None:
        if args.force_overwrite:
            ap.error("--force-overwrite is meaningless with --out (the out dir is always written).")
        SHARED = args.out
        _ALLOW_OVERWRITE = True  # a fresh/temp dir: always write in full
        mode = f"full emit into {SHARED}"
    elif args.force_overwrite:
        SHARED = _COMMITTED_DIR
        _ALLOW_OVERWRITE = True
        mode = f"FORCE-OVERWRITE of committed templates in {SHARED}"
        print("!! --force-overwrite: this will overwrite hand-authored, advocate-approved "
              "templates.\n!! Hand-corrections that are not reflected in build_templates.py "
              "WILL BE LOST.", file=sys.stderr)
    else:
        SHARED = _COMMITTED_DIR
        _ALLOW_OVERWRITE = False  # scaffold-only: never clobber an existing committed file
        mode = f"scaffold-only into {SHARED} (existing files are left untouched)"

    _written = []
    _skipped = []
    SHARED.mkdir(parents=True, exist_ok=True)
    _build_all()

    print(f"[build_templates] mode: {mode}")
    print(f"[build_templates] wrote {len(_written)} file(s); skipped {len(_skipped)} existing.")
    if _skipped and not _ALLOW_OVERWRITE:
        print(f"[build_templates] skipped (already committed, authoritative): "
              f"{', '.join(sorted(_skipped)[:6])}"
              + (" ..." if len(_skipped) > 6 else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
