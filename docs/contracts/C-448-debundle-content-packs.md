---
id: C-448
title: "De-bundle Content Packs — Move emberwatch Out of static/ and Tell the Truth About Offline"
source: "user request 2026-08-26 — emberwatch should not be in static but in the r2 bucket"
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-08-26"
---

# Contract C-448: De-bundle Content Packs — Move emberwatch Out of static/ and Tell the Truth About Offline

## Metadata

| Field | Value |
|---|---|
| **Source** | User request (2026-08-26): *"apps/frontend/client/static/content-packs/emberwatch should not be in static but in the r2 bucket as the lpc, tilesets, music, etc."* |
| **Target** | `apps/frontend/client/static/content-packs/`, `content/packs/` (new), `scripts/src/lib/catalog/config.ts`, `packages/frontend/engine/src/assets/content_pack_loader.ts`, `.claude/CLAUDE.md` |
| **Priority** | P1 — finishes C-435 for the one directory it missed, and corrects a project invariant that is currently false. |
| **Dependencies** | C-433, C-434, C-435 (all `implemented`). Independent of C-442 through C-447 — can run in parallel. |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | user-facing → first-run download note in `apps/frontend/docs/src/content/docs/` |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence

- **Current behavior — emberwatch is published to R2 *and* bundled in the client.**
  `scripts/src/lib/catalog/config.ts:160` includes it in the scan roots:
  ```ts
  export const SCAN_ROOTS: AssetScanRoot[] = [
    { dir: GAME_DATA_DIR, urlPrefix: '/game-data' },
    { dir: CONTENT_PACKS_DIR, urlPrefix: '/content-packs' },
  ];
  ```
  and it is simultaneously still checked in under `static/`, so it ships:
  ```bash
  git ls-files apps/frontend/client/static/content-packs
  # apps/frontend/client/static/content-packs/emberwatch/manifest.json
  # apps/frontend/client/static/content-packs/emberwatch/maps/inn.json
  # apps/frontend/client/static/content-packs/emberwatch/maps/merchant_shop.json
  # apps/frontend/client/static/content-packs/emberwatch/maps/village.json
  # apps/frontend/client/static/content-packs/index.json
  du -sh apps/frontend/client/static/content-packs   # 104K
  ```
  C-435 de-bundled `game-data/` (`.gitignore:255`) but left this sibling
  directory behind.

- **The loader still prefers the bundled path.**
  `packages/frontend/engine/src/assets/content_pack_loader.ts:284`:
  ```ts
  const { packId, basePath = '/content-packs', fetchFn, resolveTag, releaseUrl } = options;
  ```
  and on a registry-resolution failure it explicitly falls back to the bundled
  path (`content_pack_loader.ts` ~line 318, `loadContentPack:registry-fallback`).
  So the R2 path is never exercised in a build where the files are present.

- **A stale invariant.** `.claude/CLAUDE.md` states:
  > *"The game must boot, play, and save with no network and no sign-in. Never
  > make a cloud call a boot dependency."*

  That is already false at HEAD. `apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts:697`:
  ```
  // No usable catalog — everything is de-bundled, so without the seed
  // no asset can resolve. On a fresh install (no cached rows) this is fatal;
  // on an upgrade the prior session's cache still serves.
  ```
  And `offline_core.json` — which declares the tags supposedly *"bundled inside
  the client"* — is itself fetched from R2
  (`asset_store.svelte.ts:40`, `const OFFLINE_CORE_KEY = 'seed/offline_core.json';`)
  while nothing copies those tags' bytes into the build. The declaration
  describes a bundle that no longer exists.

- **Existing implementation to reuse**: the entire publish path
  (`SCAN_ROOTS`, `pathToTag`, `assetKey`, `uploadAssets`, index generation) and
  the entire registry-backed load path (C-434). Nothing new is built here —
  code is removed and one directory moves.

- **Known gaps**: no scan root outside `static/`; the loader's bundled fallback
  has no way to be disabled; the docs and CLAUDE.md describe an offline
  guarantee the code does not provide.

- **Baseline tests**: `bun test scripts/src/lib/catalog/__tests__/`,
  `bun test packages/frontend/engine/src/__tests__/` (content pack loader), and
  `moon run client:build` (record `build/` size).

## User Outcome

After this contract, a **developer** finds pack sources in one reviewable place
that is not the shipped bundle; a **player** downloads the starter pack once on
first run and plays offline forever after; and anyone reading CLAUDE.md gets an
accurate description of what the client actually guarantees.

## Success Measures

- **Time/latency target**: first-run pack download for emberwatch (~104 KB of
  JSON plus its referenced tilesets) completes within 3 s on a 10 Mbps
  connection, behind a visible progress state.
- **Offline/degraded behavior**: **decided 2026-08-26 — first run requires
  network; every subsequent run is fully offline** from the OPFS / Tauri FS
  cache. A first run without network shows an explicit, actionable message
  naming what could not be fetched — never a hang and never a blank screen.
- **Production journey enabled**: the client ships without game content, and the
  hub and the client read the same published bytes.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Scan roots | `scripts/src/lib/catalog/config.ts:160` | **modify** — repoint `CONTENT_PACKS_DIR` at `content/packs` |
| Pack publish | `scripts/src/lib/catalog/pipeline.ts` | **reuse** unchanged |
| Registry-backed pack load | `engine/src/assets/content_pack_loader.ts` | **modify** — remove the bundled fallback |
| Asset caching | `client/src/lib/services/assets/asset_manager.svelte.ts` | **reuse** unchanged |
| Offline-core declaration | `game-data/offline_core.json` + `asset_store.svelte.ts` | **modify** — make it describe first-run prefetch, not a bundle |
| Boot progress UI | `game_boot_service.svelte.ts` `bootProgress` | **reuse** — add the pack-download stage |

## Overview

Move `apps/frontend/client/static/content-packs/` to `content/packs/` — out of
the shipped bundle, still in version control. Repoint the publish pipeline's
scan root. Remove the content-pack loader's bundled-path fallback so the R2 path
is the only path. Add an explicit first-run prefetch stage that downloads and
caches the starter pack with visible progress and an actionable offline error.
Rewrite the stale offline invariant in CLAUDE.md and `offline_core.json`'s
docblock to describe first-run-online / offline-thereafter.

## Design Reference

- C-435 is the direct precedent — same de-bundling shape, same registry path,
  same cache. Read it before starting.
- The boot progress mechanism (`bootProgress.detail`, used for
  `"Seeding assets… chunk N/M"`) is the pattern for the new download stage.
- `SEED_FILES` in `scripts/src/lib/catalog/pipeline.ts:75` shows how mutable
  metadata is published under `seed/`. `offline_core.json` is already in that
  list; only its meaning changes.

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- **Pack sources stay in git, leave the bundle.** `content/packs/emberwatch/**`
  is committed and reviewable. `apps/frontend/client/static/content-packs/` is
  deleted. Do not gitignore the new location — 104 KB of hand-authored JSON is
  exactly what version control is for, and a diff on a map is a code review.
- `CONTENT_PACKS_DIR` in `scripts/src/lib/catalog/config.ts` points at
  `content/packs`. The `urlPrefix` stays `/content-packs` so **every published
  tag is byte-identical to today** — no re-upload, no index churn, no cache
  invalidation.
- **Remove the bundled fallback from `loadContentPack`.** With no bundled copy,
  the fallback can only mask a resolution failure as a confusing 404. Its
  removal is what makes the R2 path actually load-bearing.
- **`offline_core.json` changes meaning, not shape.** It stops claiming "bundled
  in the client" and starts declaring "the tag set the client prefetches and
  pins on first run". Update its docblock in
  `scripts/src/lib/ops/generate_asset_seed.ts` and in `asset_store.svelte.ts`,
  and add the emberwatch pack tags to it.
- **First-run prefetch is a named boot stage** with its own progress detail and
  its own failure message. It must not be silently folded into asset seeding —
  a user waiting on a download deserves to be told that is what is happening.
- CLAUDE.md's data-plane section is amended in the same PR. An invariant that
  the code contradicts is worse than no invariant.

## State & Data Models

```ts
// packages/shared/types/src/lib/game/game_assets.ts — docblock change only
/**
 * Tags the client prefetches and pins on first run.
 *
 * Before C-448 this declared tags *bundled inside the client*. Nothing has
 * been bundled since C-435 de-bundled game-data, so the name described a
 * guarantee the build did not provide. It now declares the first-run
 * prefetch set: fetched once over the network, verified by hash, and pinned
 * in the OPFS / Tauri FS cache so every later run is fully offline.
 */
export type OfflineCoreDeclaration = {
  readonly schemaVersion: number;
  readonly tags: readonly string[];
};
```

```ts
// apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts — new stage
export type BootStage =
  | /* …existing stages… */
  | 'prefetching_starter_content';

export type PrefetchResult = {
  readonly requested: number;
  readonly fetched: number;
  readonly alreadyCached: number;
  readonly failedTags: readonly string[];
};
```

## Quality Requirements

- **Offline/degraded mode**: a first run with no network shows *"Aikami needs to
  download starter content the first time you play. Connect to the internet and
  try again."* — naming the missing tags at `debug`. A second run with no
  network boots fully from cache with zero network calls.
- **Accessibility/input**: the download stage exposes progress through the
  existing boot progress UI, announced via a live region, not a spinner alone.
- **Performance budget**: the client `build/` directory shrinks by at least the
  104 KB removed. First-run prefetch adds no more than 3 s on a 10 Mbps link.
- **Security/privacy**: prefetched bytes are hash-verified by the existing
  `assetManager` path before caching — unchanged behaviour, explicitly retained.
- **Persistence/migration**: an existing install already has cached rows and
  must not re-download. See Migration & Rollback.
- **Cancellation/retry/idempotency**: prefetch is resumable and idempotent —
  already-cached tags are skipped; a partial failure retries only the failures.
- **Observability**: the prefetch stage logs start (tag count), completion
  (`PrefetchResult`), and failure (failed tags, at `warn`).

## Migration & Rollback

- **Old data compatibility**: an existing install has the pack cached under the
  same content-addressed tags, because `urlPrefix` is unchanged and the bytes
  are unchanged. `assetManager` reports them as cached and prefetch skips them.
  **A test must prove this** — a false re-download on upgrade would hit every
  existing player.
- **Migration**: none at runtime. The repo-side move is a `git mv`.
- **Rollback**: revert the PR. The pack returns to `static/` and the bundled
  fallback returns with it. Because published tags never changed, R2 needs no
  action either way.
- **Feature flag or kill switch**: none. A flag would mean keeping the bundled
  copy alive, which is the thing being removed. The rollback path is a revert.
- **Failure recovery**: prefetch failure is non-fatal for an upgrade (cache
  serves) and fatal-with-a-message for a fresh install. It never leaves a
  half-written cache entry — hash verification precedes caching.

## Scope Boundaries

- **In Scope:**
  - `git mv apps/frontend/client/static/content-packs content/packs`.
  - Repointing `CONTENT_PACKS_DIR`; verifying published tags are unchanged.
  - Removing the bundled fallback from `loadContentPack`.
  - The `prefetching_starter_content` boot stage with progress and an
    actionable offline error.
  - Redefining `offline_core.json`'s meaning and adding the pack tags to it.
  - Amending `.claude/CLAUDE.md`'s offline invariant.
  - A docs page on first-run download.
- **Out of Scope:**
  - **Restoring true cold-offline first run** by bundling the offline-core tag
    set into the build. Considered and deliberately not taken (decision
    2026-08-26). If it is wanted later it is its own contract — it needs a build
    step that resolves tags from R2 at build time and emits them into `static/`.
  - Moving the LPC generator's out-of-repo checkout into the repo. Same class of
    problem, different contract.
  - Any change to the publish pipeline's upload, hashing, index generation, or
    preflight.
  - Any change to `game-data/`, which C-435 already handled.
  - Pack installation, pack browsing, or user-authored packs.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** one outcome — content packs load from the origin, not the
bundle. Moving the directory without removing the fallback would leave the R2
path still unexercised; removing the fallback without the prefetch stage would
brick a fresh install. They must land together.

## Acceptance Criteria

### AC-1: The client bundle contains no content packs
**Given** a production client build
**When** `build/` is inspected
**Then** no path under `build/content-packs/` exists, and the build directory is
at least 104 KB smaller than the recorded baseline.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `du -sh` before/after in the PR | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build`
- Integration: `find apps/frontend/client/build -path '*content-packs*'` returns nothing.

**Watch Points**:
- SvelteKit copies `static/` verbatim. Deleting the source directory is the
  whole mechanism — there is no config to change.

---

### AC-2: Published tags are byte-identical after the move
**Given** the publish pipeline before and after repointing `CONTENT_PACKS_DIR`
**When** it runs in dry-run mode against both layouts
**Then** the emitted tag set and every content hash are identical, and a real
publish uploads zero new objects.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Unit | `scripts/src/lib/catalog/__tests__/content_pack_scan_root.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run scripts:test`
- Integration: run the publish pipeline in dry-run and assert `uploaded === 0`,
  `skipped === <pack file count>`.

**Watch Points**:
- The `urlPrefix` must stay `/content-packs` even though the directory is now
  `content/packs`. Changing it re-tags every pack asset and invalidates every
  cached copy on every existing install.

---

### AC-3: The bundled fallback is gone
**Given** `loadContentPack`
**When** its resolver returns `null` or the resolved fetch fails
**Then** it throws a `not-found` `AppError` naming the pack and the tag, and does
**not** attempt `${basePath}/${packId}/manifest.json`.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Unit | `packages/frontend/engine/src/__tests__/content_pack_loader.test.ts` | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run engine:test`
- Integration: `rg -n "registry-fallback" packages/frontend/engine` returns nothing.

**Watch Points**:
- `basePath` may still be a useful parameter for tests and for a future local
  authoring mode. Keeping the parameter while removing the automatic fallback
  is acceptable; silently defaulting to it is not.

---

### AC-4: First run downloads the starter pack with visible progress
**Given** a fresh install with an empty cache and a reachable origin
**When** the game boots
**Then** the boot UI shows a `prefetching_starter_content` stage with progress,
the pack and its tilesets are fetched and hash-verified, and the game reaches
playable state.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | E2E | `apps/e2e/tests/client/first_run_prefetch.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build`
- E2E / Visual:
  - **Functional**: `apps/e2e/tests/client/first_run_prefetch.spec.ts` — clear
    OPFS, boot, assert the stage text appears and the game reaches playable.
  - **Visual**: N/A.

**Watch Points**:
- Clearing OPFS between test runs is the fiddly part. Use a fresh browser
  context per case rather than trying to clear in-page.

---

### AC-5: Second run is fully offline
**Given** an install that has completed a first run
**When** the network is blocked entirely and the game boots
**Then** it reaches playable state with **zero** outbound network requests, and
the pack loads from the cache.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | E2E | `apps/e2e/tests/client/second_run_offline.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build`
- E2E / Visual:
  - **Functional**: `apps/e2e/tests/client/second_run_offline.spec.ts` — boot
    once online in a persistent context, block all routes, boot again, assert
    playable and assert the intercepted request count is zero.
  - **Visual**: N/A.

**Watch Points**:
- This is the AC that makes the new invariant true rather than merely written
  down. If it cannot pass, the invariant text must change again — do not weaken
  the test.

---

### AC-6: First run with no network fails actionably
**Given** a fresh install with an empty cache and no network
**When** the game boots
**Then** it shows the named message about needing to download starter content,
does not hang, and does not show a blank screen.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-6 | E2E | `apps/e2e/tests/client/first_run_offline.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build`
- E2E / Visual:
  - **Functional**: `apps/e2e/tests/client/first_run_offline.spec.ts` — block
    all routes on a fresh context, assert the message and a bounded time to
    reach it.
  - **Visual**: N/A.

**Watch Points**:
- Bound the wait. An unbounded retry loop presents as a hang, which is the
  failure mode this AC exists to prevent.

---

### AC-7: Upgrading does not re-download
**Given** an install with the pack already cached from before this change
**When** it boots on the new build
**Then** prefetch reports `alreadyCached === requested`, `fetched === 0`, and no
pack bytes are transferred.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-7 | E2E | `apps/e2e/tests/client/upgrade_no_redownload.spec.ts` | `/game` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run client:build`
- E2E / Visual:
  - **Functional**: boot the old build in a persistent context, boot the new
    build in the same context, assert `PrefetchResult.fetched === 0`.
  - **Visual**: N/A.

**Watch Points**:
- This is the AC that AC-2 protects. If tags changed, this fails — and it fails
  for every existing player, not just in CI.

---

### AC-8: The documented invariant matches the code
**Given** `.claude/CLAUDE.md` and the `offline_core.json` docblocks
**When** they are read alongside `game_boot_service.svelte.ts`
**Then** they describe first-run-online / offline-thereafter, and no text claims
the game boots with no network on a fresh install.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-8 | Integration | Diff of `.claude/CLAUDE.md` in the PR | N/A | Filled during verification |

**Test Hooks**:
- Integration: `rg -n "boot, play, and save with no network" .claude docs`
  returns no stale claim.

**Watch Points**:
- The rest of that CLAUDE.md paragraph — *"never make a cloud call a boot
  dependency"* for **sign-in** — remains true and must stay. Amend the network
  clause only; do not delete the section.

## Implementation Sequence

1. **Phase 1 (Move)** — `git mv apps/frontend/client/static/content-packs content/packs`.
   Repoint `CONTENT_PACKS_DIR`. Write AC-2's tag-identity test and run a dry-run
   publish. **Do not proceed until `uploaded === 0`.**
2. **Phase 2 (Prefetch)** — add the `prefetching_starter_content` boot stage,
   progress detail, and the three failure messages. Add the pack tags to
   `offline_core.json`. Write AC-4, AC-6.
3. **Phase 3 (Remove the fallback)** — strip the bundled path from
   `loadContentPack`. Write AC-3. Confirm AC-4 still passes — this is where the
   R2 path becomes load-bearing.
4. **Phase 4 (Cache proofs)** — AC-5 and AC-7 E2E.
5. **Phase 5 (Truth)** — amend CLAUDE.md and the docblocks; write the docs page.
   AC-1, AC-8.
6. **Phase 6 (Validation)** — `bun run fix && bun moon run :validate && bun run test`,
   then the E2E suite.

## Edge Cases & Gotchas

- **`index.json` is a pack registry, not a pack.**
  `static/content-packs/index.json` lists available packs and is published as
  the `index` tag (see `manifest.json`, `"tag": "index"`). It moves with the
  rest, and the client fetches it before it knows which pack to prefetch —
  so it is the first thing the prefetch stage needs, and a failure to fetch it
  is the first failure to report.
- **A pack's maps reference tilesets by tag.** Prefetching the pack manifest and
  its maps is not enough — the referenced tilesets must be prefetched too, or
  first run downloads the pack and then stalls on a missing atlas. Walk the map
  tilesets when building the prefetch set.
- **`emberwatch/manifest.json` is 25 KB per `asset_hashes.json`**, much larger
  than the 8–18 KB maps. It carries the campaign definition. Expect it to be the
  slowest single fetch.
- **Do not gitignore `content/packs/`.** The temptation is to mirror
  `.gitignore:255`'s treatment of `game-data/`, but that directory is generated
  from an upstream checkout while these are hand-authored source files. Losing
  them from version control would be a genuine data loss.
- **`GAME_DATA_DIR` still points into `static/`** and `runSeedPublish` still
  reads the six seed files from there. That is C-435's territory and out of
  scope — do not "tidy" it in this contract.
- **The offline invariant amendment is not optional.** Shipping the code change
  while leaving CLAUDE.md claiming cold-offline boot means the next contract
  written against that document starts from a false premise.
- **Hardcoded paths to `static/content-packs/` exist in 6+ files.** After the
  `git mv`, these will point at a nonexistent directory. Update them all:
  `scripts/src/lib/ops/validate_content_appearance.ts` (line 31),
  `scripts/src/lib/ops/validate_content_appearance.test.ts` (line 29),
  `packages/frontend/engine/src/__tests__/emberwatch_content_audit.test.ts` (line 29),
  `scripts/src/lib/ops/generate_emberwatch_maps.ts` (lines 522, 705),
  `scripts/src/lib/ops/generate_emberwatch_tables.ts` (line 48),
  `scripts/src/lib/ops/generate_emberwatch_derivation.test.ts` (line 28).
  Files that import `CONTENT_PACKS_DIR` from `config.ts` (`scan_assets.ts`,
  `catalog_entries.ts`, `pipeline.ts`) update automatically.

## Open Questions

Must be resolved before status becomes `approved`:

- None. Offline posture decided 2026-08-26: first run requires network, every
  later run is fully offline; the invariant text is updated to match.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
