# LexDraft — Privacy Policy

**Status:** Template draft · 2026-05-12

> ⚠ **NOT YET COUNSEL-REVIEWED.** Every clause must be verified for DPDP Act
> 2023 compliance (specifically §§4–13 on processing obligations, §§11–17 on
> Data Principal rights, and §§29–31 on cross-border transfer if applicable)
> and IT Rules 2021 compliance before publication. The Company / Data
> Fiduciary identity and grievance-redressal contact must be filled in
> everywhere `[FIRM ENTITY]`, `[DPO_EMAIL]`, `[GRIEVANCE_OFFICER_EMAIL]`,
> `[GRIEVANCE_OFFICER_NAME]` appear.

---

## 1. Who we are

`[FIRM ENTITY]` ("Company", "we") operates LexDraft, a software-as-a-service
for Indian legal practitioners. We are the Data Fiduciary in respect of
personal data of our subscribers and the registered users within their
firms. For personal data uploaded by our customers in the course of their
practice (matters, clients, parties), we act as a Data Processor and our
customer is the Data Fiduciary.

## 2. Scope

This Privacy Policy applies to personal data we collect from:
- Subscribers and their authorised users while using the Service.
- Visitors to our marketing website.
- Persons whose data is uploaded to the Service by our customers (in which
  case the customer is the Data Fiduciary and we are the Processor).

## 3. Categories of personal data we collect

### From you, when you use the Service
- Account identifiers: name, email, password (hashed), Bar Council enrolment
  number, firm affiliation.
- Authentication data: TOTP factors, backup codes (hashed).
- Usage data: log entries, request IDs, IP addresses, user-agent strings,
  feature usage timestamps.
- Consent records: which version of these terms / this policy you accepted
  and when.

### As a Processor on behalf of our customers
- Matters, hearings, clients, parties, draft documents, clauses, invoices,
  expenses, and related metadata that customers store in the Service.

## 4. Purposes of processing

We process personal data for the following purposes:

| Purpose | Lawful basis (DPDP §6/7) |
|---|---|
| Providing and maintaining the Service | Contract (your subscription) |
| Authentication and account security | Legitimate use |
| Compliance with applicable law (Bar Council, IT, tax) | Legal obligation |
| Service improvement and analytics (aggregated only) | Legitimate use |
| Marketing communications | Consent (opt-in only) |

## 5. How we collect personal data

- Directly from you when you sign up, sign in, complete forms, or upload
  content.
- Automatically when you interact with the Service (cookies, logs).
- From our customers when they upload content as Data Fiduciary.

## 6. How we use AI features

The Service includes Claude-assisted (Anthropic) and Grok-assisted (xAI)
drafting and research features. When you use these features, your prompt
(typically a structured brief, not raw personal data) is sent to the
applicable provider for inference. No persistent training data is provided
to these vendors; they process the request and return the response.

## 7. Sharing of personal data

We do not sell personal data. We share personal data only:
- With our Data Processors who help us operate the Service (cloud hosting,
  database hosting, error monitoring, email delivery, AI inference). A
  current list is available on request.
- With your express direction (for example, when you generate an
  engagement letter and send it to a client).
- When required by Indian law, court order, or governmental authority.

Cross-border transfer: AI provider endpoints (Anthropic, xAI) may process
data outside India. We do not transfer customer data to any country
specifically restricted by the Central Government under DPDP §16.

## 8. Retention

- Account data is retained for the lifetime of your subscription, plus the
  retention window you select when initiating deletion (default 30 days).
- Customer Data is retained per the retention rules described in our DPDP
  retention policy (in-app, configurable per matter).
- Audit log entries are retained for **seven (7) years** to meet legal
  record-keeping obligations.
- Backups are retained per the schedule documented in [DEPLOYMENT.md](./DEPLOYMENT.md).

## 9. Your rights under DPDP Act 2023

You have the right to:
- **Access:** Request a copy of the personal data we hold about you. Use the
  in-app "Export my data" function under Settings → Privacy & Data.
- **Correction:** Request that we correct inaccurate or incomplete data.
- **Erasure:** Request deletion of your personal data, subject to legal
  retention obligations. Use the in-app "Delete my account" function under
  Settings → Privacy & Data.
- **Withdrawal of consent:** Where processing is based on consent, you may
  withdraw it through Settings → Privacy & Data.
- **Grievance redressal:** If you have concerns about how we process your
  data, contact our Grievance Officer at `[GRIEVANCE_OFFICER_EMAIL]`.

We respond to verified requests within thirty (30) days.

## 10. Security

- Passwords are hashed with bcrypt.
- TOTP MFA is required for Firm Admin and Platform Admin accounts.
- All credential-shaped fields in logs are redacted at emission time.
- Tenant data is firm-scoped at every query path; tenant-isolation tests are
  part of the standing test suite.
- The Service is hosted on infrastructure with industry-standard physical
  and network security.

## 11. Children

The Service is not intended for use by persons under the age of 18.

## 12. Cookies and similar technologies

We use first-party cookies for authentication and session management. We do
not currently use third-party advertising cookies. A cookie policy with
fuller detail is published in the in-app Settings → Privacy & Data.

## 13. Grievance Officer (per IT Rules 2021)

- Name: `[GRIEVANCE_OFFICER_NAME]`
- Designation: Grievance Officer
- Email: `[GRIEVANCE_OFFICER_EMAIL]`
- Address: `[FIRM ADDRESS]`
- Time zone: Asia/Kolkata (IST)
- Response window: 15 days from receipt of complaint

## 14. Changes to this policy

We may update this Privacy Policy from time to time. Material changes will
be notified in-app and by email at least thirty (30) days before they take
effect.

## 15. Contact

For privacy-related questions: `[DPO_EMAIL]`
For general support: `[CONTACT_EMAIL]`
Mailing address: `[FIRM ADDRESS]`

---

*Last updated: `[DATE]` · Version `[VERSION]`*
