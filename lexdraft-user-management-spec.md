# LexDraft — Firm, Practice Group & User Management Specification

**Version:** 1.0
**Status:** Implementation Spec
**Scope:** Multi-tenant onboarding, role-based access control (RBAC), and feature entitlement for LexDraft.

---

## 1. Overview

LexDraft is a multi-tenant platform. Each **Firm** (or independent **Practice Group**) is an isolated tenant. When a tenant is created, the system provisions a single bootstrap **Firm Admin** account. That Firm Admin is then responsible for inviting and configuring all other users inside that tenant.

This document specifies:
- The tenant creation and admin-bootstrap flow
- The role hierarchy and permission model
- The feature entitlement system (firm-level plan + role-level permissions + per-user overrides)
- The User Management section inside the admin console
- Data model, API surface, and rollout phases

---

## 2. Tenant Hierarchy

```
System (LexDraft)
└── Firm (tenant)
    ├── Practice Groups (sub-units, e.g., Litigation, Corporate, IP)
    └── Users
        ├── Firm Admin(s)
        ├── Practice Group Leads
        └── Members (Partners, Associates, Paralegals, etc.)
```

**Key rules:**
- A **Practice Group** can exist either as a sub-unit inside a Firm *or* as a standalone tenant (small/solo practices).
- Every tenant must have **at least one active Firm Admin** at all times. The system blocks the demotion or deletion of the last admin.
- Users belong to **one tenant only**. Cross-tenant access is not supported in v1.

---

## 3. Tenant & Admin Creation Flow

### 3.1 System Admin creates the tenant
1. System Admin (LexDraft staff) opens the **Tenant Provisioning** screen.
2. Enters: Firm name, type (Firm / Practice Group), subscription plan, billing contact, primary admin email.
3. System creates the tenant record with the chosen plan's **feature entitlement set**.
4. System creates the **Firm Admin user** in `pending_activation` state.
5. System sends an activation email with a single-use, time-bound token (24h expiry).

### 3.2 Firm Admin activates and configures
1. Firm Admin clicks the activation link → sets password + MFA.
2. On first login, Firm Admin lands on a **Setup Checklist**:
   - Confirm firm details
   - Create practice groups (optional)
   - Define/customize roles
   - Invite users
   - Review feature toggles

### 3.3 Firm Admin onboards users
- Bulk invite via CSV or one-by-one
- Each invite requires: name, email, role, practice group (optional), per-user feature overrides (optional)
- Invited users receive an activation email and self-register

---

## 4. Role Model

### 4.1 Default System Roles
LexDraft ships with the following pre-defined roles. Firm Admins can use them as-is, clone them, or create custom roles.

| Role | Typical Default Features |
|---|---|
| **Firm Admin** | Full access to all firm features + User Management + Billing |
| **Practice Group Lead** | All drafting features + manage users within their practice group |
| **Partner** | Full drafting, review, e-sign, matter management, billing view |
| **Senior Associate** | Drafting, AI drafting, clause library, review, e-sign |
| **Associate** | Drafting, AI drafting, clause library |
| **Paralegal** | Drafting (limited), templates, document assembly |
| **Legal Secretary** | Document formatting, calendar, basic templates |
| **Intern / Trainee** | Read-only or restricted drafting |
| **External Client** *(optional v2)* | View-only access to shared matters |

### 4.2 Custom Roles
- Firm Admins can create custom roles via **Role Editor**.
- Each custom role: name, description, feature set, optional inheritance from a base role.
- Roles are **scoped to the tenant** — they don't leak across firms.

### 4.3 Role Assignment Rules
- Every user has exactly **one role** at any time.
- Role changes are logged in the audit trail.
- Demoting the last Firm Admin is blocked at the API level.

---

## 5. Feature Entitlement Model — Three Layers

This is the most important architectural decision. Features are gated by **three independent layers**, evaluated in order:

```
Can user X use feature F?
  = FirmHasFeature(tenant, F)         ← Layer 1: Plan/Subscription
  AND RoleHasFeature(role, F)          ← Layer 2: Role permissions
  AND NOT UserOverride(user, F, deny)  ← Layer 3: Per-user override
  OR  UserOverride(user, F, grant)     ← (grant override can re-enable)
```

### Layer 1 — Firm-Level Entitlements (Plan)
- Determined by the firm's subscription plan (Starter / Professional / Enterprise).
- Set by System Admin; **read-only** to the Firm Admin.
- Example: "AI Drafting" may be available only on Professional+.

### Layer 2 — Role-Level Permissions
- Configured by Firm Admin in the Role Editor.
- Applies to all users with that role.
- Example: "E-signature" enabled for Partners, disabled for Interns.

### Layer 3 — Per-User Overrides
- Configured by Firm Admin from the user's profile.
- Used for exceptions (e.g., one Associate granted billing access).
- Both **grant** and **deny** overrides supported.

### 5.1 Baseline Features (the "specified feature for all roles")
A small set of features is **mandatory for every active user**, regardless of role:
- View own profile and update password
- Access shared firm announcements
- View documents explicitly shared with them
- Search within their accessible workspace

These cannot be disabled by any layer. They are enforced as a constant in the permission resolver.

---

## 6. Feature Catalog (initial set)

Group features by domain to keep the UI manageable:

**Drafting & Documents**
- `drafting.basic` — Create/edit documents
- `drafting.ai` — AI-assisted drafting
- `drafting.templates` — Use template library
- `drafting.clauses` — Clause library access
- `drafting.compare` — Document comparison/redlining

**Review & Approval**
- `review.comment` — Comment on documents
- `review.approve` — Approve/reject documents
- `review.track_changes` — Manage tracked changes

**Signing & Delivery**
- `esign.send` — Send for e-signature
- `esign.bulk` — Bulk signature workflows

**Matter & Client Management**
- `matter.view` / `matter.create` / `matter.assign`
- `client.view` / `client.create`

**Administration**
- `admin.users` — User Management section
- `admin.roles` — Role Editor
- `admin.billing` — Billing & subscription
- `admin.audit` — Audit logs
- `admin.practice_groups` — Manage practice groups

**Reporting**
- `reports.usage` / `reports.billing` / `reports.activity`

> Feature keys use dot notation for easy grouping in the UI and pattern matching in the permission resolver.

---

## 7. User Management Section (Admin Console)

Accessible only to users with `admin.users` feature enabled.

### 7.1 Layout
```
┌─ User Management ───────────────────────────────────────┐
│  [Users] [Roles] [Practice Groups] [Invitations] [Audit]│
├─────────────────────────────────────────────────────────┤
│  Filters: Role ▼  Practice Group ▼  Status ▼  Search    │
├─────────────────────────────────────────────────────────┤
│  Name        Email           Role         Status   ⋮    │
│  J. Smith    j@firm.com      Partner      Active   ⋮    │
│  ...                                                    │
└─────────────────────────────────────────────────────────┘
```

### 7.2 Tabs

**Users tab**
- List, search, filter all users in the tenant
- Bulk actions: invite, deactivate, change role, export
- Click a user → user detail drawer with:
  - Profile info
  - Role (with change history)
  - Practice group assignment
  - **Feature override matrix** (shows inherited from role, with grant/deny toggles)
  - Activity summary, last login
  - Deactivate / reset password / resend invite

**Roles tab**
- List all roles (system + custom)
- Create / clone / edit / delete custom roles
- For each role: edit feature matrix grouped by domain
- Shows count of users assigned to each role
- Cannot delete a role that has users assigned

**Practice Groups tab**
- Create / rename / archive practice groups
- Assign Practice Group Lead(s)
- View members per group

**Invitations tab**
- Pending invites, expired invites, resend, revoke
- Bulk CSV import

**Audit tab** *(if `admin.audit` enabled)*
- All admin actions: user created, role changed, feature toggled, etc.
- Filter by actor, target, action, date

### 7.3 Feature Override Matrix UI
Render each feature as a tri-state row:
- ✅ **Inherited (granted by role)**
- ⛔ **Inherited (denied by role)**
- 🟢 **Override: Grant**
- 🔴 **Override: Deny**
- ⚪ **Reset to inherited**

Always show the *effective* result so admins can't be surprised.

---

## 8. Data Model (Reference)

```sql
-- Tenants
firms (
  id PK, name, type ENUM('firm','practice_group'),
  plan_id FK, status, created_at
)

practice_groups (
  id PK, firm_id FK, name, lead_user_id FK NULL
)

-- Users
users (
  id PK, firm_id FK, practice_group_id FK NULL,
  email UNIQUE, name, status ENUM('pending','active','suspended'),
  role_id FK, mfa_enabled, last_login_at, created_at
)

-- Roles
roles (
  id PK, firm_id FK NULL,  -- NULL = system role
  name, description, is_system BOOL, base_role_id FK NULL
)

-- Feature catalog
features (
  key PK, name, description, domain, default_baseline BOOL
)

-- Plan entitlements (Layer 1)
plan_features (
  plan_id FK, feature_key FK, enabled BOOL
)

-- Role permissions (Layer 2)
role_features (
  role_id FK, feature_key FK, enabled BOOL
)

-- Per-user overrides (Layer 3)
user_feature_overrides (
  user_id FK, feature_key FK,
  decision ENUM('grant','deny'),
  granted_by FK, granted_at, reason TEXT
)

-- Audit
audit_log (
  id PK, firm_id FK, actor_user_id FK, action,
  target_type, target_id, payload JSON, created_at
)

-- Invitations
invitations (
  id PK, firm_id FK, email, role_id FK,
  practice_group_id FK NULL, token, expires_at, status
)
```

### Permission Resolver (pseudocode)
```python
def can(user, feature_key):
    if feature_key in BASELINE_FEATURES:
        return True
    if not plan_has(user.firm.plan, feature_key):
        return False
    override = get_override(user.id, feature_key)
    if override == 'deny':
        return False
    if override == 'grant':
        return True
    return role_has(user.role, feature_key)
```

Cache the resolved feature set per user (invalidate on role change, override change, plan change).

---

## 9. API Surface (v1)

### Tenant (System Admin)
- `POST /admin/firms` — create firm + bootstrap admin
- `GET /admin/firms/:id`
- `PATCH /admin/firms/:id/plan` — change plan

### Firm Admin
- `GET /firm/users`, `POST /firm/users/invite`, `PATCH /firm/users/:id`
- `POST /firm/users/:id/deactivate`
- `GET /firm/roles`, `POST /firm/roles`, `PATCH /firm/roles/:id`, `DELETE /firm/roles/:id`
- `GET /firm/roles/:id/features`, `PUT /firm/roles/:id/features`
- `GET /firm/users/:id/overrides`, `PUT /firm/users/:id/overrides`
- `GET /firm/practice-groups`, `POST /firm/practice-groups`, `PATCH /firm/practice-groups/:id`
- `GET /firm/audit`
- `GET /firm/invitations`, `POST /firm/invitations/:id/resend`, `DELETE /firm/invitations/:id`

### Self-service
- `GET /me`, `GET /me/features` — returns the resolved feature set for the current session

All endpoints enforce: `request.user.firm_id == resource.firm_id` (tenant isolation).

---

## 10. Security & Guardrails

- **Last-admin protection:** API rejects any operation that would leave the firm with zero active admins.
- **Tenant isolation:** Every query filtered by `firm_id`. Add a database-level RLS policy (Postgres) for defense in depth.
- **Audit everything:** Role changes, feature toggles, user deactivations, plan changes — all logged with actor + timestamp + before/after.
- **MFA enforcement:** Configurable per firm; mandatory for any user with `admin.*` features.
- **Invite tokens:** Single-use, 24h expiry, signed (e.g., JWT with short TTL or opaque token in DB).
- **Rate limiting** on invite and login endpoints.
- **Soft delete** for users (deactivate, don't hard-delete) to preserve audit history.

---

## 11. UI/UX Notes

- The User Management section should never expose a feature toggle the firm's plan doesn't include — show it greyed out with an "Upgrade plan" link instead.
- When a Firm Admin changes a role's permissions, surface a count: *"This will affect 14 users."*
- When changing a user's role, show a diff: *"Will gain: AI Drafting, E-sign. Will lose: Billing view."*
- Empty states matter — first-time Firm Admin should see a guided checklist, not an empty grid.

---

## 12. Implementation Phases

**Phase 1 — Foundation (MVP)**
- Firm + bootstrap Firm Admin creation
- System roles only (no custom roles yet)
- Layer 1 (plan) + Layer 2 (role) feature gating
- User invite flow, basic User Management list

**Phase 2 — Flexibility**
- Custom roles + Role Editor UI
- Per-user feature overrides (Layer 3)
- Practice groups
- Audit log UI

**Phase 3 — Scale**
- Bulk invite via CSV
- SSO/SAML, SCIM provisioning
- Granular practice-group-level admins
- External client portal access

---

## 13. Open Questions (decide before build)

1. Can a user belong to **multiple practice groups**, or strictly one?
2. Should **Practice Group Leads** have admin powers scoped to their group (e.g., manage only their group's users)?
3. Are **custom roles** in v1, or deferred to Phase 2?
4. What is the **plan tier matrix** — which features are gated to which plans?
5. **Data residency:** Do firms in different regions need separate database clusters?
6. **Billing:** Per-seat, per-firm flat, or hybrid? Drives how user activation/deactivation interacts with billing.

---

*End of spec.*
