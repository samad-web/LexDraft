"""Author call_for_memo.docx to the ADVOCATE'S EXACT format (01_Call_for_Memo.pdf):

  In the Court of Hon'ble Judicial Magistrate <court>   (centred, bold)
                                  - <pincode>.
  C.C.No. <no> ... of 202 <yr> .
  <complainant>                                 ... Complainant   (right label)
  -Versus-                                       (centred)
  <accused>                                      ... Accused
  CALL FOR MEMO                                  (centred, bold, underlined)
  It is submitted that the above named accused persons applied for certified
  copy of the following documents.
  1) <doc>   2) <doc>  ...  (numbered fill-in list; blanks when absent)
  For .......... and the office called for deposit Court fee of Rs. ....../- the
  same is herewith deposited it may be accepted and thus render justice.
  Dated at <place> on this the ___ day of ___ 202 ___.
                                                COUNSEL FOR ACCUSED   (right)

Autofill: court, pincode, C.C. no, parties, documents, fee and date fill from the
case; a missing value renders as the form's blank fill-in line. FILL-IN FORM —
never refuses. No letterhead / no [DRAFT] banner (matches the advocate's clean
printed form, like the other advocate-matched forms).
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


# NOTE: no review banner — matches the advocate's clean printed form.

# ---- court heading: "In the Court of Hon'ble Judicial Magistrate <court>" -----
line("In the Court of Hon'ble Judicial Magistrate"
     "{% if court_name %} {{ court_name }}{% endif %}",
     align="center", bold=True, size=14, after=2)
# pincode line ("- 600 016.")
line("- {% if pincode %}{{ pincode }}{% else %}____________{% endif %}.",
     align="center", after=12)

# ---- C.C.No. <no> ... of 202 <yr> . ----------------------------------------
pcc = para(after=10)
pcc.paragraph_format.left_indent = Inches(0.8)
run(pcc, "C.C.No. ")
run(pcc, "{% if cc_no %}{{ cc_no }}{% else %}____________{% endif %}")
run(pcc, "  ... of 202")
run(pcc, "{% if cc_year %}{{ cc_year }}{% else %}__{% endif %} .")

# ---- complainant ... Complainant (right label) ------------------------------
pco = para(after=10)
pco.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(pco, "{% if complainant_name %}{{ complainant_name }}{% endif %}")
run(pco, "\t... Complainant")
# -Versus- centred
line("-Versus-", align="center", after=10)
# accused ... Accused (right label)
pac = para(after=12)
pac.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(pac, "{% if accused_name %}{{ accused_name }}{% endif %}")
run(pac, "\t... Accused")

# ---- TITLE: CALL FOR MEMO (centred, bold, underlined) -----------------------
line("CALL FOR MEMO", align="center", bold=True, underline=True, after=12)

# ---- body opening -----------------------------------------------------------
line("It is submitted that the above named accused persons applied for certified "
     "copy of the following documents.", align="justify", after=8)

# ---- numbered document list -------------------------------------------------
# When documents are supplied, list each "1) <doc>". Otherwise print five blank
# numbered fill-in lines (1) .. 5)) exactly as on the advocate form.
ctl("{% if documents %}")
ctl("{% for d in documents %}")
line("{{ loop.index }}) {{ d }}", after=4)
ctl("{% endfor %}")
ctl("{% else %}")
for n in range(1, 6):
    line(f"{n})", after=4)
ctl("{% endif %}")
line("", after=4)

# ---- fee clause (verbatim, with fill-in blanks) -----------------------------
pf1 = para(align="justify", after=4)
run(pf1, "For ")
run(pf1, "{% if purpose %}{{ purpose }}{% else %}"
         "..........................................................................."
         "{% endif %}")
run(pf1, " and the")
pf2 = para(align="justify", after=4)
run(pf2, "office called for deposit Court fee of Rs. ")
run(pf2, "{% if court_fee %}{{ court_fee }}{% else %}______________{% endif %}")
run(pf2, " /- the same is herewith deposited")
line("it may be accepted and thus render justice.", align="justify", after=14)

# ---- Dated at <place> on this the ___ day of ___ 202 ___. -------------------
pdt = para(after=16)
run(pdt, "Dated at ")
run(pdt, "{% if place %}{{ place }}{% else %}__________{% endif %}")
run(pdt, " on this the ")
run(pdt, "{% if filing_day %}{{ filing_day }}{% else %}____________{% endif %}")
run(pdt, " day of ")
run(pdt, "{% if filing_month %}{{ filing_month }}{% else %}____________{% endif %}")
run(pdt, " 202")
run(pdt, "{% if filing_year %}{{ filing_year[-1] }}{% else %}__{% endif %} .")

# ---- signature: COUNSEL FOR ACCUSED (right) ---------------------------------
line("COUNSEL FOR ACCUSED", align="right", bold=True, after=0)

out = r"C:\Users\salma\OneDrive\Documents\LEXDRAFT\lexdraft-engine\templates\shared\call_for_memo.docx"
doc.save(out)
print("WROTE", out)
