---
id: C-523
title: "Emberwatch asset pilot and offline integration"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: draft
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
| **Target** | content/packs/emberwatch; existing map/atlas generators; shared pack schemas; client audio/map bindings; E2E/visual suites |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-518–C-521; recovered C-512; C-522 for Hub parity evidence; C-513 only for optional publication |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.0.0 |
| **Production Surface** | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` |

Allocated as C-523 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-522; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

Emberwatch 4.2.0 has five structurally rebuilt maps, ten LPC NPCs and staged story improvements, but not a complete art-directed scene pass or generation-to-offline-game proof. Generic audio lookup does not bind specific map/ending cues. The terrain atlas already fills its 128 cells.

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
| `content/packs/emberwatch/manifest.json` | current pack baseline |
| `scripts/src/lib/ops/generate_emberwatch_maps.ts` | reuse deterministic map construction |
| `scripts/src/lib/ops/generate_emberwatch_props_atlas.ts` | reuse irregular prop atlas |
| `apps/frontend/client/src/lib/services/audio/` | extend cue selection through existing playback |
| `apps/e2e/src/visual/suites/emberwatch.visual.ts` | expand evidence across five maps |

## Overview

Emberwatch proves the whole production pipeline with readable native-scale assets, intentional music/sound, correct map bindings and offline play. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Use the authored AssetBrief at `docs/plans/emberwatch_asset_brief.json` (schema `docs/plans/emberwatch_asset_brief.schema.json`). Resolve references and lock hashes from actual current accepted sources. Existing approved grass/earth/gravel/water, oak/birch/inn/shop/shrine art and LPC compositions are reuse-first; import available original supplied art before generating replacements. Never substitute hidden local paths as portable sources.
- Run phase slice first. At most two candidates per item, GPU concurrency one and hosted spend zero by default. Review exact accepted hashes before expansion. Record failures and cleanup time; do not mark a model successful because it returned bytes.
- Improve village framing around the ward tree, irregular woodland/stream edge, market and clear entrances. Old-road bridge/trail routes must both reconnect; shrine arch pillars block while its central passage remains walkable. Keep current map sizes unless an evidenced gameplay defect requires change.
- Preserve semantic map/NPC/prop/item/quest IDs, Tiled source identity mappings, reciprocal transitions, named spawns and collision/navigation. Preserve C-514/C-515 action budgets and terrain-cost semantics. Generated visuals never define passability or story truth.
- Use existing LPC animation for all ten NPCs. Portraits must visually agree with each named appearance; a missing accepted reference blocks that job. Keep wardrobe/face consistency across expressions and gameplay portraits. Experimental sheets remain separate until all actual action/direction conventions pass.
- Add explicit versioned pack audio cue bindings to supported shared schemas and loaders before authoring fields. Resolve music by map/context/cue ID and exact installed tag/hash; do not use first-array-match for authored cues. Connect to existing audio service/music player with one arbitration authority so the DJ and map cues do not start competing tracks. Freshly accepted generated rows must enter the resolver/track index after save and reload.
- Use deterministic priority: explicit scripted cue > authoritative combat state > current map ambience/music; preserve user mute/volume and restore exploration after combat. Separate music from ambient/SFX buses. Cue miss returns silence or a declared fallback, not unrelated random content. User activation is required before audible browser playback.
- Ending tree variants and stingers bind only to authoritative persisted ending flags after story correctness verifies them. Do not add an automatic ending choice or rewrite quest logic as a side effect. If the story still has placeholder branches, broken evidence/readables/pickups, repeated rewards or unreachable conclusions, report them as release blockers and retain ending bindings as pending.
- Generate supported source scenes → validated aikami.scene → compiled runtime; prove native parity before converting legacy scenes. Never put unsupported art/audio/generation fields in ContentPackManifest or the runtime scene.
- Compile hashes/index/credits/pack version lock with the established pipeline. Keep old pack revision available for pinned saves; no silent global tag shadowing. Pack assets must be installed and hash-verified before offline use. New media is not fetched/generated on movement, dialogue, combat or boot.

## State & Data Models

Versioned pack AudioCueBindings reference catalog AssetRefs and actual supported state predicates. Asset brief logical IDs map explicitly to runtime IDs and accepted hashes in a generated binding lock. Generation records remain authoring metadata, not embedded raw prompts in public packs.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Use existing pack revision/InstalledPackLock compatibility rules. Add audio bindings optionally so old manifests still load. New accepted assets receive immutable hashes; retain old content until old saves have an explicit supported migration. Rollback selects previous pack revision and disables new cue bindings.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Use existing pack revision/InstalledPackLock compatibility rules. Add audio bindings optionally so old manifests still load. New accepted assets receive immutable hashes; retain old content until old saves have an explicit supported migration. Rollback selects previous pack revision and disables new cue bindings.

## Scope Boundaries

Asset pilot, map art pass, explicit audio bindings and offline integration. Story correctness is a dependency for ending release, not permission for unbounded quest-engine rewrites. No new region compiler or full LPC replacement.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Slice completes end to end

**Given** resolved slice references and eligible local models, **when** generate, prepare, review, accept and install the small slice, **then** each selected asset has exact hashes/lineage/QA evidence and visibly renders or audibly plays in the real Emberwatch client.

### AC-2: Map readability and geometry

**Given** accepted assets installed on all five maps, **when** walk every entrance/transition and behind/in front of trees/buildings, **then** no inaccessible door, false collision, stretched furniture, missing frame, cropped landmark or identity drift; screenshots at native zoom support review.

### AC-3: Authored audio reaches play

**Given** explicit map/combat bindings and generated registry rows, **when** enter village/inn/road/shrine, start/end combat, reload, **then** expected cues resolve by declared identity/hash, buses do not compete, volume/mute persists, missing cues follow declared fallback.

### AC-4: Story states are authoritative

**Given** verified saved ending fixtures or a known unresolved story blocker, **when** load/swap ending state, **then** only the correct ending variant/cue plays; no inferred truth or automatic ending; unresolved bindings remain visibly blocked for release.

### AC-5: Offline and old-save compatibility

**Given** new pack preinstalled, old pack pinned save and network blocked, **when** fresh boot, traverse five maps, interact, fight, save and reload, **then** accepted art/audio resolve locally; old save stays on its supported pack revision; no generator/Hub dependency or silent tag replacement.

### AC-6: Benchmark selects useful outputs

**Given** slice plus bounded expansion results and at least one eligible challenger where available, **when** compare accepted outputs at 1x/in motion/through headphones, **then** report cost per accepted asset, wall time, cleanup time and rejection causes; no fabricated metrics for unavailable providers.

### AC-7: Release is honest

**Given** all asset work and any remaining story issues, **when** prepare PR execution report, **then** mandatory ACs show concrete evidence, unrun tests are unverified, and release_verified is withheld if story/game/audio gates fail.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | live batch + production game smoke | Test/log/media report for this scenario | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` | Unverified — populate during execution |
| AC-2 | engine integration + five-map E2E/visual | Test/log/media report for this scenario | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` | Unverified — populate during execution |
| AC-3 | client E2E + audible review | Test/log/media report for this scenario | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` | Unverified — populate during execution |
| AC-4 | story-state integration + release report | Test/log/media report for this scenario | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` | Unverified — populate during execution |
| AC-5 | offline release journey | Test/log/media report for this scenario | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` | Unverified — populate during execution |
| AC-6 | machine report + reviewer decisions | Test/log/media report for this scenario | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` | Unverified — populate during execution |
| AC-7 | reviewable release evidence bundle | Test/log/media report for this scenario | production Emberwatch game journey plus client/Hub `/studio/assets` and tooling `generate:batch` | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under local-ai, schemas, frontend storage, client, Hub and scripts as applicable. Determine exact Moon project task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Resolve/validate brief and current scene/story contracts.
2. Run slice and in-game review before expansion.
3. Prepare/pack remaining accepted assets and explicit cue bindings.
4. Verify five-map navigation, audio state transitions, old-save and offline paths.
5. Publish benchmark and release blocker report; leave public publication to C-513.

## Edge Cases & Gotchas

Audio/visual success cannot certify the unresolved Fading Ward story routes. Record that distinction in release status.

## Open Questions

No conceptual choice is required to begin the scoped implementation. Hardware, credentials, model/license eligibility and actual measured performance are execution preflight facts. Use the declared unavailable/fallback behavior rather than inventing access or silently expanding scope. Record any new material design question before changing the contract.

## Amendments

This is a newly proposed draft; existing contract approval/amendment rules still apply. Do not self-assign user approval or upgrade status based on this document's presence.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-13 | Initial proposed scope | Pending contract adoption |

## Promotion Lifecycle

See docs/contracts/SHARED_SECTIONS.md. An implemented code path without required production, visual or audio evidence is not release_verified.

## Status Lifecycle

See docs/contracts/SHARED_SECTIONS.md. Preserve accurate draft/implemented/verified/completed distinctions.
