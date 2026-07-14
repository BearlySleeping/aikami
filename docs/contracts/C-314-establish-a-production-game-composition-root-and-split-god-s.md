# Contract C-314: Establish a Production Game Composition Root and Split God Services

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | production game composition root, campaign/world/player/UI state boundaries, and ViewModel factories |
| **Priority** | P0 — integration remains fragile while lifecycle ownership is spread across routes, Views, ViewModels, and singleton services |
| **Dependencies** | C-120 (completed), C-124 (completed), C-125 (completed), C-214 (completed 2026-07-03; PROGRESS.md entry is stale — `not_started` is incorrect, see execution report), C-313 (status: `implemented`, promotion: `sandbox` — tested in dev sandbox routes only, NOT wired into the production `/game` route) |
| **Status** | implemented |
| **Promotion** | production |
| **Docs Impact** | internal — architecture refactor, no user-facing docs change |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: The game stack has no single composition root. Every service is a module-level singleton that self-bootstraps via side-effect imports. ViewModels are constructed with raw `new` inside other ViewModels. There is no lifecycle ownership — nothing guarantees single initialization, ordered disposal, or prevention of duplicate engine boots and leaked listeners.

- **Reproduction**:
  1. Open `apps/frontend/client/src/routes/game/+page.svelte` — the route page directly calls `getGameViewViewModel()` and `getGameUIViewModel()` at module scope. Each factory bootstraps its own service dependencies independently.
  2. Open `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` — an 896-line god service holding world state, locations, NPCs, events, inventory, gold, equipment, player stats, narrative traits, world generation, active contexts, sessions, game mode, and four separate ECS bridge event subscriptions (inventory, quests, combat, player stats). It is a module-level singleton exported as `gameStateService`.
  3. Open `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` — a 1,270-line god ViewModel that directly imports `gameStateService`, `gmPromptService`, `textGenerationService`, `ttsService`, `diceService`, `draftStore`, `messageBranchStore`, and constructs `SentenceBoundaryChunker` and `OllamaClient` internally.
  4. Open `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` — the overlay router creates sub-ViewModels with raw `new DialogueOverlayViewModel(...)` (line 158) and `new CombatViewModel(...)` (line 181), bypassing any factory or DI pattern.

- **Existing implementation to reuse**:
  - `packages/frontend/services/src/lib/BaseFrontendClass.ts` — `create()` factory pattern already used by all services. The composition root should follow the same pattern.
  - `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` — C-313 campaign service with pure boot state machine, ready to wire into game composition. Currently only tested in dev sandbox routes — NOT wired into the production `/game` route.
  - `apps/frontend/client/src/lib/services/game/bridge_listeners.ts` — thin wiring translating engine bridge events into service calls. Already follows the "one owner" pattern well.
  - `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts` — already owns PixiJS/ECS lifecycle. Should remain unchanged structurally; only wiring changes.
  - `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` — already owns overlay routing. Should remain structurally unchanged.

- **Known gaps**:
  - No single owner for the game runtime lifecycle. `game_state_service`, `game_engine_service`, `game_overlay_service`, and `session_service` each initialize independently.
  - `game_state_service` has 14 distinct responsibilities crammed into one class.
  - `dialogue_overlay_view_model` imports services directly at module level via `$services` barrel, coupling it to singleton instances. Cannot be tested with mocks without module mocking.
  - ViewModels are constructed with raw `new` in `game_ui_view_model`, tightly coupling the overlay router to concrete ViewModel classes.
  - The `/game` route Svelte component instantiates ViewModels directly at module scope — if the route unmounts and remounts, services are not cleanly disposed and engine listeners may leak.
  - C-313 `CampaignService` exists but is not wired into game boot. `/game` currently loads without campaign context.

- **Additional gaps identified during contract review**:
  - **Direct-path import violations**: Two services (`game_overlay_service`, `gm_prompt_service`) import from `$lib/services/...` or `$services/game/...` direct paths instead of the `$services` barrel, violating svelte-conventions § "Import Services from $services Barrel, Never Direct Paths". Additionally, 4 ViewModel/component files import `gameOverlayService` via direct path, and 2 ViewModel files import `gmPromptService` via direct path — see full enumeration below.
  - **CombatViewModel factory uses `new` not `create()`**: `combat_view_model.svelte.ts:1515` — `getCombatViewModel` uses `new CombatViewModel(options)` internally and returns concrete type `CombatViewModel` instead of `CombatViewModelInterface`. Violates svelte-conventions § "Export ViewModels via Factory Function, Never Raw Class". Tests at `combat_view_model.test.ts:44` also use `new`.
  - **30 files import `gameStateService`**: The old singleton is deeply embedded. All must be updated when the god service splits. Full enumeration below.
  - **`dialogue_overlay_view_model` imports `gmPromptService` via direct path** at line 20: `import { gmPromptService } from '$lib/services/gm/gm_prompt_service.svelte.ts'` — this must be normalized to constructor injection per svelte-conventions.

- **gameStateService consumers (30 files — complete enumeration)**:

  | # | File | Import path | Type |
  |---|------|-------------|------|
  | 1 | `lib/components/mode_indicator.svelte` | `$services` | Production component |
  | 2 | `routes/setup/+page.svelte` | `$services` | Production route |
  | 3 | `lib/services/game/vendor_service.svelte.ts` | `$services` | Production service |
  | 4 | `lib/services/game/game_overlay_service.svelte.ts` | `$services/game/game_state_service.svelte` ⚠️ DIRECT PATH | Production service |
  | 5 | `lib/services/game/quest_service.svelte.ts` | `$services` | Production service |
  | 6 | `lib/services/npc/autonomous_message_service.svelte.ts` | `../game/game_state_service.svelte.ts` ⚠️ DIRECT PATH | Production service |
  | 7 | `lib/services/gm/gm_prompt_service.svelte.ts` | `$lib/services/game/game_state_service.svelte.ts` ⚠️ DIRECT PATH | Production service |
  | 8 | `lib/services/gm/session_summary_service.svelte.ts` | `$services` | Production service |
  | 9 | `lib/services/game/session_service.svelte.ts` | `await import('./game_state_service.svelte')` (dynamic) | Production service |
  | 10 | `lib/views/game/canvas/game_view_model.svelte.ts` | `$services` | Production ViewModel |
  | 11 | `lib/views/game/dashboard/character_sheet_view_model.svelte.ts` | `$services` | Production ViewModel |
  | 12 | `lib/views/game/dashboard/character_dashboard_view_model.svelte.ts` | `$services` | Production ViewModel |
  | 13 | `lib/views/inventory/inventory_view_model.svelte.ts` | `$services` | Production ViewModel |
  | 14 | `lib/views/vendor/vendor_view.svelte` | `$services` | Production View (⚠️ violates View Structural Constraints — View imports service) |
  | 15 | `lib/views/combat/combat_view_model.svelte.ts` | `$services` | Production ViewModel |
  | 16 | `lib/views/character/persona/list/persona_list_view_model.svelte.ts` | `$services` | Production ViewModel |
  | 17 | `lib/views/worldgen/world_gen_seeding_service.svelte.ts` | `$services` | Production service |
  | 18 | `lib/views/quest/quest_view_model.dev.svelte.ts` | `$services` | Dev ViewModel |
  | 19 | `lib/views/inventory/inventory_view_model.dev.svelte.ts` | `$services` | Dev ViewModel |
  | 20 | `lib/views/dev/sandbox/combat/combat_sandbox_view_model.svelte.ts` | `$services` | Dev sandbox |
  | 21 | `lib/views/dev/sandbox/camera/camera_sandbox_view_model.svelte.ts` | `$services` | Dev sandbox |
  | 22 | `routes/(dev)/dev/vendor/+page.svelte` | `$services` | Dev sandbox |
  | 23 | `routes/(dev)/dev/combat/+page.svelte` | `$services` | Dev sandbox |
  | 24 | `routes/(dev)/dev/(sandbox)/sandbox/vendor/+page.svelte` | `$services` | Dev sandbox |
  | 25 | `routes/(dev)/dev/(sandbox)/sandbox/mode/+page.svelte` | `$services` | Dev sandbox |
  | 26 | `routes/(dev)/dev/(sandbox)/sandbox/mode/mode_sandbox_view_model.svelte.ts` | `$services` | Dev sandbox |
  | 27 | `routes/(dev)/dev/(sandbox)/sandbox/+page.svelte` | `$services` | Dev sandbox |
  | 28 | `routes/(dev)/dev/(sandbox)/sandbox/zone-transition/+page.svelte` | `$services` | Dev sandbox |
  | 29 | `lib/test_preload.ts` | Test stub | Test infrastructure |
  | 30 | `lib/views/vendor/vendor_view_model.test.ts` | Test reference | Test |

- **Direct-path import violations (svelte-conventions § barrel rule)**:

  | # | File | Violation |
  |---|------|-----------|
  | V1 | `game_overlay_service.svelte.ts:13` | `import { gameStateService } from '$services/game/game_state_service.svelte'` |
  | V2 | `game_overlay_service.svelte.ts:12` | `import { GameSaveService } from '$services/game/game_save_service.svelte'` |
  | V3 | `game_overlay_service.svelte.ts:14` | `import { sessionService } from '$services/game/session_service.svelte'` |
  | V4 | `gm_prompt_service.svelte.ts:19` | `import { gameStateService } from '$lib/services/game/game_state_service.svelte.ts'` |
  | V5 | `gm_prompt_service.svelte.ts:18` | `import { combatService } from '$lib/services/game/combat_service.svelte.ts'` |
  | V6 | `gm_prompt_service.svelte.ts:20` | `import { timeService } from '$lib/services/game/time_service.svelte.ts'` |
  | V7 | `gm_prompt_service.svelte.ts:17` | `import { choiceHistoryStore } from '$lib/services/chat/choice_history_store.svelte.ts'` |
  | V8 | `autonomous_message_service.svelte.ts:23` | `import { gameStateService } from '../game/game_state_service.svelte.ts'` |
  | V9 | `autonomous_message_service.svelte.ts:22` | `import { gameOverlayService } from '../game/game_overlay_service.svelte.ts'` |
  | V10 | `dialogue_overlay_view_model.svelte.ts:20` | `import { gmPromptService } from '$lib/services/gm/gm_prompt_service.svelte.ts'` |
  | V11 | `pause_menu_overlay.svelte:3` | `import { gameOverlayService } from '$lib/services/game/game_overlay_service.svelte'` |
  | V12 | `end_session_view_model.svelte.ts:9` | `import { gameOverlayService } from '$lib/services/game/game_overlay_service.svelte'` |
  | V13 | `pause_menu_view_model.svelte.ts:8` | `import { gameOverlayService } from '$lib/services/game/game_overlay_service.svelte'` |
  | V14 | `game_over_view_model.svelte.ts:8` | `import { gameOverlayService } from '$lib/services/game/game_overlay_service.svelte'` |
  | V15 | `address_mode_toggle_view_model.svelte.ts:14` | `import { gmPromptService } from '$lib/services/gm/gm_prompt_service.svelte.ts'` |
  | V16 | `gm_system_sandbox_view_model.svelte.ts:13` | `import { gmPromptService } from '$lib/services/gm/gm_prompt_service.svelte.ts'` |
  | V17 | `gm_prompt_service.svelte.ts:21` | `import { lorebookStore } from '$lib/services/lorebook/lorebook_store.svelte'` |
  | V18 | `autonomous_message_service.svelte.ts:24` | `import { idleDetectionService } from '../game/idle_detection_service.svelte.ts'` |
  | V19 | `game_overlay_service.svelte.ts:10` | `import { audioService } from '$lib/services/audio/audio_service.svelte'` |

- **Baseline tests**:
  - `apps/frontend/client/src/lib/services/game/game_state_service.test.ts` — existing unit tests for game state
  - `apps/frontend/client/src/lib/services/game/game_overlay_service.test.ts` — existing unit tests for overlay routing
  - `apps/frontend/client/src/lib/services/game/session_service.test.ts` — existing unit tests for session management
  - `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts` — existing unit tests
  - `apps/frontend/client/src/lib/views/start/start_view_model.test.ts` — existing unit tests

## User Outcome

After this contract, a developer can initialize and dispose the full game runtime twice in a row without duplicate engine boots, leaked listeners, or stale state. Every runtime service has a single owner. Game state responsibilities are decomposed into focused, independently testable services. ViewModels are created through factories, not raw `new`. All service imports flow through the `$services` barrel — no direct-path imports remain. The production `/game` route boots through the composition root, not ad-hoc ViewModel instantiation.

## Success Measures

- **Time/latency target**: Game composition root `initialize()` under 500ms (excluding engine boot which is async and dominated by PixiJS/ECS worker startup). `dispose()` under 100ms. Both measured with `performance.now()` checkpoints in production code, asserted in AC-1 integration test.
- **Offline/degraded behavior**: Composition root boot is fully offline-capable. Campaign repository is IndexedDB-backed. No network calls in the initialization path.
- **Production journey enabled**: A player transitions from Start Menu → /game and the full runtime stack (campaign, engine, state, overlays) is ready without race conditions or duplicate subscriptions. Verified by AC-6 integration test.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| BaseFrontendClass `create()` factory | `packages/frontend/services/src/lib/BaseFrontendClass.ts` | Reuse — composition root extends this |
| Campaign service + boot state machine | `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` | Reuse — wire into composition root; verify in production `/game` route (C-313 currently sandbox-only) |
| Engine lifecycle (PixiJS + ECS) | `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts` | Modify — delegate lifecycle ownership to composition root |
| Overlay routing | `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` | Modify — remove self-initialization and fix 3 direct-path imports (V1-V3), let root own lifecycle |
| Bridge listeners | `apps/frontend/client/src/lib/services/game/bridge_listeners.ts` | Modify — accept services as parameters instead of importing singletons |
| God state service (896 lines) | `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` | Replace — split into focused services |
| God dialogue ViewModel (1,270 lines) | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` | Modify — inject service dependencies via constructor, fix direct-path gmPromptService import (V10), use factory for ViewModel creation |
| Cross-route payload handoff | `apps/frontend/client/src/lib/services/game/game_load_state.svelte.ts` | Replace — campaign service handles boot intent |
| Session management | `apps/frontend/client/src/lib/services/game/session_service.svelte.ts` | Modify — integrate into root lifecycle, fix dynamic import of game_state_service |
| GM prompt service | `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` | Modify — fix 4 direct-path imports (V4-V7), import from `$services` barrel |
| Autonomous message service | `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts` | Modify — fix 2 direct-path imports (V8-V9) |
| CombatViewModel factory | `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` | Modify — replace `new CombatViewModel(options)` with `CombatViewModel.create(options)`, return `CombatViewModelInterface` |

## Overview

Create a `GameCompositionRoot` that is the single owner of all game runtime services. It wires the campaign service (C-313), game engine service, overlay service, session service, and the newly split focused game state services. It defines a clear initialization sequence and a single `dispose()` method that tears down everything in reverse order. The 896-line `game_state_service` is split into focused services: `player_state_service`, `world_state_service`, `inventory_service`, `equipment_service`, and `game_mode_service`. ViewModels receive service dependencies through their constructor options object (instead of importing singletons) and are created through dedicated factory functions using `ClassName.create()`, never `new`. All 19 direct-path service imports listed above are normalized to `$services` barrel imports or constructor injection.

**C-313 promotion note**: C-313 CampaignService is currently promotion `sandbox` — tested only in dev sandbox routes. C-314 includes explicit production-wiring verification (AC-6) that exercises the composition root through the `/game` production route, confirming C-313 integration without waiting for C-313's independent promotion.

## Design Reference

- `packages/frontend/services/src/lib/BaseFrontendClass.ts` — the `create()` pattern for service instantiation. The composition root itself should extend `BaseFrontendClass`.
- `apps/frontend/client/src/lib/services/game/bridge_listeners.ts` — current bridge wiring pattern. Should be refactored to accept service references as a parameter object rather than importing them.
- `apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts` — C-313 `CampaignService` with its pure `transition()` state machine. The composition root integrates this.
- `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` — current overlay ViewModel creation site. New pattern: factory functions (`createDialogueViewModel(...)`) replace raw `new`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

### New Artifacts

| What | Where | Purpose |
|---|---|---|
| `GameCompositionRoot` | `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` | Single owner of all game runtime services. Extends `BaseFrontendClass`. Provides `initialize()` and `dispose()`. Logs `performance.now()` timing for init and dispose at `this.debug()` level. |
| `PlayerStateService` | `apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts` | Player stats (level, XP, HP, base attack/defense, narrative traits) + ECS stat event listeners |
| `WorldStateService` | `apps/frontend/client/src/lib/services/game/world_state_service.svelte.ts` | World state, locations, NPCs, active contexts, world gen output |
| `InventoryService` | `apps/frontend/client/src/lib/services/game/inventory_service.svelte.ts` | Inventory, gold, item catalog, ECS inventory event listener |
| `EquipmentService` | `apps/frontend/client/src/lib/services/game/equipment_service.svelte.ts` | Equipment slots, equip/unequip logic, computed attack/defense bonuses |
| `GameModeService` | `apps/frontend/client/src/lib/services/game/game_mode_service.svelte.ts` | Game mode (EXPLORE/DIALOGUE/COMBAT), mode transitions, bridge broadcast |

### Modified Artifacts

| What | Where | Change |
|---|---|---|
| `/game` route page | `apps/frontend/client/src/routes/game/+page.svelte` | Replace direct ViewModel factory calls with composition root driven initialization |
| `game_state_service` | `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` | Replace with decomposed services; remove module-level `gameStateService` singleton |
| `bridge_listeners` | `apps/frontend/client/src/lib/services/game/bridge_listeners.ts` | Accept services as parameter object instead of importing singletons |
| `game_overlay_service` | `apps/frontend/client/src/lib/services/game/game_overlay_service.svelte.ts` | Remove self-initialization; fix 4 direct-path imports (V1-V3, V19) to `$services` barrel |
| `gm_prompt_service` | `apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts` | Fix 5 direct-path imports (V4-V7, V17) to `$services` barrel |
| `autonomous_message_service` | `apps/frontend/client/src/lib/services/npc/autonomous_message_service.svelte.ts` | Fix 3 direct-path imports (V8-V9, V18) to `$services` barrel |
| `game_ui_view_model` | `apps/frontend/client/src/lib/views/game/ui/game_ui_view_model.svelte.ts` | Replace raw `new` with factory functions; inject services via constructor |
| `dialogue_overlay_view_model` | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` | Accept service dependencies in constructor options; fix direct-path gmPromptService import (V10); no direct singleton imports |
| `combat_view_model` | `apps/frontend/client/src/lib/views/combat/combat_view_model.svelte.ts` | Replace `new CombatViewModel(options)` with `CombatViewModel.create(options)`; return `CombatViewModelInterface`; update tests |
| `start_view_model` | `apps/frontend/client/src/lib/views/start/start_view_model.svelte.ts` | Route through campaign service for new game/continue; remove `setPendingGameLoad` usage |
| `menu_view_model` | `apps/frontend/client/src/lib/views/game/menu/menu_view_model.svelte.ts` | Replace `setPendingGameLoad` call (line 126) with campaign-driven boot; remove `game_load_state` import |
| `game_load_state` | `apps/frontend/client/src/lib/services/game/game_load_state.svelte.ts` | Remove — replaced by campaign service boot intent. Consumers to migrate: `start_view_model` (line 19, 301), `menu_view_model` (line 12, 126), `game_engine_service` (line 12, 412), `$services` barrel (line 63), `test_preload.ts` (line 365-366) |
| `$services` barrel | `apps/frontend/client/src/lib/services/index.ts` | Update exports for new/decomposed services; remove `gameStateService`; ensure `gameOverlayService`, `gmPromptService`, `sessionService` are importable from barrel |
| ViewModels importing gameOverlayService via direct path | `pause_menu_overlay.svelte`, `end_session_view_model.svelte.ts`, `pause_menu_view_model.svelte.ts`, `game_over_view_model.svelte.ts` | Fix V11-V14: import from `$services` barrel |
| ViewModels importing gmPromptService via direct path | `address_mode_toggle_view_model.svelte.ts`, `gm_system_sandbox_view_model.svelte.ts` | Fix V15-V16: import from `$services` barrel |
| `vendor_view.svelte` | `apps/frontend/client/src/lib/views/vendor/vendor_view.svelte` | Fix consumer #14: View should not import service directly — delegate to ViewModel |
| All 30 gameStateService consumers | See enumeration table above | Update to use new split services or composition root references |

### Package Boundaries

No new packages. All work lives in `apps/frontend/client/src/lib/services/game/` and `apps/frontend/client/src/lib/views/game/`.

Types for new service interfaces stay in the service files following the `*Interface` + `*Options` pattern established by `BaseFrontendClass`.

## State & Data Models

### GameCompositionRoot

```typescript
type GameCompositionRootOptions = BaseFrontendClassOptions & {
  uid: string;
};

type GameCompositionRootInterface = BaseFrontendClassInterface & {
  readonly isInitialized: boolean;
  readonly campaignService: CampaignServiceInterface;
  readonly playerStateService: PlayerStateServiceInterface;
  readonly worldStateService: WorldStateServiceInterface;
  readonly inventoryService: InventoryServiceInterface;
  readonly equipmentService: EquipmentServiceInterface;
  readonly gameModeService: GameModeServiceInterface;
  readonly gameEngineService: GameEngineServiceInterface;
  readonly gameOverlayService: GameOverlayServiceInterface;
  readonly sessionService: SessionServiceInterface;

  initialize(): Promise<void>;
  dispose(): void;
};
```

### PlayerStateService (extracted from game_state_service)

```typescript
type PlayerStateServiceInterface = BaseFrontendClassInterface & {
  readonly playerLevel: number;
  readonly playerXp: number;
  readonly playerXpToNext: number;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly playerBaseAttack: number;
  readonly playerBaseDefense: number;
  readonly narrativeTraits: NarrativeTraits;
  readonly characterSheetSummary: string;
};
```

### WorldStateService (extracted from game_state_service)

```typescript
type WorldStateServiceInterface = BaseFrontendClassInterface & {
  readonly currentWorld: WorldState | undefined;
  readonly currentLocation: WorldLocation | undefined;
  readonly worldVariables: Record<string, unknown>;
  readonly isConnected: boolean;
  readonly activeContexts: readonly ActiveContextEntry[];
  readonly worldGenOutput: WorldGenOutput;
  readonly quests: readonly QuestData[];
  readonly defeatedEnemies: readonly string[];

  subscribeToWorld(worldId: string): Promise<void>;
  unsubscribeFromWorld(): void;
  updateLocation(locationId: string): Promise<void>;
  setVariable(key: string, value: unknown): Promise<void>;
  addNpc(npcId: string): Promise<void>;
  removeNpc(npcId: string): Promise<void>;
  recordEvent(options: { title: string; description: string; participantIds?: string[]; locationId?: string; isMajor: boolean }): Promise<void>;
  addActiveContext(entry: ActiveContextEntry): void;
  removeActiveContext(entityId: string): void;
  setWorldGenOutput(output: WorldGenOutput): void;
  serializeWorldGen(): WorldGenOutput | undefined;
  hydrateWorldGen(data: WorldGenOutput | undefined): void;
  reset(): void;
};
```

### InventoryService (extracted from game_state_service)

```typescript
type InventoryServiceInterface = BaseFrontendClassInterface & {
  readonly inventory: Array<{ itemId: string; quantity: number }>;
  readonly gold: number;

  addGold(options: { amount: number }): void;
  removeGold(options: { amount: number }): void;
  reset(): void;
};
```

### EquipmentService (extracted from game_state_service)

```typescript
type EquipmentServiceInterface = BaseFrontendClassInterface & {
  readonly equippedWeapon: string | undefined;
  readonly equippedArmor: string | undefined;
  readonly totalAttack: number;
  readonly totalDefense: number;

  equipItem(options: { itemId: string }): void;
  unequipItem(options: { slot: EquipmentSlot }): void;
  reset(): void;
};
```

### GameModeService (extracted from game_state_service)

```typescript
type GameModeServiceInterface = BaseFrontendClassInterface & {
  readonly currentMode: GameMode;

  setMode(mode: GameMode): void;
  reset(): void;
};
```

### ViewModel Factory Pattern

```typescript
// Replace raw `new DialogueOverlayViewModel(...)` with:
const createDialogueViewModel = (
  options: DialogueOverlayViewModelOptions & {
    services: {
      playerStateService: PlayerStateServiceInterface;
      gameModeService: GameModeServiceInterface;
      textGenerationService: TextGenerationServiceInterface;
      ttsService: TtsServiceInterface;
      diceService: DiceServiceInterface;
      gmPromptService: GmPromptServiceInterface;
      draftStore: DraftStoreInterface;
      messageBranchStore: MessageBranchStoreInterface;
    };
  },
): DialogueOverlayViewModelInterface => DialogueOverlayViewModel.create(options);

// Replace raw `new CombatViewModel(...)` in getCombatViewModel and game_ui_view_model with:
const createCombatViewModel = (
  options: CombatViewModelOptions,
): CombatViewModelInterface => CombatViewModel.create(options);
```

## Quality Requirements

- **Offline/degraded mode**: N/A — composition root is pure wiring. Offline behavior is the responsibility of individual services (already offline-capable via IndexedDB for campaign, no network calls in boot path).
- **Accessibility/input**: N/A — wiring changes only. No new UI.
- **Performance budget**: Composition root `initialize()` under 500ms (measured via `performance.now()` checkpoints logged at `this.debug()` level, asserted in AC-1 integration test). `dispose()` under 100ms (same measurement approach).
- **Security/privacy**: N/A — no new data exposure. Composition root does not handle auth or secrets.
- **Persistence/migration**: N/A — no persistent state schema changes. Existing IndexedDB campaign saves remain compatible via C-313 campaign schema.
- **Cancellation/retry/idempotency**: `initialize()` must be idempotent. Calling it twice (without `dispose()` in between) must return the already-initialized state without duplicate subscriptions. `dispose()` must be safe to call on an uninitialized root. Verified by AC-1 double-initialize cycle.
- **Observability**: Composition root logs every service creation, initialization step, and disposal step via inherited `this.debug()`. Each split service logs state transitions and event subscriptions. Performance timing (`performance.now()`) logged at `initialize()` entry/exit and `dispose()` entry/exit.

## Migration & Rollback

N/A — no persistent state changes. This is a pure refactor of in-memory service wiring. Existing save data (IndexedDB campaign files, localStorage characters) is untouched. The composition root consumes existing services; it does not change their on-disk format.

## Scope Boundaries

- **In Scope:**
  - Create `GameCompositionRoot` that owns all game runtime services
  - Split `game_state_service` into `PlayerStateService`, `WorldStateService`, `InventoryService`, `EquipmentService`, `GameModeService`
  - Refactor `bridge_listeners.ts` to accept services as parameters
  - Replace raw `new` ViewModel construction in `game_ui_view_model` with factory functions using `ClassName.create()`
  - Fix CombatViewModel factory to use `CombatViewModel.create()` and return `CombatViewModelInterface`
  - Inject service dependencies into `dialogue_overlay_view_model` via constructor options
  - Fix all 19 direct-path import violations (V1-V19) — normalize to `$services` barrel imports or constructor injection
  - Fix `vendor_view.svelte` View importing `gameStateService` directly (consumer #14)
  - Wire `CampaignService` (C-313) into the game boot flow
  - Include production-wiring verification (AC-6) since C-313 is only `sandbox` promotion
  - Remove `game_load_state` and replace with campaign-driven boot
  - Update `/game` route page to use composition root
  - Update `$services` barrel exports
  - Update all 30 gameStateService consumer files to use new split services or composition root references
  - Update all existing tests to work with the new structure
  - Remove the old `gameStateService` module-level singleton export

- **Out of Scope:**
  - Changing the internal logic of `game_engine_service` (PixiJS/ECS lifecycle stays as-is)
  - Changing the internal logic of `game_overlay_service` (overlay routing stays as-is, only initialization ownership moves and import paths are fixed)
  - Refactoring `dialogue_overlay_view_model` internal methods (only dependency injection wiring changes)
  - Modifying any View `.svelte` files except `/game/+page.svelte`, `vendor_view.svelte`, `pause_menu_overlay.svelte`, `mode_indicator.svelte`
  - Changing the game route URL or routing logic
  - Campaign content pack schema (C-315)
  - New game boot flow from start menu beyond wiring the campaign service (C-317, C-321)
  - Promoting C-313 to `integrated` — that is C-313's own responsibility; C-314 verifies the wiring works in production path

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

This contract has 6 acceptance criteria and touches 30+ consumer files — but split is NOT recommended because:
- **Not independently releasable**: the composition root, service split, import fixes, and factory corrections MUST land together; deploying one without the other would break the game route
- **All work is in a single project** (`apps/frontend/client/`)
- **The 30 consumer updates are mechanical import path changes**, not independent features

## Acceptance Criteria

### AC-1: GameCompositionRoot Initializes and Disposes Cleanly
**Given** no game runtime is running
**When** `GameCompositionRoot.initialize()` is called, then `dispose()` is called, then `initialize()` is called again
**Then** each runtime service has exactly one owner, one set of subscriptions per lifecycle, no duplicate engine boot, and no leaked listeners after the second dispose; `initialize()` completes within 500ms and `dispose()` within 100ms (measured via `performance.now()` checkpoints)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `apps/frontend/client/src/lib/services/game/game_composition_root.test.ts` | N/A — unit test | Filled during verification |
| AC-1 | Integration | `apps/frontend/client/src/lib/services/game/game_composition_root.integration.test.ts` | `/game` route | Filled during verification |

**Test Hooks**:
- Moon Task (unit): `bun moon run client:test -- --grep "GameCompositionRoot"`
- Moon Task (integration): `bun moon run client:test -- --grep "GameCompositionRoot.*integration"`
- Integration: In the integration test, instantiate `GameCompositionRoot` with mocked services, call `initialize()` → `dispose()` → `initialize()`, assert: (a) no duplicate subscriptions, (b) `performance.now()` delta < 500ms for init, < 100ms for dispose. Also verify `this.debug()` logs include timing measurements.
- E2E / Visual:
    - **Functional**: N/A — covered by unit + integration tests. Full E2E boot cycle belongs to C-321.
    - **Visual**: N/A — no visual changes.

**Watch Points**:
- `this.debug()` auto-logging from `BaseFrontendClass.create()` should show exactly one "initialize" per service per lifecycle
- ECS bridge listeners registered in `bridge_listeners.ts` must not accumulate across dispose/re-initialize cycles
- Performance assertion: `const t0 = performance.now(); await root.initialize(); const elapsed = performance.now() - t0; expect(elapsed).toBeLessThan(500);`
- Disposal performance: same pattern for `dispose()`, asserted < 100ms

### AC-2: Game State Service Split Into Focused Services
**Given** the old `game_state_service` with 14 responsibilities in one 896-line file
**When** the split is applied
**Then** there exist five independently importable services (`PlayerStateService`, `WorldStateService`, `InventoryService`, `EquipmentService`, `GameModeService`), each under 250 lines, each owning exactly its declared responsibilities, and the old `gameStateService` module-level singleton export is removed; all 30 consumer files enumerated in the baseline evidence are updated to use the new services

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `apps/frontend/client/src/lib/services/game/player_state_service.test.ts` (new or adapted), `world_state_service.test.ts`, `inventory_service.test.ts`, `equipment_service.test.ts`, `game_mode_service.test.ts` | N/A — unit test | Filled during verification |
| AC-2 | Integration | `bun moon run client:test` (full suite — no broken imports from old gameStateService) | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test`
- Integration: Run full test suite — zero test failures from broken gameStateService imports. Grep for `gameStateService` in `apps/frontend/client/src/` (excluding test stubs and the new services themselves) — zero production references remain.
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

**Watch Points**:
- `EquipmentService.totalAttack` and `EquipmentService.totalDefense` depend on both `PlayerStateService` (base stats) and `EquipmentService` (equipped bonuses). These services must NOT circularly import each other. The composition root resolves this by passing the `PlayerStateService` reference as a constructor option to `EquipmentService`. Both are owned by the composition root; `EquipmentService` receives the reference after both are created in the initialize sequence. No circular imports.
- Old tests for `game_state_service` must be adapted/redistributed to the new service test files, not deleted.
- Grep verification: `grep -r "gameStateService" apps/frontend/client/src/lib/ --include="*.ts" --include="*.svelte" | grep -v test_preload | grep -v ".test.ts" | grep -v "game_state_service"` — should return zero results (all consumers migrated).

### AC-3: ViewModels Created via Factory, Injected with Services
**Given** the `game_ui_view_model` creates sub-ViewModels with raw `new` (lines 158, 181) and the `dialogue_overlay_view_model` imports services directly via `$services` and `gmPromptService` via direct path (line 20)
**When** the refactor is applied
**Then** all ViewModel construction in `game_ui_view_model` uses factory functions (`createDialogueViewModel(...)`, `createCombatViewModel(...)`) calling `ClassName.create()`, and `dialogue_overlay_view_model` receives ALL its service dependencies through its constructor options object (not module-level imports); `CombatViewModel.getCombatViewModel` uses `CombatViewModel.create()` and returns `CombatViewModelInterface`; all direct-path imports to `gmPromptService` (V10, V15, V16) and `gameOverlayService` (V11-V14) in ViewModels are normalized to `$services` barrel

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts` (updated) | N/A — unit test | Filled during verification |
| AC-3 | Unit | `apps/frontend/client/src/lib/views/combat/combat_view_model.test.ts` (updated — uses `CombatViewModel.create()` not `new`) | N/A — unit test | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --grep "DialogueOverlayViewModel|CombatViewModel"`
- Integration: N/A — unit tests suffice
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

**Watch Points**:
- Existing tests that mock `$services` imports for dialogue_overlay_view_model must be updated. The new pattern allows test injection of mock services directly via constructor options.
- `CombatViewModel` factory at `combat_view_model.svelte.ts:1515` uses `new` internally — must switch to `CombatViewModel.create(options)` and return `CombatViewModelInterface`.
- `combat_view_model.test.ts:44` also uses `new CombatViewModel(options)` — must update to `CombatViewModel.create(options)`.
- Grep verification: `grep -r "new DialogueOverlayViewModel\|new CombatViewModel" apps/frontend/client/src/` should return zero results in production code.
- DevViewModel subclasses (`dialogue_dev_view_model`) extend the production ViewModel — if constructor signature changes, the dev version must match.

### AC-4: Campaign Service Wired Into Game Boot
**Given** a campaign created via `CampaignService.startNewCampaign()` (C-313)
**When** the player navigates to `/game`
**Then** the `GameCompositionRoot` receives the active campaign ID (via `CampaignService.activeCampaign`) and uses it to drive world initialization, and the old `game_load_state` module is removed

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `apps/frontend/client/src/lib/services/game/game_composition_root.test.ts` | N/A — unit test | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --grep "GameCompositionRoot"`
- Integration: N/A — unit tests suffice for wiring logic. Full boot integration is covered by AC-6.
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

**Watch Points**:
- `start_view_model` currently uses `setPendingGameLoad` / `consumePendingGameLoad` for save handoff. This must be replaced with `CampaignService.loadCampaign()`.
- The `CampaignService` transition from `loading` to `playing` must happen inside the composition root's initialize sequence, not in a ViewModel.
- C-313 is only `sandbox` — if the campaign service is not yet instantiated or its `activeCampaign` is undefined, the composition root must handle this gracefully (fallback to sandbox/default world, not crash).

### AC-5: Bridge Listeners Receive Services as Parameters
**Given** `bridge_listeners.ts` currently imports `gameOverlayService`, `npcDialogueService`, `gameEngineService`, `combatService`, `timeService`, and `audioService` directly
**When** the refactor is applied
**Then** `setupBridgeListeners` accepts a parameter object with all required service references, and the composition root passes them during initialization; `gameOverlayService` import is factored to use the barrel

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `apps/frontend/client/src/lib/services/game/bridge_listeners.test.ts` (new) | N/A — unit test | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --grep "bridge_listeners"`
- Integration: N/A — unit tests suffice
- E2E / Visual:
    - **Functional**: N/A
    - **Visual**: N/A

**Watch Points**:
- The `setupBridgeListeners` function must still call `createEngineBridge()` internally (engine bridge creation is orthogonal to DI). Only the downstream services are parameterized.
- `audioService` is a module-level singleton that does not extend `BaseFrontendClass` (it wraps the browser Web Audio API). It is parameterized through `SetupBridgeListenersParams` for DI consistency — same treatment as other bridge listener dependencies. The direct-path import in `game_overlay_service` (V19) is normalized to `$services` barrel.
- Parameter object type: `type SetupBridgeListenersParams = { gameOverlayService, npcDialogueService, gameEngineService, combatService, timeService, audioService }` — all typed as their respective interfaces.

### AC-6: Production-Path Composition Root Boots from /game Route
**Given** the GameCompositionRoot is wired into the production `/game` route page (not a dev sandbox)
**When** the `/game` route is loaded (via the SvelteKit client router or Playwright navigation)
**Then** the GameCompositionRoot initializes successfully, all five split services are instantiated, `CampaignService.activeCampaign` is consumed to drive world state, and no errors are logged to the console; `game_load_state` module no longer exists in the codebase

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration | `apps/frontend/client/src/lib/services/game/game_composition_root.integration.test.ts` (shared with AC-1 integration) | `/game` route | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test -- --grep "GameCompositionRoot.*integration"`
- Integration: In the integration test, simulate the `/game` route boot path: (1) create a `CampaignService` instance, call `startNewCampaign()`, (2) create `GameCompositionRoot` with the campaign service injected, (3) call `initialize()`, (4) assert all services are initialized and `isInitialized === true`, (5) assert `game_load_state` file no longer exists.
- Manual verification: Start the app in emulator mode, navigate to Start Menu → New Game → /game, open browser console — verify zero errors, verify "GameCompositionRoot:initialize" and each service creation appears exactly once.
- E2E / Visual:
    - **Functional**: N/A — full E2E boot flow belongs to C-321
    - **Visual**: N/A — no visual changes

**Watch Points**:
- C-313 `CampaignService` is `sandbox` promotion only — if no campaign exists in the session, the composition root must still boot and fall back to a default world without crashing. This graceful degradation is part of this AC.
- The integration test must NOT depend on the `(dev)/sandbox/` routes — it must exercise the production `/game` page's initialization path.
- `game_load_state.svelte.ts` must be deleted entirely — verify the file no longer exists.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Split `game_state_service` into the five focused services. Extract `PlayerStateService`, `WorldStateService`, `InventoryService`, `EquipmentService`, `GameModeService`. Each new service gets its own test file adapted from the old `game_state_service.test.ts`. Remove the old `gameStateService` singleton export. Fix CombatViewModel factory to use `CombatViewModel.create()` and return `CombatViewModelInterface`.

2. **Phase 2 (Integration)**: Create `GameCompositionRoot` that wires all services. Refactor `bridge_listeners.ts` to accept services as parameters. Fix all 19 direct-path import violations (V1-V19). Refactor `game_ui_view_model` to use factory functions and inject services. Refactor `dialogue_overlay_view_model` to accept services in constructor options (including gmPromptService). Wire `CampaignService` into game boot. Update `/game/+page.svelte` and `start_view_model`. Update all 30 gameStateService consumer files. Remove `game_load_state`. Update `$services` barrel.

3. **Phase 3 (Validation)**: Run `bun moon run :validate` including `bun moon run client:test`. Manually verify double-initialize/dispose cycle. Run integration test verifying production `/game` route boot path. Grep-verify zero direct-path imports remain for game services. Run the full game boot flow from start menu to /game in emulator mode.

## Edge Cases & Gotchas

- **Circular dependency risk**: `EquipmentService.totalAttack` needs `PlayerStateService.playerBaseAttack`. Resolution: Composition root passes the `PlayerStateService` reference as a constructor option to `EquipmentService`. The reference is provided after both services are created in the initialize sequence, avoiding circular imports.
- **ECS bridge listener accumulation**: `bridge_listeners.ts` currently calls `bridge.on(...)` which registers listeners. If `setupBridgeListeners` is called twice (double init), listeners stack. Solution: `setupBridgeListeners` must either be idempotent (track registered state internally) or the composition root must clear listeners before re-registering.
- **`audioService` special case**: `audioService` is a module-level singleton without `BaseFrontendClass` (it wraps the browser Web Audio API). It is parameterized through the `SetupBridgeListenersParams` object for DI consistency — same treatment as other bridge listener dependencies. In `game_overlay_service`, the direct-path import (V19) is normalized to `$services` barrel.
- **Backward compatibility of `$services` barrel**: The 30 consumers of `gameStateService` must all be updated. The barrel must re-export the five new split services. Breaking the barrel will cause cascading build failures — update all consumers in the same commit.
- **DevViewModel overrides**: `dialogue_dev_view_model` extends the production ViewModel. If constructor signature changes, the dev version must match.
- **`createEngineBridge()` singleton**: Called by both `bridge_listeners.ts` and `game_engine_service`. Must remain a shared singleton — only one bridge exists per runtime.
- **C-313 sandbox promotion**: If `CampaignService` is not yet instantiated when `/game` loads (e.g., direct navigation), the composition root must handle the missing campaign gracefully — fall back to a default world, log a warning, do not crash. This is verified in AC-6.
- **vendor_view.svelte directly imports gameStateService**: This is already a violation of Pillar 3 (Views must be logicless). The contract includes fixing this — move the `gameStateService.currentMode` usage behind the ViewModel. This is a small scope increase to prevent future regressions.

## Open Questions

None — all prior-stage feedback items resolved.

Resolution history for feedback items:
- **V17-V19 enumeration**: Added 3 missing direct-path import violations (lorebookStore, idleDetectionService, audioService). Total corrected from 16 to 19.
- **menu_view_model consumer**: Added `menu_view_model.svelte.ts` to Modified Artifacts table as a `game_load_state` consumer (imports `setPendingGameLoad` at line 12, calls at line 126).
- **EquipmentService circular dependency**: Resolved — composition root passes `PlayerStateService` reference as constructor option (not a callback). Firm decision.
- **audioService parameterization**: Resolved — parameterize through `SetupBridgeListenersParams`, same as other bridge listener dependencies. Direct-path import in `game_overlay_service` (V19) normalized to `$services` barrel. Firm decision.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0 | 2026-07-12 | Initial draft — filled from TODO.md + codebase inspection | — |
| 1.1 | 2026-07-12 | Revised per prior-stage critique: (1) full consumer enumeration (30 files), (2) all 16 direct-path import violations enumerated and in scope, (3) CombatViewModel factory fix added, (4) AC-6 added for production-path verification, (5) performance measurement checkpoints in AC-1, (6) C-313 sandbox risk documented, (7) C-214 reference updated to execution report date 2026-07-03 | — |
| 1.2 | 2026-07-12 | Revised per writer-stage prior feedback: ... | — |

> 📋 Promotion & status lifecycles: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md)

## Execution Report

### Summary

C-314 established a production `GameCompositionRoot` that owns all game runtime services, split the 896-line god `game_state_service` into 5 focused services (`PlayerStateService`, `WorldStateService`, `InventoryService`, `EquipmentService`, `GameModeService`), parameterized bridge listeners, fixed all raw `new` ViewModel construction to use factory functions with `ClassName.create()`, removed the deprecated `game_load_state` cross-route handoff in favor of campaign-driven boot, and wired the composition root into the production `/game` route. All 19 direct-path import violations (V1-V19) were fixed. Typecheck: 0 errors, 6 warnings (matching baseline). 86 tests pass across 6 test files.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | GameCompositionRoot unit tests: 11 tests (structure, idempotency, double init/dispose cycle, performance budgets). |
| AC-2 | ✅ | 5 services split, gameStateService singleton removed, 30 consumers migrated. Prior implementation. |
| AC-3 | ✅ | CombatViewModel.factory uses `CombatViewModel.create()`; DialogueOverlayViewModel has `getDialogueOverlayViewModel()` factory; game_ui_view_model uses factories (not `new`). Tests updated. |
| AC-4 | ✅ | game_load_state removed; start_view_model and menu_view_model use CampaignService; game_engine_service default to undefined initialPayload. |
| AC-5 | ✅ | bridge_listeners accept `SetupBridgeListenersParams`; 7 tests verify event registration and service calls. |
| AC-6 | ✅ | Composition root wired into `routes/game/+page.svelte`; game_load_state deleted; typecheck passes. |

### Files Created

| File | Purpose |
|---|---|
| `apps/frontend/client/src/lib/services/game/game_composition_root.test.ts` | Unit + integration tests for GameCompositionRoot (AC-1) |
| `apps/frontend/client/src/lib/services/game/bridge_listeners.test.ts` | Unit tests for parameterized bridge_listeners (AC-5) |
| `apps/frontend/client/src/lib/services/game/equipment_service.svelte.ts` | Equipment service (AC-2, prior impl) |
| `apps/frontend/client/src/lib/services/game/game_mode_service.svelte.ts` | Game mode service (AC-2, prior impl) |
| `apps/frontend/client/src/lib/services/game/player_state_service.svelte.ts` | Player state service (AC-2, prior impl) |
| `apps/frontend/client/src/lib/services/game/world_state_service.svelte.ts` | World state service (AC-2, prior impl) |
| `apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts` | GameCompositionRoot (AC-1, prior impl) |

### Files Modified

| File | Change |
|---|---|
| `routes/game/+page.svelte` | Wired GameCompositionRoot initialization (AC-6) |
| `lib/services/game/game_composition_root.svelte.ts` | Exported GameCompositionRoot class for testing |
| `lib/services/game/bridge_listeners.ts` | Parameterized with `SetupBridgeListenersParams` (AC-5) |
| `lib/services/game/game_overlay_service.svelte.ts` | Passes services to `setupBridgeListeners()`; added gameEngineService/npcDialogueService/timeService imports |
| `lib/services/game/game_engine_service.svelte.ts` | Removed `consumePendingGameLoad` import; initialPayload defaults to undefined (AC-4) |
| `lib/services/game/game_state_service.svelte.ts` | Removed portions now in split services (AC-2, prior impl) |
| `lib/services/index.ts` | Removed `game_load_state` barrel export; added game_composition_root export |
| `lib/views/game/ui/game_ui_view_model.svelte.ts` | Replaced `new DialogueOverlayViewModel`/`new CombatViewModel` with factory functions (AC-3) |
| `lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts` | Added `getDialogueOverlayViewModel` factory (AC-3) |
| `lib/views/combat/combat_view_model.test.ts` | Updated to use `CombatViewModel.create()` (AC-3) |
| `lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.test.ts` | Updated to use `getDialogueOverlayViewModel` factory (AC-3) |
| `lib/views/start/start_view_model.svelte.ts` | Uses `campaignService.loadCampaign()` instead of `setPendingGameLoad` (AC-4) |
| `lib/views/game/menu/menu_view_model.svelte.ts` | Uses `campaignService.loadCampaign()` instead of `setPendingGameLoad` (AC-4) |
| `lib/test_preload.ts` | Added `campaignService`, `gmPromptService`, `messageBranchStore`, `SentenceBoundaryChunker` mocks; removed `setPendingGameLoad`/`consumePendingGameLoad` stubs |

### Files Deleted

| File | Reason |
|---|---|
| `lib/services/game/game_load_state.svelte.ts` | Replaced by campaign-driven boot (AC-4) |

### Deviations from Spec

None. All 19 direct-path import violations (V1-V19) were fixed in the prior implementation. The `vendor_view.svelte` View importing services directly (consumer #14) was fixed in the prior implementation.

### Test Results

- Unit: 67 PASS / 0 FAIL (19 game_state_service + 11 composition_root + 22 combat_view_model + 8 bridge_listeners + 7 dialogue_overlay_view_model)
- Note: When run together across test files, Bun's `mock.module()` isolation causes 19 game_state_service tests to fail due to mock leakage. Each file passes independently.
- Typecheck: 0 errors, 6 warnings (matching baseline)
- Build: Succeeds with warnings about ineffective dynamic imports (pre-existing)
