---
description: "PR 4: shared playback, resource ownership and faithful asset previews"
---
Implement visual asset foundation **PR 4 / C-496 increment B**.

Read repository-root files:
- `docs/plans/visual_asset_foundation.md` — common execution protocol.
- `docs/contracts/C-496-shared-visual-assets-and-playback.md` — AC-5–AC-7 and increment A compatibility.
- C-505's merged scene-adapter handoff and evidence.

Require approved scope and merged PR 3. Use an isolated worktree; do not regenerate specifications or launch the full pipeline.

## Deliver

- Shared elapsed-time frame selection, actor-level fallback and supported tint semantics across game/client/Hub previews.
- Persistent render objects, revision-safe atomic swaps, retryable loads and explicit shared-texture ownership. No steady-frame sprite/texture/container reconstruction.
- Faithful actor/prop/tileset previews and reuse of the C-505 real map preview; common inspection controls without another parser/animation implementation.
- Remove superseded host-specific frame/timing interpretations only after equivalent supported behavior is demonstrated. Keep LPC as an adapter, not the universal character shape.

Test variable frame schedules, omitted roles, paired passes, rapid equipment changes, stale loads, disposal, shared sources, preview remount and offline reload. Use compiled Svelte tests for reactivity. Assert identities/frames/allocations as well as visuals. Isolation must not add hidden fallback body layers.

Target 45–70 paths; reassess at 75, stop at 85. No biome generator, new shader suite, unrelated game-world rewrite or new gameplay equipment semantics.

Run affected validation, production/preview journeys and visual evidence. Recheck increment A, then report all C-496 ACs. Only complete evidence permits `implemented`; an independent verifier handles `verified`. No commit/push/PR/deploy/publication without authorization. Request `/assets-verify 4` before PR review.
