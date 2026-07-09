## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/GAME_MODE.md` (session lifecycle, session numbering, recap anchoring); TODO.md C-ME-011 |
| **Target** | `apps/frontend/client/src/lib/services/session/` + `apps/frontend/client/src/lib/views/session/` — Session lifecycle UI, browser, auto-summarization, state carry-forward |
| **Priority** | P2 — Enables long-running campaigns without context window bloat |
| **Dependencies** | C-235 (GM/Narrative Director — COMPLETED for `SessionSummary` type + `sessionSummaryService`), C-132 (Save/Load — COMPLETED for `gameSaveService`), `gameStateService` (ECS bridge — EXISTS) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

C-235 defined the summarization engine (`SessionSummary` type, `sessionSummaryService.summarizeSession()`) but not the session lifecycle UX. This contract builds the UI layer: `GameSession` schema wrapping summaries with metadata (numbering, timestamps), a session browser for viewing/continuing past sessions, end-session flow with chat locking and summary preview, new-session flow with recap message and game state carry-forward, and auto-summarization prompts when chats grow large. The actual summarization LLM call reuses C-235's existing service.

## Design Reference

**Existing code:**
- `apps/frontend/client/src/lib/services/gm/gm_types.ts` — C-235's `SessionSummary` type
- `apps/frontend/client/src/lib/services/gm/session_summary_service.svelte.ts` — C-235's summarization + recap LLM calls
- `apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts` — existing save/load; sessions stored here
- `apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view.svelte` — Pause Menu; add "End Session" button

**Marinara-Engine inspiration:**
- Session lifecycle: `examples/Marinara-Engine/docs/GAME_MODE.md` (numbered sessions, resumePoint anchoring, state carry-forward)

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **GameSession schema**: Wraps C-235's `SessionSummary` with `id`, `gameId`, `sessionNumber`, `startedAt`, `endedAt`, `isActive`, and a `characterSnapshots` map (stat snapshots per party member).
- **End Session flow**: Button in Pause Menu → confirmation dialog → lock chat (read-only) → C-235 summarization call → preview panel → save session to `gameSaveService`. Chat locked until "New Session" is started.
- **New Session flow**: Load previous session → increment session number → C-235 recap call → post recap as first message → carry forward game state (ECS snapshot from previous session).
- **Session browser**: Accessible from Start Menu ("Continue" → session list). Shows session number, date, duration, narrative recap preview. Click to view read-only or continue.
- **Auto-summarization**: When chat exceeds 100 messages, show a non-intrusive toast: "Your session is getting long. Consider ending it to keep the AI focused." Does NOT auto-trigger summarization.

## State & Data Models

    interface GameSession {
        id: string;
        gameId: string;
        sessionNumber: number;
        startedAt: string;
        endedAt?: string;
        isActive: boolean;
        summary?: SessionSummary;       // C-235 type
        messageCount: number;
        durationMinutes?: number;
        characterSnapshots: Record<string, { level: number; xp: number; hp: number; }>;
    }

## Scope Boundaries

- **In Scope:**
  - `GameSession` schema + CRUD in `gameSaveService`
  - End Session button (Pause Menu) + confirmation dialog
  - Chat locking on session end (read-only mode)
  - Session summary preview panel after generation
  - New Session button → recap message + state carry-forward
  - Session browser (list, view read-only, continue)
  - Session numbering (Session 1, 2, 3...)
  - Auto-summarization toast at 100+ messages
  - Dev sandbox: `/dev/session`
  - Unit tests, Playwright E2E (`tests/client/session_mgmt.spec.ts`), Visual (`suites/session_mgmt.visual.ts`), POM (`src/pom/session_mgmt_page.ts`)
- **Out of Scope:**
  - C-235 summarization engine (already exists)
  - Campaign/progression tracking (C-235's ArcMemory covers this)
  - Session export (C-ME-017)
  - Auto-save on zone transitions (C-155 — already completed)

## Acceptance Criteria

### AC-1: End Session Flow
**Given** a game session with 50+ messages
**When** the player clicks "End Session" from the Pause Menu
**Then** a confirmation dialog appears; on confirm, the chat locks (read-only), the C-235 summarization LLM call runs, a preview panel shows the summary, and the session is saved with `sessionNumber` and timestamps

**Test Hooks**:
- Unit Test: `session_lifecycle.test.ts` — end session locks chat, triggers C-235 service, saves to `gameSaveService`
- E2E: `tests/client/session_mgmt.spec.ts` — play session → End Session → verify locked → verify summary preview → verify saved

### AC-2: New Session with Recap + State Carry-Forward
**Given** a concluded session
**When** the player clicks "New Session"
**Then** the recap message appears as the first chat message: "📜 **Previously...** [resumePoint]"; session number increments; game state (map, NPCs, party, quests, time, weather) carries forward from previous session

**Test Hooks**:
- Unit Test: `session_lifecycle.test.ts` — new session increments number, calls C-235 recap, carries forward state
- E2E: `tests/client/session_mgmt.spec.ts` — End Session → New Session → verify recap → verify state carried → verify Session 2 shown
- Visual: `suites/session_mgmt.visual.ts` — recap message with "Previously..." heading

### AC-3: Session Browser
**Given** 3 saved sessions
**When** the player opens the session browser from Start Menu → Continue
**Then** sessions listed with number, date, duration, narrative recap preview; click to view read-only (scrollable chat) or continue from that session

**Test Hooks**:
- E2E: `tests/client/session_mgmt.spec.ts` — view browser, verify sessions listed, view read-only, continue from session 2
- Visual: `suites/session_mgmt.visual.ts` — browser with 3 sessions

### AC-4: Auto-Summarization Prompt
**Given** a chat reaches 100+ messages
**When** the message count crosses the threshold
**Then** a DaisyUI toast appears: "Your session is getting long. Consider ending it to keep the AI focused." with "End Session" action button; toast dismissible

**Test Hooks**:
- E2E: `tests/client/session_mgmt.spec.ts` — send 100 messages (mock), verify toast → dismiss → verify not shown again that session
- Visual: `suites/session_mgmt.visual.ts` — toast notification

### AC-5: Dev Sandbox
**Given** navigate to `/dev/session`
**When** page loads
**Then** session browser with mock sessions, End Session simulator, recap preview, state carry-forward tester

**Test Hooks**:
- E2E: functional
- Visual: `suites/session_mgmt.visual.ts` — sandbox layout

## Implementation Sequence

### Phase 1: Data Layer
1. `GameSession` type + Zod schema
2. Session CRUD in `gameSaveService`
3. Wire End Session → C-235 `sessionSummaryService.summarizeSession()`
4. Wire New Session → C-235 recap call + state carry-forward
5. Auto-summarization threshold checker
6. Unit tests: `session_lifecycle.test.ts`, `session_browser.test.ts`

### Phase 2: ViewModel
1. `session_browser_view_model.svelte.ts` — list, view, continue
2. `end_session_view_model.svelte.ts` — confirmation, preview, lock
3. Wire into existing Pause Menu ViewModel

### Phase 3: Views
1. `session_browser.svelte` — DaisyUI card list
2. `session_summary_preview.svelte` — read-only panel
3. Add "End Session" to Pause Menu
4. Toast for auto-summarization
5. Dev sandbox: `/dev/session`

### Phase 4: Validation
1. `moon run client:fix && moon run client:typecheck && moon run client:test`
2. `cd apps/e2e && bun run test && bun run test:visual`

## Edge Cases & Gotchas

- **Chat locking**: Locked chats are read-only — no input, no generation. Show a banner: "Session ended. Start a new session to continue."
- **Session 0**: The initial game state before any session is "Session 0" — not saved. First End Session creates Session 1.
- **State carry-forward**: Only ECS-persistent state carries forward (map, NPCs, quests). Chat history does NOT — new session = fresh chat.
- **Auto-summarization toast**: Only shown once per session per load. Dismissed = not shown again until next page load or new session.
- **Short session guard**: If < 10 messages, skip summarization with notice. Lock chat but don't generate summary.
