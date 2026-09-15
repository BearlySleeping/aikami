---
id: C-523
title: "Emberwatch asset pilot and offline integration"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: implemented
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
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | User-facing: `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` (Emberwatch pilot run), `guides/creating-assets.mdx` and `guides/content-pack-authoring.mdx` (the authored audio cue binding section). Update in the same PR — a new authored pack field with no documented reader is a docs regression. |
| **Contract version** | 1.0.0 |
| **Production Surface** | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` |

Allocated as C-523 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-522; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/reference/asset-generation-review-2026-09.md`.
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

### Summary

This round **reviewed and resolved the uncommitted worktree mutation** the previous
verifier flagged, and implemented the AC-2 fix it asked for (two captures per map,
attributed per case rather than in aggregate). The mutation turned out to be
genuine generated audio; it is now durable, measured and verified rather than
scratch-only.

**Post-review merge.** The branch was then merged with `origin/main` (19 commits,
including C-529's theme runtime and C-531's combat affordances) before this PR was
opened, so the PR lands on current main. The only conflict touching this
contract's code was `game_test_seam.ts`'s import block, resolved as the **union** of
both sides (the C-523 `getActiveAudioCue` import plus main's expanded
`combat_encounter_roster` import); both symbols have live call sites and the file
typechecks. The three other conflicts were `manifest.json` (kept this branch's
4.4.0 revision and ACE-Step music credit), `emberwatch_asset_brief.json` (kept this
branch's resolved `approved_style` SHA-256 on top of main's identical locator fix,
and main's `appearance_village_guard` fix merged cleanly) and
`guard_source_file_size_baseline.json` (kept the removal — the entry is a reviewed
exception on this branch). Test, guard and E2E results below were re-run on the
merged tree.

### Worktree integrity: the mutation reviewed, not swept in

The uncommitted change repointed the manifest's audio bindings at five new
renditions that existed **only** in the gitignored `.local/cue-renditions/`. The
verifier's risk was correct: `village.music` and `combat.music` are
`resolution: required`, so on any other checkout those cues had no installed
rendition and would fall back to silence.

Review outcome — the renditions are real and correctly finished, and are now
pack artifacts:

| Rendition | Format | Duration | Integrated | True peak |
|---|---|---|---|---|
| `village_ward.webm` | Opus 48 kHz stereo | 59.9 s | **-18.00 LUFS-I** | -7.04 dBTP |
| `emberwatch_combat.webm` | Opus 48 kHz stereo | 59.9 s | **-18.01 LUFS-I** | -4.95 dBTP |
| `inn_hearth.webm` | Opus 48 kHz stereo | 59.9 s | **-18.00 LUFS-I** | -5.60 dBTP |
| `old_road.webm` | Opus 48 kHz stereo | 59.9 s | **-18.00 LUFS-I** | -7.77 dBTP |
| `ruined_shrine.webm` | Opus 48 kHz stereo | 59.9 s | **-17.99 LUFS-I** | -4.56 dBTP |

Measured with `ffmpeg -af loudnorm=…:print_format=json` (EBU R128). The brief's
`audioDirection` targets `music -18 LUFS-I ±2` and `peak ≤ -1 dBTP`; every
rendition is within ±0.01 LUFS and 3.4 dB under the ceiling.

Changes made to make it durable and safe:

1. **Moved into the pack**: `content/packs/emberwatch/audio/*.webm` (tracked, not
   gitignored) — the same treatment the pack's prop art gets. Byte hashes are
   unchanged, so the pins still match.
2. **`local_asset_origin.ts`** overrides now read from those in-repo paths.
3. **Bindings rewritten** (`pack.audio.v1`, pack version 4.4.0): two
   **published-bed** cues (`bed.explore` → `music:exploration:bgm_explore`,
   `bed.combat` → `music:combat:bgm_combat`) pin renditions the *published* seed
   already carries, and every authored cue now declares
   `fallback: 'declared_cue'` → its bed. A checkout without the new renditions
   therefore plays a real published bed instead of silence — the failure mode the
   verifier named is closed, and the `declared_cue` path now has a production use.
4. **A test asserts the pins against the bytes**: `content_pack.test.ts` reads
   `content/packs/emberwatch/audio/` and requires each binding's `sha256` to equal
   the SHA-256 of the file its tag names. A pin that cannot resolve on a clean
   checkout now fails the suite.
5. **Verified live**: the client fetched all five renditions through the local
   origin during the E2E run (`village_ward` 3×, `inn_hearth` 2×, `old_road` 2×,
   `ruined_shrine` 1×, `emberwatch_combat` 1×), and the pack lock carries eight
   audio pins matching the manifest.

### AC-2: two captures per map, attributed per case

Implemented the fix the previous verdict named. Each of the five maps now has a
**default-spawn** case (the authored composition a player sees on entering — what
"map readability" is about) and a **landmark** case (camera on the prop — the only
framing in which "is the landmark present" is answerable). The landmark question
lives only in the landmark schema and the prompt says explicitly not to penalise a
default-spawn capture for a landmark it was not framed on.

Result: **15/15 captured, 3 passed / 12 failed**, attributed per case:

| Case | Score | Failing fields |
|---|---|---|
| Village — terrain transitions (pre-existing) | 75 | `terrainTransitionsLookNatural` |
| Village — gate arch (pre-existing) | 95 | — |
| Village — NPC body (pre-existing) | 40 | `allNpcsHaveBodies`, `noFloatingHeads`, `npcVisuallyDistinct` |
| Village — midnight (pre-existing) | 95 | — |
| Village — noon baseline (pre-existing) | 95 | — |
| Village — **default spawn** | 40 | `mapReadable` |
| Village — **landmark** | 75 | — (all fields true; below the 80 threshold) |
| Inn — **default spawn** | 40 | — (all fields true; below the 80 threshold) |
| Inn — **landmark** | 40 | `mapReadable`, `landmarkVisible` |
| Shop — **default spawn** | 0 | `mapReadable` |
| Shop — **landmark** | 0 | `mapReadable`, `landmarkVisible` |
| Old road — **default spawn** | 0 | `mapReadable` |
| Old road — **landmark** | 0 | `mapReadable`, `noMissingFramePlaceholders`, `landmarkVisible`, `entrancesLookWalkable` |
| Shrine — **default spawn** | 0 | `mapReadable` |
| Shrine — **landmark** | 0 | `mapReadable`, `landmarkVisible` |

Reading the table rather than the aggregate: the framing fix **works** — the
village landmark case now passes every boolean (only the 80-point threshold is
missed), and the inn default-spawn case likewise. What remains is a consistent
model judgement that these four interiors/outdoor maps do not read as
"intentionally composed" (`mapReadable` false on 9 of 15), plus low scores on
cases whose booleans are all true. That is recorded as an **uncertified visual
half**, not explained away: the mechanical half (five-map traversal, transitions,
spawn/collision, no missing frames) passes in E2E, and the visual half is not
claimed.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ⚠️ | Generate + prepare evidenced (three `awaiting_review` candidates from the declared `sdcpp` fallback, real art, full state history). **Audio renditions now delivered and measured** (table above) and installed as pack artifacts with verified pins. **Not delivered: acceptance/install of a generated candidate.** The previous report's blocker was over-broad and is corrected: the props-atlas duplicate-frame collision blocks **`well` only**. `village_elder_neutral` is a **portrait** — the manifest has no `portraits` key, portraits resolve by tag (`portraits:npc:<npcId>:<expression>`) through the C-512 registry write seam (`registerGeneratedAsset`, which takes a lineage with `status: 'accepted'`, a validation-report hash and `acceptedAt`), and AC-1's Evidence Matrix accepts a `/studio/assets` capture for the review step. **Acceptance is a creator decision this contract cannot self-serve**, so it is recorded below as the explicit typed blocker rather than as open work: `autoAccept` is a hard `Type.Literal(false)` (`packages/shared/schemas/src/lib/generation/asset_brief.ts:42`, brief `autoAccept: false` at `docs/plans/emberwatch_asset_brief.json:21`), and the only acceptance path — the Studio save at `generated_asset_workflow.ts:277` — requires bytes generated in the same session and records `status: 'accepted'` under the comment "the studio save is the creator accepting this candidate for local use". Driving that as an agent would fabricate the review the brief exists to require. **Deviation recorded:** `well`'s preparation is a byte-identical pass-through (`rawHash === preparedHash`) and the staged PNG is RGB with no alpha despite `preparationProfile: prop_alpha` — flagged rather than presented as a prepared prop. |
| AC-2 | ⚠️ | Mechanical half passes (five-map E2E traversal, no missing-frame diagnostics). Visual half: two captures per map implemented, 15/15 captured, per-case attribution above. Framing is now correct; the residual is a consistent `mapReadable`/score judgement on 9 cases. **Uncertified, not claimed.** |
| AC-3 | ⚠️ | Verified live and now against the new renditions: each map resolves `{source:'map', context:<mapId>, authored:true}`, and the client actually fetched all five rendition bytes through the origin. `emberwatch_journey.spec.ts` asserts the authored village cue, the combat cue and the production `COMBAT_ENDED` restore. **Missing:** five-repeat listening notes (headless lane, no audio device) — though the renditions are now measured against the brief's loudness/peak targets. |
| AC-4 | ⚠️ | Branch (b): ending bindings stay `pending`, no ending variant or stinger authored, no inferred ending truth, no quest logic touched, `fading_ward` named. |
| AC-5 | ⚠️ | Producer + consumer verified (the origin serves `index/v1/pack_lock.json` with eight audio pins; the client fetched it during the runs; `installed_pack_lock.ts` gates playback). The offline E2E case passes without taking its skip branch. **Unproven:** byte-level verification against a *published* lock (publication is C-513) and the old-pack pinned-save half. |
| AC-6 | ❌ | No benchmark: nothing accepted yet, no challenger. The five measured renditions are the first real inputs it could use. |
| AC-7 | ✅ | This report. `release_verified` is withheld. |

### Files Created / Modified this round

| File | Change |
|---|---|
| `content/packs/emberwatch/audio/*.webm` (5, new) | The authored cue renditions, as tracked pack artifacts. |
| `content/packs/emberwatch/manifest.json` | Bindings rewritten: 8 cues, published-bed fallbacks, version 4.4.0. |
| `scripts/src/lib/ops/local_asset_origin.ts` | Audio overrides read the in-repo pack paths. |
| `packages/shared/schemas/src/lib/game/content_pack.test.ts` | +2 tests: pins must equal the pack audio bytes; every `declared_cue` fallback must name a declared cue. |
| `apps/frontend/client/src/lib/services/audio/audio_track_catalog.ts` | Fallback track id/path follow the authored combat cue. |
| `apps/e2e/src/visual/suites/emberwatch.visual.ts` | Two captures per map, split geometry/landmark schemas, framing-aware prompt. |
| `docs/contracts/C-523-…md` | This report. |

### Test Results

Re-run on the merged tree (the branch merged `origin/main` before the PR was
opened); every number below was produced after that merge, not carried over from
the pre-merge branch.

- Unit (schemas): **866 pass / 0 fail** across **54 files** — this branch's own
  delta is +2 pin/fallback tests (834 on the pre-merge branch); the count rose
  because the merge brought in main's suites.
- Unit (client): **3548 pass / 0 fail** (274 files, 7 skip, 2 todo).
- Unit (scripts, `pack_lock`): **9 pass / 0 fail**.
- Guards: **10/10 pass** (`scripts:guard` exit 0).
- E2E: `emberwatch_journey.spec.ts --project=client` **4 passed** (3 tests +
  setup, no skips) against the running client dev server and the local asset
  origin — this exercises the merge-resolved `game_test_seam.ts` import block
  directly, since both `getActiveAudioCue` and the roster builder are called by
  the journey cases.
- Visual: **15/15 captured, 3 passed / 12 failed** — reproduced on the merged tree
  and identical in aggregate and in failing field to the per-case table above. One
  score moved (the pre-existing terrain-transitions case read 60 this run vs 75
  before) while its failing field stayed the same; the VLM score is model-side
  variance and is not used as evidence either way. The AC-2 visual half remains
  **uncertified**.
- `validate({ test: true })`: passed across `client, docs, e2e, schemas, scripts,
  types`.
- Baseline regression: **0 new failures.**

### Release Blockers

- **AC-1's acceptance step is a creator decision, not an automatable one — typed
  blocker, with citations.** `docs/plans/emberwatch_asset_brief.json:21` sets
  `autoAccept: false` and `packages/shared/schemas/src/lib/generation/asset_brief.ts:42`
  makes that a hard schema rule (`autoAccept: Type.Literal(false)`), so no runner
  path may accept a candidate. The only acceptance path is the Studio save —
  `apps/frontend/client/src/lib/services/image/generated_asset_workflow.ts:277`
  `save({ tag })`, which refuses unless the bytes were generated in the same
  session (`No generated bytes are pending for "<tag>" — generate before saving`)
  and records `status: 'accepted'` + `acceptedAt` under the comment at lines
  319-320: *"The studio save is the creator accepting this candidate for local
  use — a different decision from approving it for publication."* Performing that
  save as an agent would fabricate the review the brief exists to require, so
  AC-1 stops at **generate + prepare** (`c523-sdcpp-slice`: `village_elder_neutral`,
  `ward_renewed` and `well` all `awaiting_review` with rawHash/preparedHash
  lineage from the declared `sdcpp` fallback) and acceptance/install/render
  evidence is withheld. The contract's own AC-1 watch point applies: *"a typed
  'model unavailable' is a valid outcome; a fabricated success is not."*
- **The prop half of the slice is blocked by the props atlas.** The atlas's
  procedurally painted frames collide with generated prop art, which blocks
  **`well` only**; the portrait path (`village_elder_neutral`) is not affected.
  That collision is a design decision this contract does not settle.
- **`well`'s preparation does not key alpha** despite `prop_alpha` — a real
  preparation gap, recorded rather than hidden.
- **The audio brief pins the wrong profile**: `local_music` lists
  `ace_step_15_2b_turbo_profile` (ace-step-v1.5) while the installed weights are
  ace-step-v1-3.5b; the matching registered `ace_step_v1_3_5b_profile` cannot
  reach the healthy engine on `:8094` (`engine_dispatch_failed: Unable to
  connect`). The five renditions in this round came from outside that path and
  their own generation run is not recorded here.
- **AC-2's visual half is uncertified** — 9 of 15 cases fail `mapReadable`/score.
- **`local_sfx` requires an owned/licensed recording import** for
  `village_ambient` and `gate_open`.
- **No audible review** (headless) and **no published-lock byte verification**
  (publication is C-513).
- **`fading_ward` story correctness is unverified**; ending bindings stay `pending`.

**`release_verified` is withheld.**
