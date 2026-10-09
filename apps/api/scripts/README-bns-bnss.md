# BNS / BNSS corpus ingestion

Loads the full **Bharatiya Nyaya Sanhita (BNS, 2023)** and **Bharatiya Nagarik
Suraksha Sanhita (BNSS, 2023)** into the indiacode-rag laws corpus so the
drafting engine can ground and cite against the *entire* code — not the ~5% the
hand-curated `offence-kb.json` / `procedure-kb.json` cover today.

## Why this exists

An advocate tried to generate an **exemption-from-personal-appearance
application (old CrPC §317 → now BNSS §355)** and the drafter failed — because
that document type, and that section, simply aren't in the drafting KB. The
durable fix is corpus coverage of the whole BNS + BNSS, so any section the agent
needs is retrievable and citable.

**BNS = 358 sections. BNSS = 531 sections. Total = 889.**

## The non-negotiable rule: no AI-generated law

Every section's text comes from the **official gazette / IndiaCode**, never from
a language model. A hallucinated statute is the exact failure this product
exists to prevent, and one that has drawn cost sanctions and quashed orders
against Indian advocates. Accordingly:

- `fetch-bns-bnss.ts` will **not** fabricate text. Without a wired official
  source it stops with an error.
- Rows carry `verified`. The ingest tags anything not `verified: true` as
  **needs-review**, and the drafting layer must never emit a needs-review
  section as a hard citation (same rule as `offence-kb`).

## Prerequisites

| Env var | Purpose | Needed for |
|---|---|---|
| `LAWS_DATABASE_URL` | the indiacode-rag corpus DB | actual ingest (writes) |
| `EMBED_SERVICE_URL` | BGE-M3 embed FastAPI (1024-d) | embedding (also `--dry-run`) |
| `EMBED_API_KEY` | embed auth (if the service requires it) | optional |

Neither is set in this repo's `.env` by default — the corpus lives in a
separate project. Set them to point at your corpus + embedder before a real run.

## Procedure

**1. Produce the source file** (all 889 sections) from the official source:

```bash
# Wire the parser for your chosen official format first (see "Source parser").
pnpm --filter @lexdraft/api fetch:bns-bnss --source <IndiaCode-PDF-or-XML>
pnpm --filter @lexdraft/api fetch:bns-bnss --check      # validate completeness
```

`--check` fails loudly if the file is short of 358/531, has duplicates, empty
text, or any placeholder/AI-looking text.

**2. Ingest into the corpus:**

```bash
pnpm --filter @lexdraft/api ingest:bns-bnss --dry-run    # parse+embed, no writes
pnpm --filter @lexdraft/api ingest:bns-bnss              # full ingest
pnpm --filter @lexdraft/api ingest:bns-bnss --act BNSS   # one sanhita
```

The ingest is **idempotent** — it replaces each act's chunks inside a
transaction, so re-running never duplicates. It writes only the two acts it owns
(BNS, BNSS) and never touches other acts in the shared corpus. It discovers the
live `chunks` columns from `information_schema` and adapts, failing loudly if
the required `acts(id, short_title)` / `chunks(id, act_id, content)` columns are
absent.

**3. Verify the drafter now grounds BNS/BNSS:**

```bash
pnpm --filter @lexdraft/api eval:cite     # if present on this branch
```

## Try it now without the corpus (seed)

A 6-row, gazette-checked seed (`data/bns-bnss-sections.sample.json`) — including
the **BNSS 355 exemption** that failed — lets you exercise the pipeline
end-to-end today:

```bash
pnpm --filter @lexdraft/api ingest:bns-bnss --sample --dry-run
```

(Stops at the embed step until `EMBED_SERVICE_URL` is set — that's the guard
working, not a bug.)

## Source parser

`fetch-bns-bnss.ts` implements `parseBns()` — validated against the real
IndiaCode bitstream text, **358/358 sections, zero duplicates, zero
placeholder text**. Run it with `--act BNS --source <path-or-url>`.

`--act BNSS` is **not implemented yet** — see the large comment at its call
site in `fetch-bns-bnss.ts` for the full diagnosis. Short version: BNSS's
gazette text is typeset in two columns (body text left, marginal section
headings right), and `pypdf`/`pdf-parse` extract that column-blind — the
headings land in a disconnected trailing block, not next to their section.
A correct parser needs `pdfjs-dist` glyph-coordinate extraction to
reconstruct true reading order, which is materially more work than the BNS
regex above and hasn't been validated yet.

**Known-good sources** (fetched and inspected while building the BNS parser):

- **BNS**: `https://www.indiacode.nic.in/bitstream/123456789/20062/1/a202345.pdf`
  — works today with `--act BNS`.
- **BNSS**: the enacted Act (not the bill!) is at
  `https://prsindia.org/files/bills_acts/acts_parliament/2023/The%20Bharatiya%20Nagarik%20Suraksha%20Sanhita,%202023.pdf`
  (249 pages, genuine Gazette of India text — two-column). **Do not** use the
  PRS `bills_parliament/2023/...` path — that's the 9-page bill-as-introduced,
  not the final 531-section Act. The NCRB mirror
  (`ncrb.gov.in/.../BNSS2023.pdf`) is also real text but has a different,
  non-gazette layout (an old-CrPC/new-BNSS comparison table up front) — not
  recommended as the primary source.
- IndiaCode's own BNSS bitstream URLs (`123456789/20099` and `123456789/21544`)
  timed out repeatedly when this was last tried — may be transient; retry
  before assuming they're gone.

Either way, the parser must emit one row per section with **verbatim** text
and `verified: false` until a human checks it against the PDF — no
AI-generated or inferred statute text, ever.

## Files

- `data/bns-bnss-sections.sample.json` — reviewed 6-row seed (tracked)
- `data/bns-bnss-sections.json` — full 889-section file (produced by fetch; untracked/large)
- `fetch-bns-bnss.ts` — official-source → source JSON (+ `--check` validator)
- `ingest-bns-bnss.ts` — source JSON → corpus (chunk → embed → idempotent upsert)
