---
description: "PR 3: canonical scene JSON and duplicate-safe normalization, without biome generation"
---
Implement visual asset foundation **PR 3 / C-505**.

Read repository-root files:
- `docs/plans/visual_asset_foundation.md` — follow the common execution protocol.
- `docs/contracts/C-505-canonical-scene-data-and-authoring-boundary.md`.
- `docs/architecture/semantic_map_authoring.md` — future syntax is NOT implemented scope.

Require approved C-505 and merged C-496 increment A with evidence. C-496 need not be wholly completed: its increment B follows this batch. Use an isolated worktree; do not launch the full contract pipeline.

## Deliver

- One normalized scene schema and loader boundary for supported Tiled/JTON/native inputs, with deterministic native import/export and stable placement IDs.
- One authoritative terrain/baked-ground source, per-layer/pass uniqueness, bounded decoding and explicit diagnostics. Preserve legitimate shadows, transitions, decals and overhead sharing a coordinate.
- Reuse existing corner16 terrain matching and movement/sight authority. Preserve flip flags, firstgid resolution, spacing/margins, anchors, transitions and saved interactable/loot identity.
- Shared map preview wired to normalized scenes and actual images, plus a converted Emberwatch scene verified in `/game` and offline restoration.

Do not implement region expansion, biome scattering, prefab/house generation, a new corners-and-sides matcher or new elevation gameplay. Unsupported future plan JSON must fail clearly, not silently load as an empty legacy map. Do not introduce a second runtime collision oracle or deduplicate by asset hash alone.

Target 40–65 paths; reassess at 75, stop at 85. Validate all C-505 ACs, including reordered placements, persisted state, intentional overlap, input limits and emission counts. Provide the normalized-scene API handoff to PR 4.

End with truthful AC evidence, commands/exits, captures, resource observations and changed-path count. No commit/push/PR/deploy/publication without authorization. Request `/assets-verify 3` before PR review.
