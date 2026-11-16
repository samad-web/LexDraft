# Drafting in Indian languages

Status: built and tested locally 2026-11-16 (approved same day: 11 languages + English, AI translation + checks, HC/SC blocked). Not deployed.

## Purpose
Advocates in district courts, tribunals and police and revenue offices file in the state language. Today DifAi drafts properly only in English:
- **Draft box:** offers English, Hindi and Tamil only (`DraftBotModal.tsx:138`).
- **Built-in formats:** a fixed glossary (`engine/components/tamil.py`, `hindi.py`) swaps known stock phrases. It covers mainly the vakalatnama and proof affidavit; everything else stays English.
- **AI-written content:** the open-drafting path and the composed body of a petition ignore the language entirely. The result is Tamil headings over an English body.
- **PDF fonts:** the API image has Noto fonts only for Tamil and Devanagari. Other scripts print as empty boxes.

## Scope
- Languages (proposed): Hindi, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Bengali, Punjabi, Odia, Assamese, plus English.
- Out of scope:
  - Urdu: right-to-left layout needs its own page direction and table work, so it comes later.
  - Bilingual side-by-side drafts.
  - Translating the user interface.

## Legal constraint (Art. 348; Official Languages Act)
High Courts and the Supreme Court work in English. The state language applies in subordinate courts, tribunals, notices, deeds and affidavits under state rules.

Decision (user, 2026-11-16): **blocked**. When the document is for a High Court or the Supreme Court (named in its heading), it is not translated, and a note says filings there must be in English.

## Architecture
1. **One language list:** `lib/languages.ts` already lists the 22 scheduled languages. The Draft box, API (`language` enum) and engine all take the same codes (EN, HI, TA, TE, KN, ML, MR, GU, BN, PA, OR, AS).
2. **One translation step for every draft** (decided while building; it replaces writing directly in the language): the draft is finished in English, so every existing check (invented facts, citations, amounts) still runs on English text. The last step (`services/draft-translate.service.ts`, called by `finishIntake` in `drafting.routes.ts` for all 8 intake responses) translates the lines in batches of 25, with 4 calls at once. It writes them back into the court .docx through engine apply-edits, line for line, so layout and tables are unchanged. The engine now always renders English; the old glossary (`tamil.py`, `hindi.py`) is no longer called.
   - The language is saved with the matter (`__draftLanguage` in the intake state), so reopening, follow-up instructions and live edits stay in that language.
   - Translated lines are cached per document, so a live edit sends only the changed lines.
   - Charged once per document and language (`revise` credits, ref `translate:<matter>:<doc>:<lang>`).
3. **Built-in formats:** the engine renders the English document as today, then translates its text in place, keeping the layout, tables and fonts. This uses the same model as drafting, in batches of runs, with a per-language legal glossary (the existing Tamil and Hindi lists seed it).
   - The glossary-only path stays as the offline fallback for Tamil and Hindi.
   - The invariants check below runs after the translation.
4. **Invariants check** (no AI), run after every translation. Every number, date, amount, citation, section, party name and `[placeholder]` in the English source must appear unchanged in the output.
   - If any is missing, it retries once. After that the advocate gets the English document with a note, never a silently wrong translation.
5. **Fonts:** add `font-noto-{telugu,kannada,malayalam,bengali,gujarati,gurmukhi,oriya}` to the API image (Assamese uses the Bengali script). The Word output sets each run's complex-script font, so Word on the advocate's PC shows the right script.
6. **AI credits:** a translated built-in format costs one extra AI pass, charged like a redraft. AI-written drafts cost the same as English.
7. **Testing:** runs only through the Claude Code dev route (no API key).

## Impact map
| Area | Risk |
|---|---|
| `DraftBotModal.tsx` picker, `drafting.routes.ts` enum, `intake.service.ts`, `engine-client.service.ts` | The enum widens; old EN/HI/TA values must keep working |
| `open-draft.service.ts`, `intake-compose.service.ts` prompts | Checks that look for English phrases (PRAYER, "it is prayed") must still detect sections in other languages |
| Citation / particulars / invented-fact checks | Must run on numbers and citations, which stay in English digits |
| Engine `app.py` language branch, `tamil.py`, `hindi.py`, `tidy.py` | Layout must survive translation; tidy number formats stay in Latin digits |
| `apply_edits` / `splice_lines` | Edits on translated documents map by line, unchanged |
| `apps/api/Dockerfile` fonts | Bigger image; LibreOffice PDF must render each script |
| AI credits (`lib/credit-costs.ts`) | New charge for translating built-in formats |
| Evidence tables | Table headings are translated, rows stay rows |

## Edge cases
- Mixed input (facts typed in Tamil, document asked for in English, or the other way round) → the output follows the picker.
- A name with no native spelling → kept as typed.
- Numbers in native digits (௧௨௩) → never produced; Latin digits only, the practice in Indian courts.
- A long document → translated in batches; one failed batch → English kept for that batch, with a note.
- An unsupported language code → English, with a note.

## Acceptance criteria
1. For each language, an open-drafting written statement and a built-in s.138 complaint come out fully in that language: headings, body, prayer and verification. Numbers, dates, citations and placeholders are unchanged.
2. The Word and PDF output show the right script with no boxes, for all 11 languages.
3. The invariants check catches a changed amount and keeps the English document.
4. English drafts are unchanged (regression).
5. Choosing a High Court or Supreme Court forum in a regional language shows the English-filing warning.
