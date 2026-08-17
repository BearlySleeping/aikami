// packages/frontend/theme/src/index.ts
//
// Aikami brand palette constants (C-418 Feature A).
//
// The CSS source of truth lives in this package:
//   - src/lib/brand_tokens.css — plain custom properties (site, docs)
//   - src/lib/brand_daisy.css  — daisyUI --color-* tokens (client, hub)
//
// These constants mirror those files for TS consumers (documentation,
// tooling, inline styles). Keep them in sync with the CSS files.

/** Light-theme brand palette values (oklch). */
export const brandPaletteLight = {
  brand: 'oklch(0.52 0.22 285)',
  brandSoft: 'oklch(0.72 0.16 285)',
  slate: 'oklch(0.25 0.01 260)',
  slateLight: 'oklch(0.45 0.01 260)',
  obsidian: 'oklch(0.12 0.01 260)',
  ember: 'oklch(0.62 0.18 48)',
  rune: 'oklch(0.58 0.2 285)',
  parchment: 'oklch(0.92 0.03 85)',
  background: 'oklch(0.985 0.006 270)',
  foreground: 'oklch(0.18 0.03 270)',
  primary: 'oklch(0.25 0.05 270)',
  primaryForeground: 'oklch(0.985 0.006 270)',
  muted: 'oklch(0.94 0.01 270)',
  mutedForeground: 'oklch(0.45 0.03 270)',
  border: 'oklch(0.87 0.01 270)',
  ring: 'oklch(0.52 0.22 285)',
} as const;

/** Dark-theme brand palette values (oklch). */
export const brandPaletteDark = {
  brand: 'oklch(0.54 0.22 285)',
  brandSoft: 'oklch(0.78 0.14 285)',
  slate: 'oklch(0.32 0.01 260)',
  slateLight: 'oklch(0.48 0.01 260)',
  obsidian: 'oklch(0.14 0.01 260)',
  ember: 'oklch(0.65 0.18 48)',
  rune: 'oklch(0.65 0.22 285)',
  parchment: 'oklch(0.85 0.04 85)',
  background: 'oklch(0.13 0.015 260)',
  foreground: 'oklch(0.9 0.01 270)',
  primary: 'oklch(0.9 0.01 270)',
  primaryForeground: 'oklch(0.13 0.015 260)',
  muted: 'oklch(0.2 0.02 260)',
  mutedForeground: 'oklch(0.65 0.03 270)',
  border: 'oklch(0.24 0.02 260)',
  ring: 'oklch(0.54 0.22 285)',
} as const;
