"""Fixed engine INBOUND fields for the gold templates — shared by the golden fidelity
tests and the pagination-baseline tool so both render the exact same document THROUGH
THE REAL ADAPTER (coerce -> build -> resolve_context), not a synthetic template dict.

Rendering through the adapter is deliberate: it makes the tests assert the
template<->engine-context contract (a template referencing a key the context doesn't
provide fails), which a hand-written context dict would silently hide.

These are the fields the (generated) web form submits, already engine-typed (as the
Node field-map's contract coercion would produce): lists as lists, bools as bools.
Deterministic; no wall-clock.
"""
# Dates are ISO strings and lists/bools are native — exactly the wire shape the adapter's
# coerce() expects at the /v1/draft boundary (the Node field-map produces this from the
# web form: dates pass through as strings, string_list -> list, bool -> boolean).
REGULAR_BAIL_ENGINE_FIELDS = {
    "accused_name": "Dinesh Kumar @ Dinesh",
    "accused_parentage": "S/o Kumaravel",
    "age": 34,
    "occupation": "lorry driver",
    "address": "47, Kamaraj Nagar, Avadi, Chennai 600054",
    "fir_no": "812/2024",
    "police_station": "Avadi",
    "district": "Tiruvallur",
    "sections": ["BNS s.303(2)", "BNS s.317(2)"],
    "offence_date": "2024-09-12",
    "proceeding_start_date": "2024-09-14",
    "is_fresh_action": True,
    "custody_since": "2024-09-16",
    "as_on": "2024-12-20",
    "prison": "Puzhal Central Prison, Chennai",
    "chargesheet_filed": True,
    "is_successive": False,
    "court_level": "Principal Sessions Judge, Tiruvallur",
    "bail_court": "Principal Sessions Court, Tiruvallur",
    "application_date": "2024-12-20",
    "place": "Chennai",
}

# s.138 notice — a 2-cheque matter (which the old single-cheque form could not
# represent). `cheques` is an array of engine-keyed records, as the generated form + the
# Node field-map's list coercion produce.
S138_NOTICE_ENGINE_FIELDS = {
    "client": "Tmt. Lakshmi Narayanan",
    "recipient_name": "Thiru. K. Murugan",
    "recipient_address": "12, Bharathi Street, Variety Hall Road, Coimbatore 641001",
    "advocate": "R. Sundaravadivel",
    "advocate_enrolment": "MS/2287/2011",
    "cheques": [
        {"number": "452118", "date": "2024-11-04", "amount": 450000,
         "bank": "Indian Overseas Bank", "branch": "Town Hall, Coimbatore",
         "drawer": "K. Murugan", "payee": "Lakshmi Narayanan"},
        {"number": "452119", "date": "2024-11-04", "amount": 125000,
         "bank": "Indian Overseas Bank", "branch": "Town Hall, Coimbatore",
         "drawer": "K. Murugan", "payee": "Lakshmi Narayanan"},
    ],
    "debt_nature": "a hand loan of Rs. 5,75,000/- advanced on 10-06-2024 towards working capital",
    "debt_documents": ["on-demand promissory note dated 10-06-2024",
                       "acknowledgement of debt dated 10-06-2024"],
    "presentation_date": "2024-11-08",
    "presentation_bank": "City Union Bank, R.S. Puram",
    "memo_date": "2024-11-11",
    "memo_received_date": "2024-11-13",
    "dishonour_reason": "Funds insufficient",
    "notice_date": "2024-11-25",
    "dispatch_mode": "Registered Post Acknowledgement Due",
    "dispatch_tracking_placeholder": "{{ rpad_consignment_no }}",
    "place": "Coimbatore",
}

# Affidavit — a plain individual-deponent supporting affidavit for a writ petition.
AFFIDAVIT_ENGINE_FIELDS = {
    # matter_type "other" so the s.138 cheque/dishonour fields are NOT required —
    # these fixtures exercise the affidavit shell, not the s.138 matter.
    "matter_type": "other",
    "affidavit_kind": "supporting",
    "deponent_name": "Tmt. P. Revathi",
    "age": 42,
    "parentage_type": "W/o",
    "parentage_name": "Murugan",
    "occupation": "agriculturist",
    "address": "14, Gandhi Street, Salem 636001",
    "role": "petitioner",
    "proceeding": "W.P. No. 3421 of 2024",
    "place": "Salem",
    "attestor": "Notary Public, Salem",
    "body_paras": [
        "The impugned order dated 18-07-2024 is contrary to Rule 8-A of the TN Minor "
        "Mineral Concession Rules.",
        "The respondents have failed to decide the renewal application within the "
        "statutory period.",
        "The petitioner has no other efficacious remedy.",
    ],
    "prayer": "allow the writ petition and quash the impugned inaction",
    "affirm_date": "2024-09-04",
    "court_place": "High Court of Judicature at Madras",
}

# Corporate deponent — MUST carry the authority reference (the mandatory averment).
AFFIDAVIT_CORPORATE_FIELDS = {
    **AFFIDAVIT_ENGINE_FIELDS,
    "deponent_name": "R. Anand, Director",
    "role": "authorised signatory of the petitioner company",
    "is_corporate": True,
    "authority_ref": "Board Resolution dated 01-08-2024",
}

# Third-party deponent — MUST carry the source-of-knowledge averment.
AFFIDAVIT_THIRD_PARTY_FIELDS = {
    **AFFIDAVIT_ENGINE_FIELDS,
    "deponent_name": "K. Selvam",
    "role": "power-of-attorney holder of the petitioner",
    "is_third_party": True,
    "source_of_knowledge": "the records of the petitioner maintained in my custody",
}

# Full COURT affidavit — the reference format (cause-title + parties + AFFIDAVIT OF
# heading + VERIFICATION). An Order XXXVII suit, director deponent.
AFFIDAVIT_COURT_FIELDS = {
    "matter_type": "civil_suit",
    "affidavit_kind": "supporting",
    "deponent_name": "Sh. Rakesh Sharma",
    "age": 38,
    "parentage_type": "S/o",
    "parentage_name": "Late Sh. Vinod Sharma",
    "occupation": "Director",
    "address": "12 Ring Road, New Delhi",
    "role": "Authorized Representative / Director of the Plaintiff",
    "proceeding": "Suit under Order XXXVII CPC",
    "place": "Delhi",
    "attestor": "Oath Commissioner, Delhi",
    "body_paras": [
        "I say that the accompanying Suit has been drafted and filed by my counsel upon "
        "my instructions and contents of the same are true and correct.",
        "I say that the documents filed along with the plaint are true copies of originals.",
    ],
    "prayer": "decree the suit as prayed",
    "court_name": "DISTRICT JUDGE",
    "court_district": "New Delhi",
    "suit_no": "123",
    "suit_year": "2026",
    "suit_under": "SUIT UNDER ORDER XXXVII OF THE CODE OF CIVIL PROCEDURE, 1908",
    "plaintiff_name": "M/s ABC Pvt. Ltd.",
    "plaintiff_description": "A Company Incorporated Under The Companies Act, "
                            "Having Its Registered Office At New Delhi.",
    "defendant_name": "M/s XYZ Ltd.",
    "defendant_description": "A Company Incorporated Under The Companies Act, "
                            "Having Its Registered Office At Delhi.",
    "deponent_capacity": "the director of M/s ABC Pvt. Ltd.",
    "verification_place": "Delhi",
    "affirm_date": "2026-01-15",
}


# s.138 affidavit — matter_type "s138" DRAGS IN the conditional cheque + dishonour
# contract (the same cheque item spec the notice uses). A power agent of the
# complainant swears it; the authority_ref must recite (STEP 3d). Golden coverage of
# the conditional path so a change to requires_when is caught.
AFFIDAVIT_S138_FIELDS = {
    "matter_type": "s138",
    "affidavit_kind": "s145_proof",
    "deponent_name": "S. Karthik",
    "age": 45,
    "parentage_type": "S/o",
    "parentage_name": "Subramaniam",
    "occupation": "business",
    "address": "22, Mint Street, Chennai 600079",
    "role": "power agent of the complainant",
    "proceeding": "C.C. No. 512 of 2026 under s.138 NI Act",
    "place": "Chennai",
    "attestor": "Notary Public, Chennai",
    "body_paras": [
        "I am the power agent of the complainant and competent to swear this affidavit.",
        "The accused issued the cheque in discharge of a legally enforceable debt.",
        "The cheque was dishonoured and the statutory notice was duly issued and served.",
    ],
    # prayer is a required contract field so it is supplied, but the template
    # SUPPRESSES it for a s.145 proof affidavit (affidavit_kind == "s145_proof"):
    # the proof affidavit is evidence in chief, not a petition. See the golden test's
    # assert "prayed" not in t.
    "prayer": "take this proof affidavit on record",
    # authority_ref present on an INDIVIDUAL power agent — must render (STEP 3d).
    "authority_ref": "Power of Attorney dated 05-08-2026",
    # The conditional s.138 particulars (required because matter_type == "s138").
    "cheques": [{
        "number": "452118", "date": "2026-04-16", "amount": 399088,
        "bank": "IOB", "branch": "Town Hall", "drawer": "Murugan", "payee": "Lakshmi",
    }],
    "presentation_date": "2026-04-20",
    "presentation_bank": "CUB",
    "memo_date": "2026-04-22",
    "memo_received_date": "2026-04-24",
    "dishonour_reason": "Funds insufficient",
    "notice_date": "2026-05-02",
    "affirm_date": "2026-05-10",
}


