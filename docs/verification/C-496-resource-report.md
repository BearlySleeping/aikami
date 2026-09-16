# C-496 Resource & Regression Report

Contract: C-496 (AC-7) — "Resource usage and regressions are demonstrated".

## Scope

This report documents the steady-playback allocation behavior and regression
baseline for the shared visual-definition playback path introduced by C-496.
It accompanies `resource_regression.test.ts` (engine) which measures the
playback layer directly, and the existing texture-manager cache-reuse coverage
in `rendering.test.ts`.

## Measurement Approach

- **Steady-playback allocation-finiteness**: the pure playback layer
  (`resolveDefinitionFrameAtTime` + `ElapsedTimeActor` + `AnimationController`)
  must not create sprites, textures, or grow unbounded state across frames.
  Measured by running 10s of continuous playback (600 frames) and 10,000
  AnimationController updates and asserting bounded output state.
- **Determinism / cache reuse**: identical elapsed time must resolve to the
  same frame object, so hosts reuse a cached frame view instead of rebuilding
  per frame.
- **No per-frame render-object allocation**: `_applyLpcFrame` maps the
  resolved frame back to a cached spritesheet key (WebGPU-safe UV sub-texture),
  so the hot render path swaps a cached texture reference and allocates no new
  texture/sprite/container per frame.

## Results

| Check | Result |
|---|---|
| 600-frame steady playback resolves bounded frame set (≤9) | ✅ `resource_regression.test.ts` |
| AnimationController state O(1) across 10,000 updates | ✅ `resource_regression.test.ts` |
| Deterministic frame resolution (same elapsed → same frame object) | ✅ `resource_regression.test.ts` |
| Engine full lane (including playback + clock + composer) | ✅ 1128 pass / 2 pre-existing fail |
| Baseline regressions from C-496 changes | ✅ 0 new failures |

## Known Limits / Pending

- Live `/game` and Hub preview **screenshot captures** and a full
  mount/unmount + scene-transition + offline-reload memory trace are not
  produced in this session (no dev-server visual run). The deterministic
  allocation-finiteness and cache-reuse properties above are verified at the
  unit level.
- The two pre-existing engine lane failures (`emberwatch` `atlas.json` absent
  in the worktree) are unrelated to C-496 and present on `main`/`HEAD`.

## Artifacts

- `packages/frontend/engine/src/rendering/resource_regression.test.ts`
- `packages/frontend/engine/src/rendering/animation_controller.test.ts`
- `packages/frontend/engine/src/rendering/visual_definition_playback.test.ts`
- `packages/frontend/engine/src/rendering/component_composer.test.ts`
