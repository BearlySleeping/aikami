---
id: C-381
title: "Content Pipeline Hardening — Provenance, Trust, Versioning, Validation, Boot"
source: "external architecture review (claude CLI) — docs/research/game_engine_architecture_review.md §4 Q6-Q8, §5; generated/community content design discussion"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-11"
---

# Contract C-381: Content Pipeline Hardening — Provenance, Trust, Versioning, Validation, Boot

## Metadata

| Field | Value |
|---|---|
| **Source** | `docs/research/game_engine_architecture_review.md` §4 (Q6, Q7, Q8), §5 (missed findings) + the "what else do we need for generated/community content" design discussion |
| **Target** | `packages/shared/schemas/src/lib/game/content_pack.ts` — provenance + trust constraints; `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` — boot parallelization; `services/assets/` + `packages/frontend/storage/` — lazy registry seeding; `scripts/src/lib/ops/` — manifest slimming; new pack validation service |
| **Priority** | P1 — none of this blocks Emberwatch polish, but every item is **cheap now and impossible-to-retrofit later**. Per-asset licensing in particular cannot be added after community packs exist without deleting them. |
| **Dependencies** | None hard. Runs in parallel with C-377→C-380. Touches `content_pack.ts` which C-378 also touches — sequence the schema edits or expect a merge conflict. |
| **Status** | approved |
| **Promotion** | `integrated` — `/game` boot path + hub upload gate |
| **Docs Impact** | user-facing → content-pack authoring + licensing page in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

Verified against HEAD (`4ea2ccf5`).

### 🔴 A. There is no per-asset provenance, and LPC art is share-alike

`ContentPackManifestSchema` has a pack-level `credits` block of free-text arrays:

```json
"credits": {
  "art": ["Liberated Pixel Cup (LPC) asset contributors"],
  "music": ["Chainsmoker — Exploration Theme"]
}
```

There is **no `license`, `author`, or `source` field on any individual asset** —
grep `content_pack.ts` for `license` returns nothing. (Separate sidecar files
`content/packs/asset_credits.json` and `static/game-data/lpc_credits.json` do
carry per-asset credits, but they are not part of the manifest schema and are
not enforced at load time.) The bundled LPC set is
12,699 files under CC-BY-SA / GPL, which require attribution and are
share-alike. The moment community packs mix LPC-derived art with
AI-generated art, per-asset provenance becomes a legal requirement and an
attribution-screen input.

This is the highest-regret item in the review: retrofitting provenance across
hundreds of community packs is not possible; the only remedy would be deleting
them.

### 🔴 B. A pack can name any URL and the client will fetch it

```ts
// packages/shared/schemas/src/lib/game/content_pack.ts:740
textureUrl: Type.String({ description: 'Tileset texture image URL' }),
spritesheetUrl: Type.Optional(...)
```

Unconstrained strings. `tilemap_render_system.ts:97` passes the map's tileset
`image` path straight to `Assets.load`. A community pack that references a
remote image learns every player's IP on load, and the same field is an
exfiltration channel.

The fix is architecturally free: C-373 already built a content-hash-addressed
asset registry with SHA-256 verification (`services/assets/asset_manager.svelte.ts`).
Packs should resolve assets **through** it by hash, never by arbitrary URL. The
capability exists and is simply not enforced.

### 🔴 C. Saves reference packs with no version pinning

`save_map_block.ts` / `game_save_service.svelte.ts:54` store
`{ packId, mapId, playerX, playerY, spawnId? }`. Nothing records the pack
*version*, and `content-packs/index.json` carries a `version` per pack that is
already inconsistent with the manifests — the index says emberwatch `2.1.0`
while `emberwatch/manifest.json` says `3.2.0`.

A community pack that renames a map or moves a spawn point silently breaks every
save that referenced it. There is no migration path because there is nothing to
migrate *from*.

### 🔴 D. Content validation exists as a CI test, not a runtime service

`packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts` (550
lines) is the right instinct in the wrong place. Generated and community content
is validated **at play time**, not at CI time — and an LLM generation loop needs
structured errors it can repair against, not a failing assertion.

Three consumers need the same validator: the generation loop (feed errors back),
the hub upload gate, and CI.

### 🔴 E. `manifest.json` is 7 MB of derivable data

`static/game-data/manifest.json` is **7.0 MB** with 12,707 entries. Each entry:

```json
"lpc:hat:magic:celestial_moon_adult:backslash": {
  "tag": "lpc:hat:magic:celestial_moon_adult:backslash",
  "category": "lpc",
  "subcategory": "hat/magic",
  "name": "celestial_moon_adult.backslash",
  "path": "lpc/hat/magic/celestial_moon_adult.backslash.webp",
  "ext": ".webp"
}
```

The key **is** the `tag`. `category`, `subcategory`, `name` and `path` are all
mechanical transforms of it. `asset_hashes.json` is a further **1.7 MB** keyed
by the same tags. **8.7 MB fetched at boot to serve ~8 non-LPC assets and a
character's six LPC layers.**

### 🔴 F. The boot pipeline serializes independent work

`game_boot_service.svelte.ts` runs 9 stages, each fully awaited, 30s timeout
each (`STAGE_TIMEOUT_MS`). `_stageInitializeAssetRegistry` (`:613-746`) is
explicitly **non-fatal** — it catches everything and degrades to online mode
(`:742-745`) — yet it blocks the five stages after it while it:

1. opens a WASM database
2. fetches the 7 MB manifest
3. fetches the 1.7 MB hash sidecar
4. seeds **12,707 rows** into SQLite in 26 chunked transactions
5. adds Firebase Storage sources for every asset
6. initializes the cache backend and reconciles

A stage that is allowed to fail silently should not gate the map appearing.
`_stagePreloadContent` and `_stageCreateEngine` are also independent of each
other until `loadMap`.

Registry seeding is also eager: all 12,699 LPC rows are inserted regardless of
whether the player's character uses six of them.

### 🟡 G. Smaller items in the same area

- **`whispering-caves` is unreachable.** Listed in `content-packs/index.json`, referenced only by tests. `game_canvas_view_model.svelte.ts:135` hardcodes `contentPackId: 'emberwatch'` even though `game_composition_root.svelte.ts:252` correctly resolves it from the active campaign. A campaign started on `whispering-caves` boots Emberwatch.
- **Two save systems.** `game_save_service` (Turso, v3 envelope — the real one) and `packages/frontend/services/src/lib/services/game_state_sync.svelte.ts` (Firebase Storage blob + DataConnect `SaveSlot`), the latter used only by `views/dev/save_load`.
- **`FirebaseSqlConnectSync` is a stub.** It logs `_subscribeToLiveQuery:not-implemented` and `connect:stub-mode` during the test run. C-195's registry sync does not exist.
- **No seeded determinism.** The site copy promises "a world generated, not scripted"; there is no seeded PRNG threaded through generation and no seed in the save envelope, so a generated world cannot be reproduced, shared, or bug-reported.
- **`docs/decisions/` contains only a README.** There are no ADRs; rationale lives in per-change contracts, which is why questions like "why JPS?" had no written answer to check before reversing.

### Baseline tests

- `moon run engine:test` — 910 pass / 0 fail
- `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts`
- `apps/frontend/client/src/lib/services/assets/asset_manager.test.ts`, `game_save_service.test.ts`, `campaign_service.test.ts`, `pack_registry_service.test.ts`
- `apps/e2e/src/visual/suites/game_boot.visual.ts`

## User Outcome

After this contract, a **creator** can publish a content pack whose assets carry
attribution and licensing, pinned to a version so existing saves keep working,
and get structured errors telling them exactly what to fix.

After this contract, a **player** starts the game noticeably faster, and loading
a community pack cannot leak their IP to a third-party host.

After this contract, a **developer** has one validator serving CI, the hub
upload gate, and the future generation loop — and a seeded world that can be
reproduced from a bug report.

## Success Measures

- **Time/latency target**: time-to-first-frame on `/game` reduced by at least 40% on a cold boot; asset registry work fully off the critical path.
- **Offline/degraded behavior**: unchanged degradation semantics — a failed registry stage still degrades to online mode, but now without blocking the map.
- **Production journey enabled**: a second content pack is reachable and playable end to end, which is the prerequisite for the hub and for generated content.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Pack manifest schema | `packages/shared/schemas/src/lib/game/content_pack.ts` | modify — provenance, trust constraints, version |
| Content audit | `engine/src/__tests__/emberwatch_content_audit.test.ts` | replace — becomes a consumer of the validator |
| Asset registry | `packages/frontend/storage/src/lib/assets.ts` (`AssetRegistryRepository`) | modify — lazy seeding |
| Asset manager | `services/assets/asset_manager.svelte.ts` (C-373) | reuse — it already does hash-addressed resolution |
| Boot pipeline | `services/game/game_boot_service.svelte.ts:340-380` | modify — parallelize, background the registry |
| Manifest generation | `scripts/src/lib/ops/` asset scanners | modify — emit a tag list, merge the hash sidecar |
| Asset store | `services/assets/asset_store.svelte.ts` | modify — derive path/category from the tag |
| Save envelope | `services/game/game_save_service.svelte.ts`, `save_map_block.ts` | modify — pin pack version + world seed |
| Pack registry | `services/campaign/pack_registry_service.svelte.ts` | reuse — the validator's natural home for uploads |
| Canvas boot call | `views/game/canvas/game_canvas_view_model.svelte.ts:135` | modify — read the campaign's pack |
| Per-asset credits (sidecar) | `content/packs/asset_credits.json`, `static/game-data/lpc_credits.json` | replace — provenance moves into the manifest schema; sidecar files become derivable |

## Overview

Make generated and community content a first-class input rather than something
retrofitted. Assets gain provenance; packs may only reference content by hash
through the existing registry; saves pin the pack version and the world seed;
the CI-only content audit becomes a runtime validator with structured, repairable
errors; the 8.7 MB boot manifest shrinks to a derivable tag list; and the boot
pipeline stops serializing work that has no dependency on the map appearing.

## Design Reference

- C-373 (`docs/contracts/C-373-turso-asset-registry-opfs-cache.md`) built the registry → cache → sources resolution chain with SHA-256 verification. This contract enforces it as the *only* asset path for packs rather than adding a new mechanism.
- C-326 established the staged, cancellable boot pipeline with generation tokens. Preserve the cancellation discipline exactly — every `await` still checks `generation !== this._bootGeneration`.
- C-345 (`campaign/content-pack browser`) established `pack_registry_service`; the validator belongs alongside it.
- TypeBox schemas live in `packages/shared/schemas/`; derived types in `packages/shared/types/`. The validator returns structured results, not thrown errors — follow the `ContractStageResult` shape convention used in `scripts/src/lib/agents/contract_pipeline/`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Provenance is per asset, not per pack.** A pack-level credits blob cannot express "these 40 tiles are CC-BY-SA from LPC and these 12 were generated". Model it where the fact lives.
- **Packs address content by hash, never by URL.** Replace free-string URL fields with registry references. The registry already resolves hash → bundled path → cache → remote source; packs should have no say in the origin.
- **Validation returns data, not exceptions.** `validatePack(pack) → { errors, warnings, autoFixes }`. A generation loop needs to feed errors back to a model; a thrown exception is unusable for that. CI asserts `errors.length === 0`; the hub gate does the same; the loop repairs.
- **The manifest carries only what cannot be derived.** If a field is a mechanical transform of the tag, do not ship it 12,707 times.
- **Non-fatal stages must not be blocking stages.** If a boot stage is allowed to fail silently, it is by definition not required for the map to appear — start it and move on.
- **Seed everything from one PRNG.** A single seeded generator threaded through world generation, stored in the save. No bare `Math.random()` on any generation path.
- **Do not build the generator here.** This contract makes generation *possible and reproducible*; it does not generate anything.

## State & Data Models

```ts
/** Provenance carried by every asset a pack declares. */
const AssetProvenanceSchema = Type.Object({
  /** SPDX identifier, or 'proprietary'. Free text is not acceptable here. */
  license: Type.String({ pattern: '^(MIT|Apache-2\\.0|GPL-2\\.0|GPL-3\\.0|CC-BY-4\\.0|CC-BY-SA-4\\.0|CC-BY-SA-3\\.0|OGA-BY-3\\.0|proprietary)$' }),
  /** Attribution name(s) required by the licence. */
  author: Type.Array(Type.String(), { minItems: 1 }),
  /** Where it came from: an upstream URL, 'generated:<provider>', or 'original'. */
  source: Type.String(),
  /** True when the licence is share-alike and derivatives must inherit it. */
  shareAlike: Type.Optional(Type.Boolean()),
});

/** Assets are referenced by content hash, resolved through the C-373 registry. */
const AssetRefSchema = Type.Object({
  /** Registry tag (e.g. 'sprites:tilesets:atlas'). */
  tag: Type.String({ pattern: '^[a-z0-9]+(:[a-z0-9_.-]+)+$' }),
  /** SHA-256 of the content. The registry verifies before use. */
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  provenance: AssetProvenanceSchema,
});

/** Structured validation output — the single shape all three consumers read. */
type PackValidationResult = {
  packId: string;
  errors: PackValidationIssue[];    // block load / block upload
  warnings: PackValidationIssue[];  // load with degradation
  autoFixes: PackValidationFix[];   // mechanical repairs the caller may apply
};

type PackValidationIssue = {
  /** Stable machine code, e.g. 'terrain.unknown-id', 'asset.missing-provenance'. */
  code: string;
  /** JSON pointer into the manifest or map. */
  path: string;
  message: string;
  /** Human/LLM-actionable repair instruction. */
  hint: string;
};

/** Save envelope additions — pin what the world was made from. */
type SaveMapBlockV4 = {
  packId: string;
  /** Semver of the pack the save was created against. */
  packVersion: string;
  mapId: string;
  playerX: number;
  playerY: number;
  spawnId?: string;
  /** Seed for reproducible world generation. */
  worldSeed: string;
};
```

## Quality Requirements

- **Offline/degraded mode**: the validator must run fully offline (no network, no AI). Registry seeding stays non-fatal. A pack failing validation at load time must produce a readable error surface, not a blank screen.
- **Accessibility/input**: the attribution screen must be reachable from the main menu and readable by a screen reader — it is a licence-compliance surface, not decoration.
- **Performance budget**: `validatePack` under 100ms for a pack the size of Emberwatch. Boot manifest under 1 MB uncompressed. Time-to-first-frame improved by ≥40%.
- **Security/privacy**: **this is the contract's core requirement.** No pack-controlled string may become a network origin or a filesystem path. All asset resolution goes through the registry by hash. Validate that constraint with a test that feeds a hostile pack manifest containing absolute URLs, `../` traversal, and `data:`/`javascript:` schemes.
- **Persistence/migration**: the save envelope goes v3 → v4 (adds `packVersion`, `worldSeed`). v3 saves must load. See Migration & Rollback.
- **Cancellation/retry/idempotency**: preserve C-326's generation-token discipline through every restructured stage. Backgrounded registry work must be cancellable when the boot is superseded.
- **Observability**: log stage timings before and after parallelization so the ≥40% claim is measurable from telemetry, not just a stopwatch.

## Migration & Rollback

- **Old data compatibility**: v3 saves lack `packVersion` and `worldSeed`. On load, treat a missing `packVersion` as "the currently installed version" (current behaviour) and a missing `worldSeed` as a deterministic value derived from the campaign id — so a v3 save keeps working and becomes reproducible from then on.
- **Migration**: envelope upgrade happens on load and is written back on the next save. Pack manifests gain provenance via a script that stamps the known-good defaults for the two committed packs (LPC art → CC-BY-SA with the LPC contributor list; original art → the studio). No hand editing.
- **Rollback**: `git revert`. v4 saves loaded by a reverted v3 reader must not corrupt — verify the v3 reader ignores unknown envelope fields rather than rejecting them. **If it does not, that is a blocker to be fixed first.**
- **Feature flag or kill switch**: hash-only asset resolution is enforced by schema validation; a `AIKAMI_ALLOW_PACK_URLS` escape hatch may exist for local development only and must be compiled out of production builds.
- **Failure recovery**: a pack that fails validation is not loaded; the campaign surfaces the structured errors and offers the previously-working pack version if one is cached.

## Scope Boundaries

- **In Scope:**
  - `AssetProvenanceSchema` + `AssetRefSchema`; per-asset provenance on pack manifests
  - Hash-only asset references; removal of free-string URL fields; hostile-manifest test
  - Attribution screen generated from provenance
  - Save envelope v4 (`packVersion`, `worldSeed`) with v3 compatibility
  - Pack version immutability + save pinning
  - `validatePack` service returning `{ errors, warnings, autoFixes }`; CI audit and pack registry both consume it
  - Seeded PRNG threaded through world generation; seed stored and restored
  - Manifest slimming: emit a tag list, derive path/category/name, merge the hash sidecar
  - Lazy registry seeding (register on first request, not all 12,707 up front)
  - Boot restructure: background the registry stage, parallelize preload + engine creation, start the worker first
  - Fix `game_canvas_view_model.svelte.ts:135` to use the campaign's pack; make `whispering-caves` reachable
  - Content-pack authoring + licensing docs page
- **Out of Scope:**
  - **Named map regions for the GM** — deferred; it is a map-format change and belongs with C-378's format work if pulled forward
  - **The generator itself** — no LLM map or asset generation in this contract
  - **The hub upload UI** — the validator is built and unit-tested; wiring it into a hub upload flow is separate
  - **Choosing between the two save systems** — `game_state_sync.svelte.ts` vs `game_save_service`; flagged, not resolved
  - **`FirebaseSqlConnectSync`** — leave the stub; do not build C-195's sync here
  - **Replacing Turso with IndexedDB** — the review flagged it as over-chosen for web; that decision hinges on whether saves stay relational and is not forced by this contract
  - **ADRs for `docs/decisions/`** — a process change, not a code change
  - Any rendering, terrain, collision, or movement change (C-377→C-380)

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. Every AC serves one outcome — untrusted,
generated, or community content can be loaded safely and reproducibly. Provenance
without hash-only references is unenforceable; hash-only references without the
validator produce unreadable failures; version pinning without the validator has
nothing to check against. The boot and manifest work is included because the
manifest slimming *is* the lazy-seeding change viewed from the data side, and
splitting them would leave two representations of the asset catalog live at once.

## Acceptance Criteria

### AC-1: Every declared asset carries licence, author and source
**Given** a content-pack manifest
**When** it is validated
**Then** each declared asset has `license`, `author` and `source`, a manifest missing provenance on any asset fails validation with a pointer to it, and the two committed packs are stamped correctly

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/shared/schemas/src/lib/game/content_pack.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run schemas:test && moon run engine:test`
- Integration: assert both committed manifests validate; assert a manifest with one asset missing `license` produces exactly one error whose `path` points at that asset
- E2E / Visual: N/A

**Watch Points**:
- LPC assets are CC-BY-SA/GPL and **share-alike** — `shareAlike: true` must be set on them, and the validator should warn when a pack mixes share-alike sources with an incompatible pack licence.
- `license` must be SPDX-constrained, not free text, or the field is unusable for automated compliance within a release.

### AC-2: A pack cannot cause a fetch to an origin it names
**Given** a hostile manifest containing absolute URLs, `../` traversal, `data:` and `javascript:` schemes in asset fields
**When** it is loaded
**Then** validation rejects it, no network request is made to any pack-supplied origin, and all legitimate asset resolution goes through the registry by hash

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/engine/src/assets/content_pack_loader.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test && moon run client:test`
- Integration: load the hostile fixture with `fetch` and `Assets.load` spied; assert zero calls with a pack-supplied string; assert the specific rejection codes
- E2E / Visual: N/A

**Watch Points**:
- `tilemap_render_system.ts:97` passes the map's tileset `image` straight to `Assets.load` — the *map* is a pack-supplied file too. Cover map tileset paths, not just manifest fields.
- The dev escape hatch must be compiled out of production. Assert its absence in a production build, not just its gating.

### AC-3: Saves pin the pack version and survive a pack update
**Given** a save created against pack version 3.1.0, and the pack later updated to 3.2.0 with a renamed map
**When** the save is loaded
**Then** the pinned version is recorded, the mismatch is detected, and the player gets a clear resolution path rather than a broken world

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `apps/frontend/client/src/lib/services/game/game_save_service.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: save at 3.1.0, mutate the pack to 3.2.0 renaming the saved map, load; assert detection and the resolution surface
- E2E / Visual: N/A

**Watch Points**:
- `content-packs/index.json` says emberwatch `2.1.0` while `emberwatch/manifest.json` says `3.2.0`. Reconcile and pick one source of truth before pinning to it, or pinning records a number nobody maintains.
- A missing map after an update is recoverable (fall back to the pack's starting map with a warning). A missing *pack* is not — define both.

### AC-4: v3 saves load, and v4 saves are readable by a reverted v3 reader
**Given** a v3 save fixture and a v4 save
**When** each is loaded by the current reader, and the v4 save by the v3 reader
**Then** the v3 save loads with derived defaults, and the v3 reader ignores the unknown v4 fields rather than rejecting the save

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `apps/frontend/client/src/lib/services/game/game_save_service.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: committed v3 fixture loads and upgrades on next save; v4 envelope parsed by the v3 schema path does not throw
- E2E / Visual: N/A

**Watch Points**:
- **If the v3 reader rejects unknown fields, fix that before shipping v4** — otherwise rollback is impossible and the Migration section is fiction. Check this in Phase 1, not at verification.
- The envelope is SHA-256 checksummed; adding fields changes the checksum input. Verify the checksum is computed over the serialized envelope consistently across versions.

### AC-5: One validator serves CI, the pack registry, and future generation
**Given** a content pack
**When** `validatePack` runs
**Then** it returns `{ errors, warnings, autoFixes }` with stable machine codes and JSON-pointer paths, completes in under 100ms for Emberwatch, and the CI content audit is a consumer rather than a parallel implementation

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Unit | `packages/shared/schemas/src/lib/game/pack_validation.test.ts`, `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run schemas:test && moon run engine:test`
- Integration: table-driven over each error code with a minimal reproducing pack; assert the rewritten content audit calls `validatePack` and asserts `errors.length === 0`
- E2E / Visual: N/A

**Watch Points**:
- Error codes are a public contract for the future generation loop — name them for stability (`terrain.unknown-id`, not `error-17`) and treat renames as breaking.
- The existing 550-line audit encodes real accumulated knowledge about what breaks. Port every check; do not reimplement from the schema alone.
- `autoFixes` must be mechanical and safe (fill a default, drop an unknown key). Anything requiring judgement is an `error` with a `hint`.

### AC-6: The boot manifest carries only non-derivable data
**Given** the asset scanner
**When** it emits the boot manifest
**Then** the manifest is a tag list with hashes and sizes, under 1 MB uncompressed, `path`/`category`/`subcategory`/`name` are derived at runtime from the tag, and every previously-resolvable tag still resolves to the same path

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Unit | `packages/frontend/engine/src/__tests__/asset_manifest.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run scripts:test && moon run engine:test`
- Integration: for all 12,707 current tags, assert derived path equals the path in the pre-contract manifest — a full round-trip, not a sample
- E2E / Visual: `game_boot.visual.ts` must still pass

**Watch Points**:
- The 12,707-tag round-trip is the only safe way to change this — LPC naming has irregularities (`celestial_moon_adult.backslash` mixes `.` and `_`) that a sampled test will miss.
- The hash sidecar merges into the same file; `AssetHashesFile` consumers (`game_boot_service.svelte.ts:655`) must move together.
- The registry's `isSeeded(manifest.scannedAt)` check keys on the manifest — a reshaped manifest invalidates existing seeds and re-seeds once on upgrade. That is acceptable but must be deliberate.

### AC-7: Registry seeding is lazy
**Given** a first boot with an empty registry
**When** the game reaches the first frame
**Then** no bulk seeding of 12,707 rows has occurred, assets register on first request, and a subsequent offline boot still resolves everything previously cached

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | Unit | `apps/frontend/client/src/lib/services/assets/asset_manager.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: boot with a spied repository; assert row count after first frame is bounded by assets actually requested; then simulate offline and assert cached assets still resolve
- E2E / Visual: `game_boot.visual.ts`

**Watch Points**:
- Offline rehydration is the risk. C-373's `reconcile()` pre-registers cached binaries; lazy seeding must not break the "cached rows are the offline source of truth" property called out at `game_boot_service.svelte.ts:617-620`.
- LRU eviction protects packs by id; with lazy seeding the protected set is built incrementally. Verify eviction cannot drop an in-use asset.

### AC-8: Boot no longer serializes independent work
**Given** a cold boot
**When** the game starts
**Then** the asset registry stage runs in the background, content preload and engine creation overlap, the worker spawns first, time-to-first-frame improves by ≥40%, and cancellation still works at every stage

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Unit + Visual | `apps/frontend/client/src/lib/services/game/game_boot_service.test.ts`, `apps/e2e/src/visual/suites/game_boot.visual.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: assert stage overlap via instrumented start/end timestamps; assert a boot cancelled mid-flight leaves no orphaned worker, DB handle, or in-flight download
- E2E / Visual: measure time-to-first-frame before and after; record both in the evidence matrix

**Watch Points**:
- C-326's generation-token discipline is what makes cancellation safe. Every restructured `await` must still check `generation !== this._bootGeneration` — parallelizing multiplies the number of places a stale boot can clobber current state.
- Backgrounded registry work outliving a cancelled boot is the specific new hazard. It must be abortable and must never write to `assetManager` after supersession.
- The 30s per-stage timeout assumes serial stages; revisit it for the parallel shape rather than leaving a timeout that can no longer fire correctly.

### AC-9: World generation is reproducible from a seed
**Given** a campaign created with a recorded seed
**When** world generation runs twice with the same seed and pack version
**Then** the output is identical, the seed round-trips through save and load, and no generation path calls bare `Math.random()`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-9 | Unit | `apps/frontend/client/src/lib/services/campaign/campaign_service.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test && moon run engine:test`
- Integration: generate twice from one seed, assert deep equality; assert seed survives save→load; lint rule or test asserting no `Math.random()` on generation paths
- E2E / Visual: N/A

**Watch Points**:
- "Generation paths" needs a precise definition before this is testable — enumerate them (campaign seeding, NPC/location seeding, any procedural placement) rather than trying to ban `Math.random()` repo-wide.
- Reproducibility is only meaningful when the pack version is also pinned (AC-3) — same seed, different pack, different world. Assert the pair.

### AC-10: A second content pack is reachable and playable
**Given** a campaign started on `whispering-caves`
**When** the game boots
**Then** it loads that pack rather than Emberwatch, and the pack passes validation

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-10 | Unit + E2E | `apps/frontend/client/src/lib/views/game/canvas/game_canvas_view_model.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:test`
- Integration: assert the boot call receives the campaign's `contentPackId`, not a literal
- E2E / Visual: Playwright — start a `whispering-caves` campaign, assert the loaded map id is that pack's starting map

**Watch Points**:
- `game_composition_root.svelte.ts:252` already resolves the pack correctly; only the canvas VM's literal is wrong. Verify there is no third place that hardcodes it.
- This is the regression canary for pack-independence across the whole C-377→C-381 sequence. Keep the test cheap so it stays enabled.
- `whispering-caves` exists in the build output (`apps/backend/local-stack/.build/client/content-packs/whispering-caves/`) but NOT in the source `content/packs/` directory. The implementer must either add it to the source directory or ensure the build pipeline generates it.

## Implementation Sequence

1. **Phase 1 (Compatibility check)**: Verify the v3 save reader tolerates unknown envelope fields. If not, fix that first — the whole v4 migration depends on it.
2. **Phase 2 (Validator)**: Build `validatePack` with stable codes; port every check from the 550-line content audit; rewrite the audit as a consumer.
3. **Phase 3 (Provenance + trust)**: `AssetProvenanceSchema`, `AssetRefSchema`; replace free-string URL fields; hostile-manifest fixture and test; stamp the two committed packs by script; attribution screen.
4. **Phase 4 (Versioning + seed)**: Reconcile the pack version sources; envelope v4 with `packVersion` + `worldSeed`; v3 load path; seeded PRNG threaded through generation.
5. **Phase 5 (Manifest)**: Emit the tag list, merge the hash sidecar, derive path/category at runtime, full 12,707-tag round-trip test.
6. **Phase 6 (Boot)**: Lazy registry seeding; background the registry stage; parallelize preload + engine creation; spawn the worker first; re-verify cancellation at every stage; measure time-to-first-frame.
7. **Phase 7 (Reachability)**: Fix the hardcoded pack id; validate `whispering-caves`; E2E.
8. **Phase 8 (Validation)**: `moon run :typecheck && :test && :lint`; `game_boot.visual.ts`; docs page.

## Edge Cases & Gotchas

- **`content_pack.ts` is also touched by C-378.** Both add schema blocks. Sequence the merges or expect a conflict in the same file; C-378's `terrains` and this contract's provenance are independent additions, so ordering is a merge concern, not a design one.
- **Share-alike is contagious.** A pack containing LPC-derived art must itself be share-alike. The validator should warn on an incompatible pack licence rather than silently allowing a licence violation to be published.
- **The 12,707-tag round-trip will find irregularities.** LPC naming mixes separators. Expect to keep a small explicit exception table rather than a purely mechanical derivation — that is fine and still removes ~7 MB.
- **Parallelizing a pipeline with 30s per-stage timeouts changes what the timeout means.** A backgrounded stage that never completes must not hang the boot; give it its own budget and let the boot proceed regardless.
- **Backgrounded work outliving a cancelled boot is the main new hazard.** C-326 solved this for serial stages with a generation token; the same token must gate every backgrounded continuation.
- **Do not resolve the two-save-systems question here.** It is flagged in the review and deserves its own decision; touching it inside this contract would widen the blast radius across the hub.
- **Do not build the generator.** The temptation once seeding and validation exist is to write the map generator in the same PR. It is a separate contract with a separate risk profile.

## Open Questions

Must be resolved before status becomes `approved`:

- Which is the source of truth for pack version — `content-packs/index.json` or the pack's own `manifest.json`? They currently disagree (2.1.0 vs 3.2.0). Recommendation: the manifest, with the index generated from it.
- Should `worldSeed` be per-campaign or per-map? Recommendation: per-campaign, with per-map seeds derived from it, so one recorded value reproduces everything.
- Does the attribution screen ship in this contract or follow it? Recommendation: ship it — provenance without a surface that displays it does not satisfy the licence.
- Should named map regions (for the AI Game Master) be pulled into C-378's format work now, given it is the only other contract touching the map format? Recommendation: yes, if C-378 has not merged — it is a format addition and cheap there, expensive later.

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
