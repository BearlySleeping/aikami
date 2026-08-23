---
id: C-432
title: "Content-Addressed R2 Sources — Make the Client's Remote Origin Work"
source: "user request 2026-08-23 — point the client at assets.bearlysleeping.com"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-23"
---

# Contract C-432: Content-Addressed R2 Sources — Make the Client's Remote Origin Work

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-23): *"we already have a R2 bucket https://assets.bearlysleeping.com that has all the lpc assets… We should make client look at the R2 bucket as well."* |
| **Target** | `packages/frontend/storage/src/lib/assets.ts`, `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts`, `apps/frontend/client/.env.*` |
| **Priority** | P0 — the R2 fallback is wired end to end and produces 404s on every URL it writes. Smallest contract in the R2 track and a hard precondition for the rest. |
| **Dependencies** | C-395 (published the bucket and the content-addressed layout — status `implemented`). |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → developer note on the assets origin env var |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: the client's remote-asset path is fully built and
  entirely non-functional. `AssetRegistryRepository.addR2Sources`
  (`packages/frontend/storage/src/lib/assets.ts:174`) writes priority-1
  `asset_sources` rows by **mirroring the bundled relative path** onto the R2
  base URL:
  ```ts
  args: [assetId, `${base}/${storagePath}`],   // → https://assets.bearlysleeping.com/lpc/body/bodies_male.walk.webp
  ```
  Its doc comment states *"Assets must be uploaded to the bucket under their
  manifest path."* **They are not.** C-395 publishes content-addressed keys:
  `assets/<sha256[0:2]>/<sha256>.<ext>`. Every URL this function writes 404s.

- **Reproduction** — verified live against the production bucket 2026-08-23:
  ```bash
  H=d03f92f9ef31d17f4ef9ddbaaa965c8fa48482de70df61b43cbe9ae825ea7698   # lpc:body:bodies_male:walk
  curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
    "https://assets.bearlysleeping.com/assets/${H:0:2}/$H.webp"        # → 200 16182
  curl -s -o /dev/null -w "%{http_code}\n" \
    "https://assets.bearlysleeping.com/lpc/body/bodies_male.walk.webp"  # → 404
  curl -s "https://assets.bearlysleeping.com/index/v1/catalog.json"     # → 200, totalCount 12704
  ```
  The 16182-byte response matches `asset_hashes.json` exactly for that tag.

- **Current behavior — the code path never even runs.**
  `game_boot_service.svelte.ts:720` reads `publicEnv.PUBLIC_ASSETS_BASE_URL` and
  skips `addR2Sources` entirely when it is falsy. The variable is declared in
  `apps/frontend/client/src/env.d.ts:20` and **set in no `.env.*` file**. So the
  R2 fallback is doubly dead: unset, and wrong if set.

- **Existing implementation to reuse** — everything except the key derivation
  already works:
  - `AssetManager.resolve` (`apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts` ~line 448)
    already lists sources by priority, fetches each in turn, **verifies SHA-256
    against the registry hash before caching or serving**, discards on mismatch
    and continues to the next source, caches to OPFS or Tauri FS, handles quota
    with LRU eviction, and hands back refcounted blob URLs.
  - `assets.hash` in the registry **is** the sha256 that forms the R2 key. The
    correct URL is derivable from data already in the row — no network call and
    no extra index fetch.
  - `assets.bearlysleeping.com/index/v1/catalog.json` is live and current.
  - `AssetStore.resolveUrl` already prefers a cached blob URL, warms in the
    background and falls back to the bundled static path.

- **Known gaps**: the key scheme, the unset env var, and the stale doc comment
  pointing at `upload_lpc_assets.ts` as the uploader.

- **Baseline tests**: `bun moon run frontend-storage:test` (covers
  `addR2Sources` at `packages/frontend/storage/src/lib/__tests__/assets_registry.test.ts:149`
  — **these tests currently assert the broken path-mirrored URL and must be
  updated**), `bun moon run client:test-unit`. Both must pass before starting.

## User Outcome

After this contract, a **player** whose bundled asset is missing, corrupt or
de-bundled transparently receives it from the CDN, verified by hash and cached
locally — instead of the silent 404 the fallback produces today.

## Success Measures

- **Time/latency target**: a cache-miss asset fetched from R2 resolves in under
  500ms on a warm CDN edge. A cache hit stays at zero network traffic.
- **Offline/degraded behavior**: unchanged and load-bearing — the bundled
  source stays priority 0, so an offline client never touches the network. An
  unreachable R2 origin degrades to exactly today's behaviour.
- **Production journey enabled**: this is the precondition for C-433, C-434 and
  C-435 — none of which can ship a working remote fetch without it.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Source priority + fetch + sha256 verify + cache | `asset_manager.svelte.ts` `resolve` | reuse unchanged |
| R2 source row writer | `packages/frontend/storage/src/lib/assets.ts` `addR2Sources` | modify — content-addressed key derivation |
| Registry hash per asset | `assets.hash` column, seeded from `asset_hashes.json` | reuse — it is the R2 key |
| Boot-time wiring | `game_boot_service.svelte.ts:720` | reuse — set the env var it already reads |
| Published bucket + layout | C-395 | reuse unchanged |
| Existing `addR2Sources` tests | `packages/frontend/storage/src/lib/__tests__/assets_registry.test.ts` | modify — they assert the broken URL |

## Overview

Change `addR2Sources` to derive each asset's R2 URL from its content hash
(`assets/<hash[0:2]>/<hash>.<ext>`) instead of mirroring its bundled path, set
`PUBLIC_ASSETS_BASE_URL` so the boot path actually runs, and update the tests
that currently enshrine the broken scheme.

## Design Reference

C-395 §State & Data Models defines the bucket layout — treat it as the
authority. The extension comes from the existing bundled source URL already
stored on the priority-0 row, so no schema change is needed. Follow the existing
chunked-transaction and inter-chunk-yield pattern in `addR2Sources`; WASM SQLite
stalls on a single large transaction.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Derive the key from the registry hash, not from a fetched index.** The row
  already has the sha256. Fetching `index/v1/*.json` at boot to learn a key the
  client already knows would add a network dependency to the offline path.
- **Bundled stays priority 0.** R2 is a fallback, not a replacement, in this
  contract. Reordering priorities is C-435's decision, made after this one is
  proven.
- **Never fabricate a URL for an asset with no hash.** `seedFromManifest`
  already skips tags missing from the hash sidecar because `assets.hash` must
  never be invented. Preserve that: no hash, no R2 row.
- **Hash verification is not optional.** `AssetManager.resolve` already verifies
  before caching. That check is what makes an untrusted public origin safe; do
  not add a bypass for "trusted" sources.
- **Idempotent and re-runnable.** Keep the existing "only assets lacking an r2
  sibling" selection so re-seeding adds mirrors without rewriting existing rows.
- **Fix the doc comment.** It currently instructs future maintainers to upload
  under manifest paths — the exact misunderstanding that produced this bug.

## State & Data Models

No schema change. `asset_sources` already has `(asset_id, backend, url, priority)`
with `'r2'` a legal backend (`migrations.ts:201`). Only the `url` value changes:

```
before:  https://assets.bearlysleeping.com/lpc/body/bodies_male.walk.webp        (404)
after:   https://assets.bearlysleeping.com/assets/d0/d03f92f9…7698.webp          (200)
```

Key derivation:

```ts
/**
 * R2 object key for an asset, matching the C-395 published layout.
 * `hash` is the sha256 already stored on the assets row; `ext` includes
 * the leading dot and is taken from the bundled source URL.
 */
const r2ObjectKey = (options: { hash: string; ext: string }): string =>
  `assets/${options.hash.slice(0, 2)}/${options.hash}${options.ext}`;
```

Environment — `apps/frontend/client/.env.*` and `.env.example`:

```
PUBLIC_ASSETS_BASE_URL=https://assets.bearlysleeping.com
```

## Quality Requirements

- **Offline/degraded mode**: priority-0 bundled sources are untouched, so an
  offline client behaves exactly as today. An unset `PUBLIC_ASSETS_BASE_URL`
  must remain a clean no-op, not an error.
- **Accessibility/input**: N/A — no UI surface.
- **Performance budget**: `addR2Sources` runs once per boot over ~12,700 rows.
  Keep the existing chunking and yielding; it must not block first paint.
- **Security/privacy**: the bucket is public-read with no credential. No secret
  reaches the client. SHA-256 verification before caching is the integrity
  control and must stay on every source, R2 included.
- **Persistence/migration**: existing installs already hold broken priority-1
  rows. See Migration & Rollback.
- **Cancellation/retry/idempotency**: idempotent by `(asset_id, backend)`
  primary key; safe to re-run every boot.
- **Observability**: log the resolved base URL and the number of source rows
  written at boot, as today. On a fetch failure, log the source URL — a 404 must
  be diagnosable without a debugger.

## Migration & Rollback

- **Old data compatibility**: installs that already ran the broken
  `addR2Sources` hold priority-1 rows with 404 URLs. Because the writer skips
  assets that already have an `r2` sibling, those rows would **never be
  corrected**. This contract must therefore rewrite existing `r2` rows rather
  than skip them — a one-time repair keyed on the row's URL not matching the
  content-addressed shape, or an unconditional rewrite of all `r2` rows.
- **Migration**: performed in `addR2Sources` itself at boot. No separate script.
- **Rollback**: `git revert` restores the old writer. Rows written by this
  contract point at URLs that resolve; a reverted client simply stops using
  them. Unsetting `PUBLIC_ASSETS_BASE_URL` disables the path entirely.
- **Feature flag or kill switch**: `PUBLIC_ASSETS_BASE_URL` is the kill switch —
  unset it and the client is bundled-only, no redeploy of code required.
- **Failure recovery**: a failed R2 fetch already falls through to the next
  source and finally to the bundled static path. No asset becomes unreachable.

## Scope Boundaries

- **In Scope:**
  - Content-addressed key derivation in `addR2Sources`.
  - Repair of existing incorrect `r2` rows on boot.
  - Setting `PUBLIC_ASSETS_BASE_URL` across `.env.example` and the relevant mode env files.
  - Updating the `addR2Sources` tests that assert the path-mirrored URL.
  - Correcting the stale doc comment.
- **Out of Scope:**
  - Publishing new asset categories to the bucket — C-433.
  - Routing maps or content packs through the registry — C-434.
  - Removing bundled assets or changing source priority — C-435.
  - Any change to `AssetManager.resolve`, the cache backends, or eviction.
  - The catalog index (`index/v1/*.json`) — the client does not read it and must not start to here.
  - Hub-side asset access.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Not split. Fixing the key scheme without setting the env
var leaves the path dead; setting the env var without fixing the scheme makes
every boot write 12,700 rows of 404s. Neither half is independently useful.

## Acceptance Criteria

### AC-1: R2 source URLs are content-addressed
**Given** a seeded asset with hash `d03f92f9ef31d17f4ef9ddbaaa965c8fa48482de70df61b43cbe9ae825ea7698` and a bundled source URL ending `.webp`
**When** `addR2Sources('https://assets.bearlysleeping.com')` runs
**Then** the written priority-1 row's URL is `https://assets.bearlysleeping.com/assets/d0/d03f92f9ef31d17f4ef9ddbaaa965c8fa48482de70df61b43cbe9ae825ea7698.webp`

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Unit | `packages/frontend/storage/src/lib/__tests__/assets_registry.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-storage:test`
- Integration: `curl -I` the URL the test produces; expect HTTP 200.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- The existing test at line 149 asserts the broken scheme. Update it — do not add a second passing test beside a wrong one.
- The extension must come from the bundled URL, not be assumed `.webp`; the catalog also holds `.mp3`, `.png` and `.json`.

### AC-2: Existing incorrect r2 rows are repaired
**Given** a registry already containing a priority-1 `r2` row with a path-mirrored URL
**When** `addR2Sources` runs again
**Then** that row is rewritten to the content-addressed URL

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `packages/frontend/storage/src/lib/__tests__/assets_registry.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run frontend-storage:test`
- Integration: seed a registry with an old-format row, re-run, confirm the URL changed.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- The current implementation *skips* assets that already have an `r2` sibling — under that behaviour existing installs stay broken forever. This AC is specifically about not preserving that skip for stale rows.
- Idempotency must survive: a second run over already-correct rows should write nothing new.

### AC-3: An asset missing from the bundle is fetched from R2 and verified
**Given** a client whose bundled copy of an asset is unavailable and whose registry has a correct R2 source row
**When** the asset is resolved
**Then** it is fetched from R2, its SHA-256 matches the registry hash, it is cached, and a blob URL is returned

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | `apps/frontend/client/src/lib/services/assets/asset_manager.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test-unit`
- Integration: with a stubbed fetch returning the real bytes for the R2 URL and a failure for the bundled path, confirm resolution succeeds and caches.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Assert the hash check actually runs — a test that stubs fetch with wrong bytes must fail resolution, not succeed.

### AC-4: An unset origin is a clean no-op
**Given** `PUBLIC_ASSETS_BASE_URL` is unset or empty
**When** the client boots
**Then** no `r2` rows are written, no error is logged, and every asset resolves from bundled sources exactly as before

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Unit | `apps/frontend/client/src/lib/services/game/game_boot_service.test.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test-unit`
- Integration: boot with the variable unset; confirm boot completes and the game renders.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- This is the kill switch. It must work without a code change, and the existing try/catch around the boot block must stay non-fatal.

### AC-5: The origin is configured and boot writes sources
**Given** `PUBLIC_ASSETS_BASE_URL=https://assets.bearlysleeping.com`
**When** the client boots against a freshly seeded registry
**Then** `addR2Sources` reports a non-zero count and a spot-checked row's URL returns HTTP 200

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `apps/frontend/client/.env.example` + boot debug output | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `bun moon run client:test-unit`
- Integration: boot the client, read the `stage:initializing_asset_registry:storage-sources` debug line, `curl -I` one of the written URLs.
- E2E / Visual: **Functional**: N/A. **Visual**: N/A.

**Watch Points**:
- Set the variable in `.env.example` as well as the mode env files, or a fresh clone silently runs bundled-only.
- Confirm the Tauri build surfaces the variable; a `PUBLIC_`-prefixed value must be inlined at build time for the desktop target too.

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: Rewrite the key derivation in `addR2Sources`, add the stale-row repair, update the existing tests (AC-1, AC-2).
2. **Phase 2 (Integration)**: Add `PUBLIC_ASSETS_BASE_URL` to the `masterSchema` in `packages/frontend/configs/src/lib/environment.ts` (as `Type.Optional(Type.String())`). Set the variable in `.env.example` and the mode env files; verify the boot path writes rows (AC-4, AC-5).
3. **Phase 3 (Validation)**: `bun moon run frontend-storage:test`, `bun moon run client:test-unit`, `bun moon check`; boot and `curl -I` a written URL end to end (AC-3).

## Edge Cases & Gotchas

- **Extension, not MIME.** The R2 key ends in the source file's extension. Derive it from the bundled URL's path; do not infer it from category.
- **The skip clause hides the bug.** `addR2Sources` currently ignores assets that already have an `r2` row, so a developer testing on an existing profile sees zero rows written and concludes it works. Test against both a fresh and an already-seeded registry.
- **Hash case.** Keys are lowercase hex, as `asset_hashes.json` stores them. An uppercase hash produces a 404.
- **Do not fetch the catalog index.** It is a browse document for the hub. Reading it at boot would add a network dependency to the offline path for information the client already has.
- **Tauri custom schemes.** The engine registers a custom-scheme URL resolver for `tauri://` and `file://`. Confirm an `https://` R2 URL passes through it untouched on desktop.
- **Music and sprites are thin in the catalog.** The live index reports `music: 3` and `sprites: 2` against 11 MB of music on disk. That is C-433's problem; this contract must not assume full coverage, and a missing R2 row must simply fall back.
- **`PUBLIC_ASSETS_BASE_URL` must be added to the `masterSchema` in `packages/frontend/configs/src/lib/environment.ts`.** The existing `publicEnv` object (`MasterEnv` type) does not include this variable — accessing `publicEnv.PUBLIC_ASSETS_BASE_URL` at `game_boot_service.svelte.ts:720` would be a TypeScript error without it. Add it as `Type.Optional(Type.String())` so an unset value remains `undefined` (falsy → clean no-op).

## Open Questions

Must be resolved before status becomes `approved`:

- None. Layout, hash source and call sites are confirmed against the live bucket.

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
