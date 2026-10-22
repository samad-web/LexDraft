# Importing drafting formats

Add a doc type without writing a pipeline: from the **LAWE forms library**
(<https://www.lawe.co.in/lawe-downloads.html>) or from an **advocate's own format**
(PDF, scan/photo, Word, text). The importer reads the format with Claude, rebuilds it
as a house-style `.docx` template with `{{ placeholders }}`, and registers it as a
data-driven doc type. It then drafts from case content like any built-in: the intake
reads its fields from `GET /v1/doc-types` and fills them from the matter.

## Setup (once)

```bash
cd lexdraft-engine
pip install -e ".[import]"     # anthropic SDK — only the importer needs it
```

The API key is read from `ANTHROPIC_API_KEY`, else from `../LexDraft/apps/api/.env`.

## Commands

| Command | What it does |
|---|---|
| `python tools/import_format.py lawe-status` | Every form the LAWE site lists, and what drafts it (covered / imported / NEW). |
| `python tools/import_format.py lawe-import` | Imports every NEW LAWE form. A form that turns out to duplicate an existing doc type is recorded as covered, not imported. `--dry-run` previews; `--only "Folder/File.pdf"` limits to one. |
| `python tools/import_format.py file PATH [--title T]` | Imports an advocate's own format. |
| `python tools/import_format.py list` / `show SLUG` | Imported formats, status, review notes. |
| `python tools/import_format.py approve SLUG --reviewer "Adv. Name"` | Marks the format advocate-approved (drops the "not yet approved" marker). |
| `python tools/import_format.py rebuild SLUG [--force]` | Rebuilds the template from `templates/imported/specs/SLUG.json` after a hand fix. |
| `python tools/import_format.py remove SLUG` | Deletes an imported format. |

After `lawe-import`, `file`, `approve` or `remove`, **restart `pnpm dev`** so the engine
and API pick the change up.

## Review before relying on a format

**Production serves only approved formats.** A format awaiting approval is hidden
by the engine (and therefore from the Draft page) unless the engine runs with
`LEXDRAFT_IMPORTS_SERVE_PENDING=true` — which only the local `pnpm dev` launcher sets.
In local dev, every draft of a pending format carries, above the usual review banner:

> [IMPORTED FORMAT — transcribed automatically from …; not yet approved by an advocate. …]

until `approve` is run. `show SLUG` lists what to check: `corrections` (typos fixed in
the source), `law_updates` (repealed-code citations replaced, e.g. CrPC → BNSS) and
`uncertain` (points the transcriber was unsure of). To fix wording, either edit
`templates/imported/specs/SLUG.json` and `rebuild SLUG --force`, or open
`templates/imported/SLUG.docx` in Word and follow the template authoring guide.

## Advocates' own formats (in the app)

Advocates don't use this tool: on the Draft page, **Choose a format → Upload a
format** reads their PDF / scan / photo / Word file, shows a preview to check, and
saves it (approved) for their firm only. Those formats are stored by the API
(`firm_engine_formats`, migration 0091) and sent to the engine with each draft
(`POST /v1/draft-spec`); the engine keeps no per-firm state. This tool is for
formats every firm should get (LAWE, standard court forms).

## Safety rails

- An imported format can never replace or shadow a built-in doc type (same slug or
  title → skipped). Built-in doc types, their templates and their tests are untouched.
- A transcription whose placeholders don't match its declared fields, or whose
  template doesn't render cleanly with sample data, is rejected and not installed
  (its spec is saved as `specs/SLUG.rejected.json` for a hand fix).
- Missing required facts are a 422 (the intake asks for them), exactly as for built-ins.
- Downloaded LAWE PDFs are cached in `.import-cache/` (git-ignored), never committed.

## Where things live

| Path | Contents |
|---|---|
| `templates/imported/manifest.json` | One entry per imported doc type (fields, status, provenance, review notes). |
| `templates/imported/<slug>.docx` | The template. |
| `templates/imported/specs/<slug>.json` | The transcribed spec the template was built from. |
| `templates/imported/lawe_catalog.json` | Which LAWE form maps to which doc type. |
| `src/service/adapters/imported.py` | The generic adapter that registers manifest entries. |
| `src/imports/` | Manifest, template builder, transcriber, LAWE client. |

The tool also keeps the Node side in step: it upserts imported entries (tagged
`"imported": true`) into `packages/types/src/data/engine-doc-contract.json` and their
titles into the alignment baseline. `apps/api/src/lib/engine-field-map.ts` routes
every `imported` entry by its title, so no hand edit is needed there.
