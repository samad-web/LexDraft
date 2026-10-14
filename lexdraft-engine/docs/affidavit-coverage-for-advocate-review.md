# Affidavit coverage across templates — for advocate review

**This is a LEGAL-COMPLETENESS question, not a formatting one.** It goes into the same
review batch as the gold `regular_bail.docx` and `s138_notice.docx`.

## Background (why this doc exists)

There is a shared affidavit *component* (`src/components/affidavit.py` + a standalone
`affidavit.docx`), but **nothing in the engine composes it into any pleading** — the
renderer produces one template per document with no sub-document insertion. In practice,
each template that needs affidavit language **inlines its own copy**, and they do so
**inconsistently**. Some doc-types that ordinarily require a supporting affidavit carry
none. This is for an advocate to adjudicate — the engine cannot decide what the law
requires.

The classification below is mechanical (text signals in the committed templates), so
treat it as a starting map, not a legal conclusion. "Full affidavit block" = solemn
affirmation + deponent-competence language. "Verification only" = the lighter
"verified that the contents are true and correct" clause at the foot of a pleading.

## 1. Templates WITH a full affidavit block (3)

| Template | Notes |
|---|---|
| `affidavit` (component) | The standalone reference block; not composed anywhere. |
| `affidavit_of_service` | Standalone affidavit doc-type. |
| `substituted_service` | Inlines a full affidavit block. |

## 2. Partial / inconsistent (1)

| Template | Issue |
|---|---|
| `surety_affidavit` | Has solemn-affirmation language but **not** the deponent-competence block the component defines. Should it carry the full block? |

## 3. Doc-types that likely NEED a supporting affidavit but have NONE

These are doc-types where, in ordinary Indian practice, a supporting affidavit is
usually filed. **An advocate should confirm each** — whether the missing affidavit is a
genuine gap, or correctly omitted for that forum/format.

### 3a. Has a verification clause only (may or may not suffice)
`consumer_complaint`, `divorce_contested`, `divorce_mutual_first`, `dv_application`,
`execution_application`, `injunction`, `judicial_separation`, `mact_claim`,
`maintenance`, `permanent_injunction`, `restitution_conjugal_rights`,
`succession_certificate`, `succession_grant`, `summary_suit`, `writ_petition`

### 3b. No affidavit AND no verification clause (higher concern)
`caveat`, `contempt_petition`, `divorce_mutual_second`, `indigent_application`,
`o39_r2a_application`, `special_leave_petition`, `transfer_petition`, `urgent_petition`,
`writ_criminal`

> For writ petitions, SLP, contempt, and transfer petitions (3b), a supporting affidavit
> is normally **mandatory** — these are the ones to look at first.

## Questions for the advocate

1. For each doc-type in §3, is a supporting affidavit required? If so, it must be
   **authored into that host's gold template** (see the template authoring guide — the
   affidavit block is the host author's responsibility, not a shared component).
2. Is `surety_affidavit`'s partial block (§2) sufficient, or should it carry the full
   deponent-competence block?
3. Where a verification clause exists (§3a), does it satisfy the requirement, or is a
   separate affidavit also needed?

## Note on remediation

Because the engine has no affidavit-composition mechanism, fixing this is **per host
template**: whoever authors a host's gold template writes the affidavit block into it
directly, and that host's golden fidelity test asserts the block is present and
populated. There is no shared-component fix to make.
