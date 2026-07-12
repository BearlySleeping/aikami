# Contract C-314: Establish a Production Game Composition Root and Split God Services

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | `apps/frontend/client/src/lib/services/game/` (composition root + split services), `apps/frontend/client/src/routes/game/+page.svelte` (wiring), `apps/frontend/client/src/lib/views/game/` (ViewModel factories) |
| **Priority** | P0 — integration remains fragile while lifecycle ownership is spread across routes, Views, ViewModels, and singleton services with no clear owner for init/teardown |
| **Dependencies** | C-313 (Campaign Aggregate — implemented, sandbox), C-120/C-124/C-125/C-214 (Phase 0 completed legacy contracts) |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | None — internal infrastructure refactor |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The `game_state_service.svelte.ts` (896 lines) is a god service owning: world state, location, inventory, quests, player stats, equipment, economy, world-gen output, game mode, ECS bridge listeners, character sheet summary, and session data. The `game_overlay_service.svelte.ts` owns overlay routing, save service instantiation, bridge setup, AI settings, and audio triggers. The `GameUIViewModel` creates all overlay sub-ViewModels via raw `new` and `get*` factories with hardcoded imports from `$services`. The `StartViewModel` directly checks providers, localStorage persona counts, and resets game state. No single entity owns the full game lifecycle — init, boot, run, pause, save, and dispose are spread across 5+ files.

- **Reproduction**:
  1. Navigate to `/game` — `game_view_model.svelte.ts` calls `gameEngineService.initializeEngine()` then `gameEngineService.bootWithCanvas()`, while `game_ui_view_model.svelte.ts` calls `gameOverlayService.initialize()` independently.
  2. Navigate away and back — there is no coordinated teardown. Engine bridge listeners are registered in `game_state_service` constructor (lines 395-398) and never removed. `bridge_listeners.ts` registers listeners on first call (guarded by `_initialized` flag) but provides no unsubscribe path.
  3. The `GameOverlayService` lazily creates `GameSaveService` via raw `new` (lines 241, 384) instead of receiving it as a managed dependency.

- **Existing implementation to reuse**:
  - `campaign_service.svelte.ts` + `campaign_repository.svelte.ts` + `boot_state_machine.ts` (C-313) — implemented at sandbox level, ready for production wiring
  - `game_engine_service.svelte.ts` (635 lines) — engine bridge lifecycle, PixiJS boot, map loading, save/load; already follows single-responsibility pattern
  - `inventory_service.svelte.ts` — already split out, owns only visibility state
  - `quest_service.svelte.ts` — already split out, proxies from gameStateService
  - `bridge_listeners.ts` — thin event wiring, can be folded into composition root as a setup phase

- **Known gaps**:
  - `game_state_service` constructor calls 4 async ECS listener methods (`_listenForInventoryUpdates`, `_listenForQuestUpdates`, `_listenForCombatEnded`, `_listenForPlayerStats`) — no teardown, no ownership
  - `game_state_service` singleton is created with hardcoded `uid: 'singleton'` (line 893), not the authenticated user
  - `game_overlay_service` creates `GameSaveService` lazily with `new` (bypasses `ClassName.create()`)
  - `GameUIViewModel.initialize()` (line 143) directly creates `OllamaClient` and passes it to `DialogueOverlayViewModel` via `new` — no DI
  - `StartViewModel.startNewGame()` directly reads `localStorage.getItem('aikami-characters')` — ViewModel touches persistence
  - C-313 CampaignService is not wired into any production route

- **Baseline tests**:
  - `game_state_service.test.ts` — covers world subscription, variables, event listeners, NPC management; uses raw `new` instead of `ClassName.create()`
  - `game_engine_service.test.ts` — engine bridge lifecycle tests
  - `game_overlay_service.test.ts` — overlay routing tests
  - `start_view_model.test.ts` — start menu flow tests
  - `game_ui_view_model.svelte.ts` — no dedicated test file

## User Outcome

After this contract, a developer can trace the entire game lifecycle through one composition root: GameComposer owns the init/teardown of all game services, bridge listeners, and ViewModel factories. Each service has exactly one owner, one subscription set, and clean teardown. Double init/dispose produces no duplicate engine boots or leaked listeners. The 896-line `game_state_service` is split into focused services with clear boundaries.

## Success Measures

- **Time/latency target**: Game init to interactive <3s (same as baseline — no regression from adding composition root)
- **Offline/degraded behavior**: Game boot must complete without network access. AI provider availability is checked but never blocks engine init.
- **Production journey enabled**: Player can start a new campaign from the start menu, enter the game, play, save, quit, and return — with clean lifecycle boundaries at every step.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Campaign lifecycle state machine | `campaign/boot_state_machine.ts` (C-313) | Reuse — pure, tested, ready |
| Campaign persistence | `campaign/campaign_repository.svelte.ts` (C-313) | Reuse — IndexedDB-backed |
| Campaign service | `campaign/campaign_service.svelte.ts` (C-313) | Reuse + wire into production flow |
| Engine lifecycle | `game_engine_service.svelte.ts` | Modify — expose teardown, accept canvas externally |
| Inventory visibility state | `inventory_service.svelte.ts` | Reuse — already split |
| Quest proxy | `quest_service.svelte.ts` | Reuse — already split |
| Overlay routing | `game_overlay_service.svelte.ts` | Modify — remove raw `new`, receive dependencies |
| Bridge event wiring | `bridge_listeners.ts` | Modify — fold into composer setup phase with teardown |
| World/location/session state | `game_state_service.svelte.ts` | Split — extract player stats, equipment, economy into focused services; fold world state into campaign |
| Start menu orchestration | `start_view_model.svelte.ts` | Modify — delegate to CampaignService instead of direct localStorage reads |
| Base class + DI patterns | `BaseFrontendClass`, `ClassName.create()` | Reuse — all new services follow this pattern |
| ViewModel pattern | `BaseViewModel`, `get*ViewModel()` factories | Modify — factories accept composed dependencies |
| Item catalog | `ITEM_CATALOG` in `game_state_service.svelte.ts` | Move — belongs in `packages/shared/constants/` |

## Overview

Introduce a `GameComposer` as the production composition root. It owns the full game lifecycle: creating and wiring the campaign service, engine service, split state services, overlay router, and ViewModel factories. It provides a single `start()` / `dispose()` contract. Split the 896-line `game_state_service` into focused services (player state, world state, economy) with clear boundaries. Wire C-313 CampaignService into the production start-menu-to-game flow. Remove raw `new` ViewModel construction, direct storage access from Views, and hardcoded service-path imports from the production flow.

## Design Reference

- **Service pattern**: `BaseFrontendClass` → `ClassName.create()` — all new split services follow this. See `inventory_service.svelte.ts` for a clean small-service example.
- **Repository pattern**: `campaign_repository.svelte.ts` — IndexedDB with interface + class + singleton.
- **ViewModel factory pattern**: `getInventoryViewModel({...})` — existing pattern. Compose context into the factory instead of having ViewModels import `$services` directly for engine-level dependencies.
- **Engine boundary**: `engine_bridge.ts` — engine commands go through the bridge, never direct Worker access. The composer owns the bridge setup and teardown.
- **Cleanup pattern**: `$effect(() => { ... return () => { /* cleanup */ }; })` — Svelte 5 effect teardown for ViewModel-scoped subscriptions. Composer-scoped teardown uses explicit `dispose()`.
- For testing: **Playwright** handles functional E2E (`tests/*.spec.ts`), **Bun Visual Runner** handles AI visual assessment (`src/visual/suites/*.visual.ts`). See `.pi/skills/testing/SKILL.md` for conventions.

## Architecture Directives

- **GameComposer**: New singleton in `apps/frontend/client/src/lib/services/game/game_composer.svelte.ts` — the production composition root. Extends `BaseFrontendClass`. Exposes `start(options)` and `dispose()`. Creates and wires all game services. Owns bridge listener lifecycle.
- **Split services from game_state_service**:
  - `PlayerStateService` → `apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts` — player stats (level, xp, hp, attack, defense), equipment (weapon/armor slots), narrative traits, character sheet summary
  - `EconomyService` → `apps/frontend/client/src/lib/services/game/economy_service.svelte.ts` — gold balance, add/remove gold
  - Inventory state (the `$state` items array) → merge into existing `inventory_service.svelte.ts`
  - World state (currentWorld, currentLocation, variables, events, NPC management) → fold into `CampaignService` (C-313 already owns campaign identity)
  - ECS bridge listeners (inventory, quests, combat, player stats) → moved to `game_composer.svelte.ts` with explicit subscribe/unsubscribe
  - Item catalog (`ITEM_CATALOG`) → move to `packages/shared/constants/src/lib/items.ts`
- **CampaignService wiring**: The composer creates/loads campaigns via `CampaignService`. The `StartViewModel` delegates campaign decisions to the composer instead of reading localStorage directly.
- **ViewModel factories**: Overlay ViewModel factories receive a `composer` context object (or individual service references) instead of importing `$services` for engine-level dependencies. This breaks the hard coupling between ViewModels and the service barrel.
- **No raw `new`**: All class instantiations use `ClassName.create()`. No `new GameSaveService()` — the composer creates it once and injects it.
- **Route wiring**: `routes/game/+page.svelte` calls the composer's `start()` in an `$effect` and `dispose()` on teardown. ViewModels receive dependencies from the composer, not from `$services`.

## State & Data Models

```typescript
// Composition root lifecycle states
type ComposerState = 'idle' | 'booting' | 'ready' | 'paused' | 'tearing_down' | 'error';

// Dependencies the composer injects into ViewModel factories
type GameContext = {
  readonly playerState: PlayerStateServiceInterface;
  readonly economy: EconomyServiceInterface;
  readonly inventory: InventoryServiceInterface;
  readonly quests: QuestServiceInterface;
  readonly overlay: GameOverlayServiceInterface;
  readonly engine: GameEngineServiceInterface;
  readonly campaign: CampaignServiceInterface;
  readonly save: GameSaveServiceInterface;
};

// Split from game_state_service — player-owned state only
type PlayerState = {
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  baseAttack: number;
  baseDefense: number;
  totalAttack: number;
  totalDefense: number;
  equippedWeapon: string | undefined;
  equippedArmor: string | undefined;
  narrativeTraits: NarrativeTraits;
  characterSheetSummary: string;
};

// Split from game_state_service — economy state
type EconomyState = {
  gold: number;
};

// GameMode stays in shared types
type GameMode = 'EXPLORE' | 'COMBAT' | 'DIALOGUE' | 'MENU';

// GameComposer start options
type GameComposerStartOptions = {
  /** Whether to start a new game or load an existing campaign. */
  mode: 'new' | 'continue' | 'load';
  /** Required for 'new': the persona ID to play as. */
  personaId?: string;
  /** Required for 'load': the campaign ID to restore. */
  campaignId?: string;
  /** The canvas element for PixiJS rendering. Bound from the View. */
  canvasElement: HTMLCanvasElement;
};
```

## Quality Requirements

- **Offline/degraded mode**: Game boot must succeed without network. AI provider checks are advisory only — the composer never blocks boot on AI availability. Engine init, map loading, and campaign restore must all work offline.
- **Accessibility/input**: N/A — no new UI surfaces. Existing overlay keyboard shortcuts (Esc, I, Q, C) preserved.
- **Performance budget**: Game init <3s (same as baseline). No additional lazy imports beyond current engine Worker pattern. Service instantiation must not add perceptible latency.
- **Security/privacy**: No changes to auth or data exposure. Campaign data remains in IndexedDB (local). The `uid` for game state services must come from the authenticated user (not hardcoded `'singleton'`).
- **Persistence/migration**: Campaign data format (C-313) is stable. Split service state (player stats, gold, inventory) must survive the refactor without data loss — existing IndexedDB save format must be backward-compatible. Item catalog move to constants must preserve all existing item IDs.
- **Cancellation/retry/idempotency**: `GameComposer.start()` must be idempotent — calling it twice when already booted is a no-op. `dispose()` must be safe to call when not booted. Bridge listeners must be deregistered on dispose to prevent zombie event handlers.
- **Observability**: All service instantiations and teardowns logged via inherited `this.debug()`. Bridge listener registration/deregistration logged. Composer state transitions logged. Error paths logged with context.

## Migration & Rollback

- **Old data compatibility**: Split service state (player stats, equipment, gold) is a code reorganization — the data shape inside IndexedDB save payloads must not change. Item catalog location change (service → constants) is a move, not a rename.
- **Migration**: No data migration needed — this is a code structure change. All existing save files remain readable.
- **Rollback**: Revert to prior commit. No persistent state format changes. No database schema changes.
- **Feature flag or kill switch**: N/A — no feature flag needed. This is infrastructure, not user-facing. Roll back via git if integration fails.
- **Failure recovery**: If composer boot fails, it transitions to `error` state and surfaces the error to the View. Player can retry by navigating away and back. No partial state corruption — services are not created until all dependencies are validated.

## Scope Boundaries

- **In Scope:**
  - Create `GameComposer` as the production composition root
  - Split `game_state_service.svelte.ts` into `PlayerStateService`, `EconomyService`, merge inventory state into `inventory_service.svelte.ts`, fold world state into `CampaignService`
  - Move `ITEM_CATALOG` to `packages/shared/constants/`
  - Wire C-313 `CampaignService` into production start-menu → game flow
  - Move ECS bridge listeners from `game_state_service` constructor to `GameComposer` with explicit subscribe/unsubscribe
  - Remove raw `new` instantiations from `GameOverlayService` (GameSaveService) and `GameUIViewModel` (DialogueOverlayViewModel, CombatViewModel)
  - Introduce `GameContext` for ViewModel dependency injection
  - Update `game/+page.svelte` to use the composer
  - Update `StartViewModel` to delegate campaign logic to composer/CampaignService
  - Add teardown to all bridge listener registrations
  - Fix hardcoded `uid: 'singleton'` to use authenticated user

- **Out of Scope:**
  - Deep refactoring of `dialogue_overlay_view_model.svelte.ts` (1270 lines) — only remove raw `new` construction and direct storage access; internal AI chat logic is untouched
  - Deep refactoring of `combat_view_model.svelte.ts` — only the instantiation pattern changes
  - C-315 (Content Pack), C-321 (Game Boot Atomic), C-317 (Start Menu Rebuild) — these are separate contracts that depend on this one
  - Firebase/Data Connect integration — this is local-first, offline only
  - E2E or visual test authoring — baseline tests are updated to use the composer; new tests belong in downstream contracts
  - Changing the `$services` barrel structure — services still export through the barrel; the composer is the only consumer changed

## Contract Size & Split Rule

This contract is at the upper bound (5 ACs, 2 project layers) but does NOT require splitting because:
- All work is within the `apps/frontend/client` project (single deployable) plus one constant move to `packages/shared/constants`
- The 5 ACs form a chain: AC-1 → AC-2 → AC-3 → AC-4 (lifecycle) and AC-5 (ViewModel factories). Each builds on the prior.
- No independently releasable systems — the composer is useless without the split services, and the split services have no consumer without the composer

## Acceptance Criteria

### AC-1: GameComposer Orchestrates Full Boot Lifecycle
**Given** the player navigates to `/game` for the first time
**When** `GameComposer.start({ mode: 'new', personaId, canvasElement })` is called
**Then** the composer creates CampaignService, EngineService, PlayerStateService, EconomyService, InventoryService, QuestService, OverlayService, and SaveService in order; registers all bridge listeners; boots the engine; and transitions to `ready` state. The game is interactive within 3s.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit + Integration | `game_composer.test.ts` | N/A (no visual surface) | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --test-name-pattern="GameComposer"`
- Integration: Start client in emulator mode (`bun moon run client:dev`), verify game boots to interactive state
- E2E / Visual:
    - **Functional**: `tests/client/game_composer.spec.ts` — Playwright test that navigates to `/game`, waits for PixiJS canvas to appear (check for canvas element with WebGL context), verifies no console errors, navigates away and back, verifies clean re-boot
    - **Visual**: N/A — no new visual surface

**Watch Points**:
- Canvas element may not be bound when `start()` is called — composer must handle late canvas binding (see current `game_view_model.svelte.ts` `$effect` pattern)
- Auth may not be ready — `uid` must be available or composer waits

### AC-2: game_state_service Responsibilities Decomposed
**Given** the `game_state_service.svelte.ts` file exists at 896 lines
**When** the split is complete
**Then** `game_state_service` is removed or reduced to a thin facade. `PlayerStateService` owns player stats + equipment (under 200 lines). `EconomyService` owns gold (under 100 lines). `InventoryService` owns inventory items (existing + the `$state` items array). World state folds into `CampaignService`. `ITEM_CATALOG` lives in `packages/shared/constants/src/lib/items.ts`. All existing tests pass after updating imports.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | Each new service `.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun run test` — all existing + new service tests pass
- Integration: N/A — unit-level split
- E2E / Visual: N/A — no visual change

**Watch Points**:
- The `registerSerializable` call in `game_state_service` constructor must move to the appropriate service or the composer
- ECS bridge listeners (`_listenForInventoryUpdates`, etc.) must move to composer, not individual services — they must be owned by one entity
- Existing consumers of `gameStateService.equippedWeapon`, `gameStateService.gold`, etc. must be updated to import from the split service
- `start_view_model.test.ts` mocks `GameStateService` — must be updated

### AC-3: CampaignService Wired into Production Flow
**Given** the `CampaignService` exists (C-313, sandbox) but is not used in any production route
**When** the composer is wired
**Then** `StartViewModel.startNewGame()` calls `campaignService.startNewCampaign()` instead of reading `localStorage.getItem('aikami-characters')` directly. `StartViewModel.continueGame()` calls `campaignService.getLatestCampaign()`. The game route receives the active campaign from the composer. The `boot_state_machine` transitions guide the flow: `idle → creating → playing`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | Updated `start_view_model.test.ts`, updated `campaign_service.test.ts` | `/` → start new game → `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --test-name-pattern="start|Start|campaign|Campaign"`
- Integration: Start from emulator, click "New Game", verify campaign is created and game boots
- E2E / Visual:
    - **Functional**: `tests/client/start_to_game.spec.ts` — Playwright flow: start menu → New Game → character creation → game boots with correct campaign
    - **Visual**: N/A — no new visual surface

**Watch Points**:
- Existing persona detection logic in `StartViewModel._getCharacterCount()` reads raw localStorage — must delegate to a service
- The character selection flow (0 char → /setup, 1 char → /game, 2+ → /characters) must still work — only the data source changes
- `StartViewModel._startWithExistingCharacter()` calls `personaService.setActivePersona()` and `gameStateService.reset()` — these must route through the composer

### AC-4: Double Init/Dispose Produces No Leaks
**Given** the composer has booted the game and the player is exploring
**When** the player navigates away from `/game` (triggers `dispose()`) and then back to `/game` (triggers `start()` again)
**Then** no duplicate engine boots occur. All bridge listeners from the first boot are deregistered. No zombie event handlers fire. Memory is stable (no growth across 10 init/dispose cycles). The second boot produces a fully functional game.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + Integration | `game_composer.test.ts` (leak test), browser memory profile | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --test-name-pattern="dispose|teardown|leak"`
- Integration: Browser DevTools — Performance monitor, 10× navigate between `/` and `/game`, JS heap size must not monotonically increase
- E2E / Visual:
    - **Functional**: `tests/client/game_composer.spec.ts` — Navigate to game, wait for boot, navigate away, navigate back. Assert: game loads correctly both times, no console errors about duplicate listeners, no "already initialized" warnings.
    - **Visual**: N/A

**Watch Points**:
- `bridge_listeners.ts` currently guards with `_initialized` flag — this MUST be replaced with an explicit subscribe/unsubscribe pair
- `game_state_service` constructor registers 4 bridge listeners that currently never deregister — these move to the composer and must be cleaned up
- PixiJS Application `destroy()` must be called to release WebGL context
- The ECS Worker must be terminated on dispose

### AC-5: ViewModels Receive Dependencies Through Composition Context
**Given** `GameUIViewModel` currently creates `DialogueOverlayViewModel` with `new DialogueOverlayViewModel({ npcData, ollamaClient: new OllamaClient(), onStartCombat: ... })` (hardcoded dependencies)
**When** the composer provides a `GameContext` to ViewModel factories
**Then** `GameUIViewModel` no longer imports `OllamaClient` directly. `DialogueOverlayViewModel` receives `ollamaClient` from the composer context if Ollama is available. `CombatViewModel` receives `combatService` from context instead of importing it. `GameOverlayService` receives `GameSaveService` as a constructor dependency instead of lazily creating it with `new`. No ViewModel in the production flow imports `$services` for engine-level dependencies.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | Updated ViewModel `.test.ts` files | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --test-name-pattern="ViewModel|view_model"`
- Integration: Open game, trigger dialogue overlay — verify it renders correctly. Trigger combat — verify it renders correctly. Trigger inventory, quest log, character dashboard, vendor.
- E2E / Visual:
    - **Functional**: N/A — overlay functionality tested by existing E2E tests; this AC is about code structure, not behavior change
    - **Visual**: N/A

**Watch Points**:
- Dev sandbox ViewModels (`*_view_model.dev.svelte.ts`) may use different instantiation patterns — scope only covers production ViewModels
- `dialogue_overlay_view_model.dev.svelte.ts` has its own `ollamaClient` setup — keep dev sandbox patterns as-is
- The `$services` barrel is still used for non-engine services (router, auth, dice, etc.) — only engine-level dependencies move to context

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Move `ITEM_CATALOG` to `packages/shared/constants/`. Create `PlayerStateService` and `EconomyService` in `apps/frontend/client/src/lib/services/game/`. Merge inventory items `$state` into `inventory_service.svelte.ts`. Fold world state into `CampaignService`. Write unit tests for each.

2. **Phase 2 (Integration)**: Create `GameComposer` that wires all services, owns bridge listener lifecycle, and exposes `start()`/`dispose()`. Create `GameContext` type. Update `game/+page.svelte` to use composer. Update `StartViewModel` to delegate to campaign service. Update overlay ViewModel factories to accept `GameContext`. Remove raw `new` from production flow.

3. **Phase 3 (Validation)**: Run `bun moon run :validate`. Run full test suite (`bun moon run :test`). Run Playwright E2E tests. Profile memory across 10 init/dispose cycles. Remove or deprecate old `game_state_service` facade.

## Edge Cases & Gotchas

- **Late canvas binding**: The `canvasElement` may be `undefined` when `start()` is called. The composer must handle this — either wait for the canvas (current `$effect` pattern) or accept it via a separate `setCanvas()` call. Prefer the `$effect` in the ViewModel that calls `composer.setCanvas()` as the cleanest separation.
- **Auth race condition**: `uid` must be available before services that need it are created. The composer must wait for auth if not yet resolved, or accept a `uid` parameter.
- **SaveService created twice**: Currently `GameOverlayService` lazily creates `GameSaveService` in two methods (`saveGame` and `_triggerAutoSave`). The composer must create it once and share it, or the overlay service must receive it.
- **World gen backward compat**: The `hydrateWorldGen` / `serializeWorldGen` methods on `game_state_service` must be preserved in whatever service ends up owning world-gen data (likely `CampaignService`).
- **Combat ViewModel dependency on combatService**: `CombatViewModel` currently imports `combatService` from `$services`. The composer must provide the combat service reference, not a copy — it's the same singleton.
- **OllamaClient import**: `GameUIViewModel` currently imports `OllamaClient` and creates it inline. The composer should own the decision of whether to create an OllamaClient based on AI settings.
- **registerSerializable**: The `game_state_service` constructor calls `registerSerializable('gameState', ...)`. This registration must move to the composer or the service that owns world-gen serialization.

## Open Questions

- **Q1**: Should the `CampaignService` merge with the `GameStateService` world-state duties, or should world state remain a separate service that references a campaign ID? Recommendation: fold world state (currentWorld, currentLocation, variables, events) into `CampaignService` since the campaign is the aggregate root that owns world identity.
- **Q2**: Should `GameMode` state (EXPLORE/COMBAT/DIALOGUE/MENU) live in the composer or remain in a dedicated service? Recommendation: move to the composer since game mode is a top-level lifecycle state that multiple services read.
- **Q3**: How aggressively should `dialogue_overlay_view_model.svelte.ts` (1270 lines) be refactored? Recommendation: only touch the construction pattern (AC-5 scope) — the internal AI chat logic is complex and deserves its own contract.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

```
— → sandbox → integrated → release_verified
```

| State | Meaning | Evidence Required |
|---|---|---|
| `—` | Not yet assessed — default for legacy or new contracts. | None |
| `sandbox` | Feature works in a dev sandbox route (`(dev)/sandbox/...`). | Dev sandbox route exists |
| `integrated` | Feature is wired into the production route and E2E tests pass. | Production route + E2E pass |
| `release_verified` | Feature has visual tests + all ACs verified. Ready for release. | Visual suite + verified ACs |

## Status Lifecycle

```
draft → approved → in_progress → implemented → verified → completed
                                      ↘ verification_failed → implemented
draft → blocked
draft → superseded
```

Rules:
- `implemented`: implementer believes code is ready. Set by `/contract`.
- `verified`: independent verifier passed all mandatory ACs. Set by `/contract-verify`.
- `completed`: merged and CI passed. Set manually after merge.
- Any mandatory AC marked ⚠️ or ❌ prevents `verified` and `completed`.
- Scope changes not recorded in Amendments prevent `verified`.
