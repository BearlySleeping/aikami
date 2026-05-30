## Metadata

| Field | Value |
|---|---|
| **Source** | Active memory: "PixiJS v8 and bitECS for the game engine." PWA uses Svelte 5 View-ViewModel pattern with `$state` runes. C-013 installs PixiJS/bitECS deps; this contract implements the engine boundary |
| **Target** | `apps/frontend/pwa/src/lib/game/` — EngineBridge, GameWorld, PixiJS canvas; `packages/frontend/services/` — shared game service types |
| **Priority** | P1 — Core game engine boundary; enables UI↔Game communication without reactivity thrashing |
| **Dependencies** | C-013 (PixiJS v8 + bitECS dependencies installed), C-015 (AI service abstraction for NPC dialogue integration) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Integrate PixiJS v8 (renderer) and bitECS (game logic) into the SvelteKit PWA through a strict boundary that isolates the high-frequency game loop from Svelte 5's reactive `$state` runes. Define an `EngineBridge` interface that acts as the sole communication channel between the SvelteKit UI layer (menus, chat, HUD) and the PixiJS canvas (rendering, game loop, entity updates). Implement a TDD test suite verifying that bitECS entity mutations correctly trigger bridge events visible to the UI layer. Instantiate an MVP that renders a single textured sprite to the canvas when Tauri loads — proving the full stack works end-to-end.

### Why this boundary matters

Without a boundary, every frame in PixiJS's 60fps game loop would trigger Svelte 5 `$state` updates, causing re-renders of the entire DOM tree 60 times per second. This is catastrophic for performance. The `EngineBridge` decouples the two runtimes: PixiJS runs its own imperative loop over a `<canvas>` element, and only communicates structured messages to Svelte at UI-relevant intervals (e.g., when an NPC dialog triggers, a health bar changes, or a menu needs to open).

## Design Reference

**Existing Svelte 5 ViewModel pattern** (from `ARCHITECTURE.md`):
```typescript
// apps/frontend/pwa/src/lib/views/dashboard/dashboard-view-model.svelte.ts
class DashboardViewModel extends BaseViewModel<DashboardViewModelOptions> {
  // $state only for UI-relevant data — NO game-loop data here
}
```

**Key principle**: Views (.svelte) have zero logic. ViewModels handle all reactive state. The game engine is NOT a ViewModel — it's a self-contained imperative system that communicates through the `EngineBridge`.

**Architecture diagram**:
```
┌──────────────────────────────────────────────────────┐
│  SVELTEKIT UI LAYER                                   │
│  ┌───────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ ChatView   │  │ HUDView  │  │ GameViewModel     │ │
│  │ $state()   │  │ $state() │  │ $state(): messages│ │
│  └─────┬──────┘  └────┬─────┘  └────────┬──────────┘ │
│        │              │                  │            │
│        └──────────────┼──────────────────┘            │
│                       │ EngineBridge.send()            │
│           EngineBridge.on() listen for events          │
├───────────────────────┼───────────────────────────────┤
│  ENGINE BRIDGE        │  (typed message channel)       │
│                       │  GameCommand →                 │
│                       │  GameEvent ←                   │
├───────────────────────┼───────────────────────────────┤
│  PIXIJS + bitECS RUNTIME (imperative, no $state)      │
│  ┌────────────────────┴──────────────────────────────┐│
│  │  GameWorld (bitECS world)                          ││
│  │  ┌─────────┐  ┌─────────┐  ┌───────────────────┐ ││
│  │  │ Systems │  │Entities │  │ PixiJS Application │ ││
│  │  │ movement│  │  NPCs   │  │  <canvas> 60fps    │ ││
│  │  │ render  │  │  player │  │  requestAnimation  │ ││
│  │  │ physics │  │  items  │  │  Frame loop        │ ││
│  │  └─────────┘  └─────────┘  └───────────────────┘ ││
│  └───────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

## Changes Detail

### 1. Game Engine Directory Structure

Create `apps/frontend/pwa/src/lib/game/` as the home for all game engine code. This directory sits alongside existing `views/`, `client/`, and `components/` dirs:

```
apps/frontend/pwa/src/lib/game/
├── index.ts                        # Public exports
├── engine-bridge.ts                # EngineBridge interface + implementation
├── game-world.ts                   # GameWorld: bitECS world + PixiJS app lifecycle
├── components/                     # bitECS components
│   ├── position.ts                 # Position { x, y }
│   ├── sprite.ts                   # Sprite { textureKey, tint, ... }
│   ├── velocity.ts                 # Velocity { x, y }
│   └── npc-dialog.ts               # NPCDialog { text, onInteract }
├── systems/                        # bitECS systems
│   ├── movement-system.ts          # Update position from velocity
│   ├── render-system.ts            # Sync bitECS entities → PixiJS display objects
│   ├── input-system.ts             # Handle keyboard/mouse on canvas
│   └── dialog-trigger-system.ts    # Emit bridge events on NPC interaction
├── entities/                       # Entity factories
│   ├── create-player.ts
│   └── create-npc.ts
├── pixi-app.ts                     # PixiJS Application wrapper (no Svelte)
└── types.ts                        # GameCommand, GameEvent, bridge payloads
```

### 2. EngineBridge Interface

**File**: `apps/frontend/pwa/src/lib/game/engine-bridge.ts`

A typed, bidirectional message channel. On the Svelte side, the ViewModel calls `bridge.send(command)`. On the game side, systems call `bridge.emit(event)`. The bridge is the ONLY communication path — no direct imports between UI and game code.

```typescript
// GameCommand: Svelte UI → Game Engine (user actions)
type GameCommand =
  | { type: 'MOVE_PLAYER'; direction: 'up' | 'down' | 'left' | 'right' }
  | { type: 'INTERACT'; targetEntityId: string }
  | { type: 'OPEN_MENU'; menuId: string }
  | { type: 'CLOSE_MENU' }
  | { type: 'SPAWN_NPC'; npcData: NPCSpawnData }
  | { type: 'LOAD_SCENE'; sceneId: string }
  | { type: 'PAUSE_GAME' }
  | { type: 'RESUME_GAME' };

// GameEvent: Game Engine → Svelte UI (world state changes)
type GameEvent =
  | { type: 'NPC_DIALOG_START'; npcId: string; npcName: string; dialog: string }
  | { type: 'NPC_DIALOG_END'; npcId: string }
  | { type: 'PLAYER_POSITION_CHANGED'; x: number; y: number; scene: string }
  | { type: 'ITEM_ACQUIRED'; itemId: string; itemName: string }
  | { type: 'SCENE_LOADED'; sceneId: string }
  | { type: 'GAME_READY' }
  | { type: 'GAME_ERROR'; message: string };

interface EngineBridge {
  /** UI → Game: send a command to the game engine. */
  send(command: GameCommand): void;

  /** Game → UI: subscribe to events from the game engine. Returns unsubscribe fn. */
  on<T extends GameEvent['type']>(
    eventType: T,
    handler: (event: Extract<GameEvent, { type: T }>) => void,
  ): () => void;

  /** Game → UI: emit an event (called by game systems, NOT by Svelte). */
  emit(event: GameEvent): void;

  /** Returns true if the game engine is initialized and running. */
  isReady(): boolean;
}
```

**Critical rule**: The `EngineBridge.emit()` method is only called from within PixiJS/bitECS systems, never from Svelte ViewModels. ViewModels call `send()`. This one-way data flow prevents circular reactivity.

### 3. Svelte 5 Reactivity Isolation

The PixiJS game loop runs via `requestAnimationFrame` at 60fps, completely outside Svelte's reactivity system. Game state that the UI needs to display (e.g., NPC dialog text) is pushed through the bridge as discrete `GameEvent` payloads — NOT as shared `$state` variables.

**How it works**:

1. A bitECS system detects an interaction (e.g., player walks near NPC)
2. The system calls `bridge.emit({ type: 'NPC_DIALOG_START', npcId, npcName, dialog })`
3. The Svelte `GameViewModel` has a listener registered via `bridge.on('NPC_DIALOG_START', ...)`
4. The listener sets a `$state` variable: `this.activeDialog = { npcName, dialog }`
5. Svelte re-renders the ChatView once — not every frame

**What is FORBIDDEN**:
- No `$state` variables inside game systems, entities, or PixiJS code
- No `requestAnimationFrame` inside Svelte components or ViewModels
- No direct DOM manipulation from game code (all DOM is Svelte)
- No importing Svelte runes (`$state`, `$derived`, `$effect`) into the `lib/game/` directory
- No passing PixiJS `Application` or bitECS `World` references into ViewModels

### 4. GameViewModel

**File**: `apps/frontend/pwa/src/lib/views/game/game-view-model.svelte.ts`

Follows the existing View-ViewModel pattern. Imports `EngineBridge` but never imports PixiJS or bitECS directly. Uses `$state` only for UI-relevant data flowing FROM the bridge:

```typescript
class GameViewModel extends BaseViewModel {
  activeDialog = $state<{ npcName: string; dialog: string } | null>(null);
  playerScene = $state<string>('unknown');
  isGameReady = $state<boolean>(false);

  async initialize(): Promise<void> {
    const { getEngineBridge } = await import('$game/engine-bridge');
    const bridge = getEngineBridge();

    bridge.on('NPC_DIALOG_START', (event) => {
      this.activeDialog = { npcName: event.npcName, dialog: event.dialog };
    });
    bridge.on('NPC_DIALOG_END', () => {
      this.activeDialog = null;
    });
    bridge.on('GAME_READY', () => {
      this.isGameReady = true;
    });
    bridge.on('PLAYER_POSITION_CHANGED', (event) => {
      this.playerScene = event.scene;
    });
  }

  sendCommand(command: GameCommand): void {
    const bridge = getEngineBridge();
    bridge.send(command);
  }
}
```

### 5. GameWorld (bitECS + PixiJS Lifecycle)

**File**: `apps/frontend/pwa/src/lib/game/game-world.ts`

Manages the bitECS world, registers systems, and owns the PixiJS `Application` instance. Does NOT import Svelte. Lifecycle:

```
createGameWorld(canvas: HTMLCanvasElement, bridge: EngineBridge) → GameWorld
  constructor:
    1. Create PixiJS Application bound to canvas
    2. Create bitECS world
    3. Register components (Position, Sprite, Velocity, NPCDialog)
    4. Register systems (MovementSystem, RenderSystem, InputSystem, DialogTriggerSystem)
    5. Start game loop via app.ticker.add(update)
    6. bridge.emit({ type: 'GAME_READY' })

  update(ticker):
    // Runs EVERY frame at 60fps
    // NO Svelte, NO $state, pure imperative
    movementSystem.update(world, ticker.deltaMS)
    dialogTriggerSystem.update(world, bridge)
    renderSystem.update(world)

  destroy():
    app.destroy()
    world.clear() (or equivalent bitECS teardown)
```

### 6. MVP: Single Sprite on Tauri Load

**File**: `apps/frontend/pwa/src/lib/game/entities/create-test-sprite.ts`

The simplest possible game entity to prove the stack works:

1. Load a texture (placeholder PNG from `static/` dir or a programmatic colored rectangle)
2. Create a bitECS entity with `Position` and `Sprite` components
3. The `RenderSystem` syncs the entity to a PixiJS `Sprite` display object
4. `MovementSystem` slowly rotates or bounces the sprite to show the game loop is running
5. Result: when Tauri loads, the user sees a sprite moving on the canvas

**File**: `apps/frontend/pwa/src/lib/views/game/game-view.svelte`

The Svelte view component renders a `<canvas>` element and initializes the game world. Uses `BaseViewModelContainer` pattern:

```svelte
<BaseViewModelContainer {viewModel}>
  <!-- Game canvas: PixiJS owns this DOM element -->
  <canvas bind:this={canvasElement} class="w-full h-full" />

  <!-- UI overlay: Svelte owns this, no PixiJS access -->
  {#if viewModel.activeDialog}
    <DialogBox npcName={viewModel.activeDialog.npcName}>
      {viewModel.activeDialog.dialog}
    </DialogBox>
  {/if}
</BaseViewModelContainer>
```

The ViewModel's `initialize()` grabs the canvas element and passes it to `createGameWorld()`, which attaches PixiJS. The canvas element is a raw DOM node — Svelte does not track its internal state.

### 7. Test Suite (TDD)

**File**: `apps/frontend/pwa/src/lib/game/__tests__/engine-bridge.test.ts`

Tests run in Node/Bun (headless — no browser needed) using a mock bridge implementation:

1. **Bridge message passthrough**: `bridge.send(command)` → verify `bridge.on(...)` handler receives the event
2. **Entity → UI event**: Simulate a bitECS entity gaining an `NPCDialog` component → verify `bridge.emit('NPC_DIALOG_START')` fires
3. **Unsubscribe works**: `const unsub = bridge.on(...)` → `unsub()` → subsequent events are not delivered
4. **Multiple listeners**: Two handlers on same event type → both receive the event
5. **Unknown event type**: `bridge.on('NONEXISTENT' as any, ...)` → no crash, type-safe at compile time

**File**: `apps/frontend/pwa/src/lib/game/__tests__/game-world.test.ts`

Tests run in a browser-like environment (Playwright or jsdom with canvas mock):

1. **World creation**: `createGameWorld(canvas, bridge)` → returns without throwing → `bridge` receives `GAME_READY` event
2. **Entity creation**: `world.createEntity({ Position: { x: 0, y: 0 } })` → entity exists in world query
3. **Movement system**: Entity with Position + Velocity → after one tick → position changes
4. **Render system**: Entity with Position + Sprite → PixiJS container has a child sprite
5. **Dialog trigger**: Player enters NPC interaction radius → `bridge.emit('NPC_DIALOG_START')` fires

## Acceptance Criteria

### AC-1: EngineBridge Interface Defined and Typed
**Given** the need for UI↔Game communication
**When** `EngineBridge` is created
**Then** `apps/frontend/pwa/src/lib/game/engine-bridge.ts` exports a typed `EngineBridge` interface with `send()`, `on()`, `emit()`, and `isReady()` methods

**Test Hooks**:
- Unit: `test -f apps/frontend/pwa/src/lib/game/engine-bridge.ts`
- Unit: `EngineBridge` is an `interface` (not `type` — OOP contract)
- Unit: `GameCommand` and `GameEvent` are discriminated unions (discriminant: `type`)
- Unit: `bridge.on('NPC_DIALOG_START', ...)` — TypeScript narrows `event` parameter to `{ type: 'NPC_DIALOG_START'; npcId: string; ... }`

**Watch Points**:
- `GameCommand` type must NOT include any PixiJS or bitECS types
- `GameEvent` type must NOT include any PixiJS or bitECS types
- All payloads are plain serializable objects (strings, numbers, booleans, arrays) — no functions, no class instances

### AC-2: Game Engine Directory Created with Svelte-Free Code
**Given** the PWA project structure
**When** the game engine directory is created
**Then** `apps/frontend/pwa/src/lib/game/` exists with `components/`, `systems/`, `entities/` subdirectories, and zero files in this tree import from `svelte`, `$state`, `$derived`, `$effect`, or `@aikami/frontend/services`

**Test Hooks**:
- Unit: `find apps/frontend/pwa/src/lib/game -name '*.ts' | xargs grep -l "from 'svelte'"` returns empty
- Unit: `find apps/frontend/pwa/src/lib/game -name '*.ts' | xargs grep -l '\$state\|\$derived\|\$effect'` returns empty
- Unit: `test -d apps/frontend/pwa/src/lib/game/components`
- Unit: `test -d apps/frontend/pwa/src/lib/game/systems`
- Unit: `test -f apps/frontend/pwa/src/lib/game/pixi-app.ts`

**Watch Points**:
- The `game/` directory may import from `pixi.js` and `bitecs` — those are OK
- The `game/` directory may import `EngineBridge` from its own `engine-bridge.ts` — that's the boundary itself
- The `game/` directory must NOT import anything from `$lib/views/`, `$lib/client/`, or `$lib/components/`

### AC-3: GameViewModel Communicates Exclusively Through Bridge
**Given** the Svelte ViewModel pattern from `ARCHITECTURE.md`
**When** `GameViewModel` is created
**Then** it follows the ViewModel pattern BUT never imports PixiJS, bitECS, or any game-internal types

**Test Hooks**:
- Unit: `test -f apps/frontend/pwa/src/lib/views/game/game-view-model.svelte.ts`
- Unit: `GameViewModel` extends `BaseViewModel` and implements a typed interface
- Unit: File imports `EngineBridge` type only — no `pixi.js`, no `bitecs`, no game systems
- Unit: All game state exposed via `$state` variables (e.g., `activeDialog`, `isGameReady`, `playerScene`)
- Unit: `sendCommand(command: GameCommand)` delegates to `bridge.send()`, never touches game internals

**Watch Points**:
- The ViewModel must lazily import game code: `const { getEngineBridge } = await import('$game/engine-bridge')` — avoids bundling PixiJS into SSR
- The ViewModel's `initialize()` is client-only (inside `BaseViewModelContainer`)
- Svelte `$effect` must NOT be used to watch game state — use bridge event handlers

### AC-4: High-Frequency Game Loop Does NOT Trigger Svelte Reactivity
**Given** PixiJS runs at 60fps via `requestAnimationFrame`
**When** the game loop ticks
**Then** no `$state` variable is updated, no Svelte component re-renders, and no DOM diffing occurs anywhere except the `<canvas>` element (which PixiJS manages imperatively)

**Test Hooks**:
- Unit: Audit: no `$state` in `apps/frontend/pwa/src/lib/game/` (confirmed by AC-2 grep)
- Unit: Audit: no `requestAnimationFrame` in `apps/frontend/pwa/src/lib/views/` (confirmed by grep)
- Integration: Performance test — while game loop runs at 60fps, Svelte component `onupdate` / `$effect` tracking shows zero re-renders triggered by game loop ticks
- Integration: Bridge events cause exactly one Svelte update per event, not per frame

**Watch Points**:
- The `RenderSystem` must use PixiJS's built-in `app.ticker` — NOT `requestAnimationFrame` directly (PixiJS's ticker handles pause/resume, delta timing)
- bitECS queries within systems must NOT trigger any side effects outside the game world
- If using Svelte's `$effect` to watch a bridge event handler, the effect must only fire when the handler sets a `$state` — not on every tick

### AC-5: MVP Sprite Renders on Tauri Load
**Given** the Tauri app window opens (from C-013)
**When** the game route loads
**Then** a PixiJS canvas displays a textured sprite that moves (bounces, rotates, or drifts)

**Test Hooks**:
- Unit: `test -f apps/frontend/pwa/src/lib/game/entities/create-test-sprite.ts`
- Unit: The test sprite entity has at least `Position` and `Sprite` bitECS components
- Unit: `RenderSystem` creates a PixiJS `Sprite` display object for the entity and adds it to the stage
- Unit: `MovementSystem` modifies the entity's `Position` each tick so the sprite visibly moves
- Integration: Playwright test: navigate to game route → wait for `canvas` element → screenshot shows non-blank canvas with colored content
- Integration: Playwright test: two screenshots 500ms apart → sprite position differs (game loop is running)

**Watch Points**:
- Texture must load from `static/` directory or be programmatically generated — no external CDN URLs that fail offline
- If Tauri is not yet set up (C-013 pending), the MVP can be tested in the browser via `vite dev` — the canvas works identically in both environments
- The sprite must be visible at default canvas size (at least 400×300) — not a 1×1 pixel

### AC-6: TDD Test Suite for Engine Boundary
**Given** the `EngineBridge` interface and `GameWorld` implementation
**When** the test suite executes
**Then** all bridge message types are tested, entity events propagate correctly, and the engine lifecycle is verified

**Test Hooks**:
- Unit: `test -f apps/frontend/pwa/src/lib/game/__tests__/engine-bridge.test.ts`
- Unit: `test -f apps/frontend/pwa/src/lib/game/__tests__/game-world.test.ts`
- Unit: `bun test apps/frontend/pwa/src/lib/game/` passes (headless bridge tests)
- Unit: Bridge test: send command → on handler receives correct event with typed payload
- Unit: Bridge test: on → unsubscribe → on again → second handler only fires (first is unsubscribed)
- Unit: Bridge test: emit event with no registered handler → no crash, no error
- Unit: GameWorld test: `createGameWorld(mockCanvas, mockBridge)` → `GAME_READY` event emitted
- Unit: GameWorld test: entity created → query returns entity → destroy → query returns empty
- Unit: RenderSystem test: entity with Sprite component → PixiJS container has child
- Unit: DialogTriggerSystem test: player within interaction radius of NPC → bridge emits `NPC_DIALOG_START`

**Watch Points**:
- Headless tests (bridge, component, entity) run without a browser — use Bun's native test runner
- Canvas-dependent tests (render system, visual) use a canvas mock or Playwright
- Mock Bridge implementation for tests must implement `EngineBridge` interface exactly
- Tests must NOT require a real PixiJS `Application` instance for bridge/entity tests — mock where possible

## Implementation Notes

### Coding Rules (must be followed throughout implementation)

1. **Prefer `const` over `function`** — Arrow functions for callbacks, factories, and system functions. `function` reserved for generator functions (`function*`).
2. **Escape early** — Guard clauses at the top of every method. Check `bridge.isReady()` before sending, check entity exists before modifying components.
3. **Always `{}` for `if`** — Every `if`, `else if`, `else`, `for`, `while` body wrapped in curly braces `{}`, even single-line.
4. **`type` for data, `interface` for contracts** — `type` for `GameCommand`, `GameEvent`, `Position`, `Sprite`. `interface` exclusively for `EngineBridge` (the OOP contract).
5. **Tests first** — Write `engine-bridge.test.ts` before `engine-bridge.ts`. Write `game-world.test.ts` before `game-world.ts`. The mock bridge makes this possible.
6. **No Svelte runes in `lib/game/`** — The `game/` directory is a pure imperative TypeScript zone. `$state`, `$derived`, `$effect` are banned here.
7. **No game internals in ViewModels** — ViewModels import `EngineBridge` (the interface), never `GameWorld`, `RenderSystem`, `pixi.js`, or `bitecs`.

### Files to create
- `apps/frontend/pwa/src/lib/game/index.ts`
- `apps/frontend/pwa/src/lib/game/engine-bridge.ts` — `EngineBridge` interface + default implementation
- `apps/frontend/pwa/src/lib/game/game-world.ts` — `GameWorld` lifecycle manager
- `apps/frontend/pwa/src/lib/game/pixi-app.ts` — PixiJS `Application` wrapper
- `apps/frontend/pwa/src/lib/game/types.ts` — `GameCommand`, `GameEvent`, bridge internal types
- `apps/frontend/pwa/src/lib/game/components/position.ts`
- `apps/frontend/pwa/src/lib/game/components/sprite.ts`
- `apps/frontend/pwa/src/lib/game/components/velocity.ts`
- `apps/frontend/pwa/src/lib/game/components/npc-dialog.ts`
- `apps/frontend/pwa/src/lib/game/systems/movement-system.ts`
- `apps/frontend/pwa/src/lib/game/systems/render-system.ts`
- `apps/frontend/pwa/src/lib/game/systems/input-system.ts`
- `apps/frontend/pwa/src/lib/game/systems/dialog-trigger-system.ts`
- `apps/frontend/pwa/src/lib/game/entities/create-test-sprite.ts`
- `apps/frontend/pwa/src/lib/game/entities/create-player.ts`
- `apps/frontend/pwa/src/lib/game/entities/create-npc.ts`
- `apps/frontend/pwa/src/lib/game/__tests__/engine-bridge.test.ts`
- `apps/frontend/pwa/src/lib/game/__tests__/game-world.test.ts`
- `apps/frontend/pwa/src/lib/game/__tests__/mock-bridge.ts` — test helper
- `apps/frontend/pwa/src/lib/views/game/game-view-model.svelte.ts`
- `apps/frontend/pwa/src/lib/views/game/game-view.svelte`
- `apps/frontend/pwa/src/routes/(authenticated)/game/+page.svelte` — game route

### Files to modify
- `apps/frontend/pwa/tsconfig.json` — add `$game` path alias pointing to `src/lib/game/`
- `apps/frontend/pwa/vite.config.ts` — add `$game` alias resolution
- `apps/frontend/pwa/svelte.config.js` — add `$game` alias (if needed for SSR awareness)
- `apps/frontend/pwa/package.json` — add test script for game-specific tests (optional, `bun test` finds them automatically)

### Files to delete
- None (existing Godot `apps/frontend/gamejs/` remains untouched — migration is incremental)

### Order of operations
1. Create `$game` path alias in tsconfig + vite config
2. Write `types.ts` with `GameCommand` and `GameEvent` discriminated unions
3. Write `engine-bridge.ts` interface + `MockEngineBridge` implementation for tests
4. Write `engine-bridge.test.ts` — verify message passthrough, unsubscribe, multi-listener — **tests pass**
5. Write bitECS components (`position.ts`, `sprite.ts`, `velocity.ts`, `npc-dialog.ts`)
6. Write `pixi-app.ts` — PixiJS `Application` wrapper (no bitECS yet)
7. Write `game-world.ts` — create world, register components, hook into bridge
8. Write `game-world.test.ts` — verify entity creation, system ticks, bridge events — **tests pass**
9. Write `movement-system.ts` + `render-system.ts` — update positions, sync sprites
10. Write `create-test-sprite.ts` — entity factory for MVP
11. Write `dialog-trigger-system.ts` — emit bridge events on interaction
12. Write `GameViewModel` + `GameView` — Svelte 5 View-ViewModel following existing pattern
13. Write `+page.svelte` route for `/game`
14. Load in browser/dev → verify canvas renders moving sprite
15. Verify: devtools profiler shows no Svelte re-renders during game loop ticks

### Verification
- `bun test apps/frontend/pwa/src/lib/game/` passes (headless + mocked canvas)
- `vite dev` → navigate to `/game` → canvas visible with moving sprite
- Browser devtools Performance tab: record 5 seconds → no Svelte component re-render markers during game loop
- Grep confirms zero `$state` imports in `lib/game/` and zero `requestAnimationFrame` in `lib/views/`
- TypeScript compiles: `bun run typecheck` across PWA without errors

## Edge Cases & Gotchas

- **PixiJS v8 async initialization**: `Application.init()` is async in v8. The `GameWorld` constructor must await this before starting systems. The ViewModel's `initialize()` handles this via the `GAME_READY` bridge event.
- **Canvas element lifecycle**: When Svelte destroys the GameView component (e.g., navigation away), `GameWorld.destroy()` must be called to release WebGL context and cancel `requestAnimationFrame`. Failure to destroy → memory leak in WebGL resources and orphaned animation frames.
- **SSR and PixiJS**: PixiJS requires `document` and `WebGL` — both SSR-incompatible. All game imports must be dynamic (`await import('$game/...')`) so SvelteKit SSR does not crash. The `BaseViewModelContainer` ensures `initialize()` runs only client-side.
- **bitECS World singleton**: Only one `World` instance per page. The `GameWorld` class enforces this. Multiple worlds → duplicate systems → double-rendering.
- **Canvas size responsiveness**: The PixiJS canvas must resize when the browser/Tauri window resizes. Use a `ResizeObserver` on the canvas parent or Tauri's window resize event. PixiJS `app.renderer.resize()` must be called.
- **Tauri vs Browser canvas**: The canvas rendering path is identical in both. Tauri's webview uses the system GPU identically to a browser tab. No Tauri-specific canvas code needed.
- **bitECS query caching**: bitECS queries are cached internally. Avoid creating new queries every frame — create them in the system constructor and reuse the cached reference.
- **Texture loading**: PixiJS v8 uses `Assets.load()` for async texture loading. For the MVP, use a programmatic `Graphics` rectangle to avoid network/disk I/O during initial setup. Upgrade to texture atlases later.
- **Mock canvas for tests**: Bun tests can use `canvas` npm package or a lightweight mock. The mock must support: `getContext('2d')` or `getContext('webgl2')` for PixiJS initialization. If full PixiJS in Bun is too heavy, use Playwright for visual tests and keep unit tests to bridge/component/system logic only.
