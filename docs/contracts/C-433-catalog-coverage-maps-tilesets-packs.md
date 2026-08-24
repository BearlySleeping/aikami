---
id: C-433
title: "Catalog Coverage — Maps, Tilesets, Audio and Content Packs on R2"
source: "user request 2026-08-23 — bucket is missing content-packs, maps and sprites"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-23"
---

# Contract C-433: Catalog Coverage — Maps, Tilesets, Audio and Content Packs on R2

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-23): *"It is missing content-pack and game-data maps and apps/frontend/client/static/game-data/sprites."* |
| **Target** | `scripts/src/lib/ops/scan_assets.ts`, `scripts/src/lib/catalog/`, `packages/shared/constants/src/lib/game_assets.ts`, `packages/shared/schemas/src/lib/catalog/` |
| **Priority** | P1 — C-434 and C-435 cannot route these categories through the registry until the bytes exist on the origin. |
| **Dependencies** | C-395 (publish pipeline, status `implemented`). Independent of C-432 — one is publisher-side, the other client-side; they share no code path and can run in parallel. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → developer note on publishing categories |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: the published catalog covers 12,704 of the assets the
  client ships, and misses whole categories. Fetched live 2026-08-23:
  ```bash
  curl -s https://assets.bearlysleeping.com/index/v1/catalog.json
  # → totalCount 12704; categories: lpc 12699, music 3, sprites 2
  ```
  Against what is actually on disk:
  ```bash
  du -sh apps/frontend/client/static/game-data/*
  # 74M   lpc          → 12699 published  ✅
  # 11M   music        →     3 published  ⚠️  (3 files on disk; size is per-file, coverage is fine)
  # 628K  sprites      →     2 published  ❌  (6 files on disk — 4 tilesets excluded)
  # 28K   maps         →     0 published  ❌  (5 files, not a scan category at all)
  du -sh apps/frontend/client/static/content-packs
  # 88K                →     0 published  ❌  (outside the scanned tree entirely)
  ```

- **Root cause**: `ASSET_CATEGORIES` in
  `packages/shared/constants/src/lib/game_assets.ts:67` defines the scan
  taxonomy (`music`, `sfx`, `ambient`, `sprites`, `backgrounds`, `lpc`).
  `scan_assets.ts` walks only `static/game-data/` and only emits files matching
  a declared category's extensions. Consequently:
  - `static/game-data/maps/*.jton` and `*.json` match no category → never scanned, never hashed, never published.
  - `static/game-data/sprites/tilesets/*` were deliberately excluded by C-395 as *"dev-only sandbox files"*, alongside `static/ort`. Only the two `sprites/combat/*.webp` portraits are published.
  - `static/content-packs/` is a sibling of `static/game-data/`, outside the scan root entirely.

- **Reproduction**:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" \
    "https://assets.bearlysleeping.com/index/v1/maps.json"   # → 404, no such shard
  find apps/frontend/client/static/game-data/maps apps/frontend/client/static/content-packs -type f | wc -l
  ```

- **Existing implementation to reuse** — this is a *taxonomy widening*, not a new pipeline:
  - `scripts/src/lib/ops/scan_assets.ts` already walks, tags (`category:subcategory:name:state`), sha256s and emits `manifest.json` + `asset_hashes.json`.
  - `scripts/src/lib/catalog/` already content-addresses, uploads idempotently by key, shards the index per category and gates on attribution (C-395).
  - `packages/shared/schemas/src/lib/catalog/` already defines `CatalogAssetEntry`, `CatalogIndexRoot` and `CatalogIndexShard` — `CatalogCategorySchema` is a `Type.Union` of literals that must be widened to include the new categories.
  - `ASSET_CATEGORIES` is the single declaration point for the taxonomy.

- **Known gaps**: no category covers structured data files (`.jton`, `.json` maps, pack manifests); the C-395 exclusion of tilesets was a deliberate call that the user is now reversing; content packs are a *directory-structured* artifact (manifest plus maps plus sprites), not a flat file, and the current taxonomy has no notion of one.

- **Baseline tests**: `bun moon run scripts:test`. Must pass before starting.
  Record the current `totalCount` (12704) as the pre-contract baseline.

## User Outcome

After this contract, a **developer** publishes one command and every asset the
client ships — maps, tilesets, portraits, audio and content packs — is on the
CDN origin with attribution, addressable by hash. This is what makes C-434 and
C-435 possible, and what lets the hub eventually read the same origin.

## Success Measures

- **Time/latency target**: a full publish over the widened set stays under the
  C-395 budget of 10 minutes, and a re-publish of unchanged content completes in
  under 1 minute (idempotent skip by key).
- **Offline/degraded behavior**: N/A for the publisher. The client is not
  modified by this contract and keeps booting fully bundled.
- **Production journey enabled**: unblocks C-434 (client reads maps and packs
  from the registry) and C-435 (de-bundling).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Scan, tag, sha256, manifest + sidecar | `scripts/src/lib/ops/scan_assets.ts` | modify — widen roots and categories |
| Category taxonomy | `packages/shared/constants/src/lib/game_assets.ts` `ASSET_CATEGORIES` | modify — add categories |
| Content-address, upload, shard, publish | `scripts/src/lib/catalog/` | reuse unchanged |
| Catalog schemas | `packages/shared/schemas/src/lib/catalog/` | modify — `CatalogCategorySchema` is a `Type.Union` of literals; add `maps`, `tilesets`, `content_packs` to the union |
| Attribution gate | `scripts/src/lib/catalog/preflight.ts`, `lpc_credits.ts` | reuse — must cover new categories |
| Pack manifest shape | `packages/shared/schemas/src/lib/game/pack_index.ts`, `static/content-packs/index.json` | reuse as reference |

## Overview

Widen the asset scan taxonomy and roots to cover maps, tilesets and content
packs, reverse the C-395 tileset exclusion, and publish the resulting categories
to the existing R2 origin through the existing content-addressed pipeline — with
attribution resolved for every newly published file.

## Design Reference

C-395 is the authority on bucket layout, index sharding and the attribution
gate; this contract adds categories to that machinery rather than changing it.
`ASSET_CATEGORIES` is the single taxonomy declaration — add there, never
inline a category name in a script.

Content packs are a directory-structured artifact. Publish their **constituent
files** as ordinary content-addressed assets and their `manifest.json` as the
entry point that names them, mirroring how `pack_index.ts` already models a pack
registry. Do not invent a tarball format.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Taxonomy lives in `ASSET_CATEGORIES`, nowhere else.** A category added by
  editing a script is the defect this directive prevents.
- **Every published byte is content-addressed and attributed.** New categories
  get no exemption from the C-395 preflight. First-party maps and pack content
  still need a declared licence — record it in the committed project-licence
  declaration rather than bypassing the gate.
- **Structured data is an asset like any other.** A `.jton` map is bytes with a
  hash. It does not need a bespoke pipeline; it needs a category whose extension
  set includes it.
- **Content packs publish as files plus a manifest.** The pack's `manifest.json`
  is itself a published asset that references its constituents by tag. A
  consumer resolves the manifest, then resolves what it names.
- **Reversing the tileset exclusion is deliberate and must be recorded.** C-395
  excluded `sprites/tilesets/` as dev-only. That call is reversed here by user
  request; note it in this contract's Amendments so the C-395 rationale is not
  silently contradicted.
- **The client is not modified.** It keeps bundling and keeps booting exactly as
  today. Consumption is C-434.

## State & Data Models

Taxonomy additions — `packages/shared/constants/src/lib/game_assets.ts`:

```ts
/**
 * Structured map data. Extensions cover the Tiled JSON export and the
 * project's compact `.jton` form.
 */
maps: {
  name: 'maps',
  extensions: new Set(['.jton', '.json']),
  defaultSubdirs: [],
},

/**
 * Tileset atlases and their descriptors. Reverses the C-395 dev-only
 * exclusion of static/game-data/sprites/tilesets/ (user request 2026-08-23).
 */
tilesets: {
  name: 'tilesets',
  extensions: new Set(['.webp', '.png', '.json']),
  defaultSubdirs: [],
},

/**
 * Content-pack constituents — manifests, pack maps, pack sprites. Scanned
 * from static/content-packs/, which sits outside the game-data root.
 */
content_packs: {
  name: 'content_packs',
  extensions: new Set(['.json', '.jton', '.webp', '.png']),
  defaultSubdirs: [],
},
```

**Schema change required**: `CatalogCategorySchema` in `catalog_index.ts` is a `Type.Union` of six literal strings (`music|sfx|ambient|sprites|backgrounds|lpc`). Add `maps`, `tilesets` and `content_packs` to the union — otherwise `Value.Check(CatalogIndexShardSchema, shard)` in `buildShardDocument()` will reject the new shards. `CatalogIndexRoot.categories[].id` is already `string` and needs no change.

New index shards appear
at `index/v1/maps.json`, `index/v1/tilesets.json`, `index/v1/content_packs.json`
automatically.

The scan root widens from a single directory to a declared list:

```ts
/** Roots the asset scan walks, each with the URL prefix its files serve under. */
type AssetScanRoot = {
  /** Absolute path to walk. */
  dir: string;
  /** Public path prefix, e.g. "/game-data" or "/content-packs". */
  urlPrefix: string;
};
```

## Quality Requirements

- **Offline/degraded mode**: N/A — publisher-side only; the client is untouched.
- **Accessibility/input**: N/A — CLI only.
- **Performance budget**: see Success Measures. The added categories are small
  (well under 1 MB total) relative to the 74 MB LPC tree.
- **Security/privacy**: R2 write credentials stay in `scripts/.env.*` per C-395.
  No credential reaches a browser. Public read requires none.
- **Persistence/migration**: objects are immutable and never deleted; adding
  categories only adds objects and index shards. Existing shards are
  republished unchanged. Old index revisions keep resolving.
- **Cancellation/retry/idempotency**: unchanged from C-395 — resume by skipping
  existing keys; the index is written last, after every referenced object is
  confirmed uploaded.
- **Observability**: report per-category counts uploaded / skipped / failed, and
  name every asset failing attribution. Non-zero exit on any failure.
- **Legal/compliance**: the C-395 attribution gate applies to every new
  category with no bypass flag.

## Migration & Rollback

- **Old data compatibility**: additive. Existing tags, hashes and objects are
  unchanged; `manifest.json` and `asset_hashes.json` gain entries. The client
  reads both at boot and tolerates new tags it does not use.
- **Migration**: none. The first publish after this contract populates the new
  shards.
- **Rollback**: `git revert` removes the categories from the taxonomy and the
  scan. Published objects and shards may remain in the bucket — they are inert
  and cost nothing under the free tier. The client is unaffected either way.
- **Feature flag or kill switch**: N/A — nothing consumes the new categories
  during this contract's life.
- **Failure recovery**: re-run the publish; idempotency by key makes it safe.

## Scope Boundaries

- **In Scope:**
  - `maps`, `tilesets` and `content_packs` categories in `ASSET_CATEGORIES`.
  - Multi-root scanning so `static/content-packs/` is covered.
  - Reversing the C-395 `sprites/tilesets/` exclusion.
  - Attribution declarations for the newly covered first-party files.
  - Publishing the new categories and their index shards.
  - Developer documentation for the widened publish.
- **Out of Scope:**
  - **Any client change.** No AssetManager, boot, resolver or `static/` change — that is C-434.
  - Removing bundled assets — C-435.
  - `static/ort` (76 MB of ONNX runtime). It is not game content and stays excluded.
  - The `music`/`sfx`/`ambient`/`backgrounds` category definitions.
  - Hub UI or routes.
  - User-uploaded content.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. All three categories are the same change —
a taxonomy entry plus a scan root — applied three times, sharing one pipeline,
one attribution gate and one publish run. Splitting would triple the pipeline
runs for one coherent widening. Each category is independently verifiable via
its own AC, which is the constraint that matters.

## Acceptance Criteria

### AC-1: Maps are scanned, hashed and published
**Given** `static/game-data/maps/` containing `.jton` and `.json` map files
**When** the scan and publish run
**Then** every map appears in `manifest.json` with a hash sidecar entry, is uploaded under its content-addressed key, and `index/v1/maps.json` lists it

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `scripts/src/lib/catalog/__tests__/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: after publish, `curl -s https://assets.bearlysleeping.com/index/v1/maps.json` returns a shard whose entry count matches the file count on disk.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- `.json` is claimed by both `maps` and `tilesets`. Category assignment must be decided by the containing directory, not by extension alone, or a tileset descriptor lands in the maps shard.

### AC-2: Tilesets are published
**Given** `static/game-data/sprites/tilesets/` containing atlas images and descriptors
**When** the scan and publish run
**Then** every tileset file is published and listed in `index/v1/tilesets.json`, reversing the C-395 exclusion

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | `scripts/src/lib/catalog/__tests__/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: confirm `atlas.webp` and its `atlas.json` descriptor are both present in the shard.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- An atlas image without its JSON descriptor is unusable. Publish both or neither.
- Record the C-395 reversal in this contract's Amendments.

### AC-3: Content packs are published with their constituents
**Given** `static/content-packs/emberwatch/` containing a manifest and pack content
**When** the scan and publish run
**Then** the pack manifest and every constituent file are published, and `index/v1/content_packs.json` lists them with tags that let a consumer resolve the manifest and then what it names

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `scripts/src/lib/catalog/__tests__/*.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: fetch the published `emberwatch` manifest from R2 and confirm every file it references resolves to a published tag.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- `static/content-packs/` is outside the current scan root. The multi-root change is what makes this AC possible; verify the URL prefix is `/content-packs`, not `/game-data`.
- `content-packs/index.json` is a pack registry, not a pack. Publish it, but do not treat it as a pack manifest.
- **Pipeline multi-root support**: `config.ts` hardcodes `GAME_DATA_DIR` pointing to `static/game-data`. The pipeline's `loadCatalogEntries()` reads manifest/hashes/credits from a single directory, and `buildUploadItems()` resolves local paths against `gameDataDir`. Both must be widened to accept multiple scan roots so content-pack files (outside `game-data/`) can be uploaded and indexed alongside game-data assets.

### AC-4: The root index reflects the widened coverage
**Given** a completed publish
**When** `index/v1/catalog.json` is fetched
**Then** its `categories` array includes `maps`, `tilesets` and `content_packs` with non-zero counts, and `totalCount` equals the sum of all shard entry counts

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | Published `index/v1/catalog.json` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: `curl` the root index; assert `totalCount` exceeds the pre-contract 12704 by exactly the number of newly published files.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- The root index must stay under the C-395 256 KB gzipped budget. Three summary rows will not threaten it, but assert it rather than assuming.
- `totalCount` must be the sum of shards, not a separately computed number that can drift.

### AC-5: Attribution is resolved for every newly published file
**Given** the newly covered categories
**When** the C-395 attribution preflight runs
**Then** it passes with no unresolved tags, and every new asset carries licence and author data in its shard entry

**Preflight exclusion must be removed**: `scripts/src/lib/catalog/preflight.ts` defines `EXCLUDED_PATH_PREFIXES = ['maps/', 'sprites/tilesets/']` and `isCatalogAssetPath()` filters these out of the catalog. This exclusion must be removed — otherwise maps and tilesets are silently skipped by `loadCatalogEntries()` and never published. The `catalog_entries.ts` `isCatalogAssetPath` call in `loadCatalogEntries()` must also be updated or removed.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `scripts/src/lib/catalog/preflight.ts` output | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: run the preflight; it must name any unresolved tag, not report a bare count.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- First-party maps and pack content still need a declared licence. Add them to the committed project-licence declaration — the gate has no bypass and adding one would be a compliance regression.
- Tilesets sourced from third parties need real upstream attribution, not a first-party default. Check provenance before declaring.
- `entryToShardEntry()` in `index_generation.ts` casts `entry.category as CatalogCategory` — this cast passes at runtime but the subsequent `Value.Check()` fails for unknown categories unless the union is updated first.

### AC-6: The client is unchanged
**Given** this contract merged
**When** the client is built and booted
**Then** its bundled contents, boot sequence and asset resolution are byte-for-byte unchanged apart from the additive manifest and hash-sidecar entries

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | Integration | `apps/frontend/client/` diff | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test-unit`
- Integration: confirm the PR touches no file under `apps/frontend/client/src/`.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- `manifest.json` and `asset_hashes.json` grow, which the client parses at boot. Confirm the added entries do not push boot past its budget — they are small, but measure rather than assume.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Add the three categories to `ASSET_CATEGORIES` and widen `scan_assets.ts` to multiple roots with directory-based category assignment. Update `CatalogCategorySchema` union in `packages/shared/schemas/src/lib/catalog/catalog_index.ts`. Unit tests for taxonomy and tagging.
2. **Phase 2 (Integration)**: Remove `EXCLUDED_PATH_PREFIXES` from `scripts/src/lib/catalog/preflight.ts` and the `isCatalogAssetPath` filter from `catalog_entries.ts`. Widen `GAME_DATA_DIR` / `loadCatalogEntries()` / `buildUploadItems()` to support multiple scan roots. Declare attribution for the new files, run the preflight, run a full publish, verify the shards and root index (AC-1 to AC-5).
3. **Phase 3 (Validation)**: `bun moon run scripts:test`, `bun moon check`, then confirm the client is untouched (AC-6).

## Edge Cases & Gotchas

- **`.json` is ambiguous.** Maps, tileset descriptors and pack manifests all use it. Assign category by containing directory, not extension.
- **`content-packs/index.json` is a registry, not a pack.** Publish it; do not parse it as a manifest.
- **Path-derived tags must stay stable.** `pathToTag` maps `/` to `:`. A tag that changes shape breaks the C-432 R2 source rows keyed by tag. Verify existing tags are unchanged.
- **Do not include `static/ort`.** 76 MB of ONNX runtime is not game content.
- **Music coverage is a red herring.** The catalog lists 3 music assets against 11 MB on disk because there are 3 large files. Coverage is already complete — do not "fix" it.
- **Idempotency across a widened scan.** Re-running must not re-upload the 12,699 unchanged LPC objects. Verify the skip-by-key path still short-circuits.
- **`preflight.ts` has a hard exclusion for maps and tilesets.** `EXCLUDED_PATH_PREFIXES = ['maps/', 'sprites/tilesets/']` in `preflight.ts` and the `isCatalogAssetPath` filter in `catalog_entries.ts` must be removed — otherwise the pipeline silently skips the very files this contract aims to publish.
- **`CatalogCategorySchema` is a union, not a free string.** The TypeBox schema in `catalog_index.ts` uses `Type.Union([Type.Literal('music'), ...])`. Adding new categories requires updating this union, or `Value.Check()` validation in `buildShardDocument()` will reject the new shards.

## Open Questions

Must be resolved before status becomes `approved`:

- None. The gaps, their causes and the extension points are confirmed against the live bucket and the on-disk tree.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-08-23 | Reverses the C-395 decision to exclude `static/game-data/sprites/tilesets/` as dev-only sandbox content. Reversed by user request 2026-08-23; tilesets are required by the map renderer and must be available from the origin. | pending |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
