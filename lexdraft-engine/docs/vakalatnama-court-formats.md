# Vakalatnama — court-specific formats

Reference for the three court-specific vakalatnama formats the engine encodes,
in addition to the render styles (LONG / EFILING). Sourced from advocate-supplied
TN/Madras practice forms. These drive the `court_kind` dimension of
`src/pipelines/vakalatnama.py`.

The two dimensions are orthogonal:
- **render style** (`VakalatKind`): LONG vs EFILING (how much detail / e-courts fields)
- **court kind** (`CourtKind`): CRIMINAL vs SMALL_CAUSES vs CIVIL (which court's form,
  party labels, body clause and certificate)

---

## 1. CRIMINAL

- **Cause-title:** `In the Court of ____` · `No. ____ Of 20__`
- **Party roles:** executant is one of **Petitioner / Accused / Complainant**;
  opposite is **Respondent / Complainant / Accused**. Separator: "Versus".
- **Title:** VAKALATNAMA
- **Body:** "I/We ____ do hereby appoint and retain Mr/Ms/Mrs/M/s. ____ To appear
  for me/us in the above case on my/our behalf and to plead and I/we further
  empower him/Her/them to accept on my/our behalf, service of notice of all
  Proceedings in the above case, until Disposal of the case."
- **Signature line:** "(Signature / LTI of the Complainant / Petitioner / Accused
  / Respondent)"
- **Certificate:** "I Certify that the contents of this Vakalatnama were read over
  and explained in ____ (State Language) in my Presence to Executant who appeared
  perfectly to understand the same and made his/her/their signature in my Presence."
- "Executed Before this day of ____ 20__" · "I/we accept the Vakalatnama"
- **Advocate block:** (Advocate – with Enrolment No) · Address for service ·
  Enrolment No · Mobile No · Email Id · M/s.
- **Party block:** Counsel for Complainant/Petitioner/Accused/Respondent (Enrolment
  No) · Details of the Parties: Name / Any I.D. No / Mobile No / Address.
- **Backing sheet:** IN THE COURT OF ____ · No ____ of 20__ · Petitioner|Complainant
  · Versus · Respondent|Accused · VAKALATNAMA · Mr. ____ · Counsel for
  Petitioner/Complainant (with Enrolment No. Phone Number).

## 2. SMALL_CAUSES (Court of Small Causes at Madras)

- **Cause-title:** `In the Court of Small Causes at Madras` · `Suit No. ____ of 20__`
- **Party roles:** **Plaintiff / Defendant / Claimant**. Separators: "Versus", "and".
- "Before the ____ Judge" · "Court Day ____ 20__"
- **Body:** "I/We ____ the Plaintiff/Defendant/Claimant abovenamed do hereby appoint
  Mr. ____ as my/our Counsel to Commence/defend the above matter/Suit to appear for
  me/us in the above cause and to conduct the same and all proceeding upon and decree
  or order that may be passed therein and draw moneys and half cost from court."
- **Fee clause:** "The terms upon which the said Counsel is to act for me/us as
  aforesaid are that he shall receive all out-fees and sum of Rs. ____ as and for his
  fees for conducting the said matter/Suit and the regulation fee in addition to the
  above suit in all applications for adjournments, interocutory application, execution
  proceedings whether the same shall be allowed by the court or not. This said counsel
  is at liberty to entrust the case to any other Counsel and is not bound to appear if
  the full fees are not paid before the trial of this suit."
- **Counter-agreement declaration (executant):** "I/We hereby declare that no
  counter-agreement has been made between the said Counsel and myself/ourself or any
  person in respects of the said costs or renumeration."
- "Dated this ____ day of ____ 20__" · signed Defendant/Plaintiff/Claimant.
- **ACCEPTED (counsel):** "ACCEPTED : No counter-agreement has been made between me
  and the said Plaintiff/Defendant/Claimant or any person in respect of the said cost
  or remuneration." · Address · Dated · Counsel for Plaintiff/Defendant.
- **Backing sheet:** Court of Small Causes / MADRAS · SUIT No. ____ of 20__ ·
  Plaintiff · Versus · Defendant · and · Claimant · VAKALAT · Mr. ____ · Advocate for
  Plaintiff/Defendant/Claimant. (footer mark "LAWE")

## 3. CIVIL

- **Cause-title:** `In the Court of ____` · `No. ____ of 20__`
- **Party roles:** executant **Plaintiff / Petitioner**; opposite **Defendant /
  Respondent**. Separator: "Versus".
- **Body:** "I/We ____ do hereby appoint To appear for And retain Me/Us In the above
  Suit/Original/Miscellaneous Petition and to conduct and prosecute Or defend the same
  and all proceedings that may be taken in respect of any application for any execution
  of any decree or order passed there in. I/We empower my/our Advocate to appear in all
  miscellaneous proceeding in the above suit or matter till all decree or orders are
  fully satisfied or adjusted and all appeals thereto whether in suit, interlocutory
  application, execution petitions and Applications in execution till they are finally
  disposed of in this court and to obtain the return of documents and draw moneys that
  might be payable to me/us in the said suit or matter. He is/They are also authorised
  to depute other Counsel to act on his/their behalf."
- "Dated at ____ this ____ day of ____ 20__"
- **Certificate:** "I Certify that the contents of this Vakalat[nama] were read out
  and explained In my presence to the Executant who appeared perfectly to understand
  the same and made his/her their signature in my presence."
- "Advocate" · "ACCEPTED : The address for service of the said Advocate is : ____
  20__" · Advocate for.
- **Backing sheet:** IN THE COURT OF ____ · No ____ of 20__ · Plaintiff/Petitioner ·
  Versus · Defendant/Respondent · VAKALAT · Mr. ____ · Advocate.

---

### Notes
- Party-role label sets are court-kind specific and offered as choices, not free text.
- Certificate wording differs: criminal "read over and explained in <State Language>";
  civil "read out and explained"; small-causes uses the counter-agreement ACCEPTED
  clause instead of a read-over certificate.
- Small Causes is hard-titled "Court of Small Causes at Madras" and adds a fee amount
  (Rs.) + counter-agreement declaration.
- **Civil layout specifics** (matched to `civil_vakalat.pdf`): the tail runs in the
  advocate's order — *Dated at → certificate → "Advocate" caption → ACCEPTED
  address-for-service → "Advocate for"* — and there is **no** "(Signature/LTI)" line
  and **no** 2-column advocate/party details block. These are driven by
  `date_style == "dated_at"`, `acceptance_clause`, `advocate_sign_label == "Advocate for"`
  and `show_details_block == False` on the CIVIL spec entry.
- **Template regeneration:** the `.docx` is authored programmatically by
  `templates/build_vakalatnama.py`. The advocate/party details block is now
  tab-stopped paragraphs (not a table) so it can be dropped for civil via
  `{%p if show_details_block %}…{%p endif %}` paragraph-deletion; the docket is
  forced onto its own page with page-break-*before* on its heading (a standalone
  page-break paragraph was spilling a blank page once the details block was removed).
  Run the script after any edit, then `pytest -k vakalat`.
