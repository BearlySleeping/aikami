<!-- completed: 2026-06-29 -->
# C-022: Web Worker ECS Synchronization

**Status**: in_progress
**Created**: 2026-05-31
**Priority**: 1 (highest)
**Layer**: engine
**Depends On**: C-001 (bitECS integration), C-002 (EngineBridge)

---

## Summary

Decouple the bitECS simulation from the main rendering thread by moving ECS world ownership and system ticking into a Web Worker. The main thread retains only PixiJS rendering and the EngineBridge for UI communication. Shared memory (SharedArrayBuffer) carries per-frame entity state from the worker to the renderer, with an ArrayBuffer + Transferable fallback when cross-origin isolation is unavailable.

## Motivation

Running bitECS systems (movement, context, dialog triggers) on the main thread competes with UI reactivity and garbage collection. Moving simulation to a worker isolates frame-budget jitter from the SvelteKit microtask queue and enables future multithreading (physics, AI pathfinding).

## Acceptance Criteria

### AC-1: Worker Owns the bitECS World
- The bitECS `createWorld()`, component registration, entity spawning, and system ticking (movement_system, context_system, dialog_trigger_system) execute inside the worker.
- The main thread no longer calls `createWorld()` or runs ECS systems directly.

### AC-2: Shared Memory Buffer for Entity State
- A `Float32Array` view over a `SharedArrayBuffer` carries per-entity position (x, y, rotation) from worker → main thread every frame.
- When cross-origin isolation is unavailable, the system falls back to N-buffer (3) `ArrayBuffer` exchange via `postMessage` with Transferables.
- Buffer layout: `[eid*3 + 0] = x`, `[eid*3 + 1] = y`, `[eid*3 + 2] = rotation`.

### AC-3: Security Headers for Cross-Origin Isolation
- **Tauri**: `app.security.headers` includes `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. `app.security.useHttpsScheme` is `true`.
- **Vite (Client + Game)**: `server.headers` includes COOP and COEP so local dev mimics the secure context.

### AC-4: Worker Tick Loop Posts STATE_UPDATE
- The worker runs a `setInterval`-based tick loop at the configured frame rate.
- Each tick: run movement → context → dialog trigger → serialize positions to active buffer → postMessage `STATE_UPDATE` (with events + buffer reference or Transferable).

### AC-5: Main Thread Renders from Buffer
- The main thread PixiJS ticker reads entity positions from the active `Float32Array` render view instead of querying bitECS components.
- Display objects are managed in a main-thread `Map<eid, DisplayObject>` populated from `ENTITY_CREATED` worker messages.

### AC-6: Event Proxying
- ECS events (NPC_DIALOG_START, NPC_DIALOG_END, CONTEXT_ENTERED, CONTEXT_EXITED, PLAYER_POSITION_CHANGED) emitted inside the worker are collected and sent via postMessage.
- The main thread receives them and re-emits through the EngineBridge.

### AC-7: Memory Config Module
- `packages/engine/src/config/memory_config.ts` exports `MAX_ENTITIES`, `COMPONENT_STRIDE`, `BUFFER_SIZE`, and `createEngineBuffer(size)`.
- `createEngineBuffer` returns `SharedArrayBuffer` when available, `ArrayBuffer` otherwise.

### AC-8: Existing Tests Pass
- All existing `engine:test` tests pass (they test systems directly, not through GameWorld).
- TypeScript compilation passes for `engine`, `game`, and `client` projects.

### AC-9: GameWorld Public API Unchanged
- External consumers (`apps/frontend/game/src/main.ts`) continue to use `new GameWorld(bridge)` + `gameWorld.initialize({ canvas, width, height })` with the same signature.

---

## Implementation Notes

### Files to Create

| File | Purpose |
|------|---------|
| `packages/engine/src/config/memory_config.ts` | Buffer constants and allocation helper |
| `packages/engine/src/worker/ecs_worker.ts` | Worker entry point — owns bitECS world + systems |

### Files to Modify

| File | Change |
|------|--------|
| `packages/engine/src/game_world.ts` | Spawn worker, allocate buffers, listen for STATE_UPDATE |
| `packages/engine/src/systems/render_system.ts` | Read from Float32Array buffer instead of bitECS query |
| `apps/frontend/client/src-tauri/tauri.conf.json` | Add COOP/COEP headers + useHttpsScheme |
| `apps/frontend/client/vite.config.ts` | Add server.headers for COOP/COEP |
| `apps/frontend/game/vite.config.ts` | Add server.headers for COOP/COEP |

### Worker Message Protocol

```typescript
// Main → Worker
type WorkerCommand =
  | { type: 'INITIALIZE_ENGINE'; canvasWidth: number; canvasHeight: number; buffers: ArrayBuffer[] }
  | { type: 'RECYCLE_BUFFER'; buffer: ArrayBuffer }
  | { type: 'BRIDGE_COMMAND'; command: GameCommand };

// Worker → Main
type WorkerMessage =
  | { type: 'STATE_UPDATE'; buffer?: ArrayBuffer; entities: Float32Array; events: GameEvent[] }
  | { type: 'ENTITY_CREATED'; eid: number; tint: number }
  | { type: 'ENGINE_READY' }
  | { type: 'ENGINE_ERROR'; message: string };
```

### N-Buffer Fallback (without SharedArrayBuffer)

```
Worker writes frame N   → buffer A (active)
Worker posts buffer A   → Main receives, starts rendering from A
Main renders            → buffer A (render view)
Worker writes frame N+1 → buffer B (active)
Worker posts buffer B   → Main receives, swaps render view to B
Main posts buffer A     → Worker receives RECYCLE_BUFFER (now reusable)
```

---

## Data Model

### Memory Buffer Layout

```
Byte offset:  0        4        8        12       16       20       ...
             [e0_x]   [e0_y]  [e0_rot] [e1_x]   [e1_y]  [e1_rot]  ...
```

- `MAX_ENTITIES`: 10,000
- `COMPONENT_STRIDE`: 3 (x, y, rotation)
- `BYTES_PER_ELEMENT`: 4 (Float32)
- `BUFFER_SIZE`: `MAX_ENTITIES * COMPONENT_STRIDE * 4 = 120,000 bytes`

### Main Thread Render State

```typescript
type RenderEntry = {
  displayObject: Container;
  tint: number;
};

const renderMap = new Map<number, RenderEntry>();
let activeRenderView: Float32Array;
```

---

## Edge Cases

1. **No SharedArrayBuffer**: Graceful fallback to 3-buffer ArrayBuffer cycle.
2. **Worker crash**: `ENGINE_ERROR` message → main thread destroys and can re-initialize.
3. **Rapid pause/resume**: Tick loop handles stop/start without leaking intervals.
4. **Entity creation mid-game**: Worker sends ENTITY_CREATED for each new renderable entity.
5. **Canvas resize**: Main thread sends updated dimensions to worker (future AC).
6. **Zero entities**: Empty buffer is valid; render loop is a no-op.

---

## Test Hooks

- `memory_config.createEngineBuffer()` is testable independently.
- Worker internals (world creation, entity spawning) are tested via existing unit tests that bypass the worker.
- Main thread render_system can be tested with a mock Float32Array buffer.
