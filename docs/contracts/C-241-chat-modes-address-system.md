## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/GAME_MODE.md` (address modes, impersonation), `docs/ROLEPLAY.md` (impersonation config, `/impersonate` command), `docs/CONVERSATION.md` (group chat, manual replies); TODO.md C-ME-012 |
| **Target** | `apps/frontend/client/src/lib/views/chat/` — Impersonation mode + Party chat routing refinements |
| **Priority** | P2 — Separates in-character RP from out-of-character mechanics talk; completes the address mode system |
| **Dependencies** | C-235 (GM/Narrative Director — COMPLETED for `AddressMode` type, `gmPromptService`, `address_mode_toggle` component), C-231 (Rich Chat — COMPLETED for message action bar), `textGenerationService` (C-080 — COMPLETED) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

C-235 (AI Game Master) already built the address mode toggle UI (`address_mode_toggle_view`) and the three-mode prompt routing (Scene/Party/GM). Two features remain from Marinara's address system: **impersonation mode** — the `/impersonate [direction]` slash command that drafts a message as the player's persona (editable before sending), and **party chat refinements** — when addressing Party mode, routing responses through party member personas with distinct voices. Both are lightweight additions that complete the address system.

## Design Reference

**Existing code:**
- `apps/frontend/client/src/lib/views/gm/address_mode_toggle_view.svelte` + `_view_model.svelte.ts` — C-235's toggle, already wired into chat input
- `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` — `sendMessage()` flow with slash command dispatch
- `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` — C-235's `assemblePrompt()` with party-mode scoping

**Marinara-Engine inspiration:**
- Impersonation: `examples/Marinara-Engine/docs/ROLEPLAY.md` (`/impersonate [direction]`, quick button, prompt template, agent skipping)
- Address modes: `examples/Marinara-Engine/docs/GAME_MODE.md` (Scene/Party/GM toggle, color-coded)

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **Impersonation mode**: A `/impersonate [direction]` slash command (or quick button in input bar). The LLM generates a message as the player's persona based on recent chat context + optional direction. The generated text appears in the input field for editing — NOT auto-sent. User can edit then send, or discard.
- **Impersonation prompt**: Uses the active persona's description, personality, and traits (C-232) to draft in-character. System prompt: "Write the next message as [persona name]. Match their voice. [direction text]."
- **Party chat refinements**: When Party mode is active, the response prompt includes `[PARTY MODE]` instruction and lists each party member with name + personality. Response routes through `gmPromptService.assemblePrompt('party')` which already exists.
- **No new backend**: All prompt assembly is client-side via existing services.

## State & Data Models

    // Impersonation config (stored in chat metadata):
    interface ImpersonationConfig {
        quickButtonEnabled: boolean;    // Show impersonate button in input bar
        promptTemplate?: string;        // Custom override (empty = built-in default)
        skipAgents: boolean;            // Skip agent pipeline during impersonation
    }

## Scope Boundaries

- **In Scope:**
  - `/impersonate [direction]` slash command — drafts player persona message
  - Impersonate quick button in chat input (optional, toggle in chat settings)
  - Generated text placed in input field for editing (not auto-sent)
  - Impersonation prompt uses active persona from C-232 + recent context
  - Party mode routing refinements — multi-character voice distinction in prompt
  - Chat settings toggle for impersonation quick button + skip agents option
  - Dev sandbox: `/dev/chat-modes`
  - Unit tests, Playwright E2E (`tests/client/chat_modes.spec.ts`), Visual (`suites/chat_modes.visual.ts`), POM (`src/pom/chat_modes_page.ts`)
- **Out of Scope:**
  - Address mode toggle UI (C-235 — already completed)
  - GM/Party prompt assembly (C-235 — already completed)
  - Group chat with character picker (separate contract)

## Acceptance Criteria

### AC-1: Impersonation Slash Command
**Given** the player types `/impersonate I examine the ancient runes carefully`
**When** the command is dispatched
**Then** an LLM call generates a message in the player persona's voice; the generated text appears in the input field (not auto-sent); the player can edit or discard

**Test Hooks**:
- Unit Test: `impersonation.test.ts` — slash command parsing, LLM prompt assembly with persona, result placed in input field
- E2E: `tests/client/chat_modes.spec.ts` — type `/impersonate ...` → verify draft appears in input → edit → send → verify message sent as user

### AC-2: Impersonation Quick Button
**Given** impersonation quick button is enabled in chat settings
**When** the player clicks the impersonate button (🎭 icon) next to the chat input
**Then** the same impersonation flow runs with empty direction (context-only draft)

**Test Hooks**:
- E2E: `tests/client/chat_modes.spec.ts` — enable quick button → click → verify draft → send
- Visual: `suites/chat_modes.visual.ts` — quick button in input bar

### AC-3: Party Mode Voice Distinction
**Given** Party address mode is active with 2+ party members
**When** the player sends a message in Party mode
**Then** the response includes each party member speaking in their distinct voice (name + personality from C-232)

**Test Hooks**:
- Unit Test: `party_routing.test.ts` — party prompt includes all members with personalities
- E2E: `tests/client/chat_modes.spec.ts` — toggle Party mode → send → verify multi-character response

### AC-4: Dev Sandbox
**Given** navigate to `/dev/chat-modes`
**When** page loads
**Then** chat area with all 3 address modes (from C-235), impersonation command test, quick button toggle, party members mock

**Test Hooks**:
- E2E: functional
- Visual: `suites/chat_modes.visual.ts` — sandbox layout

## Implementation Sequence

### Phase 1: Data Layer
1. Impersonation prompt template + config schema
2. Party mode prompt enrichment
3. Unit tests: `impersonation.test.ts`, `party_routing.test.ts`

### Phase 2: ViewModel
1. `impersonation_service.ts` — generate draft, place in input
2. Extend `ChatViewModel` with `/impersonate` command + quick button
3. Unit test: `impersonation_viewmodel.test.ts`

### Phase 3: Views
1. Impersonate quick button in chat input
2. Chat settings: impersonation config (quick button toggle, skip agents)
3. Dev sandbox: `/dev/chat-modes`

### Phase 4: Validation
1. `moon run client:fix && moon run client:typecheck && moon run client:test`
2. `cd apps/e2e && bun run test && bun run test:visual`

## Edge Cases & Gotchas

- **Impersonation without persona**: If no active persona is set, show a toast: "Set up your persona first in the Character Sheet."
- **Impersonation + agents**: By default, skip the agent pipeline during impersonation (faster). Configurable in settings.
- **Direction text empty**: If `/impersonate` with no direction, the LLM generates purely from recent context — useful for "what would my character do?"
- **Impersonation editing**: The generated text should be in the input field, NOT sent. This is a drafting tool, not auto-play.
