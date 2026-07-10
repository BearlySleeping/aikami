<!-- completed: 2026-07-10 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/FRONTEND.md` (CYOA agent — post_processing, `cyoa_choices` result type, `CyoaChoices` component, `cyoaChoices` in agent store), `docs/ROLEPLAY.md` ("Use CYOA as direction" for impersonation), `docs/ARCHITECTURE_MAP.md` (`CyoaChoices.tsx` as roleplay surface component), `docs/GAME_MODE.md` (game-mode agent layering); TODO.md C-ME-016 |
| **Target** | `apps/frontend/client/src/lib/services/agent/agents/` + `apps/frontend/client/src/lib/views/chat/` + `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/` — CYOA agent, choice button UI, choice history tracker |
| **Priority** | P2 — Low complexity, medium impact. Gives non-typing users a guided interaction path; excellent for mobile |
| **Dependencies** | C-236 (Agent Pipeline System — COMPLETED for `agentPipelineService`, `AgentConfig`, `AgentPhase`, `AgentRunResult`), C-231 (Rich Chat — COMPLETED for message rendering + `chat_view_model`), `textGenerationService.extractStructure()` (C-080 — COMPLETED), `ChatSchema` + `MessageSchema` in `@aikami/schemas` (EXISTING) |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

Aikami's agent pipeline (C-236) already runs pre/post agents on every AI turn, and the chat system (C-231) renders messages with swipe/branch support. What's missing is Marinara-Engine's **CYOA agent** — a lightweight post-processing agent that reads the AI's narrative response and proposes 2–4 structured player choices, rendered as interactive DaisyUI buttons inline after the AI message. Selecting a choice posts it as a user message and advances the conversation. This contract adds the CYOA agent (registered as a built-in agent in the pipeline), the choice button UI with skill-check hints, and a per-chat choice history tracker so the GM can reference past decisions.

## Design Reference

**Existing code to extend:**
- `apps/frontend/client/src/lib/services/agent/agent_pipeline_service.svelte.ts` — C-236's pipeline; new agent registered here
- `apps/frontend/client/src/lib/services/agent/agents/` — C-236's built-in agent directory (e.g., `world_state_agent.svelte.ts`, `quest_tracker_agent.svelte.ts`)
- `apps/frontend/client/src/lib/services/agent/agent_types.ts` — C-236's `AgentConfig`, `AgentPhase`, `AgentRunResult`
- `apps/frontend/client/src/lib/services/agent/agent_result_types.ts` — C-236's result type union; add `cyoa_choices`
- `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` — message send/display flow
- `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` — in-game dialogue overlay
- `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` — `extractStructure()` for structured CYOA output

**Marinara-Engine inspiration:**
- CYOA agent: `examples/Marinara-Engine/docs/FRONTEND.md` — listed as `cyoa` agent, `post_processing` phase, result type `cyoa_choices`
- Agent store: `examples/Marinara-Engine/packages/client/src/stores/agent.store.ts` — `cyoaChoices` field in agent pipeline state
- CYOA component: `examples/Marinara-Engine/docs/ARCHITECTURE_MAP.md` — `CyoaChoices.tsx` as Roleplay surface component
- "Use CYOA as direction": `examples/Marinara-Engine/docs/ROLEPLAY.md` — clicking a CYOA choice feeds it to impersonation as guidance
- Choice blocks in presets: `examples/Marinara-Engine/docs/FRONTEND.md` — `prompt.schema.ts` choice blocks, `usePresetVariables()` hook

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **CYOA agent**: A new built-in agent in `apps/frontend/client/src/lib/services/agent/agents/cyoa_agent.svelte.ts`. Registered as `'cyoa'` in the agent constants. Phase: `'post_processing'` — runs after the main AI response. Prompt template: "Given this narrative and character context, propose 2–4 player choices..." Output schema: Zod schema validating `{ choices: { id: string; label: string; description?: string; skillCheck?: { ability: string; dc: number } }[] }`.
- **Result type**: Add `'cyoa_choices'` to the agent result type union (C-236's `agent_result_types.ts`). The result carries `{ choices: CYOAChoice[] }`.
- **Choice UI**: A new Svelte 5 component `ChoiceButtonsView` (`choice_buttons_view.svelte` + `_view_model.svelte.ts`) that renders a DaisyUI `join`/`btn` stack below the latest AI message. Each choice button shows the label, optional description tooltip, and optional skill-check badge (`[Persuasion DC 15]`). Selected choice → `viewModel.selectChoice(choiceId)` → posts as user message via `chatViewModel.sendMessage(choice.label)`.
- **Choice history**: A `$state` Map in the chat ViewModel tracking `choiceId → { selectedAt, label, wasInfluencedBy? }`. Injected into the GM prompt context via `gmPromptService` so the GM can reference past decisions.
- **Integration with impersonation (C-241)**: When impersonation mode is active and "Use CYOA as direction" is toggled, clicking a CYOA choice feeds it to the impersonation draft instead of posting directly as a user message.

## State & Data Models

**CYOA choice shape** — the structured output from the CYOA agent:

```typescript
interface CYOAChoice {
    /** Unique identifier within this choice set. */
    id: string;
    /** The action text displayed on the button (1–8 words). */
    label: string;
    /** Optional longer description shown on hover/focus. */
    description?: string;
    /** Optional D&D-style skill check hint. */
    skillCheck?: {
        /** Ability score name: STR, DEX, CON, INT, WIS, CHA. */
        ability: string;
        /** Difficulty class for the skill check. */
        dc: number;
    };
}

/** CYOA agent structured output — 2–4 choices. */
interface CYOAChoiceResult {
    choices: CYOAChoice[];
}
```

**Choice history entry** — tracked per chat, injected into GM context:

```typescript
interface ChoiceHistoryEntry {
    /** The choice ID. */
    choiceId: string;
    /** The label the user selected. */
    label: string;
    /** Timestamp when the choice was made. */
    selectedAt: number;
    /** Optional: what influenced this choice (impersonation, dice roll, etc.). */
    context?: string;
}
```

**Agent result type extension** — add to C-236's union:

```typescript
interface CyoaAgentResult {
    type: 'cyoa_choices';
    choices: CYOAChoice[];
}
```

## Scope Boundaries

- **In Scope:**
    - CYOA agent — prompt template, structured output parsing, registration as built-in agent
    - Choice buttons UI — DaisyUI component below AI messages, selectable, dismissible
    - Skill-check hints — `[Ability DC N]` badges on choice buttons
    - Choice history — per-chat tracking, injection into GM prompt context
    - Per-chat CYOA toggle — enable/disable via existing agent toggle system (C-236)
    - "Use CYOA as direction" toggle for impersonation mode (C-241)
    - Agent result type `cyoa_choices` added to pipeline result union
- **Out of Scope:**
    - Choice branching trees (CYOA choices that spawn more choices) — flat 2-4 choices per turn only
    - Preset choice blocks (Marinara's `prompt.schema.ts` choice blocks / `preset variables`) — that's prompt template territory (C-ME-008)
    - Dice roll integration with choices (rolling before selecting a DC-based choice) — that's C-ME-005
    - Visual Novel-style choice-based scene branching — scenes are C-ME-017 scope
    - Agent reasoning/thought bubbles for CYOA — reuse C-236's existing agent HUD

## Acceptance Criteria

### AC-1: CYOA Agent — Structured Output
**Given** the agent pipeline is running with the CYOA agent enabled for a chat
**When** the main AI response completes (e.g., GM describes a crossroads encounter)
**Then** the CYOA agent runs `extractStructure()` with its Zod schema, the model returns 2–4 choices, and the result is stored in `agentRunResults` with type `'cyoa_choices'`. If the model returns malformed output or fewer than 2 choices, the agent logs a warning via `@aikami/logger` and the choice UI is not rendered for this turn.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test at `apps/frontend/client/src/lib/services/agent/agents/cyoa_agent.test.ts` — mock pipeline context, verify prompt assembly, verify Zod validation
- E2E / Visual:
    - **Functional**: `tests/client/cyoa-choices.spec.ts` — agent produces choices after GM response
    - **Visual**: N/A

**Watch Points**:
- Agent must respect the `enabled` toggle per chat (no choices generated when disabled)
- Agent must observe phase ordering — runs AFTER main generation, not before
- Zero choices (empty array) = no UI rendered, not an error

### AC-2: Choice Buttons UI
**Given** the CYOA agent produced 3 choices: `["Investigate the ruins", "Follow the river trail", "Set up camp here"]`
**When** the AI message renders in the chat
**Then** a DaisyUI `join` element with 3 `btn` items appears inline below the AI message. Each button shows the choice label. Clicking a choice button: (a) disables all choice buttons, (b) calls `chatViewModel.sendMessage("Investigate the ruins")`, (c) records the choice in `choiceHistory`.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Sandbox test — render `ChoiceButtonsView` with mock choices, click one, verify callback
- E2E / Visual:
    - **Functional**: `tests/client/cyoa-choices-ui.spec.ts` — render choices, click, verify message posted
    - **Visual**: `suites/cyoa-choices-ui.visual.ts` — Screenshot the choice buttons below a GM message, verify DaisyUI btn styling

**Watch Points**:
- Buttons must be keyboard-accessible (Tab between choices, Enter/Space to select)
- On message branch/swipe (C-231), choices tied to the current branch must re-render with that branch's data
- If the user edits the AI message (C-231), existing choices are dismissed (they're stale)
- Dimissed/expired choices must not leave orphaned UI

### AC-3: Skill-Check Badges
**Given** the CYOA agent returns a choice with `skillCheck: { ability: "Persuasion", dc: 15 }`
**When** the choice button renders
**Then** the button shows a DaisyUI `badge` — `Persuasion DC 15` — with a subtle color accent (e.g., `badge-accent`). The badge is purely informational (no dice integration yet).

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Sandbox test — render choice with skillCheck, verify badge text and CSS class
- E2E / Visual:
    - **Functional**: N/A (covered by AC-2 visual)
    - **Visual**: `suites/cyoa-choices-ui.visual.ts` — include a choice with skill-check badge in the screenshot

**Watch Points**:
- Skill check without `dc` (malformed) → hide badge, log warning
- Multiple choices with skill checks must render cleanly in the join layout

### AC-4: Choice History Tracking & GM Injection
**Given** the player selects choice `"Investigate the ruins"` and then on the next turn selects `"Open the sarcophagus"`
**When** the GM prompt is assembled for the third turn
**Then** the GM context includes a section: `## Recent Choices\n- Investigate the ruins (Turn 12)\n- Open the sarcophagus (Turn 13)`. This appears in `gmPromptService.assemblePrompt()` output so the GMonarch can reference past decisions.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test — add 3 choices to history, call `assemblePrompt()`, verify output contains choice history section
- E2E / Visual:
    - **Functional**: `tests/client/cyoa-choices-history.spec.ts` — make choices, verify GM prompt includes them
    - **Visual**: N/A

**Watch Points**:
- History is capped at the last 10 choices to avoid prompt bloat
- History is per-chat, not global — switching chats shows different history
- History must survive client-side navigation (not cleared on route change)

### AC-5: Per-Chat CYOA Toggle
**Given** the agent activity menu (C-236) shows the CYOA agent toggle
**When** the user toggles CYOA to OFF for the current chat
**Then** the CYOA agent skips execution on all subsequent turns for this chat. No choice buttons render. Toggling back ON resumes CYOA generation.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Toggle CYOA off, send message, verify no CYOA agent run
- E2E / Visual:
    - **Functional**: `tests/client/cyoa-choices-toggle.spec.ts` — toggle on/off, verify behavior
    - **Visual**: N/A

**Watch Points**:
- Toggle state must persist across page reload (part of C-236's per-chat agent config persistence)
- Default: CYOA agent is ENABLED for new chats (opinionated — can be changed to OFF in agent settings)

### AC-6: Impersonation Integration (Optional Enhancement)
**Given** impersonation mode is active (C-241) and "Use CYOA as direction" is toggled ON
**When** the player clicks a CYOA choice `"Threaten the guard"`
**Then** instead of posting directly as a user message, the choice label is fed to the impersonation draft pipeline. The impersonation agent (C-241) writes a narrative paragraph "as the player" incorporating `"Threaten the guard"` as direction. The drafted message appears in the input area for the player to keep, edit, or discard.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Sandbox test — enable impersonation + CYOA as direction, click choice, verify impersonation draft appears
- E2E / Visual:
    - **Functional**: `tests/client/cyoa-choices-impersonation.spec.ts` — full impersonation flow
    - **Visual**: N/A

**Watch Points**:
- "Use CYOA as direction" toggle is hidden when impersonation mode is OFF
- If impersonation draft fails (error), fall back to posting the choice label as a plain user message
- Token budget: impersonation call uses the impersonation connection (C-241), not the main chat connection

## Implementation Sequence

1. **Phase 1 (Agent)**: Create `cyoa_agent.svelte.ts` in `apps/frontend/client/src/lib/services/agent/agents/`. Define CYOA prompt template, Zod schema for `CYOAChoiceResult`, and agent config constant. Register as `'cyoa'` built-in agent. Add `'cyoa_choices'` to agent result type union. Unit test the agent with mock pipeline context.
2. **Phase 2 (UI)**: Build `ChoiceButtonsView` Svelte 5 component with DaisyUI `join` + `btn` styling. Implement `ChoiceButtonsViewModel` with `selectChoice()`, dismiss logic, and skill-check badge rendering. Wire into `chat_view.svelte` and `dialogue_overlay.svelte` below the latest AI message.
3. **Phase 3 (Integration)**: Add `choiceHistory` tracking to `chat_view_model.svelte.ts`. Inject into `gmPromptService.assemblePrompt()` context (extend `GmPromptContext` or add as standalone section). Wire agent toggle (C-236 reuse). Wire impersonation "Use CYOA as direction" toggle.
4. **Phase 4 (Validation)**: Run `validate()` with test=true. Run functional E2E tests covering agent output, choice selection, history injection, toggle, and impersonation flow. Run visual test for choice button layout.

## Edge Cases & Gotchas

- **Zero choices from agent**: Agent returns `{ choices: [] }` — don't render UI, treat as no-op (not a warning). Happens when the model thinks no meaningful choices exist for the current scene.
- **Single choice**: Agent returns only 1 choice — render as a single "Continue" / dismiss button. Treat as a prompt-advance mechanism, not an error.
- **Choice label too long**: Agent returns a 45-word label — truncate to 80 chars + ellipsis in button; show full text in DaisyUI `tooltip` on hover.
- **Rapid sequential sends**: Player sends a message while CYOA agent is still running (via cancel/retry) — abort any in-flight CYOA extraction, don't render stale choices.
- **Choice re-selection on swipe**: When player swipes to an alternate AI response branch (C-231), that branch may have different CYOA choices. The ViewModel must re-query the agent results for that specific branch and re-render. If the branch has no CYOA results, hide the choice buttons.
- **Prompt length budget**: CYOA agent prompt must be kept small (<500 tokens). Only inject the last AI response + current scene context, not full chat history. The agent is post-processing, so it already has the full response.
- **Duplicate choices**: Agent returns `["Go left", "Go left", "Go right"]` — Zod schema should include `.refine()` to reject duplicate `label` values, forcing retry.
- **Choice ID uniqueness**: Choice IDs must be unique within a turn. Use `Date.now() + index` or `crypto.randomUUID()` to guarantee uniqueness even on retries.

---

## Execution Report

**Completed**: 2026-07-10

### Summary

Implemented the CYOA agent as a 6th built-in post-processing agent in the C-236 pipeline, with TypeBox schemas in `@aikami/schemas` (source of truth), a `ChoiceButtonsView` DaisyUI join/btn component with skill-check badges and truncation, a per-chat `choiceHistoryStore` (capped at 10, injected into `gmPromptService.assemblePrompt()` as a `## Recent Choices` section), per-chat toggle via the existing C-236 `enabledAgents` mechanism, and "Use CYOA as direction" impersonation integration (C-241) with plain-post fallback on draft failure. Dev sandbox at `/dev/cyoa`.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 CYOA Agent — Structured Output | ✅ | `cyoa_agent.ts` uses `extractStructure()` + `schemaCheck(CyoaChoiceResultSchema)`; malformed output → failed result + `logger.warn`, no UI. Sanitizer dedupes labels, regenerates IDs, caps at 4, hides malformed skill checks. Output tagged `type: 'cyoa_choices'`. |
| AC-2 Choice Buttons UI | ✅ | `choice_buttons_view.svelte` + ViewModel: DaisyUI join stack, disable-on-select, `sendMessage(choice.label)`, history recording. Dismissed on edit/regenerate/swipe. Keyboard accessible (native buttons; E2E verifies focus+Enter). |
| AC-3 Skill-Check Badges | ✅ | `badge badge-accent` with `Ability DC N`; malformed skill check (dc ≤ 0 / non-finite) hidden with warning. |
| AC-4 Choice History & GM Injection | ✅ | `choiceHistoryStore` singleton (per-chat Map, cap 10, survives navigation). `assemblePrompt({ chatId })` injects `## Recent Choices` section. Unit tests verify injection/omission. |
| AC-5 Per-Chat CYOA Toggle | ✅ | Registered as `'cyoa'` in `BUILT_IN_AGENTS` (enabled by default); C-236's `enabledAgents` gating skips it when toggled off — pipeline test verifies exclusion. |
| AC-6 Impersonation Integration | ✅ | `useCyoaAsDirection` toggle (hidden unless impersonation quick-button enabled); choice label fed to `impersonationService.generateDraft({ direction })`; falls back to plain user message on failure or missing persona. |

### Files Created

- `packages/shared/schemas/src/lib/cyoa.ts` — TypeBox schemas (CyoaChoice, CyoaChoiceResult, CyoaChoiceHistoryEntry, CyoaSkillCheck)
- `packages/shared/types/src/lib/cyoa.ts` — type re-exports
- `packages/shared/constants/src/lib/cyoa.ts` — CYOA_AGENT_ID, caps, labels
- `apps/frontend/client/src/lib/services/agent/agents/cyoa_agent.ts` — agent runner + sanitizeChoices
- `apps/frontend/client/src/lib/services/agent/cyoa_agent.test.ts` — 12 tests
- `apps/frontend/client/src/lib/services/agent/cyoa_toggle.test.ts` — 3 tests (AC-5)
- `apps/frontend/client/src/lib/services/chat/choice_history_store.svelte.ts` — per-chat history singleton
- `apps/frontend/client/src/lib/services/chat/choice_history_store.test.ts` — 6 tests
- `apps/frontend/client/src/lib/services/gm/cyoa_history_injection.test.ts` — 3 tests (AC-4)
- `apps/frontend/client/src/lib/views/chat/choice_buttons_view_model.svelte.ts` + `choice_buttons_view.svelte`
- `apps/frontend/client/src/lib/views/chat/choice_buttons_view_model.test.ts` — 10 tests
- `apps/frontend/client/src/lib/views/chat/cyoa_sandbox_view_model.svelte.ts` + `cyoa_sandbox_view.svelte`
- `apps/frontend/client/src/routes/(dev)/dev/cyoa/+page.svelte` — dev sandbox route
- `apps/e2e/src/pom/cyoa_page.ts` — POM
- `apps/e2e/tests/client/cyoa_choices.spec.ts` — 11 E2E tests
- `apps/e2e/src/visual/suites/cyoa_choices.visual.ts` — 2 visual cases
- `apps/frontend/docs/src/content/docs/features/cyoa-choices.md` — user docs

### Files Modified

- `packages/shared/{schemas,types,constants}/src/index.ts` — barrel exports
- `apps/frontend/client/src/lib/services/agent/built_in_agents.ts` — `'cyoa'` registry entry
- `apps/frontend/client/src/lib/services/agent/agent_pipeline_service.svelte.ts` — AGENT_RUNNERS entry
- `apps/frontend/client/src/lib/services/agent/agent_schemas.ts` — `CyoaAgentOutput` in union
- `apps/frontend/client/src/lib/services/agent/index.ts`, `services/index.ts` — exports
- `apps/frontend/client/src/lib/services/agent/agent_pipeline_view_model.test.ts` — registry counts 5→6
- `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` — chatId param + Recent Choices injection
- `apps/frontend/client/src/lib/views/chat/chat_view_model.svelte.ts` — choiceButtonsViewModel, _applyCyoaResults, _handleChoiceSelected, _draftChoiceAsDirection, useCyoaAsDirection, dismissal hooks
- `apps/frontend/client/src/lib/views/chat/chat_view.svelte` — ChoiceButtonsView + direction toggle
- `apps/e2e/src/pom/index.ts` — CyoaPage export

### Deviations

- **E2E spec filename**: contract says `cyoa-choices.spec.ts`; Biome enforces snake_case → `cyoa_choices.spec.ts` (same for visual suite `cyoa_choices.visual.ts`).
- **Zod → TypeBox**: contract mentions Zod schema; repo convention (aikami-conventions Pillar 2) mandates TypeBox in `@aikami/schemas`. Duplicate-label rejection is handled by the sanitizer (drop + warn) rather than schema `.refine()` retry — simpler and non-blocking.
- **Branch swipe choices**: agent results are not stored per-branch, so swiping dismisses choices rather than re-rendering the branch's own set (contract watch point allows hiding when a branch has no CYOA results; per-branch result storage would extend C-231's branch store — out of scope).
- **Toggle persistence across reload**: relies on C-236's agent config mechanism; C-236's `enabledAgents` is in-memory only, so persistence inherits that limitation.
- **Separate functional spec files** (`cyoa-choices-ui/history/toggle/impersonation.spec.ts`) consolidated into one `cyoa_choices.spec.ts`; toggle covered by pipeline unit tests, impersonation by ViewModel unit paths.

### Test Results

- Unit: 176/176 pass (client agent+chat+gm+views suites), incl. 34 new CYOA tests
- E2E: 11/11 pass (`cyoa_choices.spec.ts`)
- Visual: 2/2 pass at 100/100 (`cyoa-choices` suite)
- Sandbox live check: ai_validate_image 95/100
- Typecheck: clean (client, schemas, types, constants, e2e); client build: clean
- Pre-existing failures not caused by this contract: 11 ImageViewModel C-076 tests (fail on clean tree), 32 a11y lint errors in unrelated views
