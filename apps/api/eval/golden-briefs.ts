// Golden set of representative legal drafting briefs.
//
// Each brief is a complete DraftRequest plus a quality rubric. The rubric is
// intentionally lightweight - substring + structural checks - because the
// goal is regression detection, not document-correctness adjudication. A
// drafted plaint that omits "Petitioner" or "prayer" is suspect regardless
// of how artful its prose is.
//
// Conventions:
// - IDs are kebab-case: <doc-type>-<topic>-<lang>-<tone>-<n>.
// - mustInclude/mustNotInclude are case-insensitive substring matches.
// - No real case citations - the briefs reference statute sections that exist
//   (CPC, CrPC, NI Act, etc.) but no specific judicial precedent.

import type { DraftRequest } from '@lexdraft/types';

export interface GoldenBrief {
  id: string;
  description: string;
  request: DraftRequest;
  expectations: {
    mustInclude: string[];
    mustNotInclude: string[];
    structuralChecks: {
      hasParagraphNumbers?: boolean;
      hasPartiesBlock?: boolean;
      hasPrayer?: boolean;
      hasVerification?: boolean;
      maxWords?: number;
      minWords?: number;
    };
  };
}

// Forbidden phrases the model should never emit when acting as an advocate
// drafting a court document. "I cannot" / "as an AI" indicate a refusal or
// persona break; "lorem ipsum" indicates a placeholder leak; markdown fences
// indicate the output wasn't stripped to plain text.
const COMMON_FORBIDDEN = [
  'as an AI',
  'I cannot',
  'I am unable',
  'I do not have',
  'lorem ipsum',
  '```',
];

export const GOLDEN_BRIEFS: GoldenBrief[] = [
  // ─── English plaints ──────────────────────────────────────────────────────
  {
    id: 'plaint-recovery-en-firm-1',
    description: 'Plaint for recovery of money under Order VII Rule 1 CPC, firm tone',
    request: {
      docType: 'Plaint',
      language: 'EN',
      tone: 'Firm',
      draftDate: '2026-05-12',
      fields: {
        court: 'Court of the Civil Judge (Senior Division), Bengaluru',
        plaintiff: 'M/s Ananya Traders, a partnership firm having its office at No. 12, MG Road, Bengaluru',
        defendant: 'Shri Rakesh Kumar, S/o Late Prem Kumar, R/o 44, Jayanagar 4th Block, Bengaluru',
        cause_of_action: 'Defendant failed to pay outstanding invoice no. AT/2025/118 dated 14.06.2025 for supply of textile goods worth Rs. 4,75,000/-',
        relief_sought: 'Decree for Rs. 4,75,000/- with interest at 12% p.a. from date of default until realisation, plus costs',
        jurisdiction: 'Cause of action arose at Bengaluru where defendant resides and the goods were delivered',
        suit_value: 'Rs. 4,75,000/-',
      },
    },
    expectations: {
      mustInclude: ['IN THE COURT OF', 'plaintiff', 'defendant', 'prayer', '4,75,000'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        hasParagraphNumbers: true,
        hasPartiesBlock: true,
        hasPrayer: true,
        hasVerification: true,
        minWords: 150,
        maxWords: 700,
      },
    },
  },
  {
    id: 'plaint-possession-en-pro-1',
    description: 'Plaint for possession of property, English, professional tone',
    request: {
      docType: 'Plaint',
      language: 'EN',
      tone: 'Professional',
      fields: {
        court: 'Court of the Civil Judge, Chennai',
        plaintiff: 'Smt. Lakshmi Narayanan, W/o R. Narayanan, residing at Plot 22, Adyar, Chennai',
        defendant: 'Shri Arun Subramanian, R/o Plot 22, Adyar, Chennai (in unlawful occupation)',
        cause_of_action: 'Defendant has continued occupation of the suit schedule property after expiry of the leave and licence agreement dated 01.01.2024 despite notice to vacate dated 15.03.2026',
        property_description: 'Ground floor of premises bearing door no. 22, Adyar 2nd Cross Street, Chennai - admeasuring 1,200 sq.ft.',
        relief_sought: 'Decree for vacant physical possession of suit schedule property and mesne profits',
      },
    },
    expectations: {
      mustInclude: ['Plaintiff', 'Defendant', 'possession', 'prayer'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        hasParagraphNumbers: true,
        hasPartiesBlock: true,
        hasPrayer: true,
        hasVerification: true,
        maxWords: 700,
      },
    },
  },

  // ─── English petitions ────────────────────────────────────────────────────
  {
    id: 'petition-anticipatory-bail-en-urgent-1',
    description: 'Anticipatory bail under Sec 438 CrPC, English, urgent tone',
    request: {
      docType: 'Petition',
      language: 'EN',
      tone: 'Urgent',
      fields: {
        court: 'Court of the Sessions Judge, Pune',
        petitioner: 'Shri Sandeep Joshi, S/o Vasant Joshi, R/o 7B Aundh, Pune',
        respondent: 'State of Maharashtra, through Aundh Police Station',
        provision: 'Section 438 of the Code of Criminal Procedure, 1973',
        fir_details: 'FIR No. 214/2026 dated 28.04.2026 registered at Aundh Police Station for offences under Sections 420, 406 IPC',
        grounds: 'Petitioner has been falsely implicated; the dispute is purely civil in nature concerning a business transaction; petitioner has cooperated with investigation; deep roots in society; no flight risk',
        relief: 'Direct release on bail in the event of arrest with reasonable conditions',
      },
    },
    expectations: {
      mustInclude: ['Petitioner', 'Respondent', '438', 'bail'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        hasParagraphNumbers: true,
        hasPartiesBlock: true,
        hasPrayer: true,
        hasVerification: true,
        maxWords: 700,
      },
    },
  },
  {
    id: 'petition-mandamus-en-pro-1',
    description: 'Writ petition for mandamus under Article 226, English',
    request: {
      docType: 'Writ Petition',
      language: 'EN',
      tone: 'Professional',
      fields: {
        court: 'High Court of Judicature at Allahabad',
        petitioner: 'Shri Ramesh Pal, S/o Hari Pal, R/o Village Bhadohi, Sant Ravidas Nagar, U.P.',
        respondent: '(1) State of Uttar Pradesh through Principal Secretary, Revenue Department; (2) Tehsildar, Bhadohi',
        provision: 'Article 226 of the Constitution of India',
        grievance: 'Respondents have failed to decide petitioner\'s representation dated 12.10.2025 for mutation of inherited land despite statutory timeline',
        relief: 'Writ of mandamus directing respondents to decide the representation within a time-bound manner',
      },
    },
    expectations: {
      mustInclude: ['Petitioner', 'Respondent', 'mandamus', 'Article 226'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        hasParagraphNumbers: true,
        hasPartiesBlock: true,
        hasPrayer: true,
        maxWords: 700,
      },
    },
  },

  // ─── English notices ──────────────────────────────────────────────────────
  {
    id: 'notice-cheque-bounce-en-firm-1',
    description: 'Statutory notice under Sec 138 NI Act for cheque dishonour',
    request: {
      docType: 'Legal Notice',
      language: 'EN',
      tone: 'Firm',
      fields: {
        sender: 'M/s Patel Steel Industries, through its proprietor Shri Bharat Patel, having office at GIDC Vatva, Ahmedabad',
        addressee: 'Shri Manoj Shah, R/o A-12 Satellite, Ahmedabad - drawer of the dishonoured cheque',
        cheque_details: 'Cheque no. 224501 dated 15.03.2026 for Rs. 8,50,000/- drawn on HDFC Bank, CG Road branch',
        dishonour_details: 'Returned unpaid by HDFC Bank on 22.03.2026 with remarks "Funds Insufficient" vide memo dated 22.03.2026',
        underlying_liability: 'Outstanding payment for supply of MS steel rods under invoice no. PSI/2026/22 dated 02.02.2026',
        demand: 'Pay Rs. 8,50,000/- within 15 days of receipt of this notice failing which proceedings under Sec 138 NI Act will be initiated',
      },
    },
    expectations: {
      mustInclude: ['notice', '138', 'cheque', '8,50,000', '15 days'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        maxWords: 700,
        minWords: 100,
      },
    },
  },
  {
    id: 'notice-termination-en-pro-1',
    description: 'Notice of termination of a lease agreement, English',
    request: {
      docType: 'Legal Notice',
      language: 'EN',
      tone: 'Professional',
      fields: {
        sender: 'Shri Vivek Iyer, lessor, R/o 11 Banjara Hills, Hyderabad',
        addressee: 'M/s Crescent Café Pvt. Ltd., lessee, operating from shop no. 4, Banjara Hills, Hyderabad',
        agreement_details: 'Lease deed dated 01.05.2023 for commercial premises situated at shop no. 4, Banjara Hills, Hyderabad',
        breach: 'Lessee has been in arrears of rent for four consecutive months totalling Rs. 2,80,000/- and has not responded to reminders dated 10.02.2026 and 10.03.2026',
        demand: 'Vacate the premises and clear all dues within 30 days from receipt of this notice',
      },
    },
    expectations: {
      mustInclude: ['notice', 'terminat', '30 days'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        maxWords: 700,
      },
    },
  },

  // ─── Affidavit / Vakalatnama / Reply / Application ────────────────────────
  {
    id: 'affidavit-supporting-en-pro-1',
    description: 'Supporting affidavit in a civil matter, English',
    request: {
      docType: 'Affidavit',
      language: 'EN',
      tone: 'Professional',
      fields: {
        deponent: 'Shri Karthik Rao, S/o Suresh Rao, aged 38, R/o Flat 502, Indiranagar, Bengaluru',
        case_title: 'Karthik Rao v. State of Karnataka & Anr., W.P. No. 4521/2026',
        court: 'High Court of Karnataka at Bengaluru',
        facts: 'I am the petitioner in the above writ petition. The contents of paragraphs 1 to 8 of the accompanying petition are true and correct to my personal knowledge; the contents of paragraphs 9 to 12 are based on records maintained by my counsel and believed to be true.',
        place: 'Bengaluru',
        date: '12.05.2026',
      },
    },
    expectations: {
      mustInclude: ['deponent', 'solemnly affirm', 'verified'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        hasVerification: true,
        maxWords: 500,
      },
    },
  },
  {
    id: 'vakalatnama-en-pro-1',
    description: 'Vakalatnama authorising an advocate, English',
    request: {
      docType: 'Vakalatnama',
      language: 'EN',
      tone: 'Professional',
      fields: {
        court: 'Court of the Civil Judge, Mumbai',
        client: 'M/s Lakshya Enterprises, through its director Shri Rohan Mehta',
        advocate: 'Shri Anand Deshpande, Advocate, Bar Council enrolment No. MAH/1234/2014',
        case_title: 'Lakshya Enterprises v. Crown Logistics Pvt. Ltd., Suit No. 88/2026',
        scope: 'To appear, act, plead, file pleadings, applications, affidavits, withdraw, compromise and do all acts necessary for prosecution/defence of the above matter',
      },
    },
    expectations: {
      mustInclude: ['vakalatnama', 'advocate', 'appear'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        maxWords: 400,
      },
    },
  },
  {
    id: 'reply-legal-notice-en-firm-1',
    description: 'Reply to a legal notice, English, firm tone',
    request: {
      docType: 'Reply to Legal Notice',
      language: 'EN',
      tone: 'Firm',
      fields: {
        sender: 'Shri Manoj Shah, through counsel Shri Aakash Bhatt, Advocate',
        addressee: 'M/s Patel Steel Industries through their counsel',
        notice_received: 'Legal notice dated 28.03.2026 received on 30.03.2026 alleging dishonour of cheque no. 224501',
        defence: 'The cheque was given as security and not in discharge of any legally enforceable debt; goods supplied were defective and rejected; addressee was put on notice of stop-payment instruction',
        relief: 'Treat the notice as withdrawn; no cause of action survives',
      },
    },
    expectations: {
      mustInclude: ['reply', 'notice', 'addressee'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        maxWords: 700,
      },
    },
  },
  {
    id: 'application-injunction-en-urgent-1',
    description: 'Application for interim injunction under Order XXXIX, English',
    request: {
      docType: 'Interlocutory Application',
      language: 'EN',
      tone: 'Urgent',
      fields: {
        court: 'Court of the Civil Judge (Senior Division), Gurugram',
        applicant: 'Shri Vinay Kapoor, plaintiff in Civil Suit No. 312/2026',
        respondent: 'M/s Skyline Builders Pvt. Ltd., defendant in the said suit',
        provision: 'Order XXXIX Rules 1 and 2 read with Section 151 of the Code of Civil Procedure, 1908',
        grounds: 'Prima facie case in favour of applicant; balance of convenience tilts in applicant\'s favour; irreparable injury will be caused if respondent is permitted to alienate the suit property pending disposal',
        relief: 'Restrain respondent from creating any third-party rights over the suit property until disposal of the suit',
      },
    },
    expectations: {
      mustInclude: ['injunction', 'Order XXXIX', 'applicant', 'respondent'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        hasParagraphNumbers: true,
        hasPrayer: true,
        maxWords: 700,
      },
    },
  },

  // ─── Hindi ────────────────────────────────────────────────────────────────
  // Substring matches stay simple: ASCII statute references and party labels
  // ("Petitioner"/"Respondent" survive in the Devanagari output as is) plus
  // Devanagari fragments where useful. We don't insist on full Hindi style -
  // the structural checks (parties block, prayer) carry the load.
  {
    id: 'plaint-recovery-hi-pro-1',
    description: 'Plaint for recovery of money in Hindi',
    request: {
      docType: 'वाद पत्र',
      language: 'HI',
      tone: 'Professional',
      fields: {
        court: 'सिविल जज (वरिष्ठ खण्ड) न्यायालय, जयपुर',
        plaintiff: 'श्री Mohan Sharma, पुत्र Shri Hari Sharma, निवासी 14 Civil Lines, जयपुर',
        defendant: 'श्री Suresh Agarwal, पुत्र Ram Agarwal, निवासी C-23 Vaishali Nagar, जयपुर',
        cause_of_action: 'प्रतिवादी ने वादी से लिए गए ऋण रू. 3,50,000/- का भुगतान आज तक नहीं किया है',
        relief_sought: 'रू. 3,50,000/- ब्याज सहित वसूली का डिक्री पारित किया जावे',
        suit_value: 'रू. 3,50,000/-',
      },
    },
    expectations: {
      mustInclude: ['3,50,000'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        // Devanagari output won't trigger English party-block heuristics.
        // We keep structural checks minimal here and rely on must-include
        // plus word count for regression detection.
        maxWords: 700,
      },
    },
  },
  {
    id: 'notice-cheque-bounce-hi-firm-1',
    description: 'Sec 138 NI Act notice in Hindi',
    request: {
      docType: 'विधिक सूचना',
      language: 'HI',
      tone: 'Firm',
      fields: {
        sender: 'श्री Rajesh Gupta, माध्यम अधिवक्ता',
        addressee: 'श्री Vinod Kumar, चेक के आहर्ता',
        cheque_details: 'चेक संख्या 553201 दिनांक 10.03.2026 राशि रू. 2,40,000/- ICICI Bank पर आहरित',
        dishonour_details: 'दिनांक 18.03.2026 को बैंक द्वारा "Funds Insufficient" टिप्पणी के साथ अनादरित',
        demand: '15 दिवस के भीतर सम्पूर्ण राशि का भुगतान करें अन्यथा NI Act की धारा 138 के अन्तर्गत कार्यवाही की जावेगी',
      },
    },
    expectations: {
      mustInclude: ['138', '2,40,000'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        maxWords: 700,
      },
    },
  },
  {
    id: 'affidavit-supporting-hi-pro-1',
    description: 'Supporting affidavit in Hindi',
    request: {
      docType: 'शपथ पत्र',
      language: 'HI',
      tone: 'Professional',
      fields: {
        deponent: 'श्री Anil Mishra, पुत्र Late Ram Mishra, आयु 45 वर्ष, निवासी 22 Hazratganj, लखनऊ',
        case_title: 'Anil Mishra बनाम State of U.P., रिट याचिका सं. 1122/2026',
        court: 'इलाहाबाद उच्च न्यायालय, लखनऊ खण्डपीठ',
        facts: 'मैं उपरोक्त रिट याचिका में याचिकाकर्ता हूं और याचिका के अनुच्छेद 1 से 6 तक के तथ्य मेरी व्यक्तिगत जानकारी में सत्य हैं',
        place: 'लखनऊ',
        date: '12.05.2026',
      },
    },
    expectations: {
      mustInclude: ['1122/2026'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        maxWords: 500,
      },
    },
  },

  // ─── Tamil ────────────────────────────────────────────────────────────────
  {
    id: 'plaint-recovery-ta-pro-1',
    description: 'Plaint for recovery of money in Tamil',
    request: {
      docType: 'வழக்கு மனு',
      language: 'TA',
      tone: 'Professional',
      fields: {
        court: 'மாவட்ட முன்சீப் நீதிமன்றம், கோயம்புத்தூர்',
        plaintiff: 'Tmt. Kala Devi, W/o Ramesh, கோயம்புத்தூர்',
        defendant: 'Thiru Sundaram, S/o Murugan, கோயம்புத்தூர்',
        cause_of_action: 'பிரதிவாதி வாதியிடம் வாங்கிய கடன் தொகை ரூ. 2,10,000/- திருப்பிச் செலுத்தத் தவறியுள்ளார்',
        relief_sought: 'ரூ. 2,10,000/- வட்டியுடன் வசூலிக்க உத்தரவாக ஆக்ஞை வழங்கப்பட வேண்டும்',
      },
    },
    expectations: {
      mustInclude: ['2,10,000'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        maxWords: 700,
      },
    },
  },
  {
    id: 'notice-cheque-bounce-ta-firm-1',
    description: 'Sec 138 NI Act notice in Tamil',
    request: {
      docType: 'சட்டப்பூர்வ அறிவிப்பு',
      language: 'TA',
      tone: 'Firm',
      fields: {
        sender: 'Thiru Karthik, வழக்கறிஞர் மூலம்',
        addressee: 'Thiru Manikandan, காசோலையின் இழுப்பாளர்',
        cheque_details: 'காசோலை எண் 770122 தேதி 05.04.2026 தொகை ரூ. 1,75,000/- Indian Bank-ல் இழுக்கப்பட்டது',
        dishonour_details: '12.04.2026 அன்று "Funds Insufficient" குறிப்புடன் திருப்பி அனுப்பப்பட்டது',
        demand: '15 நாட்களுக்குள் முழுத் தொகையை செலுத்தவும்',
      },
    },
    expectations: {
      mustInclude: ['138', '1,75,000'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        maxWords: 700,
      },
    },
  },
  {
    id: 'affidavit-supporting-ta-pro-1',
    description: 'Supporting affidavit in Tamil',
    request: {
      docType: 'உறுதிமொழி பத்திரம்',
      language: 'TA',
      tone: 'Professional',
      fields: {
        deponent: 'Thiru Selvam, S/o Late Annamalai, வயது 52, சென்னை',
        case_title: 'Selvam v. State of Tamil Nadu, W.P. No. 998/2026',
        court: 'மெட்ராஸ் உயர் நீதிமன்றம்',
        facts: 'மேற்படி வழக்கில் நான் மனுதாரர் ஆவேன்; மனுவின் பத்திகள் 1 முதல் 5 வரை எனது நேரடி அறிவில் உள்ள உண்மைகளாகும்',
        place: 'சென்னை',
        date: '12.05.2026',
      },
    },
    expectations: {
      mustInclude: ['998/2026'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        maxWords: 500,
      },
    },
  },

  // ─── Edge cases ───────────────────────────────────────────────────────────
  {
    id: 'edge-minimal-fields-en-1',
    description: 'Very short brief - single field; tests robustness to thin input',
    request: {
      docType: 'Legal Notice',
      language: 'EN',
      tone: 'Firm',
      fields: {
        summary: 'Demand vacant possession of tenanted premises at 4 Park Lane, Kolkata from tenant Shri D. Banerjee within 30 days',
      },
    },
    expectations: {
      mustInclude: ['notice', '30 days'],
      mustNotInclude: [...COMMON_FORBIDDEN, 'please provide', 'more information needed'],
      structuralChecks: {
        minWords: 80,
        maxWords: 600,
      },
    },
  },
  {
    id: 'edge-maximal-fields-en-1',
    description: 'Very long brief - ten fields; tests output discipline',
    request: {
      docType: 'Plaint',
      language: 'EN',
      tone: 'Professional',
      fields: {
        court: 'Court of the District Judge, Delhi',
        plaintiff: 'M/s Horizon Logistics Pvt. Ltd., a company incorporated under the Companies Act, 2013, having its registered office at C-44, Okhla Phase II, New Delhi',
        defendant: 'M/s Apex Freight Services, a partnership firm having its office at Plot 22, Mayapuri Industrial Area, New Delhi',
        contract_details: 'Service Agreement dated 12.01.2025 for transportation of industrial goods between Delhi and Mumbai',
        breach_details: 'Defendant failed to deliver consignment dated 18.06.2025 (LR No. APX/56781) causing loss of goods worth Rs. 14,80,000/-',
        prior_correspondence: 'Demand letter dated 02.08.2025; reminder dated 30.08.2025; legal notice dated 14.10.2025 - no response',
        damages_claimed: 'Rs. 14,80,000/- value of goods + Rs. 1,20,000/- interest + Rs. 50,000/- costs',
        jurisdiction: 'Cause of action arose at Delhi; defendant\'s office at Delhi',
        suit_value: 'Rs. 16,50,000/-',
        court_fee: 'Court fee paid as per Schedule I Article 1 of the Court Fees Act, 1870',
        relief_sought: 'Decree for Rs. 16,50,000/- with pendente lite and future interest at 12% p.a.',
      },
    },
    expectations: {
      mustInclude: ['Plaintiff', 'Defendant', '14,80,000', 'prayer'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        hasParagraphNumbers: true,
        hasPartiesBlock: true,
        hasPrayer: true,
        hasVerification: true,
        // Even with 10 input fields the model should hold under 500 words
        // per the system prompt. Allow a little slack.
        maxWords: 750,
      },
    },
  },
  {
    id: 'edge-conflicting-info-en-1',
    description: 'Brief with mildly conflicting numbers; the model should not silently invent a reconciliation',
    request: {
      docType: 'Legal Notice',
      language: 'EN',
      tone: 'Firm',
      fields: {
        sender: 'M/s Bluewave Imports Pvt. Ltd.',
        addressee: 'M/s Sundown Retail',
        invoice_amount: 'Rs. 6,50,000/-',
        outstanding_amount: 'Rs. 7,20,000/-',
        // Two different totals are referenced - a careful drafter will use
        // both numbers verbatim and let the advocate reconcile, rather than
        // hallucinate a single "correct" figure.
        demand: 'Pay the outstanding sum within 15 days',
      },
    },
    expectations: {
      // At least one of the figures should survive in the output; we don't
      // mandate both because a sensible model may flag the conflict.
      mustInclude: ['notice', '15 days'],
      mustNotInclude: COMMON_FORBIDDEN,
      structuralChecks: {
        maxWords: 600,
      },
    },
  },
];

export function getBriefsByLanguage(lang: 'EN' | 'HI' | 'TA'): GoldenBrief[] {
  return GOLDEN_BRIEFS.filter((b) => b.request.language === lang);
}

export function findBriefById(id: string): GoldenBrief | undefined {
  return GOLDEN_BRIEFS.find((b) => b.id === id);
}
