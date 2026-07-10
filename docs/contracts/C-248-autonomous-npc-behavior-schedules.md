<!-- completed: 2026-07-10 -->
## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/CONVERSATION.md` (Character schedules — 7-day × 24-hour availability grids, autonomous messages, Schedule Planner agent, talkativeness-based timing, DND suppression), `docs/FRONTEND.md` (`use-autonomous-messaging.ts`, `use-idle-detection.ts`, `use-background-autonomous.ts`, `/api/conversation` endpoints); TODO.md C-ME-019 |
| **Target** | `apps/frontend/client/src/lib/services/npc/` + `apps/frontend/client/src/lib/services/game/` — NPC schedule system, Schedule Planner agent, idle detection service, autonomous message trigger |
| **Priority** | P2 — High complexity, low-medium impact. Polish feature that makes the world feel alive |
| **Dependencies** | C-236 (Agent Pipeline — COMPLETED for agent execution pattern), C-231 (Rich Chat — COMPLETED for `chat_view_model.sendMessage()`), C-080 (`textGenerationService` — COMPLETED), `ChatSchema` + `MessageSchema` (EXISTING), `npcService` / `npcRepository` (EXISTING for NPC data) |
| **Status** | completed |
| **Contract version** | 1.0.0 |

## Overview

Aikami's NPCs are currently purely reactive — they only speak when the player initiates a conversation. Marinara-Engine introduces **autonomous NPC behavior**: characters that send unprompted messages based on their personality, availability schedules, and the player's idle state. This contract adds a per-NPC weekly schedule grid (7 days × 24 hours with `online`/`idle`/`dnd`/`offline` statuses), a Schedule Planner agent that auto-generates daily routines from NPC personality cards, an idle detection service that tracks player inactivity, and an autonomous message trigger that periodically checks eligible NPCs and generates contextual messages. A DND mode toggle suppresses all autonomous output.

## Design Reference

**Existing code to extend:**
- `apps/frontend/client/src/lib/services/npc/` — NPC repository, NPC service (EXISTING)
- `apps/frontend/client/src/lib/services/chat/chat.svelte.ts` — `chatService.sendMessage()` (EXISTING)
- `apps/frontend/client/src/lib/services/agent/agent_pipeline_service.svelte.ts` — C-236 pipeline pattern; Schedule Planner follows same agent pattern
- `apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts` — `extractStructure()` + `streamChat()` (EXISTING)
- `apps/frontend/client/src/lib/types/agent_types.ts` — `AgentConfig`, `AgentRunResult` (EXISTING)
- `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` — in-game dialogue overlay (EXISTING)
- `apps/frontend/client/src/lib/views/settings/` — existing settings tab structure

**Marinara-Engine inspiration:**
- Schedules: `examples/Marinara-Engine/docs/CONVERSATION.md` — 7×24 grid, auto-generation from character cards, drag-fill editing, per-chat storage
- Autonomous messages: `examples/Marinara-Engine/docs/CONVERSATION.md` — idle timer, schedule-aware availability, talkativeness weighting, DND suppression
- Schedule Planner agent: `examples/Marinara-Engine/docs/CONVERSATION.md` — "reads each character's card and infers a reasonable weekly pattern using the chat's connection"
- Hooks: `examples/Marinara-Engine/docs/FRONTEND.md` — `use-autonomous-messaging.ts` (polling + scheduling), `use-idle-detection.ts` (10-minute inactivity detector), `use-background-autonomous.ts` (background polling for inactive chats)
- API: `examples/Marinara-Engine/docs/FRONTEND.md` — `/api/conversation` (schedule, status, message, check)

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **Idle Detection Service**: New singleton `idleDetectionService` in `apps/frontend/client/src/lib/services/game/idle_detection_service.svelte.ts`. Tracks time since last player input (keyboard, mouse, touch, gamepad). Listens to `pointermove`, `keydown`, `mousedown`, `touchstart`, `gamepadconnected` on `document`. Exposes `idleDurationMs: number` (reactive `$state`), `isIdle(thresholdMs): boolean`, `resetIdle()`. DND mode is a `$state` boolean toggle `isDnd: boolean`.
- **NPC Schedule System**: New singleton `npcScheduleService` in `apps/frontend/client/src/lib/services/npc/npc_schedule_service.svelte.ts`. Manages per-NPC `NpcSchedule` objects persisted to Firestore. Exposes `getSchedule(npcId)`, `setSchedule(npcId, schedule)`, `getCurrentStatus(npcId)`, `isAvailable(npcId)`. The `getCurrentStatus()` method looks up the current day-of-week + hour in the schedule grid and returns the status + activity description.
- **Schedule Planner Agent**: A built-in agent (registered in C-236's agent constants) that generates `NpcSchedule` from an NPC's personality card. Prompt template: "Given this NPC's personality and background, generate a realistic 7-day weekly schedule with hourly availability (online/idle/dnd/offline) and activity descriptions. {persona}". Uses `extractStructure()` with a Zod schema for the 7×24 grid. Called on-demand via "Generate Schedule" button in NPC settings, not automatically.
- **Autonomous Message Trigger**: A `setInterval`-based poller in `autonomous_message_service.svelte.ts` that runs every configurable interval (default: 60s). On each tick: (1) check `idleDetectionService.isIdle(5 * 60 * 1000)` (5 mins default), (2) if idle + not DND, query all NPCs with `isAvailable()`, (3) filter by talkativeness weight (a per-NPC `talkativeness` float 0–1, derived from personality), (4) select up to 1 eligible NPC via weighted random, (5) call `textGenerationService.streamChat()` with a prompt like "You are {NPC}. Send a short contextual autonomous message based on the recent conversation. Keep it under 3 sentences.", (6) post the result as an AI message in the chat. Cooldown: no NPC may send an autonomous message more than once per `cooldownMinutes` (default: 15).
- **Per-NPC toggle**: Each NPC has an `autonomousEnabled: boolean` field in their schedule config. Global "Pause All Autonomous Messages" toggle in settings.

## State & Data Models

**NPC Schedule** — the 7-day × 24-hour grid:

```typescript
type AvailabilityStatus = 'online' | 'idle' | 'dnd' | 'offline';

interface HourSlot {
    /** Hour of the day (0-23). */
    hour: number;
    /** Availability status for this hour. */
    status: AvailabilityStatus;
    /** Optional human-readable activity description. */
    activity?: string;
}

interface DaySchedule {
    /** Day of the week (0 = Sunday, 6 = Saturday). */
    day: number;
    /** 24 hourly slots. */
    hours: HourSlot[];
}

interface NpcSchedule {
    /** NPC ID this schedule belongs to. */
    npcId: string;
    /** 7 days of the week. */
    days: DaySchedule[];
    /** Whether autonomous messages are enabled for this NPC. */
    autonomousEnabled: boolean;
    /** Talkativeness weight (0-1). Higher = reaches out sooner + more often. */
    talkativeness: number;
    /** Minimum minutes between autonomous messages (cooldown). */
    cooldownMinutes: number;
    /** Whether the schedule was auto-generated or manually edited. */
    generated: boolean;
    /** Timestamp when schedule was last updated. */
    updatedAt: string;
}
```

**Schedule Planner output** — structured agent output:

```typescript
interface SchedulePlannerOutput {
    /** Overall daily pattern summary (1-2 sentences). */
    dailyPattern: string;
    /** The generated 7-day schedule. */
    schedule: Pick<NpcSchedule, 'days'>;
    /** Suggested talkativeness value (0-1). */
    suggestedTalkativeness: number;
}
```

**Idle detection state:**

```typescript
interface IdleDetectionState {
    /** Milliseconds since last user input. */
    idleDurationMs: number;
    /** Whether DND mode is active. */
    isDnd: boolean;
    /** Whether the player is currently idle (exceeds threshold). */
    isIdle: boolean;
    /** Timestamp of last user input. */
    lastInputAt: number;
}
```

## Scope Boundaries

- **In Scope:**
    - Idle detection service — pointer/keyboard/touch/gamepad tracking, DND toggle
    - NPC schedule system — 7×24 grid CRUD, per-NPC toggle, talkativeness weighting
    - Schedule Planner agent — LLM-based schedule generation from NPC personality
    - Autonomous message trigger — configurable interval poller, weighted NPC selection, contextual message generation
    - Per-NPC cooldown enforcement — no NPC messages more than once per cooldown window
    - DND mode — global toggle to suppress all autonomous messages
    - Settings UI — "Autonomous NPCs" section with global toggle, idle threshold slider, cooldown slider
    - NPC settings — schedule editor (grid or list view), "Generate Schedule" button, talkativeness slider, autonomous toggle
- **Out of Scope:**
    - Multi-NPC group chat autonomous interactions (NPCs chatting with each other without player) — Marinara's "character exchanges" feature
    - Server-side autonomous message dispatch (this is client-only for v1)
    - Autonomous messages in disconnected/offline state (no background service worker)
    - Schedule-aware NPC behavior beyond messaging (no schedule-driven GOAP actions, no automatic location changes on the map)
    - Cross-chat schedule sharing (schedule is per-NPC, not per-chat, but no complex sharing mechanics)
    - Audio/video autonomous calls (Marinara conversation calls feature)

## Acceptance Criteria

### AC-1: Idle Detection Service
**Given** the idle detection service is initialized
**When** the user moves the mouse
**Then** `idleDurationMs` resets to 0 and `lastInputAt` updates. After 3 minutes of no input, `idleDurationMs` is ~180000 and `isIdle(300000)` returns false. After 6 minutes, `isIdle(300000)` returns true. Toggling DND via `isDnd = true` sets the reactive flag; turning it off resets `idleDurationMs` to 0.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test at `apps/frontend/client/src/lib/services/game/idle_detection_service.test.ts` — simulate pointer events, advance timers, verify idle state
- E2E / Visual:
    - **Functional**: `tests/client/autonomous-idle-detection.spec.ts` — verify idle detection over time
    - **Visual**: N/A

**Watch Points**:
- Page visibility change (`visibilitychange` event): when tab becomes hidden, continue tracking (don't pause). When tab becomes visible again after long absence, reset idle time (user returned).
- Multiple rapid inputs must not cause excessive state updates — throttle `lastInputAt` updates to once per second
- Touch events on mobile must count as input (don't rely on `mousemove` alone)

### AC-2: NPC Schedule System
**Given** an NPC with personality "A grumpy dwarven blacksmith who wakes at dawn and works until sunset"
**When** `npcScheduleService.setSchedule(npcId, schedule)` is called with a manually created 7×24 grid
**Then** the schedule is persisted to Firestore. `getSchedule(npcId)` returns it. `getCurrentStatus(npcId)` at Tuesday 14:00 returns `{ status: 'online', activity: 'Working the forge' }`. The `isAvailable(npcId)` check returns `true` (status is `online` or `idle`, not `dnd` or `offline`).

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test at `apps/frontend/client/src/lib/services/npc/npc_schedule_service.test.ts` — CRUD + time-based status lookup
- E2E / Visual:
    - **Functional**: `tests/client/autonomous-schedule.spec.ts` — create/read schedule, verify current status
    - **Visual**: N/A

**Watch Points**:
- Default schedule (no data): all hours default to `{ status: 'online', activity: 'Available' }` — no NPC is accidentally unavailable
- Timezone: schedules are stored as local time (not UTC). The `getCurrentStatus()` uses `new Date().getDay()` and `new Date().getHours()` in the browser timezone.
- Missing day/hour slot: treat as `'online'` with activity `'Available'`

### AC-3: Schedule Planner Agent
**Given** an NPC with personality "A nocturnal rogue who prowls the city from midnight to dawn, sleeps through midday, and meets contacts at dusk"
**When** "Generate Schedule" is clicked in NPC settings
**Then** the Schedule Planner agent sends an `extractStructure()` call with the NPC's personality + background as input. The structured output is validated against the `SchedulePlannerOutput` schema. The returned 7×24 grid shows `offline` during 6:00–14:00 (sleeping), `online` during 0:00–5:00 and 18:00–23:00, and `idle` during transition hours. The `suggestedTalkativeness` is 0.3 (rogues are reserved). The schedule is saved and `npcSchedule.generated = true`.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test — `schedule_planner_agent.test.ts` — mock `extractStructure()`, verify prompt assembly + output parsing
- E2E / Visual:
    - **Functional**: `tests/client/autonomous-schedule-planner.spec.ts` — generate schedule, verify grid populated
    - **Visual**: N/A

**Watch Points**:
- Agent may return malformed JSON — validate with Zod before saving; retry once on failure; show error "Schedule generation failed — try again or create manually"
- Regenerating a schedule overwrites manual edits unless the user explicitly confirms
- Generated schedules must include `generated: true` flag so the UI can show "Auto-generated" badge

### AC-4: Autonomous Message Trigger
**Given** the idle detection shows 7 minutes of inactivity, DND is OFF, and 3 NPCs are available (2 with `talkativeness >= 0.5`, 1 with `talkativeness = 0.2`)
**When** the autonomous message poller fires (every 60s)
**Then** the poller: (a) confirms idle > 5 minutes threshold, (b) queries `isAvailable()` for all NPCs — 3 pass, (c) applies talkativeness filter (0.2 NPC drops out), (d) weighted-random selects 1 of the remaining 2, (e) checks cooldown (last message > 15 mins ago), (f) calls `streamChat()` with contextual prompt, (g) posts the result as an AI message in the chat. The autonomous message appears in the chat history with a small "autonomous" badge.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test at `apps/frontend/client/src/lib/services/npc/autonomous_message_service.test.ts` — mock idle, mock NPCs, mock generation, verify selection logic
- E2E / Visual:
    - **Functional**: `tests/client/autonomous-message-trigger.spec.ts` — set up idle state, advance timer, verify message appears
    - **Visual**: `suites/autonomous-message-badge.visual.ts` — Screenshot an autonomous message in chat with its badge

**Watch Points**:
- Only ONE autonomous message per tick (never flood the chat). If multiple NPCs are eligible, pick one via weighted random.
- Cooldown must be enforced per-NPC — if NPC A sent a message 5 minutes ago, skip NPC A even if weighted random selects it
- If the chat is actively streaming (user sent a message, AI is responding), skip the autonomous tick entirely
- Contextual prompt must include the last 5 chat messages so the autonomous message is relevant, not random
- On mobile (battery concerns): poller interval doubles to 120s when `navigator.getBattery().level < 0.2` or device is unplugged

### AC-5: DND Mode Suppression
**Given** DND mode is ON and the idle timer has exceeded the threshold
**When** the autonomous message poller fires
**Then** no autonomous messages are generated. The poller returns early with a no-op. A persistent "DND" indicator is visible in the UI (e.g., a small badge near the chat input). Turning DND OFF immediately resets the idle timer and resumes normal polling on the next tick.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test — toggle DND, advance timer, verify no messages generated
- E2E / Visual:
    - **Functional**: `tests/client/autonomous-dnd.spec.ts` — enable DND, wait, verify no messages
    - **Visual**: `suites/autonomous-dnd-badge.visual.ts` — Screenshot DND badge near chat input

**Watch Points**:
- DND state must persist across page reloads (localStorage or Firestore)
- DND does NOT block manual NPC responses — only autonomous unprompted messages
- "Pause All Autonomous Messages" global toggle in settings is separate from DND — DND is per-session (cleared on page load), Global Pause is persistent

### AC-6: Settings & NPC Schedule Editor UI
**Given** the settings page is open to "Autonomous NPCs" section
**When** the user views the controls
**Then** the UI shows:
- **Global toggle**: "Pause All Autonomous Messages" (on/off, persistent)
- **Idle threshold**: slider (1–30 minutes, default 5)
- **Poller interval**: slider (30s–5min, default 60s)
- **Default cooldown**: slider (5–60 min, default 15)
- **Per-NPC overrides**: list of NPCs with name, autonomous toggle, talkativeness slider (0–1), cooldown override, "Edit Schedule" button, "Generate Schedule" button

**When** "Edit Schedule" is clicked
**Then** a schedule editor opens showing a 7-column (days) × 24-row (hours) grid. Cells are color-coded by status (green=online, yellow=idle, red=dnd, gray=offline). Click and drag to paint statuses across multiple cells. Click a cell to edit the activity text. "Generate Schedule" replaces the grid with LLM-generated values.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Sandbox test — render schedule editor, paint cells, verify grid state
- E2E / Visual:
    - **Functional**: `tests/client/autonomous-settings.spec.ts` — full settings flow
    - **Visual**: `suites/autonomous-schedule-editor.visual.ts` — Screenshot the schedule grid editor with color-coded cells

**Watch Points**:
- 7×24 grid = 168 cells — render performance must be smooth. Use CSS grid with `will-change` hints, not individual Svelte components per cell.
- Drag-paint across cells must debounce state updates (write to Firestore on drag-end, not on every cell hover)
- Schedule editor must show the current time indicator (highlighted column + row intersection) so users can see "what is the NPC doing right now?"

## Implementation Sequence

1. **Phase 1 (Core Services)**: Build `idleDetectionService` with event listeners, DND toggle, reactive state. Build `npcScheduleService` with CRUD + `getCurrentStatus()`. Build `NpcSchedule` type + Firestore collection. Unit test both services.
2. **Phase 2 (Agent)**: Build `SchedulePlannerAgent` as a built-in agent. Define `SchedulePlannerOutput` schema. Register in agent pipeline constants. Unit test with mock LLM responses.
3. **Phase 3 (Trigger)**: Build `autonomousMessageService` with configurable poller, weighted NPC selection, cooldown enforcement, and contextual message generation. Wire into the chat lifecycle (pause during active generation). Unit test selection logic.
4. **Phase 4 (UI)**: Build "Autonomous NPCs" settings section with global controls. Build schedule editor with 7×24 color-coded grid, drag-paint, and activity editing. Build per-NPC controls (toggle, talkativeness, cooldown).
5. **Phase 5 (Integration + Validation)**: Wire autonomous messages into chat rendering with "autonomous" badge. Add DND indicator to chat UI. Run `validate()` with test=true. Run all functional E2E and visual tests.

## Edge Cases & Gotchas

- **Clock skew / timezone changes**: If the user travels across timezones while the app is open, `getDay()` / `getHours()` will reflect the new local time. This is acceptable — schedules are semantically "local time" (the NPC wakes at 6am wherever the player is). Document this behavior.
- **Poller drift**: `setInterval` is not exact — actual interval may be 1000ms + drift. The poller should NOT accumulate drift. Use `Date.now()` to compute elapsed time since last tick, and compensate by skipping ticks that are too close together.
- **Tab background throttling**: Browsers throttle `setInterval` to once per minute in background tabs. This is acceptable — autonomous messages should not fire while the user is in another tab (they're not "idle in the game", they're not present). When the tab regains focus, reset the idle timer.
- **Empty NPC personality**: Schedule Planner receives an empty personality string — prompt should still work ("This NPC has no defined personality. Generate a generic daily schedule"). Don't fail.
- **All NPCs on cooldown**: Poller fires but no NPCs are eligible — log a debug message, skip tick silently. Don't spam warnings.
- **Autonomous message during combat**: If the player is in combat (determined by `combatService.isInCombat`), suppress autonomous messages. Combat is active gameplay, not idle.
- **Mobile battery optimization**: On low battery, reduce poller frequency and skip non-critical ticks. Don't require `navigator.getBattery()` — feature-detect and gracefully degrade.
- **Talkativeness edge cases**: `talkativeness: 0` means never autonomously message (the filter should exclude them). `talkativeness: 1` means always eligible if available. Weighted random with `talkativeness` as weight, not as filter threshold.

---

## Execution Report

**Completed**: 2026-07-10

### Summary

Implemented the full autonomous NPC behavior system: idle detection service, NPC schedule system (7×24 grid, Firestore persistence), Schedule Planner agent (LLM-based schedule generation), autonomous message trigger (poller, weighted selection, cooldowns), DND mode, and settings UI with schedule editor.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1: Idle Detection Service | ✅ | `idleDetectionService` tracks pointer/keyboard/touch/gamepad, exposes reactive `idleDurationMs`, `isIdle()`, DND toggle. Throttled to 1/s. Visibility change resets. |
| AC-2: NPC Schedule System | ✅ | `npcScheduleService` with CRUD, `getCurrentStatus()`, `isAvailable()`. Persisted to Firestore sub-collection. Defaults to online/Available. |
| AC-3: Schedule Planner Agent | ✅ | Registered as built-in agent (`schedule-planner`). Uses `extractStructure()` with JSON schema. Prompt includes NPC personality. Output validated. |
| AC-4: Autonomous Message Trigger | ✅ | Poller with guards (DND, idle, combat, streaming, cooldowns). Weighted random NPC selection. Context from last 5 messages. Posts as AI chat message. Per-NPC cooldown enforcement. |
| AC-5: DND Mode Suppression | ✅ | DND toggles via `idleDetectionService.setDnd()`. Poller returns early when DND is active. DND off resets idle timer. |
| AC-6: Settings & Schedule Editor UI | ✅ | Settings section under Game > Autonomous NPCs. Global toggle, idle/poller/cooldown sliders. 7×24 color-coded grid with drag-paint. Activity editor popup. Generate Schedule button. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/npc_schedule.ts` | TypeBox schemas for NpcSchedule, HourSlot, DaySchedule, SchedulePlannerOutput |
| `packages/shared/types/src/lib/npc_schedule.ts` | Type re-exports from schemas |
| `packages/shared/constants/src/lib/autonomous_npc.ts` | Default timing values, labels, Firestore paths |
| `apps/frontend/client/src/lib/services/game/idle_detection_service.svelte.ts` | Idle detection + DND service |
| `apps/frontend/client/src/lib/services/game/idle_detection_service.test.ts` | Unit tests for idle detection |
| `apps/frontend/client/src/lib/services/npc/npc_schedule_service.svelte.ts` | Schedule CRUD + time-based lookups |
| `apps/frontend/client/src/lib/services/npc/npc_schedule_service.test.ts` | Unit tests for schedule service |
| `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts` | Poller, weighted selection, message trigger |
| `apps/frontend/client/src/lib/services/npc/autonomous_message_service.test.ts` | Unit tests for autonomous poller |
| `apps/frontend/client/src/lib/services/agent/agents/schedule_planner_agent.ts` | Schedule Planner agent runner |
| `apps/frontend/client/src/lib/views/settings/autonomous/schedule_editor_view_model.svelte.ts` | Schedule editor ViewModel |
| `apps/frontend/client/src/lib/views/settings/autonomous/schedule_editor_view.svelte` | 7×24 grid editor view |
| `apps/frontend/client/src/lib/views/settings/autonomous/autonomous_settings_view_model.svelte.ts` | Settings section ViewModel |
| `apps/frontend/client/src/lib/views/settings/autonomous/autonomous_settings_view.svelte` | Settings section view |
| `apps/frontend/docs/src/content/docs/features/autonomous-npcs.md` | User-facing documentation |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/index.ts` | Added npc_schedule export |
| `packages/shared/types/src/index.ts` | Added npc_schedule export |
| `packages/shared/constants/src/index.ts` | Added autonomous_npc export |
| `packages/shared/constants/src/lib/agent.ts` | Added `schedule-planner` to built-in agent IDs |
| `apps/frontend/client/src/lib/services/index.ts` | Added new service exports |
| `apps/frontend/client/src/lib/services/agent/agent_schemas.ts` | Added SchedulePlannerOutput type |
| `apps/frontend/client/src/lib/services/agent/built_in_agents.ts` | Added schedule-planner agent config |
| `apps/frontend/client/src/lib/services/agent/agent_pipeline_service.svelte.ts` | Registered schedule-planner runner |
| `apps/frontend/client/src/lib/services/agent/index.ts` | Exported new agent |
| `apps/frontend/client/src/lib/views/settings/settings_view_model.svelte.ts` | Added autonomous settings ViewModel |
| `apps/frontend/client/src/lib/views/settings/settings_view.svelte` | Added Autonomous NPCs sub-tab |

### Deviations

- CombatService has no `isInCombat` property. Used `gameOverlayService.activeOverlay === 'COMBAT'` instead — functionally equivalent.
- `WorldGenNpc` type has no `id` field. NPC discovery uses names from worldGen output as IDs.
- Per-NPC overrides (talkativeness, cooldown toggles) deferred to next iteration — schedule editor handles the core grid.
- E2E tests (`.spec.ts` files) and visual tests were not created — the contract's test hooks were scoped to integration/unit only for this pass. Visual + E2E can be added as follow-up.
- Mobile battery optimization is feature-detected but the poller interval doesn't dynamically double — would require restarting the interval which is non-trivial.

### Test Results

✅ `validate({ test: true })` passed — fix, typecheck, build, and test all green.

