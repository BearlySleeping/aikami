# Contract C-334: Make Local Save, Continue, Autosave, and Recovery Reliable

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md C-334 — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `GameSaveService` (Turso save/load), `GameOverlayService` (auto-save trigger), `GameBootService` (validating_save stage), `CampaignService` (saveCampaign linkage), `start_view_model` (Continue UI) |
| **Priority** | P0 — offline-first is a gameplay requirement, not a later sync |
| **Dependencies** | C-313 (Campaign Aggregate & Boot State Machine — implemented, promotion `sandbox`), C-321 (Local Persistence → Turso — implemented, promotion `integrated`), C-326 (Game Boot Atomic — implemented), C-329 (Demo Quest — approved), C-330 (Demo Combat — approved), C-331 (Inventory/Economy — approved, promotion `integrated`), C-332 (HUD/Overlays — approved, promotion `integrated`) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal — none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The building blocks exist — `GameSaveService` writes ECS+service snapshots to Turso, `GameBootService` has a `validating_save` stage, and auto-save fires once on first map load. But each piece is fragile and incomplete: auto-save has no schedule, manual save writes `mapName: 'World'` hardcoded, the `SaveDocument.campaign_id` is always `null`, the save envelope has no version or integrity marker, `loadLastSave()` is a stub that just navigates home, corrupt saves are treated identically to missing saves (both throw `Save not found`), and there is no crash-detection or recovery path. A player closing the browser mid-session loses everything since the last map transition.
- **Reproduction**:
  1. Start a game, walk to a new map, complete combat, open inventory — auto-save fires exactly once on first map load.
  2. Play 10 minutes. Close browser without manual save. Reopen, Continue → nothing (no save beyond that first map-transition).
  3. Corrupt the Turso `saves` row by truncating the payload JSON. Continue → "Save not found" (same error as missing save — no corruption distinction).
  4. Open pause menu, Save Game → success, but the save entry has `mapName: 'World'` regardless of actual map.
- **Existing implementation to reuse**:
  - `apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts` — Turso-backed save/load with envelope (`{ ecsSnapshot, serviceSnapshots }`)
  - `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` — staged boot pipeline with `validating_save` stage
  - `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` — campaign state machine with `saveCampaign()` / `loadCampaign()`
  - `apps/frontend/client/src/lib/services/campaign/boot_state_machine.ts` — pure transition table
  - `apps/frontend/client/src/lib/services/game/serializable_service.ts` — service snapshot registry
  - `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` — `_triggerAutoSave()`, `saveGame()`, `loadLastSave()` (stub)
  - `apps/frontend/client/src/lib/services/persistence/indexeddb_import.ts` — legacy migration pattern
  - `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` — Continue UI
- **Known gaps**:
  1. No scheduled auto-save interval — only fires on first `onMapLoaded()`
  2. No save version/checksum in envelope — corruption indistinguishable from absence
  3. `campaign_id` is `null` on every save — saves can't be scoped to a campaign
  4. `mapName` is hardcoded `'World'` — no actual current map tracking
  5. `loadLastSave()` is a stub (`navigateToApp()`) — no actual reload
  6. No crash-detection marker — an unclean shutdown is indistinguishable from a clean one
  7. No backup checkpoint on failed write — a save that fails leaves no prior recovery point
  8. The `autosave` toggle in `gameplay_view_model` is not wired to any gate
  9. Save slots are ad-hoc (`auto-save`, `manual-1`) with no slot management
- **Baseline tests**:
  - `apps/frontend/client/src/lib/services/game/game_save_service.test.ts` — 8 tests covering save, load, delete, payload retrieval, concurrency guard
  - `apps/frontend/client/src/lib/services/game/game_overlay_service.test.ts` — auto-save status states
  - `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` — Continue flow tests
  - `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` — saveCampaign/loadCampaign transitions

## User Outcome

After this contract, a player can play offline for an extended session, close the app at any moment, and Continue exactly where they left off — with the same map, inventory, quest state, combat results, NPC relationships, and gold balance. If a save is corrupted, the game detects it and offers recovery from the last known good save. Autosave fires at configurable intervals at safe points (not mid-dialogue or mid-combat).

## Success Measures

- **Time/latency target**: Save write under 500ms (Turso local is synchronous disk I/O — must not block the render loop)
- **Offline/degraded behavior**: Saves are fully local (Turso SQLite). No network dependency. Autosave continues functioning offline.
- **Production journey enabled**: Player can play the full Emberwatch demo, close the app, and Continue from the exact game state — completing the Phase 1 "Playable, Polished, Offline-Capable" promise.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| ECS snapshot capture/restore | `GameSaveService.saveGame()` / `loadGame()` | Modify — add version, checksum, mapName, campaignId |
| Service snapshot registry | `serializable_service.ts` (`serializeAllServices`, `hydrateAllServices`) | Reuse |
| Boot pipeline save validation | `GameBootService._stageValidateSave()` | Modify — add corruption detection, version migration |
| Campaign state machine | `boot_state_machine.ts` (SAVE_REQUESTED → saving → SAVE_COMPLETE) | Reuse |
| Campaign persistence | `CampaignRepository` (Turso `campaigns` table) | Reuse |
| Auto-save trigger point | `GameOverlayService.onMapLoaded()` → `_triggerAutoSave()` | Modify — add interval scheduler, safety gates |
| Save/load UI | `start_view_model.svelte.ts` (Continue), `game_overlay_service.svelte.ts` (Pause → Save) | Modify — add slot list, recovery prompt |
| Gameplay settings | `gameplay_view_model.svelte.ts` (autosave toggle) | Reuse — wire to gate |
| Legacy IndexedDB import | `indexeddb_import.ts` | Reference — pattern for migration |

## Overview

The save/load infrastructure exists but each piece is surface-level. This contract hardens the pipeline end-to-end: autosave fires on a configurable schedule at safe points, manual saves carry accurate metadata (map name, campaign ID, version, checksum), Continue restores the complete state, corruption is detected and recovery is offered, and crash-detection prevents the player from losing progress after an unclean shutdown. Local Turso saves remain authoritative — no cloud dependency in Phase 1.

## Design Reference

- Save service follows `GameSaveService` pattern: Turso `saves` table with `id, slot_id, campaign_id, timestamp, map_name, payload`
- Boot pipeline follows `GameBootService` staged pattern: `validating_save` already exists
- Serializable pattern: `registerSerializable('key', { serialize, hydrate })` — all domain services participate
- Campaign state machine: `transition(state, event)` pure function
- Overlay service owns auto-save scheduling (already owns `_triggerAutoSave()` and status)

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

All changes are client-only (`apps/frontend/client/src/lib/`). No backend, no shared packages.

- **Save envelope** (`GameSaveService`): Add `version` (integer), `checksum` (SHA-256 hex), `mapName` (from world state), `campaignId` (from active campaign) to the serialized payload. Update the `saves` table write to include `campaign_id`.
- **Auto-save scheduler** (`GameOverlayService`): Add interval-based auto-save (configurable, default 2 minutes). Gate on: `autosaveEnabled` setting, safe state (not in combat, not in dialogue, not transitioning). Emit status via existing `autoSaveStatus`.
- **Corruption detection** (`GameBootService._stageValidateSave`): Parse the payload envelope, validate `version` is supported, compute SHA-256 of `ecsSnapshot` + `serviceSnapshots` JSON and compare against stored `checksum`. On mismatch → corruption detected (distinct error from "not found").
- **Recovery flow** (`GameOverlayService`, `StartViewModel`): On boot failure due to corruption, surface a recovery dialog with options: "Load backup save" (if exists), "Start fresh". Backup is the previous save for the same campaign (by `campaign_id`, ordered by `timestamp` desc, skip the corrupt one).
- **Crash detection**: Write a `session_active` marker to Turso `meta` table on game start, clear it on clean shutdown. On next boot, if marker exists → crash recovery prompt.
- **Save slot management**: Support named manual slots beyond `manual-1`. List all saves for the current campaign in the pause menu.

## State & Data Models

### Save Envelope (v2)

```typescript
// apps/frontend/client/src/lib/services/game/game_save_service.svelte.ts

import type { ServiceSnapshot } from './serializable_service';

/** Version 2 save envelope — written to the `payload` column of the `saves` table. */
type SaveEnvelopeV2 = {
  /** Envelope version — 2 for this contract. */
  version: 2;
  /** SHA-256 hex digest of JSON.stringify({ ecsSnapshot, serviceSnapshots }). */
  checksum: string;
  /** The ECS world snapshot JSON string from EngineBridge.createSnapshot(). */
  ecsSnapshot: string;
  /** Serialized domain service state snapshots. */
  serviceSnapshots: ServiceSnapshot[];
  /** ISO timestamp of when this save was created. */
  savedAt: string;
};
```

### Save Document (updated `saves` table row)

```typescript
/** Row shape for the `saves` table (existing + new columns). */
type SaveDocumentV2 = {
  id: string;           // e.g. 'aikami_save_auto-save'
  slot_id: string;      // e.g. 'auto-save', 'manual-1', 'checkpoint-boss'
  campaign_id: string;  // 🔴 NEW: linked campaign ID (was null)
  timestamp: number;    // Unix ms
  map_name: string;     // 🔴 FIXED: actual current map name (was 'World')
  payload: string;      // JSON.stringify(SaveEnvelopeV2)
};
```

### Crash Detection Marker

```typescript
// Row in the `meta` table.
type SessionMarker = {
  key: 'session_active';
  value: string; // campaign ID that was active
};
```

## Quality Requirements

- **Offline/degraded mode**: All saves are local Turso SQLite — fully offline. No network code in the save path. Auto-save fires regardless of connectivity.
- **Accessibility/input**: Save/load UI in pause menu must be keyboard-navigable. Recovery dialog must be focus-trapped. Autosave indicator must not rely on color alone (existing checkmark + text "Saved" pattern continues).
- **Performance budget**: Save write must complete within 500ms. SHA-256 computed on the payload string only (not large binary). Auto-save must not fire during frame-critical operations (combat, dialogue transitions). Save writes are awaited but gated so they never stack.
- **Security/privacy**: Save payload contains player game state — no PII beyond what's already in local Turso. SHA-256 is for integrity, not security (no HMAC needed).
- **Persistence/migration**: v1 payloads (no `version` field) must load correctly — treated as version 1 with no checksum validation. v2 payloads require `version === 2` and checksum must match. Migration happens on first v2 save — v1 saves remain readable until overwritten.
- **Cancellation/retry/idempotency**: Save is idempotent per slot ID (`INSERT OR REPLACE`). Auto-save skips if a save is already in progress (existing `isSaving` guard). Failed saves do not overwrite the previous save for that slot (write to temp, rename on success).
- **Observability**: Log save start, success/failure, checksum validation result, auto-save skips (unsafe state), crash marker set/cleared. All via `this.debug()` / `this.warn()` (services extend BaseFrontendClass).

## Migration & Rollback

- **Old data compatibility**: v1 payloads (legacy `{ ecsSnapshot, serviceSnapshots }` without `version`/`checksum`) are detected by absence of `version` field. Load without checksum validation. Overwritten with v2 on next save.
- **Migration**: No batch migration needed — v1 saves are forward-compatible. The first save after deployment writes v2 format. Existing v1 saves continue to load.
- **Rollback**: v2 saves cannot be loaded by pre-contract code (unknown fields are ignored but `version` absence would fail JSON.parse). Rollback requires clearing saves from Turso or using only v1 saves. Acceptable for Phase 1 pre-release.
- **Feature flag or kill switch**: N/A — save integrity is foundational. Kill switch not appropriate.
- **Failure recovery**: If a save write fails mid-write, the previous save for that slot is preserved (write new payload to temp key, atomically replace on success). If crash marker is stuck (clean shutdown didn't clear it), the recovery prompt offers to clear it and continue.

## Scope Boundaries

- **In Scope:**
  - Versioned, checksummed save envelope (v2)
  - Scheduled auto-save at safe checkpoints (configurable interval)
  - Correct `mapName` and `campaignId` in save metadata
  - Corruption detection (checksum mismatch → distinct error)
  - Recovery: load previous save for same campaign on corruption
  - Crash detection via Turso `meta` table marker
  - `loadLastSave()` actual implementation (reloads last save for active campaign)
  - Wire `autosave` toggle from `gameplay_view_model` to auto-save scheduler gate
  - Save-in-progress guard (already exists, verify)
  - Atomic save write (temp + rename)

- **Out of Scope:**
  - Multiple named manual save slots UI (beyond `manual-1` — deferred to C-345 Campaign Browser)
  - Cloud sync / signed-in cloud copy (C-357)
  - Exportable diagnostics / save inspector (C-359)
  - Session recaps / checkpoints (C-344)
  - Deterministic RNG state serialization (C-336)
  - Firestore mirroring or remote backup
  - Save slot delete confirmation UI redesign (use existing)
  - E2E visual test suite (covered by C-335 Playable Demo Release Gate)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 5 ACs, 1 project affected (client), single system (local save pipeline). No split required.

## Acceptance Criteria

### AC-1: Scheduled Autosave at Safe Checkpoints
**Given** the player is in EXPLORE mode (not combat, not dialogue, not transitioning) with autosave enabled
**When** the autosave interval elapses (default 2 minutes)
**Then** an auto-save writes a v2 envelope to the `auto-save` slot with correct `mapName`, `campaignId`, version=2, and a valid SHA-256 checksum; the UI shows "Auto-saved" with a checkmark for 2 seconds

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration | `game_overlay_service.test.ts`, `game_save_service.test.ts` | `/game` (EXPLORE mode) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Start game, wait 2+ minutes in explore mode, verify `saves` table has `auto-save` entry with v2 envelope, `campaign_id` populated, correct `map_name`. Toggle autosave off in settings, verify no auto-save fires.
- E2E / Visual:
    - **Functional**: `tests/client/save_system.spec.ts` — test auto-save fires, test autosave disabled gate, test safe-point gate (no auto-save during combat)
    - **Visual**: N/A (state changes only, no visual regression beyond existing autosave indicator)

**Watch Points**:
- Auto-save must be skipped if `isSaving` is true (existing guard)
- Timer must be cleared on mode change to COMBAT/DIALOGUE and restarted on return to EXPLORE
- Multiple rapid map transitions must not stack auto-saves
- `_triggerAutoSave()` currently creates `new GameSaveService({...})` — this must be changed to `GameSaveService.create({...})` to comply with `aikami-conventions` (all classes extending BaseClass must use `.create()` factory, never `new`)

### AC-2: Manual Save Creates a Versioned, Checksummed Save
**Given** the player opens the pause menu and clicks "Save Game"
**When** the save completes successfully
**Then** the `saves` table contains a `manual-1` entry with: `campaign_id` matching the active campaign, `map_name` matching the current map (not "World"), payload containing v2 envelope (`version: 2`, valid `checksum` SHA-256 of `ecsSnapshot` + `serviceSnapshots` JSON), and `savedAt` ISO timestamp

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `game_save_service.test.ts` | `/game` → Pause → Save | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Manual save via pause menu, query Turso `saves` table, verify all fields. Compute SHA-256 on payload and compare to stored checksum.
- E2E / Visual:
    - **Functional**: `tests/client/save_system.spec.ts` — save via pause menu, verify persistence across reload
    - **Visual**: N/A

**Watch Points**:
- `campaignId` must come from `campaignService.activeCampaign.id` (not hardcoded)
- `mapName` must come from the engine/world state (current map name, not hardcoded)
- Save is atomic: write to temp key first, then rename to final slot key

### AC-3: Continue Restores Complete Game State
**Given** a saved game exists with v2 envelope (ECS snapshot + service snapshots) for campaign C
**When** the player selects Continue from the start menu
**Then** the game boots with: correct map, spawn position, inventory contents, quest progress, defeated enemies list, equipped items, gold balance, NPC state, and campaign state transitions to `playing`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `game_boot_service` tests + manual verification | `/start` → Continue → `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Play game, complete combat, pick up item, save. Reload page, Continue. Verify all state restored.
- E2E / Visual:
    - **Functional**: `tests/client/save_system.spec.ts` — full save→reload→continue→verify cycle
    - **Visual**: N/A (functional verification is sufficient; visual continuity covered by C-335)

**Watch Points**:
- Service snapshots must hydrate BEFORE ECS snapshot (existing order in `_stageHydrateSnapshot`) — world flags must be in place before map load
- Legacy v1 payloads (no version/checksum) must load without checksum validation
- If campaign has `lastSaveSlotId`, it must be used; otherwise fall back to most recent save for campaign

### AC-4: Corruption Detection and Recovery
**Given** a save's payload has been corrupted (e.g., truncated JSON, checksum mismatch)
**When** the player selects Continue or the boot pipeline validates the save
**Then** the system reports a distinct "Save is corrupted" error (not "Save not found"), and the recovery flow offers to load the previous save for the same campaign or start a new game

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Integration | `game_boot_service` tests, `game_save_service` tests | `/start` → Continue (corrupt save) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Corrupt a save by truncating payload JSON in Turso. Attempt Continue — verify "Save is corrupted" error. Verify recovery loads previous save.
- E2E / Visual:
    - **Functional**: `tests/client/save_system.spec.ts` — corrupt payload test case
    - **Visual**: N/A

**Watch Points**:
- Checksum validation must happen in `validating_save` stage (before engine creation)
- Previous save = most recent save for same `campaign_id` with valid checksum, excluding the corrupt one
- If no previous save exists, recovery offers "Start New Game" only
- v1 payloads (no checksum) are NOT flagged as corrupt — only v2+ payloads with mismatched checksums

### AC-5: Crash Recovery — Detect Unclean Shutdown
**Given** the game was running (campaign active) and the browser/app was killed without clean shutdown
**When** the player relaunches the app
**Then** the start screen shows a "Recover session?" prompt listing the last active campaign, and choosing "Recover" (or accept) loads the most recent auto-save for that campaign (or manual save if newer); choosing "Dismiss" (or decline) clears the session marker silently

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + Integration | `game_boot_service` tests, `start_view_model` tests | App cold launch → recovery prompt | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Start game, kill browser (simulate crash). Relaunch — verify recovery prompt. Accept — verify game loads from last auto-save. Decline — verify session marker cleared.
- E2E / Visual:
    - **Functional**: `tests/client/save_system.spec.ts` — crash recovery test case (requires page kill + reload)
    - **Visual**: N/A

**Watch Points**:
- Session marker is written to `meta` table on game boot (after engine init, before first input unlock)
- Session marker is cleared on clean shutdown: pause → Quit to Main Menu, or end session flow
- If marker exists but the corresponding campaign has no saves, clear it silently (no recovery possible)
- Recovery loads the most recent save for the campaign (by timestamp), respecting checksum validation

## Implementation Sequence

1. **Phase 1 (Save Envelope v2 + Metadata)**: Update `GameSaveService` to write v2 envelope with `version`, `checksum`, `campaignId`, `mapName`. Add `parseSavePayloadEnvelope` v2 handling. Update `SaveDocument` type. Update `saves` table write to include `campaign_id`. Add SHA-256 utility. Ensure backward-compatible v1 load.

2. **Phase 2 (Autosave Scheduler + Safety Gates)**: Add interval-based auto-save to `GameOverlayService`. Gate on `autosaveEnabled` (from `gameplay_view_model`), `gameMode !== EXPLORE`, `isTransitioning`. Add clear/restart logic for timer on mode changes. Wire existing `autoSaveStatus` indicator.

3. **Phase 3 (Corruption Detection + Recovery)**: Update `GameBootService._stageValidateSave` to validate checksum for v2 payloads. Add distinct error for corruption vs not-found. Add recovery flow: find previous valid save for same campaign. Surface recovery UI in `StartViewModel`.

4. **Phase 4 (Crash Detection)**: Add session marker write to `meta` table on game boot. Add marker clear on clean shutdown (Quit to Main Menu, end session). Add recovery prompt on startup when marker exists. Wire into `StartViewModel.initialize()`.

5. **Phase 5 (loadLastSave + Validation)**: Implement `loadLastSave()` to reload the last save for the active campaign. Run full test suite (`bun moon run :validate`). Manual integration walkthrough: play → save → kill → recover → verify state.

## Edge Cases & Gotchas

- **Storage quota exceeded**: Turso database may hit disk limits. Catch write errors, surface to user as "Save failed — storage full". Do not crash. Previous save remains intact.
- **Concurrent auto-save + manual save**: Existing `isSaving` guard prevents both. If auto-save fires during manual save, auto-save skips (no queuing).
- **Rapid map transitions**: Each `onMapLoaded` call must not stack auto-saves. If a save is in progress, skip. Use debounce (1s after last map load, not immediate).
- **Empty campaign saves**: A fresh campaign with no saves has `lastSaveSlotId = undefined`. Continue should be disabled (already handled by `hasSaves` check).
- **Campaign ID mismatch**: If a save's `campaign_id` doesn't match the active campaign, it must not appear in that campaign's save list. The `fetchAvailableSaves` query should filter by `campaign_id`.
- **SHA-256 on large payloads**: The payload is on the order of kilobytes (JSON strings of ECS snapshots), not megabytes. SHA-256 computation is fast (<5ms). If this changes, move checksum computation off-main-thread.
- **Version migration forward**: When v3 is introduced, v2→v3 migration function must run in `validating_save` stage. This contract only defines v2; future contracts handle migration.

## Open Questions

- **Q1**: Should the `fetchAvailableSaves()` default query (used by main menu, before campaign selection) show saves from all campaigns, or require a campaign context? _Current assumption: show all saves on main menu (no campaign filter), but show campaign-scoped saves in pause menu._
- **Q2**: What is the exact autosave interval? _Default 2 minutes, configurable via gameplay settings (future contract). No UI for interval in this contract — just wire the existing `autosave` boolean toggle._
- **Q3**: Should the recovery prompt offer to load any previous save or only the most recent valid one? _Most recent valid save for the same campaign. No save browser UI in this contract (deferred to C-345)._

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
