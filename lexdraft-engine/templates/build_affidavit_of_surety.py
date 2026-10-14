"""Author affidavit_of_surety.docx to the ADVOCATE'S EXACT format
(07_Affidavit_of_Surety.pdf) — the long 4-page statutory Rule-14 surety affidavit.

Structure (A4):
  IN THE COURT OF <court> MAGISTRATE :: AT <place>
  Crime No. <no> of 202<yr> / (On the file of the Complainant)
  State : <state> / Inspector of Police / <police station>       ---Complainant
  - Versus -                                                       ---Accused
  AFFIDAVIT OF SURETY
  I, <surety> S/o <parent> Indian/Hindu, aged about <age> years residing at <addr>
    do hereby solemnly affirm and sincerely states as follows:-
  1. I beg to offer myself as a surety for the accused Mr <accused> S/o ___ charged
     under sections <sections> ordered to be released on bail in the sum of
     Rs <sum> (Rupees <words> only) with the two sureties ... on <bail date>.
  2. I give below certain particulars concerning myself:
     (A) ... (B) ... (C) ... (D) ... (E) ... (F) ... (G)  [labelled : blanks]
  (3) I produce the following proof ... [proof list]
  3-B ... 4 ... 5 (prayer)
  Solemnly affirmed at <place> this the ___ day of ___ 202
  Identified by : / Before Me
  (Signature of Surety Advocate)          Signature of Surety

Autofill only the top particulars; the A-G questionnaire, proof list and jurat are
the fixed form with blank fill-in lines. FILL-IN — never refuses. No banner.
"""
from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT

doc = Document()
sec = doc.sections[0]
sec.page_width = Inches(8.27); sec.page_height = Inches(11.69)   # A4
sec.top_margin = Inches(0.9); sec.bottom_margin = Inches(0.9)
sec.left_margin = Inches(1.0); sec.right_margin = Inches(0.9)
W = sec.page_width - sec.left_margin - sec.right_margin

st = doc.styles["Normal"]
st.font.name = "Times New Roman"; st.font.size = Pt(12)
st.paragraph_format.space_after = Pt(0); st.paragraph_format.line_spacing = 1.15


def para(align=None, after=6, before=0, indent=None, hang=None):
    p = doc.add_paragraph(); pf = p.paragraph_format
    pf.space_after = Pt(after); pf.space_before = Pt(before)
    if indent is not None: pf.left_indent = Inches(indent)
    if hang is not None:
        pf.left_indent = Inches(hang); pf.first_line_indent = Inches(-hang)
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


DOT = "." * 30


def qa(label, tab=Inches(3.6)):
    """One 'Label : ___' questionnaire row (label left, colon at a tab)."""
    p = para(after=4, hang=0.3)
    p.paragraph_format.tab_stops.add_tab_stop(tab, WD_TAB_ALIGNMENT.LEFT)
    run(p, label)
    run(p, "\t: ")
    return p


# NOTE: no review banner — matches the advocate's clean printed form.

# ---- court heading ----------------------------------------------------------
line("IN THE COURT OF {% if court_name %}{{ court_name }}{% else %}____________"
     "{% endif %} MAGISTRATE :: AT {% if court_at %}{{ court_at }}{% else %}________"
     "{% endif %}", align="center", bold=True, size=13, after=10)

# ---- Crime No. + (On the file of the Complainant) ---------------------------
line("Crime No. {% if crime_no %}{{ crime_no }}{% else %}____________{% endif %} of "
     "{% if crime_year %}{{ crime_year }}{% else %}202__{% endif %}",
     align="center", after=2)
line("(On the file of the Complainant)", align="center", size=11, after=10)

# ---- complainant side: State / Inspector / Police Station + ---Complainant ---
line("State : {% if state_name %}{{ state_name }}{% endif %}", after=2)
line("Inspector of Police", after=2)
line("{% if police_station %}{{ police_station }}{% else %}________________{% endif %} "
     "Police Station", indent=0.5, after=6)
line("---Complainant", align="right", after=6, before=18)
line("- Versus -", align="center", after=6, before=12)
line("---Accused", align="right", after=10, before=18)

# ---- TITLE: AFFIDAVIT OF SURETY (centred, bold, underlined) ------------------
line("AFFIDAVIT OF SURETY", align="center", bold=True, underline=True, after=12)

# ---- deponent identification ------------------------------------------------
pdep = para(after=4, align="justify")
run(pdep, "I, ")
run(pdep, "{% if surety_name %}{{ surety_name }}{% else %}" + DOT + "{% endif %}")
run(pdep, " S/o ")
run(pdep, "{% if surety_parentage %}{{ surety_parentage }}{% else %}" + DOT + "{% endif %}")
run(pdep, " Indian / Hindu, aged about ")
run(pdep, "{% if surety_age %}{{ surety_age }}{% else %}......{% endif %}")
run(pdep, " years residing at ")
run(pdep, "{% if surety_address %}{{ surety_address }}{% else %}" + ("." * 45) + "{% endif %}")
line("." * 90, after=2)
line("do hereby solemnly affirm and sincerely states as follows:-", after=10)

# ---- clause 1 (verbatim, particulars autofilled) ----------------------------
p1 = para(after=10, align="justify", hang=0.3)
p1.paragraph_format.tab_stops.add_tab_stop(Inches(0.3), WD_TAB_ALIGNMENT.LEFT)
run(p1, "1.\t")
run(p1, "I beg to offer myself as a surety for the accused Mr ")
run(p1, "{% if accused_name %}{{ accused_name }}{% else %}" + DOT + "{% endif %}")
run(p1, " S/o ......................................., who is charged under sections ")
run(p1, "{% if offence_sections %}{{ offence_sections }}{% else %}" + ("." * 20) + "{% endif %}")
run(p1, " and who has been ordered to be released on bail in the sum of Rs ")
run(p1, "{% if bail_sum %}{{ bail_sum }}{% else %}............{% endif %}")
run(p1, " (Rupees ")
run(p1, "{% if bail_sum_words %}{{ bail_sum_words }}{% else %}" + ("." * 30) + "{% endif %}")
run(p1, " only) with the two sureties in the like amount by this Hon'ble Court on ")
run(p1, "{% if bail_order_date %}{{ bail_order_date }}{% else %}............{% endif %}")
run(p1, ".")

# ---- clause 2 + A-G particulars questionnaire (fixed, blank) -----------------
line("2.\tI give below certain particulars concerning myself:", after=8, hang=0.3)

line("(A)", bold=True, after=2, indent=0.2)
for lbl in ["Full name of the surety", "Qualifications if any",
            "Full residential address",
            "Period for which surety has been residing at the above address",
            "Rent paid for the residence",
            "Whether the rent Bill / Property Tax receipt of the residence stands in the surety's name"]:
    qa(lbl)
para(after=2)

line("(B)", bold=True, after=2, indent=0.2)
for lbl in ["Occupation or business", "Full business address",
            "Nature and extent of business and sureties share therein",
            "Rent paid for the place of Business",
            "Whether the Rent Bill / Property Tax Receipt of the place of business stands in the surety's name"]:
    qa(lbl)
para(after=2)

line("(C)", bold=True, after=2, indent=0.2)
for lbl in ["Name and address of employer if the surety is in service",
            "Full address of the place of service",
            "Length of service with the employer",
            "Amount of PF, if any, at surety's Credit"]:
    qa(lbl)
para(after=2)

line("(D)", bold=True, after=2, indent=0.2)
qa("Full particulars of house property owned, if any, its location, rateable Value "
   "and the surety's share or interest therein and whether it is in anyway encumbered")
para(after=2)

line("(E)", bold=True, after=2, indent=0.2)
for lbl in ["Amount of income Tax paid during each of the last 3 years",
            "Banking Accounts, if any", "Amounts now laying in each Banking Account"]:
    qa(lbl)
para(after=2)

line("(F)", bold=True, after=2, indent=0.2)
for lbl in ["Length of time for which the Surety has known the accused Personally",
            "Whether surety is related to the accused if so, how",
            "Whether the surety has stood surety for any other person in preceding 6 "
            "months. If so state the names of the parties, the amount, the court and "
            "the number of case, and whether pending or concluded",
            "Whether the surety has, at any time, made an application for suretyship "
            "which was rejected, if so, give the particulars thereof",
            "Whether surety is (or has been) involved in any civil litigation",
            "Whether the surety himself has been concerned in any case as an accused "
            "person, if so give Particulars of the case"]:
    qa(lbl)
para(after=2)

line("(G)", bold=True, after=2, indent=0.2)
qa("Any other particulars in regard to the Status of the surety or his income and "
   "assets, which the surety may desire to give")
para(after=6)

# ---- clause 3: proof produced -----------------------------------------------
line("(3)\tI produce the following proof in support of my statements and give the "
     "particulars of the same as below:", after=6, hang=0.3, align="justify")
line("Rent bills of place of residence, Ration Card, Rent bills of place of "
     "business, Deed of partnership or other documents relating to business, "
     "Certificate from the employer, certificate of amount in the Provident Fund, "
     "Title Deeds of properties, Municipality / Panchayat Bills of Properties, Bank "
     "Pass Books, Income Tax Payment Receipts.", after=4, align="justify", indent=0.3)
line("Other proof : ................................................................", after=6, indent=0.3)
line("As per sub-rule (4) of Rule 14, I produce one of the following documents "
     "mentioned below:", after=4, align="justify", indent=0.3)
for it in ["(i)  Passport",
           "(ii)  Identity card issued by Election Commission of India",
           "(iii)  PAN Card issued by the Income Tax Department",
           "(iv)  ATM / Debit Card or Credit Card issued by a Nationalized or "
           "Private Bank of standing at the National Level, having the photograph "
           "of the holder thereon, in conjunction with any other authentic document "
           "(telephone / electricity bill) as proof of residence",
           "(v)  Identity card issued by Government Authorities or Public statutory "
           "Corporations",
           "(vi)  Any such document ordinarily issued by an authority after due "
           "verification of identity and address, which the Magistrate may think just "
           "and proper, for reasons recorded"]:
    line(it, after=2, indent=0.6, hang=0.6)
para(after=6)

# ---- 3-B, 4, 5 --------------------------------------------------------------
line("3-B\tAs per sub-rule (6) of Rule 14, I produce two copies of my latest "
     "passport size photograph.", after=8, hang=0.4, align="justify")
line("4\tI hereby declare that I have not stood surety before / stood surety of "
     "any person (give all the relevant particulars).", after=8, hang=0.4, align="justify")
p5 = para(after=12, hang=0.4, align="justify")
p5.paragraph_format.tab_stops.add_tab_stop(Inches(0.4), WD_TAB_ALIGNMENT.LEFT)
run(p5, "5\t")
run(p5, "I pray that I may be accepted as a surety for the above mentioned accused "
        "in the sum of Rs ................ (Rupees ...................................."
        "................... only).")

# ---- jurat ------------------------------------------------------------------
pj = para(after=18)
run(pj, "Solemnly affirmed at ")
run(pj, "{% if place %}{{ place }}{% else %}..........................{% endif %}")
run(pj, " this the ")
run(pj, "{% if filing_day %}{{ filing_day }}{% else %}................{% endif %}")
run(pj, " day of ")
run(pj, "{% if filing_month %}{{ filing_month }}{% else %}................{% endif %}")
run(pj, " 202{% if filing_year %}{{ filing_year[-1] }}{% else %}__{% endif %}")

line("Identified by :", bold=True, after=6)
line("Before Me", bold=True, after=30)

psig = para(after=0)
psig.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(psig, "(Signature of Surety Advocate)", bold=True)
run(psig, "\tSignature of Surety", bold=True)

out = r"C:\Users\salma\OneDrive\Documents\LEXDRAFT\lexdraft-engine\templates\shared\affidavit_of_surety.docx"
doc.save(out)
print("WROTE", out)
