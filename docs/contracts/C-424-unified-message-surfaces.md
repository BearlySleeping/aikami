---
id: C-424
title: "Unified Message Surfaces — one RichMessageList + GuidedComposer behind chat and dialogue"
source: "UX review 2026-08-21, re-verified and re-scoped 2026-08-21"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-21"
---

# Contract C-424: Unified Message Surfaces

## Metadata

| Field | Value |
|---|---|
| **Source** | UX review 2026-08-21 — "chat vs dialogue vs vendor re-implement list-of-messages + input". Re-scoped: vendor convergence and ViewModel decomposition removed (see Scope Boundaries). |
| **Target** | `apps/frontend/client/src/lib/components/chat/enhanced_chat_message.svelte`; `apps/frontend/client/src/lib/components/chat/auto_resize_textarea.svelte`; `apps/frontend/client/src/lib/views/chat/chat_view.svelte`; `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay.svelte` |
| **Priority** | P1 — resequenced up from P2. It is the precondition for C-420 and the reason C-420/C-421 each had to be written twice. |
| **Sequence** | **3 of 6** — after C-421 so `DiceCard` exists to be composed in; before C-420 so chips land in one place instead of two |
| **Dependencies** | C-231 (landed — `EnhancedChatMessage`); C-343 (landed — dialogue message actions/branches); C-423 (a11y baseline, sequence 1); C-421 (`DiceCard`, sequence 2) |
| **Status** | draft |
| **Promotion** | `integrated` |
| **Docs Impact** | internal |
| **Contract version** | 3.0.0 |

## Problem & Baseline Evidence

Aikami implements "list of messages + composer" twice, and the two have drifted:

| Surface | File | Lines | Has |
|---|---|---|---|
| Chat | `views/chat/chat_view.svelte` + `chat_view_model.svelte.ts` | 1100 (VM) | `EnhancedChatMessage`, CYOA choices, slash commands, streaming TTS, impersonation, branches |
| Dialogue | `views/game/ui/overlays/dialogue/dialogue_overlay.svelte` | 692 | its own bubbles, its own action row, suggestion chips, CYOA choices, skill-check dice, branches |

Both were verified; the line counts are exact. The drift is not cosmetic —
each surface re-implements message actions, branch switching, and the composer
with different markup, so every message-layer improvement has to be built
twice. C-420 and C-421 both exist as separate contracts *because* of this
duplication: chips landed in dialogue only, rich messages landed in chat only.

Concretely, the same concepts are duplicated:

- Message action row: `components/chat/message_action_bar.svelte` vs
  `dialogue_overlay.svelte:298-377` (its own inline emoji buttons).
- Branch switcher: chat's `messageBranchStore` path vs
  `dialogue_overlay.svelte:530-554` (its own branch button row).
- Composer: both mount `AutoResizeTextarea`, with different surrounding markup
  and different send/disable rules.

- **Reproduction**: talk to an NPC in chat, then to the same NPC in-game.
  Message bubbles, action affordances, and branch controls all differ.
- **Baseline tests**: `chat_view_model` tests,
  `dialogue_overlay_view_model.test.ts`, `choice_buttons_view_model.test.ts`.
  All must be green before starting **and after each increment** — this
  contract must not change behaviour.

## User Outcome

A **player** gets the same rich message rendering, action affordances, branch
controls, dice cards and composer whether they are in the chat view or an
in-game dialogue. A **developer** adds a message-layer feature once instead of
twice.

## Success Measures

- **Time/latency target**: no regression. Message-list render must be at least
  as fast as today; verify with a long transcript (200+ messages).
- **Offline/degraded behavior**: unchanged per surface. The shared components
  must introduce no online requirement.
- **Production journey enabled**: message-layer work stops costing double, and
  the two NPC-interaction surfaces stop teaching the player two interfaces.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Rich message bubble | `components/chat/enhanced_chat_message.svelte` | reuse — becomes the row renderer |
| Message actions | `components/chat/message_action_bar.svelte` | reuse — post-C-423 |
| Swipe/alternates | `components/chat/message_swipe_controls.svelte` | reuse |
| Composer input | `components/chat/auto_resize_textarea.svelte` | reuse — wrap in `GuidedComposer` |
| Dice card | C-421 `DiceCard` | reuse |
| Chat surface | `views/chat/chat_view.svelte` | modify — consume shared components |
| Dialogue surface | `dialogue_overlay.svelte` | modify — consume shared components |
| ViewModel pattern | `BaseViewModel` / `BaseViewModelContainer` | reuse — unchanged |

## Overview

Extract `RichMessageList` and `GuidedComposer` from the chat implementation,
rewire chat to them with **zero behaviour change**, then rewire the dialogue
overlay to the same components while preserving its surface-specific concerns
(skill-check dice, NPC portraits, spatial speech bubble, combat escalation).

## Design Reference

- `views/chat/chat_view.svelte` — the richer surface; source of the extraction.
- `dialogue_overlay.svelte:290-380` (actions), `:500-554` (choices/branches),
  `:620-660` (composer) — the code being replaced.
- `BaseViewModel` / `BaseViewModelContainer` — the pattern to keep.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Extract into `components/messaging/` (not `components/chat/` — the point is
  that these are no longer chat-specific).
- `RichMessageList` owns: message rows, action bar, swipe/alternates, dice
  cards, streaming indicator, scroll anchoring. It owns **no** transport,
  **no** AI calls, **no** persistence.
- `GuidedComposer` owns: the textarea, send affordance, disabled state, and a
  slot for surface-specific extras. It owns **no** send logic — it calls back.
- Surface-specific concerns stay in the surface, passed in via snippets:
  dialogue keeps its `GameDice` skill-check overlay, portrait row, spatial
  speech bubble and combat escalation; chat keeps slash commands,
  impersonation and CYOA.
- **Increment 1 must be behaviour-preserving.** If a chat behaviour is hard to
  express in the shared component, keep it in chat via a snippet rather than
  changing it. Behaviour changes belong to C-420, not here.
- Keyed `{#each}` on message id; do not regress list performance.
- Inherits the C-423 accessibility baseline — no hover-only, no
  focus-invisible actions in the extracted components.

## State & Data Models

No new persistent state and no new schemas. The extraction introduces component
prop types only.

```typescript
type RichMessageListProps = {
  /** Rendered rows, keyed by id. */
  messages: RichMessage[];
  characterName?: string;
  avatarUrl?: string;
  /** Streaming indicator for the last row. */
  isStreaming?: boolean;
  onAction?(messageId: string, action: MessageAction): void;
  /** Surface-specific extras rendered under a given message. */
  renderFooter?: (messageId: string) => Snippet;
};

type GuidedComposerProps = {
  value: string;
  onInput(value: string): void;
  onSend(text: string): void;
  placeholder?: string;
  disabled?: boolean;
  /** Surface-specific controls (TTS toggle, impersonate, …). */
  extras?: Snippet;
  /** Rendered above the input — choices and chips (C-420 fills this). */
  above?: Snippet;
};
```

`RichMessage` is the existing C-231 message shape plus C-421's `dice` kind.
No new message type is introduced here.

## Quality Requirements

- **Offline/degraded mode**: preserved per surface; no new online dependency.
- **Accessibility/input**: inherits C-423. The refactor must not regress it —
  re-run C-423's `message_actions_a11y.spec.ts` against both surfaces.
- **Performance budget**: DOM layer only, no engine-loop impact. Measure
  render time on a 200-message transcript before and after; no regression.
- **Security/privacy**: no new data exposure; existing schemas reused.
- **Persistence/migration**: none — presentational refactor.
- **Cancellation/retry/idempotency**: streaming, abort and retry behaviour
  preserved exactly.
- **Observability**: preserve existing ViewModel logging; the extraction must
  not silently drop debug calls.

## Migration & Rollback

No persistent state changes. **Rollback**: revert per increment — chat's
original implementation remains the reference. Because this is a refactor of
two live surfaces, **each increment lands separately with the full existing
test suite green**; do not batch them.

## Scope Boundaries

- **In Scope:** extract `RichMessageList` + `GuidedComposer`; rewire chat
  (no behaviour change); rewire the dialogue overlay; preserve every
  surface-specific concern; tests.
- **Out of Scope, with reasons:**
  - **Vendor convergence.** `vendor_view.svelte` (628 lines) is a shop, not a
    conversation. Forcing it onto a message list risks degrading buying to
    satisfy an abstraction. Revisit only if a vendor gains real NPC
    conversation, and only on evidence that it looks better.
  - **ViewModel decomposition.** Moved to **C-425**. It is a pure refactor with
    no user-facing outcome and the highest risk in the original contract;
    bundling it here would gate three user-facing increments behind it.
  - Any change to chat or dialogue *behaviour* — that is C-420.
  - Engine, combat rules, or economy changes.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**Two independently-mergeable increments, in this order:**
1. Extract `RichMessageList` + `GuidedComposer`; rewire **chat** only. Chat
   behaviour identical. Ship.
2. Rewire the **dialogue overlay**. Ship.

Increment 1 is worthless-but-harmless alone; increment 2 is where the payoff
lands. Do not start increment 2 until increment 1 is green in `main`.

## Acceptance Criteria

### AC-1: Shared components extracted; chat behaviour unchanged

**Given** the chat surface today
**When** `RichMessageList` and `GuidedComposer` are extracted and chat is
rewired to them
**Then** every existing chat test passes unmodified, and rich streaming, CYOA
choices, message actions, swipe/alternates, dice cards and slash commands all
behave identically.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + E2E | existing `chat_view_model` tests **unmodified** + new `rich_message_list.test.ts`, `guided_composer.test.ts` | chat | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`, `moon run e2e:test-client`
- Integration: full chat session E2E before and after; **if an existing chat
  test needed editing, that is a behaviour change and a fail.**

### AC-2: Dialogue overlay consumes the shared components

**Given** an in-game dialogue
**When** the overlay is rewired to `RichMessageList` / `GuidedComposer`
**Then** it renders the same rich messages, action affordances, branch controls
and dice cards as chat, while keeping its skill-check `GameDice` overlay,
portrait row, spatial speech bubble, suggestion chips and combat escalation
intact.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Visual | `dialogue_overlay_view_model.test.ts` (extended) + before/after screenshots at 1280×720 and 800×600 | in-game dialogue | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`, `moon run e2e:run-visual-tests`
- Integration: talk to Elder Thalia, trigger a skill check with Rollo; assert
  the dice overlay and chips still work and messages use the shared renderer.

### AC-3: No accessibility or performance regression

**Given** both rewired surfaces
**When** C-423's a11y spec and a 200-message render benchmark are run
**Then** no serious/critical axe violations appear on either surface, and
message-list render time is no worse than the pre-refactor baseline.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | E2E + benchmark | `message_actions_a11y.spec.ts` (from C-423) run on both; recorded before/after render timings | chat + dialogue | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:test-client`
- Integration: record both timings in the Execution Report; a regression is a fail.

## Implementation Sequence

1. **Phase 1 (Extract)** — Create `components/messaging/rich_message_list.svelte`
   and `guided_composer.svelte` from chat's current markup. Do not improve
   anything while extracting.
2. **Phase 2 (Rewire chat)** — Point `chat_view.svelte` at them. Run the chat
   suite unmodified. Ship.
3. **Phase 3 (Rewire dialogue)** — Replace the overlay's bubble/action/branch/
   composer markup, keeping its snippets for dice, portraits and chips. Ship.
4. **Phase 4 (Validation)** — Full suite, a11y spec on both surfaces, render
   benchmark, `bun run typecheck`.

## Edge Cases & Gotchas

- The dialogue overlay parses NPC text into `*action*` / `"dialogue"` segments
  (`dialogue_overlay.svelte:26-50`, `formatNpcText`). Chat does **not**. Decide
  deliberately: either lift segment formatting into `RichMessageList` as an
  opt-in prop, or keep it as a dialogue-side snippet. Silently dropping it
  would visibly degrade in-game dialogue.
- The overlay is `role="dialog" aria-modal="true"`. Extracted components must
  not introduce focus traps or duplicate landmarks inside it.
- `dialogue_overlay.svelte` gates actions on `isStreaming` **and**
  `isResolvingSkillCheck`; chat gates only on sending. `GuidedComposer` needs a
  single `disabled` input rich enough for both — do not hardcode chat's rule.
- Scroll anchoring differs between a full-height chat view and a bottom-anchored
  overlay. Verify auto-scroll-on-new-message in both.
- Resist widening scope mid-refactor. Anything that improves behaviour belongs
  to C-420, which lands immediately after.

## Open Questions

Must be resolved before status becomes `approved`:

- **OQ-1 — does `formatNpcText` become shared behaviour or stay dialogue-only?**
  **Recommendation: make it shared and opt-in.** Chat conversations with an NPC
  contain the same `*action*` prose and currently render the asterisks raw;
  unifying is a small win, but it *is* a behaviour change for chat — so land it
  as a follow-up after AC-1 proves the extraction, not inside it.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-08-21 | Initial draft from UX review. | — |
| 3.0.0 | 2026-08-21 | Re-scoped and resequenced. Moved from P2/last to P1/position 3 — it is the precondition for C-420, and sequencing it after C-420/C-421 would have meant building two shared primitives before knowing the extraction constraints. Removed vendor convergence (a shop is not a conversation) and ViewModel decomposition (split to C-425; "line-count reduction is verified" rewarded moving code, not improving it). Added AC-3 (a11y + performance non-regression), a hard rule that editing an existing chat test is a fail, `formatNpcText` as a named gotcha, Implementation Sequence, Edge Cases, and lifecycle sections. | review 2026-08-21 |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** per increment; increment 2 additionally requires
`release_verified`-level before/after visual evidence.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
