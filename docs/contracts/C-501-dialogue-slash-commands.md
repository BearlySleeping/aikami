---
id: C-501
title: "Dialogue Slash Commands"
source: "direct"
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-08T14:01:09Z"
---

# Contract C-501: Dialogue Slash Commands

## Metadata

| Field | Value |
|---|---|
| **Source** | `tmp/TODO.md` — "allow slash commands in dialogue, like /generate to generate image, /tree to go back to the dialogue tree … /action (like) /look, or other commands that you kinda want to tell the GM and not the actual npc" |
| **Target** | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` + `apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts` + `apps/frontend/client/src/lib/services/gm/` — dialogue input routing |
| **Type** | full |
| **Priority** | P1 — expands dialogue input into three distinct destinations (image, tree, GM) without regressing free-text NPC dialogue |
| **Dependencies** | none (image generation + `generatedImages` already exist; GM address mode already exists) |
| **Status** | draft |
| **Promotion** | `integrated` — production route `/game` |
| **Docs Impact** | none |
| **Contract version** | 2.0.0 |
| **Production Surface** | `/game` (dialogue overlay) |

## Problem & Baseline Evidence

- **Current behavior**: every line typed in the dialogue overlay is sent to the NPC as a conversational turn. There is no way to (a) request an image mid-conversation, (b) rewind to a previous choice, or (c) speak to the GM directly rather than the NPC.
- **Reproduction**: open a dialogue with any NPC, type `/generate a forest clearing` — it is sent to the NPC as free text and the NPC responds conversationally instead of an image being produced.
- **Existing implementation to reuse**:
  - `dialogue_overlay_view_model.svelte.ts` `sendMessage` (~L1126) — single choke point where player text enters the dialogue pipeline.
  - `packages/shared/schemas/src/lib/game/npc_dialogue_command.ts` — the validated command union (`trade`, `offerQuest`, `skillCheck`, `giveItem`, `startCombat`, `recruit`) and `NpcDialogueChoice` (`id`, `label`, optional `command`, optional `nextDialogueKey`) — the "dialogue tree" is these choices.
  - `apps/frontend/client/src/lib/services/image/engine/comfyui_engine.svelte.ts` — image generation engine; the dialogue overlay already tracks `generatedImages` (`GeneratedImage[]`, anchored per message) and `imageProviderAvailable`, rendered by the `imageBlock` snippet in `dialogue_overlay.svelte` (C-162 devtools).
  - `apps/frontend/client/src/lib/types/gm.ts` `AddressMode = 'scene' | 'party' | 'gm'` and `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` (address-mode prompt sections, `[GM ONLY]` blocks ~L337, ~L549) — the GM-direct routing already exists.
- **Known gaps**:
  1. No slash-command parser before `sendMessage` forwards text.
  2. `/tree` has no pathway to re-present the previous turn's choices without re-executing commands.
  3. `/action`/`/look` have no GM-only routing — everything goes through the NPC.
- **Baseline tests**: `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts`, `npc_dialogue_service.test.ts`. Run before starting.

## User Outcome

After this contract, a player can type `/generate`, `/tree`, and `/action` (or `/look`) inside a dialogue to generate an image, revisit the last choice set, or address the GM directly — without breaking ordinary free-text conversation with the NPC.

## Success Measures

- **Time/latency target**: slash-command parsing adds no measurable input latency; `/generate` shows the `generating` state immediately.
- **Offline/degraded behavior**: `/generate` with no image provider shows a graceful inline error; `/tree` and `/action` depend only on local dialogue/GM state.
- **Production journey enabled**: a player can steer a conversation with both the NPC and the GM from the same input box.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Dialogue input choke point | `dialogue_overlay_view_model.svelte.ts` `sendMessage` | modify (pre-parse) |
| Image generation + inline render | `comfyui_engine.svelte.ts`, `generatedImages`, `imageBlock` snippet | reuse |
| Dialogue tree / choices | `NpcDialogueChoice` schema + choice rendering | reuse (re-present) |
| GM-direct routing | `AddressMode = 'gm'`, `gm_prompt_service.svelte.ts` | reuse |
| Command re-execution guard | `markCommandExecuted` / `wasCommandExecuted` | reuse |

## Overview

Add a slash-command layer at the dialogue input boundary. Leading `/` text is parsed into one of four outcomes — image, tree, GM, or help — and routed to the existing subsystems (image generation, choice re-presentation, GM prompt service) instead of the NPC dialogue pipeline. Unknown commands show inline help. Ordinary text is untouched.

## Design Reference

- Follow the existing choice-rendering and `imageBlock` snippets in `dialogue_overlay.svelte`; do not add parallel renderers.
- Route GM text through `gm_prompt_service` with address mode `gm` (see its `mode` handling and `[GM ONLY]` sections).
- Reuse `markCommandExecuted` / `wasCommandExecuted` so `/tree` cannot double-execute a choice command.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- Intercept at `sendMessage` (the ViewModel layer) — parse before any call into `npcDialogueService`.
- Keep command parsing pure and unit-testable (a `parseSlashCommand(text)` function returning a discriminated result); do not bury parsing in the view.

## State & Data Models

```ts
type SlashCommandResult =
  | { kind: 'generate'; prompt: string }
  | { kind: 'tree' }
  | { kind: 'gm'; text: string }
  | { kind: 'help' }
  | { kind: 'none' }; // not a slash command — forward as normal dialogue
```

No persisted schema changes. `/generate` reuses the existing `GeneratedImage` shape; `/tree` reuses `NpcDialogueChoice`.

## Quality Requirements

- **Offline/degraded mode**: `/generate` with no provider → inline error block, no crash; `/action`/`/look` work without network only insofar as the GM prompt service works (degrade to a "GM unavailable" message when offline).
- **Accessibility/input**: slash commands reachable purely by typing; `/tree` result and help text keyboard-navigable.
- **Performance budget**: no extra ticks; parsing is O(1) string inspection.
- **Security/privacy**: no new boundary; commands are local, never escape the client except through existing image/GM services.
- **Persistence/migration**: N/A — no persisted state.
- **Cancellation/retry/idempotency**: `/generate` must be abortable and must not duplicate images on retry; `/tree` must not re-execute commands.
- **Observability**: log `slash-command:parse` and `slash-command:dispatch` with `{ kind }`; keep existing dialogue logs intact.

## Migration & Rollback

N/A — no persistent state changes.

## Scope Boundaries

- **In Scope:**
  - Slash-command parser + dispatch at the dialogue input boundary.
  - `/generate` → image block via existing `generatedImages` flow.
  - `/tree` → re-present last turn's choices with command re-execution guard.
  - `/action`, `/look` (and a small allow-list of GM verbs) → GM address mode.
  - Inline help for unknown/empty commands.
- **Out of Scope:**
  - New image providers or image model changes.
  - Combat UI (C-500), intent-envelope resilience (C-499).
  - New dialogue command *kinds* in the schema union.
  - Changing the GM prompt content beyond routing a GM-addressed message.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** single contract — all three commands share one parse boundary and one input choke point.

## Acceptance Criteria

### AC-1: `/generate` produces an inline image
**Given** an active dialogue and an available image provider
**When** the player types `/generate <prompt>`
**Then** an image block enters the `generating` state immediately, renders inline when done, and the NPC does not receive the text as dialogue.
**Production Path**: `/game`

### AC-2: `/generate` degrades without a provider
**Given** `imageProviderAvailable` is false
**When** the player types `/generate <prompt>`
**Then** an inline error block is shown and no crash or stuck `generating` state occurs.
**Production Path**: `/game`

### AC-3: `/tree` re-presents the last choice set
**Given** a dialogue turn that produced choices
**When** the player types `/tree`
**Then** the previous turn's choices are shown again, and selecting one routes through the existing choice execution path without re-executing an already-executed command.
**Production Path**: `/game`

### AC-4: `/action` and `/look` address the GM
**Given** an active dialogue
**When** the player types `/action search for tracks` or `/look`
**Then** the instruction is routed to the GM address mode (`gm`), produces GM narration, and is not attributed to the NPC nor fed into NPC intent analysis.
**Production Path**: `/game`

### AC-5: Unknown commands and normal text are safe
**Given** the dialogue input
**When** the player types an unknown slash command, or plain text with no slash
**Then** unknown commands show inline help, and plain text continues to the NPC exactly as before (no regression).
**Production Path**: `/game`

**Evidence Matrix**:

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | E2E + unit | `dialogue_overlay_view_model.test.ts` + dialogue E2E | `/game` | Filled during verification |
| AC-2 | unit + manual | `dialogue_overlay_view_model.test.ts` | `/game` | Filled during verification |
| AC-3 | E2E + unit | `dialogue_overlay_view_model.test.ts` | `/game` | Filled during verification |
| AC-4 | E2E + unit | GM routing test | `/game` | Filled during verification |
| AC-5 | unit | `parseSlashCommand` unit test | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:typecheck`, `bun moon run client:test`
- Integration: manual `/game` smoke — dialogue → `/generate`, `/tree`, `/action`, unknown command, plain text.
- E2E / Visual:
    - **Functional**: extend the dialogue E2E (`apps/e2e/tests/client/`) with slash-command cases; POM for the dialogue input.
    - **Visual**: `apps/e2e/src/visual/suites/dialogue_slash_commands.visual.ts` — image block rendered inline with generating/done states; OpenRouter AI evaluation: "Score 90+: generated image visible in dialogue thread, choice list re-rendered after /tree."

**Watch Points**:
- **Parse before the NPC pipeline** — the single highest-risk mistake is letting `/generate …` reach the NPC as free text.
- **`/tree` vs executed-command guard** — re-presenting choices must respect `markCommandExecuted`/`wasCommandExecuted`, or redoing a `startCombat`/`recruit` choice double-fires.
- **GM routing must not mutate NPC dialogue state** — a `/action` should not append an NPC turn or spawn suggestion chips.
- **Do not build a second image renderer** — reuse `generatedImages` + the `imageBlock` snippet.
- **Empty prompt** (`/generate` with nothing after it) → treat as help, not an image request.

## Implementation Sequence

1. **Phase 1 (Parser)**: add `parseSlashCommand` with unit tests; wire the parse into `sendMessage` ahead of the NPC call.
2. **Phase 2 (Dispatch)**: route `generate` → existing image flow, `tree` → choice re-presentation, `gm` → GM prompt service; add help.
3. **Phase 3 (Validation)**: E2E + visual coverage; run `validate({ test: true })` and the Moon tasks above.

## Edge Cases & Gotchas

- **`/generate` during a streaming turn**: queue or reject cleanly — never interrupt an in-flight NPC turn.
- **`/tree` with no prior choices**: show help ("no previous choices").
- **Case/whitespace**: normalize `/Look`, `  /tree  `, and trailing whitespace before parsing.
- **Consecutive `/generate`**: each must anchor to the correct message index and not overwrite prior images.

## Open Questions

Must be resolved before status becomes `approved`:

- Exact allow-list of GM verbs beyond `/action` and `/look` (e.g. `/narrate`, `/hint`). Default: ship `/action` and `/look` only; extend later.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
