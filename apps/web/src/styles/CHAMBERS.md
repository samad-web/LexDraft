# Chambers design

The app's design (2026-10-30). Every screen except the marketing landing page
(`/`) uses it: `<html data-ui="chambers">` is set by `lib/chambers.ts`.

## Rules

- **Strictly black and white.** Greys only. The one colour is red, and only
  as a button that names a mandatory issue (a limitation due, an objection to
  cure, a hearing today with no advocate): `.btn-danger` or `.adv-alert-btn`.
  No coloured text, dots, pills or tints anywhere else. Status is shown with
  weight, ink-filled pills, outlines and icons.
- **Light and dark must both look right.** Use tokens only, never hex values:
  `--bg-base` (grey canvas), `--bg-surface` (cards), `--bg-surface-2` (washes,
  hover), `--bg-elevated` (popovers and dialogs), `--text-primary` /
  `--text-secondary` / `--text-tertiary`, `--border-subtle` / `--border-default`
  / `--border-strong`, `--shadow-card` / `--shadow-raised` / `--shadow-popover`,
  `--radius-sm` (8) / `--radius-md` (10) / `--radius-lg` (16) / `--radius-xl` (22).
- **Type.** `--font-title` (Source Serif 4) for page titles, card or section
  titles that name a thing (a matter, a client, a report), and headline
  figures (₹ amounts, counts). Inter (`--font-sans`) for everything else.
  Avoid `.mono` for labels; keep it for real codes (CNR, invoice numbers,
  times). Small uppercase labels: 11px, weight 600, letter-spacing 0.1em,
  `--text-tertiary`.
- **Layout.** Use the shared pieces: `PageHeader`, `.card`, `.tbl` (it turns
  into stacked cards on phones automatically), `.btn` / `.btn-primary` /
  `.btn-sm` / `.btn-ghost`, `.input`, `.chip`, `.badge`, `PillNav`,
  `EmptyState`, `Modal` with `Field`. At most one `.btn-primary` per area.
- **Responsive.** Phone = 360-767px (bottom dock; content padding 16px),
  tablet = 768-1023px (72px icon rail), desktop = 1024px and up. Nothing may
  scroll sideways at any width. Tap targets are 40px or more on phones. Grids
  collapse to one column on phones. Wide, data-dense views may scroll inside
  their own box, never the page.
- **Feel.** Calm, confident, editorial: generous whitespace, hairline
  borders, one clear primary action, real hierarchy (title, then key figure,
  then detail). No gradients, emoji or decorative colour.

## Where styles go

- `styles/chambers.css`: tokens, shell and shared components. Edit with care.
- `styles/chambers/<group>.css`: one file per feature group (case, court,
  clients, ai, firm). Loaded last, so they win ties. Scope every rule with
  `[data-ui='chambers']` plus a class on the view's root element.
- Base primitives in globals.css read CSS variables (`--btn-*`, `--input-*`,
  `--card-*`, `--th-*`). Override those variables rather than the classes.

## Checking

Use the screenshot harness `scratchpad/harness/shoot.mjs`. It needs the dev
server on :5173 and a mocked API, so it writes nothing anywhere.
