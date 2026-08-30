---
id: C-380
title: "Frame Pacing & Point-and-Click Movement"
source: "external architecture review (claude CLI) — docs/research/game_engine_architecture_review.md §3 B9, §4 Q1, Q5"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-11"
---

# Contract C-380: Frame Pacing & Point-and-Click Movement

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/research/game_engine_architecture_review.md` §3 (B9), §4 (Q1 sync cost, Q5 click-to-move) |
| **Target** | `packages/frontend/engine/src/worker/ecs_worker.ts` — tick clock + state timestamps; `game_world.ts` — interpolation, pointer input, unprojection; `engine_bridge.ts` + `types.ts` — `MOVE_TO_CELL`; `apps/frontend/client/` — cursor UI |
| **Priority** | P1 — the sim runs on `setTimeout(16)` while rendering runs on rAF with **no interpolation**, producing continuous judder that no amount of texture work fixes. Point-and-click is greenfield and is the input model the game is meant to have. |
| **Dependencies** | **C-379** (hard — click-to-move consumes its A* and `PathFollow`; file: `C-379-collision-and-movement-unification.md`). C-377 (pixel snap must land before interpolation, or sub-pixel interpolation reintroduces shimmer; file: `C-377-pixel-art-render-correctness.md`). |
| **Status** | approved |
| **Promotion** | `integrated` — `/game` route + a new Playwright spec |
| **Docs Impact** | user-facing → controls documentation update in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

Verified against HEAD (`4ea2ccf5`).

### 🔴 A. Sim and render run on independent clocks with no interpolation

The worker schedules itself with a fixed-delay timer:

```ts
// worker/ecs_worker.ts:845-849
const _scheduleNextTick = (): void => {
  ...
  _tickTimerHandle = setTimeout(tickLoop, 16);
};
```

The main thread renders on the PixiJS rAF ticker (`game_world.ts:531`), and
`_updateRenderFromBuffer` (`game_world.ts:2436-2502`) snaps display objects
directly to the last received buffer position:

```ts
entry.displayObject.x = x;
entry.displayObject.y = y;
```

No interpolation, no extrapolation, no tick timestamp in the `STATE_UPDATE`
payload (`ecs_worker.ts:1103-1138`, `:1205-1235`).

`setTimeout(_, 16)` is a *delay*, not a period: the actual cadence is
`16 + tick duration + timer clamping`, so the sim free-runs somewhere below
60Hz and is never phase-locked to vsync. On a 60Hz display the beat between the
two clocks drops or duplicates roughly one frame per second; on 120/144Hz
panels every frame between sim updates is a repeat. **This is the dominant
"movement feels cheap" factor and it is independent of every texture fix in
C-377.**

### 🟢 B. The `SharedArrayBuffer` path was already removed

`config/memory_config.ts` (`createEngineBuffer`) always returns an `ArrayBuffer`.
The SharedArrayBuffer zero-copy path was deliberately removed because it
required cross-origin isolation (COOP: same-origin + COEP: require-corp), which
breaks Firebase Auth popup sign-in and is unavailable in Tauri webviews — see
`docs/gotchas/cross-origin-isolation.md`. The existing N-buffer transfer protocol
(`ecs_worker.ts:1141-1249`) uses transferable `postMessage` with a 3-buffer pool
and a starvation-copy fallback (`ecs_worker.ts:1174-1180`) that `slice(0)`s the
whole 120KB buffer when no slot is free.

This contract does NOT reintroduce SharedArrayBuffer. The interpolation path
must hold two states without detaching under the existing ArrayBuffer transfer
cycle.

### 🔴 C. There is no pointer input anywhere in the game

Grep for `pointerdown` across `apps/frontend/client/src` and
`packages/frontend/engine/src`: the only hits are audio-unlock gestures
(`services/audio/audio_context_manager.ts:57`, `audio_service.svelte.ts:578`)
and an unrelated settings slider. There is no click-to-move, no mouse picking,
and no screen→world unprojection.

Every display object in the scene sets `eventMode = 'none'` deliberately
(C-032) — `render_system.ts:185,282,437`, `game_world.ts:1164,2408,2657`,
`tilemap_chunk_renderer.ts:694`, `weather_overlay.ts:396`. So PixiJS hit-testing
is not available and should not be re-enabled: turning it on would add a
per-frame hit-test across every sprite to solve a problem that is a two-line
inverse transform.

The transform to invert is entirely in one place and is a pure translate+scale:

```ts
// game_world.ts:2518-2526
const dynamicScale = 4 * this._cameraZoom;
this._worldContainer.x = this._app.screen.width / 2 - this._cameraX * dynamicScale;
this._worldContainer.y = this._app.screen.height / 2 - this._cameraY * dynamicScale;
```

### Baseline tests

- `moon run engine:test` — 910 pass / 0 fail
- `apps/e2e/tests/game/collision_e2e.spec.ts` — drives keyboard movement and reads `window.__AIKAMI_DEBUG__.playerX/Y` (`game_world.ts:2457-2461`); the same hook serves this contract's E2E
- `apps/e2e/src/visual/suites/emberwatch.visual.ts`

## User Outcome

After this contract, a **player** sees smooth movement at any display refresh
rate, and can click a tile to walk there, click an NPC to approach and talk to
them, and click a doorway to travel — with a cursor that shows what the click
will do before they commit.

## Success Measures

- **Time/latency target**: no dropped or duplicated frames attributable to sim/render clock beat at 60Hz and 144Hz. Click→first movement under 100ms.
- **Offline/degraded behavior**: unchanged — no network path. Keyboard input remains fully functional; click-to-move is additive and either input can interrupt the other.
- **Production journey enabled**: the game is playable with a mouse alone, which is the input model the design targets and a prerequisite for touch.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Worker tick loop | `worker/ecs_worker.ts:911-1256` | modify — fixed-timestep accumulator + state timestamp |
| State payload | `ecs_worker.ts:1103-1235` | modify — carry tick index + timestamp |
| Render sync | `game_world.ts:2436-2502` | modify — interpolate between the last two states |
| Buffer allocation | `config/memory_config.ts` | reuse — ArrayBuffer transfer path, no SharedArrayBuffer |
| Camera transform | `game_world.ts:2515-2545` | reuse — invert it for unprojection |
| Keyboard input | `game_world.ts:1570-1708` (post-C-379) | reuse — pointer input is a sibling handler |
| Pathfinding + locomotion | `math/astar.ts`, `PathFollow` (C-379) | reuse — click sets a goal, nothing more |
| Interaction selection | `systems/interaction_target_selector.ts`, `interaction_proximity_system.ts` | reuse — click routing consults the same notion of "interactable" |
| Bridge commands | `engine_bridge.ts`, `types.ts:43` | modify — add `MOVE_TO_CELL` |
| Debug hook | `game_world.ts:2457-2461` (`__AIKAMI_DEBUG__`) | reuse — E2E assertion surface |

## Overview

Two changes that together make movement feel deliberate. First, decouple
simulation cadence from display cadence properly: the worker keeps a fixed
timestep and stamps each state, and the main thread interpolates between the two
most recent states so rendering is smooth at any refresh rate. Second, add
pointer input: unproject the click through the inverse camera transform, decide
from the grid what the click means, and route it to the existing locomotion and
interaction systems as a goal — no new movement code.

## Design Reference

- **Fixed timestep, interpolated rendering** is the standard decoupling (Gaffer's "Fix Your Timestep"). The worker already has a delta clamp (`MAX_FRAME_DELTA_MS = 100`, `ecs_worker.ts:838`) and a monotonic `tickCount` (`:1092`) — both are the raw material.
- **Do not use PixiJS hit-testing.** The scene is deliberately `eventMode: 'none'` throughout (C-032). One canvas-level listener plus an inverse transform is both cheaper and simpler.
- **The worker stays authoritative.** Click routing decides *intent* on the main thread from the grid, then posts a goal. Pathfinding never runs on the main thread.
- C-379 established A* and `PathFollow`; this contract adds a second goal producer alongside GOAP and party-follow. It must not add a third movement executor.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Interpolate, do not extrapolate.** Render one sim step behind and blend between the last two received states. Extrapolation mispredicts on direction changes and collisions, which is exactly where a top-down game's movement is most scrutinised.
- **Interpolation is a render concern only.** No interpolated value is ever written back into ECS, into a save, or into the collision path. The buffer stays the sim's output.
- **Snap after blending.** C-377's device-pixel snap must apply to the *interpolated* container position, not the raw one, or interpolation reintroduces the shimmer C-377 removed.
- **One canvas listener, one inverse transform.** Unprojection lives next to the forward transform in `game_world` so the two cannot drift.
- **Click routing reads the grid, not the scene graph.** Consult the occupancy and terrain grids (C-379) for what is at a cell. The scene graph is a rendering artifact and must not become an input source.
- **Clicks produce goals, never velocities.** `MOVE_TO_CELL` is a goal for `PathFollow`. Nothing on the main thread may write `Velocity`.

## State & Data Models

```ts
/** Appended to the existing STATE_UPDATE payload. */
type StateUpdateTiming = {
  /** Monotonic sim tick index (already tracked as `tickCount`). */
  tick: number;
  /** Worker-clock timestamp when this state was serialized (performance.now()). */
  simTimeMs: number;
  /** Fixed timestep in ms, so the main thread knows the blend denominator. */
  stepMs: number;
};

/** Main-thread ring of the two most recent states, for blending. */
type RenderStateWindow = {
  previous?: { view: Float32Array; simTimeMs: number; cameraX: number; cameraY: number };
  current?: { view: Float32Array; simTimeMs: number; cameraX: number; cameraY: number };
};

/** New bridge command — a goal, not a movement. */
type MoveToCellCommand = {
  type: 'MOVE_TO_CELL';
  cellX: number;
  cellY: number;
  /** Stop this many world pixels short (interaction range, formation slot). */
  arriveRadius: number;
};

/** What a click at a cell resolves to. Decided on the main thread from the grids. */
type ClickIntent =
  | { kind: 'move'; cellX: number; cellY: number }
  | { kind: 'interact'; eid: number; cellX: number; cellY: number }
  | { kind: 'portal'; eid: number; cellX: number; cellY: number }
  | { kind: 'reject'; reason: 'blocked' | 'unreachable' | 'out-of-bounds' };
```

## Quality Requirements

- **Offline/degraded mode**: N/A.
- **Accessibility/input**: keyboard movement must remain fully functional and must interrupt an active click-path immediately. Pointer input must not become the only way to do anything. Cursor feedback must not be the sole signal for a rejected click — pair it with an audible or visual click-marker.
- **Performance budget**: interpolation adds one buffer copy per state and a lerp per rendered entity — must not measurably move frame time on the village map. Verify at 144Hz where the render:sim ratio is highest.
- **Security/privacy**: N/A — COOP/COEP was already evaluated and rejected (see `docs/gotchas/cross-origin-isolation.md`). The existing `COOP: same-origin-allow-popups` (no COEP) is unchanged.
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: a new click supersedes the previous goal; a keyboard press cancels the path; entering DIALOGUE/COMBAT/MENU cancels it. Repeated identical clicks must be idempotent, not a repath storm.
- **Observability**: log the resolved `ClickIntent` and the resulting path length under render-debug; expose the interpolation alpha in the existing debug metrics so pacing problems are diagnosable.

## Migration & Rollback

- **Old data compatibility**: N/A — no persisted state.
- **Migration**: N/A — no COOP/COEP headers are added (they were already removed; see `docs/gotchas/cross-origin-isolation.md`).
- **Rollback**: `git revert`. Interpolation and pointer input are both additive and independently revertible.
- **Feature flag or kill switch**: interpolation falls back to snap-to-latest when the state window has fewer than two entries — the pre-contract behaviour — so a bad blend degrades rather than breaks. Pointer input is a listener that can be removed without touching movement.
- **Failure recovery**: if `simTimeMs` regresses or the window gaps (tab backgrounded), reset the window and snap for one frame rather than blending across the discontinuity.

## Scope Boundaries

- **In Scope:**
  - Fixed-timestep accumulator in the worker; tick index + timestamp + step in `STATE_UPDATE`
  - Main-thread two-state window and interpolated rendering, with pixel snap applied after blending
  - Verification that the existing ArrayBuffer transfer path holds two states without detaching under interpolation (COOP/COEP/SharedArrayBuffer was already removed — see `docs/gotchas/cross-origin-isolation.md`)
  - Screen→world unprojection co-located with the forward camera transform
  - Canvas-level pointer listener; `ClickIntent` resolution from the terrain/occupancy grids
  - `MOVE_TO_CELL` bridge command routed to `PathFollow`
  - Click routing: move / interact / portal / reject, including "walk to an NPC then talk"
  - Tile hover highlight and a click-destination marker
  - Cancellation on keyboard input and on mode change
  - Controls documentation update
- **Out of Scope:**
  - **Touch and gesture input** — pointer events cover mouse; touch ergonomics (tap targets, long-press) is its own contract
  - **Pathfinding, `PathFollow`, GOAP goals** — C-379 owns them; this contract only produces goals
  - **Any rendering or texture change** — C-377 / C-378
  - **Entity spatial culling** (the `FIXME` at `game_world.ts:2494`)
  - **`MAX_ENTITIES` / dense render-buffer indexing rework**
  - **Rebindable mouse buttons** — fixed left-click for now
  - Drag-select, box-select, or any RTS-style multi-unit control

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split, though it is the closest call of the five.
Interpolation and click-to-move share the camera transform as their single point
of coupling: unprojection must invert the *same* transform that interpolation
now feeds, and shipping click-to-move against a juddering, snap-positioned
camera produces clicks that land a frame behind the cursor. They are verified by
the same E2E surface (`__AIKAMI_DEBUG__.playerX/Y`) and neither is releasable
into a good experience without the other.

## Acceptance Criteria

### AC-1: The worker runs a fixed timestep and stamps every state
**Given** the simulation is running
**When** a `STATE_UPDATE` is posted
**Then** it carries the monotonic tick index, the worker-clock serialization timestamp, and the fixed step size, and the sim advances in fixed increments independent of timer jitter

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/frontend/engine/src/__tests__/ecs_worker_module_eval.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: drive the tick loop with a mocked clock producing irregular wake-ups (10ms, 40ms, 3ms); assert the number of fixed steps consumed matches elapsed time and that `tick` increments monotonically
- E2E / Visual: N/A

**Watch Points**:
- The existing `MAX_FRAME_DELTA_MS = 100` clamp must become a cap on *steps per wake-up*, not a clamped variable delta — otherwise a backgrounded tab produces a spiral-of-death catch-up on resume.
- `tickCount` already exists (`ecs_worker.ts:1092`) and is sent in the `ack` block. Reuse it rather than adding a parallel counter.

### AC-2: Rendering interpolates between sim states
**Given** the display refreshes faster than the sim steps
**When** frames are drawn between two sim states
**Then** entity positions and the camera are blended between them, the blend factor is derived from wall-clock time against the step size, and no interpolated value is written back into ECS or a save

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Visual | `packages/frontend/engine/src/__tests__/rendering.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: feed two states 16ms apart, render at 4 intermediate wall-clock times, assert monotonic sub-step progress and exact endpoint match at alpha 0 and 1
- E2E / Visual: capture at 144Hz-equivalent frame pacing; assert the player's rendered position advances every frame rather than in 60Hz staircases

**Watch Points**:
- Blending must apply to the camera too, or the world container steps while entities glide — worse than the current uniform judder.
- Pixel snap (C-377 AC-3) applies **after** blending. Verify by asserting the snapped position changes on consecutive rendered frames at 144Hz.
- The `ArrayBuffer` transfer path detaches buffers; holding two states means the previous view must be copied before the buffer is recycled, or it detaches mid-frame.

### AC-3: The ArrayBuffer transfer path holds two states without detaching under interpolation
**Given** the engine is running with the N-buffer transfer protocol
**When** the main thread holds a reference to the previous state buffer
**Then** the previous buffer is copied before the buffer is recycled/transferred, and the two-state window never aliases a buffer that has been handed back to the worker

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit + Integration | `packages/frontend/engine/src/__tests__/ecs_worker_module_eval.test.ts`, `apps/e2e/tests/game/collision_e2e.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: inject a synthetic buffer recycle cycle; assert the previous state view is not detached after the buffer is transferred back to the worker
- E2E / Visual: N/A

**Watch Points**:
- The starvation branch (`ecs_worker.ts:1174-1180`) already `slice(0)`s — the main thread's window must not alias a buffer it has handed back.
- The `crossOriginIsolated` / `SharedArrayBuffer` path was deliberately removed (`memory_config.ts:55-58`). Do NOT reintroduce it — see `docs/gotchas/cross-origin-isolation.md` for the full reasoning (breaks Firebase Auth popup sign-in).

### AC-4: A click on walkable ground walks the player there
**Given** the player is idle and clicks a reachable walkable tile
**When** the click is released
**Then** the click unprojects to the correct cell at any zoom and canvas size, a `MOVE_TO_CELL` goal is posted, and the player paths to it and stops

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit + E2E | `packages/frontend/engine/src/__tests__/game_world.test.ts`, `apps/e2e/tests/game/click_to_move.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: table-driven unprojection over canvas sizes, camera positions, zoom values and device pixel ratios; assert round-trip world→screen→world identity
- E2E / Visual:
  - **Functional**: `apps/e2e/tests/game/click_to_move.spec.ts` — click a known tile, poll `__AIKAMI_DEBUG__.playerX/Y` until it settles, assert the destination
  - **Visual**: N/A

**Watch Points**:
- Round-trip identity is the assertion that catches every off-by-a-half-tile error at once; prefer it over hand-computed expectations.
- Unprojection must use the *un-snapped* camera position; snapping is a render-only adjustment and inverting the snapped value drifts by up to a device pixel.
- `_cameraZoom` lerps during dialogue — clicks during a zoom transition must still land correctly.

### AC-5: Clicks route to interaction and travel, not just movement
**Given** the player clicks an NPC, an interactable, or a transition zone
**When** the intent resolves
**Then** the player walks into range and the interaction or map transition fires — the same outcome as pressing the interact key at that target

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit + E2E | `packages/frontend/engine/src/__tests__/interaction_target_selector.test.ts`, `apps/e2e/tests/game/click_to_move.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: table-driven over cell contents (empty walkable / blocked / NPC / interactable / transition / out-of-bounds) asserting the resolved `ClickIntent`
- E2E / Visual: click Elder Thalia from across the village; assert the player approaches and dialogue opens. Click the inn doorway; assert the map transition fires

**Watch Points**:
- Intent must come from the grids, not the scene graph — assert that by resolving intent with the renderer stubbed out entirely.
- Clicking a blocked tile adjacent to a reachable one is the common case (clicking a wall next to a path). Decide and test: reject, or route to the nearest walkable neighbour. Recommendation: nearest walkable neighbour within one cell, else reject.
- The interact-on-arrival handoff must reuse `interaction_target_selector`'s radius, or clicking and key-pressing produce different results at the boundary.

### AC-6: The cursor shows what a click will do
**Given** the pointer moves over the canvas
**When** it rests over a cell
**Then** a highlight shows the target cell and its resolved intent (walk / interact / travel / blocked), updating as the pointer moves, and a marker appears at the destination on click

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Visual | `apps/e2e/src/visual/suites/emberwatch.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run e2e:visual`
- Integration: assert the highlight's world position matches the unprojected cell for a synthetic pointer position
- E2E / Visual:
  - **Functional**: N/A
  - **Visual**: add `hoverHighlightVisible: Type.Boolean({ description: 'Whether a tile highlight is drawn under the cursor showing the click target' })` with a case that positions the pointer over a known tile

**Watch Points**:
- The highlight is a world-space overlay and needs a z-band. It belongs above the tilemap and below entities — reuse C-378's decor band rather than inventing a fourth band.
- Hover intent resolution runs per pointer-move; throttle to cell changes, not raw pointer events.
- At 4× scale a 32px cell is 128 screen pixels; a 1px outline nearly vanishes. Draw the highlight in world units so it scales with the world.

### AC-7: Keyboard and mode changes cancel an active click-path
**Given** the player is walking to a clicked destination
**When** they press a movement key, or the game enters DIALOGUE, COMBAT or MENU
**Then** the path is abandoned immediately, control returns to the interrupting source, and no residual velocity remains

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit + E2E | `packages/frontend/engine/src/systems/path_follow_system.test.ts`, `apps/e2e/tests/game/click_to_move.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: start a path, inject a keyboard velocity, assert `PathFollow` is cleared on the same tick and velocity comes from input thereafter; repeat for each mode transition
- E2E / Visual: click a far tile, press W mid-walk, assert the player follows the key

**Watch Points**:
- `updateMovement` already gates on `EXPLORE` mode (`movement_system.ts:140`) and `isSimulationActive()`. Cancellation must clear the *goal*, not merely stop movement, or the player resumes walking to a stale destination when the overlay closes.
- The existing `inputLocked` handling force-stops velocity on repeated keydown (`game_world.ts:1651-1661`); make sure the click path is cancelled there too and not just suppressed.

## Implementation Sequence

1. **Phase 1 (Clock)**: Fixed-timestep accumulator in the worker; add `tick`/`simTimeMs`/`stepMs` to both `STATE_UPDATE` branches. Verify with a mocked clock.
2. **Phase 2 (Buffer safety)**: Verify the existing ArrayBuffer transfer path holds two states without detaching. The previous state view must be copied before the buffer is recycled. (COOP/COEP/SharedArrayBuffer was already removed — `memory_config.ts:55-58` — and must not be reintroduced; see `docs/gotchas/cross-origin-isolation.md`.)
3. **Phase 3 (Interpolation)**: Two-state window on the main thread; blend entity and camera positions; apply pixel snap after blending; fall back to snap-to-latest when the window is short or discontinuous.
4. **Phase 4 (Unprojection)**: Inverse camera transform beside the forward one; round-trip test.
5. **Phase 5 (Intent)**: Canvas pointer listener; `ClickIntent` resolution from the grids; `MOVE_TO_CELL` on the bridge routed to `PathFollow`.
6. **Phase 6 (Routing + feedback)**: Interact and portal routing with walk-into-range; hover highlight and destination marker; cancellation paths.
7. **Phase 7 (Validation)**: `moon run :typecheck && :test && :lint`; new `click_to_move.spec.ts`; `emberwatch.visual.ts` with the hover field; controls docs.

## Edge Cases & Gotchas

- **Interpolation without pixel snap looks worse than snapping.** C-377 AC-3 is a hard prerequisite; verify it is actually in the tree before starting Phase 3.
- **The `ArrayBuffer` fallback detaches on transfer.** Holding a previous state means copying out before recycling. Under the starvation branch (`ecs_worker.ts:1174-1180`) the worker already `slice(0)`s — make sure the main thread's window does not alias a buffer it has handed back.
- **A backgrounded tab produces a large elapsed gap.** Cap catch-up steps per wake-up and reset the interpolation window on resume, or the player teleports and the camera whips.
- **COOP/COEP is not a concern here.** The `SharedArrayBuffer` path was already removed (`memory_config.ts:55-58`) and COOP/COEP was deliberately rejected because it breaks Firebase Auth popup sign-in (`docs/gotchas/cross-origin-isolation.md`). Do NOT reintroduce it.
- **Clicking during a portal transition** must be ignored — `isSimulationActive()` is false and a queued goal would fire on the new map at a meaningless cell.
- **Do not let click routing grow a second interaction radius.** Reuse `interaction_target_selector`; two notions of "in range" will diverge.
- **Do not add extrapolation "just in case".** It is the single most common source of rubber-banding in this pattern and there is no latency here to hide — the sim is in the same process tree.

## Open Questions

Must be resolved before status becomes `approved`:

- Fixed step size: 16.667ms (60Hz) or a coarser 20ms (50Hz) sim with interpolation covering the difference? Recommendation: 16.667ms — it matches the current effective rate, so no gameplay tuning shifts.
- Clicking a blocked tile: reject, or route to the nearest walkable neighbour? Recommendation: nearest walkable neighbour within one cell, then reject — it matches player expectation when clicking a building edge.
- ~~Can COOP/COEP be enabled given the current cross-origin inventory (Firebase Storage, auth, AI providers)?~~ **Resolved**: COOP/COEP was already evaluated and rejected — see `docs/gotchas/cross-origin-isolation.md`. The SharedArrayBuffer path was removed in `memory_config.ts:55-58`. This contract does not revisit that decision.

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
