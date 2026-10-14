"""Author batta_witness.docx to the ADVOCATE'S EXACT format (05_Batta_Witness.pdf):

  IN THE COURT OF <court>                          (centred, bold, large)
  O.S. No. <no> of 20<yr>
  <plaintiff> ____________ Plaintiff     Value of the claim Rs. ____________
  <defendant> ____________ Defendant     Court day ____________
  Application made by the above named Plaintiff - Defendant for issue of Process
  (and Deposit of witness Batta Etc.)                    (centred, bold)
  [10-column landscape table:
    1 Nature of process sought to be issued with section of law
    2 Nature and description of person on whom / whose property process issues
    3 The Municipal Division or other place where process is served/executed
    4 Distance in miles from court house
    5 Travelling Allowance for journey to and from Court house (Rs | P)
    6 Class of allowance
    7 Amount (Rs | P)
    8 For how many days
    9 Process fees (Rs | P)
    10 Remarks ]
  (one autofilled row per witness/process; a blank ruled row when none)

Landscape A4 so the wide table fits. FILL-IN FORM — never refuses; missing values
render as blank cells. No letterhead / no [DRAFT] banner (matches the advocate
form, like the other advocate-matched forms).
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.table import WD_ROW_HEIGHT_RULE

doc = Document()
sec = doc.sections[0]
# LANDSCAPE so the 10-column table fits.
sec.orientation = WD_ORIENT.LANDSCAPE
sec.page_width, sec.page_height = sec.page_height, sec.page_width
sec.top_margin = Inches(0.5); sec.bottom_margin = Inches(0.5)
sec.left_margin = Inches(0.6); sec.right_margin = Inches(0.6)
W = sec.page_width - sec.left_margin - sec.right_margin

st = doc.styles["Normal"]
st.font.name = "Times New Roman"; st.font.size = Pt(11)
st.paragraph_format.space_after = Pt(0); st.paragraph_format.line_spacing = 1.1


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


def cell_text(cell, text, bold=False, align=None, size=None):
    p = cell.paragraphs[0]
    if align == "center": p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(text); r.bold = bold
    if size: r.font.size = Pt(size)
    return p


# NOTE: no review banner — matches the advocate's clean printed form.

# ---- court heading: IN THE COURT OF <court> [AT <place>] --------------------
# court_at is empty when the place is already inside the court name (so we never
# print "... Court, Chennai AT Chennai").
line("IN THE COURT OF{% if court_name %} {{ court_name }}{% else %} ______"
     "{% endif %}{% if court_at %} AT {{ court_at }}{% endif %}",
     align="center", bold=True, size=15, after=8)

# ---- O.S. No. <no> of 20<yr> ------------------------------------------------
pos = para(after=8)
pos.paragraph_format.left_indent = Inches(0.4)
run(pos, "O.S. No. ")
run(pos, "{% if os_no %}{{ os_no }}{% else %}____________{% endif %}")
run(pos, "  of 20")
run(pos, "{% if os_year %}{{ os_year }}{% else %}____{% endif %}")

# ---- header block: left = parties, right = value/court day (2-col table) -----
htbl = doc.add_table(rows=2, cols=2)
htbl.autofit = True
# left cells: plaintiff / defendant (name on an underline + role); right: value/day
lc0 = htbl.rows[0].cells[0]; rc0 = htbl.rows[0].cells[1]
lc1 = htbl.rows[1].cells[0]; rc1 = htbl.rows[1].cells[1]
p_pl = lc0.paragraphs[0]
run(p_pl, "{% if plaintiff_name %}{{ plaintiff_name }}{% else %}"
          "________________________________{% endif %}  ")
run(p_pl, "Plaintiff", bold=True)
p_df = lc1.paragraphs[0]
run(p_df, "{% if defendant_name %}{{ defendant_name }}{% else %}"
          "________________________________{% endif %}  ")
run(p_df, "Defendant", bold=True)
p_v = rc0.paragraphs[0]
run(p_v, "Value of the claim Rs. ", bold=True)
run(p_v, "{% if value_of_claim %}{{ value_of_claim }}{% else %}____________________{% endif %}")
p_cd = rc1.paragraphs[0]
run(p_cd, "Court day ", bold=True)
run(p_cd, "{% if court_day %}{{ court_day }}{% else %}____________________{% endif %}")
# remove borders on this header table (it's a layout table, not a ruled grid)
htbl.style = "Normal Table"
para(after=6)

# ---- application line (centred, bold) ---------------------------------------
line("Application made by the above named Plaintiff - Defendant for issue of "
     "Process (and Deposit of witness Batta Etc.)", align="center", bold=True, after=8)

# ---- 10-column schedule table ----------------------------------------------
HEADERS = [
    ("Nature of process sought to be issued with section of law", 1.4),
    ("Nature and description of person on whom or on whose property process is sought to be issued or executed", 2.0),
    ("The Municipal Division or other place where the process is to be served or executed", 1.6),
    ("Distance in miles from court house", 0.9),
    ("Travelling Allowance for journey to and from Court house", 1.3),
    ("Class of allowance", 0.8),
    ("Amount", 1.0),
    ("For how many days", 0.9),
    ("Process fees", 1.0),
    ("Remarks", 0.9),
]
tbl = doc.add_table(rows=1, cols=10)
tbl.style = "Table Grid"
tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
for c, (h, wd) in zip(tbl.rows[0].cells, HEADERS):
    cell_text(c, h, bold=True, align="center", size=9)
    c.width = Inches(wd)
# column-number row (1..10) as on the form
numrow = tbl.add_row().cells
for i, (c, (_, wd)) in enumerate(zip(numrow, HEADERS), start=1):
    cell_text(c, str(i), bold=True, align="center", size=9)
    c.width = Inches(wd)
# Rs/P sub-labels under the money columns (5, 7, 9) — a light guide row.
subrow = tbl.add_row().cells
for idx, (c, (_, wd)) in enumerate(zip(subrow, HEADERS)):
    if idx in (4, 6, 8):  # TA, Amount, Process fees
        cell_text(c, "Rs        P", align="center", size=8)
    c.width = Inches(wd)

# data rows: one per document/witness (docxtpl {%tr for%} in a SEPARATE for-row,
# the data row, then a SEPARATE endfor-row — the single-row form breaks in
# docxtpl 0.20.2). Only autofilled rows render; if `rows` is empty a blank ruled
# row is emitted instead (see the {% if rows %} guard around the data block).
for_row = tbl.add_row().cells
run(for_row[0].paragraphs[0], "{%tr for r in rows %}")
drow_obj = tbl.add_row()
drow = drow_obj.cells
# TALL data rows (AT_LEAST 0.9") so the blank schedule FILLS the page like the
# advocate's printed form — a big writable ruled area — while still auto-growing
# taller when the advocate types a long entry (AT_LEAST is a floor, not a cap).
drow_obj.height = Inches(0.75)
drow_obj.height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
cols = ["nature_of_process", "person_description", "place_of_service", "distance_miles",
        "travelling_allowance", "class_of_allowance", "amount", "for_how_many_days",
        "process_fees", "remarks"]
for c, key, (_, wd) in zip(drow, cols, HEADERS):
    cell_text(c, "{{ r." + key + " or '' }}", size=9)
    c.width = Inches(wd)
endfor_row = tbl.add_row().cells
run(endfor_row[0].paragraphs[0], "{%tr endfor %}")
# NOTE: the pipeline always supplies rows — the autofilled ones, or a set of blank
# ruled rows when nothing was extracted — so no separate empty-row fallback is
# needed here. Each cell is auto-height, so a manual entry grows its row in Word.

para(after=4)

# ---- footer: place / date + signature (Counsel for <role>) ------------------
# "Dated at <place> on this the <day> day of <month> <year>." — each part fills
# from a filing date on record; otherwise the advocate-form blank fill-in lines.
pf = para(after=6)
run(pf, "Dated at ")
run(pf, "{% if place %}{{ place }}{% else %}__________{% endif %}")
run(pf, " on this the ")
run(pf, "{% if filing_day %}{{ filing_day }}{% else %}____________{% endif %}")
run(pf, " day of ")
run(pf, "{% if filing_month %}{{ filing_month }}{% else %}____________{% endif %}")
run(pf, " ")
run(pf, "{% if filing_year %}{{ filing_year }}{% else %}20____{% endif %}")
run(pf, ".")
pcf = para(align="right", after=0)
run(pcf, "Counsel for ")
run(pcf, "{% if applicant_role %}{{ applicant_role }}{% else %}Plaintiff / Defendant{% endif %}")

out = r"C:\Users\salma\OneDrive\Documents\LEXDRAFT\lexdraft-engine\templates\shared\batta_witness.docx"
doc.save(out)
print("WROTE", out)
