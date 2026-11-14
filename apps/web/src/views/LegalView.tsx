import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from '@/components/brand/Logo';

// =============================================================================
// Public legal pages: Terms of Service (/terms), Privacy Policy + DPDP notice
// (/privacy) and account deletion (/delete-account). /privacy and
// /delete-account are linked from the Google Play listing, so every page here
// loads without signing in. Text = owner's v1.1 document, reworded only where
// it described something the app doesn't do (build-docs/features/legal-pages.md).
// =============================================================================

export const OPERATOR = {
  name: 'Sirah Digital',
  form: 'a sole proprietorship of M Mohamed Riyaz',
  gstin: '33CVVPM9805M1ZO',
  address: 'SY No. 203/10B, Featherlite, 200 Feet Road, Zamin Pallavaram, Chennai 600044, Tamil Nadu, India',
  email: 'support@sirahdigital.in',
  grievanceOfficer: 'M Mohamed Riyaz',
  grievanceTitle: 'Proprietor, Sirah Digital',
  city: 'Chennai',
  highCourt: 'High Court of Judicature at Madras',
} as const;

export const LEGAL_VERSION = '1.1';
export const LEGAL_EFFECTIVE = '14 November 2026';

const linkStyle = { color: 'var(--text-primary)' };

function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <header style={{ borderBottom: '1px solid var(--border-subtle)', padding: '16px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <Link to="/" aria-label="DifAi home" style={{ color: 'var(--text-primary)', fontSize: 22 }}>
            <Wordmark />
          </Link>
        </div>
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px 64px' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{updated}</div>
        <h1 className="heading-lg" style={{ margin: 0, marginBottom: 24 }}>{title}</h1>
        <div className="body-md" style={{ lineHeight: 1.7, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
          {children}
        </div>
        <footer
          className="body-sm"
          style={{ marginTop: 48, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 16, flexWrap: 'wrap' }}
        >
          <Link to="/terms" style={linkStyle}>Terms of service</Link>
          <Link to="/refund-policy" style={linkStyle}>Refunds and cancellation</Link>
          <Link to="/privacy" style={linkStyle}>Privacy policy</Link>
          <Link to="/contact" style={linkStyle}>Contact</Link>
          <Link to="/delete-account" style={linkStyle}>Delete your account</Link>
          <a href={`mailto:${OPERATOR.email}`} style={linkStyle}>{OPERATOR.email}</a>
        </footer>
      </main>
    </div>
  );
}

function Part({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="heading-md" style={{ color: 'var(--text-primary)', marginTop: 48, marginBottom: 8, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', scrollMarginTop: 16 }}>
      {children}
    </h2>
  );
}

function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} style={{ color: 'var(--text-primary)', fontSize: 17, fontWeight: 600, marginTop: 28, marginBottom: 8, scrollMarginTop: 16 }}>
      {children}
    </h3>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div style={{ overflowX: 'auto', margin: '12px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" style={{ textAlign: 'left', padding: '8px 10px 8px 0', borderBottom: '1px solid var(--text-primary)', color: 'var(--text-primary)', verticalAlign: 'bottom' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: '8px 10px 8px 0', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'top' }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Contents({ items }: { items: [string, string][] }) {
  return (
    <nav aria-label="Contents" style={{ margin: '0 0 8px' }}>
      <ol style={{ paddingLeft: 20, margin: 0 }}>
        {items.map(([id, label]) => (
          <li key={id}><a href={`#${id}`} style={linkStyle}>{label}</a></li>
        ))}
      </ol>
    </nav>
  );
}

const mail = <a href={`mailto:${OPERATOR.email}`} style={linkStyle}>{OPERATOR.email}</a>;
const toTerms = <Link to="/terms" style={linkStyle}>Terms of Service</Link>;
const toPrivacy = <Link to="/privacy" style={linkStyle}>Privacy Policy</Link>;

function OperatorLine() {
  return (
    <p>
      <strong>Operated by:</strong> {OPERATOR.name}, {OPERATOR.form}, GSTIN {OPERATOR.gstin}, {OPERATOR.address}.
      Contact: {mail}.
    </p>
  );
}

// -----------------------------------------------------------------------------
// /terms — Part A (Terms of Service), Part D (cookies and device permissions),
// Part E (subscriptions, refunds and cancellation)
// -----------------------------------------------------------------------------

export function TermsView() {
  return (
    <LegalPage title="Terms of Service" updated={`Version ${LEGAL_VERSION} · Effective ${LEGAL_EFFECTIVE}`}>
      <OperatorLine />
      <p>
        These documents together form your agreement with us: this page (Terms of Service, the Cookie and Device
        Permissions Notice and the Subscription, Refund and Cancellation Policy) and the {toPrivacy} (including
        the data processing terms for advocates and firms and the DPDP Act Notice).
      </p>
      <Contents items={[['part-a', 'Part A: Terms of Service'], ['part-d', 'Part D: Cookie and Device Permissions Notice'], ['part-e', 'Part E: Subscription, Refund and Cancellation Policy']]} />

      <Part id="part-a">Part A: Terms of Service</Part>

      <H3>1. Acceptance and definitions</H3>
      <p>1.1 These Terms govern your use of DifAi, a software platform (website and Android app) offering legal drafting, case management, contract review, billing, research and limitation tracking (the &ldquo;Service&rdquo;), operated by {OPERATOR.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;).</p>
      <p>1.2 By creating an account, or by using the Service, you accept these Terms, the Privacy Policy, the DPDP Notice, the Cookie and Device Permissions Notice and the Subscription Policy. If you use DifAi for a law firm or organisation, you confirm you are authorised to bind it.</p>
      <p>1.3 &ldquo;Your Content&rdquo; means documents, case details, party information, client data, prompts and anything else you upload or create in DifAi. &ldquo;Output&rdquo; means drafts, citations, scores, summaries, search answers and computations the Service generates.</p>

      <H3>2. Who may use DifAi</H3>
      <ul>
        <li>You must be at least 18 years old and competent to contract under the Indian Contract Act, 1872.</li>
        <li>DifAi is for advocates enrolled with a State Bar Council, law firms, in-house legal teams and law students. Students may use it for learning and supervised work only and must not use it to practise or appear unless permitted by law.</li>
        <li>You must provide accurate registration details (including enrolment number where asked), keep credentials confidential, and tell us promptly at {mail} if you suspect unauthorised access. You are responsible for all activity under your account.</li>
        <li>One account per person. Firm plans are limited to the licensed number of seats.</li>
      </ul>

      <H3>3. Nature of the Service: not legal advice</H3>
      <p>3.1 DifAi is a tool for legal professionals. <strong>It is not a law firm, does not give legal advice, and creates no advocate-client relationship</strong> with anyone.</p>
      <p>3.2 Output is produced with the help of artificial intelligence and automated rules and can be incomplete, outdated, wrong or fabricated (including citations and case law). Output is not an official or authoritative source.</p>
      <p>3.3 <strong>You must independently verify every draft, citation, statutory section, limitation period and court format before filing, sending or relying on it.</strong> You remain solely responsible for your professional work and for compliance with the Advocates Act, 1961, the Bar Council of India Rules and all court rules, including any requirement to disclose or restrict the use of AI tools before a court or tribunal.</p>
      <p>3.4 Limitation alerts (90, 30, 7 and 1 day) and hearing reminders are aids only. A missed, late or inaccurate alert does not extend or change any legal deadline.</p>
      <p>3.5 DifAi is not an advertising, referral or client-solicitation service. You must not use it to advertise or solicit work in a way that breaches the Bar Council of India Rules.</p>
      <p>3.6 Contract review scores and red-line suggestions reflect the positions library you configure and general risk heuristics. They are not an assessment of enforceability.</p>

      <H3>4. Your content, privilege and our licence</H3>
      <p>4.1 You own Your Content. You grant {OPERATOR.name} a limited, non-exclusive, revocable licence to host, process, copy (for backup) and display it solely to provide, secure and support the Service for you.</p>
      <p>4.2 We do not sell Your Content and do not use it to train general-purpose AI models. Our AI model providers do not use it to train their models under their terms for API customers.</p>
      <p>4.3 <strong>Staff access.</strong> Our personnel do not read Your Content except (a) with your approval for a support request, (b) where needed to investigate security incidents, abuse or legal compliance, or (c) as required by law. Access is logged and limited to authorised staff under confidentiality obligations.</p>
      <p>4.4 You confirm that you have the right, and where required the consent or other lawful basis, to upload Your Content, including personal data of clients, opposing parties and witnesses, and that doing so is consistent with your duty of confidentiality and any privilege. Uploading to DifAi is intended to be a confidential use for the purpose of your professional work; you remain responsible for assessing any privilege or confidentiality implications for your matters.</p>
      <p>4.5 <strong>Legal process.</strong> If we receive a lawful demand for Your Content, we will notify you before disclosure unless the law or the order prohibits it, and will disclose only what is legally required.</p>
      <p>4.6 <strong>Export.</strong> You may export Your Content at any time from Settings &rarr; Privacy &amp; Data &rarr; Export my data, including after you request account deletion and until the deletion takes effect.</p>
      <p>4.7 <strong>Feedback.</strong> If you send us suggestions, you grant us a free right to use them without obligation. This does not give us any right to Your Content.</p>
      <p>4.8 We may use aggregated, de-identified usage statistics that do not identify you or your clients to operate and improve the Service.</p>

      <H3>5. Acceptable use</H3>
      <p>You must not: use DifAi for unlawful purposes or to prepare fraudulent, forged, or misleading documents; upload malware; attempt to access other accounts, systems or data or probe or test our security without written permission; scrape, copy, resell, sub-license or reverse engineer the Service; use the Service or Output to build or train a competing product; share your account outside your licensed seats; use automated means to overload the Service; or use eCourts or other third-party data obtained through DifAi in breach of the source&rsquo;s terms.</p>

      <H3>6. Plans and fees</H3>
      <p>6.1 Paid plans and AI credit top-ups are sold at the prices shown on our pricing page and at checkout, in Indian rupees and inclusive of GST unless stated otherwise. We issue a GST tax invoice for every payment.</p>
      <p>6.2 Payments are processed by our payment partner, Razorpay. We do not store full card, bank or UPI credentials.</p>
      <p>6.3 Renewal, cancellation and refunds are governed by the Subscription Policy (<a href="#part-e" style={linkStyle}>Part E</a>).</p>
      <p>6.4 We may suspend paid features for non-payment after 7 days&rsquo; notice.</p>
      <p>6.5 DifAi&rsquo;s billing, retainer reconciliation and receipt tools are for your own practice. You are responsible for your own tax, GST, accounting and Bar Council compliance and for the accuracy of invoices you issue.</p>

      <H3>7. Third-party and public data</H3>
      <p>Case tracking uses public eCourts information (including CNR-linked data). That data belongs to its publishers, may be delayed, incomplete or changed, and is not an official record. Always check the official court website or certified copy. Integrations with third-party services (payment, WhatsApp messaging, email, AI providers, Google Play, sign-in providers) are governed by those parties&rsquo; terms; we are not responsible for their acts.</p>

      <H3>8. Intellectual property</H3>
      <p>DifAi software, templates, design, trade names and compilations (other than Your Content and public law) belong to {OPERATOR.name} or its licensors. We grant you a revocable, non-exclusive, non-transferable licence to use the Service under these Terms. If you believe content in the Service infringes your rights, write to {mail} with details and we will respond within 14 days.</p>

      <H3>9. Security</H3>
      <p>We apply reasonable security practices and procedures appropriate to legal data, including access controls, encryption in transit, encryption of sensitive fields at rest, logging and backups, in line with Section 43A of the Information Technology Act, 2000 and the SPDI Rules, 2011 and, once in force, the DPDP Act. No system is perfectly secure; keep your own backups of important documents.</p>

      <H3>10. Availability, beta features and changes</H3>
      <p>We aim for reliable service but do not guarantee uninterrupted or error-free operation, and scheduled maintenance may occur. Features marked &ldquo;beta&rdquo; are provided for evaluation and may change or be withdrawn. We may modify the Service, with at least 30 days&rsquo; notice for material reductions of paid functionality.</p>

      <H3>11. Suspension and termination</H3>
      <p>You may close your account at any time from Settings &rarr; Privacy &amp; Data or by writing to us. We may suspend or terminate access for breach of these Terms, legal requirement, or risk to the Service or other users, ordinarily after notice unless urgent. Fees already paid are handled under the Subscription Policy. Sections that by nature should survive termination (including 3, 4.4 and 12 to 15) survive.</p>

      <H3>12. Disclaimers</H3>
      <p>The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the maximum extent permitted by law, we disclaim all warranties, including accuracy or completeness of Output, merchantability, fitness for a particular purpose and non-infringement.</p>

      <H3>13. Limitation of liability</H3>
      <p>13.1 To the extent permitted by law, {OPERATOR.name} is not liable for indirect, incidental, special or consequential loss, including lost cases, missed deadlines, lost profits, costs awarded against you or professional claims arising from use of the Service or reliance on Output.</p>
      <p>13.2 Our total liability for any claim is limited to the fees you paid in the 12 months before the claim arose (or INR 5,000 if you paid no fees).</p>
      <p>13.3 Nothing in these Terms excludes liability for fraud, wilful misconduct, death or personal injury, or any liability that cannot be excluded under Indian law.</p>

      <H3>14. Indemnity</H3>
      <p>You will indemnify {OPERATOR.name} against third-party claims, losses and reasonable legal costs arising from Your Content, your breach of these Terms or law, or your professional conduct in using Output. We will give you prompt notice of any claim and reasonable cooperation.</p>

      <H3>15. Governing law, disputes and arbitration</H3>
      <p>15.1 These Terms are governed by the laws of India.</p>
      <p>15.2 The parties will first try to resolve any dispute in good faith for 30 days after written notice to {mail} (or to your registered email).</p>
      <p>15.3 If unresolved, the dispute will be finally settled by arbitration under the Arbitration and Conciliation Act, 1996 by a <strong>sole arbitrator appointed by mutual agreement of the parties</strong>; if they do not agree within 15 days, the arbitrator will be appointed by the {OPERATOR.highCourt} under Section 11 of that Act. Neither party has a right to appoint the arbitrator unilaterally. Seat and venue: {OPERATOR.city}. Language: English.</p>
      <p>15.4 This clause does not prevent either party from seeking urgent interim relief from a competent court, and does not limit any right you have to approach a Consumer Commission, the Data Protection Board or any authority where the law gives you that right and does not permit it to be waived.</p>
      <p>15.5 Subject to the above, the courts at {OPERATOR.city}, India have exclusive jurisdiction.</p>

      <H3>16. Changes to these Terms</H3>
      <p>We may update these Terms. For material changes we will give at least 15 days&rsquo; notice by email or in-app and ask for fresh acceptance where required. If you disagree you may close your account before the effective date. Continued use after the effective date means acceptance of non-material changes.</p>

      <H3>17. General</H3>
      <ul>
        <li><strong>Entire agreement:</strong> these Terms with the Privacy Policy, DPDP Notice, Cookie and Device Permissions Notice and Subscription Policy are the entire agreement.</li>
        <li><strong>Severability and waiver:</strong> if a clause is unenforceable the rest continues; failure to enforce a right is not a waiver.</li>
        <li><strong>Assignment:</strong> you may not assign your rights; we may assign ours in a merger, restructuring or sale with notice to you.</li>
        <li><strong>Force majeure:</strong> neither party is liable for delay caused by events beyond reasonable control, including natural disaster, war, strikes, power or internet failure, court or government shutdown, or failure of public utilities and third-party networks.</li>
        <li><strong>Notices:</strong> we may notify you by email, in-app or on the site. Notices to us go to {mail}.</li>
        <li><strong>Electronic records:</strong> click-acceptance and electronic records are valid under the Information Technology Act, 2000.</li>
        <li><strong>Language:</strong> these Terms are in English; translations are for convenience and English prevails.</li>
      </ul>

      <Part id="part-d">Part D: Cookie and Device Permissions Notice</Part>

      <H3>1. Website</H3>
      <p>DifAi does not use advertising, analytics or cross-site tracking cookies. The website keeps only what it needs to work in your browser&rsquo;s storage:</p>
      <Table
        head={['Type', 'Purpose', 'Consent needed']}
        rows={[
          ['Strictly necessary (sign-in session, security)', 'Keep you signed in and the site secure', 'No'],
          ['Preferences (theme, layout choices)', 'Remember your choices on this device', 'No; you can clear them from your browser at any time'],
        ]}
      />

      <H3>2. Android app permissions</H3>
      <Table
        head={['Permission', 'Why we ask', 'Required?']}
        rows={[
          ['Internet', 'Sync your data and fetch eCourts updates', 'Yes'],
          ['Files / document picker', 'Upload documents you choose', 'Only when you upload'],
          ['Camera', 'Photograph documents and scan eCourts QR codes', 'Optional, asked when you first use it'],
          ['Microphone', 'Dictation: speech is turned into text by your device’s speech service; we receive only the text', 'Optional, asked when you first tap the mic'],
          ['Biometric unlock', 'App lock; your fingerprint or face data stays on your device and is never sent to us', 'Optional'],
        ]}
      />
      <p>The app does not read your contacts, SMS, call logs or location.</p>

      <Part id="part-e">Part E: Subscription, Refund and Cancellation Policy</Part>

      <H3>1. Plans</H3>
      <p>The plans, what each includes (such as page credits and seats) and their prices are shown on our pricing page and at checkout. We do not charge you unless you choose a paid plan and authorise the payment.</p>

      <H3>2. Billing and renewal</H3>
      <ul>
        <li>Paid plans are billed monthly or yearly, as you choose, in advance in INR. Prices include GST, which is shown separately on your tax invoice.</li>
        <li>Subscriptions renew automatically at the end of each period unless cancelled. Where the payment method needs your authorisation for each charge, or RBI e-mandate rules require a pre-debit notification, we comply with those rules.</li>
        <li>Price changes take effect at the next renewal after at least 30 days&rsquo; notice.</li>
      </ul>

      <H3>3. Cancellation</H3>
      <p>You may cancel at any time by writing to {mail} from your registered email; we confirm within 2 working days. Cancellation stops the next renewal; you keep access until the end of the paid period.</p>

      <H3>4. Refunds</H3>
      <ul>
        <li><strong>Sanad and Vakalat</strong> (monthly or yearly): not refundable.</li>
        <li><strong>Brief and Associates, yearly:</strong> full refund if requested within 7 days of the payment, provided no more than 10 AI credits were used since. Monthly: not refundable.</li>
        <li><strong>Munshi seats</strong> follow the plan they were bought with.</li>
        <li><strong>Brief Packs (AI credit top-ups):</strong> refundable if requested within 7 days of purchase and none of the pack&rsquo;s credits have been used.</li>
        <li><strong>Our failure:</strong> if the Service is unavailable for more than 72 consecutive hours in a billing period for reasons within our control, we will credit or refund the affected portion.</li>
        <li><strong>Duplicate or erroneous charges</strong>, including a charge after cancelling: refunded in full.</li>
        <li>No refund for partial periods after the above windows, except where the law requires.</li>
        <li>Approved refunds are returned to the original payment method within 7 to 10 working days, with a GST credit note.</li>
        <li>The same rules, in full, are in our {toRefunds}.</li>
      </ul>

      <H3>5. Failed payments</H3>
      <p>If a payment fails we will retry and notify you. After 7 days of non-payment we may downgrade or suspend paid features. Your data stays available for export.</p>

      <H3>6. Billing disputes</H3>
      <p>Write to {mail} with the invoice number. We acknowledge within 48 hours and resolve within 30 days. Unresolved disputes follow the grievance process in the DPDP Notice (see the {toPrivacy}) and clause 15 of these Terms.</p>

      <H3>Version history</H3>
      <Table
        head={['Version', 'Summary of change']}
        rows={[
          ['1.0', 'First issue'],
          ['1.1', 'Added IT Act/SPDI disclosures, Android permissions, refund policy, advocate-as-fiduciary terms, staff-access limits, fair arbitration clause'],
        ]}
      />
    </LegalPage>
  );
}

// -----------------------------------------------------------------------------
// /privacy — Part B (Privacy Policy incl. data processing terms) and Part C
// (DPDP Act notice, consent and rights)
// -----------------------------------------------------------------------------

export function PrivacyPolicyView() {
  return (
    <LegalPage title="Privacy Policy and DPDP Notice" updated={`Version ${LEGAL_VERSION} · Effective ${LEGAL_EFFECTIVE}`}>
      <OperatorLine />
      <p>Read this with our {toTerms}. If you want to delete your account, see <Link to="/delete-account" style={linkStyle}>Delete your account</Link>.</p>
      <Contents items={[['part-b', 'Part B: Privacy Policy (including data processing terms for advocates and firms)'], ['part-c', 'Part C: DPDP Act Notice, Consent and Your Rights']]} />

      <Part id="part-b">Part B: Privacy Policy</Part>

      <H3 id="roles">1. Who we are and our roles</H3>
      <p>{OPERATOR.name} operates DifAi. Under the Digital Personal Data Protection Act, 2023 (DPDP Act), the DPDP Rules, 2025, and, until it is repealed on commencement of the DPDP Act, Section 43A of the Information Technology Act, 2000 with the Sensitive Personal Data or Information Rules, 2011 (SPDI Rules), we act in two roles:</p>
      <ul>
        <li><strong>Data Fiduciary</strong> for your own account, billing, usage and device data.</li>
        <li id="data-processing"><strong>Data Processor</strong> for personal data contained in Your Content about your clients, opposing parties, witnesses and others. You (the advocate or firm) are the Data Fiduciary for that data and decide why and how it is processed. We process it only on your documented instructions given through the Service and these terms (which form the data processing terms between us), and we do not use it for our own purposes.</li>
      </ul>

      <H3>2. Data we collect</H3>
      <Table
        head={['Category', 'Examples', 'Source']}
        rows={[
          ['Account and identity', 'Name, email, WhatsApp mobile number, password (stored only as a salted hash), profession, Bar Council enrolment number, firm name', 'You'],
          ['Professional profile', 'Practice areas, courts, office address, GSTIN', 'You'],
          ['Case and matter data', 'CNR numbers, case titles, parties, hearing dates, orders fetched from eCourts, tags', 'You, eCourts'],
          ['Documents and drafts', 'Notices, plaints, contracts, uploaded files and photos, prompts and AI outputs', 'You'],
          ['Billing data', 'Plan, invoices, retainer ledgers, NEFT/UPI references, GST details, payment status', 'You, payment partner'],
          ['Technical data', 'IP address, device and browser type, app version, server and security logs', 'Automatically'],
          ['Support data', 'Messages and attachments you send us', 'You'],
          ['Request records', 'Export, deletion and grievance requests you make', 'Generated'],
          ['Sign-in data (if you use Google sign-in)', 'Name, email, Google account identifier', 'Google'],
        ]}
      />
      <p><strong>Sensitive data.</strong> Under the SPDI Rules, passwords and financial information (such as bank account, card or payment-instrument details) are &ldquo;sensitive personal data&rdquo;. We store passwords only as hashes and do not store card or UPI credentials. We do not need government ID, biometrics, health data or caste/religion information. If Your Content contains such data about others, you are responsible for lawful handling as their Data Fiduciary.</p>

      <H3>3. Why we use data</H3>
      <ul>
        <li>To create and secure your account (including verifying your WhatsApp number with a one-time code) and provide drafting, case tracking, contract review, billing, research and limitation features.</li>
        <li>To process payments and issue GST invoices.</li>
        <li>To send service messages (hearing and limitation alerts, security and billing notices). We do not send marketing messages.</li>
        <li>To maintain security, detect and prevent fraud and abuse, debug, and improve the Service using aggregated or de-identified data.</li>
        <li>To comply with law, respond to lawful orders, and enforce our Terms.</li>
      </ul>
      <p>Legal basis under the DPDP Act: your consent, and &ldquo;certain legitimate uses&rdquo; such as complying with law or a court or tribunal order. Personal data is processed only for the purposes stated here and only to the extent necessary for them.</p>

      <H3>4. AI processing</H3>
      <p>Drafting, research and contract review send relevant content to AI model providers acting as our sub-processors under their commercial terms:</p>
      <ul>
        <li><strong>Anthropic, PBC</strong> (United States): drafting, research, matter assistance and the other AI features.</li>
        <li><strong>OpenAI</strong> (United States): contract review.</li>
      </ul>
      <p>Content is sent only to produce your output and is not used to train their models under their terms for API customers. They may keep it for up to 30 days for abuse and safety monitoring, then delete it, unless the law requires longer. Output is generated automatically; it is not reviewed by a human by default and is not used to make decisions with legal effect about any individual. Do not include more personal data in prompts than needed.</p>

      <H3>5. Who we share data with</H3>
      <p>We do not sell personal data. We share only with:</p>
      <ul>
        <li>Our cloud hosting provider (Hostinger), which runs our servers and database.</li>
        <li>AI model providers (above).</li>
        <li>Our payment partner (Razorpay Software Pvt. Ltd.) and banks, for UPI, NEFT and card processing.</li>
        <li>Our WhatsApp messaging provider, to deliver one-time codes, and email providers when we send you email.</li>
        <li>Google, if you choose Google sign-in.</li>
        <li>Professional advisers, auditors and insurers under confidentiality.</li>
        <li>Courts, regulators, law enforcement or the Data Protection Board when legally required (see clause 4.5 of the Terms for notice to you).</li>
        <li>A successor entity in a merger or sale, with notice to you.</li>
      </ul>
      <p>We do not use third-party analytics, advertising or crash-reporting services. Processors are bound to keep data confidential, use it only to provide their service to us, apply reasonable security safeguards and notify breaches. This list is our current sub-processor list; we will update it here when it changes, and you can ask us for it at {mail}.</p>

      <H3>6. Transfers outside India</H3>
      <p>Some providers, including our AI model providers, process data outside India. We transfer personal data only to countries or territories not restricted by the Central Government under Section 16 of the DPDP Act. If you need your data processed only in India for professional reasons, write to {mail}.</p>

      <H3>7. Retention and deletion</H3>
      <Table
        head={['Data', 'Retention']}
        rows={[
          ['Account data and Your Content', 'While your account is active. When you request account deletion, it is permanently erased after the cancellation window (30 days by default), except the records below.'],
          ['Backups', 'Copies in server backups are removed as those backups are cleared in the normal backup cycle.'],
          ['Billing and tax records', 'As long as required by tax and company law (up to 8 years)'],
          ['Access and security logs', 'At least one year, as required under the DPDP Rules'],
          ['Support messages', '2 years'],
        ]}
      />
      <p>We erase personal data when the purpose is complete or consent is withdrawn, unless law requires us to keep it. When we hold data longer for a legal reason, we restrict it to that purpose.</p>

      <H3>8. Security safeguards</H3>
      <p>We use encryption in transit (HTTPS), encryption of sensitive fields at rest, role-based access, hashed passwords, audit logs, backups, data minimisation, secure development practices, vendor due diligence and staff confidentiality, consistent with the SPDI Rules and DPDP Rules. We keep logs to detect, investigate and recover from unauthorised access, and retain them for at least one year.</p>
      <p><strong>Personal data breach.</strong> If a breach occurs we will, as required by law, inform the Data Protection Board of India without delay and give it a detailed report within 72 hours (or such longer time as it allows), and inform each affected person without delay, describing what happened, when, the likely impact, what we are doing, safety steps you can take, and who to contact. If the breach affects data we process for you as an advocate or firm, we will notify you without undue delay so that you can meet your own obligations.</p>

      <H3>9. Mobile app and device information</H3>
      <p>The Android app requests only the permissions described in the Cookie and Device Permissions Notice (<Link to="/terms#part-d" style={linkStyle}>Part D</Link>). You can decline optional permissions in device settings; some features may then be unavailable. The app uses the camera and microphone only when you use a feature that needs them and asks you first. Dictation is converted to text by your device&rsquo;s or browser&rsquo;s speech service (for example Google on Android or Chrome); we receive only the text. We do not access contacts, SMS, call logs or location. We will keep our Google Play &ldquo;Data safety&rdquo; declaration consistent with this Policy.</p>

      <H3>10. Children</H3>
      <p>DifAi is for adults. We do not knowingly process personal data of a child (under 18) for our own purposes. If we learn a person under 18 has registered, we will close the account and delete the data, unless verifiable parental or guardian consent has been properly obtained for a lawful purpose. Where an advocate uploads data of a minor in a matter, the advocate is responsible, as Data Fiduciary, for obtaining verifiable consent of the parent or lawful guardian where the DPDP Act requires it. We do not track, monitor behaviour of, or target advertising at children.</p>

      <H3>11. Your responsibilities as an advocate or firm (Data Fiduciary)</H3>
      <p>Because you decide what personal data about clients and third parties goes into DifAi, you are responsible for: having a lawful basis or valid consent; giving required notices to those persons; keeping the data accurate; honouring their rights requests; ensuring retention matches your professional and legal obligations; informing us of any request you cannot fulfil yourself; and maintaining professional confidentiality. We will assist, within a reasonable period, with requests relating to data we process for you, including export, correction and deletion tools.</p>

      <H3>12. Persons whose data appears in a matter</H3>
      <p>If your personal data was entered into DifAi by an advocate or firm (for example as a client, opponent or witness), that advocate or firm is the Data Fiduciary. Please contact them first. You may also write to {mail} and we will pass your request to the relevant account holder and tell you we have done so. We will not disclose to you the contents of a matter to which you are not entitled.</p>

      <H3>13. Your rights and how to use them</H3>
      <p>See the DPDP Notice (<a href="#part-c" style={linkStyle}>Part C</a>). Contact: {mail}.</p>

      <H3>14. Cookies</H3>
      <p>See <Link to="/terms#part-d" style={linkStyle}>Part D</Link> of the Terms.</p>

      <H3>15. Changes to this Policy</H3>
      <p>We will post the updated policy with a new version number and effective date, keep earlier versions available on request, and notify you of material changes in advance, asking for fresh consent where the law requires.</p>

      <Part id="part-c">Part C: DPDP Act Notice, Consent and Your Rights</Part>
      <p><em>Shown before or at the time we collect your personal data, in clear and plain language. This notice is in English; you may ask us at {mail} for it in any language listed in the Eighth Schedule to the Constitution.</em></p>

      <H3>1. Notice to you (Data Principal)</H3>
      <p><strong>Who is collecting:</strong> {OPERATOR.name}, {OPERATOR.address}, operating DifAi.</p>
      <p><strong>What personal data, and for what purpose:</strong></p>
      <Table
        head={['Personal data', 'Purpose']}
        rows={[
          ['Name, email, mobile number', 'Create and secure your account; send service and security messages'],
          ['Profession, Bar Council enrolment number, firm', 'Set up professional features'],
          ['Content you upload (documents, case and party details)', 'Provide drafting, case tracking, contract review, research, limitation alerts'],
          ['Billing and payment references, GST details', 'Invoicing, retainer reconciliation, receipts, tax compliance'],
          ['Device, IP address and server logs', 'Security, fraud prevention, fixing errors, legal compliance'],
        ]}
      />
      <p><strong>How to exercise your rights or withdraw consent:</strong> Settings &rarr; Privacy &amp; Data in the app, or email {mail}. Withdrawing consent is as easy as giving it. Withdrawal does not affect processing done before it, and some features may stop working. After withdrawal we stop processing and erase your data unless law requires us to keep it, and we ask our processors to do the same.</p>
      <p><strong>How to complain:</strong> first write to our Grievance Officer (below). If you are not satisfied, or do not receive a response in time, you may complain to the <strong>Data Protection Board of India</strong> through its official channel. The Act requires you to use our grievance process before approaching the Board.</p>

      <H3>2. Consent</H3>
      <p>When you create an account you agree, by a clear affirmative action, to the Terms of Service and to DifAi processing your personal data as described in this notice and the Privacy Policy to provide the Service. By uploading personal data of clients and other persons, you confirm you have a lawful basis to do so and act as their Data Fiduciary. We do not send marketing messages or run usage analytics, so we ask for no optional consents. Consent is limited to the purposes stated here.</p>
      <p><strong>Consent Managers.</strong> Once the Government&rsquo;s consent manager framework is in force, you may give, manage, review or withdraw consent through a registered Consent Manager, and we will honour valid requests from it.</p>

      <H3>3. Your rights under the DPDP Act</H3>
      <ul>
        <li><strong>Access:</strong> a summary of the personal data we process, the processing activities, and the identities of other Data Fiduciaries and processors with whom we have shared it, with a description of the data shared.</li>
        <li><strong>Correction, completion and updating</strong> of inaccurate or incomplete data.</li>
        <li><strong>Erasure</strong> of data no longer needed for the purpose or after consent is withdrawn, unless retention is legally required.</li>
        <li><strong>Withdraw consent</strong> at any time.</li>
        <li><strong>Grievance redressal</strong> from us, and then from the Data Protection Board.</li>
        <li><strong>Nominate</strong> another person to exercise your rights if you die or become incapacitated.</li>
      </ul>

      <H3>4. Response times</H3>
      <p>We acknowledge requests within 48 hours and aim to resolve them within 30 days, and in any case within the maximum period set by the DPDP Rules (not exceeding 90 days). We may need to verify your identity first and will tell you if we cannot act and why. Requests are free of charge unless clearly excessive or repetitive.</p>

      <H3>5. Your duties</H3>
      <p>Provide accurate information, do not impersonate any person, do not suppress material information when giving data for a government document, licence or similar, and do not make false or frivolous grievances or complaints. The Act provides for penalties for breach of these duties.</p>

      <H3 id="grievance-officer">6. Grievance Officer and contact</H3>
      <p>Published under the DPDP Act, the SPDI Rules and the Consumer Protection (E-Commerce) Rules.</p>
      <Table
        head={['Item', 'Details']}
        rows={[
          ['Name', OPERATOR.grievanceOfficer],
          ['Designation', OPERATOR.grievanceTitle],
          ['Email', mail],
          ['Postal address', OPERATOR.address],
          ['Office hours', 'Monday to Friday, 10:00 to 18:00 IST'],
          ['Acknowledgement', 'Within 48 hours'],
          ['Resolution', 'Within 30 days of receipt (outer limit 90 days)'],
        ]}
      />

      <H3>7. Breach notification</H3>
      <p>We will inform affected persons and the Data Protection Board of a personal data breach as required by law, and tell you the nature, extent, timing and likely impact, the steps taken and the steps you can take, and a contact person (see Privacy Policy clause 8).</p>

      <H3>8. Significant Data Fiduciary</H3>
      <p>If the Government notifies {OPERATOR.name} as a Significant Data Fiduciary, we will appoint a Data Protection Officer based in India and an independent data auditor, carry out Data Protection Impact Assessments, and publish the DPO&rsquo;s contact details here.</p>
    </LegalPage>
  );
}

export function DeleteAccountView() {
  return (
    <LegalPage title="Delete your DifAi account" updated="Last updated 28 October 2026">
      <p>
        You can delete your DifAi account, and all the data in it, at any time. This page explains how and
        what happens to your data. DifAi is provided by {OPERATOR.name}.
      </p>

      <H3>Delete it in the app</H3>
      <ol>
        <li>Sign in to DifAi in the Android app or at difai.sirahdigital.in.</li>
        <li>Open <strong>Settings</strong> and choose the <strong>Privacy &amp; Data</strong> tab.</li>
        <li>Under <strong>Delete my account permanently</strong>, tap <strong>Request deletion</strong>.</li>
        <li>Confirm by typing your email address.</li>
      </ol>
      <p>Before deleting, you can download a copy of your data from the same tab using <strong>Export my data</strong>.</p>

      <H3>Or ask us by email</H3>
      <p>
        If you can&rsquo;t sign in, email {mail} from the email address on your account (or tell us your
        registered WhatsApp number) with the subject &ldquo;Delete my account&rdquo;. We will verify it is
        you and complete the deletion within 30 days.
      </p>

      <H3>What is deleted</H3>
      <ul>
        <li>Your profile: name, email, phone number, password and Google sign-in link.</li>
        <li>Your matters, clients, drafts, notes, tasks, calendar entries, documents and photos.</li>
      </ul>
      <p>
        Deletion is scheduled for 30 days after your request (you can pick another window when confirming).
        Until then you can cancel it from the same screen. After that the data is permanently erased.
      </p>

      <H3>What we keep</H3>
      <p>
        Payment and tax invoice records are kept for the period required by Indian tax law (up to 8 years), and
        a minimal security audit record of the deletion itself may be kept for a limited period. These are not
        used for any other purpose.
      </p>

      <H3>Delete some data, keep your account</H3>
      <p>
        You can delete individual matters, drafts, documents and other items yourself at any time from inside
        the app, without deleting your account. For anything else, write to {mail}.
      </p>
    </LegalPage>
  );
}

// ---- Refund and cancellation policy + contact (owner approved 2026-11-14) ----
// Razorpay's website review needs both as their own pages. Part E of the
// Terms carries the same refund rules and links here.

const toRefunds = <Link to="/refund-policy" style={linkStyle}>Refund and Cancellation Policy</Link>;

export function RefundPolicyView() {
  return (
    <LegalPage title="Refund and Cancellation Policy" updated={`Version ${LEGAL_VERSION} · Effective ${LEGAL_EFFECTIVE}`}>
      <p>
        This policy covers payments to {OPERATOR.name} (GSTIN {OPERATOR.gstin}) for DifAi plans, Munshi seats and
        Brief Packs, paid through Razorpay. All prices include 18% GST. It forms part of our {toTerms} (Part E).
      </p>

      <H3>Cancelling a plan</H3>
      <ul>
        <li>The account owner can cancel at any time by writing to {mail} from the email or phone number on the account. We confirm the cancellation within 2 working days.</li>
        <li>Cancelling stops the next renewal. Your plan, its credits and your data stay available until the end of the period already paid for.</li>
        <li>We do not refund the unused part of a month or a year, except as set out below.</li>
      </ul>

      <H3>Refunds on plans</H3>
      <ul>
        <li><strong>Sanad and Vakalat</strong> (monthly or yearly): not refundable. Their low price is the trial.</li>
        <li><strong>Brief and Associates, yearly</strong>: refundable in full if you ask within 7 days of the payment and have used no more than 10 AI credits since paying. After that, not refundable.</li>
        <li><strong>Brief and Associates, monthly</strong>: not refundable.</li>
        <li><strong>Munshi seats</strong> follow the plan they were bought with.</li>
      </ul>

      <H3>Refunds on Brief Packs</H3>
      <ul>
        <li>Refundable in full within 7 days of purchase if none of the pack&rsquo;s credits have been used.</li>
        <li>Once any of its credits are used, a Brief Pack is not refundable.</li>
      </ul>

      <H3>Payment errors and our failures</H3>
      <ul>
        <li>If you were charged twice, charged after cancelling, or charged for a payment that did not go through, we refund the extra amount in full.</li>
        <li>If the Service is unavailable for more than 72 consecutive hours in a billing period for reasons within our control, we credit or refund the affected portion.</li>
      </ul>

      <H3>How refunds are paid</H3>
      <ul>
        <li>Refunds go back to the original payment method through Razorpay, within 7 to 10 working days of approval, depending on your bank.</li>
        <li>For a refunded payment we issue a GST credit note against the original tax invoice.</li>
        <li>Credits added by a refunded payment are removed.</li>
      </ul>

      <H3>How to ask</H3>
      <p>
        Write to {mail} from the email or phone number on the account, with the invoice number or Razorpay
        payment ID. We reply within 2 working days.
      </p>
    </LegalPage>
  );
}

export function ContactView() {
  return (
    <LegalPage title="Contact us" updated={`Effective ${LEGAL_EFFECTIVE}`}>
      <p>DifAi is built and run by {OPERATOR.name}, {OPERATOR.form}.</p>
      <H3>Write to us</H3>
      <p>Support, billing, refunds and privacy: {mail}. We reply within 2 working days.</p>
      <H3>Business details</H3>
      <ul>
        <li>{OPERATOR.name}</li>
        <li>GSTIN {OPERATOR.gstin}</li>
        <li>{OPERATOR.address}</li>
        <li>Grievance Officer: {OPERATOR.grievanceOfficer}, {OPERATOR.grievanceTitle}</li>
      </ul>
      <H3>Policies</H3>
      <ul>
        <li>{toTerms}</li>
        <li>{toRefunds}</li>
        <li>{toPrivacy}</li>
      </ul>
    </LegalPage>
  );
}
