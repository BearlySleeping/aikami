---
id: C-373
title: "Turso Asset Registry & Hybrid OPFS Cache Engine"
source: "architecture_proposal"
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-02"
---

# Contract C-373: Turso Asset Registry & Hybrid OPFS Cache Engine

## Metadata

| Field | Value |
|---|---|
| **Source** | Architecture proposal for offline-first asset distribution (AST-02) |
| **Target** | `packages/frontend/repositories` (Turso schema + asset registry repository) + `apps/frontend/client/src/lib/services/assets/` (AssetManager + cache backends) + `scripts/src/lib/ops/scan_assets.ts` (hash sidecar) + `packages/shared/types` (registry/source/install-state types) |
| **Priority** | P1 — Enables fully offline play, background asset prefetching, and multi-source distribution |
| **Dependencies** | C-372 (AST-01 — manifest resolver, status `implemented`), C-321 (Turso persistence: `AIKAMI_SCHEMA_DDL`, `LocalDatabaseInterface`, `getLocalDatabase` factory, `wasm_storage_adapter`), C-203 (`OpfsAssetCache` OPFS pattern), C-243 (manifest types — reused as-is) |
| **Status** | approved |
| **Promotion** | `integrated` |
| **Docs Impact** | `apps/frontend/docs/src/content/docs/architecture/assets.md` |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Asset metadata relies solely on the static `apps/frontend/client/static/game-data/manifest.json` (12,704 entries after C-372), fetched once via `assetStore.fetchManifest()` and resolved in-memory by `resolveUrl(tag)`. Asset binaries are re-fetched over HTTP on every session — there is no offline persistence across sessions and no content-hash-based freshness check. `packages/frontend/repositories/src/lib/opfs_asset_cache.ts` (C-203's `OpfsAssetCache`) exists and is exported, but has **zero production call sites** (`grep "OpfsAssetCache" apps/` → no matches) and is keyed by URL with a weak djb2 hash — no SHA-256 verification, no registry of what is installed, no stale detection.
- **Reproduction**:
  1. Open `/game` while online and let all sprites/audio load.
  2. Disconnect the network and refresh the page.
  3. Observed: the manifest loads (static file) but every binary re-fetches and fails; the game degrades or errors on un-cached sprites/audio. No asset-version tracking exists to detect stale cached copies.
- **Existing implementation to reuse**:
  - `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts` — manifest fetch + `resolveUrl(tag)` → `/game-data/<path>` (C-372/C-243). Keep as the URL resolver; back it with the registry.
  - `packages/frontend/repositories/src/lib/storage_adapter.ts` — `LocalDatabaseInterface` (query/execute/transaction/sync/close), `AIKAMI_SCHEMA_DDL` (the idempotent migration array — the single place local schema DDL lives), `LOCAL_DB_FILE`.
  - `packages/frontend/repositories/src/lib/local_database_factory.ts` — `getLocalDatabase()` platform-selecting factory (native `TursoStorageAdapter` if `@tursodatabase/database` loads, else `WasmStorageAdapter`); applies `AIKAMI_SCHEMA_DDL` idempotently; one shared connection per session. Already consumed by client repositories (`campaign_repository.svelte.ts`, `conversation_repository.svelte.ts`, `player_journal_service.svelte.ts`, etc.).
  - `packages/frontend/repositories/src/lib/opfs_asset_cache.ts` — OPFS handle acquisition (`navigator.storage.getDirectory()`), `navigator.storage.persist()` request, FIFO `_evictIfNeeded` — patterns to adopt in the new content-hash-keyed backend.
  - `apps/frontend/client/src-tauri/` — `tauri-plugin-fs = "2"` already in `Cargo.toml` and registered via `tauri_plugin_fs::init()` in `src/lib.rs`; only the npm `@tauri-apps/plugin-fs` client dependency is missing.
  - `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` — staged, cancellable boot pipeline (`loading_campaign → validating_save → preloading_content → creating_engine → hydrating_snapshot → spawning_entities`) — the wiring point for registry init/seeding.
  - `scripts/src/lib/ops/scan_assets.ts` — the manifest generator (consumes shared `ASSET_CATEGORIES`, emits `manifest.json`); extended to emit the hash sidecar.
  - `packages/frontend/repositories/src/lib/__tests__/storage_adapter.test.ts` — existing baseline for the DB layer.
- **Known gaps**: No `assets` / `asset_sources` / `install_state` tables in `AIKAMI_SCHEMA_DDL`; no content-hash provenance for manifest assets (C-372 deliberately kept `AssetEntry` without `hash`/`sizeBytes` — see Open Questions); no OPFS binary cache wired into the asset pipeline; no Tauri native-disk cache backend; no stale/versioned eviction.
- **Baseline tests** (run before starting):
  - `moon run client:test` — includes `apps/frontend/client/src/lib/services/assets/asset_store.test.ts` (C-372)
  - `moon run frontend-repositories:test` — includes `packages/frontend/repositories/src/lib/__tests__/storage_adapter.test.ts`
  - `moon run client:build` — manifest/bundle gate

## User Outcome

After this contract, players can run the game completely offline once assets have been fetched. The game automatically verifies content hashes via the embedded Turso database, purges stale cached binaries when new versions are released, and resolves every asset from OPFS (Web/PWA) or the Tauri native disk cache (Desktop) with no network round-trip.

## Success Measures

- **Time/latency target**: Cached asset resolution (registry lookup + OPFS/Tauri read) returns the asset in **<10ms per item** after the first open of the session; first-boot registry seeding adds **≤~2s** (chunked — see Performance budget) and subsequent boots add only the meta-guard check (~ms).
- **Offline/degraded behavior**: Game boots and renders all pre-fetched assets with no internet connection and no Firebase connection. Missing/optional assets resolve to a graceful fallback (existing `LPC_DEFAULT_*` behavior from C-372/C-325) with a logged warning — never a crash.
- **Production journey enabled**: A player on the PWA or the Tauri desktop build plays `/game` fully offline with cached sprites, LPC layers, tilemaps, and audio; a new game build automatically invalidates stale cached binaries via hash mismatch.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Turso schema + DB interface | `packages/frontend/repositories/src/lib/storage_adapter.ts` (`AIKAMI_SCHEMA_DDL`, `LocalDatabaseInterface`) | **Modify** — append `assets`, `asset_sources`, `install_state` tables + indexes to the DDL array |
| DB platform factory | `packages/frontend/repositories/src/lib/local_database_factory.ts` (`getLocalDatabase`) | **Reuse** — registry repository consumes the shared connection |
| WASM/OPFS DB adapter (browser + Tauri webview) | `packages/frontend/repositories/src/lib/wasm_storage_adapter.ts` | **Reuse** — unchanged |
| OPFS binary caching patterns | `packages/frontend/repositories/src/lib/opfs_asset_cache.ts` (`OpfsAssetCache`) | **Replace** — new content-hash-keyed `OpfsCacheBackend` in the client adopts its handle/persist/evict patterns but keys by SHA-256 and verifies hashes |
| Asset tag→URL resolver | `apps/frontend/client/src/lib/services/assets/asset_store.svelte.ts` (`resolveUrl`) | **Modify** — keep as URL source; AssetManager resolves via registry then falls back to `resolveUrl` |
| Manifest types | `packages/shared/types/src/lib/game/game_assets.ts` (`AssetEntry`, `AssetManifest`) | **Reuse** — unchanged (C-372 resolution: no `hash`/`sizeBytes` on `AssetEntry`) |
| Manifest scanner | `scripts/src/lib/ops/scan_assets.ts` | **Modify** — additionally emit `asset_hashes.json` (tag → sha256 + sizeBytes) |
| Tauri FS plugin (Rust side) | `apps/frontend/client/src-tauri/` (`Cargo.toml`, `lib.rs`) | **Reuse** — plugin already registered; add npm `@tauri-apps/plugin-fs` client dep + capabilities scope |
| Boot orchestration | `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts` | **Modify** — add asset-registry init/seed stage before `preloading_content` |

## Overview

This contract implements the Turso-backed asset registry and the hybrid local binary cache layer. We append `assets`, `asset_sources`, and `install_state` tables to the existing idempotent `AIKAMI_SCHEMA_DDL`, add an `AssetRegistryRepository` over the shared `LocalDatabaseInterface`, seed it from `manifest.json` + a new `asset_hashes.json` sidecar on first boot, and build an `AssetManager` that resolves assets through the registry, serves binaries from a content-hash-keyed `AssetCacheBackend` (OPFS on Web, Tauri FS on Desktop), verifies SHA-256 before every cache write, and auto-evicts stale binaries when the registry's authoritative hash advances. Raw binaries never touch SQLite rows — only file paths and metadata.

## Design Reference

- **Resolver-injection pattern**: Follow C-372 — `asset_store.resolveUrl` stays the URL source; the new AssetManager is injected where consumers already receive resolvers (`game_boot_service.svelte.ts`, `game_engine_service.svelte.ts`), keeping the engine unchanged.
- **Idempotent schema migration**: Follow C-321 — extend `AIKAMI_SCHEMA_DDL` with `CREATE TABLE IF NOT EXISTS` statements applied via `getLocalDatabase()`; no separate migration tool. Version/schema drift is tracked in the existing `meta` table if needed.
- **OPFS patterns**: Follow C-203 `OpfsAssetCache` — `navigator.storage.getDirectory()`, `navigator.storage.persist()` on init (warn, never fail, on denial), per-write `createWritable()`/`close()`.
- **Tauri FS**: Follow `tauri-v2` skill — `@tauri-apps/plugin-fs` (`readFile`, `writeFile`, `mkdir`, `remove`) behind a platform guard; dynamic import is justified (platform-specific code). Cache dir under `appDataDir()`.
- **Manifest shape freeze**: Do NOT modify `AssetEntry`/`AssetManifest` (C-372 resolved against adding `hash`/`sizeBytes`). Hash provenance comes from a new `asset_hashes.json` sidecar emitted by `scan_assets.ts`.
- **Boot stage pattern**: Follow C-326 — registry init/seeding slots into the staged pipeline in `game_boot_service.svelte.ts`.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Shared types** (`packages/shared/types/src/lib/game/game_assets.ts`): Add `AssetCacheStatus`, `AssetRecord`, `AssetSource`, `InstallStateRecord` (see State & Data Models). These cross the repositories ↔ client boundary, so they live in `@aikami/types` (per Pillar 2). No TypeBox schema — the local DB is not a cross-boundary wire format; types suffice (consistent with the existing `AIKAMI_SCHEMA_DDL` JSON-blob approach).
- **Schema DDL** (`packages/frontend/repositories/src/lib/storage_adapter.ts`): Append the three asset tables + indexes to `AIKAMI_SCHEMA_DDL` using `CREATE TABLE IF NOT EXISTS` (idempotent; no migration tool). `install_state.status` uses a `CHECK(status IN ('not_downloaded','downloading','cached','stale'))` constraint.
- **Registry repository** (`packages/frontend/repositories/src/lib/assets.ts`, new): `AssetRegistryRepository` — constructor-injected `LocalDatabaseInterface` with thin `query`/`execute` wrappers, matching the local-DB wrapper style of `campaign_repository.svelte.ts`/`npc_schedule_repository.svelte.ts` in the client (⚠️ `chat.ts`/`config.ts` in this package are Firestore `FrontendRepository` singletons — NOT the pattern to copy). Batched transaction seeding (12,704+ manifest rows must be chunked — see Edge Cases). Export from `src/index.ts`.
- **Cache backends** (`apps/frontend/client/src/lib/services/assets/`, new):
  - `cache_backend.ts` — `AssetCacheBackend` interface: `has(hash)`, `get(hash): Promise<Blob | undefined>`, `put({hash, blob})`, `remove(hash)`, `clear()`, `requestPersistence()`.
  - `opfs_cache_backend.ts` — `OpfsCacheBackend`: content-hash-keyed file names under the `aikami-assets` OPFS root; SHA-256 verified before write; `navigator.storage.persist()` on init; `QuotaExceededError` surfaced for the manager to trigger LRU eviction of optional packs.
  - `tauri_fs_cache_backend.ts` — `TauriFSCacheBackend`: `@tauri-apps/plugin-fs` writing hash-named files under `appDataDir()/aikami-assets`; platform-guarded (dynamic import; no-op backend in plain browsers).
  - `asset_manager.svelte.ts` — `AssetManager`: resolves via registry → cache → sources (manifest URL, then source list from `asset_sources`), verifies hashes, updates `install_state`, drives stale eviction, supports download cancellation (AbortController) and resume-safe idempotency.
- **Hash sidecar** (`scripts/src/lib/ops/scan_assets.ts`): While scanning, compute SHA-256 + sizeBytes per file and emit `apps/frontend/client/static/game-data/asset_hashes.json` (`Record<tag, { hash: string; sizeBytes: number }>`). Regenerated together with `manifest.json`; committed.
- **Boot wiring** (`apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts`): Add an `initializing_asset_registry` stage (before `preloading_content`): open the shared DB, run DDL (already handled by `getLocalDatabase`), seed the registry if `meta.asset_registry_seeded` < current `manifest.scannedAt`, init the platform cache backend, request persistence. Timeout budget: reuse `STAGE_TIMEOUT_MS`. **Seeder row derivation**: `id` = manifest tag; `pack_id` = manifest `category`; `version` = 1 on first seed, incremented when a re-seed observes a changed `hash`; `size_bytes`/`hash` from `asset_hashes.json`; `license` falls back to the column default (no per-asset license metadata exists yet); one `asset_sources` row per asset — `backend='bundled'`, `url` = the `resolveUrl` `/game-data/...` path, `priority=0`. Tags missing from the sidecar are skipped — never seeded.
- **Consumer wiring**: The engine continues to receive URLs via the C-372 resolver injection and engine `Assets.load`/audio call sites are unchanged. The AssetManager intercepts binary loads by **wrapping the resolver injection points** (`asset_store.resolveUrl` plus the `wireLpcUrlResolver`/`assetUrlResolver` wiring in `game_boot_service.svelte.ts` and `game_engine_service.svelte.ts`): the wrapped resolver returns `AssetManager.resolve(assetId)` output — a `blob:` object URL (refcounted, revoked after decode) served from the cache — so PixiJS `Assets.load` and `audio_service._loadBuffer(url)` transparently consume cached bytes; unresolved tags keep the C-372 `null` fallback.

## State & Data Models

```sql
-- Appended to AIKAMI_SCHEMA_DDL (packages/frontend/repositories/src/lib/storage_adapter.ts)

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  category TEXT NOT NULL,
  hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  license TEXT NOT NULL DEFAULT 'unknown',
  attribution TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS asset_sources (
  asset_id TEXT NOT NULL REFERENCES assets(id),
  backend TEXT NOT NULL, -- 'bundled' | 'firebase-storage' | 'r2' | 'self-hosted'
  url TEXT NOT NULL,
  priority INTEGER NOT NULL,
  PRIMARY KEY (asset_id, backend)
);

CREATE TABLE IF NOT EXISTS install_state (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id),
  status TEXT NOT NULL CHECK(status IN ('not_downloaded', 'downloading', 'cached', 'stale')),
  local_path TEXT,
  cached_hash TEXT,
  downloaded_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_assets_pack ON assets(pack_id);
CREATE INDEX IF NOT EXISTS idx_install_state_status ON install_state(status);
```

```typescript
// packages/shared/types/src/lib/game/game_assets.ts (additions)

/** Installation status of a single asset in the local cache. */
export type AssetCacheStatus = 'not_downloaded' | 'downloading' | 'cached' | 'stale';

/** Row shape of the `assets` registry table (snake_case column → camelCase). */
export type AssetRecord = {
  id: string;
  packId: string;
  category: string;
  hash: string;
  version: number;
  sizeBytes: number;
  license: string;
  attribution?: string;
  tags?: string[];
};

/** Row shape of the `asset_sources` table — a candidate download origin. */
export type AssetSource = {
  assetId: string;
  backend: 'bundled' | 'firebase-storage' | 'r2' | 'self-hosted';
  url: string;
  priority: number;
};

/** Row shape of the `install_state` table — per-asset cache bookkeeping. */
export type InstallStateRecord = {
  assetId: string;
  status: AssetCacheStatus;
  localPath?: string;
  cachedHash?: string;
  downloadedAt?: string;
};
```

```typescript
// New sidecar shape — emitted by scan_assets.ts, consumed by the boot seeder.
// Keeps AssetEntry/AssetManifest frozen (C-372 resolution).
type AssetHashesFile = {
  scannedAt: string;
  hashes: Record<string, { hash: string; sizeBytes: number }>; // keyed by tag
};
```

## Quality Requirements

- **Offline/degraded mode**: Fully functional offline using cached binaries in OPFS (Web) or Tauri FS (Desktop). Registry + manifest are local reads. Missing optional assets resolve to the existing graceful fallbacks with a logged warning; DB or cache init failure must not block boot — the game continues in online mode and retries seeding on the next boot.
- **Accessibility/input**: N/A — non-UI asset infrastructure; no keyboard/screen-reader surface.
- **Performance budget**: Cached resolve <10ms/item (registry row read + OPFS/Tauri file read). Seeding 12,704 rows must stay under ~2s via batched transactions and must not block first paint (run in the boot stage, chunked). Hashing of large binaries runs off the main thread (chunked SHA-256 via `crypto.subtle`, no full-file copies); OPFS handle read memory overhead under 20MB.
- **Security/privacy**: Verify SHA-256 of every fetched binary against the registry hash **before** writing to cache or serving it; hash mismatch → discard, mark `install_state` stale, log eviction. No PII — assets are public game files. Never store binary blobs in SQLite rows (metadata/paths only).
- **Persistence/migration**: Turso schema migration via `AIKAMI_SCHEMA_DDL` (idempotent). Old databases upgrade in place — the three tables are additive; existing tables untouched. Seed is upsert-by-id, keyed off `meta.asset_registry_seeded` (manifest `scannedAt`).
- **Cancellation/retry/idempotency**: Downloads abortable (AbortController); an interrupted download leaves `install_state='downloading'` and is reconciled back to `not_downloaded` on next boot; re-seeding is idempotent (upsert); cache `put` after verified hash is idempotent.
- **Observability**: Log cache hits (`asset_manager:cache-hit {assetId, ms}`), misses, network fetches, hash-mismatch evictions, `QuotaExceededError` evictions, and seed progress (batched). Use `this.debug/this.warn` in class code per conventions.

## Migration & Rollback

- **Old data compatibility**: Additive DDL only — existing Turso tables (`campaigns`, `saves`, `chat_history`, etc.) are untouched; existing manifest/asset pipeline keeps working because the registry is populated lazily at boot and `resolveUrl` remains the fallback.
- **Migration**: (1) `AIKAMI_SCHEMA_DDL` gains the three tables — applied automatically by `getLocalDatabase()` on next boot. (2) Regenerate `manifest.json` + new `asset_hashes.json` via `scan_assets.ts` (build-time step). (3) Boot seeder populates `assets`/`asset_sources` from both files and records `meta.asset_registry_seeded`.
- **Rollback**: Revert the DDL additions, the client asset-manager wiring, and the sidecar emission in the same commit; the app falls back to the current static-manifest pipeline. Dropping the three tables (if a deployed build must be rolled back cleanly) is safe — `DROP TABLE IF EXISTS assets; asset_sources; install_state;` — since no other feature depends on them.
- **Feature flag or kill switch**: Not required — local-only behavior with online fallback; disabling the registry is a revert. (If one is desired later, gate seeding on a `meta` key.)
- **Failure recovery**: Seed failure mid-way → transaction rollback per chunk, log, mark `meta.asset_registry_seeded` unset, retry on next boot; cache write failure → asset stays `not_downloaded`, next request retries the fetch.

## Scope Boundaries

- **In Scope:**
  - Appending `assets`, `asset_sources`, `install_state` tables + indexes to `AIKAMI_SCHEMA_DDL`.
  - `AssetRegistryRepository` (CRUD + batched seeding) in `packages/frontend/repositories`, exported from the package root.
  - Shared types (`AssetCacheStatus`, `AssetRecord`, `AssetSource`, `InstallStateRecord`) in `packages/shared/types`.
  - `AssetCacheBackend` interface + `OpfsCacheBackend` (Web/PWA) + `TauriFSCacheBackend` (Desktop, `@tauri-apps/plugin-fs`) + `AssetManager` in `apps/frontend/client/src/lib/services/assets/`.
  - `asset_hashes.json` sidecar emission in `scripts/src/lib/ops/scan_assets.ts` (SHA-256 + sizeBytes per tag).
  - Boot wiring: new `initializing_asset_registry` stage in `game_boot_service.svelte.ts`; persistence request; seeding; cache-backend platform selection.
  - Hash verification on every cache write; automatic stale eviction when the registry hash advances; `QuotaExceededError` → LRU eviction of optional asset packs.
  - Unit/integration tests for registry, backends, and manager; offline E2E smoke.
- **Out of Scope:**
  - Community moderation workflow / Firestore-Data Connect bridge (future).
  - Bulk UI download manager screen (future contract AST-03).
  - Changes to `AssetEntry`/`AssetManifest` shapes (C-372 resolution — hashes ship via sidecar, not the manifest).
  - Remote Turso sync (`sync()` remains the configured no-op until C-357).
  - Engine `Assets.load` call-site changes; engine keeps consuming injected resolvers (C-372).
  - Audio mixing/playback UX and the audio service itself.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** 3 ACs, 4 projects touched (`frontend-repositories`, `client`, `scripts`, `shared/types`). The slices are one interdependent unit: the registry is useless without hashes (sidecar), the cache is useless without the registry (freshness), and neither ships without the boot wiring. Splitting would force cross-contract coordination on one shared file (`AIKAMI_SCHEMA_DDL`) and one regenerated artifact pair (`manifest.json` + `asset_hashes.json`). Kept as one contract. The deferred AST-03 (download-manager UI) is explicitly excluded to keep this contract infrastructure-only.

## Acceptance Criteria

### AC-1: Asset Registry Seeding & Querying
**Given** a fresh game installation (empty Turso DB) and a built manifest (`manifest.json` + `asset_hashes.json` in `static/game-data/`)
**When** the game initializes and the `initializing_asset_registry` boot stage runs
**Then** the `assets` and `asset_sources` tables are populated from the bootstrap manifest + sidecar (upsert-by-id, batched), `meta.asset_registry_seeded` is set to the manifest `scannedAt`, and the registry is queryable offline — `AssetRegistryRepository.list()`/`findById()` return rows with correct `hash`, `sizeBytes`, and source priorities; a second boot does **not** re-seed (idempotent).

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `packages/frontend/repositories/src/lib/__tests__/assets_registry.test.ts` (new — seeding, upsert idempotency, meta guard, query) + `apps/frontend/client/static/game-data/asset_hashes.json` (committed artifact) | `/game` boot (registry seed stage) | Filled during verification |

### AC-2: OPFS / Tauri FS Binary Caching with Hash Verification
**Given** an asset request for an uncached asset ID with a known registry hash
**When** `AssetManager.resolve(assetId)` fetches the asset bytes from its highest-priority source
**Then** the binary's SHA-256 is verified against the registry hash before it is written to OPFS (Web) or Tauri FS (Desktop), `install_state` transitions to `cached`, and subsequent requests resolve from the local backend in <10ms with zero network traffic; a corrupt/mismatched download is discarded, logged, and marked `stale`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit / Integration | `apps/frontend/client/src/lib/services/assets/cache_backend.test.ts` (new — OPFS + Tauri FS backends, hash-verify-before-write, mismatch discard) + `apps/frontend/client/src/lib/services/assets/asset_manager.test.ts` (new — resolve flow, <10ms cached hit with mocked backend) | `/game` (sprite/audio loads through AssetManager) | Filled during verification |

### AC-3: Automatic Stale Asset Eviction
**Given** a cached asset whose binary hash is `hash_v1` and a registry row that has been updated to `hash_v2` (new build's manifest/sidecar bump)
**When** the boot seeder upserts the asset row and `AssetManager` processes install state
**Then** the cache entry for `hash_v1` is invalidated (deleted from the backend), `install_state` is updated to `stale`, and the next `resolve()` re-fetches and caches `hash_v2`; the eviction is logged with hash mismatch details.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `apps/frontend/client/src/lib/services/assets/asset_manager.test.ts` (extend — registry hash bump → invalidate + `stale` + re-fetch) | `/game` after a game update | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run frontend-repositories:test && moon run client:test` (unit/integration gates); `moon run client:build` (sidecar + bundle gate)
- Integration: `bun run scripts/src/lib/ops/scan_assets.ts` (regenerate manifest + `asset_hashes.json`, verify the diff); open `/game` in the browser, load assets, then throttle DevTools to Offline and reload — all previously cached assets must render with zero failed requests
- E2E / Visual:
    - **Functional**: `apps/e2e/tests/client/offline_assets.spec.ts` (new) — Playwright: open `/game`, wait for content, then reload with all `/game-data/` requests aborted except `manifest.json`/`asset_hashes.json` (`page.route('**/game-data/**', …)`; deterministic — full `context.setOffline(true)` + `page.reload()` can fail to re-serve the SPA document itself since no service worker covers the document). Assert the game boots and renders with zero failed `/game-data/` requests and no console errors. If E2E flakiness blocks this in the pipeline, a manual browser check with DevTools offline throttling is the fallback evidence.
    - **Visual**: N/A — caching is functional, not visual; render correctness is covered by C-372 LPC visual coverage.

**Watch Points**:
- OPFS file handles must be closed properly (`writable.close()` in `finally`) to avoid lock issues in Web Workers / Svelte re-renders; never hold a handle across `put()` retries.
- `@tursodatabase/database` (Node-native) does **not** load inside the Tauri webview — the DB goes through `getLocalDatabase()` factory (falls back to WASM/OPFS adapter) even on Desktop; the Tauri FS cache backend is separate and native. Do not assume the native DB adapter on Tauri.
- Blob/object URLs handed to PixiJS/audio must be revoked after decode to avoid leaks; use a refcounted object-URL cache.
- Seeding 12,704 rows in one SQLite transaction stalls WASM SQLite — chunk inserts (e.g. 500 rows/transaction) and yield between chunks.
- The `assets.hash` column is authoritative; the sidecar must be regenerated and committed together with `manifest.json` in every release that changes assets, or AC-3 staleness detection silently no-ops.
- `asset_hashes.json` (~12,704 × ~100B ≈ 1.3MB) will exceed Biome's 1 MiB lint cap just like `manifest.json` — extend the existing `biome.json` exclusion when committing the sidecar.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Add shared types (`AssetCacheStatus`, `AssetRecord`, `AssetSource`, `InstallStateRecord`) to `packages/shared/types`. Append the three tables + indexes to `AIKAMI_SCHEMA_DDL`. Build `AssetRegistryRepository` (`packages/frontend/repositories/src/lib/assets.ts`) with batched seeding and upsert; export from the package root. Extend `scan_assets.ts` to emit `asset_hashes.json`. Write `assets_registry.test.ts`; extend `storage_adapter.test.ts` with a table-presence assertion (old-DB upgrade: the three new tables exist after `getLocalDatabase()` applies the appended DDL).
2. **Phase 2 (Integration)**: Implement `AssetCacheBackend` + `OpfsCacheBackend` + `TauriFSCacheBackend` (add `@tauri-apps/plugin-fs` to the client and its capabilities scope). Build `AssetManager` (registry → cache → sources, hash verification, stale eviction, AbortController cancellation). Add the `initializing_asset_registry` boot stage in `game_boot_service.svelte.ts` (persistence request, platform backend selection, seeding). Write `cache_backend.test.ts` + `asset_manager.test.ts`.
3. **Phase 3 (Validation)**: Run `validate()`, `moon run frontend-repositories:test`, `moon run client:test`, `moon run client:build`. Verify offline reload in the browser (DevTools offline) and, if feasible, the offline E2E spec. Confirm no new lint/type violations and zero regressions in `asset_store.test.ts` / `storage_adapter.test.ts`.

## Edge Cases & Gotchas

- **Hash provenance (manifest has no hashes)**: C-372 froze `AssetEntry` without `hash`/`sizeBytes`; the seeder must source hashes from the new `asset_hashes.json` sidecar. Tags missing from the sidecar (absent or stale build) are **skipped — never seeded** (`assets.hash` is `NOT NULL`; no placeholders, no fabricated hashes). They stay manifest-resolved via `resolveUrl` and become cacheable only when a future build ships their hash.
- **QuotaExceededError**: Handle OPFS quota errors gracefully — the manager triggers LRU eviction of optional asset packs (never core packs), then retries the `put` once; if still failing, log and leave the asset `not_downloaded`.
- **OPFS handle lifecycle**: Close every `FileSystemWritableFileStream` in a `finally`; concurrent `put()` calls for the same hash must be deduplicated (single in-flight write promise) to avoid `InvalidStateError`.
- **Tauri FS permissions**: `@tauri-apps/plugin-fs` requires the cache directory in the capabilities scope; verify `apps/frontend/client/src-tauri/capabilities/*.json` covers `appDataDir` writes or `mkdir`+`writeFile` scopes before E2E.
- **Cancelled/interrupted downloads**: Abort leaves `install_state='downloading'`; the boot reconciler resets such rows to `not_downloaded` (with an age heuristic) so retries are safe and idempotent.
- **Large-file hashing**: Compute SHA-256 in chunks (`crypto.subtle.digest` over streamed slices) — do not buffer entire binaries on the main thread; stay under the 20MB overhead budget.
- **12,704-row seed**: Batched transactions (chunked) and `meta.asset_registry_seeded` guard; re-running the scanner must not churn rows unnecessarily (upsert only on changed hash/version).

## Resolved Decisions

The following questions were resolved at critique (C-373 v2.0.0) using the architect's stated recommendations as the binding defaults:

- **Hash provenance**: **Sidecar.** `scan_assets.ts` emits `asset_hashes.json`; `AssetEntry`/`AssetManifest` stay frozen per C-372. Manifest tags without a sidecar entry are **skipped at seeding** (registry `hash` is `NOT NULL` and must never be fabricated).
- **Eviction policy scope**: **`pack_id`-based.** Seeder sets `pack_id` from the manifest `category`; every bundled category seeds as the eviction-protected `core` pack in v1. Core packs are never LRU-evicted; `install_state.downloaded_at` is the LRU age key for future optional packs. Under quota pressure, evict LRU non-core entries first; if none exist, log and leave the asset `not_downloaded`.

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
