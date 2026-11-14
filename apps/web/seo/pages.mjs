// Public, crawlable pages. One source for the HTML, sitemap and llms.txt.
// Rules (enforced by seo.test.mjs): title <= 60 chars, keyword first, brand
// last; description 120-155 chars ending in a concrete hook; `answer` is the
// 40-70 word direct answer engines quote. Every claim must match what the
// product does today (build-docs/MEMORY.md, 2026-11-13). `draft: true` pages
// are not built until the user has read them.

// Pricing v4 switch (build-docs/features/pricing-v4.md). Flip to true in the
// release that takes v4 live: it swaps the offer line on every page and
// publishes /pricing. seo.test.mjs checks both settings.
export const V4_LIVE = false;

// Mirrors apps/api/src/lib/plans.ts (seo.test.mjs keeps them in step).
// Rupees, GST included; pages = AI drafting pages a month.
export const V4 = {
  sanad: { name: 'Sanad', monthly: 199, yearly: 2190, pages: 25 },
  vakalat: { name: 'Vakalat', monthly: 399, yearly: 4490, pages: 75 },
  brief: { name: 'Brief', monthly: 1499, yearly: 16490, pages: 200 },
  associates: { name: 'Associates', monthly: 649, yearly: 7140, pages: 75, min: 2, max: 8 },
  munshi: { name: 'Munshi seat', monthly: 149, yearly: 1590 },
};
const inr = (n) => `₹${n.toLocaleString('en-IN')}`;

/** The offer, before and after v4 goes live. */
export function offerFor(v4) {
  return v4
    ? {
        hook: `Plans from ${inr(V4.sanad.monthly)} a month, GST included.`,
        line: `Plans from ${inr(V4.sanad.monthly)} a month, GST included. Accounts on the free launch stay free until 1 June 2027.`,
        cost: `Plans start at ${inr(V4.sanad.monthly)} a month, GST included. Advocates who joined during the free launch stay free until 1 June 2027.`,
      }
    : {
        hook: 'Free for solo advocates till June 2027.',
        line: 'Free for solo advocates and law students until 1 June 2027. Firms get a 14-day trial.',
        cost: 'It is free for solo advocates and law students until 1 June 2027, and firms get a 14-day trial.',
      };
}
export const OFFER = offerFor(V4_LIVE);

/** @returns {Array<Record<string, any>>} */
export function buildPages(v4 = V4_LIVE) {
const { hook: FREE, cost: COST } = offerFor(v4);
const plans = ['sanad', 'vakalat', 'brief'].map((k) => V4[k]);
return [
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
      `DifAi is legal drafting and practice management software for Indian advocates. ${COST} Data is stored in India. It drafts in English, tracks District and High Court cases through eCourts, and runs on the web and Android.`,
    body: '',
    faq: [
      { q: 'How much does DifAi cost?', a: v4 ? `${COST} See the pricing page for every plan.` : 'Solo advocates and law students use DifAi free until 1 June 2027. Firms get a 14-day free trial, then a paid plan.' },
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

  // ---- Guides: approved by the user and published 2026-11-13.
  // Quotes are from the bare Acts; links go to the Act's India Code record.
  {
    slug: 'how-to-send-legal-notice-india',
    kind: 'guide',
    nav: null,
    crumb: 'How to send a legal notice',
    updated: '2026-11-13',
    title: 'How to Send a Legal Notice in India: Step by Step | DifAi',
    description:
      'What a legal notice must contain, when the law makes one compulsory, how to send it by registered post, and what to do if the other side ignores it.',
    h1: 'How to send a legal notice in India',
    answer:
      "Draft the notice on an advocate's letterhead stating the parties, the facts, the legal basis of the claim, the exact demand and a deadline to comply, then send it by Registered Post AD or Speed Post and keep the receipts. Many civil claims need no notice by law, but suits against the Government (Section 80 CPC) and cheque bounce cases (Section 138 NI Act) do.",
    body: `
<h2>When the law makes a notice compulsory</h2>
<table>
<tr><th>Situation</th><th>Provision</th><th>Time</th></tr>
<tr><td>Suing the Government or a public officer</td><td>Section 80, Code of Civil Procedure, 1908</td><td>Wait two months after delivery before filing the suit</td></tr>
<tr><td>Cheque dishonoured</td><td>Section 138, Negotiable Instruments Act, 1881</td><td>Send within 30 days of the return memo; drawer gets 15 days to pay</td></tr>
<tr><td>Ending a lease or tenancy</td><td>Section 106, Transfer of Property Act, 1882</td><td>15 days for a month-to-month lease; six months for a year-to-year agricultural or manufacturing lease, unless the contract or local law says otherwise</td></tr>
</table>
<p>State rent control laws can change the tenancy rules, so check the law for the property's location. See the guides on <a href="/section-80-cpc-notice">Section 80 CPC notices</a> and <a href="/cheque-bounce-notice-section-138">cheque bounce notices</a>.</p>
<h2>What the notice should contain</h2>
<ol>
<li>Name and address of the sender (your client) and of each recipient.</li>
<li>The facts in date order: the agreement, the payment or act, and what went wrong.</li>
<li>The legal basis: the contract clause or statute the claim rests on.</li>
<li>The demand: the exact amount or action, with interest and costs shown separately.</li>
<li>A deadline to comply, and what your client will do if it is ignored.</li>
<li>Date, place, and the advocate's signature on the letterhead.</li>
</ol>
<h2>How to send it</h2>
<p>Send it by Registered Post with Acknowledgment Due, or Speed Post, to the recipient's last known address, and keep the postal receipt, tracking printout and returned acknowledgment card. Under Section 27 of the General Clauses Act, 1897, where a Central Act requires service by post, service is deemed effected "by properly addressing, pre-paying and posting by registered post, a letter containing the document". Courts often apply the same presumption to notices sent by registered post even where no Act requires it. Sending a copy by email as well does no harm.</p>
<h2>If the other side ignores it</h2>
<p>An unanswered notice does not stop you suing, and an ordinary notice does not extend limitation. Only a notice the law requires before suing, such as a Section 80 notice, has its period left out of the count, under Section 15(2) of the Limitation Act, 1963. Track the limitation date from the day the claim arose. See <a href="/limitation-period-money-recovery-suit">limitation for money recovery suits</a>.</p>`,
    faq: [
      { q: 'Is a legal notice compulsory before filing a civil suit?', a: 'Not in general. It is compulsory before suing the Government or a public officer (Section 80 CPC), before a cheque bounce complaint (Section 138 NI Act), and to end a lease under Section 106 of the Transfer of Property Act. Otherwise it is optional but usual.' },
      { q: 'Can I send a legal notice without an advocate?', a: 'Yes. Any person can send a notice in their own name. An advocate drafts it so the facts, the legal basis and the demand are stated correctly, because the notice is usually filed with the case later.' },
      { q: 'What if the notice comes back unclaimed or refused?', a: 'Keep the returned envelope unopened. Courts generally treat a properly addressed registered notice that was refused or left unclaimed as served, unless the recipient proves otherwise.' },
    ],
    sources: [
      { label: 'Code of Civil Procedure, 1908, Section 80 (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/2191' },
      { label: 'Negotiable Instruments Act, 1881, Section 138 (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/2189' },
      { label: 'Transfer of Property Act, 1882, Section 106 (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/12924' },
      { label: 'General Clauses Act, 1897, Section 27 (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/2328' },
      { label: 'Limitation Act, 1963, Section 15(2) (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/1565' },
    ],
    cta: 'Draft a legal notice with DifAi',
  },
  {
    slug: 'section-80-cpc-notice',
    kind: 'guide',
    nav: null,
    crumb: 'Section 80 CPC notice',
    updated: '2026-11-13',
    title: 'Section 80 CPC Notice to Government: Format & Rules | DifAi',
    description:
      'Who must receive a Section 80 CPC notice, what it must state, the two-month wait before you sue, and when a court lets you sue without one.',
    h1: 'Section 80 CPC notice: suing the Government',
    answer:
      "Section 80 of the Code of Civil Procedure bars a suit against the Government, or against a public officer for an act done in official capacity, until two months after a written notice is delivered. The notice must state the cause of action, the plaintiff's name, description and residence, and the relief claimed, and the plaint must say the notice was delivered.",
    body: `
<h2>What Section 80(1) says</h2>
<blockquote>No suits shall be instituted against the Government … or against a public officer in respect of any act purporting to be done by such public officer in his official capacity, until the expiration of two months next after notice in writing has been delivered to, or left at the office of [the officer named below] … stating the cause of action, the name, description and place of residence of the plaintiff and the relief which he claims; and the plaint shall contain a statement that such notice has been delivered or left.</blockquote>
<h2>Who the notice goes to</h2>
<table>
<tr><th>Suit against</th><th>Deliver to</th></tr>
<tr><td>Central Government (not a railway)</td><td>A Secretary to that Government</td></tr>
<tr><td>Central Government, relating to a railway</td><td>The General Manager of that railway</td></tr>
<tr><td>A State Government</td><td>A Secretary to that Government, or the Collector of the district</td></tr>
<tr><td>A public officer</td><td>The officer personally, or left at their office</td></tr>
</table>
<p>The Code also names the officer for the Government of Jammu and Kashmir. When the right recipient is unclear, advocates often send copies to every likely one.</p>
<h2>Suing without waiting: Section 80(2)</h2>
<p>For urgent or immediate relief, the court may give leave to file without notice, or before the two months end. It must not grant relief, interim or otherwise, until the Government or officer has had a reasonable chance to show cause. If the court finds no urgency, it returns the plaint to be presented after complying with Section 80(1).</p>
<h2>Defects in the notice: Section 80(3)</h2>
<p>A suit is not dismissed only for an error or defect in the notice if it gave the plaintiff's name, description and residence so they can be identified, reached the right office, and substantially showed the cause of action and the relief claimed.</p>
<h2>Limitation</h2>
<p>The two-month notice period is left out when counting limitation for the suit, under Section 15(2) of the Limitation Act, 1963.</p>
<p>DifAi drafts Section 80 notices to the right recipient, with the cause of action and relief stated: see <a href="/legal-notice-drafting">legal notice drafting</a>.</p>`,
    faq: [
      { q: 'How long must I wait after a Section 80 notice?', a: 'Two months from the date the notice is delivered or left at the office, unless the court gives leave under Section 80(2) for urgent relief.' },
      { q: 'Does Section 80 apply to suits against government companies?', a: 'Not usually. Section 80 covers the Government and public officers. A company owned by the Government is generally a separate legal person, so check whether it counts as the Government for your claim.' },
      { q: 'What must the plaint say about the notice?', a: 'Section 80(1) requires the plaint to state that the notice was delivered or left. Attach a copy of the notice and the proof of delivery.' },
    ],
    sources: [
      { label: 'Code of Civil Procedure, 1908, Section 80 (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/2191' },
      { label: 'Limitation Act, 1963, Section 15(2) (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/1565' },
    ],
    cta: 'Draft a Section 80 notice with DifAi',
  },
  {
    slug: 'cheque-bounce-notice-section-138',
    kind: 'guide',
    nav: null,
    crumb: 'Cheque bounce notice (Section 138)',
    updated: '2026-11-13',
    title: 'Cheque Bounce Notice under Section 138: Time Limits | DifAi',
    description:
      'Send the notice within 30 days of the return memo, allow 15 days to pay, then file within a month. The Section 138 NI Act timeline, step by step.',
    h1: 'Cheque bounce notice under Section 138 NI Act',
    answer:
      "Under Section 138 of the Negotiable Instruments Act, the payee must send a written demand notice to the drawer within 30 days of receiving the bank's return memo. If the drawer does not pay within 15 days of receiving the notice, an offence is made out, and the complaint must be filed within one month after those 15 days end (Section 142).",
    body: `
<h2>The timeline</h2>
<table>
<tr><th>Step</th><th>Time allowed</th><th>Provision</th></tr>
<tr><td>Present the cheque to the bank</td><td>Within six months of its date, or within its validity, whichever is earlier (cheques are valid for three months under RBI rules)</td><td>Section 138, proviso (a)</td></tr>
<tr><td>Send the demand notice</td><td>Within 30 days of the bank's information that the cheque was returned unpaid</td><td>Section 138, proviso (b)</td></tr>
<tr><td>Drawer pays</td><td>Within 15 days of receiving the notice</td><td>Section 138, proviso (c)</td></tr>
<tr><td>File the complaint</td><td>Within one month of the day the 15 days end; the court may accept a later complaint for sufficient cause</td><td>Section 142(1)(b)</td></tr>
</table>
<h2>What the Act says about the notice</h2>
<blockquote>(b) the payee or the holder in due course of the cheque, as the case may be, makes a demand for the payment of the said amount of money by giving a notice in writing, to the drawer of the cheque, within thirty days of the receipt of information by him from the bank regarding the return of the cheque as unpaid; and<br />(c) the drawer of such cheque fails to make the payment of the said amount of money … within fifteen days of the receipt of the said notice.</blockquote>
<h2>What to put in the notice</h2>
<ul>
<li>Cheque number, date, amount and the bank and branch it was drawn on.</li>
<li>The debt or liability the cheque was given for.</li>
<li>Date of presentation, date of the return memo, and the reason given, such as "funds insufficient".</li>
<li>A demand for the cheque amount within 15 days of receipt. Show any claim for interest or costs separately, so the demand for the cheque amount stays clear.</li>
</ul>
<h2>Penalty and where to file</h2>
<p>The offence is punishable "with imprisonment for a term which may be extended to two years, or with fine which may extend to twice the amount of the cheque, or with both". For a cheque deposited through an account, the complaint is filed where the payee's bank branch is, under Section 142(2). The court may order the drawer to pay interim compensation of up to 20% of the cheque amount, under Section 143A.</p>
<p>DifAi drafts the demand notice and the reply, and its <a href="/limitation-calculator">limitation calculator</a> tracks each Section 138 deadline. See <a href="/legal-notice-drafting">legal notice drafting</a>.</p>`,
    faq: [
      { q: 'What is the time limit to send a cheque bounce notice?', a: "30 days from receiving the bank's return memo or other information that the cheque was returned unpaid, under Section 138(b) of the NI Act." },
      { q: 'What happens if the drawer pays within 15 days?', a: 'No offence under Section 138 is made out, because the offence needs the drawer to fail to pay within 15 days of receiving the notice.' },
      { q: 'Can I file the complaint after one month?', a: 'Only with an application to condone the delay. The proviso to Section 142(1)(b) lets the court take a late complaint if you show sufficient cause.' },
    ],
    sources: [
      { label: 'Negotiable Instruments Act, 1881, Sections 138, 142 and 143A (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/2189' },
    ],
    cta: 'Draft a cheque bounce notice with DifAi',
  },
  {
    slug: 'case-status-by-cnr-number',
    kind: 'guide',
    nav: null,
    crumb: 'Case status by CNR number',
    updated: '2026-11-13',
    checkedAgainst: 'the official eCourts websites',
    title: 'Check Case Status by CNR Number: Web, App, SMS | DifAi',
    description:
      'Find any District or High Court case on eCourts with its 16-character CNR number: on the website, in the eCourts app, or by SMS to 9766899899.',
    h1: 'How to check case status by CNR number',
    answer:
      'To check a case by CNR number, open services.ecourts.gov.in, choose the CNR Number search, enter the 16-character CNR without hyphens or spaces, type the captcha and search. You can also SMS ECOURTS followed by a space and the CNR number to 9766899899, or use the eCourts Services app. High Court cases are on hcservices.ecourts.gov.in.',
    body: `
<h2>What a CNR number is</h2>
<p>The CNR (Case Number Record) is a unique 16-character code eCourts gives each case, such as <em>MHAU019999992015</em>, the example eCourts itself uses. It stays the same for the life of the case, even when the case number changes on transfer.</p>
<h2>Three ways to check</h2>
<table>
<tr><th>Method</th><th>How</th></tr>
<tr><td>Website</td><td><a href="https://services.ecourts.gov.in/ecourtindia_v6/" rel="noopener">services.ecourts.gov.in</a> for District and Taluka courts, or <a href="https://hcservices.ecourts.gov.in/" rel="noopener">hcservices.ecourts.gov.in</a> for High Courts. Enter the CNR and the captcha.</td></tr>
<tr><td>SMS</td><td>Send <strong>ECOURTS &lt;CNR number&gt;</strong> to <strong>9766899899</strong>, as listed on ecourts.gov.in.</td></tr>
<tr><td>App</td><td>The official eCourts Services app lets you save cases and check them again.</td></tr>
</table>
<h2>No CNR number?</h2>
<p>On the same website you can search by party name, case number, filing number, FIR number, advocate name, Act or case type, after choosing the state, district and court complex. The result shows the CNR, which you can note for next time.</p>
<h2>What the status shows</h2>
<p>The next hearing date, the stage of the case, the court and judge, the parties and advocates, the hearing history, and orders and judgments where the court has uploaded them.</p>
<h2>Checking many cases every day</h2>
<p>Checking each case by hand with a captcha takes time once you have dozens. <a href="/ecourts-case-status">DifAi tracks cases by CNR</a> automatically, twice a day, and sends one summary of what changed.</p>`,
    faq: [
      { q: 'Where do I find the CNR number of my case?', a: 'It is shown on the eCourts case status page and on orders downloaded from eCourts. If you only know the parties or case number, search eCourts by those and the result shows the CNR.' },
      { q: 'Does the CNR number work for High Court cases?', a: 'Yes. High Court cases on eCourts also have CNR numbers. Search them on hcservices.ecourts.gov.in.' },
      { q: 'Is checking case status on eCourts free?', a: 'Yes. The eCourts website and app are free. The SMS service costs a normal SMS from your phone.' },
    ],
    sources: [
      { label: 'eCourts District Court services (services.ecourts.gov.in)', url: 'https://services.ecourts.gov.in/ecourtindia_v6/' },
      { label: 'eCourts High Court services (hcservices.ecourts.gov.in)', url: 'https://hcservices.ecourts.gov.in/' },
      { label: 'eCourts portal: case status by SMS (ecourts.gov.in)', url: 'https://ecourts.gov.in/ecourts2.0/' },
    ],
    cta: 'Track your cases by CNR with DifAi',
  },
  {
    slug: 'limitation-period-money-recovery-suit',
    kind: 'guide',
    nav: null,
    crumb: 'Limitation for money recovery',
    updated: '2026-11-13',
    title: 'Limitation Period for Money Recovery Suit in India | DifAi',
    description:
      'Three years for most money suits, but the start date depends on the claim: loan, demand loan, goods sold, or an open account. Articles 1, 14, 19, 21.',
    h1: 'Limitation period for a money recovery suit',
    answer:
      'A suit to recover money in India must usually be filed within three years under the Limitation Act, 1963. What changes is when the three years start: from the date of the loan (Articles 19 and 21), the delivery of goods (Article 14), or the right to sue accruing (Article 113). A signed acknowledgment or part payment before expiry restarts the period.',
    body: `
<h2>Common money claims (Schedule, Limitation Act, 1963)</h2>
<table>
<tr><th>Article</th><th>Description of suit</th><th>Period</th><th>Time runs from</th></tr>
<tr><td>1</td><td>Balance due on a mutual, open and current account, with reciprocal demands</td><td>Three years</td><td>Close of the year in which the last item is admitted or entered in the account</td></tr>
<tr><td>14</td><td>Price of goods sold and delivered, no fixed period of credit</td><td>Three years</td><td>Date of delivery of the goods</td></tr>
<tr><td>15</td><td>Price of goods sold and delivered, on a fixed period of credit</td><td>Three years</td><td>When the period of credit expires</td></tr>
<tr><td>19</td><td>Money payable for money lent</td><td>Three years</td><td>When the loan is made</td></tr>
<tr><td>21</td><td>Money lent under an agreement that it is payable on demand</td><td>Three years</td><td>When the loan is made</td></tr>
<tr><td>22</td><td>Money deposited, payable on demand</td><td>Three years</td><td>When the demand is made</td></tr>
<tr><td>113</td><td>Any suit with no period provided elsewhere in the Schedule</td><td>Three years</td><td>When the right to sue accrues</td></tr>
</table>
<p>Article 21 surprises people: for a loan payable on demand, time runs from the date of the loan, not from the demand.</p>
<h2>What restarts the period</h2>
<ul>
<li><strong>Acknowledgment (Section 18):</strong> a written acknowledgment of the debt, signed by the debtor before the period expires, starts a fresh period from the date it was signed.</li>
<li><strong>Part payment (Section 19):</strong> a payment towards the debt or interest, made before the period expires, starts a fresh period from the payment. The payment must be acknowledged in the payer's handwriting or a writing signed by them.</li>
</ul>
<h2>Rules to remember</h2>
<ul>
<li><strong>A late suit is dismissed</strong> even if the defendant does not raise limitation (Section 3).</li>
<li><strong>Section 5 condonation does not apply to suits.</strong> It covers appeals and applications only.</li>
<li><strong>If the court is closed</strong> on the last day, you may file on the day it reopens (Section 4).</li>
<li><strong>Summary suits</strong> under Order XXXVII CPC, on written contracts and negotiable instruments, have the same limitation as an ordinary suit for the claim.</li>
</ul>
<p>Work out the date and track it with the <a href="/limitation-calculator">DifAi limitation calculator</a>.</p>`,
    faq: [
      { q: 'What is the limitation period to recover money lent?', a: 'Three years from the date the loan was made, under Article 19, or Article 21 if the loan was payable on demand.' },
      { q: 'Does sending a legal notice extend limitation?', a: 'No. An ordinary demand notice does not extend limitation. A signed acknowledgment of the debt (Section 18) or a part payment (Section 19) made before expiry does.' },
      { q: 'Can the court condone delay in filing a money suit?', a: 'No. Section 5 of the Limitation Act applies to appeals and applications, not suits. A suit filed after limitation is dismissed under Section 3.' },
    ],
    sources: [
      { label: 'Limitation Act, 1963: Sections 3, 4, 5, 18, 19 and the Schedule (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/1565' },
      { label: 'Code of Civil Procedure, 1908, Order XXXVII (India Code)', url: 'https://www.indiacode.nic.in/handle/123456789/2191' },
    ],
    cta: 'Track limitation deadlines with DifAi',
  },
  {
    slug: 'pricing',
    kind: 'hub',
    draft: !v4,
    nav: 'Pricing',
    crumb: 'Pricing',
    updated: '2026-11-14',
    title: `Pricing: Legal Drafting Plans from ${inr(V4.sanad.monthly)}/Month | DifAi`,
    description: `Sanad ${inr(V4.sanad.monthly)}, Vakalat ${inr(V4.vakalat.monthly)} and Brief ${inr(V4.brief.monthly)} a month, GST included, with AI drafting pages. Associates for chambers at ${inr(V4.associates.monthly)} per advocate.`,
    h1: 'DifAi pricing',
    answer: `DifAi has three plans for individual advocates: Sanad at ${inr(V4.sanad.monthly)} a month with ${V4.sanad.pages} pages of AI drafting, Vakalat at ${inr(V4.vakalat.monthly)} with ${V4.vakalat.pages} pages, and Brief at ${inr(V4.brief.monthly)} with ${V4.brief.pages} pages. Chambers of ${V4.associates.min} to ${V4.associates.max} advocates take Associates at ${inr(V4.associates.monthly)} per advocate. All prices include GST, and every plan includes case tracking, the diary and eCourts sync.`,
    body: `
<h2>Plans</h2>
<table>
<tr><th>Plan</th><th>Monthly</th><th>Yearly</th><th>AI drafting</th></tr>
${plans.map((p) => `<tr><td><strong>${p.name}</strong></td><td>${inr(p.monthly)}</td><td>${inr(p.yearly)} (save ${inr(p.monthly * 12 - p.yearly)})</td><td>${p.pages} pages a month</td></tr>`).join('\n')}
<tr><td><strong>Associates</strong><br />${V4.associates.min} to ${V4.associates.max} advocates</td><td>${inr(V4.associates.monthly)} per advocate</td><td>${inr(V4.associates.yearly)} per advocate</td><td>${V4.associates.pages} pages per advocate, shared</td></tr>
<tr><td><strong>Partners</strong><br />9 advocates and above</td><td colspan="3">Custom pricing. Write to <a href="mailto:support@sirahdigital.in">support@sirahdigital.in</a>.</td></tr>
</table>
<p>All prices include 18% GST. Every payment comes with a GST tax invoice.</p>
<h2>Every plan includes</h2>
<ul>
<li>Cases, the advocate diary and eCourts sync by CNR number</li>
<li>eFiling help, the limitation calculator and land records</li>
<li>84 court-ready Indian formats for drafting, and any other document on request</li>
<li>The web app and the Android app</li>
</ul>
<h2>Munshi seat</h2>
<p>Add a clerk or staff member for ${inr(V4.munshi.monthly)} a month (${inr(V4.munshi.yearly)} a year) on any paid plan. A Munshi seat covers the diary, cause list, eCourts and documents, without AI drafting.</p>
<h2>What the names mean</h2>
<ul>
<li><strong>Sanad:</strong> the enrolment certificate every advocate gets from the Bar Council.</li>
<li><strong>Vakalat:</strong> the vakalatnama a client signs so you can act in the case.</li>
<li><strong>Brief:</strong> a case handed to an advocate. Many briefs, a busy practice.</li>
<li><strong>Associates:</strong> as in "X &amp; Associates", advocates working together.</li>
</ul>
<h2>Already on the free launch?</h2>
<p>Advocates who signed up during the free launch keep it until 1 June 2027, as promised.</p>`,
    faq: [
      { q: 'Do the prices include GST?', a: 'Yes. Every price on this page includes 18% GST, and each payment comes with a GST tax invoice.' },
      { q: 'Can I change my plan later?', a: 'Yes. Pick a new plan from Billing in the app. The new plan starts at your next renewal, so you are never charged twice for the same period.' },
      { q: 'How do I pay?', a: 'Payments go through Razorpay. You can pay monthly or yearly by UPI Autopay or card; yearly costs less.' },
      { q: 'What is a Munshi seat?', a: `A seat for a clerk or staff member at ${inr(V4.munshi.monthly)} a month. They get the diary, cause list, eCourts and documents, but not AI drafting.` },
    ],
    cta: 'Choose your plan',
  },
];
}

export const PAGES = buildPages();
