# Visual asset foundation — remaining verification

The four contracts in this programme are **`implemented`**:

| Contract | Owns | Status |
|---|---|---|
| [C-504](../contracts/C-504-stable-character-appearance-identity.md) | Stable character identity, legacy migration, omitted-role equipment merge | implemented — **AC-5 verification pending** |
| [C-496](../contracts/C-496-shared-visual-assets-and-playback.md) | Shared visual format/adapters, publication, playback, previews, Hub tag identity | implemented |
| [C-505](../contracts/C-505-canonical-scene-data-and-authoring-boundary.md) | Canonical scenes, stable placements, duplicate-ground cleanup, whole-map preview | implemented |
| [C-506](../contracts/C-506-emberwatch-visual-readability.md) | Atlas source alpha/lossless output, grounding, depth, movement boundaries | implemented |

## Remaining work

The only outstanding item is **C-504 AC-5**: the live `/game` journey (real
render, walk, save/reload, offline reload, AI visual capture) and the fresh
`/assets-verify 1` session that records it. The journey
(`apps/e2e/tests/client/npc_identity_persistence.spec.ts`) and visual suite
(`apps/e2e/src/visual/suites/npc_identity.visual.ts`) are delivered, and the
engine hook (`__AIKAMI_DEBUG__.npcAppearance`) is wired; only the recorded
verification evidence is missing. See the C-504 execution report for the exact
gate.

The manual batch prompts that drove this programme remain in
[`.pi/prompts/assets-*.md`](../../.pi/prompts/) because the verify session is
still owed. Once AC-5 is recorded, fold any remaining art-direction decisions
into [`../reference/asset-generation-review-2026-09.md`](../reference/asset-generation-review-2026-09.md)
and delete this plan and those prompts.

## Execution protocol (retained)

Use the standard contract runner/`/assets-*` prompts, one contract at a time,
waiting for each to merge before the next. Start subsequent work from a base
containing its predecessor's merged changes. Aim for 40–65 changed files where
practical; reassess at 75 and stop at 85 for a scope/split decision; every PR
stays below 100. Preserve original data and old asset revisions. Publishing to
R2 requires separate authorization.

The [semantic map authoring design](../architecture/semantic_map_authoring.md)
describes future region/biome/prefab generation. Its JSON example is a proposal,
not an implemented format. The decision remains **foundation now; biome compiler
later**.
