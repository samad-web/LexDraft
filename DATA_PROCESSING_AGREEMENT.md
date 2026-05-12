# LexDraft — Data Processing Agreement (DPA) template

**Status:** Template draft · 2026-05-12

> ⚠ **NOT YET COUNSEL-REVIEWED.** This template is intended to be signed in
> addition to the Terms of Service when a Customer's procurement /
> compliance / in-house legal function requires a separate DPA. It captures
> the DPDP Act 2023 Processor obligations (§§4–13, 24–25) and the security
> measures actually implemented in the Service. Counsel must reconcile this
> against the Customer-specific procurement template before signature.

---

## Parties

This Data Processing Agreement ("DPA") is entered into between:

- `[FIRM ENTITY]`, the **Processor** (LexDraft); and
- `[CUSTOMER ENTITY]`, the **Fiduciary** (the subscribing law firm or chambers).

It supplements the Terms of Service and forms part of the subscription
agreement between the parties.

## 1. Definitions

Terms used in this DPA carry the meanings ascribed to them in the Digital
Personal Data Protection Act 2023 ("DPDP Act"), as supplemented by the
context of the Service.

- **Data Fiduciary** — the Customer subscribing to LexDraft.
- **Data Processor** — `[FIRM ENTITY]`, operating LexDraft.
- **Data Principal** — the natural person whose data is processed.
- **Personal Data** — any data about an identifiable individual.
- **Customer Data** — personal data uploaded to the Service by the Fiduciary
  in the course of operating their legal practice.

## 2. Roles

The Customer is the Data Fiduciary in respect of Customer Data. The
Processor processes Customer Data only on the documented instructions of the
Fiduciary as expressed through the use of the Service, except where required
by applicable law.

## 3. Scope of processing

| Element | Description |
|---|---|
| Subject matter | Provision of legal practice-management SaaS |
| Duration | The term of the subscription |
| Nature | Storage, retrieval, transmission, AI-assisted generation, analytics |
| Purpose | To enable the Fiduciary to manage their legal practice |
| Categories of Data Principals | Clients, parties, witnesses, opposing counsel and other persons named in matters |
| Categories of Personal Data | Names, addresses, contact details, case identifiers, matter notes, financial details, and any other personal data the Fiduciary uploads |

## 4. Fiduciary obligations

The Fiduciary represents and warrants that:
- It has a lawful basis under the DPDP Act for every category of Personal
  Data uploaded to the Service.
- It has provided required notices to Data Principals.
- It has obtained consent where consent is the lawful basis.
- It will respond to Data Principal rights requests (access, correction,
  erasure) within the timelines prescribed by the DPDP Act, using the
  in-app tools provided.

## 5. Processor obligations

The Processor shall:

### 5.1 Confidentiality and access control
- Ensure that persons authorised to process Personal Data are bound by
  confidentiality.
- Limit access on a need-to-know basis.
- Maintain role-based access control (RBAC) with three-layer
  plan/role/user-override gating.

### 5.2 Security measures
The Processor maintains the following technical and organisational
measures, current as of the date of this DPA:

| Control | Implementation |
|---|---|
| Encryption at rest | Postgres TDE / disk-level encryption per hosting provider |
| Encryption in transit | TLS 1.2+ for all network connections |
| Password hashing | bcrypt (cost 10) |
| Multi-factor authentication | TOTP required for Firm Admin and Platform Admin |
| Tenant isolation | Firm-scoped data plane verified by a 49-test isolation suite |
| Audit logging | 7-year retention; tamper-evident append-only ledger |
| Secret redaction | Pino logger redacts credential-shaped fields before emission |
| Rate limiting | Per-IP + per-user limits on authentication and AI endpoints |
| Webhook verification | HMAC-SHA256 signatures with timing-safe comparison |
| Backup | Daily Postgres dumps with 14-day daily + 12-month monthly retention |
| Backup verification | Quarterly restore drill |
| Vulnerability management | Dependency updates per pnpm audit, monthly minimum |

A current technical and organisational measures (TOM) document is available
on request.

### 5.3 Sub-processors
The Processor uses the following sub-processors:

| Sub-processor | Purpose | Location |
|---|---|---|
| Anthropic | AI inference for drafting | Provider-managed (US/EU edge) |
| xAI | Alternative AI inference | Provider-managed |
| `[HOSTING_PROVIDER]` | Application + database hosting | India region |
| `[EMAIL_PROVIDER]` | Transactional email delivery | TBD |

The Processor will notify the Fiduciary of any new sub-processor at least
thirty (30) days in advance. The Fiduciary may object to a new sub-processor
on reasonable grounds, in which case the parties will discuss a resolution
in good faith.

### 5.4 Data subject rights assistance
The Processor will, taking into account the nature of the processing, assist
the Fiduciary by appropriate technical and organisational measures to fulfil
the Fiduciary's obligation to respond to requests from Data Principals,
including:
- An in-app export endpoint (`GET /api/me/dpdp/export`) for self-service.
- An in-app deletion endpoint with configurable retention window.
- A consent ledger viewable to the Fiduciary and the affected Principal.

### 5.5 Breach notification
The Processor will notify the Fiduciary without undue delay (and in any
event within seventy-two (72) hours) of becoming aware of a personal data
breach affecting Customer Data. Notification will include:
- The nature of the breach
- Approximate number of Data Principals and records affected
- Likely consequences
- Measures taken or proposed to address the breach

### 5.6 Records of processing
The Processor maintains records of processing activities as required by the
DPDP Act and will make them available to the Fiduciary on reasonable
written request.

## 6. Return and deletion of Customer Data

On termination of the subscription, the Processor will:
- Allow the Fiduciary to export all Customer Data through the in-app export
  function for thirty (30) days after termination.
- Delete or anonymise Customer Data per the retention window selected by
  the Fiduciary (default 30 days) after the export period.
- Retain audit log entries for the legally-required 7-year period.

## 7. Cross-border transfer

The Service is hosted in `[HOSTING_REGION]`. AI inference may involve
transfer of prompt data to Anthropic / xAI endpoints which may process the
request outside India. The Processor confirms that no Customer Data is
transferred to any country specifically restricted by the Central Government
of India under DPDP §16.

## 8. Audits

The Fiduciary may, on reasonable prior written notice (not less than 30
days), audit the Processor's compliance with this DPA, at the Fiduciary's
cost, no more than once per twelve-month period unless following a breach.
The Processor will reasonably cooperate with such audits.

## 9. Liability

Liability under this DPA is subject to the limitation-of-liability provisions
of the underlying Terms of Service. Nothing in this DPA limits liability
that cannot be limited under applicable law.

## 10. Governing law

This DPA is governed by the laws of India. Disputes arising under this DPA
are subject to the same dispute-resolution mechanism as the underlying
subscription agreement.

## 11. Term and termination

This DPA takes effect on the Effective Date below and continues for the
duration of the underlying subscription. Sections 5.5, 5.6, 6, 8 and 9
survive termination.

## 12. Signatures

**For the Processor:**
- Name: `[SIGNATORY_NAME]`
- Title: `[SIGNATORY_TITLE]`
- Entity: `[FIRM ENTITY]`
- Signature: ______________________
- Date: __________

**For the Fiduciary:**
- Name: `[CUSTOMER_SIGNATORY_NAME]`
- Title: `[CUSTOMER_SIGNATORY_TITLE]`
- Entity: `[CUSTOMER ENTITY]`
- Signature: ______________________
- Date: __________

---

**Effective Date:** `[DATE]`

*Version `[VERSION]` · Counsel-reviewed: NO (template draft, see top banner)*
