---
id: C-544
title: "Deterministic Particle Weather FX — Rain, Atmosphere and Scene Gating"
source: "session request — replace the shader-generated rain in `weather_overlay.ts` with a deterministic, profiled particle system"
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/371"
created_at: "2026-09-17"
---

# Contract C-544: Deterministic Particle Weather FX — Rain, Atmosphere and Scene Gating

## Metadata

| Field | Value |
|---|---|
| **Source** | Session request; supersedes the shader-generated rain in the deleted `rendering/weather_overlay.ts` |
| **Target** | `packages/frontend/engine/src/rendering/weather/` — the weather FX layer; `game_world/weather_fx_controller.ts` — the ticker/UBO/scene adapter |
| **Type** | full |
| **Priority** | P1 — rain rendered as square confetti on a 16:9 canvas, and its animation was driven by game time |
| **Dependencies** | C-213 (environment time system — the weather scalars and the environment UBO), C-434 (registry tag resolution), C-435 (de-bundled client) |
| **Status** | implemented |
| **Promotion** | `sandbox` |
| **Docs Impact** | internal → none. The weather layer is presentation-only; no player-facing doc page describes it. |
| **Contract version** | 2.0.0 |
| **Production Surface** | `WeatherFxController` (constructed by `GameWorld`) — the production game route drives it every frame |

## Problem & Baseline Evidence

- **Current behavior**: `packages/frontend/engine/src/rendering/weather_overlay.ts` drew rain *inside a fragment shader*. A fullscreen quad reconstructed drops from a 30×30 (coarse) and 60×60 (fine) hash grid, filled one small rectangle per cell, and **early-returned** per branch. Five defects followed directly from that design:
  1. **Square particles.** Grid cells were computed in uncorrected UV space, so a square UV cell became a 16:9 screen rectangle. Rain read as bright confetti, not streaks.
  2. **Screen noise.** `fract(sin(x) * 43758.5453)` is precision-unstable across GPU drivers; at high cell indices the hash decorrelated into salt-and-pepper speckle.
  3. **Mottled haze.** Fog and rain were mutually exclusive branches, so the atmospheric veil appeared only in cells that happened to contain no drop.
  4. **Game-time rain.** `uLocalTime` was fed `gameTimeSeconds`, so changing the sandbox time scale changed the rain's fall speed.
  5. **Coupled uniforms.** The atmosphere pass consumed the entire environment UBO — ambient colour, shadow colour, ambient intensity — none of which it read, tying the visual pass to a GPU buffer layout it did not own.
- **Reproduction**: open `/dev/sandbox/environment`, set Rain to 1.0 and Wind to 0.7. Observe square bright particles on a 16:9 canvas, a speckled veil, and rain that speeds up and slows down with the Time Scale slider.
- **Additional defects found in the worker half** (`worker/ecs_worker.ts`):
  - `_updateRainDecay` subtracted a fixed amount **per tick** and ignored its own `deltaMs` argument, so weather eased ~2.4× faster at 144 fps than at 60 fps.
  - `_updateWindDrift` called `Math.random()` every tick — the same weather tick sequence produced different weather on every run, so no weather frame was reproducible.
  - There was no manual/dynamic separation: a slider value was silently decayed away by the automatic cycle while the user was still dragging it.
- **Existing implementation to reuse**: the environment UBO's `rainIntensity` / `windVelocity` scalars (C-213), `WeatherOverlay.create` as the facade entry point, the `weather-fx` root label consumed by dev tooling, and the visual-suite infrastructure in `apps/e2e/src/visual/`.
- **Known gaps**: the old layer had no scene awareness at all (interior maps would have shown outdoor rain), no resolution-aware drop budget, and no way to freeze its animation for a screenshot.
- **Baseline tests**: `bun moon run frontend-engine:test` (1598 tests), `bun moon run e2e:typecheck`, and the `environment` visual suite.

## User Outcome

After this contract, a player sees rain as thin, wind-slanted streaks at two distinct depths over a subtly hazed scene, at the same speed regardless of the sandbox time scale or the frame rate, with interiors correctly dry — and a developer can reproduce any weather frame byte-for-byte.

## Success Measures

- **Time/latency target**: the weather layer costs **≤ 0.1 % of a 16.67 ms frame** (measured: 6.4 µs at 720p / 571 drops, 15.7 µs at 1080p / 1286 drops).
- **Offline/degraded behavior**: unaffected — the FX layer is pure presentation with no network or AI dependency, and the rain texture is generated in-process.
- **Production journey enabled**: the game route renders weather that is legible over the tilemap instead of obscuring it, which is what C-213's weather scalars were always meant to look like.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Weather scalars in the environment UBO | `environment/environment_ubo.ts` (`ENV_UBO_OFFSETS`) | reuse — the controller reads only the two weather offsets |
| Overlay facade + `weather-fx` label | `rendering/weather_overlay.ts` | replace — deleted; `rendering/weather/weather_overlay.ts` is the new facade |
| Per-frame ticker hook | `game_world.ts` `tick()` | modify — delegates to `WeatherFxController` |
| Environment easing in the worker | `worker/ecs_worker.ts` | modify — elapsed-time based, seeded, manual mode |
| Screenshot freeze hook | `diagnostics.ts` (`isVisualScreenshotMode`) | reuse — drives the frozen FX clock |
| Visual suite + VLM evaluation | `apps/e2e/src/visual/` | modify — `environment.visual.ts` rewritten with defect gating |

## Overview

Replace shader-generated rain with a real particle system: two pooled `ParticleContainer` batches (a sparse, long, bright foreground layer and a dense, short, faint background layer) plus a single fullscreen haze mesh. Drop positions are a **pure function** of a seeded PRNG, an FX clock, the wind slant and the viewport — never integrated — so any frame is reproducible and a resume after a stalled tab is harmless. Simulation time (the worker's weather scalars) and FX time (animation) are separate clocks, and the renderer reads only the two weather scalars out of the environment UBO instead of the whole buffer. Clear weather hides the entire hierarchy, so it costs no draw calls.

## Design Reference

- `packages/frontend/engine/src/rendering/tilemap/` — the repo's existing pattern for a focused rendering subdirectory with a generated texture and a shader twin.
- `.pi/generated-skills/pixijs/pixijs-scene-particle-container/SKILL.md` — `ParticleContainer` capacity, dynamic-attribute, and bounds-area requirements.
- `.pi/skills/pixijs-v8/SKILL.md` — v8 `TextureSource`/`BufferImageSource` upload contract.
- `.pi/skills/aikami-conventions/SKILL.md` — logger, import, and TypeScript rules.
- `.pi/skills/svelte-conventions/SKILL.md` — the `await import()` allowlist (M9), which constrains the sandbox ViewModel.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

Split the layer by responsibility, not by line count:

| Unit | Responsibility |
|---|---|
| `weather_fx_config.ts` | Every art-direction constant: profiles, drop budgets, atmosphere policy, wrap margin |
| `weather_fx_math.ts` | Pure, GPU-free: seeded PRNG, wrap, slant, drop budgets, exponential smoothing |
| `rain_texture.ts` | One generated premultiplied streak texture |
| `rain_renderer.ts` | The two pooled particle batches, their resize and their per-frame write |
| `atmosphere_overlay.ts` | One fullscreen haze mesh with its own small uniform group |
| `weather_overlay.ts` | The facade: FX clock, transitions, scene gate, debug snapshot |
| `game_world/weather_fx_controller.ts` | Adapts the engine ticker, the environment UBO and the scene context onto the facade |

Rules the layer must hold to:

- **Analytic positions only.** A drop's position is `f(seed, fxTime, wind, viewport)`. Nothing integrates velocity, so nothing drifts.
- **Wrap, never respawn.** Recycling is a modulo over an off-screen margin sized to clear the largest tilted streak — no spawn/destroy churn, and no visible pop.
- **Separate clocks.** The FX clock advances on real frame delta (clamped to 100 ms) and is frozen at a fixed phase in screenshot mode; simulation time stays in the worker.
- **Narrow uniform surface.** The atmosphere pass takes a purpose-built uniform group, never the environment UBO.
- **Dynamic attributes are position, rotation and colour only.** Scale and UVs are baked when the pool is built.
- **Read the viewport from `app.screen` every frame** rather than trusting a resize callback, so PixiJS's own `resizeTo: window` watcher cannot desync the drop budgets.

## State & Data Models

```ts
/** One depth layer's art direction and drop budget. */
type RainBatchProfile = {
  name: 'far' | 'near';
  /** Target drops at the reference viewport. */
  density: number;
  /** Streak length in texture-scale units, before wind stretch. */
  scaleY: number;
  /** Peak alpha of the layer. */
  alpha: number;
  /** Tint applied to every drop in the layer. */
  tint: number;
  /** Fall speed range, in pixels per second. */
  fallSpeedMin: number;
  fallSpeedMax: number;
};

/** What the renderer actually drew, for dev tooling and the visual suite. */
type WeatherFxDebugSnapshot = {
  targetRainIntensity: number;
  currentRainIntensity: number;
  targetWind: number;
  currentWind: number;
  farCount: number;
  nearCount: number;
  poolSize: number;
  farMeanScaleY: number;
  nearMeanScaleY: number;
  atmosphereStrength: number;
  fxTimeSeconds: number;
  viewportWidth: number;
  viewportHeight: number;
  visible: boolean;
};
```

No persistent state, no schema, and no save-format change.

## Quality Requirements

- **Offline/degraded mode**: N/A — presentation only, no network or AI in the path.
- **Accessibility/input**: N/A — decorative; the layer is `eventMode: 'none'` and takes no input. Reduced-motion is not wired (see Open Questions).
- **Performance budget**: ≤ 0.1 % of a 16.67 ms frame, verified by `weather_fx_profiling.test.ts` with a per-drop linearity assertion and a 5000-frame pool-stability assertion.
- **Security/privacy**: N/A — no user data, no external calls.
- **Persistence/migration**: N/A — no persistent state changes.
- **Cancellation/retry/idempotency**: `WeatherOverlay.destroy()` is idempotent and releases the hierarchy; `resize` rebuilds a pool only when the budget actually changed.
- **Observability**: `WeatherFxDebugSnapshot` is published to `window.__AIKAMI_DEBUG__` at most 4×/second, outside production only. It allocates, so it never runs in the frame budget.

## Migration & Rollback

N/A — no persistent state changes. The change is reversible by reverting the commit; nothing reads the deleted `rendering/weather_overlay.ts` after this branch.

## Scope Boundaries

- **In Scope:**
  - Replacing shader-generated rain with pooled particle batches and a separate haze pass.
  - Separating the FX clock from simulation time, with a frozen phase for captures.
  - Decoupling the atmosphere pass from the environment UBO.
  - Interior scene gating.
  - Elapsed-time weather easing, deterministic seeding, and manual/dynamic mode in the worker.
  - Rewriting the `environment` visual suite with objective gates.
  - A profiling lane with measured frame cost and draw-call topology.
- **Out of Scope:**
  - Per-roof occlusion (the gate is whole-scene).
  - Snow, fog and sandstorm profiles (only the atmosphere pass is shared).
  - Any change to the environment UBO layout or the worker's weather scalar semantics.
  - The map sandbox's own `assetStore.fetchManifest()` call (left as-is).

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** not split. The seven new units are one coherent layer with a single entry point; splitting them across contracts would separate the rain from the clock that animates it and from the gate that hides it.

## Acceptance Criteria

### AC-1: Rain renders as wind-slanted streaks at two depths
**Given** a storm (rain 1.0, wind 0.7) on a 1280×720 viewport
**When** the weather FX is drawn
**Then** two particle batches are visible, every streak is a thin elongated quad sharing one slant, and the foreground layer's mean streak length is at least twice the background layer's.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Visual + unit | `apps/e2e/src/visual/suites/environment.visual.ts`, `weather_fx_renderer.test.ts` | `/dev/sandbox/environment` | Suite passes 4/4 (Storm 90/100); `nearMeanScaleY / farMeanScaleY = 3.24` asserted ≥ 2 |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`, `bun moon run e2e:typecheck`
- Integration: `bun run src/visual/runner.ts --suite=environment` in `apps/e2e`
- E2E / Visual:
  - **Functional**: N/A — the weather layer has no interactive behaviour to drive.
  - **Visual**: `suites/environment.visual.ts`, four declarative cases (Clear, Light rain, Storm, Midnight clear) on `/dev/sandbox/environment`, each with a TypeBox schema over the renderer's `WeatherFxDebugSnapshot` plus a VLM prompt. Storm scores ≥ 85 on shape and readability; the two properties a vision model cannot measure reliably (depth separation, haze strength) are gated numerically in the case's setup hook instead.

**Watch Points**:
- The near/far length ratio is asserted from `farMeanScaleY`/`nearMeanScaleY`, not from the image — a VLM scored the *same* storm capture 60 and 90 on consecutive runs.
- The visual suite requires the boot-seed manifest to load before `loadContentPack`; without `awaitRegistryReady()` the route 404s and never renders a scene.

### AC-2: Weather animation is independent of frame rate and time scale
**Given** the sandbox time scale is changed, or the frame rate drops from 144 fps to 60 fps
**When** weather eases toward a new target
**Then** the weather reaches the same value after the same elapsed wall-clock time, and the rain's fall speed is unchanged.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `environment_weather.test.ts` | `WeatherFxController` (driven by `GameWorld`) | 60/10/144 fps produce the same one-second easing; FX clock is real delta, not `gameTimeSeconds` |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: `environment_weather.test.ts` drives the worker's weather tick at three frame rates and compares the eased value.
- E2E / Visual: N/A — timing behaviour, not a visual property.

**Watch Points**: the FX clock clamps a delta to `MAX_FX_DELTA_MS` (100 ms); without the clamp, a tab resume would teleport every drop.

### AC-3: The same weather state reproduces the same frame
**Given** a fixed weather state and a frozen FX clock
**When** the same scene is captured twice, on separate runs
**Then** both captures are byte-identical.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Visual + unit | `environment.visual.ts`, `weather_fx_renderer.test.ts` | `/dev/sandbox/environment?screenshot=true` | Rain cases byte-identical across 5 consecutive capture runs (storm hash `ffab0f37ea` × 5); worker policy test proves the same tick sequence reproduces exactly |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: `bun run src/visual/runner.ts --suite=environment --capture-only` repeatedly, then compare `sha256sum` of `test-results/visual/environment_*.png`.
- E2E / Visual:
  - **Functional**: N/A.
  - **Visual**: determinism is asserted by the repeat-capture comparison above; the VLM's role is shape/readability only.

**Watch Points**:
- `Math.random()` anywhere in the weather path breaks this — the worker policy test would fail, which is why it asserts reproducibility rather than just plausibility.
- **Scope of the guarantee: the weather cases only.** A two-run comparison is under-powered evidence for a bimodal capture — it agrees by chance ~68 % of the time. Five runs are required to separate a stable capture from a two-state one. Doing that surfaced a **pre-existing, non-weather** nondeterminism in the no-precipitation (Clear) case, documented under Edge Cases.
- The storm capture is stable across runs even though it draws 571 particles, because every drop's position is analytic — no integration, no accumulation.

### AC-4: Clear weather and interiors issue no weather draw calls
**Given** rain intensity 0, or an interior scene with any intensity
**When** a frame is drawn
**Then** the weather root is hidden and the renderer walks past the entire hierarchy.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `weather_fx_profiling.test.ts`, `weather_fx_renderer.test.ts` | `WeatherFxController` (driven by `GameWorld`) | Topology census: clear → 0 draw calls, storm → 3 (2 batches + 1 haze), interior → 0 |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: the topology census walks the `weather-fx` root's labels rather than duck-typing, so a new always-visible child would fail the count.
- E2E / Visual: N/A — draw-call accounting, not a pixel property.

**Watch Points**: the gate must apply on the *same* frame the scene changes, not one frame later — a one-frame delay shows a flash of outdoor rain indoors.

### AC-5: The weather layer stays inside the frame budget
**Given** a storm at 720p and at 1080p
**When** 6000 frames are timed in blocks
**Then** the mean per-frame CPU cost is under the stated budget, and per-drop cost does not grow with drop count.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit (profiling) | `weather_fx_profiling.test.ts` | `WeatherFxController` (driven by `GameWorld`) | 720p storm 6.4 µs / 571 drops; 1080p storm 15.7 µs / 1286 drops; per-drop 0.0112 µs vs 0.0122 µs |

**Test Hooks**:
- Moon Task: `bun moon run frontend-engine:test`
- Integration: `weather_fx_profiling.test.ts` prints the numbers and asserts the budgets; a 5000-frame run asserts the pool neither grows nor reallocates.
- E2E / Visual: N/A — CPU cost is not observable through a screenshot.

**Watch Points**: the budgets are loose (~10× measured) on purpose, because this lane runs on shared CI hardware. A tight threshold would flake instead of informing; the linearity and pool-stability assertions are what catch a real regression.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: `weather_fx_config.ts`, `weather_fx_math.ts`, `rain_texture.ts` — the pure layer and its constants, unit-tested without PixiJS.
2. **Phase 2 (Integration)**: `rain_renderer.ts`, `atmosphere_overlay.ts`, `weather_overlay.ts`, `weather_fx_controller.ts`; delete the old shader overlay; wire the controller into `game_world.ts`; add manual mode, seeded drift and elapsed-time easing to the worker.
3. **Phase 3 (Validation)**: `bun moon run frontend-engine:test`, `bun moon run frontend-engine:typecheck`, `bun moon run client:typecheck`, `bun moon run e2e:typecheck`, `bun moon run scripts:guard`, then the `environment` visual suite.

## Edge Cases & Gotchas

- **`TextureSource` alone never reaches the GPU.** `uploadMethodId` stays `'unknown'` and every particle renders fully transparent with no error. Only `BufferImageSource` sets `'buffer'`. This cost the most debugging time and is now guarded by a regression assertion on `uploadMethodId`.
- **`ParticleContainer` without `boundsArea` reports empty bounds** and is culled as invisible.
- **Wrap margin must clear the largest tilted streak**, or a recycling drop pops into view at the edge. Asserted against the profile's maximum length and slant.
- **Negative wind** must wrap correctly in both axes.
- **A resize that changes the drop budget discards the pool** rather than growing it, because every particle's parameters are positional.
- **The headless visual lane falls back to PixiJS's Canvas2D renderer** when WebGL is unavailable, which silently drops both `ParticleContainer` and custom-shader output. Probe scripts must launch the repo's Chromium (`getChromiumPath()`), not Playwright's bundled build, or the scene appears to have no weather at all.
- **The dev sandbox races the boot-seed manifest.** Without `awaitRegistryReady()` the route 404s on the pack manifest and never renders.
- **A two-run capture comparison is not evidence of determinism.** The Clear (no-precipitation) case toggles between exactly two images across runs; two consecutive runs agree by chance ~68 % of the time, which is how this was initially missed. Five runs are needed.
- **Known pre-existing gap, not addressed here: the screenshot ambient tint is sampled from whichever worker UBO arrives first.** `game_world.ts` pins `uTint` on the first frame in screenshot mode, but the worker's diurnal ambient has already advanced by a variable amount when that frame lands, so the pinned tint differs slightly between runs. Measured effect on the Clear case: a **global ~0.2 % mean-channel shift** (R 0.36318 vs 0.363839, G 0.446456 vs 0.445117, B 0.24431 vs 0.245152) with a difference spread over ~99 % of the canvas — not a structural change, and far too small to move a VLM score, but it does bust the runner's image-hash cache key. The fix is to pin the tint to a fixed value in screenshot mode rather than to the first observed UBO. Left out of scope deliberately: it is the tilemap/lighting path, and a speculative change to a shared render path is worse than a documented gap.
- **A frozen FX clock does not imply a frozen *entity* animation.** `AnimationController` only latches to the idle frame after `IDLE_GRACE_MS` of continuous standstill, so a sprite that stopped just before a capture renders mid-walk. This is *not* the cause of the Clear-case toggle above (an attempt to freeze it changed nothing, and the difference was later shown to be a global tint shift), but it is a real latent nondeterminism for any case that captures a recently-moving entity.

## Open Questions

- Should the layer honour `prefers-reduced-motion` by suppressing rain entirely, or by slowing it? Deferred — the sandbox is a dev route and the production route has no reduced-motion policy yet.
- Should the haze noise frequency be resolution-relative rather than fixed in CSS pixels? Currently fixed, so the pattern is finer at 1080p. Intentional for now, not tuned per-resolution.
- Should the screenshot ambient tint be pinned to a fixed value instead of the first observed worker UBO? Yes — that would make the no-precipitation case byte-reproducible too. Deferred as a separate tilemap/lighting change (see Edge Cases).

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-17 | Initial contract | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

`sandbox` — validated through the dev sandbox route and the visual suite. Not yet exercised through a production gameplay journey.

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
