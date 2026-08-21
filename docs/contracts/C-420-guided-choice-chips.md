---
id: C-420
title: "One Choice Affordance — converge CYOA choices and suggestion chips on a single primitive, across chat and dialogue"
source: "UX review 2026-08-21; premise re-verified and inverted 2026-08-21"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-21"
---

# Contract C-420: One Choice Affordance

## Metadata

| Field | Value |
|---|---|
| **Source** | UX review 2026-08-21 — "guided generation / suggestion chips". **The review's premise was wrong**; verification found the primitive already exists and is already in dialogue. Re-scoped from "add chips" to "converge on one chip". |
| **Target** | `packages/shared/schemas/src/lib/game/npc_dialogue_command.ts`; `packages/shared/schemas/src/lib/game/cyoa.ts`; `apps/frontend/client/src/lib/data/initial_suggestion_presets.ts`; `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte`; `apps/frontend/client/src/lib/views/chat/chat_view.svelte` + `chat_view_model.svelte.ts`; `apps/frontend/client/src/lib/views/chat/choice_buttons_view.svelte` |
| **Priority** | P1 — removes a live UX defect (two competing affordances) and fills the dead first-session chat |
| **Sequence** | **4 of 6** — after C-424, so the chip surface is written once into `GuidedComposer` rather than twice |
| **Dependencies** | C-245 (landed — CYOA); C-371 (landed — `NpcSuggestionChip` + intent chips); C-417 Feature 4 (landed — chip row wrapping); C-424 (`GuidedComposer`, sequence 3) |
| **Status** | draft |
| **Promotion** | `integrated` |
| **Docs Impact** | internal |
| **Contract version** | 3.0.0 |

## Problem & Baseline Evidence

> **This contract was rewritten.** Version 2.0.0 proposed adding a new
> `GuidedChip` type on the grounds that "there is no lightweight suggestion
> chip path" and that chips are "not wired into game dialogue". Both claims
> are false. Building v2.0.0 would have produced a **third** overlapping
> choice primitive. What follows is the verified baseline.

### What already exists

- **`NpcSuggestionChip` is the primitive the review asked for.**
  `packages/shared/schemas/src/lib/game/npc_dialogue_command.ts:192-206`:
  `{ id, label, intentType, prefillText }`, `additionalProperties: false`,
  `prefillText` required at `minLength: 10` ("MUST be a complete natural
  sentence, not a keyword"). Model-emitted, shared package, already validated.
- **It is already rendered in the game dialogue overlay**, with intent icons —
  `dialogue_overlay.svelte:558-590`, `data-testid="suggestion-chips"`.
- **Starter chips already exist and are offline-safe.**
  `apps/frontend/client/src/lib/data/initial_suggestion_presets.ts` merges the
  NPC's content-pack `initialSuggestions` with the active player class's preset
  chips (bard / fighter / wizard / rogue …), capped at
  `MAX_INITIAL_SUGGESTIONS = 5`. This is exactly what v2.0.0's OQ-1 proposed as
  future work — it shipped under C-371.
- **The dialogue overlay already has a composer** — `AutoResizeTextarea` at
  `dialogue_overlay.svelte:643`. (v2.0.0's OQ-2 asked whether one existed.)

### The real defect: two competing affordances, stacked

The dialogue overlay renders **both** choice systems, one directly above the
other, as near-identical daisyUI buttons with different semantics:

| Element | Line | Sends | Styling |
|---|---|---|---|
| `data-testid="cyoa-choices"` | `dialogue_overlay.svelte:508-521` | `choice.label` | `btn btn-sm btn-outline w-full justify-start` |
| `data-testid="suggestion-chips"` | `dialogue_overlay.svelte:558-590` | `chip.prefillText` | `btn btn-xs` + intent colour |

Nothing in the UI explains why one row is full-width and the other is a
wrapped chip row, or why tapping one sends a short label while tapping the
other sends a full sentence. C-417 Feature 4 already noted these two are
"visually adjacent in the same overlay" and easy to conflate.

Meanwhile **chat has the opposite gap**: CYOA choices only
(`chat_view.svelte:109`), no suggestion chips, and a dead empty state —
`chat_view.svelte:87`, `"No messages yet. Start the conversation!"` — with no
starter chips, even though the presets exist and are surface-agnostic.

- **Reproduction**: (a) talk to Elder Thalia in-game with the CYOA agent
  enabled — observe two stacked, unexplained button rows. (b) Open a fresh chat
  with any NPC — observe a blank textarea and dead-end text.
- **Baseline tests**: `choice_buttons_view_model.test.ts`,
  `dialogue_overlay_view_model.test.ts`. Run both before starting.

## User Outcome

A **player** sees exactly one kind of suggested-action affordance, and it means
the same thing everywhere: tap it to say that. It appears in the game dialogue
overlay and in chat, including on a fresh chat where starter chips replace the
dead empty state. A **creator** authors one chip shape.

## Success Measures

- **Time/latency target**: chips render with the completed turn — no extra
  round trip. Starter chips render immediately from local presets.
- **Offline/degraded behavior**: starter chips are local and render with no
  model. Model-emitted chips are simply absent when the AI is unavailable; the
  composer still works.
- **Production journey enabled**: the fresh-chat dead end — the largest
  first-session drop-off in an AI RPG — becomes a one-tap start.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Chip primitive | `schemas/.../npc_dialogue_command.ts:192` `NpcSuggestionChipSchema` | **reuse — do not replace** |
| Intent taxonomy | `NpcSuggestionChipIntentTypeSchema` (`combat`/`skill_check`/`trade`/`quest`/`dialogue`) | reuse — it already drives icons and a combat branch |
| Starter chips | `data/initial_suggestion_presets.ts` | reuse — extend to chat |
| Chip rendering | `dialogue_overlay.svelte:558-590` | extract — into a shared component |
| Chip selection | `dialogue_overlay_view_model.svelte.ts:838-857` `handleChipTap` | reuse |
| CYOA choices | `views/chat/choice_buttons_view.svelte` + VM, `schemas/.../cyoa.ts` | **decide — see OQ-1** |
| Composer slot | C-424 `GuidedComposer.above` snippet | reuse |

## Overview

Stop the proliferation. Extract the existing `NpcSuggestionChip` rendering into
one shared component, mount it in `GuidedComposer.above` so both surfaces get
it for free, bring starter chips to chat's empty state, and resolve the
two-affordance collision in dialogue by giving CYOA choices and chips visibly
distinct roles — or by folding one into the other (OQ-1).

**No new type is introduced by this contract.**

## Design Reference

- `schemas/.../npc_dialogue_command.ts:192-206` — the primitive being kept.
- `dialogue_overlay.svelte:558-590` — the rendering being extracted.
- `dialogue_overlay_view_model.svelte.ts:838-857` — selection semantics.
- `data/initial_suggestion_presets.ts` — the starter-chip source.
- `chat_view.svelte:87` — the dead empty state being replaced.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Reuse `NpcSuggestionChip`. Do not add a parallel chip type.** If chat needs
  a field the schema lacks, add it as `Type.Optional` to the existing schema.
- **Keep `intentType`; do not adopt an `entity` taxonomy.** The v2.0.0 proposal
  copied Marinara's app-navigation categories (`lorebooks`, `personas`,
  `presets`, `connections`, `settings`) wholesale. Those are meaningless on an
  RPG dialogue chip. `intentType` already carries game meaning and already
  drives both the icon map and the `intentType === 'combat'` escalation branch.
- Extract chip rendering into `components/messaging/suggestion_chips.svelte`,
  mounted through `GuidedComposer.above` (C-424) so both surfaces share it.
- **Selection semantics are per-surface, and this is deliberate:**
  - *Dialogue* keeps **auto-send** (current behaviour,
    `dialogue_overlay_view_model.svelte.ts:855`). Tapping a line in a
    conversation *is* saying it; a confirm step breaks pacing.
  - *Chat* uses **prefill-and-focus, do not send.** Chat is an authoring
    surface where the player edits before committing.
  The shared component takes an `onSelect` callback and makes no assumption.
- Starter chips in chat come from the existing presets, keyed by the NPC and
  the active player class — the same merge the overlay performs.
- Chips clear on send, on chat switch, and on reset. Idempotent.
- Inherits the C-423 baseline: real buttons, visible focus, keyboard-activatable,
  never hover-only.

## State & Data Models

**No new types.** For reference, the primitive being reused:

```typescript
// packages/shared/schemas/src/lib/game/npc_dialogue_command.ts:192
type NpcSuggestionChip = {
  id: string;
  label: string;
  intentType: 'combat' | 'skill_check' | 'trade' | 'quest' | 'dialogue';
  /** Complete natural sentence, min 10 chars. */
  prefillText: string;
};
```

Sanitisation already lives in the schema (`minLength`, `additionalProperties:
false`). If chat surfaces malformed model output, tighten the schema — do not
add a second client-side sanitiser.

## Quality Requirements

- **Offline/degraded mode**: starter chips render from local presets with no
  model. Model chips absent ⇒ nothing renders; composer unaffected.
- **Accessibility/input**: inherits C-423 — real buttons, visible focus,
  Enter/Space, never hover-only. Chip rows wrap (C-417 Feature 4 fixed
  `overflow-x-auto` → `flex-wrap`; keep it that way).
- **Performance budget**: ≤ 5 chips (`MAX_INITIAL_SUGGESTIONS`); static list;
  no engine-loop impact.
- **Security/privacy**: `prefillText` is model-authored text placed in a local
  composer. It must be rendered as text, never as markup, and length-bounded.
- **Persistence/migration**: chips are per-turn and ephemeral; not persisted.
  No migration.
- **Cancellation/retry/idempotency**: clearing on send / switch / reset is
  idempotent.
- **Observability**: log malformed chip payloads at debug level.

## Migration & Rollback

No persistent state. **Rollback**: revert the shared component and the chat
wiring; the dialogue overlay's original inline chip markup is the reference
implementation. If OQ-1 resolves toward removing a CYOA surface, that removal
lands as its own increment so it can be reverted independently.

## Scope Boundaries

- **In Scope:** extract the existing chip rendering into a shared component;
  mount it in both surfaces via `GuidedComposer`; starter chips in chat's empty
  state; per-surface selection semantics; resolve the dialogue two-affordance
  collision (OQ-1); tests.
- **Out of Scope:** any new chip type; the `entity`/`tone` taxonomy from
  v2.0.0; CYOA branching-narrative behaviour (C-245); redesigning the composer
  (C-424); changing NPC dialogue data models beyond optional schema fields;
  multiplayer.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**Three independently-mergeable increments:**
1. Extract `suggestion_chips.svelte`; dialogue consumes it. Behaviour identical.
2. Chat consumes it: model chips after each turn + starter chips in the empty
   state, with prefill-not-send semantics. *This is the retention win.*
3. Resolve the dialogue two-affordance collision per OQ-1.

## Acceptance Criteria

### AC-1: One shared chip component; dialogue behaviour unchanged

**Given** the dialogue overlay's inline chip markup
**When** it is extracted to `components/messaging/suggestion_chips.svelte` and
the overlay consumes it
**Then** chips render identically — intent icons, wrapping, disabled-while-
streaming — existing dialogue tests pass unmodified, and **no new chip type is
added to `packages/shared`**.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Visual | `suggestion_chips.test.ts`; `dialogue_overlay_view_model.test.ts` unmodified | in-game dialogue | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`, `moon run e2e:run-visual-tests`
- Integration: `git diff --stat packages/shared` shows no new chip schema; a
  before/after screenshot of the chip row is pixel-equivalent.

### AC-2: Starter chips replace the dead chat empty state

**Given** a fresh chat with an NPC and no messages
**When** the chat view renders
**Then** the `"No messages yet. Start the conversation!"` dead end is replaced
by up to 5 starter chips merged from the NPC's `initialSuggestions` and the
active player class presets; tapping one **prefills the composer and focuses
it without sending**; this works with no model available.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Visual | `chat_view_model.test.ts` (extended) | fresh NPC chat | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`, `moon run e2e:test-client`
- Integration: open a fresh chat with **no provider configured**; assert chips
  render and that tapping fills the draft and sends nothing.

### AC-3: Model chips after each chat turn

**Given** an assistant turn completes in chat and the model emitted chips
**When** the turn finishes
**Then** the chips render above the composer, replacing the previous set;
selecting one prefills the draft; the set clears on send, chat switch and reset.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | `chat_view_model.test.ts` (extended) | chat | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: mock a turn carrying chips; assert render, prefill, and all
  three clear paths.

### AC-4: One choice affordance per surface

**Given** the dialogue overlay with both CYOA choices and suggestion chips
available for the same turn
**When** the overlay renders
**Then** the resolution chosen in OQ-1 is implemented, and the surface no
longer presents two visually similar, semantically different button rows
without explanation.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Visual + Unit | `dialogue_overlay_view_model.test.ts` (extended) + screenshot with both sources populated | in-game dialogue | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`, `moon run e2e:run-visual-tests`
- Integration: force a turn that yields both CYOA choices and chips; screenshot
  at 1280×720 and 800×600.

## Implementation Sequence

1. **Phase 1 (Extract)** — Lift the chip row from `dialogue_overlay.svelte`
   into `components/messaging/suggestion_chips.svelte`, taking `chips`,
   `disabled` and `onSelect`. Overlay consumes it. Ship.
2. **Phase 2 (Chat)** — Mount it in `GuidedComposer.above` for chat. Wire the
   starter-chip merge for the empty state, then model chips per turn, with
   prefill-not-send. Ship — this is the retention increment.
3. **Phase 3 (Converge)** — Resolve OQ-1 and implement it. Ship.
4. **Phase 4 (Validation)** — `moon run client:test-unit`,
   `moon run e2e:test-client`, `moon run e2e:run-visual-tests`,
   `bun run typecheck`.

## Edge Cases & Gotchas

- **Do not add a new chip type, however tempting.** The whole point of this
  rewrite is that v2.0.0 would have made two overlapping primitives into three.
  If a reviewer asks for `tone` or `entity`, point them at this line.
- `prefillText` has `minLength: 10`; `handleChipTap` already falls back to
  `label` when the model emits something shorter
  (`dialogue_overlay_view_model.svelte.ts:854`). Preserve that fallback.
- `intentType === 'combat'` does **not** send a message — it escalates straight
  to combat (`:847-850`). In chat there is no combat surface to escalate to.
  Decide what a combat-intent chip means in chat (recommendation: filter it out
  of chat chip sets rather than sending its text as dialogue).
- The dialogue chip row is keyed by `{#key chips.map(c => c.id).join('|')}` to
  re-trigger its animation. Preserve that, or the chips stop feeling responsive.
- C-417 Feature 4 changed the row from `overflow-x-auto` to `flex-wrap`. Do not
  reintroduce horizontal scrolling during extraction.
- Chat starter chips need the active player class. Confirm it is reachable from
  the chat ViewModel; the overlay reads it from game state, which chat may not
  have when opened outside a session.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1 — what happens to CYOA choices in the dialogue overlay?**
  Three options: (a) **give them distinct roles** — CYOA = branch-advancing
  narrative beats rendered as a full-width list; chips = things you say,
  rendered as a chip row; make the difference visible with a label on each
  group. (b) **Fold CYOA choices into chips** as a new `intentType`, one row
  only. (c) **Drop CYOA from the overlay**, keeping it in chat where C-245
  targeted it.
  **Recommendation: (a).** They genuinely are different things — one advances a
  branch, one composes a line — and C-245's branch history depends on CYOA
  identity. The defect is that the difference is invisible, not that both
  exist. (b) would lose skill-check metadata; (c) would silently drop a shipped
  feature from the surface players use most.
- **OQ-2 — should chat chips be model-emitted at all in v1?** Chat's pipeline
  would need a chip-emitting post-agent (CYOA has one; chips do not). Starter
  chips alone (AC-2) deliver most of the retention win with none of that work.
  **Recommendation: ship AC-2 first and treat AC-3 as the follow-on increment**
  — if the post-agent proves costly, AC-2 still stands alone.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-08-21 | Initial draft from UX review — proposed a new `GuidedChip` type, `guided_chips` agent event, and `GuidedChipsView`. | — |
| 3.0.0 | 2026-08-21 | **Full rewrite; premise inverted.** Verification found `NpcSuggestionChip` (`npc_dialogue_command.ts:192`) already is the proposed primitive, already rendered in the dialogue overlay (`:558-590`), with starter chips already shipped (`initial_suggestion_presets.ts`) — so v2.0.0's OQ-1 and OQ-2 were both already answered in code, and building it would have created a third overlapping choice primitive. Re-scoped to convergence: no new type, reuse `intentType` instead of Marinara's app-navigation `entity` taxonomy, extract the existing renderer, extend to chat. Identified the real defect (two stacked, visually similar, semantically different affordances at `dialogue_overlay.svelte:508` and `:558`) and added AC-4 + OQ-1 for it. Made the auto-send vs prefill split an explicit per-surface decision rather than an unexamined assertion. Resequenced from 1 to 4 of 6, behind C-424. | review 2026-08-21 |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** per increment; AC-4 additionally requires
`release_verified`-level visual evidence at both viewports.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
