// packages/frontend/theme/src/index.ts
//
// Aikami brand palette + UI component layer (C-418 Feature A, daisyUI
// removal).
//
// The CSS source of truth lives in this package:
//   - src/lib/brand_tokens.css   — plain custom properties (site, docs)
//   - src/lib/aikami_theme.css   — semantic UI palette + Tailwind `@theme`
//                                  registration (client, hub)
//   - src/lib/aikami_ui.css      — Aikami-owned component classes (client,
//                                  hub)
//
// There are intentionally NO TS palette constants here: the palette is
// declared in CSS and the CSS files are the source of truth. A hand-synced
// TS copy would drift (it already did once — M6). Consumers that need a
// palette value in TS should read the CSS custom property at runtime
// (getComputedStyle) or add a build-time extraction that derives from these
// files.
export {};
