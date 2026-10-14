"""Author surety_memo.docx to the ADVOCATE'S EXACT format (06_Surety_Memo.pdf):

  IN THE COURT OF <court> MAGISTRATE :: AT <place>   (centred, LARGE bold)
  Crime No. <no> of 202<yr>                          (centred)
  (On the file of the Respondent)                    (centred, smaller)
  State : <state>
  Inspector of Police, <inspector>
                                        --- Complainant   (right, lower)
  - Versus -                                         (centred)
                                        --- Accused       (right)
  <accused>
  SURETY MEMO                                        (centred, bold, underlined)
  It is submitted that as per the orders of this Hon'ble Court, the sureties is
  being furnished for the accused above named, it may be accepted and the accused
  may be released on bail and thus render justice.
  Dated at <place> on this the <day> day of <month> 202<yr>
                                     Counsel For Petitioner / Accused   (right)

A4 page. Large gaps between party lines (writable area) like the original. Autofill:
court, place, Crime no., State/Inspector, accused, date fill from the case; a
missing value renders as the form's blank fill-in line. FILL-IN FORM — never
refuses. No letterhead / no [DRAFT] banner.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT

doc = Document()
sec = doc.sections[0]
# A4 printable page (210 x 297 mm).
sec.page_width = Inches(8.27); sec.page_height = Inches(11.69)
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


# NOTE: no review banner — matches the advocate's clean printed form.

# ---- court heading (advocate frame: "IN THE COURT OF ___ MAGISTRATE :: AT ___")
line("IN THE COURT OF {% if court_name %}{{ court_name }}{% else %}________________"
     "{% endif %} MAGISTRATE :: AT {% if court_at %}{{ court_at }}{% else %}________"
     "{% endif %}", align="center", bold=True, size=15, after=10)

# ---- Crime No. <no> of 202<yr> + (On the file of the Respondent) -------------
line("Crime No. {% if crime_no %}{{ crime_no }}{% else %}____________{% endif %} of "
     "{% if crime_year %}{{ crime_year }}{% else %}202__{% endif %}",
     align="center", after=2)
line("(On the file of the Respondent)", align="center", size=11, after=12)

# ---- complainant side: State / Inspector (left) + "--- Complainant" (right) --
line("State : {% if state_name %}{{ state_name }}{% endif %}", after=2)
line("Inspector of Police, {% if police_inspector %}{{ police_inspector }}{% endif %}",
     after=6)
line("--- Complainant", align="right", after=6, before=30)
# ---- - Versus - centred -----------------------------------------------------
line("- Versus -", align="center", after=6, before=24)
# ---- "--- Accused" (right) then the accused name -----------------------------
line("--- Accused", align="right", after=2, before=30)
line("{% if accused_name %}{{ accused_name }}{% endif %}", after=12)

# ---- TITLE: SURETY MEMO (centred, bold, underlined) -------------------------
line("SURETY MEMO", align="center", bold=True, underline=True, after=12)

# ---- verbatim submission clause ---------------------------------------------
line("It is submitted that as per the orders of this Hon'ble Court, the sureties "
     "is being furnished for the accused above named, it may be accepted and the "
     "accused may be released on bail and thus render justice.",
     align="justify", after=16)

# ---- Dated at <place> on this the <day> day of <month> 202<yr> --------------
pd = para(after=24)
run(pd, "Dated at ")
run(pd, "{% if place %}{{ place }}{% else %}__________{% endif %}")
run(pd, " on this the ")
run(pd, "{% if filing_day %}{{ filing_day }}{% else %}________{% endif %}")
run(pd, " day of ")
run(pd, "{% if filing_month %}{{ filing_month }}{% else %}____________{% endif %}")
run(pd, " {% if filing_year %}{{ filing_year }}{% else %}202__{% endif %}")

# ---- signature: Counsel For Petitioner / Accused (right) --------------------
line("Counsel For Petitioner / Accused", align="right", after=0)

out = r"C:\Users\salma\OneDrive\Documents\LEXDRAFT\lexdraft-engine\templates\shared\surety_memo.docx"
doc.save(out)
print("WROTE", out)
