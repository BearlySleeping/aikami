---
description: "PR 2: shared visual format, import adapters and consistent publication"
---
Implement visual asset foundation **PR 2 / C-496 increment A only**.

Read repository-root files:
- `docs/plans/visual_asset_foundation.md` — common execution protocol is binding.
- `docs/contracts/C-496-shared-visual-assets-and-playback.md` — especially increment boundaries and AC-1–AC-4.

Require approved specifications and merged PR 1. Record the base revision and baseline. Use an isolated worktree; do not launch the contract pipeline or modify unrelated work.

## Deliver

- Validated common visual primitives with stable IDs/revisions, explicit frame rectangles, trim/origin data, clips/timing/fallbacks and bounded supported color modes.
- Legacy LPC and atlas adapters, preserving real compatibility and paired render passes; do not infer arbitrary body fit from filenames.
- A working `/game` scene containing an LPC character, generic animated atlas character and prop using the new boundary. This is not a schema-only PR.
- Revision-consistent publication with failure injection, retained old release and offline installed-asset loading. Test locally; do not republish R2.

V1 color support is unchanged RGBA plus explicit tint; do not implement speculative dye shaders or claim that tint is palette replacement. Validate reference cycles, bounds, unsupported modes and missing assets. Keep legacy clients/hosts functioning through adapters until increment B.

Target 40–65 paths; reassess at 75, stop at 85. Do not implement canonical maps, biome generation, a new equipment system or wholesale preview replacement here.

Run required affected validation and real-game tests/visual evidence. Append AC-1–AC-4 evidence and the concrete schema/API handoff for PR 3. Leave C-496 `in_progress`: AC-5–AC-7 are still outstanding. No commit/push/PR/deploy/publication without authorization. Request `/assets-verify 2` before PR review.
