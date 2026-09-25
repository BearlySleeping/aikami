---
id: C-548
title: "Emberwatch release atlas integrity + reproducible local evidence plane"
source: "docs/reference/emberwatch-polish-review-and-plan.md — §9 material fallback; C-545 §D; C-546 §Evidence"
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-23T00:00:00Z"
---

# Contract C-548: Emberwatch release atlas integrity + reproducible local evidence plane

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/reference/emberwatch-polish-review-and-plan.md` — §9 "material fallback"; C-545 §D and C-546 §Evidence (both blocked on the evidence plane) |
| **Target** | `scripts/src/lib/ops/` (atlas coverage, candidate plane, shared build steps, studio), `scripts/src/lib/catalog/` (snapshot alias resolution), `packages/frontend/engine/` (collision-overlay band), `apps/e2e/` (visual-capture guard) |
| **Type** | thin |
| **Priority** | P2 — release safety: a candidate could seal a map drawn from a GID the sealed atlas does not carry; the human visual gate had no reproducible capture path |
| **Dependencies** | C-546 (atlas growth + bridge frames), C-529 (candidate plane), C-378 (terrain channel), C-545 (ambient parity), C-377 (chunk renderer) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → `docs/guides/emberwatch-authoring.md` (studio flags + fresh-worktree sequence); no player-facing page |
| **Contract version** | 2.0.0 |
| **Production Surface** | `tooling: \`bun run emberwatch:studio\`` and `tooling: \`bun run emberwatch:validate\`` (declared tooling); the sealed candidate's terrain atlas is consumed by the production `/game` tilemap path |

## Problem & Baseline Evidence

- **Current behavior**: `emberwatch_candidate.ts` seals the worktree terrain atlas (`terrainAtlasGroup` → `resolveGameDataUrl(manifest.atlas.textureUrl)`), and `buildAndSealCandidate` regenerates it first — but **nothing asserted** that every GID a map paints resolves to a frame the sealed atlas carries. A stale atlas build, or a map committed against a newer frame table, would seal and ship a crossing drawn from `fallbackTile`.
- **Current behavior**: the local rehearsal origin proxied the published terrain atlas unconditionally. C-546 grew the atlas 544×272 → 544×340 (frames 129–145); the published release carries the old 80-frame atlas (`sprites:tilesets:atlas` = `281a011e`) while the C-546 atlas is `34da4a1b`, so a candidate that painted bridge GIDs would render its crossings from the fallback.
- **Current behavior**: `emberwatch_studio.ts` ran a hand-maintained subset of the release build (maps + prop atlas + scan + seed). A fresh worktree failed its first Studio run because portraits, audio and the terrain atlas were never generated.
- **Current behavior**: `catalog:workspace snapshot` threw `Catalog path collision` on the legitimate alias pair `sprites:tilesets:atlas` / `sprites:tilesets:atlas.webp` (release root `0b4c8b02`), so the documented read-only snapshot was unusable and the local origin had no fresh seed.
- **Current behavior (evidence plane)**: captured Emberwatch screenshots showed no terrain. Diagnosis: Playwright's default `chromium_headless_shell` has no WebGL context, so PixiJS fell back to Canvas2D, which silently drops every custom-shader `Mesh` — the whole tilemap. The reported 1×1 `mesh.texture` is PixiJS's `Texture.WHITE` default for custom-shader meshes, not the sampled texture (the bound `uTexture` is 544×340).
- **Reproduction**: `bun run emberwatch:validate`; `bun run --cwd scripts catalog:workspace snapshot --mode production`; a `/game` capture on a non-WebGL browser.
- **Existing implementation to reuse**: `emberwatch_map_validation.ts` (rule pipeline), `emberwatch_candidate_plane.ts` (override set), `emberwatch_release.ts` `buildAndSealCandidate` (build list), `local_asset_origin.ts` (rehearsal origin).
- **Baseline tests**: `scripts:test` (`emberwatch_*`), `frontend-engine:test` (`rendering`, `scene_overlays`), `e2e:test:unit`.

## User Outcome

A developer can run one documented sequence in a fresh worktree — read-only snapshot, Studio, `/game` — and get a candidate whose maps resolve every painted GID against the sealed terrain atlas, with reproducible screenshots that actually show the terrain and the crossings. A candidate whose atlas differs from the published one is served from its own build; an unchanged one is still proxied.

## Scope Boundaries

- **In Scope:** GID → atlas-frame coverage check + validation rules + fixture test; conditional terrain-atlas override in the candidate plane and the local origin; one shared content-build step list for the studio and the release; deterministic snapshot alias resolution + release-snapshot seed lookup; a WebGL guard for visual captures; moving the E2E collision overlay above the tilemap; evidence captures; this contract and the authoring-guide update.
- **Out of Scope:** fixing R2 data; publishing/promoting/deploying; image-model generation; atlas/map art changes; player-facing UI; guard-policy changes; changing the published release.

## Acceptance Criteria

### AC-1: Every painted GID resolves to a frame the sealed atlas carries

**Given** the committed Emberwatch maps and the built terrain atlas
**When** the validation rules run
**Then** each non-collision, non-empty map GID resolves through `localTileId = rawGid - firstgid + 1` to a manifest frame the atlas carries; a GID whose frame the atlas lacks is a `map-gid-frame-missing` blocker and a missing descriptor is an `atlas-not-built` blocker.

**Verification**: `tooling: \`bun moon run scripts:test\`` — `emberwatch_atlas_coverage.test.ts` (fixture map painting a GID past the atlas); `tooling: \`bun run emberwatch:validate\`` (0 blockers on the committed pack).

### AC-2: The local origin serves the candidate's own terrain atlas when it diverges

**Given** a candidate whose local atlas bytes differ from the published seed (or whose published hash is unknown)
**When** the local candidate origin resolves its overrides
**Then** the terrain atlas is both required and served locally; when the bytes match the published seed the atlas stays proxied and is neither required nor overridden.

**Verification**: `tooling: \`bun moon run scripts:test\`` — `emberwatch_candidate_plane.test.ts` (equal / divergent / unknown published-hash cases).

### AC-3: The studio and the release share one content-build step list

**Given** a fresh worktree with only authored sources
**When** `bun run emberwatch:studio` runs
**Then** it executes the same ordered steps the release seal executes (portraits, audio, terrain atlas, prop atlas, maps, scan, seed) and reports a complete candidate plane.

**Verification**: `tooling: \`bun run emberwatch:studio\`` — fresh-worktree sequence in `docs/guides/emberwatch-authoring.md` §6.

### AC-4: Snapshot alias collisions resolve deterministically

**Given** the legacy `sprites:tilesets:atlas` alias and `sprites:tilesets:atlas.webp` mapping to the same working path
**When** `catalog:workspace snapshot` merges the release index and the seed
**Then** identical bytes coalesce silently; divergent bytes resolve to the release-index-referenced tag, then the extension-qualified tag, with both hashes recorded in the snapshot warnings; a pair no rule can separate still fails loudly.

**Verification**: `tooling: \`bun moon run scripts:test\`` — `workspace.test.ts` (equal / divergent / unknown-authority cases).

### AC-5: Reproducible evidence plane

**Given** a fresh release snapshot from the real read-only command and a WebGL-capable browser
**When** a capture runs against the production `/game` route
**Then** the capture refuses a Canvas2D fallback, the terrain renders, and the `?e2e=true` collision overlay is visible above the tilemap.

**Verification**: `tooling: \`bun moon run e2e:test:unit\`` — `gpu_renderer_guard.test.ts`; `tooling: \`bun moon run frontend-engine:test\`` — `layer_bands.test.ts`.

## Edge Cases & Gotchas

- **Atlas unchanged vs divergent**: an unchanged atlas is still proxied, preserving the "accepted published art" intent; the override only engages on a byte difference.
- **Unknown published hash**: an absent/empty snapshot defaults to serving the local atlas (safe default), and the GID check catches a genuinely broken build.
- **Case-only path collisions** are not aliases and still throw.
- **Collision overlay band**: `debugGrid` must stay below `MIN_ENTITY_Y` (entities readable) but above the opaque tilemap bands (visible).
- **`--seal` is a release artifact**: sealing runs the shared build then `emberwatch_candidate.ts --seal`; it is not a production surface and must not rebuild during `--apply`.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---

## Execution Report

### Summary

Closed the release-safety gap with a pure GID → atlas-frame check wired into map validation, and made the candidate plane serve its own terrain atlas when it diverges from the published seed. Unified the studio and release content build into one step list so a fresh worktree builds the same plane the release seals. Made the catalog snapshot resolve a legitimate alias collision deterministically and read a release snapshot's content-addressed seed. Diagnosed the "terrain 1×1" blocker as a Canvas2D capture fallback (not a texture bug) and guarded the visual harness against it; moved the E2E collision overlay above the tilemap so evidence shows it. Captured the C-548 evidence from a fresh release snapshot.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `emberwatch_atlas_coverage.ts` + rules; fixture-map test; validate 0 blockers |
| AC-2 | ✅ | Conditional atlas in `emberwatch_candidate_plane.ts`; 3 published-hash cases |
| AC-3 | ✅ | `emberwatch_build_steps.ts` shared by studio + release |
| AC-4 | ✅ | `mergeWorkspaceEntries` release-index → extension-qualified resolution |
| AC-5 | ✅ | WebGL guard + collision-overlay band; 5 captures show terrain |

### Files Created

| File | Purpose |
|---|---|
| `scripts/src/lib/ops/emberwatch_atlas_coverage.ts` | Pure GID → atlas-frame coverage check |
| `scripts/src/lib/ops/emberwatch_atlas_coverage.test.ts` | Rules + fixture-map + real-pack tests |
| `scripts/src/lib/ops/emberwatch_build_steps.ts` | Shared ordered content-build step list |
| `apps/e2e/src/visual/core/gpu_renderer_guard.ts` | Refuse a non-WebGL capture |
| `apps/e2e/src/services/gpu_renderer_guard.test.ts` | Guard unit tests |
| `packages/frontend/engine/src/rendering/layer_bands.test.ts` | Band-order tests (grid above tilemap) |

### Files Modified

| File | Change |
|---|---|
| `scripts/src/lib/ops/emberwatch_map_validation.ts` | `map-gid-frame-missing` + `atlas-not-built` rules; seed-aware plane check |
| `scripts/src/lib/ops/emberwatch_map_validation_context.ts` | `Manifest.tiles[*].frame` |
| `scripts/src/lib/ops/emberwatch_candidate_plane.ts` | Conditional terrain-atlas override + release-seed lookup |
| `scripts/src/lib/ops/local_asset_origin.ts` | Seed-aware plane check; `findPublishedSeedPath` |
| `scripts/src/lib/ops/emberwatch_release.ts` | Iterate the shared build list |
| `scripts/src/lib/ops/emberwatch_studio.ts` | Run the shared build list; drop dead heuristics |
| `scripts/src/lib/catalog/workspace_remote.ts` | Deterministic alias resolution + warnings |
| `apps/e2e/src/visual/core/capture.ts` | Assert WebGL before every capture |
| `packages/frontend/engine/src/rendering/layer_bands.ts` | Collision overlay above the tilemap |
| `docs/guides/emberwatch-authoring.md` | Studio flags + fresh-worktree sequence |

### Deviations from Spec

The "terrain 1×1 placeholder" turned out not to be an engine texture bug: the captures were made on a Canvas2D fallback. No engine behavioural test was needed for it; the fix is a capture-harness guard plus the collision-overlay band. The conditional-atlas policy and the shared build list were folded into C-548 from the C-546 evidence follow-ups.

### Test Results

- Unit (`scripts:test`, scoped): 62 pass / 0 fail (`emberwatch_*`, `workspace`)
- Unit (`frontend-engine:test`, scoped): 161 pass / 0 fail
- Unit (`e2e:test:unit`): 28 pass / 0 fail
- Guards: 10/10 structural guards pass
- Baseline: 0 pre-existing failures observed in the scoped runs
