---
id: C-453
title: "Moon remote build cache on Cloudflare Workers + R2"
source: "Snorre — CI cost/latency review of .github/actions/setup-environment"
contract_type: full
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-02"
---

# Contract C-453: Moon remote build cache on Cloudflare Workers + R2

## Metadata

| Field | Value |
|---|---|
| **Source** | `.github/actions/setup-environment/action.yml` moon-cache inputs + rolling SHA-keyed `actions/cache` entries |
| **Target** | New app `aikami-cache` (Cloudflare Worker + R2, at `apps/backend/aikami-cache/`), `scripts/src/lib/deploy/deployment_config.ts`, `.moon/workspace.yml`, `packages/shared/schemas/src/lib/project/project.ts`, `.github/actions/setup-environment/action.yml` |
| **Type** | full |
| **Priority** | P1 — every CI job and every developer machine currently redoes work the other side already did; this is pure wasted compute/time on every PR |
| **Dependencies** | Existing Cloudflare Worker deploy pipeline (`cloudflare-worker` serviceType), C-441 (SOPS secrets — token distribution, status: implemented), C-437 (local Cloudflare dev plane, for local Worker testing, status: implemented) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none (no user-facing surface) |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Moon's build cache (`.moon/cache/states`, `.moon/cache/outputs`) is local-only. CI restores it from a rolling SHA-keyed `actions/cache` entry (`.github/actions/setup-environment/action.yml`) that a developer's own machine can never read, and that entry must be pruned with `bun moon clean --lifetime '7 days'` every save just to stay inside the repository's shared 10 GB Actions cache budget. A build a developer already ran locally is redone from scratch in CI, and a build one CI job ran is invisible to the next job on a different runner.
- **Reproduction**: Run `moon run client:build` locally, then push the same commit and watch CI rebuild the identical task — no shared cache entry exists between the two environments. Separately, inspect `.moon/cache/hashes` growth locally (458 MB / 523 MB of the cache dir on a real checkout) to see why a naive full-directory cache was never viable in CI.
- **Existing implementation to reuse**: `.github/actions/setup-environment/action.yml` (`moon-cache` / `moon-cache-save` inputs, the prune step) stays as the fallback path until the speed AC (AC-3) passes; `scripts/src/lib/deploy/deployment_config.ts` `cloudflare-worker` serviceType and `APP_CONFIG` pattern (see `client`/`site`/`hub` entries) is reused as-is for the new `aikami-cache` app; existing SOPS secret pipeline (C-441) for distributing the two tokens.
- **Known gaps**: The existing rolling-key cache cannot be read across machines (dev laptop vs. CI runner vs. a second CI runner in a matrix job), has no cross-workflow sharing, and requires ongoing manual pruning to avoid evicting unrelated workflow caches from the shared budget.
- **Baseline tests**: None exist for moon caching itself — this is new coverage. `scripts/src/lib/deploy/__tests__/deployment_config.test.ts` covers the `APP_CONFIG` shape and must keep passing once `aikami-cache` is added.

## User Outcome

After this contract, a developer or a CI job that runs a moon task with unchanged inputs — regardless of which machine produced that output first — gets a cache hit from `cache.bearlysleeping.com` instead of re-executing the task.

## Success Measures

- **Time/latency target**: A cold CI run (no `actions/cache` hit) restoring `client:build` from the remote cache must be measurably faster than the current `actions/cache` baseline restore+rebuild. Both numbers are recorded in this contract's execution report (AC-3) before the cutover AC (AC-5) is attempted.
- **Offline/degraded behavior**: N/A for CI (network is always available in GitHub Actions). For local developer use, `MOON_REMOTE_HOST` unset is offline-equivalent — moon falls back to the local-only cache with zero behavior change from today.
- **Production journey enabled**: N/A — this is internal build tooling only, not a player/creator-facing path. No production game journey depends on it.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Cloudflare Worker deploy pipeline | `scripts/src/lib/deploy/deployment_config.ts` `cloudflare-worker` serviceType, `APP_CONFIG` | reuse — add `aikami-cache` entry following the `client`/`site`/`hub` pattern |
| Secrets distribution (env-var-named tokens) | C-441 SOPS/age pipeline | reuse — add `MOON_CACHE_TOKEN` (read-write) and a read-only token as new secrets |
| CI moon cache restore/save | `.github/actions/setup-environment/action.yml` `moon-cache` / `moon-cache-save` inputs, prune step | modify — becomes remote-cache env wiring; the `actions/cache` restore/save steps and the prune step are removed only after AC-3 passes (AC-5) |
| Moon workspace config | `.moon/workspace.yml` | modify — add `aikami-cache` project entry and top-level `remote:` block |
| AppId schema (TypeBox) | `packages/shared/schemas/src/lib/project/project.ts` `AppIdSchema` | modify — add `'aikami-cache'` literal to the TypeBox union |

## Overview

Stand up a small Cloudflare Worker, `aikami-cache`, backed by a dedicated R2 bucket, that speaks moon's HTTP remote-cache protocol (`GET`/`PUT /ac/<hash>` for action results, `GET`/`PUT /cas/<hash>` for output blobs). Point moon at it via the `remote:` config key, gated entirely behind the `MOON_REMOTE_HOST` environment variable so rollout and rollback are a single env-var flip. Once CI-observed speedups are proven, retire the rolling-key `actions/cache` restore/save and prune steps from `setup-environment/action.yml`.

## Design Reference

- `scripts/src/lib/deploy/deployment_config.ts` — `client`, `site`, `hub` entries under `APP_CONFIG` show the exact shape a new `cloudflare-worker` app takes (`workerName`, `buildOutputDir`, `compatibilityDate`, `routes`, `assetsOnly`/`main`).
- `.github/actions/setup-environment/action.yml` — existing moon-cache restore/save/prune steps this contract's AC-5 removes.
- `packages/shared/schemas/src/lib/project/project.ts` — `AppIdSchema` TypeBox union; `'aikami-cache'` must be added as a new literal member (follows the `'database'` pattern — added to the schema but not to `appIds`/`backendAppIds`/`frontendAppIds` arrays).
- Worker Cloudflare infra memory: the Discord gateway bot already runs on a free-tier e2-micro VM — `aikami-cache` is a *separate* Worker, not colocated with that VM; it exists only to host the R2-backed cache endpoint.
- moon 2.5.3 `remote:` config was verified directly against the installed binary — the published JSON Schema at `moonrepo.dev/schemas/workspace.json` is still v1 and disagrees with this shape. Do not trust the schema; trust the binary's actual accepted config (re-verify with `moon --version` and a scratch `remote:` block + `moon ci --dry-run` equivalent if the pinned moon version changes).

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

- New Worker app (logical name `aikami-cache`) implementing four routes against a dedicated R2 bucket:
  - `GET /ac/<hash>` — read action result
  - `PUT /ac/<hash>` — write action result
  - `GET /cas/<hash>` — read output blob
  - `PUT /cas/<hash>` — write output blob
- Bearer-token auth middleware in front of all four routes:
  - Absent or invalid token → `401`.
  - Read-only token → `GET` succeeds, `PUT` → `401`/`403`.
  - Read-write token → both succeed.
- `deployment_config.ts`: add `aikami-cache` to `APP_CONFIG` with `serviceType: 'cloudflare-worker'`, custom domain `cache.bearlysleeping.com` (staging equivalent following the existing `stg.` subdomain convention used by `client`/`site`/`hub` — i.e. `cache.stg.bearlysleeping.com`), and its own dedicated R2 bucket binding (not shared with any existing bucket).
- `packages/shared/schemas/src/lib/project/project.ts`: add `'aikami-cache'` to the `AppIdSchema` TypeBox union (same pattern as `'database'` — in the schema but not in `appIds`/`backendAppIds`/`frontendAppIds` arrays).
- `.moon/workspace.yml`: add `aikami-cache: "apps/backend/aikami-cache"` to the `projects:` block.
- 🔴 **`cloudflare-worker` deploy pipeline adaptation**: `aikami-cache` is a pure API Worker with no static assets — unlike existing `cloudflare-worker` apps (client/site/docs which are `assetsOnly: true`, hub which is `assetsOnly: false` with SSR). The `writeWranglerConfig` function in `cloudflare.ts` currently always writes an `assets` block for `assetsOnly: false` Workers. This Worker needs either:
  - A new `assetsOnly: 'none'` variant (no assets block at all), or
  - `assetsOnly: false` with an empty/no-op assets directory, or
  - A custom build step that handles this Worker type differently.
  Confirm the approach during implementation and update `writeWranglerConfig` accordingly. The `ensureHeadersFile` call also needs to be skipped for Workers with no static assets.
- `.moon/workspace.yml`: add the `remote:` block exactly as verified:
  ```yaml
  remote:
    api: 'http'
    host: '${MOON_REMOTE_HOST}' # unset = local-only cache, this is the kill switch
    auth:
      token: 'MOON_CACHE_TOKEN' # env var NAME, not the value
    cache:
      compression: 'zstd'
      localReadOnly: false
      verifyIntegrity: true
  ```
  Confirm at implementation time whether `host` in moon 2.5.3 accepts direct env-var interpolation or must be left unset in committed config with `MOON_REMOTE_HOST` supplying it purely from the environment (this is the actual rollout gate per the source brief — do not commit a literal `host` value if the binary requires the env var to be the sole source).
- Two Worker secrets: `MOON_CACHE_TOKEN` (read-write — CI and the maintainer's primary machine only) and a read-only token (everyone else, if/when broader local adoption happens). Distributed via the existing C-441 SOPS pipeline as new secret entries.
- R2 bucket lifecycle rule: expire objects after 14 days (no other GC exists in moon's HTTP mode).

## State & Data Models

No new domain types or schemas. This is infra-only; the "data model" is the R2 object layout, which is fully dictated by moon's protocol:

```
r2://aikami-cache-bucket/ac/<hash>    # action result blob (moon-defined format)
r2://aikami-cache-bucket/cas/<hash>   # content-addressed output blob (moon-defined format)
```

No `packages/shared/schemas` or `packages/shared/types` entries are needed — the Worker treats both bodies as opaque binary passthrough.

## Quality Requirements

- **Offline/degraded mode**: `MOON_REMOTE_HOST` unset → moon silently uses local-only cache, identical to pre-contract behavior. No code path should require the remote cache to be reachable.
- **Accessibility/input**: N/A — no UI.
- **Performance budget**: Cloudflare Workers free plan caps request bodies at 100 MB. `client:build`'s output tarball must be measured before rollout (see Risks); `client:tauri-build` is already `cache: false` and never touches this path.
- **Security/privacy**: Bearer-token auth, two-tier (read-only vs. read-write) specifically to bound the blast radius of `localReadOnly: false` — a laptop-built artifact must not be able to reach production via CI without going through the write-token holders (CI + maintainer's primary machine). `verifyIntegrity: true` catches corruption, not malicious intent — the token split is the actual mitigation for that.
- **Persistence/migration**: R2 objects are cache entries, not source-of-truth data — the 14-day lifecycle rule is deliberate GC, not a migration concern.
- **Cancellation/retry/idempotency**: `PUT` writes are idempotent by content hash (same hash → same content, by construction of moon's action-hash/CAS design). No retry logic needed beyond what moon's own client does.
- **Observability**: Worker should log auth failures (401/403) and basic request counts via standard Cloudflare Worker logging (`wrangler tail` / Workers Logs) — no new logging package needed given `@aikami/logger` is a Node/Bun-side package, not deployed into the Worker runtime.

## Migration & Rollback

- **Old data compatibility**: N/A — no existing persistent state changes shape.
- **Migration**: None. This is a net-new opt-in cache layer.
- **Rollback**: Unset `MOON_REMOTE_HOST` on the affected machine or CI environment. Moon falls back to local-only caching immediately, no redeploy needed. This is the entire rollback story.
- **Feature flag or kill switch**: `MOON_REMOTE_HOST` itself is the kill switch — this is deliberate per the source brief, not a separate mechanism to build.
- **Failure recovery**: If the Worker is unreachable or misconfigured, moon's remote-cache client is expected to fail closed to local caching for that run (verify actual moon 2.5.3 behavior on remote-cache connection failure during implementation — if it hard-fails instead, that is a blocking finding for this contract, not something to route around).

## Scope Boundaries

- **In Scope:**
  - New `aikami-cache` Worker + dedicated R2 bucket at `apps/backend/aikami-cache/`, deployed through the existing `cloudflare-worker` pipeline.
  - Adding `'aikami-cache'` to the `AppIdSchema` TypeBox union in `packages/shared/schemas/src/lib/project/project.ts`.
  - Adding `aikami-cache` project entry to `.moon/workspace.yml`.
  - `deployment_config.ts` `APP_CONFIG` entry for `aikami-cache`.
  - `.moon/workspace.yml` `remote:` config block.
  - Two-tier token issuance and distribution via C-441 SOPS pipeline.
  - R2 14-day lifecycle expiry rule.
  - `moon query hash-diff` staging-vs-production collision proof (AC-4).
  - Removal of the `actions/cache` moon-cache restore/save + prune steps from `setup-environment/action.yml`, gated on AC-3 passing (AC-5).
- **Out of Scope:**
  - Any change to the Bun install cache (`~/.bun/install/cache`) — that stays on `actions/cache`, untouched.
  - Depot, bazel-remote, or any non-Cloudflare remote-cache backend — explicitly rejected per the source decision (R2's zero egress fee is the entire cost rationale).
  - Colocating this Worker with the existing Discord gateway bot VM — that VM is unrelated infra and stays untouched.
  - Broadening the read-only token beyond "everyone else" scope decisions — actual distribution policy for the read-only token to individual developer machines is a follow-up, not blocked on this contract landing.
  - Any moon task's `cache: false` setting (e.g. `client:tauri-build`) — unaffected, out of scope by construction.

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:** Single contract, five ACs, one new app. Kept as one contract because the ACs are sequentially dependent (auth → write-gating → speed proof → collision proof → cutover) and splitting would just add cross-contract linking overhead for no independent-shippability benefit — AC-5 (removing the old cache path) cannot land as its own contract without AC-3's evidence already existing.

## Acceptance Criteria

### AC-1: Worker serves all four routes and enforces bearer-token auth
**Given** the `aikami-cache` Worker is deployed and reachable at `cache.bearlysleeping.com`
**When** a request hits `GET /ac/<hash>`, `PUT /ac/<hash>`, `GET /cas/<hash>`, or `PUT /cas/<hash>` with no `Authorization` header, or with a malformed/unknown bearer token
**Then** the Worker responds `401` for all four routes, and responds with the expected data/success for a valid token

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | `apps/backend/aikami-cache/src/__tests__/auth.test.ts` (or equivalent under the new Worker app directory) | `cache.bearlysleeping.com/ac/*`, `/cas/*` | Filled during verification |

**Test Hooks**:
- Moon Task: `moon run aikami-cache:test` (or equivalent, per whatever moon project name is chosen)
- Integration: `curl -i https://cache.bearlysleeping.com/ac/deadbeef` with no header, bad token, and valid token; assert status codes
- E2E / Visual: N/A — no UI, no visual surface

**Watch Points**:
- Cloudflare Workers route matching must not accidentally expose a catch-all that bypasses auth for unlisted paths.

### AC-2: Read-only token cannot write; read-write token can
**Given** two issued tokens, one scoped read-only and one scoped read-write
**When** a `PUT /ac/<hash>` or `PUT /cas/<hash>` is attempted with each token
**Then** the read-only token's write is rejected (401/403) and the read-write token's write succeeds and is retrievable via a subsequent `GET` with either token

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-2 | Integration | same test file as AC-1 | `cache.bearlysleeping.com/ac/*`, `/cas/*` | Filled during verification |

**Test Hooks**:
- Moon Task: same as AC-1
- Integration: `curl -X PUT` with each token against a scratch hash key, then `curl -X GET` to confirm round-trip
- E2E / Visual: N/A

**Watch Points**:
- Confirm the read-only token genuinely cannot escalate — test against both `/ac/` and `/cas/` independently, not just one.

### AC-3: Cold CI run is measurably faster via remote cache than the current `actions/cache` baseline
**Given** `MOON_REMOTE_HOST` set for a CI job, with a task whose local `.moon/cache` is empty (simulating a fresh runner) but whose remote cache already holds the result from a prior run
**When** that CI job runs the task
**Then** it restores from `cache.bearlysleeping.com` and completes faster than a comparable run restoring from the current rolling-key `actions/cache` entry — both wall-clock numbers are recorded in this contract's execution report

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-3 | Integration | CI workflow run logs (two comparison runs) | GitHub Actions | Filled during verification — must include both timing numbers, not just "faster" |

**Test Hooks**:
- Moon Task: `moon run client:build` (or the chosen benchmark task) timed both ways
- Integration: Two back-to-back CI runs on the same commit — one with `MOON_REMOTE_HOST` set, one without — compare job step durations from Actions logs
- E2E / Visual: N/A

**Watch Points**:
- This AC is the gate for AC-5. Do not remove the old cache path until this evidence exists and shows a real improvement, not a wash.
- Network variance between runs — run more than once if the first comparison is noisy.

### AC-4: Staging and production task hashes do not collide
**Given** the same moon task run with `-- --mode staging` and `-- --mode production` passthrough args
**When** `moon query hash-diff` is run comparing the two task hashes
**Then** the hashes differ, proving the remote cache will not serve a staging-built artifact for a production request or vice versa; if they collide, a per-mode `remote.cache.instanceName` is added and this AC is re-verified against the fallback config

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-4 | Integration | `moon query hash-diff` output, captured in the execution report | N/A | Filled during verification |

**Test Hooks**:
- Moon Task: `moon query hash-diff client:build -- --mode staging` vs `client:build -- --mode production` (exact invocation to be confirmed against moon 2.5.3's actual `hash-diff` CLI signature at implementation time)
- Integration: manual — capture and paste raw hash-diff output into the contract's execution report
- E2E / Visual: N/A

**Watch Points**:
- This must be proven, not assumed, even though passthrough args are expected to hash differently — the source brief is explicit that this needs verification before relying on one shared cache instance for both modes.

### AC-5: Old `actions/cache` moon-cache path is removed, gated on AC-3
**Given** AC-3's evidence shows the remote cache is measurably faster
**When** `.github/actions/setup-environment/action.yml`'s `moon-cache` restore/save steps and the `moon clean --lifetime '7 days'` prune step are removed
**Then** CI jobs still get cache hits (now via the remote cache) and no job regresses to always-cold builds

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-5 | Integration | `.github/actions/setup-environment/action.yml` diff + a green CI run post-removal | GitHub Actions | Filled during verification |

**Test Hooks**:
- Moon Task: full `moon ci --affected` run post-removal
- Integration: a full PR-gate CI run after the removal, confirming build steps still show cache hits (now against `cache.bearlysleeping.com`)
- E2E / Visual: N/A

**Watch Points**:
- This is the point of no easy return per the source brief — must be the last AC implemented, only after AC-3's numbers are in hand.
- Do not also remove the Bun install cache step — that stays.

## Implementation Sequence

1. **Phase 1 (Worker + R2)**: Build the `aikami-cache` Worker at `apps/backend/aikami-cache/` (four routes, bearer-token auth, two-tier tokens), update `AppIdSchema` in `packages/shared/schemas/src/lib/project/project.ts`, add project entry to `.moon/workspace.yml`, provision the dedicated R2 bucket with the 14-day lifecycle rule, add the `APP_CONFIG` entry, adapt `writeWranglerConfig` for pure API Workers (no static assets), deploy via the existing `cloudflare-worker` pipeline to `cache.bearlysleeping.com`. Measure `client:build`'s output tarball size against the 100 MB body cap. Verify AC-1 and AC-2.
2. **Phase 2 (moon wiring)**: Add the `remote:` block to `.moon/workspace.yml`, distribute `MOON_CACHE_TOKEN` (and the read-only token) via C-441 SOPS, wire `MOON_REMOTE_HOST` into CI as an opt-in env var (not yet replacing the old cache steps). Verify AC-4 (`moon query hash-diff`) before any shared-instance reliance.
3. **Phase 3 (measurement)**: Run the AC-3 comparison — cold CI run via remote cache vs. current `actions/cache` baseline — record both numbers in the execution report.
4. **Phase 4 (cutover, only if AC-3 passes)**: Remove the `actions/cache` moon-cache restore/save and prune steps from `setup-environment/action.yml`. Run `moon ci --affected` and a full PR-gate CI pass to confirm AC-5.

## Edge Cases & Gotchas

- **JSON Schema drift**: `moonrepo.dev/schemas/workspace.json` disagrees with the installed moon 2.5.3 binary's accepted `remote:` shape (still v1). Do not let an editor's schema-validation red squiggles drive config changes — trust `moon` itself (e.g. `moon --version`, and whatever `moon ci`/task-run output says about config parsing).
- **100 MB body cap**: Cloudflare Workers free plan caps request bodies at 100 MB. Measure `client:build`'s actual output tarball size before rollout — if it exceeds this, that task either needs `cache: false` (like `client:tauri-build` already has) or the Worker needs a paid-plan body-size increase, which is a cost/scope decision to flag back, not silently work around.
- **No batching**: moon's HTTP remote-cache API has no batch endpoint — a cold restore is one HTTP request per blob. A task with many small output files could see request-count overhead dominate; this is expected and accepted per the source brief, not a bug to fix here.
- **`host` config vs. env var**: Confirm at implementation time whether `remote.host` in committed `.moon/workspace.yml` can safely be left templated/unset so that `MOON_REMOTE_HOST` alone gates activation, versus needing a literal value that would defeat the "unset env var = fully local" kill switch. If moon requires a committed host value, the kill switch story changes and must be re-verified before this contract can claim AC-5's rollback story holds.

## Open Questions

- Does moon 2.5.3 fail closed (silently fall back to local cache) or fail hard (error the run) when `MOON_REMOTE_HOST`/`remote.host` is set but the Worker is unreachable? Must be answered before Phase 2 wiring lands in CI, since a hard failure changes the rollback risk profile.
- Exact moon CLI syntax for `moon query hash-diff` with passthrough args (`-- --mode staging`) — confirm against the installed binary's `--help` output, not assumed from the source brief's example.
- Read-only token distribution scope beyond CI/maintainer (which developers, if any, get it) — deferred, not blocking this contract, but flagged so it isn't silently forgotten.

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
