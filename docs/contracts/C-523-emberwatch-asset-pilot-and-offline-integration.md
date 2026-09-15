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
  pr_url: null
created_at: "2026-09-13T00:00:00Z"
---

# Contract C-523: Emberwatch asset pilot and offline integration

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../research/asset-generation-review-2026-09.md) |
| **Target** | `content/packs/emberwatch`; `scripts/src/lib/ops/generate_emberwatch_maps.ts` + `generate_emberwatch_props_atlas.ts`; `packages/shared/schemas` + `packages/shared/types` (audio cue bindings); `apps/frontend/client/src/lib/services/audio/` + `apps/frontend/client/src/routes/studio/assets/`; `apps/frontend/hub/src/routes/(public)/studio/assets/`; `apps/backend/image/scripts/generate_batch.ts`; `apps/e2e/src/visual/suites/` + `apps/e2e/tests/client/` |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-510, C-511 (`implemented` — the generation architecture this extends); C-517 (`implemented` — request/format correctness); C-518–C-521 (`implemented` — provenance, durable jobs, image and audio preparation); C-512 (`implemented` — recovered Studio/registry write seam); C-514, C-515 (`verified` — action budgets and terrain-cost semantics that must be preserved); C-522 (`implemented` — Hub runner parity evidence); C-524 (`draft`, optional — hosted challenger only, never a gate for any AC); C-513 (`implemented` — publication only, outside this contract's merge scope) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | User-facing: `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` (Emberwatch pilot run), `guides/creating-assets.mdx` and `guides/content-pack-authoring.mdx` (the authored audio cue binding section). Update in the same PR — a new authored pack field with no documented reader is a docs regression. |
| **Contract version** | 1.0.0 |
| **Production Surface** | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` |

Allocated as C-523 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-522; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
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

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

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

The schema seam, the cue reader, the single arbitration authority and the offline
lock path are implemented and green, and this round turned the previous report's
two *false* blockers into working evidence.

**Corrections to the previous report.** (1) `/game` was never unable to boot
because the CDN was unreachable — the client is pointed at a *local* asset origin
by the gitignored `apps/frontend/client/.env.emulator.local`
(`PUBLIC_ASSETS_BASE_URL=http://localhost:8788`), and that origin simply was not
running. With it up, `/game` boots, the test seam installs, and the production
`loadMap` path traverses all five maps. (2) Audio renditions **do** exist and are
hash-verifiable: the published seed carries three music renditions whose byte
SHA-256 matches the seed row, and the pack now authors `pack.audio.v1` bindings
against them. The slice-plan blocker was genuine and is reproduced below.

**Added this round:** authored bindings in the Emberwatch manifest; a production
*producer* and *consumer* for the installed pack lock's `audioAssets` pins; the
local asset origin now serves all five maps and the lock; the brief's broken
`approved_style` reference resolved; and three real bugs the new evidence
exposed (a stale map context, an out-of-order cue submission, and a cue
resolution that read the catalog before it had loaded).

### Reproducing the evidence path

```bash
# 1. Build the atlases the local origin serves (gitignored build outputs).
bun scripts/src/lib/ops/generate_emberwatch_atlas.ts
bun scripts/src/lib/ops/generate_emberwatch_props_atlas.ts
# 2. A catalog snapshot for the origin to rewrite.
mkdir -p .local/catalog/production/snapshots/<digest>/remote/seed
curl -o .local/catalog/production/snapshots/<digest>/remote/seed/asset_seed.json \
     https://assets.bearlysleeping.com/seed/asset_seed.json
# 3. Serve the worktree's pack, and leave it running.
bun scripts/src/lib/ops/local_asset_origin.ts --port 8788
# 4. The client already points at it via apps/frontend/client/.env.emulator.local.
```

Run the E2E lane locally with `CI` cleared — `CI=true` makes the Playwright
preflight build and serve the hub through `wrangler dev` on a different port.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ⚠️ | The brief's required-reference defect is **resolved**: `approved_style` now points at the pack's own accepted `content/packs/emberwatch/props/ward_large.png` with its SHA-256, instead of a Markdown anchor. `generate:batch --plan --phase slice` went from **1/6 dispatchable (5 blocked)** to **4/6 dispatchable (2 blocked)**. A real `--run` was attempted and is recorded: the three image jobs dispatched to `flux2_klein_base4b_comfy_profile` and failed `ComfyUI API error (404)` — that pinned profile's workflow is not installed on the local ComfyUI (the docs already mark `flux2-klein-4b-comfyui` opt-in). The two remaining blockers are the genuine `local_sfx → owned_or_appropriately_licensed_recording_import` ones. **No asset was accepted**, so there is no lineage/QA evidence and no install. |
| AC-2 | ⚠️ | Five-map traversal on the production `/game` route **passes** (`emberwatch_journey.spec.ts` AC-2): all five maps load, `currentMapId` follows, the canvas survives every transition, and no missing-frame diagnostics appear. Five AC-2 visual cases are authored with full-canvas captures and `landmarkVisible`/`mapReadable`/`noMissingFramePlaceholders`/`noStretchedFurniture` as hard gates; the runner captures **10/10**, but the local VLM's verdicts are **not usable as evidence** here (see the VLM finding below). Screenshots exist at `.pi/.screenshots/523_<map>.png` and in `apps/e2e/test-results/visual/`. |
| AC-3 | ⚠️ | **Authored bindings now exist** — six `pack.audio.v1` bindings in the manifest, each pinned to a rendition whose byte SHA-256 was verified against the published seed (`bgm_explore` cf423397…, `bgm_combat` 506679f4…, `Chainsmoker` 1ae674e4…). Live proof: loading each of the five maps yields `getActiveAudioCue() = {source:'map', context:<mapId>, authored:true}` — the cue resolves by declared identity, not first-array-match. `emberwatch_journey.spec.ts` AC-3 asserts the village's authored cue, then combat (`source:'combat'`, authored), then the production `COMBAT_ENDED` teardown restoring the suspended village cue. **Missing:** five-repeat listening notes — `PUBLIC_MUTE_AUDIO` is not set, but this lane runs headless with no audio device, so no audible review was performed. |
| AC-4 | ⚠️ | Branch (b), unchanged and correct: ending bindings stay `pending`; no ending variant or stinger is authored; no ending state is inferred; no quest logic is touched. **Named blocker:** `fading_ward` story correctness is unverified by its owner in this window. |
| AC-5 | ⚠️ | The structural gap is closed. `audioAssets` and `verifyInstalledAudioAgainstLock` now have a real producer (`scripts/src/lib/catalog/pack_lock.ts`, invoked by the local asset origin, which publishes `index/v1/pack_lock.json` with six audio pins) and a real consumer (`installed_pack_lock.ts`, which gates authored-cue playback on the pins and refuses only a *contradicted* pin — an old lock with no pins stays inert). `PACK_LOCK_KEY` is a single shared constant in `@aikami/schemas`. The offline journey passes: save → reload with the published CDN cut → all five maps load from local bytes and each becomes the current map → no page errors → the authored cue is still the active one. Old-manifest/old-lock compatibility is proven by unit tests. **Not proven:** byte-level hash verification of the *installed* rendition against a *published* lock (the local origin's lock pins the worktree's own bytes), and the old-pack pinned-save half of the journey. |
| AC-6 | ❌ | No benchmark report: no accepted output exists to measure (AC-1), and no challenger is available (C-524 is `draft`, hosted spend 0). Recorded as a typed unavailability rather than an invented row. |
| AC-7 | ✅ | This report. `release_verified` is withheld. |

### VLM finding (why AC-2's visual verdicts are not evidence here)

The visual runner evaluates through `getVlmConfig()` → `local_ollama`,
`qwen3-vl:8b-thinking-q8_0` on `localhost:11434`. Describing the *same* screenshot
twice produced two mutually contradictory scenes — first "a desert with a rock
spire", then "a winter forest with a skeletal creature and wooden huts" — neither
of which is the pixel-art village that screenshot shows. Passing the same image
through the client with the correct `imageDataUri` field produced a coherent,
consistent description ("green grass, brown dirt blocks, gray stone brick
ground"), which confirms the runner's verdicts are model-side unstable rather
than a capture defect. The five-map gates were therefore **left strict** and are
reported as unverified rather than weakened to pass.

### Bugs the new evidence exposed (all fixed, with tests)

1. **Stale map context.** `MAP_LOADED` fires from inside the world load, before
   `currentMapId` is assigned, so a cue requested there resolved the *previous*
   map's binding — observed live as the village cue staying active after loading
   inn/merchant_shop/old_road/ruined_shrine. The announcement and the cue request
   now happen at the settled point in `loadMap`.
2. **Out-of-order cue submission.** `playSceneBgm` resolves asynchronously (pack
   load, catalog, lock fetch), so a slow lookup for map A could be admitted after
   a fast lookup for map B and move the authority back to A. The request now
   claims its newest-request token *before* any await and bails if superseded.
3. **Cue resolution before the catalog loaded.** The authored path read
   `assetStore.manifest` without awaiting it, so a cold or offline reload could
   see an empty tag set and treat a `required` cue as uninstalled — resolving to
   silence on a device that had the rendition. It now awaits the memoized catalog.

A fourth, smaller fix: the arbiter's `no-change` short-circuit compared URLs
only, so when an authored binding and a generic tag match resolved to the *same*
rendition the record kept the vaguer provenance (and, for two maps sharing a
rendition, the previous map). It now refreshes the record on a more specific
provenance or a changed context, and never downgrades an authored record.

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/media/audio_cue_binding.ts` | `pack.audio.v1` binding + section schemas and the semantic checker TypeBox cannot express. |
| `packages/shared/schemas/src/lib/media/audio_cue_binding.test.ts` | 19 cases: shape, strictness, hash pattern, versioning, every semantic rule. |
| `packages/shared/types/src/lib/media/audio_cue_binding.ts` | `Static`-derived re-exports. |
| `apps/frontend/client/src/lib/services/audio/audio_cue_arbiter.ts` | The single arbitration authority. |
| `apps/frontend/client/src/lib/services/audio/audio_cue_arbiter.test.ts` | 16 cases incl. provenance upgrade, same-rendition map change, DJ-cannot-displace-authored. |
| `apps/frontend/client/src/lib/services/audio/audio_cue_binding_reader.ts` | Pure reader: parse, look up `(target, context)`, select by exact declared tag, follow the declared fallback. |
| `apps/frontend/client/src/lib/services/audio/audio_cue_binding_reader.test.ts` | 15 cases incl. exactness and declared-fallback behaviour. |
| `apps/frontend/client/src/lib/services/audio/authored_audio_cue_source.ts` | Turns a binding's tag into a URL offline, and gates playback on the lock pins. |
| `apps/frontend/client/src/lib/services/assets/installed_pack_lock.ts` | Production consumer: fetch the lock, compare pins against the device's installed hashes. |
| `apps/frontend/client/src/lib/services/assets/installed_pack_lock.test.ts` | 12 cases: match, contradiction, absent bytes, unpinned cue, old lock, absent/malformed lock. |
| `scripts/src/lib/catalog/pack_lock.ts` | Production producer: build the lock's image and audio pins from a pack manifest + published seed. |
| `scripts/src/lib/catalog/pack_lock.test.ts` | 9 cases incl. unpublished-cue omission and override precedence. |
| `apps/e2e/tests/client/emberwatch_journey.spec.ts` | AC-2 traversal, AC-3 authored-cue/combat round-trip, AC-5 save + offline reload. |

### Files Modified

| File | Change |
|---|---|
| `content/packs/emberwatch/manifest.json` | Authored the `pack.audio.v1` section (6 bindings, real seed hashes); version 4.2.0 → 4.3.0. |
| `docs/plans/emberwatch_asset_brief.json` | Resolved `approved_style` to real accepted art + its SHA-256. |
| `packages/shared/schemas/src/lib/catalog/release_lock.ts` | `PackLockedAudioAssetSchema`, optional `audioAssets`, `verifyInstalledAudioAgainstLock`, shared `PACK_LOCK_KEY`. |
| `packages/shared/schemas/src/lib/game/content_pack.ts` | Optional `audio: Type.Optional(PackAudioBindingsSchema)`. |
| `packages/shared/schemas/src/lib/game/pack_validation.ts` | Four `audio.*` codes + the audio-section check. |
| `packages/shared/schemas/src/lib/game/content_pack.test.ts` | Asserts the shipped manifest's authored section is coherent and its headline pins are the real renditions. |
| `apps/frontend/client/src/lib/services/audio/audio_asset_resolver.ts` | Authored-cue-first resolution, cue context setter, sequenced `requestAudioCue`/`playSceneBgm`. |
| `apps/frontend/client/src/lib/services/agent/agents/music_dj_agent.ts` | The DJ enters the shared authority instead of calling `transitionToBgm` directly. |
| `apps/frontend/client/src/lib/services/game/game_engine_service.svelte.ts` | Announces the settled pack/map and requests the scene cue from that point. |
| `apps/frontend/client/src/lib/services/game/bridge_listeners.ts` | `GAME_READY`/`MAP_LOADED` announce the pack/map context. |
| `apps/frontend/client/src/lib/services/game/game_test_seam.ts` | `loadPackMap` (with landmark placement), `getCurrentMapId`, `getActiveAudioCue`. |
| `apps/e2e/src/visual/suites/emberwatch.visual.ts` | Five AC-2 cases with landmark-centred captures, wired into the suite. |
| `scripts/src/lib/ops/local_asset_origin.ts` | All five maps overridden; publishes `index/v1/pack_lock.json`. |
| `apps/frontend/docs/src/content/docs/guides/{content-pack-authoring,creating-assets,generating-assets}.mdx` | Authored-cue bindings, the one-authority priority, the pilot brief, and how to see a local pack change in-game. |
| `scripts/src/lib/ops/guard_source_file_size_{baseline,exceptions}.json` | Two grandfathered entries converted to reviewed exceptions (`content_pack.ts` 1144, `game_engine_service.svelte.ts` 1156) — the guard refuses baseline growth, and the exceptions file is its documented remedy. |

### Deviations from Spec

1. **`verifyInstalledAudioAgainstLock` lives in `@aikami/schemas`**, not the
   client: `guard-orphaned-capability` rejects new exports with no production
   consumer, and lock/pin logic over shared types belongs next to the lock schema.
2. **A lock producer was added** (`pack_lock.ts` + the local origin). The
   contract named the pins and the read-compatibility, but without a writer the
   consumer would have been decorative — which is what the review flagged.
3. **The `audio` section's `resolution` values** are `required` for village and
   combat and `optional` with a `declared_cue` fallback for the three maps that
   reuse another map's rendition. Pack validation cannot see installed bytes, so
   `required` is a declaration; the runtime fallback chain is what a miss follows.
4. **`game_engine_service.svelte.ts` and `content_pack.ts` carry reviewed size
   exceptions.** Both changes are contract-mandated; neither file can shrink
   without deleting explanations.
5. **No Amendment proposed.** Nothing in the ACs was found wrong.
6. **The contract's Test Hooks name `bun moon run scripts:test` and
   `bun moon run image:test`; neither resolves as a moon target.** The batch
   runner's tests pass via its package script, and `scripts:test` runs but is not
   cache-recorded, so its result cannot be read back from the moon cache.

### Test Results

- Unit (schemas): **832 pass / 0 fail** — baseline **789 pass / 0 fail** (51 → 52 files).
- Unit (client): **3494 pass / 0 fail** — baseline **3451 pass / 0 fail** (265 → 268 files).
- Unit (scripts, `pack_lock`): **9 pass / 0 fail** (run via the package script; see deviation 6).
- Guards: **10/10 pass** (`scripts:guard` exit 0). Three initially failed on this
  change — `guard-orphaned-capability`, `guard-source-file-size` (twice) — and each
  was resolved by shrinking the exported surface or converting a baseline entry to
  a reviewed exception, never by widening a ratchet.
- `validate({ test: true })`: **4 passed** across `client, docs, e2e, schemas,
  scripts, types`; `fix`, `typecheck`, `build` and `test` all exit 0.
- E2E (`emberwatch_journey.spec.ts`, `--project=client`, client dev server on the
  worktree checkout, `CI` cleared): **3/3 tests pass, 3 consecutive runs** — AC-2
  five-map traversal, AC-3 authored cue + combat round-trip, AC-5 offline reload.
- Visual (`--suite=emberwatch`): **10/10 captured**, 3 passed / 7 failed on the
  local VLM's verdicts, which are unreliable (see the VLM finding). The five AC-2
  cases and the pre-existing village cases are all affected; the failures are not
  used as pass evidence and the gates were not weakened.
- Baseline regression: **0 new failures.**

### Release Blockers

- **No accepted asset.** The brief's three image items now dispatch, but the
  pinned `flux2_klein_base4b_comfy_profile` workflow is not installed on the local
  ComfyUI (`ComfyUI API error (404)`), and the one audio item
  (`village_music`, `ace_step_15_2b_turbo_profile`) has no model at all — `/models`
  holds image/stt/text/tts and no music directory, and the stack's fetcher reports
  `no model-bearing profiles enabled ((none))`. AC-1's lineage/QA/install evidence
  therefore cannot exist yet.
- **`local_sfx` requires an owned/licensed recording import** for `village_ambient`
  and `gate_open`. That is the contract's documented typed refusal, not a defect.
- **The published catalog seed lags the worktree pack**: it carries three of the
  five maps and the 3.2.0-era manifest. `old_road` and `ruined_shrine` resolve only
  through the local asset origin, so five-map evidence depends on that origin being
  running (and `apps/frontend/client/.env.emulator.local` points at it).
- **The local VLM is unstable** (`qwen3-vl:8b-thinking-q8_0` via Ollama): the same
  image yields contradictory descriptions, so no AC-2 visual gate can be certified
  in this environment.
- **No audible review**: the E2E lane runs headless with no audio device, so AC-3's
  five-repeat listening notes do not exist.
- **`fading_ward` story correctness is unverified** by its owner; ending bindings
  stay `pending`.

**`release_verified` is withheld.**
