---
id: C-523
title: "Emberwatch asset pilot and offline integration"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: in_progress
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/363"
  pr_number: 363
created_at: "2026-09-13T00:00:00Z"
---

# Contract C-523: Emberwatch asset pilot and offline integration

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../reference/asset-generation-review-2026-09.md) |
| **Target** | `content/packs/emberwatch`; `scripts/src/lib/ops/generate_emberwatch_maps.ts` + `generate_emberwatch_props_atlas.ts`; `packages/shared/schemas` + `packages/shared/types` (audio cue bindings); `apps/frontend/client/src/lib/services/audio/` + `apps/frontend/client/src/routes/studio/assets/`; `apps/frontend/hub/src/routes/(public)/studio/assets/`; `apps/backend/image/scripts/generate_batch.ts`; `apps/e2e/src/visual/suites/` + `apps/e2e/tests/client/` |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-510, C-511 (`implemented` — the generation architecture this extends); C-517 (`implemented` — request/format correctness); C-518–C-521 (`implemented` — provenance, durable jobs, image and audio preparation); C-512 (`implemented` — recovered Studio/registry write seam); C-514, C-515 (`verified` — action budgets and terrain-cost semantics that must be preserved); C-522 (`implemented` — Hub runner parity evidence); C-524 (`draft`, optional — hosted challenger only, never a gate for any AC); C-513 (`implemented` — publication only, outside this contract's merge scope) |
| **Status** | in_progress |
| **Promotion** | — |
| **Docs Impact** | User-facing: `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` (Emberwatch pilot run), `guides/creating-assets.mdx` and `guides/content-pack-authoring.mdx` (the authored audio cue binding section). Update in the same PR — a new authored pack field with no documented reader is a docs regression. |
| **Contract version** | 1.0.0 |
| **Production Surface** | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` |

Allocated as C-523 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-522; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/reference/asset-generation-review-2026-09.md`.

### Status reconciliation (2026-09-16)

The headline status was `implemented`, which the body never supported: its own
AC-1–AC-7 table records AC-1/AC-2/AC-3/AC-5 as **partial**, AC-4 as **pending**
and AC-6 as **not delivered**, and the "Remaining blockers" section says the
asset-pilot half "remains open and is recorded as blocked, not closed". A code
round that lands the reader, resolver and lock semantics does not close a
contract whose asset-pilot ACs still need creator acceptance, a GPU run and
five-map visual judgement.

The status is therefore **downgraded to `in_progress`**. Nothing here is
relabelled `verified`, and no release is claimed verified while the evidence in
"Remaining blockers" is missing. Re-verified 2026-09-16 against the same tree:
the three slice candidates are still `awaiting_review`, the `well` frame
collision and `prop_alpha` pass-through are still open, and the local music
profile mismatch is still unresolved.

### Addendum (2026-09-17) — release-path repairs landed, ACs still open

PR #368 landed the *correctness* half of the release-path repair: the installed
pack lock a consumer verifies audio against is now the one pinned by the
selected release graph (never the mutable `index/v1/pack_lock.json` alias, which
is read only on the explicitly pointer-less legacy path), a failed catalog
refresh keeps the previously verified catalog, and the ending choice is a real
final player decision rather than an evidence-driven auto-selection. See
`docs/reference/emberwatch-release-repair-2026-09.md` §2.7 for the detail and §4
for the executed evidence.

**None of that closes this contract's ACs.** AC-1/AC-2/AC-3/AC-5 remain
*partial* — the three slice candidates are still `awaiting_review`, no generated
asset has been accepted, and the five-map native-zoom review and listening
evidence are still missing. AC-4 (offline install/revision retention) remains
*pending*: the persistent multi-revision install store does not exist, and the
store's transactional semantics are in-memory only. AC-6 remains *not
delivered*. The status stays **`in_progress`**, and Emberwatch is **not**
released.

## Problem & Baseline Evidence

Emberwatch 4.2.0 has five structurally rebuilt maps, ten LPC NPCs and staged story improvements, but not a complete art-directed scene pass or generation-to-offline-game proof. Generic audio lookup does not bind specific map/ending cues. The terrain atlas already fills its 128 cells.

**Observed at HEAD (source-reviewed 2026-09-13, re-check before editing):**

- `content/packs/emberwatch/manifest.json` (4.2.0) has **no `audio` key at all** — top-level keys stop at `factions`. There is nothing to bind cues to yet.
- `apps/frontend/client/src/lib/services/audio/audio_asset_resolver.ts` matches tracks by manifest **tags with first-match-wins** (`findEntryByTags`), and `scene_to_music_tags.ts` emits only generic vectors (`exploration` / `combat`). A specific village/shrine/ending cue cannot be expressed.
- The terrain grid atlas is a fixed 16×8 grid (128 cells) with per-cell edge extrusion — zero headroom (see the header of `scripts/src/lib/ops/generate_emberwatch_props_atlas.ts`).
- `packages/shared/schemas/src/lib/catalog/release_lock.ts` (`InstalledPackLockSchema`) pins **`imageHash` + `definitionHash` only** and its `PackLockedAssetSchema` is `additionalProperties: false`, so audio cannot be hash-pinned without an explicit, read-compatible schema change.
- `apps/e2e/src/visual/suites/emberwatch.visual.ts` currently captures the **village only** (5 cases, all `route: '/game'`), not the five-map journey AC-2 requires.
- The pack manifest schema (`ContentPackManifestSchema` in `packages/shared/schemas/src/lib/game/content_pack.ts`) is **not strict at the top level** — an authored `audio` field would be silently accepted and silently ignored until a reader exists. Land the reader first.

**Reproduction:** `bun moon run client:test` and `bun moon run schemas:test` cover the current audio resolver and pack schema; `bun run --cwd apps/backend/image generate:batch --manifest docs/plans/emberwatch_asset_brief.json --plan --phase slice` prints the slice plan (exit 2, blockers listed) without generating anything. There is no command today that binds a cue to a map or ending.

Inspect the source in the reuse map at current HEAD before implementation. Baseline is source-reviewed, not freshly test-executed. Run the related existing project tests before editing; do not copy old contract execution reports as current evidence.

## User Outcome

Emberwatch proves the whole production pipeline with readable native-scale assets, intentional music/sound, correct map bindings and offline play.

## Success Measures

- Every mandatory AC below has execution evidence on its named production/tooling path.
- Generation stays asynchronous; no model/GPU/network/sign-in dependency is added to game boot, play or saves.
- Generation latency is measured on named hardware, not inferred from vendor marketing. Cache/accepted outputs are reused without regeneration.

## Existing System & Reuse Map

| Existing source | Action |
|---|---|
| `docs/plans/emberwatch_rebuild.md` | retain accepted direction and identity constraints |
| `docs/plans/emberwatch_asset_brief.json` + `docs/plans/emberwatch_asset_brief.schema.json` | the authored production brief this contract executes; never overwrite `content/packs/emberwatch/manifest.json` with it |
| `packages/shared/schemas/src/lib/generation/asset_brief.ts` | **reuse the implemented TypeBox brief (C-519)** — do not re-derive or duplicate the JSON Schema |
| `packages/shared/schemas/src/lib/media/audio_rendition.ts` (`AudioRendition`, `AudioRenditionBundle`) | reuse as the cue target shape; add pack cue bindings *around* it, not a second audio record |
| `packages/shared/schemas/src/lib/catalog/release_lock.ts` (`InstalledPackLockSchema`) | extend read-compatibly (optional audio pins) so offline installs can hash-verify audio |
| `content/packs/emberwatch/manifest.json` | current pack baseline; gains the optional, versioned audio binding section |
| `scripts/src/lib/ops/generate_emberwatch_maps.ts` | reuse deterministic map construction |
| `scripts/src/lib/ops/generate_emberwatch_props_atlas.ts` + `scripts/src/lib/ops/prop_atlas_packer.ts` | reuse irregular prop atlas + packer |
| `apps/backend/image/scripts/generate_batch.ts` (`generate:batch`, C-519) | reuse the durable batch runner and brief execution; add no second scheduler |
| `apps/frontend/client/src/lib/services/assets/generated_asset_registration.ts` + `registry_asset_resolver.ts` + `packages/frontend/storage/src/lib/assets_generated.ts` | reuse the registry write/read seam so freshly accepted rows enter resolution after reload |
| `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts` | reuse the manifest-backed asset store as the resolution source |
| `apps/frontend/client/src/lib/services/audio/audio_asset_resolver.ts` | extend cue selection through existing playback (replace first-match-wins for *authored* cues only) |
| `apps/frontend/client/src/lib/services/audio/audio_service.svelte.ts` + `music_player_service.svelte.ts` + `track_registry_service.svelte.ts` | extend: one arbitration authority, separate music/ambient/SFX buses, preserve mute/volume |
| `apps/frontend/client/src/lib/services/agent/agents/music_dj_agent.ts` | the existing DJ counterpart the arbitration authority must serialize against |
| `apps/frontend/client/src/routes/studio/assets/` and `apps/frontend/hub/src/routes/(public)/studio/assets/` | reuse both Studio front doors; add only audio-binding review where needed |
| `apps/e2e/src/visual/suites/emberwatch.visual.ts` | expand evidence across five maps (currently village-only) |
| `apps/e2e/tests/client/` | add the functional five-map/offline journey specs |

## Overview

Emberwatch proves the whole production pipeline with readable native-scale assets, intentional music/sound, correct map bindings and offline play. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/reference/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Use the authored AssetBrief at `docs/plans/emberwatch_asset_brief.json` (JSON Schema `docs/plans/emberwatch_asset_brief.schema.json`; **already implemented in TypeBox as `AssetBriefSchema` at `packages/shared/schemas/src/lib/generation/asset_brief.ts`, C-519** — consume that, do not re-derive it). The brief declares `requiresRunnerContract: C-519`, `hostedBudgetUsd: 0`, `candidateLimitPerItem: 2`, `gpuConcurrency: 1`. Resolve references and lock hashes from actual current accepted sources. Existing approved grass/earth/gravel/water, oak/birch/inn/shop/shrine art and LPC compositions are reuse-first; import available original supplied art before generating replacements. Never substitute hidden local paths as portable sources.
- Run phase slice first. At most two candidates per item, GPU concurrency one and hosted spend zero by default. Review exact accepted hashes before expansion. Record failures and cleanup time; do not mark a model successful because it returned bytes.
- Improve village framing around the ward tree, irregular woodland/stream edge, market and clear entrances. Old-road bridge/trail routes must both reconnect; shrine arch pillars block while its central passage remains walkable. Keep current map sizes unless an evidenced gameplay defect requires change.
- Preserve semantic map/NPC/prop/item/quest IDs, Tiled source identity mappings, reciprocal transitions, named spawns and collision/navigation. Preserve C-514/C-515 action budgets and terrain-cost semantics. Generated visuals never define passability or story truth.
- Use existing LPC animation for all ten NPCs. Portraits must visually agree with each named appearance; a missing accepted reference blocks that job. Keep wardrobe/face consistency across expressions and gameplay portraits. Experimental sheets remain separate until all actual action/direction conventions pass.
- Add explicit versioned pack audio cue bindings to supported shared schemas and loaders **before authoring fields** — `ContentPackManifestSchema` is not strict at the top level, so a field with no reader is silently ignored rather than rejected. Extend `InstalledPackLockSchema` read-compatibly with optional audio pins (the existing `PackLockedAssetSchema` is `additionalProperties: false`). Resolve music by map/context/cue ID and exact installed tag/hash; do not use first-array-match for authored cues (that stays the behavior for *unauthored* generic tracks only). Connect to existing audio service/music player with one arbitration authority so the DJ (`music_dj_agent.ts`) and map cues do not start competing tracks. Freshly accepted generated rows must enter the resolver/track index after save and reload.
- Use deterministic priority: explicit scripted cue > authoritative combat state > current map ambience/music; preserve user mute/volume and restore exploration after combat. Separate music from ambient/SFX buses. Cue miss returns silence or a declared fallback, not unrelated random content. User activation is required before audible browser playback.
- Ending tree variants and stingers bind only to authoritative persisted ending flags after story correctness verifies them. Do not add an automatic ending choice or rewrite quest logic as a side effect. If the story still has placeholder branches, broken evidence/readables/pickups, repeated rewards or unreachable conclusions, report them as release blockers and retain ending bindings as pending.
- Generate supported source scenes → validated aikami.scene → compiled runtime; prove native parity before converting legacy scenes. Never put unsupported art/audio/generation fields in ContentPackManifest or the runtime scene.
- Compile hashes/index/credits/pack version lock with the established pipeline. Keep old pack revision available for pinned saves; no silent global tag shadowing. Pack assets must be installed and hash-verified before offline use — **including audio**, which needs the optional lock pins named above. New media is not fetched/generated on movement, dialogue, combat or boot.

## State & Data Models

Versioned pack AudioCueBindings reference catalog AssetRefs and actual supported state predicates. Asset brief logical IDs map explicitly to runtime IDs and accepted hashes in a generated binding lock. Generation records remain authoring metadata, not embedded raw prompts in public packs.

Proposed shapes (names are proposals; implement strictly in TypeBox under `packages/shared/schemas/` with `Static`-derived types re-exported from `packages/shared/types/`, per the TypeBox Static Inference Law):

```typescript
// packages/shared/schemas/src/lib/media/audio_cue_binding.ts — new
type AudioCueTarget = 'music' | 'ambient' | 'sfx';

type PackAudioCueBinding = {
  /** Authored cue identity — stable across repacks. */
  cueId: string;
  target: AudioCueTarget;
  /** Map id, or 'combat' / a scripted predicate id. */
  context: string;
  /** Registry tag of the accepted rendition (not a first-match tag). */
  tag: string;
  /** SHA-256 of the installed rendition bytes; the cue-miss check. */
  sha256: string;
  /** 'required' cues must resolve or the pack fails validation. */
  resolution: 'required' | 'optional';
  /** Declared behavior when the cue cannot resolve — never random content. */
  fallback: 'silence' | 'declared_cue';
  fallbackCueId: string | undefined;
};

type PackAudioBindings = {
  schemaVersion: 'pack.audio.v1';
  bindings: PackAudioCueBinding[];
};

// packages/shared/schemas/src/lib/catalog/release_lock.ts — extend, read-compatible
type PackLockedAudioAsset = { id: string; renditionHash: string };
// InstalledPackLock gains: audioAssets?: PackLockedAudioAsset[]
// (optional → a lock written before this contract still validates)
```

Deterministic arbitration priority (one authority, not per-caller): explicit scripted cue > authoritative combat state > current map ambience/music. Ending variants/stingers bind only to persisted ending flags.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior. Audio review targets come from the brief's `audioDirection` (`music -18 LUFS-I ±2`, `ambience -24 LUFS-I ±3`, peak ≤ -1 dBTP, 5 loop repeats) — project choices to measure against, not vendor claims.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** see Migration & Rollback — optional audio bindings, optional lock pins, immutable accepted hashes.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Persistent state changes: the pack manifest gains an optional audio binding section, and `InstalledPackLockSchema` gains optional audio pins.

- **Old data compatibility:** `audio` is optional and absent from the shipped 4.2.0 manifest — old packs load unchanged. `audioAssets` on `InstalledPackLock` is optional, so a lock written before this contract still validates and still pins its image/definition hashes. `PackLockedAssetSchema` stays `additionalProperties: false`; audio pins are a separate optional array, not extra keys.
- **Migration:** schema first, then reader/loader, then authored fields, then assets. Bump the pack version when the binding section is first authored; regenerate `asset_hashes.json` / index / credits through the existing pipeline. No in-place rewrite of an installed revision.
- **Rollback:** select the previous pack revision and disable the new cue bindings (they are optional and inert without the `pack.audio.v1` section). Generated candidates that were never accepted are staging-only and can be discarded without touching installed bytes.
- **Feature flag or kill switch:** the audio binding reader is inert when the manifest has no `audio` section — that absence is itself the kill switch, with no redeploy needed to fall back to the current tag-first resolver.
- **Failure recovery:** a migration that fails mid-way leaves the previous revision installed (the release pointer advances only after every object is confirmed); `resolution: 'required'` cues that cannot resolve fail pack validation loudly rather than silently playing unrelated content.

Public publication stays in C-513 and is outside this contract's merge scope.

## Scope Boundaries

**In Scope:**

- The Emberwatch asset pilot: resolve the authored brief, run the slice, review and accept hashes, then the bounded expansion.
- The five-map art pass (village/inn/merchant_shop/old_road/ruined_shrine) with composition fixes around the ward tree, entrances, market, old-road bridge/trail and shrine arch.
- Explicit versioned pack audio cue bindings: shared schemas, loaders, resolver selection by declared identity/hash, one arbitration authority, music/ambient/SFX bus separation, and optional audio pins in `InstalledPackLock`.
- Offline integration proof: five-map traversal, combat, save/reload with no network, and old-pack pinned-save compatibility.
- The benchmark report and the honest release-blocker report.

**Out of Scope:**

- Quest-engine rewrites. Story correctness is a dependency for ending release, not permission to change story logic.
- A new region compiler, a second scheduler/runner, or a full LPC replacement.
- Community publication and public blob delivery (C-513).
- Hosted provider comparison as a gate (C-524, `draft`; optional only).
- Terrain-atlas capacity expansion: the 128-cell grid stays as-is unless an evidenced gameplay defect requires a change (which would be its own contract).

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Slice completes end to end

**Given** the authored brief resolved against current accepted sources and either an eligible local model or a recorded typed unavailability, **when** generate, prepare, review, accept and install the slice, **then** each selected asset has exact hashes/lineage/QA evidence and visibly renders or audibly plays in the real Emberwatch client at `/game` (or at client/Hub `/studio/assets` for the review step); no asset is marked successful merely because bytes were returned.

### AC-2: Map readability and geometry

**Given** accepted assets installed on all five maps, **when** walk every entrance/transition and behind/in front of trees and buildings, **then** no inaccessible door, false collision, stretched furniture, missing frame, cropped landmark or identity drift; transition reciprocity and spawn/collision invariants hold mechanically, and native-zoom screenshots for each of the five maps support the visual review. The village-only coverage in `emberwatch.visual.ts` is expanded, not reused as five-map evidence.

### AC-3: Authored audio reaches play

**Given** explicit map/combat bindings (versioned, hash-pinned) and freshly generated registry rows, **when** enter village/inn/old-road/ruined-shrine, start and end combat, and reload, **then** expected cues resolve by declared identity/hash rather than first-array-match, music/ambient/SFX buses do not compete, the DJ and map cues do not start competing tracks (one arbitration authority), volume/mute persists across reload, and a cue miss follows the declared fallback (silence or a declared cue) instead of unrelated content. Tracks with no authored binding keep today's tag-first behavior.

### AC-4: Story states are authoritative

**Given** verified saved ending fixtures **or** a recorded unresolved story blocker for `fading_ward`, **when** load or swap ending state, **then** either (a) only the correct ending variant/stinger plays for the authoritative persisted flag, with no inferred truth and no automatic ending choice; or (b) the ending bindings stay `pending`, the specific unresolved routes are named in the release report, and no asset or audio work is presented as closing that gap.

### AC-5: Offline and old-save compatibility

**Given** the new pack preinstalled, an old-pack pinned save, and network blocked, **when** fresh boot, traverse five maps, interact, fight, save and reload, **then** accepted art **and audio** resolve locally and hash-verify against the installed pack lock; the old save stays on its supported pack revision; a manifest without an `audio` section and an `InstalledPackLock` without `audioAssets` still load and validate; and there is no generator/Hub dependency or silent tag replacement.

### AC-6: Benchmark selects useful outputs

**Given** slice plus bounded expansion results and at least one eligible challenger where available, **when** compare accepted outputs at 1x, in motion and through headphones, **then** the report states cost per accepted asset, wall time, cleanup time and rejection causes. Where a challenger is unavailable (C-524 is `draft`; hosted spend defaults to zero), the report records the typed unavailability — no fabricated metrics, no invented provider results.

### AC-7: Release is honest

**Given** all asset work and any remaining story issues, **when** prepare the PR execution report, **then** every mandatory AC names its concrete artifact path, unrun tests are marked unverified, and `release_verified` is withheld if story, game or audio gates fail.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | live batch run + production game smoke | `generate:batch` stdout/run record with candidate hashes + acceptance lineage + a `/game` or `/studio/assets` capture of the installed asset | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/game`; client + Hub `/studio/assets` | Unverified — populate during execution |
| AC-2 | engine integration + five-map E2E/visual | Transition-reciprocity/collision assertion output + native-zoom screenshots for all five maps (visual suite cases) | client `/game` (five-map traversal) | Unverified — populate during execution |
| AC-3 | client E2E + audible review | Cue-resolution log showing identity/hash (not first-match) + bus/arbitration transcript + five-repeat listening notes | client `/game`; client + Hub `/studio/assets` audio review | Unverified — populate during execution |
| AC-4 | story-state integration + release report | Saved-ending fixture run **or** the named `fading_ward` blocker with bindings recorded `pending` | client `/game` ending load/swap | Unverified — populate during execution |
| AC-5 | offline release journey | Offline session log (no runner/Hub requests) + old-lock/old-manifest validation output | client `/game` offline pack playback | Unverified — populate during execution |
| AC-6 | machine report + reviewer decisions | Benchmark report (wall time, cleanup, cost per accepted asset, rejection causes) + reviewer notes | tooling: `bun run --cwd apps/backend/image generate:batch`; client `/studio/assets` review | Unverified — populate during execution |
| AC-7 | reviewable release evidence bundle | Execution report mapping each AC to its artifact path, with unverified items labelled | docs: PR execution report | Unverified — populate during execution |

**Test Hooks**

- **Baseline/targeted (Moon project IDs, from `.moon/workspace.yml`):** `bun moon run schemas:test` (cue-binding + lock schemas), `bun moon run local-ai:test` (brief/plan core), `bun moon run frontend-storage:test` (registry write seam), `bun moon run client:test` (audio resolver/arbitration), `bun moon run hub:test` (Hub `/studio/assets`), `bun moon run scripts:test` (map/atlas generators), `bun moon run image:test` (batch runner). Run only the touched ones, and never report output you did not execute.
- **Functional E2E:** Playwright in `apps/e2e/tests/client/` (or `apps/e2e/tests/hub/` for Hub parity), exercising the production paths above. Use compiled Svelte tests for reactivity/lifecycle.
- **Visual:** `apps/e2e/src/visual/suites/` with the current `defineConfig` + `export default` and TypeBox case conventions; expand `emberwatch.visual.ts` from village-only to all five maps. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- **Audio:** when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- **Final gates:** `bun moon run :validate`, `bun moon run scripts:guard`, `bun moon run docs:build` (the Docs Impact row is part of the deliverable), and the touched-project tests. If a required tool/model is unavailable, name the exact missing gate; do not mark verified/completed.

**Watch Points**

- **AC-1:** an accepted hash without a rendered/played capture is not evidence. A typed "model unavailable" is a valid outcome; a fabricated success is not.
- **AC-2:** changing map extents to fit generated art is out of scope — the brief's `preserve.mapExtents` is a lock, and the 128-cell terrain grid has no headroom.
- **AC-3:** the pack manifest is not strict at the top level, so an unauthored-against `audio` field is silently ignored — land the reader before authoring. Never let a cue miss fall through to unrelated random content.
- **AC-4:** do not let map entry or an LLM select an ending. Pending is the correct state until story correctness is verified by its owner.
- **AC-5:** audio needs its own lock pins (`audioAssets`) because `PackLockedAssetSchema` pins image/definition hashes only.
- **AC-6:** C-524 is `draft` — an absent hosted challenger is a recorded unavailability, never an invented benchmark row.
- **AC-7:** `release_verified` is withheld while the Fading Ward story gates are open; visual/audio success cannot certify story correctness.

## Implementation Sequence

1. **Phase 1 — schema/loader seam (data first).** Add the versioned `PackAudioBindings` schema under `packages/shared/schemas` with `Static`-derived types in `packages/shared/types`; extend `InstalledPackLockSchema` with optional `audioAssets`; teach the pack loader/validator to read the optional section. Do this before authoring any pack field or generating any asset.
2. **Phase 2 — brief resolution and slice.** Resolve/validate the authored brief against current accepted sources, resolve required references or record blockers, then run the slice and review it in-game before any expansion.
3. **Phase 3 — expansion, preparation and bindings.** Prepare/pack the remaining accepted assets, author the explicit cue bindings, wire resolver selection by declared identity/hash and the single arbitration authority, and confirm freshly accepted rows enter the resolver/track index after save and reload.
4. **Phase 4 — verification.** Five-map navigation, audio state transitions, old-save and offline paths, plus the five-map visual/audible evidence.
5. **Phase 5 — report.** Publish the benchmark and release-blocker report; leave public publication to C-513.

## Edge Cases & Gotchas

- **Story vs. asset success:** audio/visual success cannot certify the unresolved Fading Ward story routes. Record that distinction in release status; ending bindings stay `pending` until the story owner verifies them.
- **Silent schema acceptance:** `ContentPackManifestSchema` is not strict at the top level, so authoring an `audio` section without a reader produces no error and no effect. Schema → reader → authored field, in that order.
- **Lock coverage gap:** `PackLockedAssetSchema` is `additionalProperties: false` and pins image/definition hashes only. Audio hash-verification requires a new optional array, and old locks must keep validating.
- **Terrain headroom:** the grid atlas is a fixed 128 cells. A new terrain is a capacity change (its own contract), not a painter tweak.
- **First-match regression:** authored cues must stop using `findEntryByTags` first-match semantics; unauthored generic tracks keep them. Do not "fix" this by removing tag-based discovery.
- **DJ collision:** the Music DJ agent and map cues both drive playback today. Without one arbitration authority they will start competing tracks; a passing unit test on either path alone will not catch it.
- **Cue miss:** must resolve to silence or a declared fallback cue — never unrelated random content, and never a silent 404.
- **Generation must stay off the boot path:** no model/GPU/network/sign-in dependency may enter boot, play or save.

## Open Questions

No conceptual choice is required to begin the scoped implementation. The following are **execution preflight facts**, not design questions — record them in the execution report and use the declared unavailable/fallback behavior rather than inventing access or silently expanding scope:

- Which local image model and audio model are actually eligible on the executing hardware (the brief pins `hostedBudgetUsd: 0` and `providerFallbackPolicy: 'explicit_only'`).
- Whether the ACE-Step v1.5 adapter/profile upgrade and its hardware needs are in reach, or the shipped ACE-Step v1 remains the audio path.
- Model/license eligibility for any gated weights or hosted challenger (C-524 is `draft`; absence of a challenger is an expected outcome).
- Actual measured performance on named hardware — never inferred from vendor marketing.
- Whether `fading_ward` story correctness lands inside this contract's window. If not, ending bindings remain `pending` and the blocker is named (see AC-4).

Record any new material design question before changing the contract.

## Amendments

This is a newly proposed draft; existing contract approval/amendment rules still apply. Do not self-assign user approval or upgrade status based on this document's presence.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-13 | Initial proposed scope | Pending contract adoption |

> Critic pass (pre-adoption, still 1.0.0): the Evidence Matrix was made AC-specific, ACs gained named production paths and explicit assumptions, the reuse map was extended to the seams that already exist at HEAD (`asset_brief.ts`, `audio_rendition.ts`, `release_lock.ts`, the registry write seam, the DJ agent), and Migration & Rollback was expanded to the template's five bullets. No scope was added; status remains `draft` pending adoption.

## Promotion Lifecycle

See docs/contracts/SHARED_SECTIONS.md. An implemented code path without required production, visual or audio evidence is not release_verified.

## Status Lifecycle

See docs/contracts/SHARED_SECTIONS.md. Preserve accurate draft/implemented/verified/completed distinctions.

## Execution Report

### Scope of this round

This round repairs the existing PR (`ed43017952af9c38183273f04a88f43a9ec152bc`)
against the astra source review and the CodeRabbit inline findings. It is a
code/verification round: it does **not** claim creator acceptance, publication or
a GPU generation run. Every number below was produced by a command in this
worktree; nothing is copied from the prior report.

The review found the implementation had landed the *shape* of C-523 but left
production defects in cue selection, lock verification, arbitration and the
offline journey. Those are fixed and regression-tested. The asset-pilot half
(candidate acceptance, `prop_alpha`/well-atlas repair, five-map visual
judgement, benchmark) remains open and is recorded as blocked, not closed.

### Defect → fix → regression evidence

| # | Defect (source-reviewed) | Fix | Regression evidence |
|---|---|---|---|
| 1 | `parsePackAudioBindings` validated structure but skipped `checkPackAudioBindings`, so an incoherent section parsed as valid. | `parsePackAudioBindings` now returns the section only when structural **and** semantic validation pass; `inspectPackAudioBindings` reports absent vs invalid. | `audio_cue_binding_reader.test.ts` "rejects a structurally valid section whose semantics are broken", "reports semantic issues with their codes" |
| 2 | `resolveAuthoredCue` returned `authored: true` for `kind: 'unbound'`, so a pack that authored *some* contexts suppressed generic music in others. | `unbound` now returns `authored: false`; only a real binding/silence is authored. | `audio_cue_binding_reader.test.ts` unbound cases; resolver branch in `authored_audio_cue_source.ts` |
| 3 | Selection checked tag existence only — a tag present with wrong bytes still played. | `selectAudioCue` verifies the installed rendition's SHA-256 against `binding.sha256`; a mismatched primary is a miss (`miss: 'hash-mismatch'`) that runs the declared fallback, which is verified independently. | `audio_cue_binding_reader.test.ts` "an installed tag with the wrong bytes is a miss", "a wrong-hash primary runs its declared fallback", "a fallback whose own hash is wrong is not substituted" |
| 4 | A URL-resolution failure returned silence without attempting the declared fallback. | `resolveAuthoredCue` walks the bounded declared-fallback chain, resolving each candidate independently; URL failure and lock refusal both advance the chain. | `authored_audio_cue_source.ts` fallback chain (unit-covered by selection tests) |
| 5 | A failure in any required cue silenced an unrelated selected cue (pack-wide `verification.ok` refusal). | Lock verification is scoped to the selected cue via `verification.failedCueIds.includes(cueId)`. | `installed_pack_lock.test.ts` per-cue `failedCueIds`; resolver scope |
| 6 | Semantic validation allowed cross-target fallbacks and unbounded cycles. | `checkPackAudioBindings` rejects `audio.fallback-target-mismatch` and `audio.fallback-cycle`; self-reference message now requires a different `cueId`. | `audio_cue_binding.test.ts` cross-target, cycle and self-reference-message cases |
| 7 | `verifyInstalledAudioAgainstLock`/consumer filtered only hash-mismatch + missing-bytes and treated every absent `audioAssets` as nothing-to-verify. | A lock without `audioAssets` is legacy (pass); a lock **with** pins uses `result.ok`, so a required missing-pin fails too. `failedCueIds` names every contradiction for scoping. | `installed_pack_lock.test.ts` "a required cue with no lock pin fails a new audio-enabled lock", "a lock without audioAssets is legacy" |
| 8 | Failed lock reads were memoized forever; a transient failure became permanent "no verification". | Failed reads are evicted from `_lockCache` so a later request retries; only validated locks are retained. | `installed_pack_lock.test.ts` "a failed lock read is evicted so a later request retries" |
| 9 | `buildPackLock` copied `row.hash` without comparing `binding.sha256`, silently pinning a contradictory value. | A published hash that disagrees with the binding throws a typed `PackLockBuildError` (`audio-hash-mismatch`) and rejects lock generation. | `pack_lock.test.ts` "rejects lock generation when a published hash disagrees" |
| 10 | Image pins matched by basename suffix only, so another pack's same-named atlas could be pinned. | `rowForImageUrl` prefers the canonical URL-derived tag and throws `ambiguous-image-pin` on an ambiguous suffix match. | `pack_lock.test.ts` canonical-tag and ambiguous-basename cases |
| 11 | `requestAudioCue`/`_submitCue` incremented `_bgmRequestId`, letting a DJ request cancel in-flight authored resolution. | Resolution ordering (`_bgmRequestId`) and admitted-playback ordering (`_playbackId`) are separate tokens; a rejected request claims no playback token. | `audio_cue_arbiter.test.ts`; resolver structure |
| 12 | The arbiter rejected all null URLs, so declared silence was not silence. | Explicit stop requests (`intent: 'stop'` / authored null) are admitted as `stop: true` at their priority and hold authored authority; a plain unauthored null stays a no-op miss. | `audio_cue_arbiter.test.ts` declared-silence block (5 cases) |
| 13 | Same-URL handling ran before priority, letting a lower band take ownership. | Priority is applied first; same-URL dedup only runs at equal priority. | `audio_cue_arbiter.test.ts` "a same-url request at a lower priority is still rejected" |
| 14 | Equal-priority/higher-preemption branches erased the suspended map cue. | `suspended` is a stack; preemption pushes, equal-priority admission preserves, release pops the most recent (so `map → combat → scripted` restores in order). | `audio_cue_arbiter.test.ts` repeated-combat and scripted-chain cases |
| 15 | Same-URL generic repeat of an authored cue was silently absorbed. | Rejected as `rejected-authored-cue` (state unchanged, ownership explicit). | `audio_cue_arbiter.test.ts` "an authored cue already on is not downgraded" |
| 16 | Returning from combat could `released-empty` and return without resolving exploration music. | `playSceneBgm('explore')` falls through to resolve the current map when nothing was suspended. | `audio_asset_resolver.ts` release branch |
| 17 | No teardown reset: a disposed session could leave a stale authority. | `resetAudioCueAuthority()` clears state/context and invalidates both tokens; called from `game_boot_service.teardown()`. | `game_boot_service` teardown path |
| 18 | DJ `pause` called `stopAll()` (killing SFX and any authored cue). | Routed through the authority as an unauthored stop; explicit user controls are unchanged. | `music_dj_agent.ts` |
| 19 | Authored `ambient`/`sfx` targets existed in the schema but no runtime caller reached them. | `resolveAmbientUrl` and `playSfxByName` now consult the authored binding first (when a pack context is active) and fall back to tag-first; the SFX bus is `audioService.playSfx`. | `audio_asset_resolver.ts`; unbound packs unchanged (Emberwatch authors no ambient/sfx cues) |
| 20 | The offline E2E allowed *every* `http://localhost` origin and converted map-resolution failure into `test.skip`. | The route allows only the app origin and the configured asset origin; the `test.skip` branch is removed so a failure fails the test. | `emberwatch_journey.spec.ts` |
| 21 | `MapGeometrySchema`/`MapLandmarkSchema` lived in the e2e visual suite with duplicated geometry fields. | Moved to `packages/shared/schemas` (`lib/visual/map_visual_review.ts`), composed via `mergeSchemas`/`Composite`; the suite imports them. | `e2e:typecheck`; shared schema export |
| 22 | Filesystem/audio-byte integrity test lived in the runtime-neutral shared schema suite and treated every missing artifact as a published bed. | Moved to `scripts/src/lib/catalog/__tests__/emberwatch_audio_pins.test.ts` with an explicit published-bed allowlist; any other missing artifact fails. | `scripts:test` |
| 23 | `content/packs/index.json` and `asset_hashes.json` had drifted from the 4.4.0 manifest. | Reconciled the index entry and the manifest pin. | `scripts:test` pack-index reconciliation (was 2 failing, now passing) |

### AC-1–AC-7 evidence

| AC | Status | Evidence produced this round | Remaining blocker |
|---|---|---|---|
| AC-1 Slice end to end | ⚠️ partial | Cue-binding schema + loader + resolver now validated and tested. No generation executed in this environment. | Creator acceptance of the three `awaiting_review` candidates (autoAccept is a hard `false`); `well` `prop_alpha` pass-through; well/atlas frame collision. Typed unavailability, not a code gap. |
| AC-2 Map readability/geometry | ⚠️ partial | Five-map schema split to shared, suite imports it; E2E map-load path unchanged. No new captures run. | Visual half uncertified (VLM run not executed here); nine `mapReadable`/score failures from the prior run stand. |
| AC-3 Authored audio reaches play | ⚠️ partial | Selection by exact tag+hash, bounded declared fallback, per-cue lock scoping, explicit silence, one arbitration authority, priority before dedup, suspended-stack restoration, ambient/SFX authored routing. | Five-repeat listening notes remain unperformed (headless lane, no audio device). |
| AC-4 Story authoritative | ⚠️ pending (branch b) | Ending bindings remain `pending`; no ending variant/stinger authored; no quest logic touched; `fading_ward` named. | `fading_ward` story correctness is unverified — owner dependency, not a code gap. |
| AC-5 Offline & old-save | ⚠️ partial | Lock verification scoped and legacy-aware, and its installed-hash set now includes freshly accepted device-registry rows (not boot-seed rows only); failed reads retry; producer hash disagreements rejected; E2E skip removed and allowlist tightened; index/asset-hash drift reconciled. | No cold offline run in this environment; the lock is still fetched from the origin during cue resolution rather than persisted per installed revision (see below); no old-pack pinned-save fixture; no negative corrupt-byte/unavailable-lock E2E case. |
| AC-6 Benchmark | ❌ not delivered | Constraints re-verified from the brief (`hostedBudgetUsd: 0`, `candidateLimitPerItem: 2`, `gpuConcurrency: 1`, `autoAccept: false`, `autoPublish: false`, `providerFallbackPolicy: explicit_only`). | No accepted outputs and no challenger (C-524 `draft`). Cost per accepted asset is unavailable, not zero. |
| AC-7 Honest release | ✅ | This report; every command below was executed. | `release_verified` withheld. |

### Commands executed (this worktree, atop `ed43017`)

- `bun moon run schemas:test` — **868 pass / 0 fail** (54 files).
- `bun moon run client:test` — **3565 pass / 7 skip / 2 todo / 0 fail** (274 files).
- `bun moon run scripts:test` — **1241 pass / 0 fail** (85 files; includes the moved audio-pin integrity test and the reconciled pack index).
- `bun moon run scripts:guard` — **pass** (source-file-size, type-safety, mvvm, orphaned-capability).
- `bun moon run docs:build` — **pass** (38 pages).
- `bun moon run client:lint`, `client:format`, `schemas:format`, `scripts:format`, `e2e:format` — **pass**.
- `bun moon run client:typecheck`, `scripts:typecheck`, `e2e:typecheck` — **pass**.
- `bun moon run :validate` — **pass** (172 tasks; format/lint/typecheck across
  every project).

Not executed in this environment (must not be reported as passing): Playwright
client E2E, the Emberwatch visual/VLM suite, and any `generate:batch` run.
Both require dev servers / a VLM credential / local model hardware that this
lane does not have.

### Remaining blockers after independent work

1. **Creator acceptance (AC-1, AC-6).** `autoAccept` is a hard schema `false`;
   the only acceptance path is the Studio save, which is a creator decision.
   The three slice candidates remain `awaiting_review`.
2. **`prop_alpha` and the well/atlas collision.** `well`'s preparation still
   passes bytes through without keying alpha, and the props-atlas frame
   collision blocks `well` only. Not repaired here (needs the atlas/identity
   decision the contract leaves open).
3. **Installed-lock persistence per revision (AC-5).** The consumer still
   fetches `index/v1/pack_lock.json` from `PUBLIC_ASSETS_BASE_URL` and keys the
   memo by origin, not by the installed manifest/release revision. The eviction
   and legacy-vs-partial distinction are fixed, but a fully offline,
   revision-pinned local lock is not implemented. This is the largest remaining
   AC-5 gap and is reported as such.
4. **Audio provenance.** The five committed renditions have measured loudness
   (`-18 LUFS-I` band, within peak) but their generation run/profile is not
   recorded here, and their earlier provenance cannot be reconstructed from
   source. Labelled a precise gap rather than invented.
5. **Audio profile mismatch.** The brief's `local_music` names
   `ace_step_15_2b_turbo_profile` while the review reported installed
   ace-step-v1-3.5b weights and an unreachable engine; no eligible local audio
   model was resolved in this environment.
6. **Visual and audible acceptance.** Five-map native-scale review and
   five-repeat listening are unreviewed here.
7. **`fading_ward` story correctness** is unverified; ending bindings stay
   `pending`.

### Honest status

**C-523 is not fully implemented or verified.** The authored-audio and
lock-verification code paths are implemented, repaired and unit-regression
tested; the offline journey and asset-pilot halves still carry the blockers
above. `release_verified` is withheld. No acceptance criterion, size guard or
threshold was lowered to certify the existing implementation; the two
source-file-size exceptions added this round carry exact limits, rationales,
owners and review dates.
