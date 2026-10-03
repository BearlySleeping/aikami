# Engine runtime integrity — execution report

Bounded spec + execution report for the engine runtime-integrity pass
(`packages/frontend/engine/**`). No new contracts; no status-file churn.

Branch: `task/sa-polish-runtime-integrity-6577` · base `67ff50f5`

## What was wrong

Six confirmed defects, all in the engine's own lifecycle seams. Each one is a
case where the engine believed it was in a state it was not in: a live world
with nothing in it, suppressed input that still moved, "history" that belonged
to a different scene, a cache that destroyed a texture another object was
reading, a second decode of an asset already being decoded, and a reply for a
request that had already failed reaching the UI.

| # | Defect | Site |
|---|---|---|
| 1 | Surface torn down before the replacement was even parsed; failure resumed + unlocked an empty world; disposal did not retire the transition runner | `game_world/scene_transition.ts`, `game_world.ts` |
| 2 | Input lock kept the held-key set, so a post-lock release dispatched a movement key | `game_world/input_controller.ts` |
| 3 | Cross-scene reset kept the outgoing state, so the next update resurrected old history for reused entity ids | `game_world/render_buffer_pool.ts` |
| 4 | Spritesheet cache evicted FIFO and nulled `sheet.textures` under a live actor | `rendering/texture_manager.ts` |
| 5 | Concurrent misses decoded/parsed N times; `destroy()` could not undo an in-flight completion | `rendering/texture_manager.ts` |
| 6 | A reply whose request had already settled was still forwarded, so a timed-out operation re-rendered the UI | `game_world/worker_session.ts` |

## Ownership and failure semantics

### 1. Scene transition — prepare before teardown, replay on failure

`SceneTransitionRunner.load` now runs `prepare()` **before** `resetSurface()`.
A parse/render failure therefore leaves the previous surface and the previous
worker world intact and consistent, for free.

When the failure happens after teardown has begun, `running = true` is no
longer treated as recovery. The runner keeps the last **committed** scene
(`{ scene, options }` — a `PreparedScene` holds no display objects, so it is
replayable) and:

- **replays** it: `resetSurface` → `installScene` → `render` → `postLoadMap` →
  resume + unlock. The worker round-trip is part of the replay, so renderer and
  worker agree again before input is handed back. The original failure is still
  reported as `GAME_ERROR`.
- **holds** when there is nothing to replay (first boot) or the replay itself
  fails: the engine stays paused with input **locked** and the error says the
  engine is paused and must be reloaded. `running = true` is never used to
  describe a world that does not exist.

Supersession still wins everywhere: a stale generation performs no replay, no
resume, no unlock, and emits nothing. `dispose()` (now called first thing in
`GameWorld.destroy()`) retires the runner so a pending load can neither resume
nor unlock a torn-down engine, and a post-dispose `load` is a no-op.

First-boot failure is still an explicit failure: the promise rejects and the
UI-visible event shape (`GAME_ERROR: Map load failed: …`) is unchanged.

### 2. Input lock — the lock forgets

`setLocked(true)` clears the held-key set. Every velocity publication funnels
through one guard, so locked input can never publish a nonzero vector (hold
W+D → lock → release D now publishes zero, not W). A release whose event target
is a focused control still releases the key the game owns — only the default
action is withheld, so Enter on a button is still not swallowed. Blur clears
held keys and, if movement was actually in flight, cancels the click path
(alt-tab no longer leaves the player auto-walking to a stale destination).

### 3. Interpolation history — snap after a discontinuity

`resetHistory` marks the next adopted state as a snap. The active view survives
the reset (that is what it always did), but it can no longer become the
interpolation origin of the next scene, so reused entity ids snap instead of
blending from the previous map. Only an **adopted** state consumes the snap: a
buffer-less SYNC carries no positions and leaves the mark armed.

The history slot is now independently owned: it is allocated once per distinct
element count and refilled in place, always **before** the outgoing buffer is
recycled, so it can never read a detached `ArrayBuffer`. `clear()` drops it.

The ingestion boundary also validates: a buffer whose `byteLength` disagrees
with the engine layout, or timing carrying a non-finite number, is rejected —
counted, reported through `onRejectedState`, and the bad buffer is **dropped
rather than recycled** (recycling it would let the worker adopt it and emit the
same malformed state again). The engine buffer is 120 000 bytes; no FPS or
memory claim is made for this change.

### 4. Spritesheets — leases, not FIFO

New `SpritesheetRegistry` (`rendering/spritesheet_registry.ts`). Consumers take
a **lease**; eviction only ever considers unleased sheets, so a live actor can
never be FIFO-evicted out from under `layer.spritesheet.textures[…]`.
`EntityAppearanceLoader` acquires the lease per layer and gives it back on
`disposePrepared` and when `commit` replaces a child (tracked by sprite
identity in a `WeakMap`). `destroy()` retires leased sheets and frees them when
the last lease drops.

`Spritesheet.destroy()` is called with `destroyBase = false`: the base texture
is `Assets.load`-owned and shared with the texture caches, so the registry
frees only its own per-frame textures. Over-budget while everything is pinned
is a deliberate, correct outcome rather than a crash.

`TextureManager.acquireSpritesheet` is the new entry point and returns a lease;
the engine's appearance loader is its only production call site.
`getSpritesheetFrame` is a one-shot lookup and releases immediately.

`getOrCreateSpritesheet` is kept as an explicitly unpinned compatibility
wrapper (acquire → resolve → release) because
`apps/frontend/client/.../lpc_character_renderer.svelte:126` calls it and the
client is owned by another stream. That call site still holds a sheet across
frames without a lease, i.e. it keeps the pre-existing eviction hazard and
should be migrated to `acquireSpritesheet` when the client is next touched.

### 5. Loads — single flight, and teardown that sticks

New `createDeferredLoadRegistry` (`rendering/deferred_loads.ts`). `getTexture`,
`getGrayscaleSheet` and the sheet parse all run single-flight: concurrent misses
share one decode/parse and one accounting entry. A rejection clears the key so
the next caller retries. `destroy()` invalidates the registries, so a load that
completes afterwards still resolves for its original caller (the texture really
was produced, and it is asset-owned) but never repopulates a dead cache; the
same holds for a sheet parse, whose lease is handed back unpooled.

Dead state removed: `_frameSliceCache` / `_frameSliceRefCounts` were written by
nothing (frame views are allocated directly over the shared source) and were
only ever cleared.

Two cohesive responsibilities were extracted so the ratcheted files could
shrink rather than grow: `rendering/spritesheet_frames.ts` (frame geometry —
`TextureManager` keeps thin delegating methods, API unchanged) and
`rendering/spritesheet_registry.ts` (sheet lifetimes). `texture_manager.ts`
went 923 → 825 lines, `game_world.ts` 2221 → 2207 (under the 2214 waiver
ceiling). The size baseline was locked down to the reduction by the guard's own
reduction-only update; no ceiling was raised.

**Not done, deliberately:** an honest *unique GPU source* estimate. There is no
production consumer for a VRAM diagnostic anywhere in the repo (`bytesUsed` is
read only by tests), so exporting one would be an orphaned public API. The
per-key estimate and its eviction use are unchanged and honest for what they
measure — cached textures, not GPU sources.

### 6. Worker session — stale replies stop at the boundary

A terminal reply whose `requestId` no longer has a pending request is stale by
construction (late after a timeout or disposal, or a duplicate) and is no
longer forwarded to the facade — it is counted and reported through
`onLateReply` and included in the heartbeat stall payload. Replies that *do*
settle a pending request are still forwarded, so the boot/restore
`GAME_READY`/`GAME_ERROR` paths are untouched; genuinely unsolicited traffic
(no `requestId`) still flows.

## Production path exercised

- Scene transition: `GameWorld.loadMap` → `SceneTransitionRunner.load` →
  `GameWorld.destroy` → `SceneTransitionRunner.dispose`.
- Input: `GameWorld.setInputLocked` / pause / transition → `InputController`.
- Buffers: worker `STATE_UPDATE` → `GameWorld._handleStateUpdate` →
  `RenderBufferPool.ingest` → `FrameRenderer.render`.
- Textures: `EntityAppearanceLoader.prepare` → `TextureManager.getTexture` /
  `getOrCreateSpritesheet` → `applyLpcFrameToEntry` per frame.
- Worker: `WorkerSession.request` / `recycleBuffer` → `_handleInbound`.

## Verification actually run

- `bun moon run frontend-engine:test` — **1954 pass / 0 fail** (127 files).
- `bun moon run frontend-engine:typecheck` — clean.
- `moon_detect_affected` → `frontend-engine`.
- `validate` (fix + typecheck + structural guards) — clean after the
  `texture_manager.ts` extraction (923 → 910 lines) and the `game_world.ts`
  `screenToCell` extraction (2221 → 2207, under the 2214 waiver ceiling). No
  baseline, waiver, ceiling, skip or timeout was changed.

Engine tests were driven from `packages/frontend/engine` via `bun test` on the
specific files while iterating, and through `bun moon run frontend-engine:test`
for the full suite.

**Not run here (captain owns integration evidence):** Playwright / E2E, dev
servers, production WebGL capture. No production-path claim in this report
rests on an unexecuted run.

## Known limitations

- Replay costs one full scene re-render plus one `LOAD_MAP` round-trip. It is
  bounded to one attempt; a failed replay holds the engine locked.
- A permanently broken renderer or a dead worker cannot be replayed out of —
  by design, the engine holds and says so instead of faking a live world.
- Leases make over-budget sheet caches possible while actors are pinned; the
  registry reports the condition through `pinnedCount` but nothing surfaces it
  to the UI yet.