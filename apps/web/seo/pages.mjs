// Public, crawlable pages. One source for the HTML, sitemap and llms.txt.
// Rules (enforced by seo.test.mjs): title <= 60 chars, keyword first, brand
// last; description 120-155 chars ending in a concrete hook; `answer` is the
// 40-70 word direct answer engines quote. Every claim must match what the
// product does today (build-docs/MEMORY.md, 2026-11-13). `draft: true` pages
// are not built until the user has read them.

const FREE = 'Free for solo advocates till June 2027.';

/** @type {Array<Record<string, any>>} */
export const PAGES = [
  {
    slug: 'legal-notice-drafting',
    kind: 'feature',
    nav: 'Notices',
    crumb: 'Legal notice drafting',
    updated: '2026-11-13',
    title: 'Legal Notice Drafting Software for Advocates | DifAi',
    description: `Draft cheque bounce, Section 80 CPC, eviction and recovery notices in Indian format in minutes. Exports to Word. ${FREE}`,
    h1: 'Legal notice drafting for Indian advocates',
    answer:
      'DifAi drafts legal notices in the formats Indian advocates use: Section 138 cheque bounce notices and replies, Section 80 CPC notices to the Government, Section 106 notices to quit, and general demand notices. You describe the facts in plain words, DifAi asks for anything missing, and you get an editable Word draft.',
    body: `
<h2>Notices DifAi drafts</h2>
<table>
<tr><th>Notice</th><th>Typical use</th></tr>
<tr><td>Section 138 NI Act demand notice</td><td>Cheque dishonoured for insufficient funds or "exceeds arrangement"</td></tr>
<tr><td>Reply to a Section 138 notice</td><td>Your client received a cheque bounce notice</td></tr>
<tr><td>Section 80 CPC notice</td><td>Before suing the Government or a public officer</td></tr>
<tr><td>Section 106 Transfer of Property Act notice</td><td>Terminating a tenancy or lease</td></tr>
<tr><td>General legal / demand notice</td><td>Money recovery, breach of contract, defamation, any other demand</td></tr>
</table>
<h2>How it works</h2>
<ol>
<li><strong>Describe the matter.</strong> Type or dictate the facts as you would brief a junior: parties, dates, amounts, what went wrong.</li>
<li><strong>Fill the gaps.</strong> DifAi checks the brief against what the notice needs (for a cheque bounce: cheque number, bank, return memo date) and asks only for what is missing.</li>
<li><strong>Get the draft.</strong> A complete notice with the statutory provisions cited, in the layout advocates use, ready to edit in Word.</li>
</ol>
<p>DifAi never invents facts. Anything you didn't provide stays as a marked blank, such as <em>[date of return memo]</em>, so nothing wrong goes out under your name.</p>
<h2>Beyond notices</h2>
<p>The same flow drafts plaints, written statements, bail applications, petitions, affidavits and deeds: 84 built-in Indian formats, and any other document on request. See <a href="/plaint-drafting">plaint and pleading drafting</a>.</p>`,
    faq: [
      { q: 'Can DifAi draft a cheque bounce notice under Section 138?', a: 'Yes. Give the cheque details, the bank return memo date and the amount, and DifAi drafts the demand notice with the 15-day payment period. It also drafts replies to a Section 138 notice.' },
      { q: 'Is the notice in a format I can edit?', a: 'Yes. Every draft downloads as a Word document, so you can change wording, add your letterhead and sign it as usual.' },
      { q: 'Does DifAi send the notice for me?', a: 'No. You review, sign and send the notice yourself by registered post, courier or email, as the law and your practice require.' },
    ],
  },
  {
    slug: 'plaint-drafting',
    kind: 'feature',
    nav: 'Pleadings',
    crumb: 'Plaint and pleading drafting',
    updated: '2026-11-13',
    title: 'Plaint & Petition Drafting Software for India | DifAi',
    description: `Plaints, written statements, bail and writ petitions in Indian court formats. Missing facts flagged, not invented. ${FREE}`,
    h1: 'Plaint, petition and pleading drafting in Indian court formats',
    answer:
      'DifAi drafts civil and criminal pleadings in Indian court formats: plaints, written statements, summary suits under Order XXXVII, injunction and eviction suits, bail and anticipatory bail applications, writ and quash petitions, and more. You give the facts once and DifAi produces a structured Word draft with cause of action, jurisdiction, valuation and prayer sections.',
    body: `
<h2>Pleadings and petitions covered</h2>
<ul>
<li><strong>Civil:</strong> plaint, written statement, summary suit (Order XXXVII CPC), specific performance, permanent injunction, ejectment, execution application, civil revision and first appeal, caveat, condonation of delay.</li>
<li><strong>Criminal:</strong> regular, anticipatory and default bail, Section 138 complaint, criminal revision and appeal, quash petition, surrender and recall petitions.</li>
<li><strong>Family:</strong> contested and mutual-consent divorce, maintenance, restitution of conjugal rights, domestic violence application.</li>
<li><strong>Constitutional and other:</strong> writ petitions, special leave petitions, transfer petitions, motor accident claims, consumer complaints.</li>
<li><strong>Deeds and affidavits:</strong> sale, gift, lease, mortgage and partnership deeds, power of attorney, wills, affidavits, vakalatnama.</li>
</ul>
<p>That is 84 built-in formats. For anything else, ask in plain words and DifAi drafts it to the same standard.</p>
<h2>Built for how advocates actually draft</h2>
<ul>
<li><strong>Structure first.</strong> Every pleading follows the order courts expect: cause title, facts, cause of action, jurisdiction, limitation, valuation and court fee, prayer, verification.</li>
<li><strong>No invented facts.</strong> Anything missing from your brief is marked as a blank for you to fill.</li>
<li><strong>Points to verify.</strong> Statutory citations are listed separately so you can check them before filing.</li>
<li><strong>Word output.</strong> Edit freely, keep your chamber's style.</li>
</ul>`,
    faq: [
      { q: 'Which courts are the formats for?', a: 'The formats follow Indian court practice, with Tamil Nadu and Madras High Court formats first and all-India law where it applies. You can also upload your own chamber formats.' },
      { q: 'Should I still check the draft?', a: 'Yes. DifAi gives you a complete first draft and lists the points to verify, but the advocate is responsible for every filing.' },
    ],
  },
  {
    slug: 'ecourts-case-status',
    kind: 'feature',
    nav: 'Case tracking',
    crumb: 'eCourts case tracking',
    updated: '2026-11-13',
    title: 'eCourts Case Status Tracker for Advocates | DifAi',
    description: `Add a CNR number once and DifAi syncs hearing dates from eCourts twice a day, with reminders before each hearing. ${FREE}`,
    h1: 'Track eCourts case status by CNR number, automatically',
    answer:
      "DifAi tracks your District Court and High Court cases through eCourts. Add each case's 16-character CNR number once; DifAi checks eCourts every morning and evening, updates the next hearing date and stage, and sends you one summary of what changed, plus a reminder before each hearing.",
    body: `
<h2>What DifAi does with a CNR number</h2>
<ul>
<li><strong>Links the case</strong> to eCourts and fills in court, parties, case type and stage.</li>
<li><strong>Syncs twice a day</strong>, at 9 AM and 7 PM IST. When eCourts is down, DifAi retries every 30 minutes instead of giving up.</li>
<li><strong>Builds your diary</strong> of hearings, judgments and filings, with a reminder the morning of each hearing.</li>
<li><strong>Sends one summary per run</strong> of what changed across all your cases, not one alert per case.</li>
</ul>
<h2>Searching eCourts</h2>
<p>You can also search eCourts by case type, by advocate Bar enrolment number, and for court orders by party, case or date, without leaving DifAi.</p>
<h2>Where is my CNR number?</h2>
<p>The CNR (Case Number Record) is a 16-character code printed on the case status page and on orders, for example <em>TNCH010012342024</em>. Each case has one, and it never changes.</p>`,
    faq: [
      { q: 'Which courts can DifAi track?', a: 'District Courts and High Courts listed on eCourts. Supreme Court and tribunal cases are not tracked automatically today.' },
      { q: 'What if eCourts is down?', a: 'DifAi retries every 30 minutes, up to seven times, and tells you if a case could not be refreshed.' },
      { q: 'Is it on my phone?', a: 'Yes. DifAi runs in the browser and as an Android app, with hearing reminders as notifications.' },
    ],
  },
  {
    slug: 'contract-review',
    kind: 'feature',
    nav: null,
    crumb: 'Contract review',
    updated: '2026-11-13',
    title: 'AI Contract Review for Indian Lawyers | DifAi',
    description: `Upload a contract, get clause-by-clause risks, a risk score and suggested redlines, then send it for approval. ${FREE}`,
    h1: 'AI contract review, clause by clause',
    answer:
      'DifAi reviews a contract clause by clause and returns each risk it finds, how serious it is, and a suggested redline or counter-clause, along with an overall risk score. You can attach the review to a matter and assign it to a colleague, who approves it or asks for changes.',
    body: `
<h2>What a review gives you</h2>
<ul>
<li><strong>Findings per clause:</strong> termination, indemnity, liability caps, payment, jurisdiction and arbitration, data protection (DPDP Act 2023), and anything unusual.</li>
<li><strong>A suggested fix</strong> for each finding: a redline or counter-clause you can adapt.</li>
<li><strong>A risk score</strong> for the contract as a whole.</li>
<li><strong>An approval step:</strong> assign the review, then record "approved" or "changes requested".</li>
</ul>
<p>The AI score is advisory. The advocate's decision is what counts, and DifAi records who made it.</p>`,
    faq: [
      { q: 'Which contracts can I review?', a: 'Any commercial contract in English: services, supply, employment, leases, NDAs, shareholder and partnership agreements.' },
      { q: 'Is my client\'s contract kept private?', a: 'Reviews are stored per firm, visible only to your firm, on servers in India.' },
    ],
  },
  {
    slug: 'limitation-calculator',
    kind: 'feature',
    nav: 'Limitation',
    crumb: 'Limitation calculator',
    updated: '2026-11-13',
    title: 'Limitation Period Calculator & Tracker India | DifAi',
    description: `Limitation Act 1963 and NI Act deadlines calculated, with alerts 90, 30, 7 and 1 day before they fall. ${FREE}`,
    h1: 'Limitation period calculator and deadline tracker',
    answer:
      'DifAi calculates limitation deadlines for the most-used articles of the Limitation Act, 1963 and the Section 138 NI Act timeline, then tracks each deadline and alerts you 90, 30, 7 and 1 day before it falls. Each result shows the article relied on, so you can check it against the bare Act.',
    body: `
<h2>How it works</h2>
<ol>
<li>Pick the type of suit or application, and enter the date the period starts (for example, the date the loan was given or the return memo was received).</li>
<li>DifAi shows the deadline, the article of Schedule I it used, and warnings, for example when the last day falls on a weekend (Section 4 may extend it to the next working day).</li>
<li>Save it against the matter. DifAi alerts you at 90, 30, 7 and 1 day, by notification and, in the last week, by email.</li>
</ol>
<h2>Cheque bounce timeline (Section 138 NI Act)</h2>
<table>
<tr><th>Step</th><th>Time allowed</th></tr>
<tr><td>Send demand notice to the drawer</td><td>Within 30 days of receiving the bank's return memo</td></tr>
<tr><td>Drawer's time to pay</td><td>15 days from receiving the notice</td></tr>
<tr><td>File the complaint</td><td>Within one month after the 15 days end</td></tr>
</table>
<p class="note">Coverage is the most-used articles, not every article. Always confirm the period for your specific facts.</p>`,
    faq: [
      { q: 'Does it cover every article of the Limitation Act?', a: 'No. It covers the most-used articles of Schedule I and the Section 138 NI Act timeline. Each result cites its article so you can verify it.' },
      { q: 'Does it account for court holidays?', a: 'It warns when a deadline lands on a weekend so you can check Section 4. Confirm court holidays with your court calendar.' },
    ],
  },
  {
    slug: 'advocate-diary',
    kind: 'feature',
    nav: null,
    crumb: 'Advocate diary app',
    updated: '2026-11-13',
    title: 'Advocate Diary App: Hearings & Case Dates | DifAi',
    description: `An advocate diary that fills itself from eCourts: hearings, judgments and filings, with reminders on Android. ${FREE}`,
    h1: 'A digital advocate diary that fills itself',
    answer:
      "DifAi's diary lists every hearing, judgment and filing date across your matters, filled in automatically from eCourts for cases with a CNR number and editable by hand for the rest. It reminds you on the morning of each hearing and lets you ask a colleague to cover a hearing you can't attend.",
    body: `
<h2>Why advocates switch from the paper diary</h2>
<ul>
<li><strong>Dates update themselves</strong> from eCourts, twice a day, so the next date is never copied wrongly.</li>
<li><strong>Filter by kind:</strong> hearings, judgments, filings.</li>
<li><strong>Ask for cover</strong> on a hearing and send the details to a colleague in one step.</li>
<li><strong>Everything links back</strong> to the matter, its documents and drafts.</li>
<li><strong>On your phone</strong> with the Android app, and in any browser.</li>
</ul>
<p>Pair it with <a href="/ecourts-case-status">eCourts case tracking</a> and the <a href="/limitation-calculator">limitation tracker</a> so no date is missed.</p>`,
    faq: [
      { q: 'Can I add cases that are not on eCourts?', a: 'Yes. Add the dates by hand; they appear in the same diary with the same reminders.' },
    ],
  },
  {
    slug: 'faq',
    kind: 'hub',
    nav: 'FAQ',
    crumb: 'FAQ',
    updated: '2026-11-13',
    title: 'DifAi FAQ: Pricing, Data, Courts, Languages',
    description: `What DifAi costs, where data is stored, which courts it tracks, how eFiling works and which languages it drafts in. ${FREE}`,
    h1: 'Frequently asked questions about DifAi',
    answer:
      'DifAi is legal drafting and practice management software for Indian advocates. It is free for solo advocates and law students until 1 June 2027, and firms get a 14-day trial. Data is stored in India. It drafts in English, tracks District and High Court cases through eCourts, and runs on the web and Android.',
    body: '',
    faq: [
      { q: 'How much does DifAi cost?', a: 'Solo advocates and law students use DifAi free until 1 June 2027. Firms get a 14-day free trial, then a paid plan.' },
      { q: 'Where is my data stored?', a: 'In India, on our servers in Mumbai, in compliance with the DPDP Act 2023. Backups are encrypted at rest and in transit.' },
      { q: 'Which courts are supported?', a: 'Case tracking works for District Courts and High Courts through eCourts. Drafting covers pleadings before courts, tribunals and commissions.' },
      { q: 'How does eFiling work?', a: 'DifAi prepares the court-ready PDF, then signs in to the eCourts eFiling portal with your own login and fills the case details. You complete the Aadhaar eSign, court-fee payment and final submit on the portal.' },
      { q: 'Which languages does DifAi draft in?', a: 'Drafting is in English today. Mock Arguments can answer in Hindi, Tamil and other Indian languages. Drafting in regional languages is planned.' },
      { q: 'Does DifAi make up facts or case law?', a: 'It is built not to. Missing facts stay as marked blanks, and statutory citations are listed for you to verify before filing.' },
      { q: 'Is there a mobile app?', a: 'Yes, an Android app with hearing reminders. On iPhone, use DifAi in the browser.' },
    ],
  },
  {
    slug: 'about',
    kind: 'hub',
    nav: null,
    crumb: 'About',
    updated: '2026-11-13',
    title: 'About DifAi: Legal AI Built in India by Sirah Digital',
    description: 'DifAi is legal drafting and practice management software for Indian advocates, built by Sirah Digital with Tamil Nadu advocates first.',
    h1: 'About DifAi',
    answer:
      'DifAi is legal drafting and practice management software built in India by Sirah Digital. It started with advocates in Tamil Nadu and is built around how Indian chambers work: Indian court formats, eCourts case tracking, limitation deadlines and billing in one place, with data stored in India.',
    body: `
<h2>What we believe</h2>
<ul>
<li><strong>The advocate decides.</strong> DifAi drafts and checks; it never files or sends anything on its own.</li>
<li><strong>No invented facts.</strong> A blank is better than a wrong date in a pleading.</li>
<li><strong>Indian formats, not generic templates.</strong> Drafts should read like a practising advocate wrote them.</li>
</ul>
<h2>Contact</h2>
<p>Email <a href="mailto:support@sirahdigital.in">support@sirahdigital.in</a>.</p>`,
    cta: 'Start using DifAi',
  },
];
