---
description: "PR 5: Emberwatch grounding, depth and readable movement boundaries"
---
Implement visual asset foundation **PR 5 / C-506**.

Read repository-root files:
- `docs/plans/visual_asset_foundation.md` — common execution protocol.
- `docs/contracts/C-506-emberwatch-visual-readability.md`.

Require approved scope and merged PR 4. Use an isolated worktree. Capture the current village, inn and shop at normal gameplay scale before changing presentation.

Improve transparent prop placement over continuous ground, consistent contact shadows, base-origin depth, appropriate upper passes and readable walls/shorelines/thresholds/passages. Reuse existing schemas, render primitives and the authoritative walkability diagnostic. Preserve collision rules and persistent placement IDs.

Do not add new persisted fields, a lighting engine, biome generation, new art-provider integration or wholesale asset replacement. If a public/schema change is necessary, stop for an amendment to the responsible full contract rather than extending this thin brief silently.

Verify all C-506 ACs in the actual `/game` journey through village, inn and shop: front/behind walks, doors/gate, occupied props, day/night and interior ambient, save/reload and repeated transitions. Inspect with the overlay both on and off; normal art must be readable without it. Record human gameplay-scale inspection alongside required visual tests.

Target 30–55 paths; reassess at 75, stop at 85. Finish affected validation and report captures, movement results, resource observations, changed paths and any remaining placeholder art. No commit/push/PR/deploy/R2 publication without authorization. Request `/assets-verify 5` before PR review.
