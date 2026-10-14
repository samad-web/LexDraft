"""Author affidavit_of_service.docx to the ADVOCATE'S EXACT format (the supplied
08_Affidavit_of_Service.pdf). Mirrors that form's structure:

  In the Court of  (left, title-case, bold)
  I.A. No. ___ of 20___          (case-no lines, indented)
  O.S.No. ___ of 20___
  <Petitioner>  ... Petitioner / Applicant / Plaintiff   (right-aligned label)
  Versus
  <Respondent>  ... Respondent / Defendent
  Affidavit of Service   (CENTRED, bold — BELOW the parties, not at the top)
  I <name> son of <parentage>
  Hindu / Muslim / Christian, aged about <age> years residing at No. <address>
  do hereby solemnly and sincerely affirm and state as follows:
  1. I am, the registered Clerk of the Petitioners Counsel on record. ...  (verbatim)
  2. In the above Application / Petition Notice to the respondent was ordered,
     returnable by <date> ...  (verbatim)
  3. The Registered cover sent to the Respondent has been returned to the sendor
     with an endorsement that the addressee has left / has refused to receive /
     has not claimed. ...  (verbatim)
  Solemnly affirmed at <place>        BEFORE ME
  on this the ___ day of 20___ and
  signed the same in my presence      ADVOCATE
                                      COUNSEL FOR PETITIONER / APPLICANT / PLAINTIFF
  <page break>
  BACKING SHEET (docket): IN THE COURT OF / I.A.No / O.S.No / parties / large
  AFFIDAVIT OF SERVICE centred / Mr. ___ / Counsel for the PETITIONER/...

Autofill: every ___ is filled from the case facts when the pipeline supplies them
(deponent name, parentage, age, address, dates, parties, place); a genuinely-
missing fact renders as a blank fill-in line, never invented.
No letterhead. The review banner renders only if the engine sets review_banner.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT

doc = Document()
sec = doc.sections[0]
sec.top_margin = Inches(1.0); sec.bottom_margin = Inches(1.0)
sec.left_margin = Inches(1.1); sec.right_margin = Inches(1.0)
W = sec.page_width - sec.left_margin - sec.right_margin

st = doc.styles["Normal"]
st.font.name = "Times New Roman"; st.font.size = Pt(12)
st.paragraph_format.space_after = Pt(0); st.paragraph_format.line_spacing = 1.15


def para(align=None, after=6, before=0):
    p = doc.add_paragraph(); pf = p.paragraph_format
    pf.space_after = Pt(after); pf.space_before = Pt(before)
    if align == "center": p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    elif align == "right": p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    elif align == "justify": p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    return p


def run(p, text, bold=False, underline=False, size=None):
    r = p.add_run(text); r.bold = bold; r.underline = underline
    if size: r.font.size = Pt(size)
    return r


def line(text, **kw):
    b = kw.pop("bold", False); u = kw.pop("underline", False); sz = kw.pop("size", None)
    p = para(**kw)
    if text:
        run(p, text, bold=b, underline=u, size=sz)
    return p


def ctl(tag):
    p = para(after=0); run(p, tag); return p


# ---- NO review banner on this form ------------------------------------------
# The advocate's supplied 08_Affidavit_of_Service.pdf has NO "[DRAFT ...]" line at
# the top, so this form must render clean to match it exactly (user decision
# 2026-09-30). The engine still computes the review signal elsewhere; it is simply
# not printed on this document.

# ---- cause title: "In the Court of ___" (left, title-case, bold) -------------
line("{% if court_name %}In the Court of {{ court_name }}{% else %}In the Court of "
     "______{% endif %}{% if court_place %} at {{ court_place }}{% endif %}",
     bold=True, after=10)

# ---- case-number lines: I.A. No. ... / O.S.No. ... (indented, tabbed) --------
# Two case-reference lines as on the advocate form. ia_no / os_no fill in when the
# engine supplies them; else a blank "______ of 20__" fill-in.
def case_no_line(label, value_key, year_key):
    p = para(after=4)
    p.paragraph_format.left_indent = Inches(1.4)
    p.paragraph_format.tab_stops.add_tab_stop(Inches(3.2), WD_TAB_ALIGNMENT.LEFT)
    run(p, label + " ")
    run(p, "{% if " + value_key + " %}{{ " + value_key + " }}{% else %}______{% endif %}")
    run(p, "\tof 20")
    run(p, "{% if " + year_key + " %}{{ " + year_key + " }}{% else %}____{% endif %}")
    return p

case_no_line("I.A. No.", "ia_no", "ia_year")
case_no_line("O.S.No.", "os_no", "os_year")
line("", after=8)

# ---- party memo: executant + role label (right), Versus, opposite + role -----
pe = para(after=6)
r_pe = run(pe, "{% if petitioner_name %}{{ petitioner_name }}{% else %}______{% endif %}", bold=True)
r_pe.font.size = Pt(12)
pe.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(pe, "\t... Petitioner / Applicant / Plaintiff")
line("Versus", align="center", after=6)
po = para(after=12)
r_po = run(po, "{% if respondent_name %}{{ respondent_name }}{% else %}______{% endif %}", bold=True)
r_po.font.size = Pt(12)
po.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(po, "\t... Respondent / Defendent")

# ---- TITLE (centred, bold, LARGE display) — BELOW the parties, as on the -----
#      advocate form (it is a prominent heading there, not body-sized).
line("Affidavit of Service", align="center", bold=True, size=16, after=12)

# ---- deponent identification (fill-in form lines) ---------------------------
# "I <name> son of <parentage>" then "Hindu / Muslim / Christian, aged about
# <age> years residing at No. <address>" then the solemn-affirmation lead-in.
pdep = para(after=4)
run(pdep, "I ")
run(pdep, "{% if deponent_name %}{{ deponent_name }}{% else %}________________________{% endif %}")
run(pdep, " son of ")
run(pdep, "{% if deponent_parentage %}{{ deponent_parentage }}{% else %}________________________{% endif %}")
prel = para(after=4)
run(prel, "{% if religion %}{{ religion }}{% else %}Hindu / Muslim / Christian{% endif %}, aged about ")
run(prel, "{% if deponent_age %}{{ deponent_age }}{% else %}______{% endif %}")
run(prel, " years residing at No. ")
run(prel, "{% if deponent_address %}{{ deponent_address }}{% else %}______________________________{% endif %}")
line("do hereby solemnly and sincerely affirm and state as follows:", after=10)

# ---- numbered clauses (VERBATIM per the advocate form) ----------------------
line("1. I am, the registered Clerk of the Petitioners Counsel on record. I am the "
     "counsel on Record for the Petitioner as such I am well aware of the facts of "
     "the case.", align="justify", after=8)
line("2. In the above Application / Petition Notice to the respondent was ordered, "
     "returnable by {% if notice_returnable_date %}{{ notice_returnable_date }}"
     "{% else %}______ 20____{% endif %} As per the orders of this Hon'ble Court, "
     "notice is taken out to the Respondent. The Copy of the notice along with "
     "acknowledgement is enclosed herein, as proof of service.", align="justify", after=8)
line("3. The Registered cover sent to the Respondent has been returned to the sendor "
     "with an endorsement that the addressee "
     "{% if endorsement == 'left' %}has left"
     "{% elif endorsement == 'refused' %}has refused to receive"
     "{% elif endorsement == 'unclaimed' %}has not claimed"
     "{% else %}has left / has refused to receive / has not claimed{% endif %}. "
     "This may kindly be recorded and pray this Hon'ble Court to pass further Orders.",
     align="justify", after=14)

# ---- two-column closing: affirmation (left) | BEFORE ME / ADVOCATE (right) ---
# A 2-col table: left cell the solemn-affirmation block, right cell the attestation.
tbl = doc.add_table(rows=1, cols=2)
tbl.autofit = True
lc, rc = tbl.rows[0].cells
# left column — solemn affirmation block
lp = lc.paragraphs[0]; run(lp, "Solemnly affirmed at "
     "{% if place %}{{ place }}{% else %}__________{% endif %}")
run(lc.add_paragraph(), "on this the "
    "{% if affirm_date %}{{ affirm_date }}{% else %}______ day of 20____{% endif %} and")
run(lc.add_paragraph(), "signed the same in my")
run(lc.add_paragraph(), "presence")
# right column — attestation block
rp = rc.paragraphs[0]; run(rp, "BEFORE ME", bold=True)
rc.add_paragraph()
run(rc.add_paragraph(), "ADVOCATE", bold=True)
# Verbatim per the advocate's form (which spells it "PLANTIFF") — user asked to
# reproduce the format exactly, typos included.
run(rc.add_paragraph(), "COUNSEL FOR PETITIONER / APPLICANT / PLANTIFF", bold=True)
para(after=6)

# ---- backing sheet / DOCKET (own page) --------------------------------------
_dh = line("{% if court_name %}IN THE COURT OF {{ court_name | upper }}{% else %}IN "
           "THE COURT OF ______{% endif %}", align="center", bold=True, after=16)
_dh.paragraph_format.page_break_before = True
# case-no lines centred-ish (indented) on the docket
d_ia = para(after=2); d_ia.paragraph_format.left_indent = Inches(2.2)
run(d_ia, "I.A.No. ")
run(d_ia, "{% if ia_no %}{{ ia_no }}{% else %}______{% endif %} of 20")
run(d_ia, "{% if ia_year %}{{ ia_year }}{% else %}____{% endif %}")
d_os = para(after=40); d_os.paragraph_format.left_indent = Inches(2.2)
run(d_os, "O.S.No. ")
run(d_os, "{% if os_no %}{{ os_no }}{% else %}______{% endif %} of 20")
run(d_os, "{% if os_year %}{{ os_year }}{% else %}____{% endif %}")
# parties, right-aligned, role labels UPPER
pe1 = para(align="right", after=0)
run(pe1, "{% if petitioner_name %}{{ petitioner_name }}{% else %}______{% endif %}", bold=True, underline=True)
line("PETITIONER / APPLICANT / PLAINTIFF /", align="right", bold=True, after=40)
line("Versus", align="center", after=40)
po1 = para(align="right", after=0)
run(po1, "{% if respondent_name %}{{ respondent_name }}{% else %}______{% endif %}", bold=True, underline=True)
line("RESPONDENT / DEFENDENT", align="right", bold=True, after=80)
# large centred title
pt = para(align="center", after=90)
r_t = run(pt, "AFFIDAVIT OF SERVICE", bold=True); r_t.font.size = Pt(20)
# advocate / counsel line, right-aligned, at the bottom
line("Mr. .........................................", align="right", after=2)
line("Counsel for the PETITIONER / APPLICANT / PLANTIFF", align="right", bold=True, after=0)

out = r"C:\Users\salma\OneDrive\Documents\LEXDRAFT\lexdraft-engine\templates\shared\affidavit_of_service.docx"
doc.save(out)
print("WROTE", out)
