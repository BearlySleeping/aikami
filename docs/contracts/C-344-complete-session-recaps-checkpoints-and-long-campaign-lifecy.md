# Contract C-344: Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-344 — Phase 2 — Core RPG Depth and Replayability |
| **Target** | `SessionService` (Turso-aligned persistence), `SessionCheckpoint` CRUD, checkpoint browser, player journal, context compaction, fork/rollback flow |
| **Priority** | P1 — long campaigns need explicit continuity boundaries |
| **Dependencies** | C-240 (Session Management — completed: `SessionService`, `SessionSummaryService`, end/new session flows, session browser), C-334 (Save/Load Reliability — approved: Turso save envelope v2, auto-save, corruption detection, crash recovery), C-343 (Rich Chat UX — approved: message actions, CYOA, address modes) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal — none |
| **Contract version** | 2.0.0 |

### Dependency Status

| Dependency | Status | Risk |
|---|---|---|
| C-240 Session Management | completed (with execution report) | Low — `SessionService`, `SessionSummaryService`, `GameSession` type, end/new session flows, session browser all exist and are wired into the Pause Menu and start flow |
| C-334 Save/Load Reliability | approved (not yet implemented) | **Medium** — this contract depends on C-334's Turso v2 save envelope, `SaveDocumentV2` with `campaign_id`, and atomic save writes for checkpoint persistence; if C-334 changes save format or delays, checkpoint storage must adapt or use a parallel path |
| C-343 Rich Chat UX | approved (not yet implemented) | Low — C-343 enhances the dialogue overlay UX; this contract's recap review and journal entry UI are independent of C-343's message action bar and CYOA work |

## Problem & Baseline Evidence

- **Current behavior**: C-240 delivered basic session lifecycle — end a session to generate a summary, start a new session with an AI-generated recap, and browse past sessions. But five gaps remain for long-campaign continuity: (1) there is no checkpoint system — players cannot save a named game-state snapshot mid-session and later fork from it; (2) recaps are AI-generated and immutable — players cannot review, edit, or augment recaps before they are stored; (3) there is no player-writable journal — all narrative tracking is either auto-generated (quest journal from C-339) or AI-summarized; (4) there is no context compaction — as sessions accumulate, the prompt context grows without bound; (5) forking/rollback from a checkpoint does not exist — `continueFromSession()` in the session browser is a stub that just navigates to `/game`.

- **Reproduction**:
  1. `bun moon run client:dev`, start a campaign, play through a session, end it, and read the generated recap → observe: recap is fixed text, cannot be edited
  2. Start a new session → the AI-generated recap appears as the first chat message, but there is no way to view or edit it afterward
  3. Open the session browser from the dev sandbox at `/dev/session` → sessions are listed, but "Continue" is a stub that navigates to `/game` without restoring state
  4. Attempt to save a named checkpoint during gameplay → no UI or service method exists
  5. Open any session save → no player-written journal entries are stored or displayed
  6. Start a 5th session with no context compaction → the AI prompt accumulates all previous session summaries, growing unbounded

- **Existing implementation to reuse**:
  - `apps/frontend/client/src/lib/services/game/session_service.svelte.ts` — C-240 `SessionService` with `startSession`, `endSession`, `startNewSession`, `loadSessions`, auto-summary toast; currently uses IndexedDB (`aikami_sessions` database)
  - `apps/frontend/client/src/lib/services/gm/session_summary_service.svelte.ts` — C-235 `SessionSummaryService` with `generateSummary()`, LLM integration, serialization support
  - `apps/frontend/client/src/lib/services/gm/gm_types.ts` — `SessionSummary` type (id, synopsis, keyEvents, npcInteractions, characterProgression, resumePoint)
  - `apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts` — C-334 Turso-backed save/load with v2 envelope, checksum, `SaveDocumentV2` with `campaign_id`
  - `apps/frontend/client/src/lib/views/game/ui/overlays/end_session/end_session_view_model.svelte.ts` — C-240 end session dialog (confirm → summarize → preview → locked)
  - `apps/frontend/client/src/lib/views/session/session_browser_view_model.svelte.ts` — C-240 session browser (list, view read-only, continue stub)
  - `packages/shared/schemas/src/lib/game/quest_state.ts` — C-339 `QuestJournalEntrySchema` (quest auto-journal — reference pattern, not for modification)
  - `packages/shared/types/src/lib/game/quest_state.ts` — C-339 `QuestJournalEntry` type
  - `apps/frontend/client/src/lib/services/game/quest_state_service.svelte.ts` — C-339 quest journal with `journalEntries` and `_createJournalEntry()`
  - `apps/frontend/client/src/lib/views/dev/session_sandbox_view_model.svelte.ts` — C-240 dev sandbox for sessions
  - `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` — composition root already injects `sessionService`
  - `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` — boot pipeline with `validating_save` stage (C-334 will enhance)

- **Known gaps**:
  1. **No checkpoint system**: No way to create a named, timestamped game-state snapshot from within a session. No way to fork from a checkpoint without mutating the original save. C-334's `SaveDocumentV2` has a `slot_id` field — checkpoints can reuse this as `checkpoint-{name}` slots, but no service method or UI exists.
  2. **No editable recaps**: The `SessionSummary` generated by C-235 is stored as-is. The end-session `preview` phase in `EndSessionViewModel` shows the summary but offers no edit capability. The recap message posted at new-session start is also immutable.
  3. **No player journal**: C-339's `QuestJournalEntry` is auto-generated on quest completion/failure. There is no player-facing journal where the player can write their own notes, observations, or narrative tracking. This is a distinct concept from quest auto-journaling.
  4. **No context compaction**: Each `startNewSession()` posts a recap, but past session summaries accumulate in the AI prompt context without bound. After N sessions, the context window balloons with N session summaries.
  5. **Fork/rollback is a stub**: `continueFromSession()` in `SessionBrowserViewModel` calls `routerService.navigateToApp()` — it does not load the session's save state or restore the game. There is no fork-from-checkpoint flow.
  6. **Session persistence is IndexedDB, not Turso**: `SessionService` uses a separate `aikami_sessions` IndexedDB database. Game saves (C-334) use Turso. A player could lose sessions while saves survive, or vice versa. Both should be in Turso for atomicity.
  7. **No checkpoint browser integration**: The session browser lists sessions by number/date but does not show checkpoints within a session. No UI exists for browsing, comparing, or forking from checkpoints.

- **Baseline tests**:
  - `apps/frontend/client/src/lib/services/game/session_service.test.ts` — ~12 tests: session lifecycle, chat locking, session numbering, auto-summary threshold, IndexedDB persistence
  - `apps/frontend/client/src/lib/services/game/game_save_service.test.ts` — C-334 tests: save/load/delete envelope, concurrency guard
  - `apps/frontend/client/src/lib/services/game/quest_state_service.test.ts` — C-339 tests: quest journal entries, serialize/hydrate round-trip
  - `apps/frontend/client/src/lib/views/game/ui/overlays/end_session/end_session_view_model.test.ts` — end session flow (if exists)
  - Commands: `bun moon run client:test`, `bun moon run client:typecheck`

## User Outcome

After this contract, a **player** can: end a session and review/edit the AI-generated recap before it is saved; create named checkpoints at any safe moment during gameplay; browse past sessions and their checkpoints; fork from any checkpoint to create a new branch without losing the original save; write personal journal entries that persist across sessions; and trust that session context is compacted so the AI stays responsive even after dozens of sessions.

## Success Measures

- **Time/latency target**: Checkpoint save under 500ms (same as C-334 save). Recap editing is instant (local text edit). Context compaction runs during session end (not blocking game loop) and completes within 2 seconds for up to 20 session summaries.
- **Offline/degraded behavior**: All features work fully offline — checkpoints write to local Turso, journal entries are local, recap editing is local. No AI dependency for checkpoint, journal, or fork operations. Context compaction optionally uses AI for hierarchical summarization; when offline, a deterministic truncation fallback is used.
- **Production journey enabled**: Player can play Emberwatch across 10+ sessions without context bloat, checkpoint before major decisions, fork to explore alternate choices, and keep a personal journal throughout.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Session lifecycle (start/end/new) | `session_service.svelte.ts` (C-240) | **Modify** — add checkpoint CRUD, context compaction, migration to Turso |
| Session summarization | `session_summary_service.svelte.ts` (C-235) | **Reuse** — existing `generateSummary()` LLM call |
| Save envelope + Turso persistence | `game_save_service.svelte.ts` (C-334) | **Reuse** — `SaveDocumentV2` with `slot_id` for checkpoint storage |
| Game state snapshot | `EngineBridge.createSnapshot()` (C-334) | **Reuse** — existing ECS snapshot capture |
| Quest auto-journal | `quest_state_service.svelte.ts` (C-339) | **Reference only** — do NOT modify quest journal; player journal is separate |
| Quest journal schema pattern | `QuestJournalEntrySchema` (C-339) | **Reference** — pattern for TypeBox schema + derived type |
| Session browser ViewModel | `session_browser_view_model.svelte.ts` (C-240) | **Modify** — add checkpoint listing, fork action, continue implementation |
| End session dialog | `end_session_view_model.svelte.ts` (C-240) | **Modify** — add recap edit phase |
| Composition root | `game_composition_root.svelte.ts` | **Modify** — inject new services if needed |
| Boot pipeline | `game_boot_service.svelte.ts` (C-334) | **Reuse** — boot from checkpoint uses existing `validating_save` stage |
| Session types | `gm_types.ts` (C-235) | **Reuse** — `SessionSummary` type |

## Overview

C-240 proved the session lifecycle pattern works — a player can end a session, get an AI summary, and start a new one with a recap. C-344 hardens that foundation for long campaigns by adding five missing pieces: (1) **checkpoints** — named, forkable game-state snapshots stored as Turso save slots with metadata; (2) **editable recaps** — a review/edit phase in the end-session flow so the player can correct or augment AI-generated summaries; (3) **player journal** — writable, timestamped notes that persist across sessions (separate from C-339's auto-generated quest journal); (4) **context compaction** — hierarchical summarization that collapses old session summaries so the AI prompt doesn't grow unbounded; (5) **forking** — the ability to branch from any checkpoint, creating a new derivative session without mutating the original. The `SessionService` migrates from IndexedDB to Turso so sessions and saves share a single source of truth.

## Design Reference

- **C-240 execution report** (`docs/contracts/C-240-session-management.md` § Execution Report) — documents the `SessionService`, `SessionSummaryService`, end/new session flow, and session browser ViewModel that this contract extends
- **C-334 save envelope** (`docs/contracts/C-334-make-local-save-continue-autosave-and-recovery-reliable.md` § State & Data Models) — `SaveEnvelopeV2` with `version`, `checksum`, `ecsSnapshot`, `serviceSnapshots`; `SaveDocumentV2` with `slot_id` and `campaign_id`
- **C-339 quest journal** (`quest_state_service.svelte.ts`) — `QuestJournalEntry` schema and `journalEntries` array pattern to reference (NOT modify) for the player journal
- **Save slot ID naming convention**: `auto-save`, `manual-1`, `checkpoint-{name}` — checkpoints follow the same Turso `saves` table pattern
- **Engine snapshot**: `EngineBridge.createSnapshot()` → JSON string in `SaveEnvelopeV2.ecsSnapshot` — checkpoints reuse this exact mechanism

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

All changes are client-only (`apps/frontend/client/src/lib/` and `packages/frontend/repositories/src/lib/` for DDL additions). No backend, no shared packages.

- **Session persistence migration** (`SessionService`): Replace IndexedDB `aikami_sessions` with Turso. Add a `sessions` table to the schema (alongside `saves`, `campaigns`, `chat_history`). `GameSession` documents are stored as rows in this table.
- **Checkpoint CRUD** (`SessionService`): Add `createCheckpoint()`, `listCheckpoints()`, `forkFromCheckpoint()` methods. Checkpoints are stored as `SaveDocumentV2` rows with `slot_id = 'checkpoint-{uuid}'` (UUID-based) and `campaign_id` populated. Checkpoint metadata (label, description, session number, timestamp) is stored in the `sessions` table or a dedicated `checkpoints` table.
- **Checkpoint browser** (`SessionBrowserViewModel`): Extend the existing session browser to show checkpoints nested under each session. Add fork action that creates a new session branching from the checkpoint.
- **Recap editor** (`EndSessionViewModel`): Add an `editing` phase between `summarizing` and `preview`. The player can edit the synopsis text and add/remove key events before saving.
- **Player journal** (new service: `PlayerJournalService` or extend `SessionService`): CRUD for player-written journal entries with title, content, tags, and timestamp. Stored in a new `journal_entries` table in Turso. Serialized as part of service snapshots for save/load.
- **Context compaction** (new method on `SessionService`): After N sessions (default: 5), generate a hierarchical "campaign summary" that compacts older individual session summaries into a single `CompactedCampaignSummary` entry. Uses LLM when available, deterministic truncation fallback when offline.

## State & Data Models

### Session Checkpoint

```typescript
// apps/frontend/client/src/lib/types/session_checkpoint.ts

/**
 * A named, forkable game-state checkpoint within a session.
 *
 * Checkpoints are stored as Turso save slots (`slot_id = 'checkpoint-{uuid}'`).
 * Unlike auto/manual saves, checkpoints carry a label and description
 * so the player can remember why they created them.
 */
type SessionCheckpoint = {
  /** Unique checkpoint identifier (UUID). */
  id: string;
  /** The session this checkpoint belongs to. */
  sessionId: string;
  /** The campaign this checkpoint belongs to. */
  campaignId: string;
  /** Human-readable label (e.g. "Before the dragon"). */
  label: string;
  /** Optional player-written note about this checkpoint. */
  description?: string;
  /** Session number when this checkpoint was created. */
  sessionNumber: number;
  /** ISO-8601 timestamp of checkpoint creation. */
  createdAt: string;
  /** The Turso save slot ID backing this checkpoint's game state. */
  saveSlotId: string;
  /** Whether this checkpoint has been forked from (creating a branch). */
  hasForks: boolean;
};
```

### Player Journal Entry

```typescript
// apps/frontend/client/src/lib/types/player_journal_entry.ts

/**
 * A player-written journal entry — separate from auto-generated quest journal
 * entries (C-339). Players use this to record observations, plans, and
 * narrative notes that persist across sessions.
 */
type PlayerJournalEntry = {
  /** Unique entry identifier (UUID). */
  id: string;
  /** The campaign this entry belongs to. */
  campaignId: string;
  /** The session number when this entry was written. */
  sessionNumber: number;
  /** Entry title (free text, player-written). */
  title: string;
  /** Entry body (free text, player-written). */
  content: string;
  /** Optional tags for categorization (e.g. "quest", "npc", "theory"). */
  tags: readonly string[];
  /** ISO-8601 timestamp of entry creation. */
  createdAt: string;
  /** ISO-8601 timestamp of last edit, same as createdAt if never edited. */
  updatedAt: string;
};
```

### Context Compaction Result

```typescript
// apps/frontend/client/src/lib/types/compacted_campaign_summary.ts

/**
 * Result of compacting multiple session summaries into a hierarchical
 * campaign-level summary. Stored alongside session data so the AI prompt
 * can reference a single compacted entry instead of N individual summaries.
 */
type CompactedCampaignSummary = {
  /** Which sessions were compacted (session IDs). */
  compactedSessionIds: readonly string[];
  /** The session number range covered. */
  sessionRange: { readonly first: number; readonly last: number };
  /** Hierarchical synopsis (LLM-generated or deterministic fallback). */
  synopsis: string;
  /** Key events across all compacted sessions, deduplicated and ranked. */
  keyEvents: readonly string[];
  /** ISO-8601 timestamp of compaction. */
  compactedAt: string;
  /** Method used: 'ai' for LLM compaction, 'truncation' for offline fallback. */
  method: 'ai' | 'truncation';
};
```

### Updated GameSession (extended)

```typescript
// apps/frontend/client/src/lib/services/game/session_service.svelte.ts (extending C-240's GameSession)
// Note: client-local types (SessionCheckpoint, PlayerJournalEntry, CompactedCampaignSummary)
// should be defined in apps/frontend/client/src/lib/types/ (e.g., $types/session_checkpoint.ts)
// per aikami-conventions — service files must NOT export data types.

type GameSession = {
  // ... existing C-240 fields (id, gameId, sessionNumber, startedAt, endedAt,
  //     isActive, summary, messageCount, durationMinutes, characterSnapshots)

  /** Whether the player has reviewed/edited the recap for this session. */
  recapReviewed: boolean;
  /** The player-edited synopsis (if edited; original summary.synopsis if not). */
  editedSynopsis?: string;
  /** Checkpoint IDs created during this session, in creation order. */
  checkpointIds: readonly string[];
};
```

### Turso Schema Additions

```sql
-- Sessions table (replaces IndexedDB `aikami_sessions`)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  summary_json TEXT,          -- JSON serialized SessionSummary or null
  message_count INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER,
  character_snapshots_json TEXT NOT NULL DEFAULT '{}',
  recap_reviewed INTEGER NOT NULL DEFAULT 0,
  edited_synopsis TEXT,
  checkpoint_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Player journal entries
CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  session_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Compacted campaign summaries
CREATE TABLE IF NOT EXISTS compacted_summaries (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  session_range_first INTEGER NOT NULL,
  session_range_last INTEGER NOT NULL,
  compacted_session_ids_json TEXT NOT NULL,
  synopsis TEXT NOT NULL,
  key_events_json TEXT NOT NULL DEFAULT '[]',
  method TEXT NOT NULL CHECK(method IN ('ai', 'truncation')),
  compacted_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_game ON sessions(game_id, session_number);
CREATE INDEX IF NOT EXISTS idx_journal_campaign ON journal_entries(campaign_id, created_at);
CREATE INDEX IF NOT EXISTS idx_compacted_campaign ON compacted_summaries(campaign_id, compacted_at);
```

## Quality Requirements

- **Offline/degraded mode**: Checkpoint creation, journal entry CRUD, recap editing, and fork operations are all fully local (Turso SQLite). No network dependency. Context compaction uses deterministic truncation fallback when AI is unavailable — older summaries are truncated to their first 2 sentences + key event list. The recap failure never blocks session continuation (existing C-240 guard holds).
- **Accessibility/input**: Checkpoint browser and journal must be keyboard-navigable via DaisyUI patterns. Journal text inputs must support standard editing (cut/copy/paste/undo). Recap editor must support textarea editing with DaisyUI form-control styling. Fork confirmation dialog must be focus-trapped.
- **Performance budget**: Checkpoint save reuses C-334's ≤500ms save target. Context compaction runs during `endSession()` (non-blocking — the session ends, compaction is scheduled async). Journal entry writes are under 50ms (simple INSERT). Checkpoint browser loads checkpoint metadata in a single query — no per-checkpoint round trips.
- **Security/privacy**: Journal entries contain player-written text only — no PII beyond what the player voluntarily types. All data stays in local Turso. No remote transmission of journal content.
- **Persistence/migration**: Existing C-240 `aikami_sessions` IndexedDB data must be migrated to the Turso `sessions` table on first load. Migration runs once: read all entries from IndexedDB, write to Turso, mark migration complete in `meta` table. Old IndexedDB data is preserved (not deleted) for rollback safety.
- **Cancellation/retry/idempotency**: Checkpoint creation is idempotent per checkpoint ID (INSERT OR REPLACE). Context compaction is idempotent — running it twice on the same session range produces the same result. Fork creates a new session with a new UUID — always safe to retry. Journal entry saves use INSERT OR REPLACE by entry ID.
- **Observability**: Log checkpoint creation (`checkpoint:created`), fork (`checkpoint:forked`), journal CRUD (`journal:created`, `journal:updated`, `journal:deleted`), context compaction (`compaction:complete` with session range and method), and IndexedDB→Turso migration (`migration:sessions:complete`). All via `this.debug()` (services extend BaseFrontendClass).

## Migration & Rollback

- **Old data compatibility**: C-240 `aikami_sessions` IndexedDB data is migrated to Turso `sessions` table on first load after deployment. Migration is read-only on the IndexedDB side — source data is never deleted. If IndexedDB is unavailable (private browsing, test environment), the `sessions` table starts empty (fresh state).
- **Migration**: One-time migration function in `SessionService._migrateFromIndexedDB()`: open `aikami_sessions` database, read all `GameSession` objects, INSERT OR REPLACE into Turso `sessions` table, write `{ key: 'sessions_migrated', value: '1' }` to `meta` table. Runs on first `startSession()` or `loadSessions()` call after upgrade.
- **Rollback**: If the Turso migration fails, IndexedDB data is intact (never deleted). The `sessions_migrated` marker is not set, so migration retries on next load. To roll back: delete the `sessions` table rows, delete the `sessions_migrated` meta key, restart — IndexedDB data is untouched.
- **Feature flag or kill switch**: N/A — session lifecycle is foundational. Kill switch not appropriate.
- **Failure recovery**: If migration fails mid-way (some rows written, some not), the migration retries on next load. INSERT OR REPLACE is idempotent — previously written rows are overwritten, missing rows are created. No data loss.

## Scope Boundaries

- **In Scope:**
  - `SessionCheckpoint` type + CRUD in `SessionService` (create, list, delete, fork)
  - Checkpoint browser UI (nested under sessions in session browser, fork action)
  - Recap review/edit phase in end-session flow (`editing` phase in `EndSessionViewModel`)
  - `PlayerJournalEntry` type + CRUD in new `PlayerJournalService` (create, read, update, delete, list by campaign)
  - Player journal UI (accessible from pause menu and session browser)
  - Context compaction: compress N older session summaries into a single `CompactedCampaignSummary` (LLM when available, deterministic truncation fallback)
  - `SessionService` migration from IndexedDB to Turso (`sessions` table)
  - Turso schema additions: `sessions`, `journal_entries`, `compacted_summaries` tables
  - Fork flow: create a new session from a checkpoint, restoring game state without mutating the original
  - Wire `continueFromSession()` in session browser to actually load state
  - Dev sandbox updates for checkpoint, journal, and compaction testing

- **Out of Scope:**
  - Quest auto-journal (C-339 — exists, do NOT modify)
  - Save envelope v2 hardening (C-334 — checkpoint storage reuses it, but does not modify it)
  - Auto-save scheduling (C-334)
  - Crash detection and recovery (C-334)
  - Rich chat UX promotion (C-343)
  - Campaign/content-pack browser (C-345)
  - AI Game Master integration (C-351)
  - Cloud sync (C-357)
  - Content authoring studio (C-358)
  - Import/export of journal entries or sessions (C-359)
  - Any changes to `packages/shared/` schemas or types (checkpoint and journal types are client-local, not cross-boundary)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs, 1 project affected (client), single system (session lifecycle). No split required.

## Acceptance Criteria

### AC-1: Editable Session Recaps
**Given** a player ends a session with 10+ messages and an AI-generated summary exists
**When** the end-session flow reaches the preview phase
**Then** the player can switch to an "Edit" mode, modify the synopsis text and add/remove key events, save the edits, and the edited recap is stored with `recapReviewed: true` on the `GameSession`; the edited recap is used for the next session's recap message instead of the original AI-generated one

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration | `end_session_view_model.test.ts`, `session_service.test.ts` | `/game` → Pause → End Session → Edit Recap | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Play session → end session → verify preview shows AI synopsis → click Edit → modify synopsis → save → verify `editedSynopsis` stored → start new session → verify edited synopsis used in recap message
- E2E / Visual:
    - **Functional**: `tests/client/session_mgmt.spec.ts` — end session, edit recap, verify edited recap used in next session
    - **Visual**: N/A (text editing, no new visual component)

**Watch Points**:
- If the player clicks Edit but makes no changes and saves, `editedSynopsis` should still be set (the player reviewed it) but the text matches the original
- The recap editor must not allow saving an empty synopsis (minimum 10 characters)
- If summarization fails (fewer than MIN_MESSAGES_FOR_SUMMARY messages), the recap review/edit phase is skipped — no summary to edit

### AC-2: Session Checkpoints with Fork
**Given** a player is in EXPLORE mode during an active session
**When** the player opens the pause menu, selects "Create Checkpoint", enters a label (e.g. "Before the dragon"), and confirms
**Then** a full game-state snapshot is saved as a Turso save slot (`checkpoint-{uuid}`) with v2 envelope, a `SessionCheckpoint` record is created in the sessions table, and the checkpoint appears in the session browser nested under the current session; the player can later open the checkpoint browser, select a checkpoint, and "Fork from here" to create a new session branching from that checkpoint without mutating the original save

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `session_service.test.ts`, `game_save_service.test.ts` | `/game` → Pause → Create Checkpoint → Fork | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Play session → create checkpoint "Before Boss" → verify Turso `saves` table has a row with `slot_id` starting with `'checkpoint-'` → verify `sessions` table has checkpoint record with matching `saveSlotId` → fork from checkpoint → verify new session created → verify original checkpoint save is untouched
- E2E / Visual:
    - **Functional**: `tests/client/session_checkpoint.spec.ts` — create checkpoint, fork from checkpoint, verify forked session boots with correct game state
    - **Visual**: `suites/session_checkpoint.visual.ts` — checkpoint browser with checkpoints listed under session, fork confirmation dialog
        - `defineConfig` pattern:
          ```typescript
          export default defineConfig({
            tests: [{
              name: 'Checkpoint browser with checkpoints listed',
              route: '/dev/session',
              searchParams: {},
              schema: checkpointBrowserSchema,
              prompt: 'Score 90+: A session browser showing at least one session with checkpoints nested underneath, a "Fork from here" button visible on each checkpoint row.',
            }],
          });
          ```

**Watch Points**:
- Checkpoints use the same ECS snapshot mechanism as C-334 saves — no new serialization path
- Fork creates a new session (new UUID, incremented session number) and copies the checkpoint's save slot to a new save slot for the forked session; the original checkpoint save is never mutated
- Checkpoint creation is gated on safe state (not in combat, not in dialogue transition) — same gates as C-334 auto-save
- If Turso write fails, surface an error toast "Checkpoint creation failed — try again" (does not crash the game)

### AC-3: Player Journal
**Given** a player is in an active session
**When** the player opens the journal from the pause menu, creates a new entry with a title, content, and optional tags, and saves
**Then** the entry is persisted to the Turso `journal_entries` table, appears in the journal list ordered by creation date, can be edited or deleted, and survives across page reloads and session boundaries; the journal is scoped to the current campaign

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | `player_journal_service.test.ts` | `/game` → Pause → Journal → New Entry | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Create 3 journal entries → close journal → reopen → verify all 3 listed → edit entry 2 → verify updated content → delete entry 3 → verify removed from list → reload page → verify entries 1 and 2 still present
- E2E / Visual:
    - **Functional**: `tests/client/player_journal.spec.ts` — create, read, update, delete journal entries
    - **Visual**: `suites/player_journal.visual.ts` — journal list view with entries, journal editor with title/content/tags fields

**Watch Points**:
- Player journal is completely separate from C-339's quest auto-journal — do NOT modify `QuestJournalEntry` or `quest_state_service`
- Journal entry content supports plain text only (no Markdown rendering in MVP)
- Tags are free-form text strings, comma-separated in the UI, stored as `tags_json` array
- Empty content (whitespace-only) must be rejected with validation error
- Title is required (1–100 characters), content is required (1–10,000 characters)

### AC-4: Context Compaction
**Given** a campaign has 5+ completed sessions, each with a session summary
**When** the player ends the 5th (or higher) session
**Then** a context compaction runs asynchronously after the session end completes, compressing the 5 oldest session summaries into a single `CompactedCampaignSummary` record; subsequent AI prompts reference the compacted summary instead of individual old session summaries; when AI is unavailable, a deterministic truncation fallback is used (first 2 sentences of each synopsis + deduplicated key events)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Integration | `session_service.test.ts` (compaction) | `/game` → end 5th session | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Create 5 mock completed sessions with summaries → call compaction → verify `compacted_summaries` table has 1 row covering sessions 1-5 → verify `CompactedCampaignSummary.compactedSessionIds` contains all 5 session IDs → simulate AI unavailable → verify truncation fallback produces a `method: 'truncation'` compaction → verify subsequent `loadSessions()` excludes sessions covered by the compaction (filtered via `compactedSessionIds`)
- E2E / Visual:
    - **Functional**: N/A (too many sessions to simulate in E2E — unit + integration sufficient)
    - **Visual**: N/A

**Watch Points**:
- Compaction is async and non-blocking — the session ends immediately; compaction runs in the background
- If compaction fails (LLM error, timeout), the individual summaries are preserved and compaction retries on the next `endSession()`
- The compaction threshold (5 sessions) should be configurable via a constant, not hardcoded
- Compacted summaries must not be compacted again (idempotency check: skip sessions already covered by a `CompactedCampaignSummary`)

### AC-5: Session Browser Fork and Continue
**Given** past sessions and checkpoints exist for the current campaign
**When** the player opens the session browser and selects a past session or checkpoint
**Then** the player can: (a) view the session/checkpoint read-only (already implemented in C-240); (b) continue from the session — which loads the session's last save state and resumes play; (c) fork from a checkpoint — which creates a new session with state from the checkpoint; forking shows a confirmation dialog explaining that a new branch will be created; both continue and fork restore the complete game state (map, inventory, quests, NPCs, party)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration + E2E | `session_browser_view_model.test.ts` | Start Menu → Continue → Session Browser → Continue/Fork | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Open session browser → select session 2 → click Continue → verify game boots with session 2's save state → verify map, inventory, quest state match session 2's save
- E2E / Visual:
    - **Functional**: `tests/client/session_checkpoint.spec.ts` — continue from session, fork from checkpoint, verify state resumes
    - **Visual**: `suites/session_checkpoint.visual.ts` — session browser with Continue and Fork buttons, fork confirmation dialog

**Watch Points**:
- `continueFromSession()` currently calls `routerService.navigateToApp()` only — must be replaced with actual save loading via `GameBootService` or `GameSaveService`
- Fork creates a full copy of the checkpoint's save state; the new session gets a new UUID and incremented session number
- If the checkpoint's save is corrupted (C-334 checksum mismatch), fork must fail with a clear error: "Checkpoint is corrupted — cannot fork"
- Continue from a session with no saves (e.g., session 0 that was never ended) must show a clear message: "No save data for this session"

## Implementation Sequence

1. **Phase 1 (Data Layer)**: Add `sessions`, `journal_entries`, `compacted_summaries` tables to Turso schema in `packages/frontend/repositories/src/lib/storage_adapter.ts` (`AIKAMI_SCHEMA_DDL`). Migrate `SessionService` from IndexedDB to Turso. Add `SessionCheckpoint`, `PlayerJournalEntry`, `CompactedCampaignSummary` types. Implement checkpoint CRUD, journal CRUD, and context compaction in services. Update serialization to include journal and checkpoint data.
2. **Phase 2 (ViewModels)**: Extend `EndSessionViewModel` with recap editing phase. Create `PlayerJournalViewModel` for journal list/edit/create. Extend `SessionBrowserViewModel` with checkpoint listing and real continue/fork implementations.
3. **Phase 3 (Views + Integration)**: Add checkpoint creation to pause menu. Add journal launcher to pause menu. Wire session browser continue/fork actions. Update end-session flow with edit phase. Hook context compaction into `endSession()` as async post-processing. Update dev sandbox.
4. **Phase 4 (Validation)**: `bun moon run client:fix && bun moon run client:typecheck && bun moon run client:test`. E2E: `cd apps/e2e && bun run test`. Visual: `cd apps/e2e && bun run test:visual`.

## Edge Cases & Gotchas

- **IndexedDB → Turso migration failure**: If IndexedDB is unavailable (private browsing mode, some test environments), the migration is skipped and `sessions` starts empty. This is not an error — it's expected in environments where IndexedDB was never used (fresh install).
- **Checkpoint naming collisions**: If the player creates two checkpoints with the same label, the second one gets a `({n})` suffix (e.g. "Before Boss (2)"). The `saveSlotId` is always unique (UUID-based).
- **Fork from a forked session**: Creating a fork from an already-forked checkpoint is allowed — this creates a tree of branches. Each fork is a new session with a full copy of the checkpoint state.
- **Context compaction with exactly 5 sessions**: Compaction triggers on end of the 5th session — it compacts sessions 1–5 into one. Session 6 becomes the new "oldest uncompacted" session.
- **Recap editing race**: If the player starts editing the recap and simultaneously clicks "Start New Session," the edit is saved first (auto-save on phase transition), then the new session flow begins.
- **Journal entry persistence across forks**: When forking from a checkpoint, journal entries from the source session are NOT copied to the new fork — the forked session starts with an empty journal. The source session's journal remains intact.
- **Session browser with no sessions**: Show an empty state with a DaisyUI hero: "No sessions yet. Start a campaign and end your first session to see it here."
- **Short sessions without summary**: Sessions with fewer than `MIN_MESSAGES_FOR_SUMMARY` (10) messages still appear in the session browser but show "No summary generated — session was too short."

## Open Questions

None — all design decisions are resolved by existing codebase patterns and dependency contracts.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
