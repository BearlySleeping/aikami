---
id: C-423
title: "Aikami Design North Star — make the brand tokens real, kill hover-only actions"
source: "UX review 2026-08-21, re-verified against code 2026-08-21"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-21"
---

# Contract C-423: Aikami Design North Star

## Metadata

| Field | Value |
|---|---|
| **Source** | UX review 2026-08-21 — "no design north star; hover-only actions". Re-verified against code before drafting; the review's token premise was wrong and is corrected below. |
| **Target** | `packages/frontend/theme/src/lib/brand_tokens.css`; `apps/frontend/client/src/app.css`; `apps/frontend/client/src/lib/components/chat/message_action_bar.svelte`; `apps/frontend/client/src/lib/components/chat/enhanced_chat_message.svelte`; `apps/frontend/client/src/lib/views/combat/components/combat_inline_image.svelte`; `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte`; `docs/design/DESIGN.md` (new); `docs/guides/CODING_STANDARDS.md` |
| **Priority** | P1 — cheapest of the batch, fixes a real WCAG failure, and every later contract inherits its baseline |
| **Sequence** | **1 of 6** — must land first; C-424 explicitly inherits this accessibility baseline |
| **Dependencies** | C-418 Feature A (landed — `brand_daisy.css` / `brand_tokens.css`) |
| **Status** | draft |
| **Promotion** | `integrated` |
| **Docs Impact** | internal (`docs/design/DESIGN.md`) |
| **Contract version** | 3.0.0 |

## Problem & Baseline Evidence

### Finding 1 — the evocative brand tokens are dead code

The 2026-08-21 review claimed the brand tokens "exist but are applied
inconsistently." Verification shows something worse: **they are not loaded in
the app at all.**

- `--rune`, `--rune-glow`, `--ember`, `--magic-dust`, `--parchment`,
  `--obsidian` are defined only in
  `packages/frontend/theme/src/lib/brand_tokens.css:23-28` (light) and `:66-71`
  (dark).
- `apps/frontend/client/src/app.css:3` imports **only** `brand_daisy.css`.
  Same for `apps/frontend/hub/src/app.css:3`. `brand_tokens.css` is exported
  from `packages/frontend/theme/package.json:7` and imported by nothing.
- `grep -rn 'var(--rune|--ember|--magic-dust|--parchment|--obsidian)` across
  `apps/frontend/client/src`, `apps/frontend/hub/src`, and
  `packages/frontend/components/src`: **0 hits.**

So at runtime the client is stock daisyUI role tokens (`--color-primary`,
`--color-accent`, …) with no brand vocabulary whatsoever — precisely the
"generic dashboard" drift the review wanted to prevent. A `DESIGN.md` that
"formalizes the existing tokens" would formalize variables the app cannot see.
**This is the reason AC-2 exists:** a design doc no code obeys is the standard
failure mode for this kind of contract.

### Finding 2 — hover-only actions, and worse than reported

`message_action_bar.svelte:59` renders the bar with
`opacity-0 … group-hover:opacity-100` and **no `focus-within` or `focus`
variant**. The buttons stay in the tab order while fully transparent, so a
keyboard user tabs into controls they cannot see. That is a **WCAG 2.4.7
(Focus Visible) failure**, not merely a touch-device gap — a strictly stronger
claim than the review made.

The pattern appears in exactly three places (small, cheap to fix):

| File | Line | Content |
|---|---|---|
| `components/chat/message_action_bar.svelte` | 59 | copy / retry / branch / speak / edit / delete |
| `views/game/ui/overlays/dialogue/dialogue_overlay.svelte` | 331 | dialogue message actions |
| `views/combat/components/combat_inline_image.svelte` | 56 | image overlay actions |

Note the review listed the actions as "edit, regenerate, TTS, copy,
swipe/alternate". The real sets are `copy, retry, branch (+speak)` for AI
messages and `copy, edit, delete, branch` for user messages
(`message_action_bar.svelte:25-29`). Swipe controls are a **separate**
always-visible component (`enhanced_chat_message.svelte:73-81`) and are not
part of this fix.

- **Reproduction**: open a chat, Tab into the message list — focus lands on
  invisible buttons. Then load at a touch viewport (390×844) — no affordance
  reveals the bar at all.
- **Baseline tests**: no design-token tests exist. `moon run client:test-unit`
  and `moon run e2e:test-client` must be green before starting.

## User Outcome

A **player** can reach every message action with a keyboard (with visible
focus) and on a touch device. A **contributor** reads one `docs/design/DESIGN.md`
that states Aikami's named rules and can point at a real, shipping surface that
follows them.

## Success Measures

- **Time/latency target**: no runtime change; CSS/markup only.
- **Offline/degraded behavior**: purely presentational; unaffected by AI availability.
- **Production journey enabled**: the interface stops leaking accessibility
  defects, and the brand has a vocabulary that is actually rendered.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| daisyUI role palette (loaded) | `theme/src/lib/brand_daisy.css` | reuse — do not rewrite |
| Named brand tokens (dead) | `theme/src/lib/brand_tokens.css` | **decide** — wire in or delete (AC-2) |
| Named-rules doc structure | `examples/Marinara-Engine/DESIGN.md` | adapt — do not copy its taxonomy |
| Hover-only bars | the three files in Finding 2 | modify |
| Conventions home | `docs/guides/CODING_STANDARDS.md` | modify — add link |

## Overview

Fix the accessibility defect, resolve the dead-token question with a real
shipping example, and write the rules down. In that order — the doc is written
**last**, describing what the code now does, not aspirationally.

## Design Reference

- `theme/src/lib/brand_daisy.css` — the palette actually loaded.
- `theme/src/lib/brand_tokens.css:23-28, 66-71` — the dead named tokens.
- `examples/Marinara-Engine/DESIGN.md` — named-rules *structure* to adapt.
  Adapt the format, not the content: its rules are named for its own brand.
- `components/chat/message_action_bar.svelte` — the primary fix target.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Fix the hover-only bars first. Minimum viable fix: add `focus-within:opacity-100`
  **and** a non-hover affordance (persistent at touch widths, or an always-visible
  `⋯` trigger). Do not rely on `@media (hover: none)` alone — a keyboard user on
  a hover-capable device is the failing case.
- Resolve the token question with a decision, not a doc. Either (a) import
  `brand_tokens.css` into `app.css` and use the named tokens on at least one
  real surface, or (b) delete the unused tokens from `brand_tokens.css`.
  **Do not leave them defined-but-unloaded.**
- Write `docs/design/DESIGN.md` last, and cite the shipping surface for each rule.
- Presentational only — no data-model, schema, or engine changes.

## State & Data Models

None. Documentation + CSS/markup only. Any spacing/radius/type scale introduced
by `DESIGN.md` is documentation, not TypeScript.

## Quality Requirements

- **Offline/degraded mode**: presentational; offline.
- **Accessibility/input**: the core of this contract. All message actions
  keyboard-reachable with **visible** focus (WCAG 2.4.7) and touch-reachable.
  Colour never the sole carrier of meaning.
- **Performance budget**: none — no engine-loop impact.
- **Security/privacy**: N/A.
- **Persistence/migration**: N/A.
- **Cancellation/retry/idempotency**: N/A.
- **Observability**: N/A.

## Migration & Rollback

No persistent state. Rollback = revert the component and CSS changes.
If AC-2 takes the "delete unused tokens" branch, rollback restores the
declarations (nothing consumes them, so restoration is inert).

## Scope Boundaries

- **In Scope:** the three hover-only surfaces; the brand-token
  wire-in-or-delete decision plus one exemplar surface if wiring in;
  `docs/design/DESIGN.md`; the `CODING_STANDARDS.md` link.
- **Out of Scope:** rewriting the daisyUI palette; restyling every view;
  swipe controls (already always-visible); changing Marinara-Engine;
  any gameplay or engine change.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** three independently-mergeable units, in order —
(1) the hover-only fix, (2) the token decision + exemplar, (3) the doc.
Unit 1 is shippable alone and is the highest-value piece.

## Acceptance Criteria

### AC-1: No primary action is hover-only or focus-invisible

**Given** a chat message, a dialogue message, and a combat inline image
**When** a keyboard user Tabs to the actions, **or** the surface renders at a
touch viewport (390×844)
**Then** the actions are visible when focused (`focus-within` or equivalent),
reachable without hover at touch widths, and activatable with Enter/Space.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E + Visual | `message_actions_a11y.spec.ts` (axe-core, keyboard-focus assertion, 390×844 + 1280×720) | chat, dialogue, combat | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test-client`, `moon run client:test-unit`
- Integration: `@axe-core/playwright` (already in `apps/e2e`) — assert no
  serious/critical violations; assert the focused action bar has non-zero
  computed opacity.

### AC-2: Brand tokens are either loaded and used, or removed

**Given** `brand_tokens.css` defines `--rune`, `--ember`, `--magic-dust`,
`--parchment`, `--obsidian`, `--rune-glow`
**When** this contract completes
**Then** *either* `app.css` imports `brand_tokens.css` **and** at least one
production surface consumes at least one named token (grep proves ≥1 hit in
`apps/frontend/client/src`), *or* the unused declarations are deleted.
The defined-but-unloaded state must not survive this contract.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Visual + grep audit | Before/after grep count recorded in the Execution Report | whichever surface is chosen | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build`
- Integration: `grep -rn 'var(--rune\|--ember\|--magic-dust\|--parchment\|--obsidian' apps/frontend/client/src | wc -l` — must be `0` (deleted branch) or `>0` (wired branch). `1`+ with the import absent is a **fail**.

### AC-3: DESIGN.md exists, is specific, and is linked

**Given** a contributor opens `docs/design/DESIGN.md`
**When** they read it
**Then** it states Aikami's named rules — including an explicit
**"no hover-only, no focus-invisible primary actions"** rule — a colour-usage
rule for when accent is earned, a typography/elevation/feedback vocabulary,
an accessibility baseline, and a "Don't" list; **each rule cites a real file
that follows it**; and `CODING_STANDARDS.md` links to it.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Doc review | `docs/design/DESIGN.md` + link in `CODING_STANDARDS.md` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: manual review
- Integration: reviewer confirms every named rule cites a shipping file path.

### AC-4: Palette contrast audit

**Given** the loaded palette (`brand_daisy.css`, light + dark)
**When** `base-content` on `base-100/200/300`, and each
`*-content` on its `*` pair, are checked
**Then** body text meets WCAG AA (4.5:1); any failing pair is documented in
`DESIGN.md` with a named remedy (adjust token, or forbid that usage).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Audit | Contrast table in `DESIGN.md` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: manual/scripted contrast check over the oklch pairs
- Integration: record the computed ratios, not a pass/fail assertion.

## Implementation Sequence

1. **Phase 1 (Accessibility)** — Fix the three hover-only surfaces. Add
   `focus-within:opacity-100` plus a touch-width affordance. Write
   `message_actions_a11y.spec.ts`. This phase is independently shippable.
2. **Phase 2 (Tokens)** — Decide wire-in vs delete. If wiring in, import
   `brand_tokens.css` in `app.css` and apply named tokens to one surface
   (suggested: the dialogue overlay card, the most "in-fiction" surface).
   Record the before/after grep count.
3. **Phase 3 (Doc)** — Write `docs/design/DESIGN.md` describing what Phases 1–2
   actually did, run the contrast audit, link from `CODING_STANDARDS.md`.
4. **Phase 4 (Validation)** — `moon run client:test-unit`,
   `moon run e2e:test-client`, `bun run typecheck`.

## Edge Cases & Gotchas

- `opacity-0` keeps elements focusable. Any fix using `hidden`/`display:none`
  instead changes tab order — verify the axe run either way.
- daisyUI's `tooltip` class on the action buttons positions relative to the
  bar; making the bar persistent at touch widths can push tooltips offscreen.
  Check at 390×844.
- Phase 2's "delete" branch is a legitimate outcome. Do not wire in the tokens
  merely to avoid deleting them — an unused-but-loaded token is no better.
- `brand_tokens.css` is *also* mirrored into the Astro docs site build output.
  That copy is independent; do not chase it.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1 — wire in or delete the named brand tokens?** Wiring in gives the game
  a visual identity distinct from stock daisyUI, but means committing to
  applying them broadly over time. Deleting is honest and cheap.
  **Recommendation: wire in**, with the dialogue overlay as the exemplar —
  the in-fiction surfaces are where a distinct identity actually pays off,
  and this is the contract that establishes the pattern.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-08-21 | Initial draft from UX review. | — |
| 3.0.0 | 2026-08-21 | Re-verified against code. Corrected the central token premise: `brand_tokens.css` is not imported by client or hub and the named tokens have 0 usages — "applied inconsistently" was false. Added AC-2 (wire-in-or-delete) so the doc cannot be satisfied vacuously. Strengthened the hover finding to a WCAG 2.4.7 failure (no `focus-within`) and corrected the action list (swipe controls are separate and already visible). Added AC-4 contrast audit, Implementation Sequence, Edge Cases, and lifecycle sections. Resequenced to position 1 of 6. | review 2026-08-21 |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`**. AC-1 additionally requires `release_verified`-level
visual evidence at both viewports given its visual nature.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
