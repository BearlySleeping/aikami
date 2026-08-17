// packages/frontend/theme/src/index.ts
//
// Aikami brand palette (C-418 Feature A).
//
// The CSS source of truth lives in this package:
//   - src/lib/brand_tokens.css — plain custom properties (site, docs)
//   - src/lib/brand_daisy.css  — daisyUI --color-* tokens (client, hub)
//
// There are intentionally NO TS palette constants here: the palette is
// declared exactly twice (daisy form + tokens form) and both CSS files are
// the source of truth. A third, hand-synced TS copy would drift (it already
// did once — M6). Consumers that need a palette value in TS should read the
// CSS custom property at runtime (getComputedStyle) or add a build-time
// extraction that derives from these files.
export {};
