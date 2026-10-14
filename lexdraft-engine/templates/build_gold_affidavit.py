"""Build the GOLD-STANDARD affidavit.docx — the standalone affidavit doc-type template.

IMPORTANT — LANGUAGE IS PRESERVED VERBATIM. The affirmation, competence clause, and
attestation wording are copied EXACTLY from the existing templates/shared/affidavit.docx
(fed in deliberately). This builder changes ONLY the page setup, numbering mechanism,
named styles, and layout — never the words.

What changes vs the existing affidavit.docx:
  * A4 with a 1.5" left binding margin (was US Letter, 1.25" uniform).
  * REAL word/numbering.xml multilevel numbering for the competence clause + averments +
    prayer (was a literal "1." + a Jinja {% for %} computing para.number). The template
    now uses {% for %} for the body but each item — and the competence + prayer — sits in
    a paragraph that references <w:numPr>, so Word auto-numbers the whole sequence.
  * Named paragraph styles (AffTitle / AffBody / AffNumbered / Attestation).
  * Carlito/Caladea (container-safe).
  * The attestation brace block laid out with a right-aligned DEPONENT and the "}" column
    preserved.

Because numbering is now real and continuous, the engine's computed `para.number` /
`prayer_number` are no longer printed — Word owns the numbers. The body loop iterates the
averment TEXT only. This is the one intentional deviation from the old template's
numbering plumbing, and it is a fix, not a rewording.

Output:  python templates/build_gold_affidavit.py --out DIR   (default: templates/gold/)
"""
from __future__ import annotations

import argparse
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, Twips

A4_W, A4_H = 11906, 16838
MARGIN_TB, MARGIN_R, MARGIN_L = 1440, 1440, 2160  # 1.5" left binding margin
BODY_FONT = "Carlito"
HEADING_FONT = "Caladea"


def _set_a4(section):
    section.page_width = Twips(A4_W)
    section.page_height = Twips(A4_H)
    section.top_margin = Twips(MARGIN_TB)
    section.bottom_margin = Twips(MARGIN_TB)
    section.left_margin = Twips(MARGIN_L)
    section.right_margin = Twips(MARGIN_R)


def _add_style(doc, name, *, base="Normal", font=BODY_FONT, size=12, bold=False,
               align=None, space_after=6):
    from docx.enum.style import WD_STYLE_TYPE
    styles = doc.styles
    style = styles[name] if name in [s.name for s in styles] else styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    if base in [s.name for s in styles]:
        style.base_style = styles[base]
    style.font.name = font
    style.font.size = Pt(size)
    style.font.bold = bold
    if align is not None:
        style.paragraph_format.alignment = align
    style.paragraph_format.space_after = Pt(space_after)
    return style


def _inject_numbering(doc):
    """One decimal multilevel list; the competence clause, each averment, and the prayer
    all reference it, so Word numbers 1, 2, 3, … continuously."""
    numbering = doc.part.numbering_part.element
    abstractNum = OxmlElement("w:abstractNum")
    abstractNum.set(qn("w:abstractNumId"), "300")
    m = OxmlElement("w:multiLevelType"); m.set(qn("w:val"), "hybridMultilevel"); abstractNum.append(m)
    lvl = OxmlElement("w:lvl"); lvl.set(qn("w:ilvl"), "0")
    for tag, val in (("w:start", "1"), ("w:numFmt", "decimal"), ("w:lvlText", "%1."), ("w:lvlJc", "left")):
        e = OxmlElement(tag); e.set(qn("w:val"), val); lvl.append(e)
    pPr = OxmlElement("w:pPr"); ind = OxmlElement("w:ind")
    ind.set(qn("w:left"), "720"); ind.set(qn("w:hanging"), "360"); pPr.append(ind); lvl.append(pPr)
    abstractNum.append(lvl)
    num = OxmlElement("w:num"); num.set(qn("w:numId"), "30")
    aid = OxmlElement("w:abstractNumId"); aid.set(qn("w:val"), "300"); num.append(aid)
    numbering.insert(0, num); numbering.insert(0, abstractNum)
    return 30


def _numbered(doc, num_id, text):
    p = doc.add_paragraph(style="AffNumbered")
    pPr = p._p.get_or_add_pPr()
    numPr = OxmlElement("w:numPr")
    il = OxmlElement("w:ilvl"); il.set(qn("w:val"), "0"); numPr.append(il)
    ni = OxmlElement("w:numId"); ni.set(qn("w:val"), str(num_id)); numPr.append(ni)
    pPr.append(numPr)
    p.add_run(text)
    return p


def build(out_dir: Path) -> Path:
    doc = Document()
    _set_a4(doc.sections[0])
    _add_style(doc, "AffTitle", font=HEADING_FONT, size=13, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=8)
    _add_style(doc, "CauseTitle", font=HEADING_FONT, size=12, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
    _add_style(doc, "PartyBlock", size=12, space_after=2)
    _add_style(doc, "PartyTag", size=12, align=WD_ALIGN_PARAGRAPH.RIGHT, space_after=2)
    _add_style(doc, "Centered", size=12, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=6)
    _add_style(doc, "AffOf", size=12, bold=True, space_after=8)  # "AFFIDAVIT OF ..." heading
    _add_style(doc, "AffBody", size=12, space_after=8)
    _add_style(doc, "AffNumbered", size=12, space_after=6)
    _add_style(doc, "Attestation", size=12, space_after=2)
    doc.styles["Normal"].font.name = BODY_FONT
    doc.styles["Normal"].font.size = Pt(12)
    num_id = _inject_numbering(doc)

    # Rule-6 banners.
    doc.add_paragraph("{% if review_banner %}{{ review_banner }}{% endif %}")
    doc.add_paragraph("{% if unverified_marker %}{{ unverified_marker }}{% endif %}")

    # Title.
    doc.add_paragraph("DRAFT AFFIDAVIT", style="AffTitle")

    # ---- COURT CAUSE-TITLE + PARTY BLOCK (rendered only for a court affidavit) ----
    doc.add_paragraph("{% if has_court %}")
    doc.add_paragraph(
        "IN THE COURT OF {{ court_name }}"
        "{% if court_district %} (DISTRICT {{ court_district }}){% endif %}",
        style="CauseTitle")
    doc.add_paragraph(
        "{% if suit_no %}SUIT NO. {{ suit_no }} OF {{ suit_year }}{% endif %}",
        style="CauseTitle")
    doc.add_paragraph(
        "{% if suit_under %}({{ suit_under }}){% endif %}", style="CauseTitle")
    doc.add_paragraph("", style="PartyBlock")
    doc.add_paragraph("IN THE MATTER OF:", style="PartyBlock")
    # When has_court is set but a party NAME wasn't supplied, emit a visible
    # [plaintiff name] / [defendant name] gap marker rather than a blank line, so
    # the advocate sees an obvious placeholder to fill (never a silently empty
    # cause title). The name is REQUIRED once there's a court; the marker makes the
    # omission legible in the draft.
    doc.add_paragraph("{{ plaintiff_name or '[plaintiff name]' }}", style="PartyBlock")
    doc.add_paragraph(
        "{% if plaintiff_description %}{{ plaintiff_description }}{% endif %}",
        style="PartyBlock")
    doc.add_paragraph("… PLAINTIFF", style="PartyTag")
    doc.add_paragraph("VERSUS", style="Centered")
    doc.add_paragraph("{{ defendant_name or '[defendant name]' }}", style="PartyBlock")
    doc.add_paragraph(
        "{% if defendant_description %}{{ defendant_description }}{% endif %}",
        style="PartyBlock")
    doc.add_paragraph("… DEFENDANT", style="PartyTag")
    doc.add_paragraph("", style="PartyBlock")
    # "AFFIDAVIT OF <name>, <S/o> <parent>, AGED ABOUT <age> YEARS, R/o <address>
    #  [, in the capacity of <capacity>]."
    doc.add_paragraph(
        "AFFIDAVIT OF {{ deponent_name }}, {{ parentage_type }} {{ parentage_name }}, "
        "AGED ABOUT {{ age }} YEARS, R/o {{ address }}"
        "{% if deponent_capacity %}, in the capacity of {{ deponent_capacity }}{% endif %}.",
        style="AffOf")
    doc.add_paragraph("{% endif %}")

    # Deponent line — for a court affidavit the identity is in the "AFFIDAVIT OF" heading,
    # so the opening is the shorter "the deponent hereinabove" form; for a bare affidavit
    # (no court) it carries the full identity inline.
    doc.add_paragraph(
        "{% if has_court %}"
        "I, {{ deponent_name }}, the deponent hereinabove, do hereby solemnly affirm and "
        "state as under:"
        "{% else %}"
        "I, {{ deponent_name }}, aged {{ age }} years, {{ parentage_type }} "
        "{{ parentage_name }}, {{ occupation }}, residing at {{ address }}, do hereby "
        "solemnly affirm and sincerely state as follows:"
        "{% endif %}", style="AffBody")

    # Competence clause — under REAL numbering.
    _numbered(doc, num_id,
              "I am the {{ role }} in the above {% if has_court %}suit{% else %}"
              "{{ proceeding }}{% endif %} and am well acquainted with the facts of the "
              "case{% if has_court %} based upon the records maintained in the ordinary "
              "course of business, and am duly authorised and competent to swear this "
              "affidavit{% endif %}."
              "{% if authorised %} I am duly authorised to swear this affidavit vide "
              "{{ authority_ref }}.{% endif %}"
              "{% if is_third_party %} My source of knowledge is "
              "{{ source_of_knowledge }}.{% endif %}")

    # Body averments — one numbered paragraph per averment (real numbering, continuous).
    # docxtpl {%p for %} loops at the paragraph level so each averment is its own numbered
    # item. The averment TEXT is verbatim; only the numbering mechanism changed.
    body = doc.add_paragraph("{%p for para in numbered_body %}", style="AffNumbered")
    _numbered(doc, num_id, "{{ para.text }}")
    doc.add_paragraph("{%p endfor %}", style="AffNumbered")

    # Prayer — VERBATIM text, now the last numbered item. Wrapped in a paragraph-level
    # guard so a s.145 PROOF affidavit renders NO prayer: it is evidence in chief, not a
    # petition — the prayer belongs to the complaint. Mirrors the {%p for %} construct.
    doc.add_paragraph("{%p if affidavit_kind != 's145_proof' %}", style="AffNumbered")
    _numbered(doc, num_id,
              "It is therefore prayed that this Hon'ble Court may be pleased to "
              "{{ prayer }}.")
    doc.add_paragraph("{%p endif %}", style="AffNumbered")

    doc.add_paragraph("", style="AffBody")

    # DEPONENT signature (after the body), right-aligned — as in the reference.
    doc.add_paragraph("DEPONENT", style="PartyTag")
    doc.add_paragraph("", style="AffBody")

    # ---- VERIFICATION clause (the reference's closing block) ----
    doc.add_paragraph("VERIFICATION:", style="AffOf")
    doc.add_paragraph(
        "I, {{ deponent_name }}, do hereby verify on this {{ date }} at "
        "{{ verification_place or place }} that the contents of the above affidavit are "
        "true and correct to my knowledge and information and nothing material has been "
        "concealed therefrom.", style="AffBody")
    doc.add_paragraph("DEPONENT", style="PartyTag")

    # For a BARE affidavit (no court) keep the traditional jurat/attestation block too,
    # so a standalone affidavit still carries the "Solemnly affirmed … BEFORE ME" seal.
    doc.add_paragraph("{% if not has_court %}")

    def _attest_line(left_text, right_text=""):
        p = doc.add_paragraph(style="Attestation")
        p.paragraph_format.tab_stops.add_tab_stop(Twips(A4_W - MARGIN_L - MARGIN_R - 2400), WD_TAB_ALIGNMENT.LEFT)
        p.paragraph_format.tab_stops.add_tab_stop(Twips(A4_W - MARGIN_L - MARGIN_R), WD_TAB_ALIGNMENT.RIGHT)
        p.add_run(left_text + "\t}\t" + right_text)
        return p

    _attest_line("Solemnly affirmed at {{ place }}")
    _attest_line("on this {{ date }}", "DEPONENT")
    _attest_line("and signed his/her name in my presence.")
    doc.add_paragraph("BEFORE ME", style="Attestation")
    doc.add_paragraph("{{ attestor }}", style="Attestation")
    doc.add_paragraph("{% endif %}")

    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "affidavit.docx"
    doc.save(str(out))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build the gold-standard affidavit.docx.")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent / "gold")
    args = ap.parse_args(argv)
    out = build(args.out)
    print(f"wrote gold reference: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
