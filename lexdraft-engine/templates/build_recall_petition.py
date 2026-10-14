"""Author recall_petition.docx to the ADVOCATE'S EXACT format (02_Recall_Petition.pdf):

  In the Court of Hon'ble Judicial Magistrate      (centred, bold, large)
  AT <place> .                                     (centred, bold)
  C.C. / Crime No. <no>
  <accused>                       ... Petitioner /Accused   (right-ish)
  -Vs-                                             (centred)
  State by S.I. of Police <...>   Complainant / Respondent
  PETITION U/S.70 (2) Cr.P.C.                      (centred, bold, underlined)
  The above named accused was / were unable to attend this Honourable court.
  The absence of the accused was / were neither wilful nor wanton.
  The accused reliable understands that this Hon'ble Court issued N.B.W. / B.W.
  against him / her / them.
  It is therefore prayed that this Honourable Court may be pleased to recall the
  warrant of arrest issued against the accused, cancel the same and release the
  accused on his/ her / their own bond and render Justice.
  Dated at <place> on <day> day of <month> / 20<yr>
  Accused Signature                          Counsel for the Accused

Autofill: court, place, C.C./Crime No., accused, complainant and date fill from the
case; a missing value renders as the form's blank fill-in line. Verbatim clauses
always. FILL-IN FORM — never refuses. No letterhead / no [DRAFT] banner.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT

doc = Document()
sec = doc.sections[0]
# A4 printable page (210 x 297 mm = 8.27 x 11.69 in).
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

# ---- court heading ----------------------------------------------------------
# Large display heading like the advocate form (spans most of the page width),
# clearly bigger than the body text.
line("In the Court of Hon'ble Judicial Magistrate"
     "{% if court_name %} {{ court_name }}{% endif %}",
     align="center", bold=True, size=20, after=4)
# AT line — court_at is empty when the place is already in the court name.
line("AT {% if court_at %}{{ court_at }}{% else %}____________{% endif %} .",
     align="center", bold=True, size=15, after=12)

# ---- C.C. / Crime No. -------------------------------------------------------
line("C.C. / Crime No. {% if cc_no %}{{ cc_no }}{% else %}____________________{% endif %}",
     align="center", after=6)

# ---- party block with LARGE open gaps (matches the advocate form) ------------
# The printed form leaves a big writable area for each party's full description:
# a wide gap after the C.C. line before "... Petitioner / Accused", around "-Vs-",
# and after the complainant. `before` opens the space above each line.
pa = para(after=6, before=64)
pa.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(pa, "{% if accused_name %}{{ accused_name }}{% endif %}")
run(pa, "\t... Petitioner / Accused")
# -Vs- centred, with space above and below
line("-Vs-", align="center", after=6, before=30)
# complainant / respondent (right label), with space above
pc = para(after=14, before=48)
pc.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(pc, "{% if complainant_name %}{{ complainant_name }}{% else %}State by S.I. of Police{% endif %}")
run(pc, "\tComplainant / Respondent")

# ---- TITLE: PETITION U/S.70 (2) Cr.P.C. (centred, bold, underlined) ----------
line("PETITION U/S.70 (2) Cr.P.C.", align="center", bold=True, underline=True, after=12)

# ---- verbatim submission clauses --------------------------------------------
line("The above named accused was / were unable to attend this Honourable court.",
     align="justify", after=8)
line("The absence of the accused was / were neither wilful nor wanton.",
     align="justify", after=8)
line("The accused reliable understands that this Hon'ble Court issued "
     "{% if warrant_type %}{{ warrant_type }}{% else %}N.B.W. / B.W.{% endif %} "
     "against him / her / them.", align="justify", after=8)
line("It is therefore prayed that this Honourable Court may be pleased to recall "
     "the warrant of arrest issued against the accused, cancel the same and release "
     "the accused on his / her / their own bond and render Justice.",
     align="justify", after=16)

# ---- Dated at <place> on <day> day of <month> / 20<yr> ----------------------
pd = para(after=24)
run(pd, "Dated at ")
run(pd, "{% if place %}{{ place }}{% else %}__________{% endif %}")
run(pd, " on ")
run(pd, "{% if filing_day %}{{ filing_day }}{% else %}________{% endif %}")
run(pd, " day of ")
run(pd, "{% if filing_month %}{{ filing_month }}{% else %}____________{% endif %}")
run(pd, " / 20")
run(pd, "{% if filing_year %}{{ filing_year[-2:] }}{% else %}__{% endif %}")

# ---- signatures: Accused Signature (left) | Counsel for the Accused (right) --
psig = para(after=0)
psig.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(psig, "Accused Signature")
run(psig, "\tCounsel for the Accused")

out = r"C:\Users\salma\OneDrive\Documents\LEXDRAFT\lexdraft-engine\templates\shared\recall_petition.docx"
doc.save(out)
print("WROTE", out)
