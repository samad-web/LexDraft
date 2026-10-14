"""Build the GOLD-STANDARD regular_bail.docx — the hand-authored reference pattern.

This is the ONE reference template advocates copy. It is NOT part of the scaffold-only
build_templates.py path (that produces the deprecated python-docx-default output). It
is authored here with the full court-formatting an advocate expects, expressed in real
OOXML — not faked in runs:

  * A4 page (11906 x 16838 twips) with a WIDE LEFT BINDING MARGIN (1.5") and
    mirrored/normal margins suitable for court filing + stitching.
  * A real word/numbering.xml multilevel definition (decimal 1. / (a) / (i)) that
    paragraphs reference via <w:numPr>, so numbering auto-renumbers and hangs.
  * Tab stops with DOTTED LEADERS for the cause-title signature lines
    (....................... Applicant / Advocate for the Applicant).
  * NAMED paragraph styles (CauseTitle, PartyBlock, GroundList, Prayer, Verification,
    SignatureLine) with inheritance — layout owned by styles, not run-by-run.
  * A HEADER carrying a right-aligned "Page X of Y" field.
  * docxtpl placeholders, each written as a SINGLE run (passes the split-run gate),
    with the SAME field vocabulary the engine's regular_bail adapter emits.

Output:  python templates/build_gold_regular_bail.py --out DIR   (default: templates/gold/)

The output is a real .docx you can open in Word, inspect, and hand to an advocate.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, Twips

# --- page geometry (twips: 1440 = 1 inch) ----------------------------------
A4_W = 11906   # 210 mm
A4_H = 16838   # 297 mm
MARGIN_TOP = 1440         # 1.0"
MARGIN_BOTTOM = 1440      # 1.0"
MARGIN_RIGHT = 1440       # 1.0"
MARGIN_LEFT = 2160        # 1.5" — WIDE binding/stitching margin for court filing
MARGIN_HEADER = 720       # 0.5"
MARGIN_FOOTER = 720

BODY_FONT = "Carlito"     # metric-compatible with Calibri; ships in the container
HEADING_FONT = "Caladea"  # metric-compatible with Cambria


def _set_a4_section(section) -> None:
    section.page_width = Twips(A4_W)
    section.page_height = Twips(A4_H)
    section.top_margin = Twips(MARGIN_TOP)
    section.bottom_margin = Twips(MARGIN_BOTTOM)
    section.left_margin = Twips(MARGIN_LEFT)
    section.right_margin = Twips(MARGIN_RIGHT)
    section.header_distance = Twips(MARGIN_HEADER)
    section.footer_distance = Twips(MARGIN_FOOTER)


# --- named styles -----------------------------------------------------------

def _add_paragraph_style(doc, name: str, *, base="Normal", font=BODY_FONT, size=12,
                         bold=False, align=None, space_after=6, keep_with_next=False):
    styles = doc.styles
    from docx.enum.style import WD_STYLE_TYPE
    if name in [s.name for s in styles]:
        style = styles[name]
    else:
        style = styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    if base in [s.name for s in styles]:
        style.base_style = styles[base]
    f = style.font
    f.name = font
    f.size = Pt(size)
    f.bold = bold
    pf = style.paragraph_format
    if align is not None:
        pf.alignment = align
    pf.space_after = Pt(space_after)
    pf.keep_with_next = keep_with_next
    return style


def _build_styles(doc):
    _add_paragraph_style(doc, "CauseTitle", font=HEADING_FONT, size=13, bold=True,
                         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4, keep_with_next=True)
    _add_paragraph_style(doc, "PartyBlock", size=12, align=WD_ALIGN_PARAGRAPH.LEFT, space_after=2)
    _add_paragraph_style(doc, "SectionHeading", font=HEADING_FONT, size=12, bold=True,
                         space_after=6, keep_with_next=True)
    _add_paragraph_style(doc, "GroundList", size=12, space_after=6)
    _add_paragraph_style(doc, "Prayer", size=12, space_after=6)
    _add_paragraph_style(doc, "Verification", size=12, space_after=6)
    _add_paragraph_style(doc, "SignatureLine", size=12, align=WD_ALIGN_PARAGRAPH.RIGHT, space_after=2)


# --- real multilevel numbering ---------------------------------------------

def _inject_numbering(doc):
    """Add a word/numbering.xml with ONE multilevel abstract num (1. / (a) / (i)),
    and a concrete num (numId=10) the GroundList paragraphs reference. Returns numId."""
    numbering = doc.part.numbering_part.element  # python-docx creates the part lazily

    abstract_id = "100"
    num_id = 10

    # abstractNum with 3 levels
    abstractNum = OxmlElement("w:abstractNum")
    abstractNum.set(qn("w:abstractNumId"), abstract_id)
    multi = OxmlElement("w:multiLevelType")
    multi.set(qn("w:val"), "hybridMultilevel")
    abstractNum.append(multi)

    level_defs = [
        ("0", "decimal", "%1.", 720, 360),     # 1.
        ("1", "lowerLetter", "(%2)", 1440, 360),  # (a)
        ("2", "lowerRoman", "(%3)", 2160, 360),   # (i)
    ]
    for ilvl, fmt, text, indent, hang in level_defs:
        lvl = OxmlElement("w:lvl")
        lvl.set(qn("w:ilvl"), ilvl)
        start = OxmlElement("w:start"); start.set(qn("w:val"), "1"); lvl.append(start)
        numFmt = OxmlElement("w:numFmt"); numFmt.set(qn("w:val"), fmt); lvl.append(numFmt)
        lvlText = OxmlElement("w:lvlText"); lvlText.set(qn("w:val"), text); lvl.append(lvlText)
        lvlJc = OxmlElement("w:lvlJc"); lvlJc.set(qn("w:val"), "left"); lvl.append(lvlJc)
        pPr = OxmlElement("w:pPr")
        ind = OxmlElement("w:ind")
        ind.set(qn("w:left"), str(indent))
        ind.set(qn("w:hanging"), str(hang))
        pPr.append(ind); lvl.append(pPr)
        abstractNum.append(lvl)

    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))
    abstractNumId = OxmlElement("w:abstractNumId")
    abstractNumId.set(qn("w:val"), abstract_id)
    num.append(abstractNumId)

    # abstractNum must precede num in the part
    numbering.insert(0, num)
    numbering.insert(0, abstractNum)
    return num_id


def _numbered(doc, num_id, text, level=0):
    p = doc.add_paragraph(style="GroundList")
    pPr = p._p.get_or_add_pPr()
    numPr = OxmlElement("w:numPr")
    ilvl = OxmlElement("w:ilvl"); ilvl.set(qn("w:val"), str(level)); numPr.append(ilvl)
    nid = OxmlElement("w:numId"); nid.set(qn("w:val"), str(num_id)); numPr.append(nid)
    pPr.append(numPr)
    p.add_run(text)
    return p


# --- tab-leader signature lines --------------------------------------------

def _leader_line(doc, label_text):
    """A line with a right-aligned dotted-leader tab to the label, e.g.
    '.................................................. Applicant'."""
    p = doc.add_paragraph(style="SignatureLine")
    # a right tab stop at the right margin with a dotted leader
    tab_stops = p.paragraph_format.tab_stops
    tab_stops.add_tab_stop(Twips(A4_W - MARGIN_LEFT - MARGIN_RIGHT),
                           WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
    run = p.add_run("\t" + label_text)
    return p


# --- header with page numbers ----------------------------------------------

def _add_page_field(paragraph, kind):
    """Insert a PAGE or NUMPAGES field into a run."""
    r = paragraph.add_run()
    fldBegin = OxmlElement("w:fldChar"); fldBegin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText"); instr.set(qn("xml:space"), "preserve"); instr.text = f" {kind} "
    fldEnd = OxmlElement("w:fldChar"); fldEnd.set(qn("w:fldCharType"), "end")
    r._r.append(fldBegin); r._r.append(instr); r._r.append(fldEnd)


def _build_header(section):
    header = section.header
    header.is_linked_to_previous = False
    p = header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.add_run("Page ")
    _add_page_field(p, "PAGE")
    p.add_run(" of ")
    _add_page_field(p, "NUMPAGES")


# --- the document -----------------------------------------------------------

def build(out_dir: Path) -> Path:
    doc = Document()
    section = doc.sections[0]
    _set_a4_section(section)
    _build_styles(doc)
    num_id = _inject_numbering(doc)
    _build_header(section)

    # Default document font.
    normal = doc.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(12)

    # Review + unverified banners (single-run placeholders).
    doc.add_paragraph("{% if review_banner %}{{ review_banner }}{% endif %}")
    doc.add_paragraph("{% if unverified_marker %}{{ unverified_marker }}{% endif %}")

    # Cause title — uses the same fields the engine's regular_bail adapter emits.
    ct = doc.add_paragraph(style="CauseTitle")
    ct.add_run("IN THE COURT OF {{ bail_court }}")
    y = doc.add_paragraph(style="CauseTitle")
    y.add_run("BAIL APPLICATION NO. ______ OF {{ bail_year }}")

    doc.add_paragraph("IN THE MATTER OF:", style="PartyBlock")
    doc.add_paragraph("{{ accused.name }}", style="PartyBlock")
    doc.add_paragraph("{% if accused.parentage %}{{ accused.parentage }}{% endif %}", style="PartyBlock")
    doc.add_paragraph("{{ accused.address }}", style="PartyBlock")
    doc.add_paragraph("… Applicant / Accused", style="PartyBlock")
    doc.add_paragraph("Versus", style="PartyBlock")
    doc.add_paragraph("State, through {{ police_station }} Police Station", style="PartyBlock")
    doc.add_paragraph("… Respondent", style="PartyBlock")

    # Enabling provision — the engine context supplies the resolved BNSS section
    # (regular_bail_section), never a hardcoded one.
    doc.add_paragraph(
        "APPLICATION UNDER {{ regular_bail_section }} FOR GRANT OF BAIL",
        style="SectionHeading",
    )

    # FIR / custody particulars.
    doc.add_paragraph("MOST RESPECTFULLY SHOWETH:", style="SectionHeading")

    # Numbered grounds — REAL numbering (auto-renumbers, hangs). `sections` is a list
    # in the engine context; join it inline with the docxtpl/Jinja join filter.
    _numbered(doc, num_id, "That the applicant is arrayed as an accused in FIR No. "
                           "{{ fir_no }} registered at {{ police_station }} Police Station, "
                           "{{ district }}, for offences under {{ sections | join(', ') }}.")
    _numbered(doc, num_id, "That the applicant has been in judicial custody since "
                           "{{ custody_since }} ({{ custody_days }} days as on the date "
                           "of this application).")
    _numbered(doc, num_id, "That the investigation is "
                           "{% if chargesheet_filed %}complete and the charge-sheet has been "
                           "filed{% else %}still pending{% endif %}.")
    _numbered(doc, num_id, "That the applicant undertakes to cooperate with the trial, will "
                           "not tamper with evidence or influence witnesses, and will not "
                           "abscond.")
    _numbered(doc, num_id, "{% if is_successive %}That this is a successive bail application; "
                           "the change in circumstances is: {{ change_of_circumstance }}."
                           "{% else %}That this is the first bail application by the applicant "
                           "before this Hon'ble Court.{% endif %}")

    # Prayer.
    doc.add_paragraph("PRAYER", style="SectionHeading")
    doc.add_paragraph(
        "It is therefore most respectfully prayed that this Hon'ble Court may be pleased "
        "to enlarge the applicant on bail in connection with FIR No. {{ fir_no }}, and pass "
        "such further orders as this Hon'ble Court deems fit in the interest of justice.",
        style="Prayer",
    )

    # Signature block with dotted-leader lines.
    _leader_line(doc, "Applicant / Accused")
    _leader_line(doc, "Advocate for the Applicant")
    doc.add_paragraph("Place: {{ place }}", style="PartyBlock")
    doc.add_paragraph("Date: ______", style="PartyBlock")

    # Verification.
    doc.add_paragraph("VERIFICATION", style="SectionHeading")
    doc.add_paragraph(
        "Verified at {{ place }} that the contents of the above application are true and "
        "correct to the best of my knowledge and belief, and nothing material has been "
        "concealed therefrom.",
        style="Verification",
    )
    _leader_line(doc, "Applicant / Accused")

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "regular_bail.docx"
    doc.save(str(out))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build the gold-standard regular_bail.docx.")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "gold")
    args = ap.parse_args(argv)
    out = build(args.out)
    print(f"wrote gold reference: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
