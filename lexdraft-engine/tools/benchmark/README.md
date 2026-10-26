# Drafting benchmark

Blind, like-for-like comparison of drafting tools on the same fictional matters.

1. For each case in `cases.json`, paste the `brief` **verbatim** into each tool (LexDraft, and any other tool you have an account on). Don't add extra facts or retry with hints.
2. Save each output as `<folder>/<tool>/<case_id>.docx` (or `.pdf` / `.txt`). If a tool warned or refused instead of drafting, save that message as `<case_id>.txt`.
3. Score:

   ```
   python tools/benchmark/score.py --outputs <folder>            # deterministic checks only
   python tools/benchmark/score.py --outputs <folder> --grade    # + LLM judge (ANTHROPIC_API_KEY)
   ```

   Writes `<folder>/report.md` and `<folder>/results.json`.

What it measures is in the docstring of `score.py`. Three cases are traps (`expect: "flag"`): a careful drafter must point out the planted defect rather than draft around it.

Use another tool's output only to measure it. Don't copy its wording into our templates; fix our gaps in our own language.
