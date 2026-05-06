# Monochrome Legal — UI Design System

A monochrome (white-on-black) design system for a modern legal SaaS product. Built for legibility, professionalism, and a calm, structured feel. Inspired by clean black-and-white interface designs with strong-bordered rounded cards, pill navigation, and numbered process flows.

**Use this file as the source of truth.** When implementing any UI, follow these tokens, components, and patterns exactly.

---

## 1. Design Philosophy

- **Trust through clarity.** Legal users are reading dense information under time pressure. Every layout choice should reduce friction.
- **Pure monochrome.** White on black, with a controlled gray scale. No accent color in the core UI. Status colors only where semantically necessary (success/warning/danger).
- **Legibility is non-negotiable.** Use a screen-optimized sans-serif. Body text never goes below 15px. Line height stays generous.
- **Strong, intentional borders.** Cards and inputs have visible 1px borders — not floating elevation. The look is precise, document-like.
- **Rounded but not playful.** 12–16px radius on cards, full-pill on navigation tabs and badges. Never sharp 0px corners.
- **Structured grids.** Content sits in clear columns and rows. Every page reads top-to-bottom like a well-formatted document.
- **Density balanced with breathing room.** SaaS product views can be dense. Marketing pages must breathe. Use the spacing scale accordingly.

---

## 2. Color Tokens

True black-and-white palette with a careful gray scale. The exact values are slightly softened from `#000` / `#FFF` to reduce eye strain (a known issue with pure-pure contrast on screens) while still reading as pure monochrome.

### Dark theme (default)

```css
--bg-base:        #0A0A0A;  /* page background — softened black */
--bg-surface:     #141414;  /* cards, panels */
--bg-surface-2:   #1C1C1C;  /* hover, nested surfaces */
--bg-elevated:    #232323;  /* popovers, dropdowns */
--bg-inverse:     #FAFAFA;  /* light surfaces inside dark theme */

--text-primary:   #FAFAFA;  /* near-white, primary content */
--text-secondary: #B4B4B4;  /* body text, secondary content */
--text-tertiary:  #7A7A7A;  /* metadata, captions, placeholders */
--text-disabled:  #4A4A4A;
--text-inverse:   #0A0A0A;  /* text on light surfaces */

--border-subtle:  #262626;  /* default surface borders */
--border-default: #333333;  /* card and input borders — VISIBLE */
--border-strong:  #4A4A4A;  /* hover, emphasized borders */
--border-focus:   #FAFAFA;  /* focus ring — uses primary text color */

--success:        #4ADE80;
--success-bg:     #0F2417;
--warning:        #FACC15;
--warning-bg:     #2A2410;
--danger:         #F87171;
--danger-bg:      #2A1414;
--info:           #93C5FD;
--info-bg:        #0F1A2A;
```

### Light theme

```css
--bg-base:        #FAFAFA;
--bg-surface:     #FFFFFF;
--bg-surface-2:   #F4F4F4;
--bg-elevated:    #FFFFFF;
--bg-inverse:     #0A0A0A;

--text-primary:   #0A0A0A;
--text-secondary: #525252;
--text-tertiary:  #8A8A8A;
--text-disabled:  #B4B4B4;
--text-inverse:   #FAFAFA;

--border-subtle:  #EAEAEA;
--border-default: #D4D4D4;
--border-strong:  #A3A3A3;
--border-focus:   #0A0A0A;

--success:        #16A34A;
--success-bg:     #ECFDF3;
--warning:        #CA8A04;
--warning-bg:     #FEF9C3;
--danger:         #DC2626;
--danger-bg:      #FEE2E2;
--info:           #2563EB;
--info-bg:        #DBEAFE;
```

### Usage rules

- **Never use pure `#000` or `#FFF` for large surfaces.** Use the softened values above. Pure-pure contrast causes halation/eye strain over long sessions.
- **Status colors (success/warning/danger) appear only on status indicators, badges, alerts, and form validation.** They must never appear in body text, headings, or decorative elements.
- **No brand accent color.** This is intentional. The product reads as serious and document-like. The only "color" beyond gray scale comes from semantic status.

---

## 3. Typography

### Font families

```css
--font-sans:    'Inter', 'Geist', system-ui, -apple-system, sans-serif;
--font-display: 'Inter Display', 'Inter', system-ui, sans-serif;
--font-serif:   'Source Serif 4', 'Source Serif Pro', Georgia, serif;  /* marketing/long-form only */
--font-mono:    'JetBrains Mono', 'Geist Mono', ui-monospace, monospace;
```

**Why Inter:** Inter is engineered for screens. It has excellent legibility at small sizes, a tall x-height, and unambiguous letterforms (clearly distinguishes `1`, `l`, `I` — important when displaying legal references and case numbers).

**Where each font is used:**
- **Inter / Inter Display** — Everywhere in the product UI. Default for marketing too.
- **Source Serif 4** — Only on marketing long-form (blog posts, legal articles, terms of service display). Never in the product app.
- **JetBrains Mono** — Case numbers, citations, document IDs, code-like data.

### Type scale

| Token       | Size  | Line height | Letter spacing | Weight | Usage                          |
|-------------|-------|-------------|----------------|--------|--------------------------------|
| `display-xl`| 64px  | 1.05        | -0.025em       | 600    | Marketing hero headlines       |
| `display-lg`| 48px  | 1.1         | -0.02em        | 600    | Section headlines              |
| `display-md`| 36px  | 1.15        | -0.02em        | 600    | Sub-section headlines          |
| `heading-xl`| 28px  | 1.25        | -0.015em       | 600    | Page titles in product         |
| `heading-lg`| 22px  | 1.3         | -0.01em        | 600    | Section headings, modal titles |
| `heading-md`| 18px  | 1.4         | -0.005em       | 600    | Card titles                    |
| `heading-sm`| 15px  | 1.4         | 0              | 600    | Small headings, table headers  |
| `body-lg`   | 17px  | 1.6         | 0              | 400    | Lead paragraphs                |
| `body-md`   | 15px  | 1.6         | 0              | 400    | Default body text              |
| `body-sm`   | 13px  | 1.5         | 0              | 400    | Captions, metadata, table rows |
| `body-xs`   | 12px  | 1.4         | 0              | 500    | Timestamps, fine print         |
| `eyebrow`   | 12px  | 1.4         | 0.08em         | 600    | UPPERCASE section labels       |
| `mono-md`   | 14px  | 1.5         | 0              | 400    | Case numbers, IDs (mono font)  |

### Typography rules

- **Body text minimum: 15px.** This is firm. Legal users read for long stretches.
- **Line height for body: 1.6.** Generous. Helps long-form scanning.
- **Negative letter spacing on display sizes only.** Headlines tighten up; body stays at 0.
- **Use weight, not color, for hierarchy.** Bold (600) headings, regular (400) body. Avoid setting headings in tertiary text color.
- **No italic by default.** Reserve italic for legal citations (e.g., case names: *Smith v. Jones*) — that's the single canonical use of italic in this system.
- **Numbers in tabular contexts use `font-variant-numeric: tabular-nums`.** Keeps columns aligned in tables.

---

## 4. Spacing Scale

4px base unit. Use these values only.

```
space-0:  0px
space-1:  4px
space-2:  8px
space-3:  12px
space-4:  16px
space-5:  20px
space-6:  24px
space-7:  32px
space-8:  40px
space-9:  48px
space-10: 64px
space-11: 80px
space-12: 96px
space-13: 128px
```

**Application:**
- Card internal padding: `space-6` (24px) for product cards, `space-9` (48px) for marketing cards
- Form field vertical gap: `space-4` (16px)
- Section vertical padding: `space-12` to `space-13` (96–128px) for marketing, `space-7` (32px) for product
- Table row padding: `space-3` vertical, `space-4` horizontal

---

## 5. Border Radius

```
radius-sm:   6px    /* small inputs, tags */
radius-md:   10px   /* buttons, default inputs */
radius-lg:   14px   /* cards */
radius-xl:   20px   /* featured cards, large modals */
radius-full: 9999px /* pills, badges, avatar, nav tabs */
```

**The signature look:** rounded but precise. Default cards at 14px; pill-shaped navigation tabs and status badges at full-radius.

---

## 6. Borders & Elevation

This system relies on **borders, not shadows**. Cards are defined by visible 1px borders against the surface, not by floating elevation.

```css
--border-card:    1px solid var(--border-default);
--border-input:   1px solid var(--border-default);
--border-divider: 1px solid var(--border-subtle);

--shadow-popover: 0 8px 24px rgba(0,0,0,0.4);  /* dropdowns, popovers only */
--shadow-modal:   0 24px 64px rgba(0,0,0,0.6); /* modal overlays only */
```

Cards in dark theme do NOT use shadows. Cards in light theme may use a single very subtle shadow (`0 1px 2px rgba(0,0,0,0.04)`) — but borders still do the heavy lifting.

---

## 7. Components

### Button

All buttons: `radius-md`, `space-3` vertical / `space-5` horizontal padding, `body-md` size, `font-weight: 500`, transition 150ms.

**Primary** — white filled, black text:
```
background: var(--text-primary)
color: var(--bg-base)
border: 1px solid var(--text-primary)
hover: background var(--text-secondary) (slight darken)
```

**Secondary** — outlined, transparent:
```
background: transparent
color: var(--text-primary)
border: 1px solid var(--border-default)
hover: border-color var(--border-strong), background var(--bg-surface)
```

**Ghost** — no border, hover surface:
```
background: transparent
color: var(--text-secondary)
border: 1px solid transparent
hover: background var(--bg-surface), color var(--text-primary)
```

**Destructive** — outlined, danger color:
```
color: var(--danger)
border: 1px solid var(--danger)
hover: background var(--danger-bg)
```

Sizes: `sm` (32px tall), `md` (40px tall — default), `lg` (48px tall).

### Pill Navigation (signature pattern from image 2)

A horizontal row of tabs inside a pill-shaped container. Used for primary section navigation.

```
container:
  background: var(--bg-surface)
  border: 1px solid var(--border-default)
  border-radius: var(--radius-full)
  padding: var(--space-1)
  display: inline-flex

each tab:
  padding: var(--space-2) var(--space-5)
  border-radius: var(--radius-full)
  font-size: 14px
  color: var(--text-secondary)

active tab:
  background: var(--text-primary)
  color: var(--bg-base)

inactive hover:
  color: var(--text-primary)
```

### Card

```
background: var(--bg-surface)
border: 1px solid var(--border-default)
border-radius: var(--radius-lg)
padding: var(--space-6)
```

**Featured / numbered card** (image 2 timeline pattern):
- Add a small numbered badge in the top-left corner: a circle, `radius-full`, 28px diameter, `var(--bg-base)` background, 1px white border, white number inside.
- Card title sits to the right of or below the number badge.

### Input & Form Field

```
background: var(--bg-surface)
border: 1px solid var(--border-default)
border-radius: var(--radius-md)
padding: var(--space-3) var(--space-4)
height: 40px
color: var(--text-primary)
font-size: 15px

placeholder color: var(--text-tertiary)

focus:
  border-color: var(--border-focus)
  outline: 2px solid rgba(255,255,255,0.1)
  outline-offset: 1px

error:
  border-color: var(--danger)
```

**Label**: `body-sm`, `font-weight: 500`, `var(--text-secondary)`, sits above the input with `space-2` gap.
**Helper text**: `body-xs`, `var(--text-tertiary)`, sits below the input.
**Error text**: `body-xs`, `var(--danger)`, replaces helper text on error.

### Search bar (image 2 pattern)

A wider, pill-shaped input with a search icon on the left and optional voice/filter icons on the right. Use `radius-full`, full-width, `bg-surface` background, `border-default` border.

### Status Badge

Compact pills used to communicate document/case status. `radius-full`, `space-1` vertical / `space-3` horizontal, 12px text, weight 500.

| Status     | Background          | Text color       | Example uses                    |
|------------|---------------------|------------------|----------------------------------|
| Neutral    | `bg-surface-2`      | `text-secondary` | Draft, Archived                 |
| Info       | `info-bg`           | `info`           | In Review, Pending              |
| Success    | `success-bg`        | `success`        | Approved, Filed, Signed         |
| Warning    | `warning-bg`        | `warning`        | Action Required, Due Soon       |
| Danger     | `danger-bg`         | `danger`         | Overdue, Rejected, Failed       |

### Data Table

Critical component for legal SaaS (case lists, document lists, billing).

```
container:
  border: 1px solid var(--border-default)
  border-radius: var(--radius-lg)
  overflow: hidden

header row:
  background: var(--bg-surface-2)
  font-size: 13px
  font-weight: 600
  color: var(--text-secondary)
  text-transform: uppercase
  letter-spacing: 0.04em
  padding: var(--space-3) var(--space-4)
  border-bottom: 1px solid var(--border-default)

data row:
  padding: var(--space-4)
  border-bottom: 1px solid var(--border-subtle)
  font-size: 15px
  color: var(--text-primary)

hover row:
  background: var(--bg-surface-2)

last row: no border-bottom
```

Use `tabular-nums` on number/date columns. Right-align numeric columns.

### Sidebar Navigation (product app)

Fixed left sidebar, 240px wide, `bg-base` background, `border-right: 1px solid var(--border-subtle)`.

- Logo at top, `space-6` padding
- Nav items: `space-3` padding, `radius-md`, `body-md`, `text-secondary` color
- Active nav item: `bg-surface` background, `text-primary` color, optional 2px left border in `text-primary`
- Section headers between nav groups: `eyebrow` style, `text-tertiary`

### Numbered Process Flow (image 3 pattern)

For marketing pages explaining "how it works":

- Each step is a card (`radius-lg`, default card styling)
- Number badge in the top-right corner of each card (28px circle, `bg-base` background, 1px border)
- Cards arranged in a staggered or zigzag layout
- Connect with **dotted lines** (`border: 1px dashed var(--border-strong)`) between cards
- Each card: `eyebrow` "STEP 0X" + `heading-md` title + `body-md` description

### Modal / Dialog

```
overlay: rgba(0,0,0,0.6) with backdrop-filter blur(4px)
container:
  background: var(--bg-elevated)
  border: 1px solid var(--border-default)
  border-radius: var(--radius-xl)
  padding: var(--space-7)
  max-width: 480px (default), 640px (wide), 800px (extra-wide)
  shadow: var(--shadow-modal)
```

### Eyebrow + Heading pattern

```html
<div class="section-header">
  <span class="eyebrow">Case Management</span>
  <h2 class="heading-xl">Active matters</h2>
  <p class="body-md text-secondary">Track cases, deadlines, and assignments across your firm.</p>
</div>
```

The eyebrow is uppercase, letter-spaced, in `--text-tertiary`. No accent color.

---

## 8. Layout Patterns

### Marketing hero

- Full-width, ~80vh tall, `bg-base`
- Pill navigation centered at top
- Eyebrow label
- `display-xl` headline (no italic — keep it serious)
- `body-lg` lead paragraph, max-width 60ch, `text-secondary`
- Primary + ghost button
- Optional: small "trusted by" logo strip at the bottom of the hero, in `text-tertiary`

### Product app shell

- Left sidebar (240px) — primary navigation
- Top bar (56px tall) — breadcrumbs on the left, search in the middle, user menu on the right; `bg-base` with `border-bottom: 1px solid var(--border-subtle)`
- Main content area — `bg-base`, `space-7` padding

### Three-column feature grid (marketing)

- 3 cards in a row on desktop, 1 column on mobile
- Each card: small icon, `heading-md` title, `body-md` description, ghost "learn more →" link
- Card uses default styling

### Numbered timeline (image 2 pattern)

- 6 cards in a 3×2 grid (desktop), 1 column on mobile
- Each card: number badge top-left, `heading-sm` title (the era/phase), `body-sm` description
- Cards have visible borders, no shadows
- Used for: "Our process," "Implementation timeline," "Compliance phases"

### Stats row

- 3–4 metrics displayed across a row
- Each: `display-md` number (in `text-primary`), `body-sm` label below in `text-secondary`
- Vertical dividers between (`border-subtle`)

### Two-column with image

- Left: text content (eyebrow + headline + body + CTA)
- Right: image or product screenshot in a card with `radius-xl` and 1px border
- 60/40 or 50/50 split

---

## 9. Iconography

- Use **Lucide** icons (lucide.dev) — they match Inter aesthetically (geometric, screen-optimized).
- Default size: 16px in inline contexts, 20px in buttons, 24px in cards.
- Stroke width: 1.5 (slightly lighter than Lucide default of 2 for a more refined feel).
- Icons inherit `currentColor` — they always match their text color, never use independent coloring.

---

## 10. Accessibility

- **Contrast ratios:** All text must meet WCAG AA (4.5:1 for body, 3:1 for large text). The token combinations above are pre-verified.
- **Focus rings:** Every interactive element has a visible focus ring (`outline: 2px solid rgba(255,255,255,0.1)` over the border-focus color). Never remove focus indicators.
- **Tap targets:** Minimum 40px × 40px on mobile.
- **Reduced motion:** Respect `prefers-reduced-motion` — disable transitions and animations.
- **Form errors:** Always communicated by both color AND an icon AND text — never color alone.

---

## 11. Do / Don't

✅ **Do:**
- Stick to the gray scale; let semantic colors handle status only
- Use Inter for everything in the product UI
- Use visible 1px borders on cards instead of shadows
- Keep body text at 15px or 17px with 1.6 line height
- Use pill-shaped navigation tabs and full-radius status badges
- Use `tabular-nums` on every number in a table
- Use italic only for case names and legal citations

❌ **Don't:**
- Add a brand accent color "for personality"
- Use pure `#000` or `#FFF` on large surfaces
- Use serif font in the product app
- Stack multiple shadows on cards in dark mode
- Drop body text below 15px
- Use color alone to signal status — pair with icon + text
- Use 0px sharp corners

---

## 12. Implementation Hints (for Claude Code)

When building components:

1. Define all tokens above as CSS custom properties on `:root` (dark) and `[data-theme="light"]`. Allow theme switching via the `data-theme` attribute on `<html>`.
2. If using Tailwind, extend `theme.extend` with these tokens. Add `tabular-nums` as a utility.
3. Load Inter from Google Fonts or rsms.me/inter. Use the variable font with weights 400, 500, and 600. Enable the `cv11` and `ss03` OpenType features for better legibility (`font-feature-settings: 'cv11', 'ss03'`).
4. Build in this order: tokens → typography → buttons → inputs → cards → tables → navigation (pill, sidebar) → page shells.
5. Every product page uses the app shell from section 8. Every marketing page starts with the hero pattern.
6. Default theme is dark. Implement light theme from day one — don't bolt it on later.
7. Ship a `<StatusBadge variant="success|warning|...">` component early; it's used everywhere in legal SaaS.

---

**End of spec.** Hand this entire file to Claude Code along with whatever specific component or page you want built. Reference sections by number when iterating (e.g., "build a case-list table per section 7's Data Table pattern, with status badges from the same section").
