"""Author process_memo.docx to the ADVOCATE'S EXACT format (03_Process_Memo.pdf):

  IN THE COURT OF <court> MAGISTRATE          (centred, LARGE bold display title)
  AT <place>                                  (centred, bold)
  DVC No. <no> OF 20<yr>                       (centred)
  <petitioner>                    - Petitioner   (right label)
  - Vs -                                        (centred)
  <respondent>                    - Respondents  (right label)
  PROCESS MEMO                                  (centred, bold)
  It is prayed that this Hon'ble court may be pleased issue summons / warrant to
  the above named accused / Petitioner in the following address and thus render
  justice.
  Dated at <place> this the <day> day of <month>
  Address for Service <addr>
                                     COUNSEL FOR THE PETITIONER   (right)

A4 page. Large gaps between party lines (writable area) like the original. Autofill:
court, place, DVC no., parties, address, date fill from the case; a missing value
renders as the form's blank fill-in line. FILL-IN FORM — never refuses. No
letterhead / no [DRAFT] banner.
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

# ---- court heading (advocate frame: "IN THE COURT OF ___ MAGISTRATE") --------
# The advocate form's fixed frame is "IN THE COURT OF <blank> MAGISTRATE" on one
# line. We keep that frame: "IN THE COURT OF" and "MAGISTRATE" always, with the
# court name (autofilled) sitting between them. Line 1 is the frame; the court
# name — which can be long — goes on line 1 inline but at a slightly smaller size
# so the frame stays on one visual line. Uses a blank underline when no court.
line("IN THE COURT OF {% if court_name %}{{ court_name }}{% else %}"
     "________________{% endif %} MAGISTRATE",
     align="center", bold=True, size=18, after=4)
line("AT {% if court_at %}{{ court_at }}{% else %}____________{% endif %}",
     align="center", bold=True, size=14, after=8)

# ---- DVC No. <no> OF <year> -------------------------------------------------
# case_year is already normalised to a full 4-digit year by the pipeline, so print
# it directly (NOT "20"+year, which produced "OF 202026"). Blank -> "OF 20____".
line("DVC No. {% if case_no %}{{ case_no }}{% else %}____________{% endif %} "
     "OF {% if case_year %}{{ case_year }}{% else %}20____{% endif %}",
     align="center", after=6)

# ---- party block with LARGE open gaps (matches the advocate form) -----------
pp = para(after=6, before=48)
pp.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(pp, "{% if petitioner_name %}{{ petitioner_name }}{% endif %}")
run(pp, "\t- Petitioner")
line("- Vs -", align="center", after=6, before=24)
pr = para(after=12, before=48)
pr.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(pr, "{% if respondent_name %}{{ respondent_name }}{% endif %}")
run(pr, "\t- Respondents")

# ---- TITLE: PROCESS MEMO (centred, bold) ------------------------------------
line("PROCESS MEMO", align="center", bold=True, after=12)

# ---- verbatim prayer clause -------------------------------------------------
line("It is prayed that this Hon'ble court may be pleased issue "
     "{% if process_type %}{{ process_type }}{% else %}summons / warrant{% endif %} "
     "to the above named accused / Petitioner in the following address and thus "
     "render justice.", align="justify", after=16)

# ---- Dated at <place> this the <day> day of <month> ------------------------
pd = para(after=14)
run(pd, "Dated at ")
run(pd, "{% if place %}{{ place }}{% else %}__________{% endif %}")
run(pd, " this the ")
run(pd, "{% if filing_day %}{{ filing_day }}{% else %}________{% endif %}")
run(pd, " day of ")
run(pd, "{% if filing_month %}{{ filing_month }}{% else %}____________{% endif %}")

# ---- Address for Service ----------------------------------------------------
line("Address for Service {% if address_for_service %}{{ address_for_service }}"
     "{% else %}________________________________________{% endif %}", after=48)

# ---- signature: COUNSEL FOR THE PETITIONER (right) --------------------------
line("COUNSEL FOR THE PETITIONER", align="right", bold=False, after=0)

out = r"C:\Users\salma\OneDrive\Documents\LEXDRAFT\lexdraft-engine\templates\shared\process_memo.docx"
doc.save(out)
print("WROTE", out)
