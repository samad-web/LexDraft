import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Wordmark } from '@/components/brand/Logo';

// =============================================================================
// Public legal pages: the privacy policy and the account-deletion page.
// Both are linked from the Google Play listing (privacy policy + Data safety
// "delete account URL"), so they must load without signing in. Plain
// black-and-white document layout, same tokens as the rest of the app.
// =============================================================================

const CONTACT_EMAIL = 'support@sirahdigital.in';
const UPDATED = '28 October 2026';

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
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
        <div className="eyebrow" style={{ marginBottom: 8 }}>Last updated {UPDATED}</div>
        <h1 className="heading-lg" style={{ margin: 0, marginBottom: 24 }}>{title}</h1>
        <div className="body-md" style={{ lineHeight: 1.7, color: 'var(--text-secondary)' }}>
          {children}
        </div>
        <footer
          className="body-sm"
          style={{ marginTop: 48, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 16, flexWrap: 'wrap' }}
        >
          <Link to="/privacy" style={{ color: 'var(--text-primary)' }}>Privacy policy</Link>
          <Link to="/delete-account" style={{ color: 'var(--text-primary)' }}>Delete your account</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--text-primary)' }}>{CONTACT_EMAIL}</a>
        </footer>
      </main>
    </div>
  );
}

function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="heading-md" style={{ color: 'var(--text-primary)', marginTop: 32, marginBottom: 8 }}>
      {children}
    </h2>
  );
}

const mail = <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--text-primary)' }}>{CONTACT_EMAIL}</a>;

export function PrivacyPolicyView() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy explains how Sirah Digital (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses and protects
        personal data when you use DifAi, our legal drafting and practice-management service for advocates,
        on the web at difai.sirahdigital.in and through the DifAi Android app. We process personal data in
        line with the Digital Personal Data Protection Act, 2023 (DPDP Act).
      </p>

      <H2>What we collect</H2>
      <ul>
        <li><strong>Account details:</strong> your name, email address, WhatsApp phone number and password (stored only as a secure hash). If you sign in with Google, we receive your name, email address and Google account ID.</li>
        <li><strong>Practice details you enter:</strong> enrolment details, firm name, courts and practice areas.</li>
        <li><strong>Your work content:</strong> matters, client and party details, drafts, notes, tasks and the documents and photos you upload or capture with the camera.</li>
        <li><strong>Subscription records:</strong> your plan and payment status. Card and UPI details are handled by our payment processor and never reach our servers.</li>
        <li><strong>Security logs:</strong> sign-in events and an audit trail of actions on your account, used to keep the account secure.</li>
      </ul>
      <p>We do not use advertising, analytics or tracking SDKs, and we do not collect your location or contacts.</p>

      <H2>How we use it</H2>
      <ul>
        <li>To create and secure your account, including verifying your WhatsApp number with a one-time code.</li>
        <li>To provide the features you use: drafting, case management, court-data lookups, documents and reminders.</li>
        <li>To manage your subscription and send service messages about your account.</li>
      </ul>
      <p>We do not sell your data and do not use it for advertising.</p>

      <H2>Who we share it with</H2>
      <p>We share data only with service providers that process it on our behalf to run DifAi:</p>
      <ul>
        <li><strong>AI model provider</strong> (Anthropic): the text needed to generate a draft or answer is sent for processing. It is not used to train their models.</li>
        <li><strong>Google:</strong> if you choose Google sign-in.</li>
        <li><strong>WhatsApp messaging provider:</strong> your phone number, to deliver verification codes.</li>
        <li><strong>Payment processor</strong> (Dodo Payments): to process subscription payments.</li>
        <li><strong>Hosting provider:</strong> our servers and database.</li>
      </ul>
      <p>We may also disclose data where required by law or a valid order of a court or authority.</p>

      <H2>Security</H2>
      <p>
        All data travels over encrypted HTTPS connections. Sensitive fields are encrypted at rest, passwords are
        hashed, and access to your firm&rsquo;s data is limited to members of your account.
      </p>

      <H2>How long we keep it</H2>
      <p>
        We keep your data while your account is active. When you delete your account, your data is permanently
        erased after a short cancellation window (30 days by default), except records we must keep by law, such as
        tax invoices. See <Link to="/delete-account" style={{ color: 'var(--text-primary)' }}>Delete your account</Link>.
      </p>

      <H2>Your rights</H2>
      <p>Under the DPDP Act you can:</p>
      <ul>
        <li>access and download a copy of your data (Settings &rarr; Privacy &amp; Data &rarr; Export my data);</li>
        <li>correct your details from Settings;</li>
        <li>erase individual items (matters, drafts, documents) at any time, or delete your whole account;</li>
        <li>withdraw consent and raise a grievance with us.</li>
      </ul>

      <H2>Children</H2>
      <p>DifAi is a professional tool for advocates and is not meant for anyone under 18.</p>

      <H2>Changes</H2>
      <p>If we change this policy we will update the date above and, for significant changes, tell you in the app.</p>

      <H2>Contact and grievances</H2>
      <p>
        Sirah Digital, India. For any privacy question, request or grievance, write to {mail}. We aim to
        respond within 7 days.
      </p>
    </LegalPage>
  );
}

export function DeleteAccountView() {
  return (
    <LegalPage title="Delete your DifAi account">
      <p>
        You can delete your DifAi account, and all the data in it, at any time. This page explains how and
        what happens to your data. DifAi is provided by Sirah Digital.
      </p>

      <H2>Delete it in the app</H2>
      <ol>
        <li>Sign in to DifAi in the Android app or at difai.sirahdigital.in.</li>
        <li>Open <strong>Settings</strong> and choose the <strong>Privacy &amp; Data</strong> tab.</li>
        <li>Under <strong>Delete my account permanently</strong>, tap <strong>Request deletion</strong>.</li>
        <li>Confirm by typing your email address.</li>
      </ol>
      <p>Before deleting, you can download a copy of your data from the same tab using <strong>Export my data</strong>.</p>

      <H2>Or ask us by email</H2>
      <p>
        If you can&rsquo;t sign in, email {mail} from the email address on your account (or tell us your
        registered WhatsApp number) with the subject &ldquo;Delete my account&rdquo;. We will verify it is
        you and complete the deletion within 30 days.
      </p>

      <H2>What is deleted</H2>
      <ul>
        <li>Your profile: name, email, phone number, password and Google sign-in link.</li>
        <li>Your matters, clients, drafts, notes, tasks, calendar entries, documents and photos.</li>
      </ul>
      <p>
        Deletion is scheduled for 30 days after your request (you can pick another window when confirming).
        Until then you can cancel it from the same screen. After that the data is permanently erased.
      </p>

      <H2>What we keep</H2>
      <p>
        Payment and tax invoice records are kept for the period required by Indian tax law (up to 8 years), and
        a minimal security audit record of the deletion itself may be kept for a limited period. These are not
        used for any other purpose.
      </p>

      <H2>Delete some data, keep your account</H2>
      <p>
        You can delete individual matters, drafts, documents and other items yourself at any time from inside
        the app, without deleting your account. For anything else, write to {mail}.
      </p>
    </LegalPage>
  );
}
