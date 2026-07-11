## Metadata
<!-- audit: legacy — no execution report -->

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/GAME_MODE.md` (world-gen phase, setup wizard, sessions lifecycle); TODO.md C-ME-004 |
| **Target** | `apps/frontend/client/src/routes/setup/` + `apps/frontend/client/src/lib/views/worldgen/` — Session Zero / World Generation Wizard |
| **Priority** | P1 — Transforms the game from a static map into an AI-generated living world; foundational for GM-driven narrative |
| **Dependencies** | C-123 (Character Creation Flow — COMPLETED), C-175 (JTON Map Pipeline — COMPLETED), C-230 (Connection config — COMPLETED), `textGenerationService.extractStructure()` (C-080 — COMPLETED), `gameSaveService` (C-132 — COMPLETED), `persona_create_view_model.svelte.ts` (AI character extraction — EXISTS) |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

Aikami currently launches directly into character creation (`/setup` → `PersonaCreateView`) with a pre-authored static map. Marinara-Engine's Game Mode transforms this into a rich, AI-driven Session Zero: a multi-step setup wizard collects the player's genre, tone, difficulty, setting, and goals, then fires a single large structured-JSON LLM call that generates a complete world — overview, story arc, plot twists, starting NPCs with roles and reputations, party quest hooks, an art style prompt, and a HUD blueprint. This world state seeds the starting map (via JTON pipeline), populates the GM's system prompt, and persists across sessions. This contract replaces the bare `/setup` route with a full wizard flow, adding world-gen before character creation.

## Design Reference

**Existing code to extend:**
- `apps/frontend/client/src/routes/setup/+page.svelte` — currently a thin wrapper mounting `PersonaCreateView`; will become the wizard entry point
- `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` — Start Menu with New Game / Continue branching; already calls `gameStateService.reset()` for New Game
- `apps/frontend/client/src/lib/views/character/persona/create/persona_create_view_model.svelte.ts` — AI-driven character creation with `CharacterExtractionSchema`; will be the final wizard step
- `apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts` — already handles save/load with ECS snapshot; will persist world-gen output
- `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` — `extractStructure()` for strict JSON output; reused for world-gen
- `apps/frontend/client/src/lib/data/ai_prompts/` — existing AI prompt schemas; new `world_gen_schema.ts` will be added here
- C-175 (JTON Map Pipeline) — completed; NPC/POI placement on map from world-gen output
- C-230 (Connection config) — completed; wizard uses the default connection for the world-gen call

**Marinara-Engine inspiration:**
- Setup wizard: `examples/Marinara-Engine/docs/GAME_MODE.md` (four-step wizard — Genre & Setting, Party & GM, You & Model, Goals)
- World-gen JSON: `examples/Marinara-Engine/docs/GAME_MODE.md` (world overview, story arc, plot twists, starting map, NPC roster, party arcs, character sheets, art style prompt, HUD blueprint)
- Session lifecycle: `examples/Marinara-Engine/docs/GAME_MODE.md` (end session summary, session recap on resume)
- Lorebooks for world-gen: `examples/Marinara-Engine/docs/GAME_MODE.md` (constant entries baked into initial world)

**Testing conventions:** See `.pi/skills/testing/SKILL.md`. Playwright tests in `apps/e2e/tests/client/`, visual tests in `apps/e2e/src/visual/suites/`, POMs in `apps/e2e/src/pom/`, dev sandbox at `routes/(dev)/dev/`.

## Architecture Directives

- **Wizard ViewModel**: Create `world_gen_wizard_view_model.svelte.ts` managing multi-step flow: Genre/Tone → Setting/Difficulty → Goals → World Gen → Character Creation. Each step validates its inputs before advancing. Back navigation supported.
- **World-gen LLM call**: Uses `textGenerationService.extractStructure()` with a Zod schema (`WorldGenSchema`). The prompt includes genre, tone, difficulty, setting, goals, and any attached lorebook entries. Returns structured JSON or a retryable error.
- **World-gen output schema**: A single JSON document with `worldOverview` (prose), `storyArc` (GM-only secret), `plotTwists` (GM-only secrets), `startingLocation` (name + description), `npcs` (array of name/role/location/reputation/traits), `partyArcs` (per-character quest hooks), `artStylePrompt` (20-40 words for image gen), `hudWidgets` (up to 4 widget blueprints).
- **Map seeding**: After world-gen succeeds, dispatch NPCs and location data to the JTON pipeline (C-175) via `GameStateService`. Entity placement respects the generated starting map.
- **GM prompt assembly**: World-gen output is compiled into a system prompt stored in `gameSaveService` state. Every subsequent AI interaction includes this context.
- **Retry handling**: If the LLM returns invalid JSON (missing fields, wrong types), show the error and offer retry. Maximum 3 automatic retries before prompting the user to adjust their inputs.
- **"Surprise Me!" flow**: One-click mode that fills all wizard fields with sensible defaults and fires world-gen immediately — no manual input required.

## State & Data Models

    // ── Wizard Step ─────────────────═══════════════════════

    type WizardStep = 'genre' | 'setting' | 'goals' | 'generating' | 'character';

    // ── Wizard Input ─────────────────══════════════════════

    interface WorldGenInput {
        genres: string[];        // ["Fantasy", "Horror"] — multi-select
        customGenre?: string;    // Free-form addition
        tone: string[];          // ["Heroic", "Dark", "Comedic", "Gritty", "Whimsical", "Serious"]
        difficulty: 'casual' | 'normal' | 'hard' | 'brutal';
        setting: string;         // Free-text, one sentence describing the world
        playerGoals: string;     // Free-text, short paragraph
        additionalPreferences: string; // Free-text, for pacing/style/limits
        language: string;        // "en", "ja", "ko", etc. — default "en"
    }

    // ── World-Gen Output (LLM structured response) ─════════

    interface WorldGenOutput {
        worldOverview: string;           // 2-3 paragraphs of narrative setting
        storyArc: string;                // Secret — GM only, overarching narrative arc
        plotTwists: string[];            // Secret — GM only, 2-4 planned twists
        startingLocation: {
            name: string;
            description: string;         // 1-2 paragraphs
            atmosphere: string;          // "A damp, torchlit cavern..."
        };
        npcs: WorldGenNpc[];             // 3-6 starting NPCs
        partyArcs: PartyArc[];           // Personal quest hooks — one per party member
        artStylePrompt: string;          // 20-40 words for image generation consistency
        hudWidgets: HudWidgetBlueprint[]; // Up to 4 widget definitions
    }

    interface WorldGenNpc {
        name: string;
        role: string;                    // "Innkeeper", "Suspicious Merchant", "Town Guard"
        location: string;                // Where they're found initially
        reputation: number;              // -10 to +10 — starting disposition toward player
        traits: string[];                // ["Greedy", "Cowardly", "Loves gossip"]
        description: string;             // 1-2 sentences of appearance + manner
    }

    interface PartyArc {
        characterName: string;           // Matches a party member / persona name
        hook: string;                    // "Find the lost crown of Aldren..."
        reward: string;                  // "The Crown of Aldren — grants +2 CHA"
        antagonistNpc?: string;          // NPC name tied to this arc
    }

    interface HudWidgetBlueprint {
        id: string;                      // "kingdom-wealth", "party-morale"
        label: string;                   // "Kingdom Wealth"
        type: 'gauge' | 'counter' | 'timer' | 'stat-block';
        initialValue: number;
        maxValue?: number;
        theme: string;                   // "medieval", "sci-fi", "horror"
    }

    // ── World-Gen Result (wizard state) ─═══════════════════

    interface WorldGenResult {
        status: 'idle' | 'generating' | 'success' | 'error';
        output?: WorldGenOutput;
        error?: string;                  // Validation or LLM error message
        retryCount: number;
    }

    // ── Surprise Me! Presets ─────────────────══════════════

    // Pre-defined genre/tone/setting combos for one-click starts:
    const SURPRISE_ME_PRESETS = [
        { genres: ['Fantasy'], tone: ['Heroic'], difficulty: 'normal',
          setting: 'A war-torn kingdom with ancient ruins' },
        { genres: ['Cyberpunk'], tone: ['Gritty'], difficulty: 'hard',
          setting: 'A neon-lit city of hackers and megacorps' },
        { genres: ['Horror'], tone: ['Dark'], difficulty: 'brutal',
          setting: 'A cursed forest hiding a forgotten god' },
        { genres: ['Fantasy', 'Comedic'], tone: ['Whimsical'], difficulty: 'casual',
          setting: 'A magical academy where everything goes wrong' },
    ];

## Scope Boundaries

- **In Scope:**
  - Multi-step wizard ViewModel with Genre/Tone → Setting/Difficulty → Goals → World Gen → Character Create flow
  - `WorldGenInput` and `WorldGenOutput` type schemas with Zod validation
  - World-gen LLM call via `textGenerationService.extractStructure()` with structured JSON output
  - Wizard step navigation (forward/back/restart) with input persistence
  - Genre multi-select with suggestion chips and custom input
  - Tone multi-select, difficulty single-select radio
  - Setting free-text with clickable suggestion chips
  - Player Goals free-text with suggestion chips
  - "Surprise Me!" one-click mode (pre-filled defaults → skip to world-gen)
  - Retry logic: max 3 auto-retries on invalid JSON; user prompt to adjust inputs after
  - World-gen output preview (read-only) before accepting and proceeding to character creation
  - Map seeding: dispatch NPCs, locations, and quest hooks to `GameStateService` / JTON pipeline (C-175)
  - GM prompt assembly: world-gen output compiled into system prompt stored in save data
  - Dev sandbox route `/dev/world-gen` for isolated testing with mock LLM responses
  - Unit tests for wizard state machine, Zod schema validation, retry logic
  - Playwright E2E tests in `apps/e2e/tests/client/world_gen.spec.ts`
  - Visual tests in `apps/e2e/src/visual/suites/world_gen.visual.ts`
  - POM for the wizard (`apps/e2e/src/pom/world_gen_wizard_page.ts`)
- **Out of Scope:**
  - Lorebook integration for world-gen seeding (C-ME-009 covers lorebooks)
  - Session lifecycle (end session summary, resume recap) — C-ME-011 covers this
  - Game Mode-specific UI (address modes, GM toggle) — C-ME-012 covers this
  - Party management UI (adding/removing party members in wizard) — the party step is persona creation (already exists)
  - World regeneration / "reroll world" mid-game (separate contract)
  - Image generation from world-gen artifacts (C-ME-013 covers this)
  - Publishing/sharing generated worlds (separate contract)

## Acceptance Criteria

### AC-1: Multi-Step Wizard with Navigation
**Given** the player clicks "New Game" from the Start Menu
**When** the wizard loads
**Then** they see Step 1 (Genre/Tone) with a "Next" button; clicking "Next" validates inputs and advances to Step 2 (Setting/Difficulty); clicking "Back" returns to Step 1 with preserved inputs; all 4 wizard steps (Genre, Setting, Goals, World Gen) are traversable with forward/back navigation

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `wizard_state_machine.test.ts` — test `advanceStep()` validates current step before advancing; `goBack()` returns to previous step with preserved state; `restart()` resets all inputs; invalid inputs block advance with error message
- Integration: Dev sandbox at `/dev/world-gen` — click through all steps, go back, verify inputs preserved
- E2E / Visual:
    - **Functional**: `tests/client/world_gen.spec.ts` — test "New Game → verify Genre step → select genres → Next → verify Setting step → Back → verify genres still selected"
    - **Visual**: `suites/world_gen.visual.ts` — `defineConfig({ id: 'wizard-genre', route: '/dev/world-gen', cases: [{ name: 'Wizard — Genre/Tone step', prompt: 'Verify multi-select genre chips (Fantasy, Sci-Fi, Horror, Cyberpunk, etc.), tone checkboxes, Next button enabled after at least one genre selected. Clean DaisyUI step indicator showing "Step 1 of 4".', schema: WizardGenreSchema }] })`

**Watch Points**:
- Step indicator: "Step 1 of 4: Genre & Tone", "Step 2 of 4: Setting & Difficulty", etc.
- Next button disabled until required fields are filled (at minimum: 1 genre selected)
- Back button is hidden on Step 1, visible on Steps 2+
- Inputs persist across back/forward navigation (store in `$state`, not DOM)

### AC-2: World-Gen LLM Call with Structured Output
**Given** the player completes all wizard input steps and clicks "Generate World"
**When** the world-gen LLM call fires
**Then** a loading spinner with estimated time is shown; on success, the `WorldGenOutput` is parsed and validated against the Zod schema; a preview panel shows the world overview, NPC list, and party arcs; the player can accept or retry

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `world_gen_schema.test.ts` — test `WorldGenSchema.parse(validOutput)` succeeds; test `WorldGenSchema.parse(missingFields)` throws with specific field errors; test `WorldGenSchema.parse(wrongTypes)` throws
- Unit Test: `world_gen_view_model.test.ts` — mock `extractStructure()` returning valid output → verify `worldGenResult.status === 'success'`; mock returning invalid JSON → verify `status === 'error'` with message; mock network error → verify retry increments count
- E2E / Visual:
    - **Functional**: `tests/client/world_gen.spec.ts` — mock `extractStructure()` with valid output → test "Generate World → verify preview panel shows world overview, NPCs, party arcs → Accept → proceeds to character creation"; mock with error → verify "Generation failed" with retry button
    - **Visual**: `suites/world_gen.visual.ts` — case showing world-gen preview panel with world overview card, NPC list cards, party arc cards

**Watch Points**:
- The world-gen call is expensive (large JSON output). Use `extractStructure()` with `additionalProperties: false` + strict Zod schema
- Maximum 3 auto-retries on validation failure. After 3, show the raw error and prompt user to adjust inputs
- Show token usage estimate: "This generation uses ~8K tokens. Continue?"
- Timeout: 120 seconds for the world-gen call (it's a large structured output)
- The GM prompt must separate "visible to player" (world overview, starting location) from "GM-only" (story arc, plot twists)

### AC-3: "Surprise Me!" One-Click Mode
**Given** the player is on the Genre/Tone step
**When** they click the "Surprise Me!" button
**Then** all wizard fields are filled with random sensible defaults; the wizard auto-advances to the Generating step; world-gen fires immediately without further input

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `surprise_me.test.ts` — test `generateSurpriseMeInput()` returns valid `WorldGenInput` with at least 1 genre, 1 tone, non-empty setting, non-empty goals; test randomness (two calls produce different results most of the time)
- E2E / Visual:
    - **Functional**: `tests/client/world_gen.spec.ts` — test "click Surprise Me → verify genre/tone pre-filled → verify auto-advances to Generating step → verify world-gen fires"
    - **Visual**: N/A (covered by AC-2 functional)

**Watch Points**:
- Surprise Me is available on every step — not just Step 1. Clicking it from Step 2 fills Step 1 too.
- The Surprise Me button should have a dice or sparkle icon
- Must never produce empty/invalid inputs — always generate at least 1 genre + 1 tone + non-empty setting

### AC-4: Map Seeding from World-Gen Output
**Given** world-gen has produced a valid `WorldGenOutput`
**When** the player accepts the world and proceeds to character creation
**Then** the NPCs from the world-gen output are dispatched to the JTON pipeline / `GameStateService`; starting location is set; party arcs are stored; the configured HUD widgets are initialized

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `map_seeding.test.ts` — test `seedNpcs(worldGenOutput)` calls `GameStateService.addNpc()` for each NPC; test `seedLocation(output.startingLocation)` sets location name + description; test `seedPartyArcs(output.partyArcs)` stores arcs in save data
- E2E / Visual:
    - **Functional**: `tests/client/world_gen.spec.ts` — test "accept world → verify game loads with NPCs in starting location → verify HUD widgets visible"
    - **Visual**: N/A (map rendering is visual but covered by C-175 map visual tests)

**Watch Points**:
- NPC placement must respect the existing tilemap — don't place NPCs in walls
- If an NPC's location doesn't match any existing map location, place them at the starting location with a warning
- HUD widgets must not overwrite existing game state — merge, don't replace
- Party arcs are stored in save data but not displayed until the party member joins

### AC-5: GM Prompt Assembly
**Given** world-gen output has been accepted
**When** the game starts and any AI interaction occurs (dialogue, combat, exploration)
**Then** the system prompt includes a structured GM context containing world overview, story arc (GM-only), active plot twists, current location, nearby NPCs with reputations, and party arcs

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `gm_prompt_assembly.test.ts` — test `assembleGmPrompt(worldGenOutput, gameState)` produces prompt with all sections; test GM-only data (storyArc, plotTwists) is NOT visible in player-facing output; test prompt length under 4KB; test null-safe (missing fields produce graceful fallbacks)
- E2E / Visual:
    - **Functional**: `tests/client/world_gen.spec.ts` — test "complete wizard → start dialogue with NPC → inspect system prompt (via debug/dev mode) → verify world overview and story arc present"
    - **Visual**: N/A (prompt inspection is functional)

**Watch Points**:
- GM prompt must distinguish between "player-visible" and "GM-secret" information
- Story arc and plot twists are injected into the system message with `[GM ONLY - DO NOT REVEAL TO PLAYER]` prefix
- Player-visible info (world overview, location, NPCs) is accessible to both GM and character responses
- Prompt length must stay under 4KB for the world context section — summarize if needed

### AC-6: World-Gen Retry Handling
**Given** the world-gen LLM call returns invalid JSON (missing fields, wrong types, or truncated)
**When** validation fails
**Then** an error message is shown with a retry button; up to 3 automatic retries occur; after 3 failures, the user is prompted to adjust their inputs or try a different model; the Generating step shows debug info (raw LLM output for diagnostics)

**Test Hooks**:
- Moon Task: `moon run client:test`
- Unit Test: `world_gen_retry.test.ts` — test retry counter increments on each failure; test auto-retry stops at 3; test user can manually retry after auto-limit; test back button works from error state (returns to Goals step)
- E2E / Visual:
    - **Functional**: `tests/client/world_gen.spec.ts` — mock `extractStructure()` 3x failure → verify "Generation failed after 3 attempts. Please adjust your settings." with "Edit Inputs" button; mock success on 2nd retry → verify preview panel shows on 2nd attempt
    - **Visual**: `suites/world_gen.visual.ts` — case showing error state with retry count, raw output toggle, and "Edit Inputs" button

**Watch Points**:
- Show truncated raw output in a collapsible `<details>` element — helps debugging
- Common failure cause: model too weak for strict JSON. Show model recommendation hint: "Consider using a more capable model (Claude Opus, GPT-4o, Gemini Pro)"
- Error must NOT expose API keys or full raw HTTP headers

### AC-7: Dev Sandbox — Isolated Testing
**Given** the developer navigates to `/dev/world-gen`
**When** the page loads
**Then** the full wizard is displayed with mock LLM responses — all steps navigable, "Surprise Me!" functional, world-gen preview with mock data, retry simulation, and a "View GM Prompt" debug panel

**Test Hooks**:
- Moon Task: `moon run client:dev` (manual verification)
- E2E / Visual:
    - **Functional**: `tests/client/world_gen.spec.ts` — test sandbox loads, complete wizard flow with mock data, Surprise Me, retry simulation, prompt preview
    - **Visual**: `suites/world_gen.visual.ts` — `defineConfig({ id: 'world-gen-sandbox', route: '/dev/world-gen', cases: [{ name: 'Wizard — All Steps', setupHook: advanceToWorldGenStep, prompt: 'Verify all wizard steps with filled inputs, world-gen preview with mock NPC cards, step indicator, and "View GM Prompt" button visible.', schema: SandboxSchema }, { name: 'World Gen Preview — Mock Success', setupHook: showMockPreview, prompt: 'Verify preview panel shows world overview card with prose text, NPC list with name/role/reputation badges, party arc cards, and Accept/Retry buttons.', schema: PreviewSchema }] })`

## Implementation Sequence

### Phase 1: Data Layer
1. Define `WorldGenInput`, `WorldGenOutput`, `WorldGenNpc`, `PartyArc`, `HudWidgetBlueprint` types in `packages/shared/types/`
2. Create `WorldGenSchema` (Zod) in `apps/frontend/client/src/lib/data/ai_prompts/world_gen_schema.ts` — strict validation with `additionalProperties: false`
3. Create `SURPRISE_ME_PRESETS` constant — 4-6 pre-defined genre/tone/setting combos
4. Create wizard step state machine helper: `WizardStep`, `advanceStep()`, `goBack()`, `canAdvance()`, `canGoBack()`
5. Create `assembleGmPrompt(output, gameState): string` — compiles world-gen output into GM system prompt
6. Create `seedWorldState(output)`: dispatches NPCs, locations, party arcs to `GameStateService` / JTON pipeline
7. Write unit tests: `world_gen_schema.test.ts`, `wizard_state_machine.test.ts`, `gm_prompt_assembly.test.ts`, `map_seeding.test.ts`, `surprise_me.test.ts`, `world_gen_retry.test.ts`

### Phase 2: ViewModel
1. Create `world_gen_wizard_view_model.svelte.ts` extending `BaseViewModel`
2. State: `currentStep`, `worldGenInput` (all wizard fields), `worldGenResult` (status/output/error), `isGenerating`
3. Methods: `setGenre()`, `setTone()`, `setDifficulty()`, `setSetting()`, `setGoals()`, `setAdditionalPreferences()`, `advanceStep()`, `goBack()`, `generateWorld()`, `retryGeneration()`, `acceptWorld()`, `surpriseMe()`, `restart()`, `editInputs()`, `getGmPromptPreview()`
4. Wire `advanceStep()` to read-only preview for `worldGenResult.output`
5. Wire `acceptWorld()` to `seedWorldState()` + navigate to character creation
6. Write unit test: `world_gen_view_model.test.ts`

### Phase 3: Views
1. Create `world_gen_wizard_view.svelte` — DaisyUI layout with:
   - Step indicator bar (1-4 steps + Generating badge)
   - Genre/Tone step: multi-select chips, genre icons, tone radio/checkboxes
   - Setting/Difficulty step: textarea with suggestion chips, difficulty radio cards
   - Goals step: textarea with suggestion chips, additional preferences textarea
   - Generating step: spinner + status text + token estimate + elapsed time
   - Preview step: world overview card, NPC list as DaisyUI cards with badges, party arc cards, Accept/Retry buttons
   - Error state: error message, retry button, raw output toggle, "Edit Inputs" button
   - "Surprise Me!" button on every step
2. Update `routes/setup/+page.svelte` to render `world_gen_wizard_view` as the entry point
3. Create dev sandbox: `routes/(dev)/dev/world-gen/+page.svelte` + `world_gen_sandbox_view_model.svelte.ts`

### Phase 4: Integration
1. Wire world-gen into the New Game flow: Start Menu → wizard → world-gen → character creation → game world
2. Integrate `assembleGmPrompt()` into dialogue and combat AI prompt assembly
3. Store world-gen output in `gameSaveService` for persistence across sessions
4. Update `/setup` route to use the new wizard; `/setup?skip-wizard=true` skips to character creation (for dev/testing)

### Phase 5: Validation
1. `moon run client:fix && moon run client:typecheck` — ensure zero type errors
2. `moon run client:test` — unit tests for schemas, state machine, prompt assembly, map seeding, retry logic
3. `cd apps/e2e && bun run test` — Playwright functional tests
4. `cd apps/e2e && bun run test:visual` — AI visual tests
5. Manual: `/dev/world-gen` sandbox — complete wizard flow, Surprise Me, retry simulation, prompt preview

## Edge Cases & Gotchas

- **World-gen model requirement**: This is the single most demanding LLM call in the system. The world-gen prompt is large and the output is strict JSON. Warn the user if their default connection uses a model known to fail structured generation (free-tier OpenRouter, models < 13B parameters). Show a model recommendation toast: "For best results, use Claude Opus, GPT-4o, or Gemini Pro."
- **Token budget**: The world-gen input prompt + output JSON can exceed 16K tokens. Ensure the connection's `maxTokens` is set to at least 8192 before firing. If the user's connection has low `maxTokens`, warn them before generating.
- **JSON truncation at maxTokens boundary**: If `maxTokens` is too low, the JSON will be cut off mid-structure → validation fails. Detect partial JSON (unclosed braces) and show a clear error: "The model ran out of output tokens. Increase maxTokens on your connection and retry."
- **NPC count variability**: The LLM may generate 2 or 12 NPCs. Cap NPCs at 8 — drop excess with a warning. Map seeding must handle variable NPC counts gracefully.
- **Party arcs vs actual party**: Party arcs reference character names, but the party is created during character creation (next step). Store arcs by name; resolve to party members after character creation.
- **World-gen takes time**: The LLM call can take 15-45 seconds. Show an engaging loading screen with progress text: "Summoning the world...", "Placing mountains and rivers...", "Populating towns..."
- **Backward compatibility**: Existing save files don't have world-gen data. On first load of a pre-wizard save, inject a minimal default `WorldGenOutput`: `{ worldOverview: "A generic fantasy world.", storyArc: "", plotTwists: [], startingLocation: { name: "Unknown", description: "", atmosphere: "" }, npcs: [], partyArcs: [], artStylePrompt: "fantasy art", hudWidgets: [] }`. The game must work without world-gen data.
- **Surprise Me randomness**: Use a seeded PRNG based on `Date.now()` so results are deterministic for debugging when needed. Expose the seed in dev mode.
- **Language support**: The wizard language selector defaults to the browser locale. Pass it to the world-gen prompt so generated world prose is in the correct language.
