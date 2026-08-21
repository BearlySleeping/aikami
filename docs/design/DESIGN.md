# Aikami Design North Star

This document states Aikami's named design rules. Every rule cites a real,
shipping file that follows it — a rule with no shipping example is a
placeholder, not a standard. It was written **after** the code it describes
(C-423), so it records what the app actually does rather than an aspiration.

The brand palette lives in two places, both under
`packages/frontend/theme/src/lib/`:

- `brand_daisy.css` — the daisyUI role palette actually loaded by the game
  client and hub (`--color-primary`, `--color-base-100`, …).
- `brand_tokens.css` — the named brand vocabulary (`--rune`, `--ember`,
  `--parchment`, `--obsidian`, `--magic-dust`, `--rune-glow`). Imported by the
  client in `apps/frontend/client/src/app.css` and consumed on the dialogue
  overlay.

---

## Named Rules

### R1 — No hover-only, no focus-invisible primary actions

Every primary action must be reachable three ways: by mouse hover, by keyboard
with **visible** focus, and by touch without hover. A control that only appears
on hover is a WCAG 2.4.7 (Focus Visible) failure — keyboard users tab into
controls they cannot see.

The pattern is `opacity-0 … group-hover:opacity-100 focus-within:opacity-100
max-sm:opacity-100`: hover reveals it, keyboard focus reveals it, and below the
`sm` breakpoint it is persistent so touch users always see it.

**Shipping examples:**
- `apps/frontend/client/src/lib/components/chat/message_action_bar.svelte`
- `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte`
- `apps/frontend/client/src/lib/views/combat/components/combat_inline_image.svelte`

### R2 — Accent is earned

The rune purple (`--rune` in `brand_tokens.css`, `--color-primary` in
`brand_daisy.css`) is the brand accent. Use it for the single most important
action on a surface and for primary interactive states — never as decoration or
for large background fills. When a surface already has a primary action, a
second element must not also claim the accent.

**Shipping example:** the dialogue send button is the only `btn-primary` on the
overlay (`dialogue_overlay.svelte`); the End Chat action is `btn-ghost
text-error`, deliberately de-emphasised.

### R3 — Typography

- Sans: `Inter`; Mono: `JetBrains Mono` (declared in
  `apps/frontend/client/src/app.css` `@theme`).
- Body text is `text-sm`/`text-base`; UI chrome (labels, timestamps, hints) is
  `text-xs`.
- Never use colour alone to convey meaning — pair it with an icon, a label, or
  a glyph (e.g. the dice banner pairs `text-success`/`text-error` with
  `✅ SUCCESS` / `❌ FAILURE` in `dialogue_overlay.svelte`).

### R4 — Elevation

Surfaces stack with shadow + backdrop blur, never with hard borders alone.
Dialogue and combat cards use `shadow-2xl backdrop-blur-md` over a dimmed
backdrop (`bg-gradient-to-t from-base-300/60`). The in-fiction dialogue card
adds a `--rune-glow` border to signal "this is the fiction surface"
(`dialogue_overlay.svelte`).

### R5 — Feedback

- Streaming / busy states use `role="status"` live regions so screen readers
  announce progress without interruption (`dialogue_overlay.svelte`).
- Destructive actions are confirmed before they run (the delete modal in
  `dialogue_overlay.svelte`).
- Errors surface inline with `text-error` and an icon, never as a silent
  failure.

### R6 — Accessibility baseline

- All interactive elements are real `<button>`s with `aria-label`/`title`
  (see the action bars above).
- Focus is always visible (R1).
- Body text meets WCAG AA (4.5:1) on the base surfaces — see the Contrast
  Audit below. Semantic colour pairs that fail AA are documented there with a
  named remedy.

---

## Contrast Audit (C-423 AC-4)

Computed from the loaded `brand_daisy.css` palette (oklch → sRGB → relative
luminance → WCAG ratio). Body text target is 4.5:1 (AA); large text 3:1.

### Light

| Pair | Ratio | Verdict |
|---|---|---|
| `base-content` on `base-100` | 8.87 | ✅ AA |
| `base-content` on `base-200` | 8.36 | ✅ AA |
| `base-content` on `base-300` | 7.59 | ✅ AA |
| `primary-content` on `primary` | 2.64 | ❌ FAIL |
| `secondary-content` on `secondary` | 5.85 | ✅ AA |
| `accent-content` on `accent` | 4.16 | ⚠️ AA-large only |
| `neutral-content` on `neutral` | 5.68 | ✅ AA |
| `info-content` on `info` | 3.16 | ⚠️ AA-large only |
| `success-content` on `success` | 2.43 | ❌ FAIL |
| `warning-content` on `warning` | 2.65 | ❌ FAIL |
| `error-content` on `error` | 5.02 | ✅ AA |

### Dark

| Pair | Ratio | Verdict |
|---|---|---|
| `base-content` on `base-100` | 11.75 | ✅ AA |
| `base-content` on `base-200` | 9.12 | ✅ AA |
| `base-content` on `base-300` | 5.36 | ✅ AA |
| `primary-content` on `primary` | 7.04 | ✅ AA |
| `secondary-content` on `secondary` | 11.75 | ✅ AA |
| `accent-content` on `accent` | 6.64 | ✅ AA |
| `neutral-content` on `neutral` | 3.70 | ⚠️ AA-large only |
| `info-content` on `info` | 3.16 | ⚠️ AA-large only |
| `success-content` on `success` | 2.43 | ❌ FAIL |
| `warning-content` on `warning` | 2.65 | ❌ FAIL |
| `error-content` on `error` | 2.42 | ❌ FAIL |

### Failing pairs and named remedies

- **`primary-content` on `primary` (light, 2.64)** — white text on rune purple
  is below AA. **Remedy:** do not set body text on a `btn-primary`; use the
  accent for the button *background* with `--color-primary-content` only for
  short, bold, large labels, or darken `--color-primary` in light mode.
- **`success-content` on `success` / `warning-content` on `warning`
  (both modes)** — the pastel semantic fills are too light for dark text.
  **Remedy:** forbid body text directly on `bg-success`/`bg-warning`; use them
  only as tinted backgrounds (`bg-success/10`) with `base-content` text, as the
  dice banner already does in `dialogue_overlay.svelte`.
- **`error-content` on `error` (dark, 2.42)** — **Remedy:** prefer
  `bg-error/10` + `text-error` (as the stream-error banner does) over a solid
  `bg-error` fill with `error-content` text.

---

## Don't

- Don't add a hover-only action without `focus-within` and a touch-width
  affordance (R1).
- Don't use `opacity-0` to hide a focusable control — it stays in the tab order
  while invisible (R1).
- Don't use the rune accent for decoration or a second primary action on the
  same surface (R2).
- Don't rely on colour alone to convey state (R3).
- Don't put body text on a solid `success`/`warning`/`error` fill (Contrast
  Audit).
- Don't define a brand token in `brand_tokens.css` and leave it unloaded — wire
  it in or delete it (C-423 AC-2).
