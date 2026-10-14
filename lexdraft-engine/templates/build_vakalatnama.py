"""Author vakalatnama.docx to the ADVOCATE'S EXACT section structure (criminal /
small causes / civil), driven by the pipeline context. Mirrors the supplied forms:
  cause-title -> No. __ of 20__ -> executant+role -> Versus -> opposite+role ->
  VAKALAT(NAMA) heading -> verbatim body clause -> signature/LTI line ->
  [fee + counter-agreement for small causes] -> certificate (read_over w/ State
  Language | read_out | ACCEPTED) -> Executed Before ... -> I/we accept -> advocate
  LEFT block -> party RIGHT block -> page-break backing sheet.
No letterhead, no [DRAFT] banner styling — the banner renders only if the engine
sets review_banner (sign-off gate), same as other docs.
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


def run(p, text, bold=False, underline=False):
    r = p.add_run(text); r.bold = bold; r.underline = underline; return r


def line(text, **kw):
    b = kw.pop("bold", False); u = kw.pop("underline", False)
    p = para(**kw)
    if text:
        run(p, text, bold=b, underline=u)
    return p


def ctl(tag):
    p = para(after=0); run(p, tag); return p


# ---- (review banner intentionally OMITTED from the vakalatnama per user: the
#      "[DRAFT — not to be filed…]" line must not appear on the document. The
#      engine still computes the sign-off signal; it just isn't printed here.) ---

# ---- cause-title (court header in UPPER CASE) --------------------------------
line('{% if court_heading %}{{ court_heading | upper }}{% elif court_name %}IN THE COURT OF '
     '{{ court_name | upper }}{% else %}IN THE COURT OF ______{% endif %}',
     align="center", bold=True, after=6)
line("{{ case_ref or 'No. ______ of ' ~ (execution_date[:4] if execution_date else '20____') }}",
     align="center", after=12)

# ---- party memo: executant + role, Versus, opposite + role ------------------
# Party names bold (12pt); role right-aligned on the same line via a right tab.
pe = para(after=6)
r_pe = run(pe, "{{ executant_name }}", bold=True); r_pe.font.size = Pt(12)
pe.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(pe, "\t... {{ executant_label or party_role }}")
line("Versus", align="center", after=6)
po = para(after=14)
r_po = run(po, "{% if opposite_party_name %}{{ opposite_party_name }}{% else %}______{% endif %}", bold=True); r_po.font.size = Pt(12)
po.paragraph_format.tab_stops.add_tab_stop(W, WD_TAB_ALIGNMENT.RIGHT)
run(po, "\t... {{ opposite_label }}")

# ---- title ------------------------------------------------------------------
# The CIVIL advocate form has NO title on page 1 (the appoint clause follows the
# parties directly; the "VAKALAT" title appears only on the page-2 backing sheet).
# Criminal / small-causes / generic keep the page-1 title. show_page1_title is
# False for civil.
ctl("{% if show_page1_title %}")
line("{{ vakalat_title or 'VAKALATNAMA' }}", align="center", bold=True, underline=True, after=12)
ctl("{% endif %}")

# ---- body clause (verbatim per court kind; else neutral default) ------------
ctl("{% if body_clause %}")
line("I/We, {{ executant_name }}, the {{ party_role }} above-named, {{ body_clause }}",
     align="justify", after=10)
ctl("{% else %}")
line("I/We, {{ executant_name }}, the {{ party_role }} above-named, do hereby appoint "
     "and retain {% for a in advocates %}{{ a }}{% if not loop.last %}, {% endif %}"
     "{% endfor %} to appear for me/us in the above case and to conduct the same, and "
     "to accept on my/our behalf service of notice of all proceedings in the above "
     "case, until disposal of the case.", align="justify", after=10)
ctl("{% endif %}")

# ---- fee clause + counter-agreement (Small Causes) --------------------------
ctl("{% if has_fee_clause %}")
line("The terms upon which the said Counsel is to act for me/us as aforesaid are that "
     "he shall receive all out-fees and sum of Rs. {% if counsel_fee %}{{ counsel_fee }}"
     "{% else %}______{% endif %} as and for his fees for conducting the said "
     "matter/Suit and the regulation fee in addition to the above suit in all "
     "applications for adjournments, interlocutory application, execution proceedings "
     "whether the same shall be allowed by the court or not. This said counsel is at "
     "liberty to entrust the case to any other Counsel and is not bound to appear if "
     "the full fees are not paid before the trial of this suit.", align="justify", after=8)
ctl("{% endif %}")
ctl("{% if has_counter_agreement %}")
line("I/We hereby declare that no counter-agreement has been made between the said "
     "Counsel and myself/ourself or any person in respects of the said costs or "
     "remuneration.", align="justify", after=8)
ctl("{% endif %}")

# The tail of the instrument differs by form. The CIVIL form (date_style
# 'dated_at') runs:  Dated at ... -> certificate -> "Advocate" caption ->
# ACCEPTED address-for-service -> "Advocate for" (bottom-right), with NO
# "(Signature/LTI of the executant)" line. Other forms keep the historical
# order:  (Signature/LTI) -> certificate -> Executed Before -> [acceptance line].
ctl("{% if date_style == 'dated_at' %}")
# ---- CIVIL tail (matches advocate civil_vakalat.pdf) ------------------------
line("Dated at {{ place }} this ____________ day of ______________ 20____.", after=12)
line("I Certify that the contents of this Vakalat were read out and explained in my "
     "presence to the Executant who appeared perfectly to understand the same and made "
     "his/her/their signature in my presence.", align="justify", after=14)
# "Advocate" caption sits IMMEDIATELY above the ACCEPTED line (they are one pair in
# the advocate's original — after=2 keeps them tight, not a full blank line apart).
line("Advocate", bold=True, after=2)
ctl("{% if acceptance_clause %}")
line("{{ acceptance_clause }}", align="justify", after=6)
ctl("{% endif %}")
# "Advocate for <name>" bottom-right
line("{{ advocate_sign_label or 'Advocate for' }} {% for a in advocates %}{{ a }}"
     "{% if not loop.last %}, {% endif %}{% endfor %}", align="right", after=8)
ctl("{% else %}")
# ---- criminal / small-causes / generic tail (unchanged) --------------------
line("{{ signature_label or '(Signature / LTI of the executant)' }}",
     align="right", after=8)
ctl("{% if certificate_style == 'read_over' %}")
line("I Certify that the contents of this Vakalatnama were read over and explained in "
     "{% if state_language %}{{ state_language }}{% else %}______{% endif %} (State "
     "Language) in my Presence to the Executant who appeared perfectly to understand "
     "the same and made his/her/their signature in my Presence.", align="justify", after=8)
ctl("{% elif certificate_style == 'read_out' %}")
line("I Certify that the contents of this Vakalat were read out and explained in my "
     "presence to the Executant who appeared perfectly to understand the same and made "
     "his/her/their signature in my presence.", align="justify", after=8)
ctl("{% else %}")
line("ACCEPTED : No counter-agreement has been made between me and the said party or "
     "any person in respect of the said costs or remuneration.", align="justify", after=8)
ctl("{% endif %}")
line("Executed Before this ____ day of ____ 20____ at {{ place }}.", after=4)
ctl("{% if acceptance_line %}")
line("{{ acceptance_line }}", after=8)
ctl("{% endif %}")
ctl("{% endif %}")

# ---- advocate LEFT block + party RIGHT block --------------------------------
# The civil form has NO such details block, so the WHOLE block is wrapped in a
# {%p if show_details_block %} ... {%p endif %} pair (paragraph-level deletion —
# docxtpl removes the guarded paragraphs entirely, leaving no blank page). We use
# tab-stopped paragraphs (advocate label on the left, party label on the right)
# instead of a table so paragraph-level deletion works cleanly. Criminal /
# small-causes / generic keep the full block.
LEFTW = int(W * 0.52)  # right column starts just past the mid-point (EMU int)


def twocol(l_text, r_text, bold_l=False, bold_r=False):
    p = para(after=0)
    p.paragraph_format.tab_stops.add_tab_stop(LEFTW, WD_TAB_ALIGNMENT.LEFT)
    if l_text:
        run(p, l_text, bold=bold_l)
    run(p, "\t")
    if r_text:
        run(p, r_text, bold=bold_r)
    return p


# {%p if %} / {%p endif %} are docxtpl paragraph-deletion tags: for civil
# (show_details_block false) the opener, closer AND every paragraph between them
# are removed entirely, so no blank page is produced. Each tag sits alone in its
# own paragraph (via ctl) as docxtpl requires.
ctl("{%p if show_details_block %}")
twocol("(Advocate — with Enrolment No)", "Details of the Parties :", bold_l=True, bold_r=True)
twocol("{% for a in advocates %}{{ a }}{% if not loop.last %}, {% endif %}{% endfor %}",
       "Name : {{ executant_name }}")
twocol("{{ counsel_label or 'Counsel for' }}", "Any I.D. No : ______")
twocol("Address for service : {% if advocate_address_shown %}{{ address_for_service }}{% else %}______{% endif %}",
       "Mobile No. : {% if party_contact %}{{ party_contact }}{% else %}______{% endif %}")
twocol("Enrolment No : {% if enrolment_no %}{{ enrolment_no }}{% else %}______{% endif %}",
       "Address : {% if party_address %}{{ party_address }}{% else %}______{% endif %}")
twocol("Mobile No. : {% if advocate_mobile %}{{ advocate_mobile }}{% else %}______{% endif %}", "")
twocol("Email Id : {% if advocate_email %}{{ advocate_email }}{% else %}______{% endif %}", "")
# spacer kept INSIDE the guard so civil (no details block) drops it too, avoiding
# a trailing empty paragraph that would spill onto a blank page before the docket.
para(after=6)
ctl("{%p endif %}")

# ---- backing sheet / DOCKET (own page) --------------------------------------
# Laid out like the advocate's docket: content SPREAD down the full page — the
# cause-title at top, the parties RIGHT-ALIGNED with an underline under each party
# name (Petitioner over Complainant style), a large VAKALATNAMA centred in the
# MIDDLE of the page, then "Mr. <advocate>" lower-left and the counsel line at the
# BOTTOM. Generous space_after values create the vertical spread.
# Force the docket onto its own page via page-break-BEFORE on the heading itself
# (rather than a standalone break paragraph, which — combined with trailing empty
# control-tag paragraphs — was spilling a blank page between body and docket).
_dh = line('{% if court_heading %}{{ court_heading | upper }}{% elif court_name %}IN THE COURT OF '
     '{{ court_name | upper }}{% else %}IN THE COURT OF ______{% endif %}',
     align="center", bold=True, after=18)
_dh.paragraph_format.page_break_before = True
line("{{ case_ref or 'No. ______ of 20____' }}", align="center", after=54)
# Executant party — right-aligned, name UNDERLINED (line under it), role beneath.
pe1 = para(align="right", after=0)
r_pe1 = run(pe1, "{{ executant_name }}", bold=True, underline=True); r_pe1.font.size = Pt(12)
line("{{ party_role }}", align="right", bold=True, after=54)
line("Versus", align="center", after=54)
# Opposite party — right-aligned, name underlined, role beneath.
po1 = para(align="right", after=0)
r_po1 = run(po1, "{% if opposite_party_name %}{{ opposite_party_name }}{% else %}______{% endif %}",
            bold=True, underline=True); r_po1.font.size = Pt(12)
line("{{ opposite_label }}", align="right", bold=True, after=96)
# Large title, centred, in the middle of the sheet.
p_title = para(align="center", after=90)
r_title = run(p_title, "{{ vakalat_title or 'VAKALATNAMA' }}", bold=True, underline=True)
r_title.font.size = Pt(20)
# Advocate lower-left, counsel line at the bottom.
line("Mr./Ms. {% for a in advocates %}{{ a }}{% if not loop.last %}, {% endif %}{% endfor %}",
     bold=True, after=6)
line("{{ counsel_label or 'Counsel for' }}", after=0)
line("(with Enrolment No.{% if enrolment_no %} {{ enrolment_no }}{% endif %}"
     "{% if advocate_mobile %}, {{ advocate_mobile }}{% endif %})", after=2)

out = r"C:\Users\salma\OneDrive\Documents\LEXDRAFT\lexdraft-engine\templates\shared\vakalatnama.docx"
doc.save(out)
print("WROTE", out)
