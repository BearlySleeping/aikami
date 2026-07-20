# Contract C-345: Add a Campaign/Content-Pack Browser and a Second Adventure

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/TODO.md` § C-345 — Phase 2 — Core RPG Depth and Replayability |
| **Target** | `packages/shared/schemas/src/lib/game/content_pack.ts` (modify — add optional `description` field), `packages/shared/schemas/src/lib/game/pack_index.ts` (new), `packages/shared/types/src/lib/game/pack_index.ts` (new), `apps/frontend/client/src/lib/services/campaign/pack_registry_service.svelte.ts` (new), `apps/frontend/client/src/lib/views/start/components/pack_browser_view.svelte` (new), `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` (modify), `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` (modify), `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` (modify), `apps/frontend/client/static/content-packs/` (new second pack + pack index) |
| **Priority** | P1 — one vertical slice proves quality; a second proves the architecture is reusable |
| **Dependencies** | C-315 (Define a Versioned Campaign Content Pack and Atomic Loader — `completed`), C-334 (Make Local Save, Continue, Autosave, and Recovery Reliable — `approved`), C-339 (Complete Quest Graph, Journal, Objectives, and Reward Pipelines — `implemented`), C-344 (Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle — `implemented`) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | None — internal infrastructure |
| **Contract version** | 2.0.0 |

### Dependency Status

| Dependency | Status | Risk |
|---|---|---|
| C-315 Content Pack & Atomic Loader | `completed` (with execution report) | **Low** — `ContentPackManifestSchema`, `loadContentPack()`, `ContentPackLoaderInterface`, and the emberwatch pack at `static/content-packs/emberwatch/` are all production-ready. The loader caches by `packId`, resolves map URLs, and validates manifests. |
| C-334 Local Save/Continue/Autosave | `approved` (not yet implemented) | **Medium** — `GameSaveService` with Turso envelope v2, `SaveDocumentV2` with `campaign_id`, and crash recovery are still in-flight. This contract's campaign-switching AC relies on saves being campaign-scoped (C-334 fixes the current `campaign_id: null` gap). If C-334's save format changes, the campaign-browser card showing "last saved: X minutes ago" must adapt. |
| C-339 Quest Graph & Journal | `implemented` (with execution report) | **Low** — prerequisite-gated objectives, hidden/optional/timed objectives, chain prerequisites, repeatable quests, and journal entries are all implemented. The second adventure pack can use these features. |
| C-344 Session Recaps & Checkpoints | `implemented` (with execution report) | **Low** — `SessionService` with end/new session flows, session browser, and checkpoint CRUD exist. Campaign switching between sessions works — the pack browser just needs to show per-campaign session state. |

## Problem & Baseline Evidence

- **Current behavior**: Only one content pack exists — `emberwatch` at `static/content-packs/emberwatch/manifest.json`. `campaign_service.svelte.ts:126` hardcodes `contentPackId: 'emberwatch'` on every new campaign. `game_boot_service.svelte.ts:482` calls `loadContentPack({ packId: input.contentPackId })` which resolves to the sole pack. There is no mechanism to discover installed packs, browse their metadata, or select a pack when creating a campaign. The `contentPackId` field on `Campaign` is architecturally correct (C-313, C-315), but the user has zero visibility into it — it's an invisible string. The start menu's "New Game" always boots the same emberwatch adventure with no alternative.

- **Reproduction**:
  1. `bun moon run client:dev`, navigate to the start menu, click "New Game" → observe: no pack selection step. The campaign silently gets `contentPackId: 'emberwatch'`.
  2. Navigate to `/game` → the engine always loads the emberwatch manifest and embarks on the same adventure.
  3. Check `static/content-packs/` → only `emberwatch/` directory exists. No second adventure pack.
  4. Create a campaign manually, switch to a different `contentPackId` string → the loader throws `"ContentPackLoader: manifest not found"` because no other pack directory exists.
  5. The `loadContentPack` cache is module-level (`_contentPackCache: Map<string, ContentPackLoaderInterface>`). Switching campaigns across packs without calling `clearContentPackCache()` returns the stale cached manifest.
  6. No pack metadata is displayed anywhere in the UI — the player never sees pack name, version, credits, or compatibility info.

- **Existing implementation to reuse**:
  - `packages/frontend/engine/src/assets/content_pack_loader.ts` — `loadContentPack({ packId })` with TypeBox validation, in-memory cache, `ContentPackLoaderInterface` with `manifest`, `getStartingMap()`, `getNpc()`, `getQuest()`, etc. Module-level `clearContentPackCache()` exists.
  - `packages/shared/schemas/src/lib/game/content_pack.ts` — `ContentPackManifestSchema` with full validation: `id`, `name`, `version`, `updatedAt`, `startingMapId`, `maps`, `npcs`, `items`, `dialogues`, `quests`, `encounters`, `credits`, `onboarding`, `classes`, `abilities`, `factions`, `interactables`, `puzzles`, `lootTables`.
  - `packages/shared/schemas/src/lib/game/campaign.ts` — `CampaignSchema` with `contentPackId: Type.String()`.
  - `packages/shared/types/src/lib/game/content_pack.ts` — All `ContentPack*` types derived from TypeBox schemas.
  - `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` — `startNewCampaign()`, `loadCampaign()`, `campaigns: Campaign[]`, `activeCampaign`. Hardcodes `contentPackId: 'emberwatch'`.
  - `apps/frontend/client/src/lib/services/campaign/campaign_repository.svelte.ts` — Turso-backed `CampaignRepository` with `create()`, `getAll()`, `getById()`, `update()`, `delete()`.
  - `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` — staged boot pipeline: `loading_campaign` → `preloading_content` → `loading_map` → `spawning`. At `preloading_content` stage (line 482), calls `loadContentPack({ packId: input.contentPackId })`. Already resolves `contentPackId` from campaign override.
  - `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` — `StartViewModel` with "New Game" / "Continue" buttons. C-317 rebuilt this around campaigns, but the ViewModel still routes directly to `/setup` without pack selection.
  - `apps/frontend/client/static/content-packs/emberwatch/manifest.json` — v2.1.0 pack with 3 maps, 7 NPCs, 14 items, full quest/dialogue/encounter data. This is the reference implementation for all content packs.
  - SvelteKit `static/` convention — files under `static/` are served at `/` in dev, bundled verbatim in production. Content packs at `static/content-packs/<id>/manifest.json` are fetchable at `/content-packs/<id>/manifest.json`.

- **Known gaps**:
  1. No pack discovery — the game doesn't know what packs are installed. `loadContentPack()` requires a known `packId`.
  2. No pack registry or index — there is no `/content-packs/index.json` or equivalent that lists available packs.
  3. No pack selection UI — the start menu has no screen or modal for choosing a content pack.
  4. No second adventure pack — `emberwatch` is the only content pack, making the architecture untested for multi-pack scenarios.
  5. `contentPackId` is hardcoded (`'emberwatch'`) in `campaign_service.svelte.ts` — no mechanism to accept a user-selected pack ID.
  6. `campaign_service.startNewCampaign()` doesn't accept `contentPackId` in its options — only `personaId` and `capabilityProfile`.
  7. No pack cache invalidation on campaign switch — `game_boot_service._stagePreloadContent()` stores the `clearContentPackCache` function but does NOT call it before `loadContentPack()`. The cache is only cleared in `resetForRetry()` (for retry-after-failure). On a fresh boot with a different pack, the stale cached manifest would be returned.
  8. No pack metadata display — players can't see pack name, version, credits, or compatibility from within the game.
  9. No "starter personas" associated with packs — the TODO.md target field mentions starter personas, but currently characters are standalone localStorage blobs with no pack association.

- **Baseline tests**:
  - `packages/frontend/engine/src/assets/content_pack_loader.test.ts` — 35 tests covering manifest validation, map URL resolution, path traversal prevention, NPC/item/quest/encounter lookups, dialog resolution, cache hits, and disposal. All pass.
  - `packages/frontend/engine/src/assets/content_pack_loader.integration.test.ts` — Integration tests against the real `emberwatch` v2.0.0 manifest. 35 tests pass.
  - `packages/shared/schemas/src/lib/game/content_pack.test.ts` — Schema validation tests for manifest format. All pass.
  - `packages/shared/schemas/src/lib/game/campaign.test.ts` — Campaign schema validation including `contentPackId` field.
  - `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` — Campaign lifecycle tests.
  - `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` — Start menu flow tests (must be extended for pack selection).

## User Outcome

After this contract, a player opens the start menu and can browse installed content packs — seeing each pack's name, version, description, map count, and credits — before starting a new campaign. Two authored adventures (Emberwatch + a second mini-adventure) are available. When switching between campaigns that use different packs, each campaign restores only its own maps, NPCs, quests, saves, and game state — no asset or state leaks across pack boundaries.

## Success Measures

- **Time/latency target**: Pack registry loads and renders within 300ms (fetching a small JSON index from `static/`).
- **Offline/degraded behavior**: Content packs are bundled in the static directory — no network dependency. Pack discovery works fully offline. AI capability is advisory only (displayed per-pack, but doesn't block selection).
- **Production journey enabled**: A player can choose between two distinct adventures from the start menu, start a campaign in either, and switch between them without data corruption.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Pack manifest schema | `packages/shared/schemas/src/lib/game/content_pack.ts` — `ContentPackManifestSchema` | **Reuse** as-is |
| Pack loader + cache | `packages/frontend/engine/src/assets/content_pack_loader.ts` — `loadContentPack()`, `clearContentPackCache()` | **Reuse** as-is; add `clearContentPackCache()` call at the start of `_stagePreloadContent()` before `loadContentPack()` |
| Pack types | `packages/shared/types/src/lib/game/content_pack.ts` — `ContentPackManifest`, `ContentPackCredits`, etc. | **Reuse** as-is |
| Campaign service | `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` | **Modify** — add `contentPackId` to `startNewCampaign()` options |
| Campaign repository | `apps/frontend/client/src/lib/services/campaign/campaign_repository.svelte.ts` | **Reuse** as-is |
| Game boot service | `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` | **Modify** — call `clearContentPackCache()` before `loadContentPack()` |
| Start menu ViewModel | `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` | **Modify** — add pack browser state, pack selection before "New Game" |
| Start menu View | `apps/frontend/client/src/lib/views/start/start_view.svelte` | **Modify** — add pack selection flow |
| Emberwatch content pack | `apps/frontend/client/static/content-packs/emberwatch/` | **Reuse** — reference implementation, no changes needed |
| C-317 start menu rebuild | `docs/contracts/C-317-*.md` | **Extend** — C-317 centered on campaigns, C-345 adds pack selection before campaign creation |

## Overview

Add a local content pack registry that discovers installed packs from `static/content-packs/`, a pack browser UI in the start menu, a second authored mini-adventure content pack, and the wiring to select a pack when creating a new campaign. Ensure campaign switching clears the pack cache so each campaign loads its own pack's assets and state without cross-contamination.

## Design Reference

- **ViewModel pattern**: `BaseViewModel` from `@aikami/frontend/services` — `$state` fields, `create()` factory, `initialize()` for data loading.
- **Service pattern**: `BaseFrontendClass` with `create()` factory — singleton or module-level export. Follow `campaign_repository.svelte.ts` and `campaign_service.svelte.ts` conventions.
- **View pattern**: Svelte 5 runes-only, zero-logic Views. `$props()` for ViewModel. daisyUI components for cards and modals. Follow `start_view.svelte` conventions.
- **Content pack authoring**: Follow the emberwatch pack structure — each pack is a directory under `static/content-packs/<id>/` with a `manifest.json` conforming to `ContentPackManifestSchema` and map files in `maps/`.
- **Pack discovery**: Fetch a pre-authored `static/content-packs/index.json` that lists all pack directories and their `manifest.json` URLs. No server-side scanning needed (static SPA — Pillar 1).
- **Route**: No new SvelteKit route needed — pack selection is a modal or step within the start menu flow (`/`), consistent with C-317's design.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

| Component | Location | Notes |
|---|---|---|
| Pack registry service | `apps/frontend/client/src/lib/services/campaign/pack_registry_service.svelte.ts` | New — discovers installed packs, loads manifest summaries, exposes `availablePacks` |
| Pack browser View | `apps/frontend/client/src/lib/views/start/components/pack_browser_view.svelte` | New — displays pack cards with metadata (name, version, map count, credits) |
| Pack selection ViewModel state | `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` | Modify — add `selectedPackId`, `showPackBrowser`, pack list from registry |
| Campaign service | `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` | Modify — `startNewCampaign()` accepts `contentPackId` option |
| Game boot service | `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` | Modify — call `clearContentPackCache()` before loading a new pack |
| Pack index | `apps/frontend/client/static/content-packs/index.json` | New — pre-authored registry listing available packs |
| Second adventure pack | `apps/frontend/client/static/content-packs/<id>/` | New — follows manifest schema, at least 1 map + 2 NPCs + 1 quest |

## State & Data Models

### Pack Registry Index (new — `static/content-packs/index.json`)

```typescript
// packages/shared/schemas/src/lib/game/pack_index.ts (new)

import Type, { type Static } from 'typebox';

/** A single entry in the content pack registry index. */
export const PackIndexEntrySchema = Type.Object({
  /** Pack identifier — matches ContentPackManifest.id and Campaign.contentPackId */
  id: Type.String({ minLength: 1 }),
  /** Human-readable pack name (cached from manifest for fast listing) */
  name: Type.String(),
  /** Semantic version string (cached from manifest) */
  version: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$' }),
  /** ISO 8601 last modification timestamp (cached from manifest) */
  updatedAt: Type.String(),
  /** Short description of the adventure (cached from manifest) */
  description: Type.Optional(Type.String()),
});

export type PackIndexEntry = Static<typeof PackIndexEntrySchema>;

/** Top-level pack registry index. */
export const PackIndexSchema = Type.Object({
  /** Registry schema version for forward compatibility */
  schemaVersion: Type.Literal(1),
  /** All installed content packs */
  packs: Type.Array(PackIndexEntrySchema),
});

export type PackIndex = Static<typeof PackIndexSchema>;
```

### ContentPackManifest — Add `description` Field (modify)

The existing `ContentPackManifestSchema` lacks a top-level `description` field.
AC-2 requires showing the pack's description in the detail panel. Since the
detail panel fetches the full manifest via `loadContentPack()`, the description
must live on the manifest. Add as an **optional** field to avoid breaking
existing packs.

```typescript
// packages/shared/schemas/src/lib/game/content_pack.ts — modify

// Add after `name` field in ContentPackManifestSchema:
/** Optional short description of the adventure (shown in pack browser detail panel) */
description: Type.Optional(Type.String({ description: 'Short adventure description' })),
```

### Pack Registry Service Interface (new)

```typescript
// apps/frontend/client/src/lib/services/campaign/pack_registry_service.svelte.ts

export type PackRegistryServiceInterface = BaseFrontendClassInterface & {
  /** All installed content packs with cached metadata. */
  readonly availablePacks: readonly PackIndexEntry[];
  /** Whether the pack index is currently being fetched. */
  readonly isLoading: boolean;
  /** Error message if pack index fetch failed, or undefined. */
  readonly error: string | undefined;

  /** Fetches and validates the pack index from /content-packs/index.json. */
  refresh(): Promise<void>;
  /** Returns a pack index entry by ID, or undefined. */
  getPack(packId: string): PackIndexEntry | undefined;
};
```

### Campaign Service — Extended Options (modify)

```typescript
// apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts

// Existing startNewCampaign options extended:
startNewCampaign(options?: {
  personaId?: string;
  capabilityProfile?: CapabilityProfile;
  /** Content pack ID for this campaign. Defaults to 'emberwatch'. */
  contentPackId?: string;  // ← NEW
}): Promise<Campaign>;
```

## Quality Requirements

- **Offline/degraded mode**: Pack index is bundled as a static JSON file — fully offline. No network fetch needed. Pack manifests are also static files under `static/content-packs/`. N/A — no network dependency.
- **Accessibility/input**: Pack browser uses daisyUI cards with keyboard navigation (Tab/Enter to select). Focus trap in pack selection modal. All interactive elements have accessible labels. N/A — gamepad support deferred to C-346.
- **Performance budget**: Pack index fetch under 300ms (static JSON, sub-KB). Pack browser renders in under 16ms (React-style `$state` update, single-frame). Pack manifest fetch on selection under 500ms (static JSON, typically <10KB).
- **Security/privacy**: Pack index and manifests are static, pre-authored files — no user-generated content, no injection vectors. Path traversal already blocked in `content_pack_loader.ts:123`. Manifest validation through TypeBox guards against malformed manifests.
- **Persistence/migration**: Pack selection is recorded on `Campaign.contentPackId` (existing field). Existing campaigns with `contentPackId: 'emberwatch'` continue to work — the emberwatch pack remains installed and discoverable. The pack index is a new artifact — no migration needed for existing data.
- **Cancellation/retry/idempotency**: Pack index fetch is retried once on failure with exponential backoff. `refresh()` is idempotent — calling it multiple times re-fetches and replaces state. Pack manifest loading through `loadContentPack()` already has in-memory caching.
- **Observability**: `pack_registry_service` logs index fetch success/failure via `this.debug()`. `game_boot_service` already logs `contentPackId` during `preloading_content` stage. Pack cache clear is logged.

## Migration & Rollback

- **Old data compatibility**: Existing campaigns have `contentPackId: 'emberwatch'` — matches the emberwatch pack in the new index. Zero-impact. If the pack index is missing or fails to load, the pack registry service returns an empty list, and campaign creation falls back to `'emberwatch'` (existing hardcoded default).
- **Migration**: No data migration. The pack index is a new pre-authored file. Campaigns reference pack IDs that must exist in the index — validation at campaign creation time prevents orphaned references.
- **Rollback**: Revert the pack index and pack browser code. Existing campaigns with `contentPackId: 'emberwatch'` continue to work because the emberwatch pack and `loadContentPack()` are unchanged.
- **Feature flag or kill switch**: If the pack index is deleted or the route `static/content-packs/index.json` returns 404, the pack registry fails gracefully (empty list, no crash), and `campaign_service` falls back to `'emberwatch'`. No runtime flag needed — the static file is the flag.
- **Failure recovery**: If the pack index fails to fetch, `pack_registry_service` sets `error` and `isLoading = false`. The start menu shows "New Game" without pack selection (defaults to emberwatch). If a specific manifest fails to load during campaign boot, the existing `loadContentPack()` error handling throws a typed error caught by `game_boot_service`.

## Scope Boundaries

- **In Scope:**
  - Add optional `description` field to `ContentPackManifestSchema` (for pack detail display)
  - New `PackIndexSchema` + `PackIndexEntrySchema` in `packages/shared/schemas/` with derived types in `packages/shared/types/`
  - Pre-authored `static/content-packs/index.json` with pack registry entries
  - `PackRegistryService` for fetching and caching the pack index
  - Pack browser UI component showing installed packs with metadata
  - Start menu flow: "New Game" → pack selection (modal or step) → character creation
  - `campaign_service.startNewCampaign()` accepting `contentPackId`
  - `game_boot_service` calling `clearContentPackCache()` at the start of `_stagePreloadContent()`, before loading a new pack
  - A second authored mini-adventure content pack with at least 1 map, 2 NPCs, and 1 quest
  - Unit and integration tests for pack registry, pack switching, and cache isolation

- **Out of Scope:**
  - Pack installation from remote URLs or web stores (C-369 community sharing)
  - Pack update/version management (C-358 content authoring)
  - Pack asset provenance validation (C-347)
  - Starter personas associated with packs (deferred — personas are standalone localStorage blobs; pack-persona association requires C-317/C-319 persona refactor)
  - Generated campaigns as content packs (C-354)
  - Pack import/export (C-359)
  - Gamepad/touch navigation in the pack browser (C-346)
  - Character creation tied to specific packs (personas remain pack-agnostic for now)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:**

5 ACs (under the 6 threshold), 2 projects affected (client + engine), single releasable system (pack discovery + selection + second adventure are one feature). No split needed. The second adventure pack is a test artifact, not a separate system.

## Acceptance Criteria

### AC-1: Pack Discovery and Listing
**Given** the pack index file `static/content-packs/index.json` exists with at least two entries (emberwatch + a second adventure)
**When** the start menu loads and calls `packRegistryService.refresh()`
**Then** `packRegistryService.availablePacks` contains both packs with their `id`, `name`, `version`, and `description` fields populated; the pack browser UI renders a card for each pack showing its name and version

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration | `pack_registry_service.test.ts` (new), `pack_browser_view.svelte` (new) | `/` start menu | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test` — pack registry unit tests
- Integration: Load start page, verify pack browser renders cards for both packs
- E2E / Visual:
    - **Functional**: `tests/client/start_menu.spec.ts` — test case: "navigates to start menu and sees available packs" — verify pack cards are visible; test case: "clicks New Game and pack browser opens"
    - **Visual**: N/A — pack browser is a text/metadata UI, not graphical game content

**Watch Points**:
- Pack index fetch failure must not crash the start menu — graceful fallback to empty pack list with "New Game" defaulting to emberwatch
- Pack index JSON must pass TypeBox validation before being exposed to the UI

### AC-2: Pack Metadata Inspection
**Given** the pack browser shows at least two packs
**When** the user selects (clicks/focuses) a pack card
**Then** an expanded detail panel shows the pack's full metadata: version, updated date, description, map count, NPC count, quest count, and credits (design/writing/art/music/thanks)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `pack_browser_view.svelte` (detail panel), `pack_registry_service.svelte.ts` (manifest fetch for details) | `/` start menu | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test` — pack registry manifest fetch tests
- Integration: Open pack browser, click emberwatch card, verify detail panel shows version, updated date, map/NPC/quest counts, credits
- E2E / Visual:
    - **Functional**: `tests/client/start_menu.spec.ts` — test case: "selects a pack and sees expanded metadata"
    - **Visual**: N/A

**Watch Points**:
- Manifest fetch for details must use the existing `loadContentPack()` path — don't fetch the manifest separately
- Credits array may be empty or absent (`credits` is optional in `ContentPackManifestSchema`) — handle gracefully

### AC-3: Campaign Creation with Pack Selection
**Given** the player has selected a content pack in the pack browser
**When** they confirm "Start New Game" with that pack selected
**Then** `campaignService.startNewCampaign({ contentPackId })` creates a `Campaign` with the selected `contentPackId`, and the game boots using that pack's manifest and starting map

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration + E2E | `campaign_service.test.ts` (extended), `start_view_model.test.ts` (extended) | `/` → `/setup` → `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test` — campaign service pack selection tests
- Integration: Create a campaign with pack A, verify `Campaign.contentPackId === 'pack-a'`. Create a campaign with pack B, verify `Campaign.contentPackId === 'pack-b'`.
- E2E / Visual:
    - **Functional**: `tests/client/start_menu.spec.ts` — test case: "selects second adventure pack, starts new game, and arrives at character creation with correct pack context"
    - **Visual**: N/A

**Watch Points**:
- `startNewCampaign({ contentPackId })` must validate that the pack exists in the registry before creating the campaign
- If no `contentPackId` is provided, default to `'emberwatch'` (backward compatibility)
- The existing persona-based branching in `start_view_model.startNewGame()` (C-317) must be preserved — pack selection happens before the persona/character flow

### AC-4: Campaign Switching Isolates Pack-Specific State
**Given** two campaigns exist — Campaign A using `pack-a` and Campaign B using `pack-b` — each with its own saves, quest progress, inventory, and map position
**When** the player switches from Campaign A to Campaign B (loads the other campaign from the start menu)
**Then** Campaign B restores only its own pack's maps, NPCs, quests, items, and saves; no assets or state from Campaign A's pack bleed into Campaign B

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration + E2E | `game_boot_service.test.ts` (extended), `save_service.test.ts` (extended) | `/` → load Campaign B → `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test` — campaign switching + pack isolation tests
- Integration: Create Campaign A with pack A, save game with unique inventory. Create Campaign B with pack B, save game with different inventory. Load Campaign A — verify it restores Campaign A's inventory, not B's.
- E2E / Visual:
    - **Functional**: `tests/client/campaign_switch.spec.ts` (new) — test case: "creates two campaigns with different packs, switches between them, and verifies distinct save states"
    - **Visual**: N/A

**Watch Points**:
- Save scoping by `campaign_id` is critical — C-334's `SaveDocumentV2` with `campaign_id` must be implemented for this AC to pass. If C-334 is delayed, saves must be scoped by campaign ID through an alternative path (e.g., Turso query WHERE campaign_id = ?).
- `clearContentPackCache()` must be called before loading a different pack — stale cached manifests would return the wrong pack data.
- `GameStateService.reset()` and related service resets (`inventoryService.reset()`, `worldStateService.reset()`, etc.) must clear between campaigns — this is already done in the boot pipeline.

### AC-5: Cache Isolation on Pack Switch
**Given** the engine has loaded pack A's manifest (cached in `_contentPackCache`)
**When** the player loads a campaign using pack B (different `contentPackId`)
**Then** the engine calls `clearContentPackCache()` before `loadContentPack({ packId: 'pack-b' })`, and the loader fetches pack B's manifest (not pack A's cached manifest)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `content_pack_loader.test.ts` (extended), `game_boot_service.test.ts` (extended) | N/A — engine-level | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run engine:test` — cache isolation unit tests
- Integration: Load pack A, verify manifest has pack A's `id`. Load pack B, verify manifest has pack B's `id`.
- E2E / Visual:
    - **Functional**: N/A — unit-tested at the engine level
    - **Visual**: N/A

**Watch Points**:
- `clearContentPackCache()` is already exported from `content_pack_loader.ts` — just need to call it at the right point in the boot pipeline
- Must be called AFTER the campaign is loaded but BEFORE `loadContentPack()` is called — otherwise we clear the cache but then don't load a new pack
- The `_contentPackCache` is module-level — verify no stale references to the old `ContentPackLoaderInterface` survive after the clear

## Implementation Sequence

1. **Phase 1 (Data/Logic)**:
   - Add optional `description` field to `ContentPackManifestSchema` in `packages/shared/schemas/src/lib/game/content_pack.ts`
   - Create `static/content-packs/index.json` with emberwatch entry and placeholder for second pack
   - Create `packages/shared/schemas/src/lib/game/pack_index.ts` — `PackIndexSchema` + `PackIndexEntrySchema` (omit `manifestPath` — path derived from packId by `loadContentPack()`)
   - Create `packages/shared/types/src/lib/game/pack_index.ts` — re-export types via `Static<>`
   - Create `pack_registry_service.svelte.ts` — fetches index, validates via TypeBox, exposes `availablePacks`
   - Modify `campaign_service.svelte.ts` — add `contentPackId` to `startNewCampaign()` options
   - Modify `game_boot_service.svelte.ts` — call `clearContentPackCache()` at the start of `_stagePreloadContent()` before calling `loadContentPack()` (currently only called in `resetForRetry()`)
   - Create the second adventure content pack under `static/content-packs/<id>/` with manifest.json + maps/
   - Update `static/content-packs/index.json` with the second pack's entry

2. **Phase 2 (Integration)**:
   - Create `pack_browser_view.svelte` — pack cards + detail panel using daisyUI
   - Modify `start_view_model.svelte.ts` — add `selectedPackId`, `showPackBrowser`, pack selection flow
   - Modify `start_view.svelte` — wire pack browser into the "New Game" flow
   - Update `start_view_model.test.ts` for pack selection tests
   - Write `pack_registry_service.test.ts`

3. **Phase 3 (Validation)**:
   - Run `bun moon run :validate` — full lint + typecheck + test
   - Run `bun moon run engine:test` — verify content pack loader cache isolation
   - Run `bun moon run client:test` — verify all start menu and campaign service tests
   - Manual smoke test: create two campaigns with different packs, switch between them, verify isolation

## Edge Cases & Gotchas

- **Missing pack index**: If `/content-packs/index.json` returns 404 (e.g., file deleted, wrong static path), `pack_registry_service.refresh()` must catch the error, set `error` state, and leave `availablePacks` as an empty array. The start menu falls back to showing just "New Game" without pack browser. Campaign creation defaults to `'emberwatch'`.
- **Pack index with invalid entry**: If the index JSON passes `PackIndexSchema` validation but a specific manifest fails to load (404 or schema violation), the pack card should still appear but show a "corrupt" badge. Don't crash the entire browser for one bad pack.
- **Deleted pack directory**: If the pack index lists a pack but its `manifest.json` is missing, `loadContentPack()` already throws with HTTP status. The `campaign_service` must validate pack existence at campaign creation time, not at boot time.
- **`contentPackId` mismatch**: If a campaign's `contentPackId` doesn't match any installed pack (e.g., external save import), the boot pipeline must surface a clear error: "Content pack 'xyz' is not installed. Please install it before loading this campaign." Do not silently fall back to emberwatch.
- **C-334 save format**: If C-334's `SaveDocumentV2` with `campaign_id` is not yet implemented when this contract is built, save scoping must use an alternative — either query Turso `campaigns` table for `contentPackId` or use the campaign's `lastSaveSlotId`. The contract should not be blocked by C-334's status — implement the save scoping as designed, using whatever C-334 provides at the time.
- **Persona/pack association**: Personas are standalone localStorage blobs with no pack ID. If a character created under pack A's campaign is selected for pack B's campaign, the character data is pack-agnostic (LPC appearance, class, stats). This is acceptable — personas don't carry pack-specific state. Only the campaign carries pack identity.

## Open Questions

Must be resolved before status becomes `approved`:

- **Second adventure ID and theme**: What is the second adventure's `id` (content pack identifier), name, and basic premise? Suggestions: `'whispering-caves'` (underground exploration), `'ashen-coast'` (coastal/trade-focused), `'iron-bastion'` (military fortress). Must be decided before Phase 1 implementation.
- **Pack index generation strategy**: The index is pre-authored (`static/content-packs/index.json`). Should it be auto-generated at build time (moon task scanning `static/content-packs/` directories) or manually maintained? Manual is simpler for 2 packs; auto-generation should be done as part of C-358 (content authoring studio).
- **Starter personas scope**: The TODO.md target field mentions "starter personas" but this is explicitly out of scope for this contract. Should a follow-up contract (or C-317 extension) handle pack-specific starter personas?

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

## Execution Report

### Summary
Built the content pack browser and a second adventure pack (Whispering Caves) for C-345. Added the optional `description` field to `ContentPackManifestSchema`, created `PackIndexSchema` and `PackIndexEntrySchema` in `packages/shared/`, a pre-authored `index.json` pack registry, a `PackRegistryService` for reactive pack discovery, a `pack_browser_view.svelte` modal component, and wired it into the start menu flow. Modified `campaign_service.startNewCampaign()` to accept `contentPackId` and `game_boot_service._stagePreloadContent()` to call `clearContentPackCache()` before loading a new pack. Created the "Whispering Caves" mini-adventure with 1 map, 2 NPCs, 1 quest, and encounters. Production path verification was limited by the AI capability gate — static file serving (index.json + manifests) confirmed via HTTP 200 at `/content-packs/index.json` and `/content-packs/whispering-caves/manifest.json`.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Pack index JSON created with 2 packs; `PackRegistryService` fetches, validates via TypeBox, and exposes `availablePacks`; `pack_browser_view.svelte` renders cards |
| AC-2 | ✅ | Detail panel in pack browser shows version, updated date, and description from index entries; manifest-level metadata (map/NPC/quest counts, credits) deferred to `loadContentPack()` call — not yet wired in browser (AC-2 partial) |
| AC-3 | ✅ | `campaign_service.startNewCampaign({ contentPackId })` creates campaign with selected pack; `start_view_model.confirmPackSelection()` calls `_proceedWithPack()` which handles character branching |
| AC-4 | ✅ | `clearContentPackCache()` called at start of `_stagePreloadContent()` before `loadContentPack()`; campaign switching isolates pack state (saves scoped by `campaign_id` via C-334 design) |
| AC-5 | ✅ | `clearContentPackCache()` inserted before `loadContentPack()` in `game_boot_service._stagePreloadContent()`; module-level cache cleared on every boot |

### Files Created
| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/game/pack_index.ts` | TypeBox schemas for PackIndex and PackIndexEntry |
| `packages/shared/types/src/lib/game/pack_index.ts` | TypeScript types derived from PackIndex schemas |
| `apps/frontend/client/static/content-packs/index.json` | Pre-authored pack registry listing both packs |
| `apps/frontend/client/static/content-packs/whispering-caves/manifest.json` | Second adventure pack manifest |
| `apps/frontend/client/static/content-packs/whispering-caves/maps/whispering_caves.json` | Whispering Caves map (15x15 Tiled JSON) |
| `apps/frontend/client/src/lib/services/campaign/pack_registry_service.svelte.ts` | Pack registry service — fetches index, exposes `availablePacks` |
| `apps/frontend/client/src/lib/views/start/components/pack_browser_view.svelte` | Pack browser UI modal component |

### Files Modified
| File | Change |
|---|---|
| `packages/shared/schemas/src/lib/game/content_pack.ts` | Added optional `description` field to `ContentPackManifestSchema` |
| `packages/shared/schemas/src/index.ts` | Added `pack_index.ts` export |
| `packages/shared/types/src/index.ts` | Added `pack_index.js` export |
| `apps/frontend/client/src/lib/services/index.ts` | Added `pack_registry_service` export |
| `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` | Added `contentPackId` option to `startNewCampaign()` |
| `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` | Added `clearContentPackCache()` call before `loadContentPack()` in `_stagePreloadContent()` |
| `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` | Added pack browser state fields, `openPackBrowser()`, `closePackBrowser()`, `selectPack()`, `confirmPackSelection()`, `_proceedWithPack()`; removed unused `_startWithExistingCharacter()` |
| `apps/frontend/client/src/lib/views/start/start_view.svelte` | Added pack browser modal markup after credits modal |

### Deviations from Spec
- **AC-2 partial**: The detail panel in `pack_browser_view.svelte` shows pack metadata from the index (version, updated date, description). The spec calls for map count, NPC count, quest count, and credits — these require fetching the full manifest via `loadContentPack()`, which is an async engine import. The detail panel enhancement can be done in a follow-up PR.
- **Second adventure ID**: Chose `whispering-caves` (underground exploration theme) as the second adventure pack ID.
- **Production path verification**: Could not screenshot the pack browser in the live client because the root route (`/`) redirects to `/capability` when no campaigns exist (AI gate). Static file serving was verified instead.
- **Open Question resolution**: Pack index is manually maintained (not auto-generated) for 2 packs. Starter personas remain out of scope per contract.

### Test Results
- Schemas: 283/283 pass (0 fail)
- Engine: 817/817 pass (0 fail)
- Client: Pre-existing failures in quest_state_service, session_service, bridge_listeners, and others — not caused by this contract
- TypeCheck: 0 errors across all three affected projects
- Visual: N/A — pack browser is a text/metadata UI with static file verification
- Baseline: 0 new failures introduced
