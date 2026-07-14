## Metadata
<!-- audit: legacy — no execution report -->

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/GAME_MODE.md` (GM system, address modes, session lifecycle), `docs/ROLEPLAY.md` (Narrative Director, Secret Plot); TODO.md C-ME-006 |
| **Target** | `apps/frontend/client/src/lib/services/gm/` + `apps/frontend/client/src/lib/views/chat/` — AI Game Master prompt assembler, Narrative Director, address modes, session summarization |
| **Priority** | P1 — The GM is the heart of the D&D experience; this makes the world feel alive and reactive |
| **Dependencies** | C-230 (Connection config — COMPLETED), C-232 (Character Sheet — COMPLETED for AI serialization), C-233 (World-Gen Wizard — COMPLETED for world state + GM prompt data), C-145 (Combat — COMPLETED for encounter state), C-140 (Game Mode System — COMPLETED), `textGenerationService` (C-080 — COMPLETED), `dialogue_overlay_view_model` (`_buildSystemPrompt()` — EXISTS), `world_gen_system_prompt.ts` (C-233 — EXISTS), `GameStateService` (ECS bridge — EXISTS) |
| **Status** | done |
| **Contract version** | 1.0.0 |

## Overview

Aikami currently has scattered prompt building: the dialogue overlay has `_buildSystemPrompt()` for NPC personality, the world-gen wizard stores `WorldGenOutput`, and individual AI schemas define action/combat prompts. Missing is the central **GM Prompt Assembler** — a single function querying all game state and producing a coherent system prompt injected into every AI interaction. Marinara-Engine provides this plus two more layers: **Address Modes** (Scene/Party/GM toggles in chat input) and a **Narrative Director** agent (background LLM maintaining hidden arc memory and scene directions). This contract builds the GM prompt engine, adds address mode routing, and establishes session summarization for long-running campaigns.

## Design Reference

**Existing code to extend:**
- `dialogue_overlay_view_model.svelte.ts` — `_buildSystemPrompt()` (line 654) builds NPC personality prompt; extends to accept GM context
- `apps/frontend/client/src/lib/data/ai_prompts/world_gen_system_prompt.ts` — base GM template from C-233
- `apps/frontend/client/src/lib/data/ai_prompts/world_gen_schema.ts` — `WorldGenOutput` type
- `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` — `streamChat()` with system message injection
- `apps/frontend/client/src/lib/services/ai/clients/ai/types.ts` — `systemPrompt?: string` field
- `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` — `sendMessage()` flow with slash-command dispatch
- `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` — combat state feeds GM context

**Marinara-Engine inspiration:**
- GM system: `examples/Marinara-Engine/docs/GAME_MODE.md` (standalone GM, character GM, per-turn prompt assembly)
- Address modes: `examples/Marinara-Engine/docs/GAME_MODE.md` (Scene/Party/GM toggle, color-coded)
- Narrative Director: `examples/Marinara-Engine/docs/ROLEPLAY.md` (Secret Plot, arc memory, scene directions, Push Story)
- Session lifecycle: `examples/Marinara-Engine/docs/GAME_MODE.md` (end session summary, resumePoint, recap)

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **GM Prompt Assembler**: New singleton `gmPromptService` in `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts`. `assemblePrompt(mode)` queries all state sources and produces formatted system prompt. Cached, invalidated on state change.
- **State sources**: `GameStateService` (map, location, NPCs, time, weather, combat), `gameSaveService` (world-gen output), character sheet serialization (C-232), inventory, quests, recent chat history.
- **Address Mode routing**: Scene (full GM prompt, in-character), Party (party members respond), GM (OOC, lighter prompt). DaisyUI button group in chat input.
- **Narrative Director**: Background LLM call at configurable interval (default every 10 turns). Produces `SceneDirection` injected into next GM prompt. Maintains `ArcMemory` stored per-campaign. "Push Story" button for manual trigger.
- **Session summarization**: Low-temperature LLM call (t=0.45) on "End Session". Produces `SessionSummary` with recap, resume point, party dynamics, NPC updates. Next session starts with recap message.
- **No backend changes**: All prompt assembly is client-side.

## State & Data Models

    type AddressMode = 'scene' | 'party' | 'gm';

    interface GmPromptContext {
        worldOverview: string;
        storyArc: string;               // GM-only
        plotTwists: string[];           // GM-only
        currentLocation: { name: string; description: string; };
        activeNpcs: GmNpcContext[];
        characterSheet: string;         // C-232 serialization
        inventory: string[];
        activeQuests: string[];
        combatState?: GmCombatContext;
        timeOfDay: string;
        weather: string;
        recentChatHistory: string;      // Last 5-10 messages summarized
        playerNotes: string;
    }

    interface GmNpcContext {
        name: string; role: string; reputation: number;
        traits: string[]; hp: number; maxHp: number; isHostile: boolean;
    }

    interface GmCombatContext {
        active: boolean; round: number;
        playerHp: number; playerMaxHp: number;
        enemies: { name: string; hp: number; maxHp: number; status: string }[];
        lastAction: string;
    }

    interface SceneDirection {
        shortTermGuidance: string;
        needsMomentumShift: boolean;
        suggestedNpcAction?: string;
    }

    interface ArcMemory {
        overallArc: string; protagonistArc: string;
        isComplete: boolean; lastUpdatedTurn: number;
    }

    interface SessionSummary {
        narrativeRecap: string; resumePoint: string;
        partyDynamics: string; keyDiscoveries: string[];
        npcUpdates: { name: string; reputationChange: number; note: string; }[];
        statSnapshot: { level: number; xp: number; hp: number; maxHp: number; };
    }

## Scope Boundaries

- **In Scope:**
  - `gmPromptService` with `assemblePrompt(addressMode)` querying all state sources
  - GM prompt: world overview, story arc (GM-only), plot twists (GM-only), location, NPCs with reputations, character sheet, inventory, quests, time, weather, combat state, recent chat summary
  - Address mode toggle (Scene/Party/GM) in chat input — DaisyUI button group, color-coded
  - Address-mode-specific prompt scoping
  - Narrative Director agent: background LLM at configurable interval, produces SceneDirection
  - Arc Memory: persistent per-campaign in save data
  - "Push Story" manual trigger button
  - Session summarization: End Session → structured LLM summary → stored
  - Session recap: Start Session → recap message from resumePoint
  - Dev sandbox: `/dev/gm-system`
  - Unit tests, Playwright E2E (`tests/client/gm_system.spec.ts`), Visual (`suites/gm_system.visual.ts`), POM (`src/pom/gm_system_page.ts`)
- **Out of Scope:**
  - Agent pipeline orchestration (C-ME-007)
  - Lorebook integration (C-ME-009)
  - Expression/emotion agents (C-ME-010)
  - Multi-agent parallelism (C-ME-007)
  - Full session lifecycle UI (C-ME-011)

## Acceptance Criteria

### AC-1: GM Prompt Assembler
**Given** game in progress with world-gen data, character sheet, NPCs, game state
**When** AI interaction triggers (dialogue, combat, exploration)
**Then** `gmPromptService.assemblePrompt('scene')` produces system prompt with all sections; GM-only data marked `[GM ONLY]`; prompt injected as first system message

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `gm_prompt_assembler.test.ts` — all sections present, GM-only markers, combat section conditional, under 6KB, null-safe for missing data, NPC reputation formatting
- E2E: `tests/client/gm_system.spec.ts` — verify all sections in prompt via dev mode
- Visual: N/A (functional)

### AC-2: Address Mode Toggle
**Given** chat input visible during gameplay
**When** player toggles Scene/Party/GM
**Then** mode changes highlight color; Scene=in-character GM, Party=party members respond, GM=OOC direct answers

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `address_mode.test.ts` — mode state, prompt scoping per mode, persistence in metadata
- E2E: `tests/client/gm_system.spec.ts` — toggle modes, verify responses
- Visual: `suites/gm_system.visual.ts` — Address Mode toggle group with color coding

### AC-3: Narrative Director Agent
**Given** Director enabled at configurable interval (every 5/10/20 turns)
**When** turn counter reaches interval
**Then** background LLM produces SceneDirection; injected into next GM prompt; Push Story button for manual trigger

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `narrative_director.test.ts` — interval check, structured output via Zod, guidance injection, manual override
- E2E: `tests/client/gm_system.spec.ts` — interval triggering, Push Story
- Visual: `suites/gm_system.visual.ts` — Push Story button + guidance display

### AC-4: Arc Memory
**Given** Narrative Director running across sessions
**When** campaign progresses through story beats
**Then** ArcMemory (overallArc, protagonistArc, isComplete) persists in save data; injected into GM prompt; Director stops when arc complete

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `arc_memory.test.ts` — load/save/update, completion flag, prompt injection
- E2E: `tests/client/gm_system.spec.ts` — persist across reload, completion stops guidance

### AC-5: Session Summarization
**Given** significant session played (50+ messages)
**When** "End Session" clicked
**Then** low-t LLM produces SessionSummary (recap, resumePoint, party dynamics, discoveries, NPC updates, stat snapshot); stored; new session shows recap message

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `session_summarization.test.ts` — all fields, Zod validation, resumePoint non-empty, under 2KB, t=0.45
- E2E: `tests/client/gm_system.spec.ts` — end session → summary preview → new session → recap message
- Visual: `suites/gm_system.visual.ts` — summary preview panel

### AC-6: Dev Sandbox
**Given** navigate to `/dev/gm-system`
**When** page loads
**Then** chat area with address mode toggle, GM Prompt debug panel with [GM ONLY] markers, Narrative Director controls, session lifecycle simulator

**Test Hooks**:
- E2E: `tests/client/gm_system.spec.ts` — sandbox loads, all interactions
- Visual: `suites/gm_system.visual.ts` — 2 cases (full layout + prompt debug detail)

## Implementation Sequence

### Phase 1: Data Layer
1. Define types + Zod schemas for all models
2. Create `gmPromptService` singleton
3. Create `narrativeDirectorService`
4. Create `sessionSummaryService`
5. Unit tests: `gm_prompt_assembler.test.ts`, `address_mode.test.ts`, `narrative_director.test.ts`, `arc_memory.test.ts`, `session_summarization.test.ts`

### Phase 2: ViewModel Integration
1. Extend DialogueOverlayViewModel + ChatViewModel with GM prompt injection, address mode, Director wiring, session methods
2. Unit test: `gm_view_model_integration.test.ts`

### Phase 3: Views
1. `address_mode_toggle.svelte`, `push_story_button.svelte`, `session_summary_panel.svelte`
2. Wire into existing chat views
3. Dev sandbox: `routes/(dev)/dev/gm-system/`

### Phase 4: Validation
1. `moon run client:fix && moon run client:typecheck`
2. `moon run client:test`
3. `cd apps/e2e && bun run test`
4. `cd apps/e2e && bun run test:visual`

## Edge Cases & Gotchas

- **Prompt token budget**: Under 6KB. Cap NPCs at 8, summarize long sections.
- **GM-only data leak**: Markers are instructions to LLM, not a guarantee. Acceptable for single-player.
- **Director rate limiting**: Default interval 10 turns, minimum 3. Configurable.
- **Address mode persistence**: Stored in chat metadata. Survives reload.
- **Session summarization model failure**: Show raw output for manual editing on failure.
- **Arc memory editing**: "Reveal Spoilers" toggle for power users. Default hidden.
- **Party mode without party**: Button disabled with tooltip.
- **Session chaining**: Each session inherits game state, fresh chat log. Previous summary always in prompt.
