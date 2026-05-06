/**
 * LexDraft Tailwind preset.
 *
 * The design system is driven by CSS custom properties defined in
 * apps/web/src/styles/tokens.css and tokens-v2.css. This preset exposes those
 * tokens as Tailwind color/spacing/font keys so utility classes pick up theme
 * + version switches automatically.
 */
const cssVar = (name) => `var(--${name})`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        bg: cssVar('bg'),
        surface: cssVar('surface'),
        'surface-2': cssVar('surface-2'),
        text: cssVar('text'),
        'text-strong': cssVar('text-strong'),
        muted: cssVar('muted'),
        action: cssVar('action'),
        'action-ink': cssVar('action-ink'),
        gold: cssVar('gold'),
        cobalt: cssVar('cobalt'),
        sage: cssVar('sage'),
        amber: cssVar('amber'),
        vermillion: cssVar('vermillion'),
        border: cssVar('border'),
        'border-strong': cssVar('border-strong'),
      },
      fontFamily: {
        display: ['var(--display)'],
        body: ['var(--body)'],
        ui: ['var(--ui)'],
        mono: ['var(--mono)'],
      },
      spacing: {
        gap: 'var(--gap)',
        row: 'var(--row)',
        pad: 'var(--pad)',
      },
      boxShadow: {
        lift: 'var(--shadow-lift)',
      },
    },
  },
  plugins: [],
};
