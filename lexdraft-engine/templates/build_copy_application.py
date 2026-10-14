"""Author copy_application.docx to the ADVOCATE'S EXACT format
(04_Copy_Application_Civil_and_Crime.pdf). Mirrors that form's structure:

  IN THE COURT  ___  SUBORDINATE JUDGE          AT ___
                     DISTRICT MUNSIFF
  O.S. No. ___ of 20___
  ......................................................  Plaintiff  (dotted line)
  Versus
  ......................................................  Defendant
  To
  Application for Certified Copies         (CENTRED, bold, BELOW parties/To)
  UNDER RULE ___                           (CENTRED, bold, underlined)
  It is requested that ___ certified ___ of the ___ hereunder mentioned
  may be furnished ___ the ___ abovenamed
  [5-column schedule table:
     Serial No | Date of filing Document | Date of Document |
     Description of Document | Order if any under which application is made]
  dated this ___ day of ___ 20___
                                           Counsel for ___ Plaintiff

Autofill: the court name/place, O.S. number, parties, rule, and one schedule row
per document on record are filled from the case; a genuinely-missing value renders
as the form's blank fill-in line. FILL-IN FORM — never refuses.
No letterhead. The review banner renders only if the engine sets review_banner.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.enum.table import WD_TABLE_ALIGNMENT

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


DOTS = "." * 60  # dotted fill-in line for a party name

# NOTE: no review banner on this fill-in court form (matches the advocate's clean
# printed form; the other advocate-matched forms omit it too).

# ---- court heading ----------------------------------------------------------
# The advocate form's pre-printed heading is: "IN THE COURT [____] SUBORDINATE
# JUDGE / DISTRICT MUNSIFF [____] AT". We keep those fixed labels and put the
# actual court on its OWN centred line below, so a long court name can never shove
# "SUBORDINATE JUDGE" into "AT" (the "JUDGEAT" collision). Line 1: the label row;
# line 2: the court name (autofilled) with "AT <place>".
ph = para(align="center", after=2)
run(ph, "IN THE COURT OF   SUBORDINATE JUDGE / DISTRICT MUNSIFF", bold=True)
pc = para(align="center", after=10)
run(pc, "{% if court_name %}{{ court_name }}{% else %}______________{% endif %}")
run(pc, "   AT ", bold=True)
run(pc, "{% if court_place %}{{ court_place }}{% else %}__________{% endif %}")

# ---- O.S. No. ___ of 20___ (indented) ---------------------------------------
pos = para(after=12)
pos.paragraph_format.left_indent = Inches(1.4)
pos.paragraph_format.tab_stops.add_tab_stop(Inches(3.2), WD_TAB_ALIGNMENT.LEFT)
run(pos, "O.S. No. ")
run(pos, "{% if os_no %}{{ os_no }}{% else %}______{% endif %}")
run(pos, "\tof 20")
run(pos, "{% if os_year %}{{ os_year }}{% else %}____{% endif %}")

# ---- parties: dotted line + role, Versus, dotted line + role -----------------
# The copy-application form is a CIVIL copying form — roles are ALWAYS
# "Plaintiff" / "Defendant" (not the case's Complainant/Accused).
pp = para(after=6)
pp.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(pp, "{% if applicant_name %}{{ applicant_name }}{% else %}" + DOTS + "{% endif %}")
run(pp, "\tPlaintiff")
line("Versus", align="center", after=6)
pd = para(after=10)
pd.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(pd, "{% if opposite_party_name %}{{ opposite_party_name }}{% else %}" + DOTS + "{% endif %}")
run(pd, "\tDefendant")

# ---- "To" -------------------------------------------------------------------
# Just "To" as on the form; the addressee (copying officer) is written by hand.
# Only print an addressee line if one is genuinely supplied.
line("To", after=2)
ctl("{% if addressed_to %}")
line("{{ addressed_to }}", after=10)
ctl("{% endif %}")
line("", after=4)

# ---- TITLE (centred, bold) — BELOW parties/To, as on the form ---------------
line("Application for Certified Copies", align="center", bold=True, after=10)

# ---- UNDER RULE ___ (centred, bold, underlined) -----------------------------
# ALWAYS a blank on the form — this is the COPYING rule, NOT the case's offence
# sections. Never auto-filled (the advocate writes the correct rule).
prule = para(align="center", after=10)
run(prule, "UNDER RULE ______", bold=True, underline=True)

# ---- fill-in body (verbatim per the form) -----------------------------------
pb1 = para(align="justify", after=4)
run(pb1, "It is requested that ")
run(pb1, "___________")
run(pb1, " certified ")
run(pb1, "___________")
run(pb1, " of the ")
run(pb1, "________")
run(pb1, " hereunder mentioned")
pb2 = para(align="justify", after=10)
run(pb2, "may be furnished ")
run(pb2, "_________________")
run(pb2, " the ")
run(pb2, "________________")
run(pb2, " abovenamed")

# ---- 5-column schedule table ------------------------------------------------
# Serial No | Date of filing Document | Date of Document | Description of Document
# | Order if any under which application is made. One data row per document (a
# {%tr for %} loop). Only autofilled rows (no spare blank rows).
tbl = doc.add_table(rows=1, cols=5)
tbl.style = "Table Grid"
tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
hdr = tbl.rows[0].cells
headers = ["Serial\nNo", "Date of filing\nDocument", "Date of\nDocument",
           "Description of Document", "Order if any under which\napplication is made"]
for c, h in zip(hdr, headers):
    p0 = c.paragraphs[0]; p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run(p0, h, bold=True)
# widths (approx to match the form proportions)
widths = [Inches(0.6), Inches(1.2), Inches(1.0), Inches(2.0), Inches(1.9)]
for row in tbl.rows:
    for cell, wd in zip(row.cells, widths):
        cell.width = wd
# one data row per document via a docxtpl row-loop. The {%tr for %} / {%tr endfor %}
# tags each occupy their OWN run at the very start of the first cell and the very
# end of the last cell; docxtpl repeats the whole <w:tr> per item. Content cells
# hold plain {{ }} expressions (no {% if %} wrapping — keep the runs simple so the
# row tags parse cleanly).
# docxtpl 0.20.2 quirk: {%tr for%} and {%tr endfor%} must be in SEPARATE rows (a
# single-row for/endfor makes the first {%tr%} consume the whole row incl. endfor
# -> "unknown tag endfor"). So: a for-row (vanishes -> {% for %}), the DATA row
# (repeated per document), an endfor-row (vanishes). Only autofilled rows render.
for_row = tbl.add_row().cells
run(for_row[0].paragraphs[0], "{%tr for d in documents %}")
drow = tbl.add_row().cells
run(drow[0].paragraphs[0], "{{ loop.index }}")
run(drow[1].paragraphs[0], "{{ d.date_of_filing or '' }}")
run(drow[2].paragraphs[0], "{{ d.date_of_document or '' }}")
run(drow[3].paragraphs[0], "{{ d.description or '' }}")
run(drow[4].paragraphs[0], "{{ d.order_under_which or '' }}")
endfor_row = tbl.add_row().cells
run(endfor_row[0].paragraphs[0], "{%tr endfor %}")
for cell, wd in zip(drow, widths):
    cell.width = wd
para(after=8)

# ---- footer: "dated this ___ day of ___ 20___" + Counsel line ---------------
pf = para(after=16)
run(pf, "dated this ")
run(pf, "{% if filing_day %}{{ filing_day }}{% else %}______{% endif %}")
run(pf, " day of ")
run(pf, "{% if filing_month %}{{ filing_month }}{% else %}____________{% endif %}")
run(pf, " 20")
run(pf, "{% if case_year %}{{ '%02d' % (case_year % 100) }}{% else %}____{% endif %}")
pcf = para(align="right", after=0)
# Civil copying form — always "Counsel for Plaintiff" (not the case's role).
run(pcf, "Counsel for Plaintiff")

out = r"C:\Users\salma\OneDrive\Documents\LEXDRAFT\lexdraft-engine\templates\shared\copy_application.docx"
doc.save(out)
print("WROTE", out)
