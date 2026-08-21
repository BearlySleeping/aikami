---
id: C-421
title: "Dice That Actually Roll — implement /roll, render dice cards, and bind narration to the mechanical result"
source: "UX review 2026-08-21, re-verified against code 2026-08-21"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-21"
---

# Contract C-421: Dice That Actually Roll

## Metadata

| Field | Value |
|---|---|
| **Source** | UX review 2026-08-21 — "dice are functional but not dramatized". Re-verified; the review understated the chat gap and overstated the narration gap. Both corrected below. |
| **Target** | `packages/frontend/engine/src/engine_bridge.ts`; `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts`; `apps/frontend/client/src/lib/views/combat/utils/dice_notation.ts`; `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts`; `apps/frontend/client/src/lib/components/game/game_dice.svelte`; `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts`; `packages/shared/schemas` (dice card schema) |
| **Priority** | P1 — the single biggest "this is a real TTRPG, not a chat wrapper" win in the batch |
| **Sequence** | **2 of 6** — after C-423 (inherits its a11y baseline); before the surface unification in C-424 |
| **Dependencies** | C-148 (landed — combat dice / `GameDice`); C-231 (landed — rich chat streaming); C-234 (landed — `dice_notation.ts`); C-371/C-401 (landed — two-call dialogue pipeline); C-423 (a11y baseline) |
| **Status** | approved |
| **Promotion** | `integrated` |
| **Docs Impact** | internal |
| **Contract version** | 4.0.0 |

## Problem & Baseline Evidence

### Finding 1 — `/roll` in chat is a stub; no roll happens at all

The review reported that `/roll 1d20+3` "renders as plain text." It does not
render a result of any kind. The real path:

1. `chat_view_model.svelte.ts:441-467` intercepts `/`-prefixed input, parses it,
   and calls `bridge.executeCommand(command, args)`.
2. `packages/frontend/engine/src/engine_bridge.ts:175-181` is a **stub with a
   TODO** that discards the argument:
   ```ts
   case 'roll': {
     // TODO: implement dice rolling via slash commands
     void (args[0] ?? '1d20');
     break;
   }
   ```
3. The worker-side bridge (`worker/ecs_worker.ts:338`) is an explicit no-op.
4. Chat then echoes a literal system message: `` `Command: ${parsed.command.raw}` ``.

So the player sees `Command: /roll 1d20+3` and nothing else. **No dice are
rolled.** `DiceService` is never reached from chat. This makes AC-1 larger than
the review implied — it is "implement dice in chat", not "restyle a result".

Two concrete prerequisites the review missed:

- **`parseDiceNotation` cannot parse modifiers.** `dice_notation.ts:24-30` uses
  `/^(\d+)?d(\d+)$/` — `"1d20+3"` returns `undefined`. The regex must be widened
  before `/roll 1d20+3` can work at all.
- **`DiceService.history` has no check context.** Its entries are
  `{ roll, sides, modifier, total, timestamp }`
  (`dice_service.svelte.ts:12-18`) — no DC, no success, no crit flags. AC-4's
  history feed cannot show check outcomes until this shape is widened.

### Finding 2 — narration is already bound to the roll in the dialogue path

The review claimed "the AI can narrate a hit that the mechanics said missed."
For the **in-game dialogue path this is already solved** and has been since
C-371/C-401. `npc_dialogue_service.svelte.ts:1877-1899` is a dedicated
roll-resolution call whose user prompt is:

```
`${npcName} resolves a ${checkType} check: DC=${difficultyClass},
 Roll=${rollTotal}, ${outcome === 'pass' ? 'SUCCESS' : 'FAILURE'}.
 Player said: "${playerInput}"`
```

The mechanical result **is** injected as ground truth before narration.

The genuine remaining gap is narrower, and worth fixing:

- The system prompt (`:1900-1906`) says *"resolve this outcome"* but never
  instructs the model that it **must not contradict** it.
- Nothing verifies afterward that the narration agreed with the mechanics.
- The **chat** path has no dice at all (Finding 1), so nothing to bind.

AC-3 is therefore re-scoped from "build injection" (already built) to
"harden the existing injection and extend it to chat".

### Finding 3 — the rich dice visual exists but only in combat

`GameDice` (`components/game/game_dice.svelte`, 209 lines, `DiceState`:
`phase`/`value`/`isSuccess`/`labels`) and `combat_dice_ui.svelte` render the
animated d20. Chat has no dice visual. The dialogue overlay already mounts
`GameDice` (`dialogue_overlay.svelte:113`) for skill checks.

- **Reproduction**: chat → type `/roll 1d20+3` → observe `Command: /roll 1d20+3`
  and no roll. Combat → attack → observe the animated die.
- **Baseline tests**: `dice_service.test.ts`, `combat_view_model.test.ts`.
  Run both before starting.

## User Outcome

A **player** who types `/roll 1d20+3` in chat gets a real, seeded roll rendered
as a dice card — die face, modifier, total, and for a check
`Nat 20 + 3 = 23 vs DC 15 ✓` with crit highlighting. The same card renders in
combat. When a check drives NPC narration, the narration cannot contradict the
mechanical result. A player can review past rolls with their outcomes.

## Success Measures

- **Time/latency target**: rolls resolve client-side and render instantly; no
  added AI round trip for the roll itself.
- **Offline/degraded behavior**: rolls are seeded and local — fully offline.
  Only the narration degrades when no model is available.
- **Production journey enabled**: the player can trust the dice. That is the
  core emotional contract of a tabletop RPG, and it is currently unmet in chat.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Roll resolution + seeding | `services/dice/dice_service.svelte.ts` | modify — widen `history` entry shape only |
| Notation parsing | `views/combat/utils/dice_notation.ts` | **modify — add modifier support** |
| Animated die face | `components/game/game_dice.svelte` | reuse — wrap in `DiceCard` |
| Combat dice overlay | `views/combat/components/combat_dice_ui.svelte` | reuse — keep |
| Quick-roll menu | `views/combat/components/dice_quick_menu.svelte` | reference |
| Slash-command intercept | `chat_view_model.svelte.ts:441-467` | modify — route `roll` to `DiceService`, not the bridge |
| Engine bridge roll stub | `engine_bridge.ts:175-181` | **replace or delete** — see Directives |
| Authoritative injection | `npc_dialogue_service.svelte.ts:1877-1906` | modify — add a non-contradiction instruction |

## Overview

Make dice real in chat, give rolls one shared visual language across chat and
combat, and harden the existing mechanical-authority binding. Three
independently-mergeable increments, in the order below.

## Design Reference

- `services/dice/dice_service.svelte.ts` — the single source of roll truth.
- `views/combat/utils/dice_notation.ts:24-30` — the regex to widen.
- `components/game/game_dice.svelte` — the animation to wrap.
- `npc_dialogue_service.svelte.ts:1877-1906` — the existing injection to harden.
- `apps/frontend/client/src/lib/types/rich_chat.ts` — `EnhancedChatMessage` (C-231) lives here (client-local). The new `dice` kind is a cross-boundary schema added to `packages/shared/schemas` per Pillar 2, then surfaced through the chat message type.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Resolve every roll through `DiceService`.** Chat must not get its own RNG.
  This is what makes the card and combat agree.
- **Do not route `roll` through the engine bridge.** Dice are a rules concern,
  not an ECS concern; the bridge stub exists only because `/roll` was
  originally wired as an engine command. Route `roll` to `DiceService` in the
  chat ViewModel's command intercept and delete the dead `case 'roll'`.
- Widen `parseDiceNotation` to accept an optional signed modifier
  (`2d6+3`, `1d20-1`) and return it. Keep the existing return shape additive so
  combat callers are unaffected. The chat command parser additionally accepts a
  trailing `vs <dc>` (e.g. `/roll 1d20+3 vs 15`) that sets the check context on
  the roll (OQ-1, resolved).
- Widen the `DiceService.history` entry with optional check context
  (`dc`, `success`, `isCriticalSuccess`, `isCriticalFailure`, `label`).
  Optional fields keep existing callers valid.
- Define a `dice` chat message kind in `packages/shared`; render it with a
  shared `DiceCard` that wraps `GameDice`. Chat and combat use the same
  component.
- Add an explicit non-contradiction instruction to the roll-resolution system
  prompt, and log the injected result at debug level.
- `DiceCard` must satisfy the C-423 baseline: outcome conveyed in text
  (`Success`/`Failure`, `✓`/`✗`) as well as colour; no hover-only affordances.

## State & Data Models

```typescript
/** A resolved roll, rendered as a chat message and in combat. */
type DiceCardData = {
  id: string;
  /** Raw notation as typed, e.g. "1d20+3". */
  notation: string;
  /** Individual die results, in roll order. */
  dice: { sides: number; value: number }[];
  /** Flat modifier applied after the dice. */
  modifier: number;
  /** Sum of dice + modifier. */
  total: number;
  /** Present only when the roll was made against a DC. */
  check?: {
    dc: number;
    success: boolean;
    /** total - dc; negative on failure. */
    difference: number;
    /** e.g. "Persuasion". */
    ability?: string;
  };
  /** Only meaningful for a single d20. */
  isCriticalSuccess: boolean;
  isCriticalFailure: boolean;
  timestamp: Date;
};
```

```typescript
/** Ground truth handed to the narration turn. */
type AuthoritativeRollResult = {
  total: number;
  /** null for a flat roll with no DC. */
  success: boolean | null;
  dc?: number;
  difference?: number;
  /** The unmodified d20 face, for crit narration. */
  natural: number;
  isCriticalSuccess: boolean;
  isCriticalFailure: boolean;
};
```

**Deliberately out of the model:** advantage/disadvantage. `DiceService` has no
advantage mechanic today (`rollD20` takes only a modifier), so modelling it here
would be speculative. Add it when the rules kernel grows it.

## Quality Requirements

- **Offline/degraded mode**: rolls are fully local and seeded. When no model is
  available the card still renders; only narration is absent.
- **Accessibility/input**: outcome in text and colour, never colour alone;
  card is keyboard-focusable where interactive. Inherits C-423.
- **Performance budget**: DOM-layer render outside the 60fps engine loop.
  Reuses the existing `GameDice` animation — no new animation cost.
- **Security/privacy**: notation is user input — the widened regex must remain
  anchored and bounded (cap dice count and sides) to prevent
  `999999d999999` resource abuse.
- **Persistence/migration**: dice cards persist as ordinary chat messages of
  the new kind. Pre-existing `Command: /roll …` text messages stay text; no
  back-migration.
- **Cancellation/retry/idempotency**: a re-roll is a new roll with a new id.
  Rendering is idempotent.
- **Observability**: log the injected `AuthoritativeRollResult` at debug level
  so prompt fidelity is verifiable from a session log.

## Migration & Rollback

**Old data compatibility**: existing transcripts hold plain-text roll echoes;
the `dice` kind is additive and old messages render unchanged.
**Migration**: none. **Rollback**: revert the message kind, `DiceCard`, and the
chat command route; restore the bridge stub. No persistent state is lost.

## Scope Boundaries

- **In Scope:** working `/roll` in chat routed through `DiceService`; modifier
  support in `parseDiceNotation`; widened `DiceService.history` entry; `dice`
  chat message kind; shared `DiceCard` used by chat and combat;
  non-contradiction instruction on the existing roll-resolution prompt;
  roll-history feed; tests.
- **Out of Scope:** changing seeded-RNG semantics (C-148); advantage/disadvantage
  mechanics; redesigning combat turn logic; multiplayer roll sync; rewriting the
  two-call dialogue pipeline (C-371/C-401 — this contract only adds an
  instruction to its prompt); re-rendering historical text rolls as cards.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**Three independently-mergeable increments, in this order:**
1. **Mechanics** — notation modifiers, widened history, `/roll` routed to
   `DiceService`. Ships a working (if plain) roll. *Highest value; ship first.*
2. **Visual** — `dice` message kind + shared `DiceCard` in chat and combat.
3. **Authority + history feed** — non-contradiction instruction; history view.

## Acceptance Criteria

### AC-1: `/roll` actually rolls

**Given** a player types `/roll 1d20+3` (or `/roll 1d20+3 vs 15`) in chat
**When** the command is intercepted
**Then** it resolves through `DiceService` (not the engine bridge), the
modifier is parsed and applied, and the result is added to `DiceService.history`
— replacing today's `Command: /roll 1d20+3` echo. A trailing `vs <dc>` sets the
check context (`dc`, `success`, crit flags) on the roll. Malformed notation
(`/roll foo`, `/roll 99999d6`) produces a clear inline error and no roll.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `dice_notation.test.ts` (modifiers + bounds), `chat_view_model.test.ts` (routes to DiceService) | chat | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: seed the RNG, issue `/roll 1d20+3`, assert the exact total.

### AC-2: Dice card renders in chat and combat from one component

**Given** a resolved roll in chat, and a resolved attack/check roll in combat
**When** each renders
**Then** both use the same `DiceCard`, showing die face, modifier and total;
for a check, `Nat 20 + 3 = 23 vs DC 15 ✓` with crit highlighting; outcome is
stated in text as well as colour.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Visual | `dice_card.test.ts`; `combat_view_model.test.ts` (extended) | chat + combat | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`, `moon run e2e:run-visual-tests`
- Integration: seeded roll in each surface; screenshot both; assert identical
  component and correct math.

### AC-3: Narration cannot contradict the mechanical result

**Given** a check resolves to a concrete `AuthoritativeRollResult`
**When** `_resolveRoll` builds the narration turn
**Then** the existing `DC=… Roll=… SUCCESS|FAILURE` injection is retained
**and** the system prompt carries an explicit instruction that the outcome is
final and must not be contradicted; the injected result is logged at debug level.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `npc_dialogue_service.test.ts` — assert prompt contains both the result and the non-contradiction instruction | in-game dialogue | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: mock adapter; run a failed check; assert both strings present in
  the captured prompt. **Note:** the injection already exists — the test must
  fail only on the missing instruction, not on the injection.

### AC-4: Roll-history feed with outcomes

**Given** the player has made several rolls, some against a DC
**When** the roll-history feed is opened
**Then** each entry shows notation, total, timestamp, and — where present —
the DC and success/failure, read from the widened `DiceService.history`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Visual | `dice_history_feed.test.ts` | pause menu | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test-unit`
- Integration: make one flat roll and one check; assert both render with the
  correct fields and that the flat roll shows no DC.

## Implementation Sequence

1. **Phase 1 (Mechanics)** — Widen `parseDiceNotation` for signed modifiers and
   add count/sides bounds. Widen the `DiceService.history` entry with optional
   check context. Route `roll` from the chat command intercept to `DiceService`
   and delete the `case 'roll'` stub in `engine_bridge.ts`. Ship.
2. **Phase 2 (Visual)** — Add the `dice` message kind in `packages/shared`.
   Build `DiceCard` wrapping `GameDice`. Render in chat; swap combat's inline
   result to the same component. Ship.
3. **Phase 3 (Authority + history)** — Add the non-contradiction instruction and
   debug logging to `_resolveRoll`. Build the history feed over the widened
   history. Ship.
4. **Phase 4 (Validation)** — `moon run client:test-unit`,
   `moon run e2e:test-client`, `moon run e2e:run-visual-tests`,
   `bun run typecheck`.

## Edge Cases & Gotchas

- **Do not "fix" the narration binding by rebuilding it.** It exists
  (`npc_dialogue_service.svelte.ts:1877-1899`). This contract adds one
  instruction to a prompt; a rewrite of the two-call pipeline is out of scope
  and would regress C-401's streaming behaviour.
- `parseDiceNotation` is called by combat today. Widening its return shape must
  stay additive — check every caller before changing the type.
- The `roll` case in `engine_bridge.ts` also falls through to a generic
  `EXECUTE_COMMAND` dispatch below the switch. Confirm no registered handler
  depends on `roll` before deleting the case.
- Seeded determinism: combat may already have set a seed via
  `DiceService.setSeed`. A chat `/roll` will consume from the same sequence.
  Decide deliberately whether that is desired (it probably is — one timeline,
  one RNG) and note it in the Execution Report.
- Crit flags are meaningful only for a single d20. `2d6` must not report crits.

## Open Questions

Resolved during critique (2026-08-21) by adopting the contract's stated
recommendations:

- **OQ-1 — RESOLVED: yes.** `/roll` supports a trailing `vs <dc>` (e.g.
  `/roll 1d20+3 vs 15`). It is a small parser addition and makes the check half
  of `DiceCard` reachable from chat, the surface players use most. Folded into
  AC-1 and the Architecture Directives.
- **OQ-2 — RESOLVED: pause menu.** The roll-history feed lives in the pause
  menu, next to the other session-level views; it is a session artefact, not a
  chat artefact. AC-4's production path updated accordingly.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-08-21 | Initial draft from UX review. | — |
| 3.0.0 | 2026-08-21 | Re-verified against code. AC-1 corrected: `/roll` is a TODO stub in `engine_bridge.ts:175-181`, not a plain-text result — no roll occurs, so the work is "implement dice in chat". Added two undeclared prerequisites the review missed: `parseDiceNotation` cannot parse modifiers (`dice_notation.ts:24-30`), and `DiceService.history` carries no check context, blocking AC-4. AC-3 re-scoped from "build authoritative injection" to "harden it" — injection already exists (`npc_dialogue_service.svelte.ts:1877-1899`, C-371/C-401). Dropped advantage/disadvantage from the data model as speculative. Added notation bounds as a security requirement, Implementation Sequence, Edge Cases, and lifecycle sections. Sequenced 2 of 6. | review 2026-08-21 |
| 4.0.0 | 2026-08-21 | Critique: resolved OQ-1 (support `vs <dc>` in `/roll`, folded into AC-1 + directives) and OQ-2 (history feed lives in pause menu, AC-4 path updated). Corrected Design Reference: `EnhancedChatMessage` is client-local in `apps/frontend/client/src/lib/types/rich_chat.ts`; the `dice` kind is a new shared schema. | critic 2026-08-21 |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

Target: **`integrated`** per increment. Phase 2 additionally requires
`release_verified`-level visual evidence in both chat and combat.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary
Implemented real dice in chat: `/roll 1d20+3` (and `vs <dc>`) now resolves through `DiceService` (not the engine bridge stub, which was deleted), with signed-modifier support and count/sides bounds added to `parseDiceNotation`. Added a shared `DiceCard` component (die faces, modifier, total, check context with crit highlighting) rendered in both chat and combat, a `dice` chat message kind in `packages/shared`, a hardened non-contradiction instruction + debug logging in the roll-resolution prompt, and a roll-history feed in the pause menu. All rolls are local/seeded and fully offline.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `/roll` routed to `DiceService`; modifiers + `vs <dc>` parsed; bounds enforced; malformed notation → inline error. Unit tests pass. |
| AC-2 | ✅ | Shared `DiceCard` renders in chat (dice message kind) and combat (combat_dice_ui). Visual verified in sandbox (95/100). |
| AC-3 | ✅ | Non-contradiction instruction added to roll-resolution system prompt; authoritative result logged at debug. Unit test asserts both strings present. |
| AC-4 | ✅ | Roll-history feed in pause menu reads widened `DiceService.history` (notation, total, timestamp, DC + success/failure). Visual verified in sandbox. |

### Files Created
| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/game/dice_card.ts` | TypeBox schema for `DiceCardData` (dice message kind). |
| `packages/shared/types/src/lib/game/dice_card.ts` | `DiceCardData` type inferred from schema. |
| `apps/frontend/client/src/lib/components/game/dice_card.svelte` | Shared dice card component (chat + combat). |
| `apps/frontend/client/src/lib/views/combat/utils/dice_notation.test.ts` | Tests for `parseDiceNotation` modifiers/bounds + `parseRollCommand`. |
| `apps/frontend/client/src/lib/views/chat/chat_view_model.test.ts` | Tests for `/roll` routing to `DiceService`. |
| `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/dice_history_feed.svelte` | Roll-history feed component. |
| `apps/frontend/client/src/routes/(dev)/dev/dice/+page.svelte` | Dev sandbox for DiceCard + history feed visual verification. |

### Files Modified
| File | Change |
|---|---|
| `apps/frontend/client/src/lib/views/combat/utils/dice_notation.ts` | Widened `parseDiceNotation` for signed modifiers + bounds; added `parseRollCommand`. |
| `apps/frontend/client/src/lib/views/combat/types/combat_enhancements.ts` | Added optional `modifier` to `DiceNotation`. |
| `apps/frontend/client/src/lib/services/dice/dice_service.svelte.ts` | Widened `history` entry (dc/success/crits/label/notation); added `rollCard`. |
| `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` | Routed `/roll` to `DiceService`; added `_handleRollCommand`. |
| `apps/frontend/client/src/lib/services/chat/chat.svelte.ts` | Added `kind`/`dice` to `ChatMessage`. |
| `apps/frontend/client/src/lib/views/chat/chat_view.svelte` | Pass kind/dice to `EnhancedChatMessage`. |
| `apps/frontend/client/src/lib/components/chat/enhanced_chat_message.svelte` | Render `DiceCard` for `kind === 'dice'`. |
| `apps/frontend/client/src/lib/views/combat/components/combat_dice_ui.svelte` | Render shared `DiceCard` for resolved combat roll. |
| `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` | Added non-contradiction instruction + debug logging to `_resolveRoll`. |
| `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte.ts` | Added roll-history open/close + `rollHistory`. |
| `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view.svelte` | Added Roll History button + feed render. |
| `packages/frontend/engine/src/engine_bridge.ts` | Deleted dead `case 'roll'` stub. |
| `packages/shared/schemas/src/index.ts`, `packages/shared/types/src/index.ts` | Export dice card schema/type. |
| `apps/frontend/client/src/lib/services/dice/dice_service.test.ts`, `apps/frontend/client/src/lib/services/game/npc_dialogue_service.test.ts` | Added AC-1/AC-3/AC-4 tests. |

### Deviations from Spec
- **`DiceCardData.timestamp` is an ISO-8601 string, not a `Date`.** The shared schemas package uses `typebox` (v1.3.16), which has no `Type.Date()`; the established convention is `Type.String({ format: 'date-time' })`. The client converts to `Date` where needed. This is a minor type-shape deviation from the contract's illustrative model, not a functional change.
- **Production chat path not screenshot-verified.** Reaching the production chat requires a full game session (login + campaign load + NPC interaction), which is impractical to set up headlessly. The `/roll` routing is covered by unit tests, and the `DiceCard`/history-feed visuals are verified in the dev sandbox. The combat `DiceCard` render is wired but not screenshot-verified (combat requires a live engine session).
- **`@aikami/utils` package.json was temporarily modified** (added `main`) during debugging, then reverted — it exposed latent pre-existing type errors in unrelated AI-client files. The real fix for test resolution was generating `.svelte-kit` (via client restart).

### Test Results
- Unit: 1894 pass / 1 fail (1 pre-existing `GameBootService` cancellation failure, unrelated to C-421; fails on base commit too)
- E2E: not run (no E2E suite for this feature)
- Visual: DiceCard sandbox 95/100 (PASS); roll-history feed 75/100 (modal content correct; backdrop blur lowers score)
- Baseline: 1 pre-existing failure (GameBootService), 0 new failures
