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
| 1 | Surface torn down before the replacement was even parsed; failure resumed + unlocked an empty world; disposal did not retire the transition runner | `game_world/scene_transition.ts`, `game_world/world_restorer.ts`, `game_world.ts` |
| 2 | Input lock kept the held-key set, so a post-lock release dispatched a movement key | `game_world/input_controller.ts` |
| 3 | Cross-scene reset kept the outgoing state, so the next update resurrected old history for reused entity ids | `game_world/render_buffer_pool.ts` |
| 4 | Spritesheet cache evicted FIFO and nulled `sheet.textures` under a live actor | `rendering/texture_manager.ts` |
| 5 | Concurrent misses decoded/parsed N times; `destroy()` could not undo an in-flight completion | `rendering/texture_manager.ts` |
| 6 | A reply whose request had already settled was still forwarded, so a timed-out operation re-rendered the UI | `game_world/worker_session.ts` |

## Ownership and failure semantics

### 1. Scene transition — prepare first, checkpoint before teardown, restore on failure

Three stages, each with its own failure semantics.

**Before the destructive stage** (`prepare`, `captureCheckpoint`) nothing has
been destroyed, so the live surface and the worker world are still the old,
*consistent* scene. A failure here needs no recovery at all: the runner
**retains and resumes** the untouched world. It never reloads it — a reload
would re-seed spawns and discard progress. First boot is the exception: with no
previous world to retain, it **holds** (paused, locked, actionable error).

**The checkpoint.** Once the replacement has parsed and the switch is about to
destroy a live world, the runner first captures the **authoritative runtime
state** — a full ECS snapshot (`REQUEST_SNAPSHOT scope=world`) — and only then
tears down. If that capture fails, the switch is abandoned *before* anything
is destroyed: losing unsaved progress to a failed backup is strictly worse than
not switching maps.

**After the destructive stage** a failure replays the previous **scene**
(`resetSurface` → `installScene` → `render` → `postLoadMap`) and then
**rehydrates the checkpoint** (`LOAD_GAME`) on top of it. Both halves are
correlated requests issued in that order, so the worker applies them in order
and the checkpoint lands last, winning over any load effect still in flight
from the failed switch.

> The checkpoint belongs to the **failing load**, not to the last commit. A
> switch taken twenty minutes after the last successful map load must come back
> to where the player is *now*. (Getting this wrong was a real bug caught by
> the progress tests: the first version restored a stale checkpoint and silently
> rewound the run.)

**Holding.** With no committed scene, no checkpoint, or a failed half, the
engine stays paused with input **locked** and says so. `running = true` is
never used to describe a world that does not hold the player's actual progress —
and no claim is made that a bare replay preserves anything.

**Supersession wins everywhere.** A stale generation performs no replay, no
restore, no resume, no unlock, and emits nothing — including from the recovery's
`catch`: `_recoverFromFailure` re-checks generation/disposal before `_holdLocked`
and before `restoreCheckpoint`, so a stale recovery can neither relock input nor
emit a `GAME_ERROR` on behalf of whoever owns engine state now. `dispose()`
(called first in `GameWorld.destroy()`) retires the runner, and a post-dispose
`load` is a no-op.

### 1b. Internal restoration collaborator

`game_world/world_restorer.ts` owns the snapshot/restore seam with two
deliberately different contracts:

- `restore(payload)` — the public load-game path. A save IS a discontinuity, so
  it supersedes in-flight transitions first.
- `rehydrate(payload)` — the recovery path. It also teleports entities (so it
  clears render entries and interpolation history), but it must **not**
  supersede the transition that is running it: recovery calling the public
  `restoreWorld` would bump the generation and abandon itself mid-restore,
  handing back a half-restored world.

`GameWorld.restoreWorld` now delegates to `restorer.restore(payload)`.

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
`EntityAppearanceLoader` acquires the lease per layer and binds it to the
sprite's **PixiJS `destroyed` event** (`entity_appearance.ts:_bindSheetToLifetime`).
That is the only binding that actually holds: a `WeakMap<Sprite, release>`
looked right and leaked, because a collected key never runs its closure — so
every teardown that destroys display objects directly (scene surface reset,
world restore clearing render entries, world destroy) stranded its pin forever
and made the sheet permanently unevictable. Any destruction path now releases,
including ones that never touch this loader. `release()` is idempotent, so the
explicit `disposePrepared` release and the lifecycle listener can both fire.
A failure after the lease is taken releases in the `catch` — that layer never
reaches `commit`/`disposePrepared` and would otherwise pin forever.

`destroy()` retires leased sheets and frees them when the last lease drops.
A parse in flight when the registry is destroyed hands its sheet out
**unpooled**, and holders of that same sheet are counted (`SpritesheetRegistry._orphanLease`)
so concurrent acquirers destroy it exactly once between them, not once each.

`Spritesheet.destroy()` is called with `destroyBase = false`: the base texture
is `Assets.load`-owned and shared with the texture caches, so the registry
frees only its own per-frame textures. Over-budget while everything is pinned
is a deliberate, correct outcome rather than a crash.

`TextureManager.acquireSpritesheet` is the entry point for anything that keeps
a sheet across frames: it pins before pruning, so a saturated cache can never
evict the sheet it just handed out. The engine's appearance loader is its
production call site.

The public one-shot accessors (`getOrCreateSpritesheet`,
`getSpritesheetFrame`) **borrow** instead (`SpritesheetRegistry.borrow`): the
pin is released on the next MACROtask, scheduled at creation so a caller that
forgets to release still cannot leak. An earlier version acquired and released
synchronously, which was subtly wrong — the caller resumes as a *microtask*, so
whenever every other cached entry was pinned the new sheet was the only
unleased candidate and evicted **itself** before the caller could read it. The
caller got a sheet whose `textures` was already `null`; `getSpritesheetFrame`
could return a destroyed frame. `queueMicrotask` would not help — it runs
*before* the caller's continuation. Tests prove all three: live under
saturation, released on the next turn, and bounded under repeated pressure.

Sheet identity is the full geometry (`buildSheetKey` in `rendering/lpc_sheet.ts`):
URL **+ columns + rows + frame width + frame height + key prefix + base texture
uid**. The old key was `url::colsxrows`, so the same URL with 64px vs 128px
cells, or a `walk` vs `slash` label prefix, collided onto one sheet and served
callers frame rectangles — and frame *labels* — that did not exist. Identical
inputs still dedup to one instance.

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

Five cohesive responsibilities were extracted so the ratcheted files could
shrink rather than grow:

| Module | Responsibility | `game_world.ts` / `texture_manager.ts` |
|---|---|---|
| `rendering/spritesheet_frames.ts` | frame geometry (thin delegating methods keep the `TextureManager` API) | 923 → 751 |
| `rendering/spritesheet_registry.ts` | sheet lifetimes | |
| `game_world/screen_projection.ts` | screen → world → tile-cell | 2221 → 2206 |
| `game_world/world_restorer.ts` | snapshot/restore sequencing | |
| `game_world/load_map_message.ts` | the `LOAD_MAP` payload (pure) | |
| `rendering/lpc_sheet.ts` | sheet identity + atlas/sheet construction | |
| `game_world/engine_diagnostics_probe.ts` | E2E/visual state publication | |

`game_world.ts` finishes under its 2214 waiver ceiling — **no ceiling was
raised**. `texture_manager.ts` graduated from the size baseline via the
guard's own reduction-only update (923 → 746 at extraction; 751 after follow-up).
The table reports current review counts; 2198 / 746 were intermediate extraction counts.

`load` was also flattened so `cognitive complexity` for
`scene_transition.ts` stayed at its recorded level: the stages are now
`_prepareAndCheckpoint` / `_installReplacement` / `_handleFailure` /
`_retainPreviousWorld` / `_recoverFromFailure`, each readable on its own. Two
real bugs were caught while doing it (a dropped `if (!installed)` guard, and a
floating promise in `rehydrate`) — both now have tests.

**Not done, deliberately:** an honest *unique GPU source* estimate. There is no
production consumer for a VRAM diagnostic anywhere in the repo (`bytesUsed` is
read only by tests), so exporting one would be an orphaned public API. The
per-key estimate and its eviction use are unchanged and honest for what they
measure — cached textures, not GPU sources.

### 5b. Client consumer of the same API

`apps/frontend/client/src/lib/components/game/lpc_character_renderer.svelte`
acquired sheets through the old unpinned accessor **and called
`sheet.destroy()` itself** in its effect cleanup and `onDestroy`. That destroys
a registry-owned sheet: `textures` becomes `null` while the registry still
lists the key alive, so a later `acquire` for that key returns a dead sheet —
precisely the `TypeError` the registry exists to prevent.

It now acquires leases, never destroys a sheet, releases on effect cleanup and
`onDestroy`, destroys only its own `displaySprite`, and carries a monotonic
`loadCycle` so a load superseded mid-parse **releases its own lease** instead
of resurrecting a sheet into the next cycle's map.

### 5c. Input lock, restated honestly

`GameWorld.setInputLocked`'s doc claimed the interaction key "continues to
work". It has not: `InputController` gates the interact key on the same lock
and `_handleInteractKey` re-checks it, so the world-level E never fires while
locked. Keys typed into a focused DOM control are untouched — that path is the
UI's. The comment now says what the code does.

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
  `WorldRestorer.captureCheckpoint` / `rehydrate` → `SceneTransitionRunner.load`;
  `GameWorld.restoreWorld` → `WorldRestorer.restore`;
  `GameWorld.destroy` → `SceneTransitionRunner.dispose`.
- Input: `GameWorld.setInputLocked` / pause / transition → `InputController`.
- Buffers: worker `STATE_UPDATE` → `GameWorld._handleStateUpdate` →
  `RenderBufferPool.ingest` → `FrameRenderer.render`.
- Textures: `EntityAppearanceLoader.prepare` → `TextureManager.getTexture` /
  `acquireSpritesheet` → `applyLpcFrameToEntry` per frame; sprite destruction
  releases the lease.
- Worker: `WorkerSession.request` / `recycleBuffer` → `_handleInbound`.

## Verification actually run

- `bun moon run frontend-engine:test` — **2002 pass / 0 fail** (134 files).
- `bun moon run frontend-engine:typecheck` — clean.
- `moon_detect_affected` → `frontend-engine`.
- `validate` (fix + typecheck + structural guards) — clean after the
  intermediate extraction state: `texture_manager.ts` (923 → 910 lines) and
  `game_world.ts` (2221 → 2207, under the 2214 waiver ceiling). No
  baseline, waiver, ceiling, skip or timeout was changed.

Review follow-up: `wc -l` reports **2206** for `game_world.ts` and **751** for
`texture_manager.ts`, matching the table. Engine typecheck and the affected
`src/game_world` / `src/rendering` suite pass (**317 tests**). The full suite
also exposes a combat-preview failure and missing generated atlas fixtures.

Engine tests were driven from `packages/frontend/engine` via `bun test` on the
specific files while iterating, and through `bun moon run frontend-engine:test`
for the full suite.

**Not run here (captain owns integration evidence):** Playwright / E2E, dev
servers, production WebGL capture. No production-path claim in this report
rests on an unexecuted run.

## The checkpoint: why fail-closed is the right trade

A reviewer argued the mandatory checkpoint is itself a blocker, because one
`REQUEST_SNAPSHOT` timeout would permanently block every zone crossing. The
checkpoint is kept; what changed is that the claim is now **tested and
measured** rather than asserted.

**Proved by test** (`scene_transition.test.ts` — "a snapshot failure is
transient"): when the capture fails, `resetCount` stays at its pre-switch
value, the engine is running and unlocked, the world is byte-for-byte the one
the player was in (position, health, equipment, NPC state, load count), and
the **next switch succeeds**. So the failure mode is "this crossing is
refused", not "the game is bricked".

**Measured** — `serializeWorld` pre-pass, 5 runs after a warm-up, median:

| entities | median ms |
|---|---|
| 100 | 0.10 |
| 1 000 | 0.84 |
| 5 000 | 3.59 |
| 10 000 | 7.51 |

Method caveat, stated rather than hidden: the harness entities carried no
persistent slice, so these numbers are the `hasPersistentData` scan — a **lower
bound**; the JSON payload adds a proportional amount on top. The scan is
synchronous inside the simulation worker, so it pauses the sim for that
duration once per zone crossing. The main thread's added cost is one
`postMessage` round-trip.

**Known limitation:** the checkpoint does not cover main-thread-only state
(camera VFX, overlay state). That is restored by the scene replay instead.
And on the `_holdLocked` path the worker may still be holding the abandoned
map behind an empty surface — the player is told to reload, which is the only
outward signal that the session is not consistent. A future change could
terminate the worker there; it was left out of this pass deliberately.

## Known limitations

- **A successful map switch adds one worker round-trip**:
  `REQUEST_SNAPSHOT` before teardown. Recovery adds `LOAD_GAME` only on failure.
  The snapshot is only taken when a previous scene exists, but it is on the
  critical path of every switch. This is the deliberate cost of never losing
  progress; if the latency proves unacceptable, the fix is a ring of recent
  snapshots rather than skipping the capture.
- Recovery costs one scene re-render plus `LOAD_MAP` + `LOAD_GAME`. It is
  bounded to one attempt; a failed half holds the engine locked.
- A permanently broken renderer or a dead worker cannot be recovered out of —
  by design, the engine holds and says so instead of faking a live world.
- The checkpoint covers what the worker serialises. Anything that only exists
  in the discarded *main-thread* scene graph (camera-relative VFX, overlay
  state) is restored by the scene replay rather than by the checkpoint.
- Leases make over-budget sheet caches possible while actors are pinned; the
  registry reports the condition through `pinnedCount` but nothing surfaces it
  to the UI yet.

## Captain integration verification — 2026-10-03

The earlier worktree-only execution report is superseded for integration by:

- Combined production Playwright: **19/19 passed**, including five-map
  routing, offline save/reload, NPC appearance parity, durable saved-status
  reload, pause/settings, keyboard/focus and HUD acceptance.
- Interactive movement Playwright: **4/4 passed**, using live diagnostics and
  canvas/camera-derived click coordinates, not visual-freeze snapshots.
- Local evidence: `.evidence/engine-polish/resume-final-client.log` and
  `.evidence/engine-polish/resume-movement.log` (gitignored).

These behavioral checks do not prove a long-running GPU-memory plateau or
human art acceptance. The checkpoint and held-worker limitations above remain.
