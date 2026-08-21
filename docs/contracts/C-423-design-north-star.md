---
id: C-423
title: "Aikami Design North Star — codify named design rules, kill hover-only actions, and establish a UI cohesion standard"
source: "UX review 2026-08-21 — 'Aikami has no design north star; Marinara does'; fix hover-only actions and accessibility"
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
| **Source** | UX review 2026-08-21 — "Design north star doc + kill hover-only actions". Modeled on `examples/Marinara-Engine/DESIGN.md`, tuned to Aikami's existing brand. |
| **Target** | `docs/design/` (new `DESIGN.md`); `packages/frontend/theme/src/lib/brand_daisy.css` + `brand_tokens.css` (reference); `apps/frontend/client/src/lib/components/chat/enhanced_chat_message.svelte` (hover-only action bar); `apps/frontend/client/src/lib/components/chat/message_action_bar.svelte`; `docs/guides/CODING_STANDARDS.md` |
| **Priority** | P1 — cohesion and accessibility; prevents the "bland SaaS dashboard" drift Marinara explicitly warns against; the brand tokens already exist |
| **Dependencies** | C-418 Feature A (landed — brand_daisy.css / brand_tokens.css / shadcn-style tokens) |
| **Status** | draft |
| **Promotion** | `sandbox` |
| **Docs Impact** | internal (a design reference doc) + user-facing docs if the tutorial references it |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Aikami **already has** a solid brand-token foundation — `brand_daisy.css` and `brand_tokens.css` define a "parchment / warm slate" light theme and "obsidian / rune-glow" dark theme, with expressive named tokens (`--rune`, `--ember`, `--magic-dust`, `--parchment`, `--obsidian`). But these are **color tokens only** — there is **no codified design language**: no named rules for *when* to use the rune accent vs. neutral, no typography/elevation/feedback conventions, no accessibility baseline. The result is that components drift: the chat message **action bar is hover-only** (see `enhanced_chat_message.svelte` — `MessageActionBar` reveals on hover), which fails on mobile and hides discoverable actions behind an interaction not all users make. Marinara's `DESIGN.md` is a *named-rules* system ("The Blush Is Earned Rule," "The No Tiny Mystery Rule," "Compact Is Not Cramped") — Aikami has tokens but no equivalent *rules*.
- **Reproduction**: Hover over a chat message — the action bar appears; on a touch device there is no equivalent affordance. Across views, the rune accent is applied inconsistently because there's no written rule for when accent is "earned." There is no single doc a contributor reads to keep the UI coherent.
- **Existing implementation to reuse**: `brand_daisy.css` + `brand_tokens.css` (the palette); `enhanced_chat_message.svelte` + `message_action_bar.svelte` (the hover-only surface to fix); Marinara's `DESIGN.md` (the named-rules structure to adapt).
- **Known gaps**: (a) no named-rule design doc; (b) hover-only actions violate mobile + discoverability; (c) no accessibility baseline in the design language; (d) tokens exist but no guidance on usage, so they're applied inconsistently.
- **Baseline tests**: no dedicated design-token tests; check client builds and existing component tests still pass after CSS/class changes.

## User Outcome

After this contract, a **player** can discover and invoke every primary message action on any device (touch included) — no action is reachable only via hover. A **contributor** reads one `docs/design/DESIGN.md` that states the named rules, the "when accent is earned" principle, typography, elevation, feedback, and accessibility baseline, so new UI is coherent by construction rather than by accident.

## Success Measures

- **Time/latency target**: no runtime latency change (CSS/UX restructure only).
- **Offline/degraded behavior**: purely presentational; fully offline. No behavior change when AI is unavailable.
- **Production journey enabled**: a coherent, accessible, mobile-friendly UI that keeps players in the fantasy rather than fighting the interface.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Brand palette (light + dark) | `packages/frontend/theme/src/lib/brand_daisy.css`, `brand_tokens.css` | reuse — reference; do not rewrite |
| Named-rules structure | `examples/Marinara-Engine/DESIGN.md` | adapt — author an Aikami-specific version |
| Hover-only action bar | `apps/frontend/client/src/lib/components/chat/enhanced_chat_message.svelte`, `message_action_bar.svelte` | modify — make actions discoverable without hover |
| Design conventions home | `docs/guides/CODING_STANDARDS.md` | modify — link the new DESIGN.md |
| daisyUI theme wiring | `apps/frontend/client/src/app.css` | reference — no change |

## Overview

Author an **Aikami Design North Star** document (`docs/design/DESIGN.md`) that codifies the existing brand tokens into a named-rules design language — including when the rune accent is "earned", typography, elevation, feedback states, and an accessibility baseline. As the first concrete enforcement, fix the hover-only chat action bar so every primary action is discoverable on any device. Link the design doc from the coding standards so contributors treat it as authoritative.

## Design Reference

- `packages/frontend/theme/src/lib/brand_daisy.css` + `brand_tokens.css` — the palette the design language formalizes.
- `examples/Marinara-Engine/DESIGN.md` — the named-rules template to adapt (colors, typography, elevation, named rules, "Don't" list).
- `apps/frontend/client/src/lib/components/chat/message_action_bar.svelte` + `enhanced_chat_message.svelte` — the hover-only surface to fix.
- `docs/guides/CODING_STANDARDS.md` — where to link the design doc.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Author `docs/design/DESIGN.md` with: brand story, color usage rules (when accent/rune is "earned"), typography scale, elevation/glow vocabulary, feedback/state conventions, accessibility baseline, and a "Don't" list (adapted from Marinara, tuned to Aikami — e.g. don't default to the daisyUI generic look, don't rely on hover for primary actions).
- Add a named rule codifying that **no primary action may be reachable only via hover** — this is the contract's concrete enforcement target.
- Fix `message_action_bar.svelte` / `enhanced_chat_message.svelte`: make primary message actions visible via a persistent or clearly-afforded "⋯" menu (not hover-only), keyboard-accessible, and touch-friendly. Keep secondary actions condensed but discoverable.
- Link `DESIGN.md` from `CODING_STANDARDS.md`.
- Keep the change presentational; no data-model or engine changes.

## State & Data Models

No new runtime data models. This is documentation + presentational CSS/component changes. The design language may introduce **design tokens** as documentation (e.g. a spacing/radius/type scale), formalized as comments/appendices in `DESIGN.md`, but no new JS/TS types.

## Quality Requirements

- **Offline/degraded mode**: purely presentational; offline.
- **Accessibility/input**: this contract's core fix — no hover-only primary actions; all actions keyboard-reachable (Tab + Enter/Space) and touch-reachable; contrast meets WCAG AA for the palette (verified against existing oklch values); color never the sole carrier of meaning.
- **Performance budget**: no engine/loop impact; presentational only.
- **Security/privacy**: N/A — no data changes.
- **Persistence/migration**: N/A — no persistent state.
- **Cancellation/retry/idempotency**: N/A.
- **Observability**: N/A.

## Migration & Rollback

N/A — no persistent state changes. **Rollback** = revert the action-bar component + DESIGN.md. **Feature flag**: not needed (presentational).

## Scope Boundaries

- **In Scope:** `docs/design/DESIGN.md` (named-rules design language); link from `CODING_STANDARDS.md`; fix the hover-only chat action bar (persistent/afforded, keyboard + touch accessible); accessibility baseline verification for the existing palette.
- **Out of Scope:** rewriting the brand palette (reuse existing tokens); restyling every view in the app (this contract sets the standard + fixes the most egregious surface); changing Marinara-Engine itself; engine/gameplay changes.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** (1) the DESIGN.md doc + coding-standards link is one independently-mergeable unit; (2) the hover-only action-bar fix is a second, independently-mergeable unit (and the concrete enforcement of the doc).

## Acceptance Criteria

### AC-1: Design north-star document exists
**Given** a contributor reads the design docs
**When** `docs/design/DESIGN.md` is opened
**Then** it states Aikami's named rules (accent-is-earned, no-hover-only-primary-actions, typography, elevation, feedback, accessibility baseline, and a Don't list), references the existing brand tokens, and is linked from `CODING_STANDARDS.md`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | N/A (doc) | `docs/design/DESIGN.md` + standards link | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `docs:build` (if docs app builds); manual review
- Integration: reviewer confirms the doc is coherent and linked.

### AC-2: No primary action is hover-only (chat action bar)
**Given** a chat message renders
**When** a player is on a touch device OR a keyboard-only user focuses the message
**Then** the primary actions (edit, regenerate, TTS, copy, swipe/alternate) are reachable via a visible/persistent affordance (not hover), are keyboard-activatable, and are touch-reachable.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Visual + Unit + E2E | `message_action_bar` component test + mobile viewport check | chat | Filled during verification |

**Test Hooks**:
- Moon Task: `client:test`
- Integration: browser — render a message at mobile width, assert actions reachable without hover; keyboard-tab to the actions.

### AC-3: Accessibility baseline verified against palette
**Given** the existing brand palette (light + dark)
**When** contrast is checked for base-content vs. base surfaces and primary/secondary/accent combinations
**Then** the palette meets WCAG AA for body text on its surfaces, with any failing combination documented (and a plan to adjust the token or usage).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Visual/Audit | contrast audit in DESIGN.md | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: manual contrast audit
- Integration: run an automated contrast check over the token pairs; document results.
