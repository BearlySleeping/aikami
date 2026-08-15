---
id: C-395
title: "R2 Asset Origin and Content-Addressed Catalog Index"
source: "user request — hub community catalog; ADR amendments A-3, A-4"
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/148"
  pr_number: 148
created_at: "2026-08-15"
---

# Contract C-395: R2 Asset Origin and Content-Addressed Catalog Index

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-15). Architecture: `docs/architecture/data-layer-target-architecture.md` D-13, D-14 and invariants I-7, I-8 (amendments A-3, A-4). |
| **Target** | `scripts/src/lib/ops/{scan_assets,upload_assets,upload_lpc_assets}.ts`, new publish pipeline under `scripts/src/lib/catalog/`, `packages/shared/schemas/src/lib/catalog/` |
| **Priority** | P1 — C-396 (browse) and C-397 (client on-demand assets) both read the index this contract produces. Nothing user-facing ships without it. |
| **Dependencies** | None. Runs in parallel with C-394 — this is the immutable plane, that is the mutable one, and they share no data model. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → developer notes on publishing assets |
| **Contract version** | 2.4.0 |

## Problem & Baseline Evidence

- **Current behavior**: every catalog asset is bundled into the client's `static/` directory and shipped with the app. `du -sh apps/frontend/client/static/game-data` reports **93 MB** — 74 MB of LPC sprites, 11 MB of music, plus maps and sprites — across **12,707 assets** (`manifest.json` → `count`). A further 76 MB sits in `static/ort`. Every user downloads all of it, whether or not they ever load the content that uses it, and every Tauri release carries it.
- **Reproduction**: `du -sh apps/frontend/client/static/*` — `game-data` is 93 MB, `manifest.json` alone is 7 MB and `asset_hashes.json` is 1.7 MB. Both seed files are parsed by the client on first boot.
- **Existing implementation to reuse** — this contract is largely a *retarget*, not a rebuild:
  - `scripts/src/lib/ops/scan_assets.ts` already walks `static/game-data/`, derives a `category:subcategory:name:state` tag per file, and emits `manifest.json` plus an `asset_hashes.json` sidecar containing a **sha256 and byte size per asset** (C-243/C-373). Content addressing is therefore already computed — it is simply not used as an address.
  - `scripts/src/lib/ops/upload_assets.ts` already uploads the bundled tree to Firebase Storage with a concurrency pool, a per-extension MIME map, and a mode→bucket mapping. `upload_lpc_assets.ts` exists separately because of LPC's file count.
  - `packages/frontend/storage/src/lib/assets.ts` → `AssetRegistryRepository` already models `assets` / `asset_sources` / `install_state`, and `asset_sources.backend` already includes **`'r2'`** as a legal value (`migrations.ts:201`). The device plane is already built for this; nothing writes `'r2'` rows yet.
  - `packages/shared/schemas/src/lib/game/pack_index.ts` (`PackIndexSchema`) is the existing shape for a pack registry index.
- **Known gaps**: the bucket, S3 credentials and the **custom domain `assets.bearlysleeping.com`** now exist and are live (provisioned 2026-08-15 — see State & Data Models; Open Question 1 resolved). Nothing content-addresses the stored objects (Firebase Storage layout mirrors the source tree, so two versions of an asset collide); no catalog index distinct from the client's boot manifest; no publish pipeline that produces an index a browser can read.
- **Baseline tests**: `bun moon run scripts:test`, `bun moon run frontend-storage:test`. Both must pass before starting.

## User Outcome

After this contract, a **developer** can publish the asset library to a CDN
origin with one command and get back an immutable, content-addressed catalog
index — and a **player** eventually stops downloading 93 MB they may never use
(realised in C-397, unblocked here).

## Success Measures

- **Time/latency target**: catalog index fetch under 200ms from a cold browser cache. A publish run over the full 12,707-asset library completes in under 10 minutes and re-publishes only changed objects on subsequent runs.
- **Offline/degraded behavior**: the client is unaffected by this contract — it still bundles and still boots offline. The index is additive.
- **Production journey enabled**: unblocks C-396 (browse) and C-397 (on-demand assets).

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Asset scan + sha256 sidecar | `scripts/src/lib/ops/scan_assets.ts` | reuse — the hashes become addresses |
| Bulk upload with concurrency + MIME map | `scripts/src/lib/ops/upload_assets.ts` | modify — retarget Firebase Storage → R2 |
| LPC bulk upload | `scripts/src/lib/ops/upload_lpc_assets.ts` | modify — same retarget |
| `r2` source backend on the device | `packages/frontend/storage/src/lib/assets.ts`, `migrations.ts:201` | reuse unchanged — this contract only starts producing rows for it |
| Index schema idiom | `packages/shared/schemas/src/lib/game/pack_index.ts` | reuse as a style reference |
| Deploy app registry | `scripts/src/lib/deploy/deployment_config.ts` | modify (see Scope) |

## Overview

Stand up a Cloudflare R2 bucket as the origin for catalog asset bytes, stored
under **content-addressed keys** derived from the sha256 that `scan_assets.ts`
already computes. Generate a **catalog index** — a versioned JSON document
describing what exists, what it costs to download, its license and
attribution, and where to fetch it — and publish both with one command.
(Byte-signing is deliberately out of scope: no consumer in this contract or
C-396/C-397 verifies a signature, and no signing key or AC exists for one.)

The client is not modified. It keeps bundling and keeps booting exactly as it
does today; this contract only creates the origin and the index that C-396 and
C-397 will consume.

## Design Reference

`docs/architecture/data-layer-target-architecture.md` D-13, D-14, I-7.
Follow `scripts/src/lib/ops/upload_assets.ts` for the upload loop, concurrency
pool, and mode handling. Follow `packages/shared/schemas/src/lib/game/pack_index.ts`
for the index schema idiom (`schemaVersion` literal + typed entry array).
R2 speaks the S3 API — use an S3-compatible client, not a Cloudflare-specific SDK.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Content-addressed keys, immutable objects.** An object's key is derived from
  its sha256, not from its source path. Two versions of `bgm_combat.webm` are
  two objects that coexist; nothing is ever overwritten in place. This makes
  caching trivially correct (`Cache-Control: public, max-age=31536000, immutable`)
  and makes rollback a matter of publishing an older index.
- **The index is the only mutable object in the bucket.** Everything else is
  write-once. The index gets a short cache lifetime; assets get a year.
- **The index is not the client's boot manifest.** `manifest.json` (7 MB) exists
  to seed the device registry and is loaded once at boot. The catalog index is
  a browse-facing document for the hub and must stay small enough to fetch on a
  page load — see AC-2 on sharding.
- **No credential reaches a browser.** R2 write credentials live only in the
  publish pipeline (CI/local ops). Public reads go through a custom domain with
  no credential at all (I-7 — the hub never proxies bytes).
- **Publishing is idempotent and resumable.** A run that uploads 12,707 objects
  will be interrupted at some point. Re-running must skip what already exists
  by key, not re-upload it.
- **Do not modify the client.** No change to the AssetManager, boot behaviour, or
  the bundled `static/` contents that the client loads. The scan step already
  regenerates `manifest.json`/`asset_hashes.json` in place (an existing process);
  adding the credits sidecar is additive data, not a behaviour change. That is
  C-397, deliberately separated so this contract can merge without touching the
  play path.

## State & Data Models

Bucket layout:

```
r2://aikami-catalog/
  assets/<sha256[0:2]>/<sha256>.<ext>     immutable, Cache-Control: 1 year
  index/v1/catalog.json                    mutable, Cache-Control: 60s
  index/v1/<category>.json                 per-category shards (see AC-2)
```

The two-character prefix shard keeps any single listing prefix under a few
hundred objects, which matters for operational tooling rather than for reads.

Credentials — set by the maintainer 2026-08-15, in **`scripts/.env.*`**, not in
the hub's env (the hub never writes to R2, I-7):

```
CLOUD_FLARE_BUCKET_ACCESS_KEY_ID       S3 access key id
CLOUD_FLARE_BUCKET_SECRET_ACCESS_KEY   S3 secret
CLOUD_FLARE_BUCKET_ENDPOINT            S3 endpoint (https://<account>.r2.cloudflarestorage.com)
CLOUD_FLARE_BUCKET_TOKEN               Cloudflare REST API token — bucket
                                       administration only, NOT needed for
                                       S3 object operations. Keep only if a
                                       management task actually uses it.
```

Bucket: `aikami-catalog`, location hint **WEUR**, default storage class
**Standard** (Infrequent Access is excluded from the R2 free tier and adds
retrieval fees — never use it for a CDN origin).

Catalog index schemas — TypeBox in `packages/shared/schemas/src/lib/catalog/`:

```ts
/** One downloadable artifact in the public catalog. */
type CatalogAssetEntry = {
  /** Stable logical id — the existing manifest tag, e.g. "lpc:hat:magic:celestial_adult:thrust". */
  tag: string;
  /** sha256 of the bytes. Also the storage address. */
  hash: string;
  sizeBytes: number;
  /** Category from the existing scan (ASSET_CATEGORIES): "lpc" | "music" | "sprites" | "sfx" | "ambient" | "backgrounds".
   *  NOTE: static/game-data/maps/ and sprites/tilesets/ hold dev-only sandbox
   *  files and are NOT scan categories — keep them out of the catalog, same
   *  reasoning as static/ort (see Edge Cases). */
  category: string;
  subcategory?: string;
  /** File extension including the dot, e.g. ".webp". */
  ext: string;
  /** Upstream license strings, VERBATIM. Empty array = genuinely unknown.
   *  NOT SPDX — LPC publishes "OGA-BY 3.0", which has no SPDX identifier.
   *  Multiple entries mean multi-licensed (the user may choose one). */
  licenses: readonly string[];
  /** Every author credited upstream. Empty array = genuinely unknown. */
  authors: readonly string[];
  /** Upstream source URLs (OpenGameArt pages etc.), for the credits page. */
  sourceUrls: readonly string[];
  /** Freeform upstream note, where one exists. */
  licenseNote?: string;
};

/**
 * Root index — category summaries and counts ONLY, never per-asset entries.
 * 12,707 entries would reproduce the 7 MB manifest.json problem (AC-2);
 * per-asset entries live in per-category shards fetched on demand.
 */
type CatalogIndexRoot = {
  schemaVersion: 1;
  /** ISO 8601 — when this index was published. */
  publishedAt: string;
  /** Base URL that shard `hash`es resolve against, e.g. "https://assets.bearlysleeping.com". */
  originUrl: string;
  /** Total across all shards, so a client can show progress before fetching them. */
  totalCount: number;
  /** One summary row per category; its shard URL is `index/v1/<id>.json`. */
  categories: readonly { id: string; count: number }[];
};

/** One category shard — per-asset entries for a single category. */
type CatalogIndexShard = {
  schemaVersion: 1;
  /** ISO 8601 — when this shard was published. */
  publishedAt: string;
  /** Base URL that `hash` resolves against. */
  originUrl: string;
  /** Category this shard covers (same values as CatalogAssetEntry.category). */
  category: string;
  entries: readonly CatalogAssetEntry[];
};
```

`license` and `attribution` are first-class rather than optional metadata: the
LPC library is overwhelmingly CC-BY-SA / GPL, and a catalog that redistributes
it without carrying attribution is a licensing problem, not a missing feature.

## Quality Requirements

- **Offline/degraded mode**: unchanged for the client (still fully bundled). The hub must treat an unreachable index as an empty catalog with an error state, never a crash.
- **Accessibility/input**: N/A — no UI in this contract.
- **Performance budget**: the root index must stay under 256 KB gzipped; category shards under 1 MB each. If LPC alone exceeds that, shard it further by subcategory rather than shipping a 7 MB browse document.
- **Security/privacy**: R2 write credentials in Secret Manager, never in the repo, never in a client bundle. The bucket's public read path serves only catalog assets — no user content, no save blobs (those stay in Firebase Storage per D-13).
- **Persistence/migration**: objects are immutable and never deleted by a publish run. Removing an asset from the catalog removes its *index entry*, not its bytes — old indexes keep resolving.
- **Cancellation/retry/idempotency**: interrupted publishes resume by skipping existing keys. The index is written **last**, after every object it references is confirmed uploaded, so a partial publish never produces an index pointing at missing bytes.
- **Observability**: the publish run reports counts (uploaded / skipped / failed), total bytes transferred, and elapsed time. A non-zero failure count must exit non-zero. The attribution preflight reports the number of assets checked and lists every unresolved tag by name — "3 assets failed attribution" without naming them is not actionable at a 12,707-asset scale.
- **Legal/compliance**: no asset may be published without resolved attribution. The preflight in AC-4 is a hard gate with no bypass flag, running before the upload phase. This is a redistribution-compliance control, not a data-quality nicety — LPC's CC-BY-SA and OGA-BY terms require naming authors, and this pipeline is the point at which redistribution begins.

## Migration & Rollback

- **Old data compatibility**: nothing consumes the index yet, so there is no compatibility surface. The client's existing bundled assets and Firebase Storage copies are untouched.
- **Migration**: none — this is additive. The first publish populates an empty bucket.
- **Rollback**: `git revert` removes the pipeline. The bucket can be left populated (it costs nothing under the 10 GB free tier and nothing reads it) or emptied. No user-visible surface changes in either direction.
- **Feature flag or kill switch**: N/A — nothing reads the output during this contract's life.
- **Failure recovery**: re-run the publish. Idempotency by key makes a repeat run safe and cheap.

## Scope Boundaries

- **In Scope:**
  - R2 bucket provisioning, public custom domain, and credentials in Secret Manager.
  - New publish pipeline under `scripts/src/lib/catalog/`: content-addressed upload, index generation, index publication.
  - Retargeting `upload_assets.ts` / `upload_lpc_assets.ts` to R2, or superseding them if the content-addressed path makes them redundant — decide during Phase 1 and record it.
  - `packages/shared/schemas/src/lib/catalog/` — `CatalogAssetEntry` / `CatalogIndex` TypeBox schemas.
  - License/attribution capture in the scan step (the `lpc_credits.json` sidecar
    from `collect_lpc_assets.ts` and the committed `project_licenses.json`
    declaration for non-LPC assets).
  - A `catalog` deploy entry if the pipeline should run from CI (see Open Questions).
  - Developer documentation for publishing.
- **Out of Scope:**
  - Any client change — bundling, AssetManager, boot path, `static/` contents (C-397).
  - Any hub UI or route (C-396).
  - Postgres, ratings, counts, submissions (C-394, C-398, C-399).
  - Removing the Firebase Storage asset copies. Leave them until C-397 proves the R2 path works end to end; deleting a working fallback before its replacement ships is how outages happen.
  - User-uploaded content (C-398). This contract publishes only first-party assets.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. An origin with no index is unbrowsable; an
index pointing at an origin that does not exist is a broken document. Both must
land together for either to be verifiable. The license-capture work is small
and belongs with the scan it modifies.

## Acceptance Criteria

### AC-1: Assets publish to R2 under content-addressed keys, idempotently

**Given** an R2 bucket and credentials
**When** the publish command is run against `apps/frontend/client/static/game-data/`
**Then** every asset is uploaded to `assets/<sha256[0:2]>/<sha256>.<ext>` with
its correct MIME type and a one-year immutable `Cache-Control`, and the run
reports uploaded/skipped/failed counts

**And when** the same command is run a second time with no source changes
**Then** every object is skipped, nothing is re-uploaded, and the run exits `0`

**And when** the run is interrupted partway and restarted
**Then** it resumes without re-uploading completed objects and without
corrupting the index (which is written last)

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `scripts/src/lib/catalog/__tests__/publish.test.ts` + a live run against the real bucket | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: full publish run; interrupt with `SIGINT` at ~50%; restart; confirm resume and a consistent final index.

**Watch Points**:
- 🔴 Existence checks must not be one `HEAD` per object — 12,707 sequential round trips will dominate the runtime. List the bucket by prefix once and diff in memory.
- The MIME map in `upload_assets.ts` is the existing source of truth; a wrong `Content-Type` on `.webp` or `.webm` breaks rendering and audio in the browser silently.
- Content-addressed keys mean the extension is cosmetic but **must still be correct** — some CDNs and browsers sniff it.
- 12,707 objects against the R2 free tier's 1M Class A operations/month is comfortable, but a naive re-upload-everything run costs 12,707 writes each time. Idempotency is a cost control, not just a nicety.

### AC-2: A browsable catalog index is published and stays small

**Given** the assets are uploaded
**When** the index is generated
**Then** `index/v1/catalog.json` validates against `CatalogIndexRootSchema`
(category summaries and counts only, no per-asset entries), its `totalCount`
equals the number of published assets, and the root index is **under 256 KB
gzipped**

**And** each category shard (`index/v1/<category>.json`) validates against
`CatalogIndexShardSchema`, every entry's `hash` resolves to a real object, and
each shard stays under 1 MB, with LPC sharded further by subcategory if it
exceeds that

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit + Integration | `packages/shared/schemas/src/lib/catalog/catalog_index.test.ts`, `scripts/src/lib/catalog/__tests__/index_generation.test.ts` | `https://assets.bearlysleeping.com/index/v1/catalog.json` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run schemas:test`, `bun moon run scripts:test`
- Integration: fetch the published index over the public custom domain and validate it.

**Watch Points**:
- 🔴 The existing `manifest.json` is **7 MB** for these same 12,707 assets. A naive one-entry-per-asset root index will be the same size and unusable for browsing. The root index must carry category summaries and counts; per-asset entries belong in shards fetched on demand.
- Assert the size budget in a **test**, not in a review comment. It will be exceeded by accident within two contracts otherwise.
- The index must be written after all uploads succeed. An index referencing a hash that failed to upload is worse than no index — it produces 404s the client will cache.

### AC-3: The public origin serves bytes anonymously with correct caching

**Given** the custom domain `assets.bearlysleeping.com` is configured and live
**When** an asset URL from the index is fetched with no credentials
**Then** it returns `200` with the correct `Content-Type`, a one-year immutable
`Cache-Control`, and a body whose sha256 equals the `hash` in the index entry

**And when** the index URL is fetched
**Then** it returns `200` with a short `Cache-Control` (60s or less)

**And when** a write is attempted anonymously
**Then** it is rejected

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | Manual `curl -I` transcripts for asset, index, and rejected write | Public origin URL | Filled during verification |

**Test Hooks**:
- Integration: `curl -I` each of the three cases; verify the asset body hash matches the index.

**Watch Points**:
- 🔴 Verify the bucket does not permit anonymous **writes** or **listing**. A public-read bucket that is also publicly listable exposes every unreleased asset you stage there.
- Verify egress is actually flowing through the R2 custom domain and not through a proxy that reintroduces egress cost — the free-egress property (D-13) is the entire reason R2 was chosen, and routing through a worker or another CDN can quietly forfeit it.
- CORS must permit the hub's origin for the index fetch, since C-396 will fetch it from the browser.

### AC-4: License and attribution travel with every asset

**Given** the LPC credit sidecar produced by the collector (see below)
**When** the publish command runs
**Then** it performs an **attribution preflight before uploading a single
object**: every asset must resolve to either a `CREDITS.csv` row or an explicit
project-owned licence declaration, and every LPC entry carries its upstream
`licenses`, `authors` and `sourceUrls` verbatim

**And when** any asset resolves to neither
**Then** the command **exits non-zero before any upload begins**, naming every
unresolved tag, and **no index is written** — a partially-credited index is
never published

**And** a test asserts that no entry is silently assigned a permissive licence
or a silently-empty `authors` array

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `scripts/src/lib/catalog/__tests__/license_capture.test.ts` | N/A | Filled during verification |
| AC-4 | Integration | `scripts/src/lib/catalog/__tests__/publish_preflight.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run scripts:test`
- Integration: run the real publish command against a fixture containing one
  deliberately unmatched tag. Assert **all three**: non-zero exit, zero objects
  uploaded, and no index object written. A test that only asserts the exit code
  does not prove the gate fired *before* the upload phase — which is the whole
  point of making it a preflight.

> 🔴 **Scope the gate to every asset, not just `lpc:`.** Restricting the check
> to LPC tags leaves a loophole where music, maps and sprites publish with empty
> attribution and the pipeline still reports success. Non-LPC assets have no
> `CREDITS.csv` row, so they need an explicit project-owned licence declaration
> to satisfy the preflight — and writing that declaration is the point, because
> it forces the question to be answered once rather than defaulted forever.

**How the join works** — verified 2026-08-15, the data is fully recoverable:

- The upstream generator is vendored at
  `examples/Universal-LPC-Spritesheet-Character-Generator/` and ships
  **`CREDITS.csv` — 13,787 rows**, columns `filename,notes,authors,licenses,urls`,
  keyed by the spritesheet path relative to `spritesheets/`
  (e.g. `body/bodies/male/spellcast.png`).
- `collect_lpc_assets.ts` already computes exactly that key:
  `relative(SPRITESHEETS_DIR, fullPath)` at line 160, and carries the source
  path through as `entry.path` into its `{ src, dst }` manifest at line 449.
  **The join key is already in hand at the moment the output file is named** —
  nothing needs reconstructing.
- The mapping is 1:1 (`bestPerState` picks one source PNG per output state) and
  deterministic, so even though `.lpc_manifest.json` is an ephemeral
  `--convert`-only artifact that is not committed, re-running the collector
  regenerates it exactly. No information was destroyed.

**Implementation**: in the collector, look up `CREDITS.csv` by `entry.path` and
emit a `lpc_credits.json` sidecar keyed by the **output** asset tag. `scan_assets.ts`
merges that sidecar into the manifest the same way it already merges
`asset_hashes.json`. Non-LPC assets resolve through a committed project-owned
declaration, `scripts/src/lib/catalog/project_licenses.json`, keyed by tag with
the same `CatalogAssetEntry` license/author/source fields; `scan_assets.ts`
merges it the same way. The index generator reads both from there, and the
preflight fails on any tag present in neither source.

**Watch Points**:
- 🔴 **Do not normalise to SPDX.** LPC's licenses include `OGA-BY 3.0`, which has no SPDX identifier. Store the upstream strings verbatim; inventing a mapping is how an incorrect license claim gets baked in across 12,707 files.
- 🔴 Multi-licensing is the norm, not an edge case — `"OGA-BY 3.0,CC-BY-SA 3.0,GPL 3.0"` means the recipient may choose one. The field must be an array and the UI must render all of them, never the first.
- 🔴 Empty arrays must **abort the publish**, not publish. An unmatched tag means the collector's key derivation drifted from `CREDITS.csv` — a silent empty attribution on a CC-BY-SA asset is a licence violation, and it will not be noticed by looking at the page. The gate runs as a **preflight**, before the upload phase: failing after 12,707 uploads still burns the Class A operations and leaves orphaned objects in the bucket.
- 🔴 There must be **no `--skip-credits`, `--force` or equivalent bypass flag**. The one time someone needs to publish urgently is exactly the time the gate matters, and a bypass added "temporarily" is how this ends up permanently off. If an asset genuinely has no recoverable provenance, the fix is to declare it explicitly — which is a reviewable diff — not to skip the check.
- The `assets` table's existing `license`/`attribution` columns (`migrations.ts:194-195`) are **singular TEXT** and cannot hold this shape. Do not widen the device schema in this contract — serialise for the index here, and let C-397 decide what the device needs when it actually consumes it.
- Attribution has to reach the *player*, not just the catalog page. C-396 AC-3 renders it; a future pack-install path must carry it too. Publishing the data is necessary but not sufficient for compliance.

## Implementation Sequence

1. **Phase 1 (Decide)**: the bucket and S3 credentials already exist. Confirm the credentials reach GSM for CI, wire `originUrl` as injected configuration (never a constant), and decide whether `upload_assets.ts` is retargeted or superseded — record the decision. Record the category boundary too: the catalog publishes exactly what `scan_assets.ts` emits (music/sfx/ambient/sprites/backgrounds/lpc); `maps/` and `sprites/tilesets/` stay out (see Edge Cases). The custom domain is NOT a prerequisite; see Open Question 1.
2. **Phase 2 (Publish pipeline)**: content-addressed uploader with a prefix-listing diff, concurrency pool, and resumability. Verify AC-1.
3. **Phase 3 (Licence capture + preflight gate)**: extend the collector to emit the credits sidecar and the scan to carry it; add the project-owned licence declaration for non-LPC assets; implement the preflight as a **hard gate ahead of the upload phase**, with no bypass flag. Verify AC-4.
4. **Phase 4 (Index)**: TypeBox schemas, index + shard generation with size budgets asserted in tests, published last. Verify AC-2.
5. **Phase 5 (Origin verification)**: caching headers, anonymous read, rejected write, CORS — against the live custom domain `assets.bearlysleeping.com` (Open Question 1 resolved). AC-3 completes in this pass.
6. **Phase 6 (Docs)**: developer publishing guide.

## Edge Cases & Gotchas

- **The 7 MB `manifest.json` is a warning, not a template.** It is the reason the index must be sharded. Reusing its shape for a browse document reproduces the problem at CDN scale.
- **`static/ort` is 76 MB and is not catalog content** — it is the ONNX runtime. Do not sweep it into the catalog because it happens to live under `static/`.
- **`static/game-data/maps/` and `sprites/tilesets/` are dev-only and not catalog content either.** They are not scan categories (`ASSET_CATEGORIES` has no `maps`/`tilesets` keys) and hold sandbox/debug files. Keep them out of the catalog; if real map/tileset catalog content ever exists, extend `ASSET_CATEGORIES` in a follow-up contract — changing it here would alter the client's boot manifest, which this contract must not do.
- **Content addressing changes the meaning of "update an asset".** There is no update; there is a new object and a new index entry. Any tooling that assumes a stable path per asset needs to move to tag→hash resolution through the index.
- **R2 is S3-compatible but not S3.** Multipart thresholds, conditional headers, and listing semantics differ in small ways. Prefer an S3 client configured against R2's endpoint over a Cloudflare-specific SDK, so the origin stays swappable — the same portability argument as I-9 for Neon.
- **Free tier**: 10 GB storage, 1M Class A ops/month, unlimited egress. The current library is ~93 MB, so storage is not a concern; **write operations** are the metric to watch, which is what makes AC-1's idempotency a cost control.
- **Do not delete the Firebase Storage copies in this contract.** They are the live fallback until C-397 lands.

## Open Questions

Must be resolved before status becomes `approved`:

1. **Public hostname — RESOLVED 2026-08-15: `assets.bearlysleeping.com` is
   live.** The bucket, S3 credentials and the **custom domain** all exist and
   the domain is serving (see State & Data Models). AC-3 is no longer
   deferred and is verifiable in full against the production origin.

   The content-addressed design means this lands with zero re-upload work:
   objects are addressed by hash, and `CatalogIndex.originUrl` is a variable —
   a publish run pointed at the final hostname re-uploads **zero bytes** and
   only regenerates the index.

   - **Phases 2–5 proceed against the live domain.** AC-1, AC-2 and AC-4 are
     verifiable with the S3 credentials; AC-3 is now verifiable over
     `https://assets.bearlysleeping.com` directly.
   - **`originUrl` remains injected configuration.** The domain being live
     does not change the first-commit rule: no hardcoded hostname anywhere,
     including in test fixtures — that coupling is exactly what breaks a
     later origin change.

   **Remaining action:** verify AC-3 end to end against
   `assets.bearlysleeping.com` — anonymous read, one-year immutable
   `Cache-Control` on assets, short cache on the index, rejected anonymous
   write, and CORS for the hub's origin — before C-396 or C-397 ships to
   production. AC-3 remains the sole gate on promotion past `sandbox`.
2. **Does the publish pipeline run from CI or stay a local ops command?** A 93 MB publish from a developer machine is fine today; it stops being fine when C-398 lets members submit content that needs publishing on approval. If CI, this contract also adds a `catalog` entry to `deployment_config.ts` — which means a second new `ServiceType` on top of C-394's `database-migration`, and the same `resolve_plan.ts` compile tripwire applies.
3. **Per-asset LPC attribution — RESOLVED 2026-08-15: fully recoverable, no separate contract needed.** The upstream generator is vendored in-tree with a 13,787-row `CREDITS.csv`, and `collect_lpc_assets.ts` already derives the exact join key (`relative(SPRITESHEETS_DIR, fullPath)`, line 160) and carries the source path into its `{ src, dst }` manifest (line 449). The lookup is a CSV parse and a map at a point in the code where both halves of the mapping are already present. AC-4 was rewritten against the real data shape: arrays of `licenses`/`authors`/`sourceUrls` held verbatim, **not** a single SPDX string — LPC publishes `OGA-BY 3.0`, which has no SPDX identifier, and multi-licensing is normal.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.4.0 | 2026-08-15 | Resolved Open Question 1 in full: the custom domain `assets.bearlysleeping.com` is live and serving, so AC-3 is no longer deferred. Removed the deferral note and the `r2.dev` fallback guidance from AC-3, Open Question 1 and Phase 5; the domain being live does not relax the `originUrl`-is-configuration rule (no hardcoded hostname, even in fixtures). AC-3 can now be verified against the production origin and remains the sole gate on promotion past `sandbox`. | snorreks (via Claude) |
| 2.3.0 | 2026-08-15 | Hardened AC-4's attribution gate on user instruction. It now runs as a **preflight before the upload phase** (failing after 12,707 uploads burns Class A ops and orphans objects), covers **every** asset rather than only `lpc:` tags (closing the loophole where music/maps/sprites publish uncredited and the run still reports success), forbids any bypass flag, and gains an integration-level evidence row asserting non-zero exit **and** zero uploads **and** no index written — a unit test alone cannot prove the gate fired before uploading. Added a Legal/compliance quality requirement so the gate is a stated requirement rather than only an AC. | snorreks (via Claude) |
| 2.2.0 | 2026-08-15 | Resolved Open Question 3 — per-asset LPC attribution is recoverable from the vendored `CREDITS.csv` (13,787 rows) via a join key `collect_lpc_assets.ts` already computes; not a separate contract. Corrected the `CatalogAssetEntry` licence model from a single SPDX string to verbatim `licenses`/`authors`/`sourceUrls` arrays, because LPC uses the non-SPDX `OGA-BY 3.0` and multi-licensing is the norm. AC-4 rewritten to require 100% tag coverage with a build failure on any miss. | snorreks (via Claude) |
| 2.1.0 | 2026-08-15 | Recorded the provisioned bucket (`aikami-catalog`, WEUR, Standard) and the maintainer's `CLOUD_FLARE_BUCKET_*` credential names, placed in `scripts/.env.*` rather than the hub's env — the hub never writes to R2 (I-7), and every non-`PUBLIC_` key in a hub env file is shipped to Cloud Run as a secret by `buildSecretArgsFromEnvFile`. Partially resolved Open Question 1: the custom domain is deferred pending a DNS migration, which does **not** block the contract because `originUrl` is a variable in a content-addressed index — re-pointing it later re-uploads zero bytes. AC-3 marked deferred and made the sole gate on promotion past `sandbox`. | snorreks (via Claude) |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

## Execution Report

### Summary

Built the full R2 catalog publish pipeline: a content-addressed uploader (Bun S3 client + presigned PUT for exact Cache-Control), the AC-4 attribution preflight as a hard gate before any upload, TypeBox schemas for the root index + category shards with size budgets asserted in tests, and a live first publish of all 12,704 catalog assets to `aikami-catalog` (55.3 MB, 317 s, idempotent re-run). Extended the LPC collector to emit committed `lpc_credits.json` + `lpc_credits_supplement.json` sidecars and scan_assets to merge them with the committed `project_licenses.json` into `asset_credits.json`. AC-3 verifies against the live origin except bucket CORS, which the available credentials cannot configure (maintainer action documented below). Decision recorded: the pipeline stays a local ops command (Open Question 2), and `upload_assets.ts`/`upload_lpc_assets.ts` are superseded for R2 but left untouched (Firebase Storage mirror stays per Out of Scope).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Live publish: 12,704 uploaded (0 failed), content-addressed keys `assets/<sha[0:2]>/<sha>.<ext>`, correct MIME + `Cache-Control: public, max-age=31536000, immutable`; second run 0 uploaded / 12,704 skipped / exit 0; resume + index-written-last covered by `publish.test.ts`; 317 s < 10 min target |
| AC-2 | ✅ | Root index validates (summaries only, `totalCount` 12,704) and is far under 256 KB gz; LPC shard 639 KB gz < 1 MB (no split needed at current scale; subcategory split path covered by test); every shard entry hash resolves to a real object (hash-match verified over the live domain); size budgets asserted in `index_generation.test.ts` |
| AC-3 | ⚠️ | 8/9 sub-checks pass against `assets.bearlysleeping.com`: anonymous asset read 200 + hash match + one-year immutable cache + correct Content-Type; index 200 + 60 s cache; anonymous write rejected (401). **CORS missing** — no rule on the bucket, and neither credential can set it (S3 keys: AccessDenied on PutBucketCors; REST token: 403 on `/r2/buckets/*`). Maintainer must add the CORS rule in the R2 dashboard (exact rule in Deviations). |
| AC-4 | ✅ | Preflight runs before any upload (unit + integration tests assert non-zero result, zero uploads, no index object, unresolved tags named); covers every catalog tag; no bypass flag; LPC licenses/authors/sourceUrls verbatim (never SPDX-normalised); empty licenses OR empty authors both fail; `project_licenses.json` declares the 5 non-LPC tags |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/catalog/catalog_index.ts` | TypeBox schemas: `CatalogAssetEntry`, `CatalogIndexRoot`, `CatalogIndexShard`, `CatalogAssetCredit` (strict objects, `additionalProperties: false`) |
| `packages/shared/schemas/src/lib/catalog/catalog_index.test.ts` | 25 schema tests (AC-2/AC-4 shape contracts) |
| `packages/shared/types/src/lib/game/catalog_index.ts` | Static-derived catalog types (mirror pattern) |
| `scripts/src/lib/catalog/config.ts` | Env resolution (`CLOUD_FLARE_BUCKET_*`, `CATALOG_ORIGIN_URL`, `CATALOG_BUCKET`), MIME map, layout constants |
| `scripts/src/lib/catalog/content_address.ts` | Content-addressed key derivation |
| `scripts/src/lib/catalog/upload.ts` | R2 client (Bun S3Client, prefix-listing diff, presigned-PUT for exact headers) + concurrency pool + counts |
| `scripts/src/lib/catalog/preflight.ts` | Attribution preflight gate (AC-4) + catalog path exclusion (`maps/`, `sprites/tilesets/`) |
| `scripts/src/lib/catalog/catalog_entries.ts` | Loads manifest + hashes + credits into catalog entries |
| `scripts/src/lib/catalog/index_generation.ts` | Root + shard generation with gzip size budgets + subcategory split |
| `scripts/src/lib/catalog/pipeline.ts` | Orchestration: preflight → upload → index (written last), report + non-zero exit |
| `scripts/src/lib/catalog/publish.ts` | CLI entry (`bun run scripts/src/lib/catalog/publish.ts --mode production`) |
| `scripts/src/lib/catalog/lpc_credits.ts` | CREDITS.csv parser + tiered join (exact / same-asset / `${head}` template) + output-tag derivation + supplement credit |
| `scripts/src/lib/catalog/project_licenses.json` | Committed project-owned declaration for the 5 non-LPC catalog tags |
| `scripts/src/lib/catalog/__tests__/license_capture.test.ts` | 24 tests: CSV parsing, tag derivation, tiered resolution, no-SPDX rule |
| `scripts/src/lib/catalog/__tests__/publish.test.ts` | AC-1 pipeline tests (keys, MIME/cache, idempotency, resume, index-last, preflight abort) |
| `scripts/src/lib/catalog/__tests__/publish_preflight.test.ts` | AC-4 gate tests incl. integration (non-zero + zero uploads + no index) |
| `scripts/src/lib/catalog/__tests__/index_generation.test.ts` | AC-2 tests: validation, size budgets, split, totalCount, cross-field consistency |
| `scripts/src/lib/catalog/__tests__/fixtures.ts` | Fixture game-data + in-memory fake R2 client |
| `apps/frontend/client/static/game-data/lpc_credits.json` | Committed LPC attribution sidecar (11,706 tags, CREDITS.csv join) |
| `apps/frontend/client/static/game-data/lpc_credits_supplement.json` | Committed library-level declarations for 993 LPC tags CREDITS.csv does not cover |
| `apps/frontend/client/static/game-data/asset_credits.json` | Merged attribution sidecar emitted by scan_assets (12,704 tags) |
| `apps/frontend/docs/src/content/docs/guides/publishing-catalog-assets.mdx` | Developer publishing guide |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/index.ts` | Export catalog_index schemas |
| `packages/shared/types/src/index.ts` | Export catalog_index types |
| `scripts/src/lib/ops/collect_lpc_assets.ts` | Emits `lpc_credits.json` + `lpc_credits_supplement.json`; parsePath moved to `lpc_credits.ts` (single key source of truth) |
| `scripts/src/lib/ops/scan_assets.ts` | Merges lpc credits + supplement + project_licenses into `asset_credits.json` |
| `scripts/.env.example` | Documents `CATALOG_ORIGIN_URL` / `CATALOG_BUCKET` |
| `apps/frontend/client/static/game-data/manifest.json` | `scannedAt` bump (natural scan output) |
| `apps/frontend/client/static/game-data/asset_hashes.json` | `scannedAt` bump (natural scan output) |

### Deviations from Spec

1. **AC-4 CREDITS.csv coverage is not 1:1 (contract claim verified wrong at scale).** The contract asserted the LPC join is "1:1 and deterministic… fully recoverable". Reality (verified against the real data): the generator's on-disk tree has 144,699 PNGs vs 13,465 parseable CREDITS.csv rows; the collector's `bestPerState` picks nested/colour/animation variant files that CREDITS.csv does not credit by exact path. Only ~45% match exactly; exact + same-asset fallback (zero credit ambiguity measured across all 12,699 states) + `${head}` template matching resolve 11,706 (92.2%). The remaining 993 LPC tags genuinely have no per-file upstream credit (e.g. `eyes/human/*` has zero CREDITS rows). Resolution per AC-4's own guidance ("declare it explicitly — a reviewable diff"): the collector emits a committed `lpc_credits_supplement.json` declaring LPC-library-level provenance (triple license + LPC contributors + OpenGameArt URLs) for those tags; the preflight treats it as a declaration source and still hard-fails any tag in none of the three sources. No bypass flag was added. **Proposed Amendment**: add `lpc_credits_supplement.json` as a recognised declaration source in AC-4's "How the join works" and State & Data Models, and note the tiered join (exact → same-asset → `${head}` template → supplement).
2. **AC-3 CORS is not configured and cannot be configured with the available credentials.** The bucket has no CORS rule: OPTIONS preflight on the custom domain returns 403, GET with `Origin` returns no `access-control-allow-origin`. The S3 credentials return AccessDenied on `PutBucketCors`; the `CLOUD_FLARE_BUCKET_TOKEN` returns 403 on `/r2/buckets/*` (token lacks Workers R2 Storage permission, though it can list accounts). **Required maintainer action** (R2 dashboard or a token with R2 bucket Edit): apply a CORS rule on `aikami-catalog` for `https://hub.bearlysleeping.com`, `https://hub.stg.bearlysleeping.com`, `https://aikami.bearlysleeping.com` with methods GET/HEAD and `Access-Control-Allow-Headers: *`. Every other AC-3 sub-check verifies against the live origin.
3. **Open Question 2 — decision recorded**: the publish pipeline stays a local ops command. No `catalog` `ServiceType`/deploy entry added (would have duplicated C-394's `database-migration` tripwire); revisit when C-398 needs approval-triggered publishing.
4. **Phase 1 decision recorded**: `upload_assets.ts`/`upload_lpc_assets.ts` are superseded for R2 by the content-addressed pipeline but left unchanged — they still serve the Firebase Storage mirror, which Out of Scope keeps until C-397 proves the R2 path.
5. **Preflight strictness**: an entry with empty `licenses` OR empty `authors` fails (contract text: "Empty arrays must abort the publish"; test asserts no silently-assigned permissive licence and no silently-empty authors array).

### Test Results

- Unit: 250/250 scripts (203 baseline + 47 new catalog tests; 0 failures), 375/375 schemas (25 new), 48/48 frontend-storage (baseline)
- E2E: N/A (no UI in this contract)
- Visual: N/A
- Baseline: 0 pre-existing failures; 0 new failures
- Live: publish 12,704 objects (55.3 MB, 317 s), re-run 0 uploaded / 12,704 skipped, exit 0; AC-3 origin checks 8/9 (CORS pending maintainer action)
