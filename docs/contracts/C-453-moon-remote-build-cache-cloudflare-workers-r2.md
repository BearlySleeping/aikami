---
id: C-453
title: "Moon remote build cache on Cloudflare Workers + R2"
source: "CI cost/latency review of .github/actions/setup-environment"
contract_type: full
status: rejected (The gains is not worth the complexity)
github:
    issue_number: null
    issue_url: null
    project_item_id: null
    pr_url: null
created_at: "2026-09-02"
---

┌───────────────┬───────┬──────┬────────────────┐
│ task │ cold │ warm │ cached tarball │
├───────────────┼───────┼──────┼────────────────┤
│ docs:build │ 2.4s │ 0.3s │ 2.8 MB │
├───────────────┼───────┼──────┼────────────────┤
│ site:build │ 3.1s │ 0.3s │ 9.5 MB │
├───────────────┼───────┼──────┼────────────────┤
│ hub:build │ 5.3s │ 0.4s │ 9.4 MB │
├───────────────┼───────┼──────┼────────────────┤
│ client:build │ 9.6s │ 0.6s │ 47 MB │
├───────────────┼───────┼──────┼────────────────┤
│ all four cold │ 20.4s │ 1.6s │ ~69 MB │
└───────────────┴───────┴──────┴────────────────┘

The client is the worst possible remote-cache candidate: 9.6 seconds of compute producing a 47 MB blob. Over moon's HTTP mode — no batching, no streaming, one request per blob — moving 47 MB has to beat 9.6s. At a realistic 50 Mbps that's ~7.5s of pure transfer before request overhead and decompression. Break-even at best, worse on bad wifi. And it's the build that would benefit most, being the largest.

The rule that falls out: a remote cache wins when build time is high relative to artifact size. Your client is 4.9 MB per second of build. You want that number low.

Meanwhile your CI runs are 20–230s, mostly 60–75s. The one 188s outlier is "Deploy Worker VM" — a Docker build/push to GCP that no moon cache touches. A 60s PR Check is dominated by checkout, bun install, and runner startup.

The uncomfortable follow-on

Building everything cold costs 20.4s. The setup-environment comment says the moon actions/cache save step costs "~20s of post-job time even when moon is a no-op." Those numbers are the same size. Your existing CI moon cache may be roughly break-even — while also needing the moon clean prune workaround and competing for the repo's 10 GB budget.

# Contract C-453: Moon remote build cache on Cloudflare Workers + R2

## Metadata

| Field                | Value                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Source**           | `.github/actions/setup-environment/action.yml` moon-cache inputs + rolling SHA-keyed `actions/cache` entries                                                                                                                                                 |
| **Target**           | New app `aikami-cache` (Cloudflare Worker + R2, at `apps/backend/aikami-cache/`), `scripts/src/lib/deploy/deployment_config.ts`, `.moon/workspace.yml`, `packages/shared/schemas/src/lib/project/project.ts`, `.github/actions/setup-environment/action.yml` |
| **Type**             | full                                                                                                                                                                                                                                                         |
| **Priority**         | P1 — every CI job and every developer machine currently redoes work the other side already did; this is pure wasted compute/time on every PR                                                                                                                 |
| **Dependencies**     | Existing Cloudflare Worker deploy pipeline (`cloudflare-worker` serviceType), C-441 (SOPS secrets — token distribution, status: implemented), C-437 (local Cloudflare dev plane, for local Worker testing, status: implemented)                              |
| **Status**           | draft                                                                                                                                                                                                                                                        |
| **Promotion**        | —                                                                                                                                                                                                                                                            |
| **Docs Impact**      | internal → none (no user-facing surface)                                                                                                                                                                                                                     |
| **Contract version** | 2.1.0                                                                                                                                                                                                                                                        |

## Problem & Baseline Evidence

- **Current behavior**: Moon's build cache (`.moon/cache/states`, `.moon/cache/outputs`) is local-only. CI restores it from a rolling SHA-keyed `actions/cache` entry (`.github/actions/setup-environment/action.yml`) that a developer's own machine can never read, and that entry must be pruned with `bun moon clean --lifetime '7 days'` every save just to stay inside the repository's shared 10 GB Actions cache budget. A build a developer already ran locally is redone from scratch in CI, and a build one CI job ran is invisible to the next job on a different runner.
- **Reproduction**: Run `moon run client:build` locally, then push the same commit and watch CI rebuild the identical task — no shared cache entry exists between the two environments. Separately, inspect `.moon/cache/hashes` growth locally (458 MB / 523 MB of the cache dir on a real checkout) to see why a naive full-directory cache was never viable in CI.
- **Existing implementation to reuse**: `.github/actions/setup-environment/action.yml` (`moon-cache` / `moon-cache-save` inputs, the prune step) stays as the fallback path until the speed AC (AC-3) passes; `scripts/src/lib/deploy/deployment_config.ts` `cloudflare-worker` serviceType and `APP_CONFIG` pattern (see `client`/`site`/`hub` entries) is reused as-is for the new `aikami-cache` app; existing SOPS secret pipeline (C-441) for distributing the two tokens.
- **Known gaps**: The existing rolling-key cache cannot be read across machines (dev laptop vs. CI runner vs. a second CI runner in a matrix job), has no cross-workflow sharing, and requires ongoing manual pruning to avoid evicting unrelated workflow caches from the shared budget.
- **Baseline tests**: None exist for moon caching itself — this is new coverage. `scripts/src/lib/deploy/__tests__/deployment_config.test.ts` covers the `APP_CONFIG` shape and must keep passing once `aikami-cache` is added.

## User Outcome

After this contract, a developer or a CI job that runs a moon task with unchanged inputs — regardless of which machine produced that output first — gets a cache hit from `cache.bearlysleeping.com` instead of re-executing the task.

## Success Measures

- **Time/latency target**: On equivalent clean runners, a primed remote-cache hit for `client:build` must be measurably faster than a remote-disabled baseline where `actions/cache` is disabled or guaranteed to miss. Record every duration from repeated comparisons and both median timings in this contract's execution report (AC-3) before the cutover AC (AC-5) is attempted.
- **Offline/degraded behavior**: N/A for CI (network is always available in GitHub Actions). For local developer use, `MOON_REMOTE_HOST` unset is offline-equivalent — moon falls back to the local-only cache with zero behavior change from today.
- **Production journey enabled**: N/A — this is internal build tooling only, not a player/creator-facing path. No production game journey depends on it.

## Existing System & Reuse Map

| Capability                                  | Existing source                                                                                    | Reuse / modify / replace                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare Worker deploy pipeline           | `scripts/src/lib/deploy/deployment_config.ts` `cloudflare-worker` serviceType, `APP_CONFIG`        | reuse — add `aikami-cache` entry following the `client`/`site`/`hub` pattern                                                                  |
| Secrets distribution (env-var-named tokens) | C-441 SOPS/age pipeline                                                                            | reuse — add `MOON_CACHE_TOKEN` (read-write) and `MOON_CACHE_READ_TOKEN` (read-only) as separate secrets                                       |
| CI moon cache restore/save                  | `.github/actions/setup-environment/action.yml` `moon-cache` / `moon-cache-save` inputs, prune step | modify — becomes remote-cache env wiring; the `actions/cache` restore/save steps and the prune step are removed only after AC-3 passes (AC-5) |
| Moon workspace config                       | `.moon/workspace.yml` + Moon's `MOON_REMOTE_*` overrides                                           | add the `aikami-cache` project entry, but keep committed config local-only; enable the remote exclusively through validated environment variables |
| AppId schema (TypeBox)                      | `packages/shared/schemas/src/lib/project/project.ts` `AppIdSchema`                                 | modify — add `'aikami-cache'` literal to the TypeBox union                                                                                    |

## Overview

Stand up a small Cloudflare Worker, `aikami-cache`, backed by a dedicated R2 bucket, that speaks Moon's HTTP remote-cache protocol (`GET`/`PUT /ac/<hash>` for action results, `GET`/`PUT /cas/<hash>` for output blobs). Point Moon at it exclusively through `MOON_REMOTE_*` environment overrides, gated by `MOON_REMOTE_HOST`, so committed configuration remains local-only and rollout or rollback is a single environment change. Once CI-observed speedups are proven, retire the rolling-key `actions/cache` restore/save and prune steps from `setup-environment/action.yml`.

## Design Reference

- `scripts/src/lib/deploy/deployment_config.ts` — `client`, `site`, `hub` entries under `APP_CONFIG` show the exact shape a new `cloudflare-worker` app takes (`workerName`, `buildOutputDir`, `compatibilityDate`, `routes`, `assetsOnly`/`main`).
- `.github/actions/setup-environment/action.yml` — existing moon-cache restore/save/prune steps this contract's AC-5 removes.
- `packages/shared/schemas/src/lib/project/project.ts` — `AppIdSchema` TypeBox union; `'aikami-cache'` must be added as a new literal member (follows the `'database'` pattern — added to the schema but not to `appIds`/`backendAppIds`/`frontendAppIds` arrays).
- Worker Cloudflare infra memory: the Discord gateway bot already runs on a free-tier e2-micro VM — `aikami-cache` is a _separate_ Worker, not colocated with that VM; it exists only to host the R2-backed cache endpoint.
- Moon 2.5.3's `MOON_REMOTE_*` overrides were verified directly against the installed binary — the published JSON Schema at `moonrepo.dev/schemas/workspace.json` is still v1 and does not describe environment-only activation. Trust the binary's accepted environment mapping and re-verify it if the pinned Moon version changes.

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
- `.moon/workspace.yml`: omit the `remote` block entirely. Moon 2.5.3 supports environment overrides for every required setting, so remote caching is configured only when the job supplies `MOON_REMOTE_HOST`, `MOON_REMOTE_API=http`, `MOON_REMOTE_AUTH_TOKEN=<token-variable-name>`, `MOON_REMOTE_CACHE_COMPRESSION=zstd`, `MOON_REMOTE_CACHE_LOCAL_READ_ONLY=false`, and `MOON_REMOTE_CACHE_VERIFY_INTEGRITY=true`. `http` selects Moon's HTTP cache protocol; `MOON_REMOTE_HOST` itself must be an `https://` URL. The setup step must reject any other scheme before exporting `MOON_REMOTE_AUTH_TOKEN` or exposing either cache token to the Moon process. If `MOON_REMOTE_HOST` is unset, do not attach an auth setting or token and leave all remote variables unset.
- Two Worker secrets: `MOON_CACHE_TOKEN` (read-write) and `MOON_CACHE_READ_TOKEN` (read-only). Expose the read-write token only to trusted push-to-main or release jobs that are allowed to populate the cache. Both `validate` and `heavy` in `pr-checks.yml` use only `MOON_CACHE_READ_TOKEN` and set `MOON_REMOTE_AUTH_TOKEN=MOON_CACHE_READ_TOKEN`; they never receive `MOON_CACHE_TOKEN`. Pull requests for which the read-only secret is unavailable run local-only rather than falling back to read-write credentials. Distribute both through the existing C-441 SOPS pipeline as separate secret entries.
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
- **Security/privacy**: Bearer-token auth, two-tier (read-only vs. read-write) specifically to bound the blast radius of `localReadOnly: false`. Only trusted push/release jobs hold the write token; PR-gate `validate` and `heavy` jobs are read-only. `verifyIntegrity: true` catches corruption, not malicious intent — the token split and negative `PUT` tests are the actual mitigation.
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
    - Environment-only `MOON_REMOTE_*` wiring with HTTPS-host validation; no committed `remote.host` or `remote` block.
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

| AC   | Test Level  | Required Artifact                                                                                         | Production Path                           | Evidence                   |
| ---- | ----------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------- |
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

| AC   | Test Level  | Required Artifact      | Production Path                           | Evidence                   |
| ---- | ----------- | ---------------------- | ----------------------------------------- | -------------------------- |
| AC-2 | Integration | same test file as AC-1 | `cache.bearlysleeping.com/ac/*`, `/cas/*` | Filled during verification |

**Test Hooks**:

- Moon Task: same as AC-1
- Integration: `curl -X PUT` with each token against scratch `/ac/` and `/cas/` hash keys, then `curl -X GET` to confirm read-write round-trips. Repeat the rejected `PUT` checks using the exact `MOON_CACHE_READ_TOKEN` credential wired to both PR-gate jobs in `pr-checks.yml`.
- E2E / Visual: N/A

**Watch Points**:

- Confirm the read-only token genuinely cannot escalate — test against both `/ac/` and `/cas/` independently, not just one.

### AC-3: Remote-cache hits are measurably faster than a guaranteed-cold baseline

**Given** equivalent clean CI runners using the same runner image, commit, workflow, and task inputs, with local `.moon/cache` empty on every run; the remote-hit arm has a primed remote result and `actions/cache` disabled or guaranteed to miss, while the baseline arm has remote caching disabled and `actions/cache` disabled or guaranteed to miss
**When** each arm runs the same task in at least three matched repetitions
**Then** the remote-hit arm restores from `cache.bearlysleeping.com` and its median wall-clock duration is measurably faster than the guaranteed-cold baseline; every raw duration and both medians are recorded in this contract's execution report before AC-3 is used as the AC-5 gate

**Evidence Matrix**:

| AC   | Test Level  | Required Artifact                          | Production Path | Evidence                                                                         |
| ---- | ----------- | ------------------------------------------ | --------------- | -------------------------------------------------------------------------------- |
| AC-3 | Integration | CI workflow logs for at least three matched remote-hit/baseline pairs | GitHub Actions  | Filled during verification — record every duration and both medians, not just "faster" |

**Test Hooks**:

- Moon Task: `moon run client:build` (or the chosen benchmark task) timed in both arms on clean runners
- Integration: Run at least three matched pairs on the same commit and runner image. For the remote-hit arm, prime the remote entry and disable or force a miss in `actions/cache`; for the baseline arm, unset every `MOON_REMOTE_*` variable and disable or force a miss in `actions/cache`. Capture task-step wall-clock durations from Actions logs.
- E2E / Visual: N/A

**Watch Points**:

- This AC is the gate for AC-5. Do not remove the old cache path until this evidence exists and shows a real improvement, not a wash.
- Do not compare against a runner carrying either non-target cache. A remote-hit sample with an `actions/cache` hit, or a baseline sample with remote caching enabled, is invalid and must be repeated.

### AC-4: Staging and production hashes differ for every mode-sensitive cached task

**Given** every cached Moon task whose outputs depend on the mode argument, including `client:build` and `hub:build`, run with `-- --mode staging` and `-- --mode production` passthrough args
**When** `moon query hash-diff` compares the staging and production hashes for each task
**Then** both tasks' hashes differ, proving the remote cache will not serve a staging-built artifact for a production request or vice versa. If any mode-sensitive task collides, set a distinct `MOON_REMOTE_CACHE_INSTANCE_NAME` for staging and production whenever remote caching is enabled, repeat every hash comparison, then unset `MOON_REMOTE_HOST` and verify both modes still use the unchanged local-only fallback.

**Evidence Matrix**:

| AC   | Test Level  | Required Artifact                                               | Production Path | Evidence                   |
| ---- | ----------- | --------------------------------------------------------------- | --------------- | -------------------------- |
| AC-4 | Integration | `moon query hash-diff` output for `client:build`, `hub:build`, and any other mode-sensitive cached task, captured in the execution report | N/A | Filled during verification |

**Test Hooks**:

- Moon Task: compare staging vs. production with `moon query hash-diff` for both `client:build` and `hub:build`, plus every other cached task whose outputs depend on `--mode` (exact invocation to be confirmed against moon 2.5.3's actual `hash-diff` CLI signature at implementation time)
- Integration: manual — capture each raw hash-diff in the execution report. If an instance-name fallback is required, capture the repeated comparisons and a local-only run for each mode with `MOON_REMOTE_HOST` and `MOON_REMOTE_CACHE_INSTANCE_NAME` unset.
- E2E / Visual: N/A

**Watch Points**:

- This must be proven for every mode-sensitive cached task, not inferred from `client:build` alone, before relying on one shared cache instance for both modes.

### AC-5: Old `actions/cache` moon-cache path is removed, gated on AC-3

**Given** AC-3's evidence shows the remote cache is measurably faster
**When** `.github/actions/setup-environment/action.yml`'s `moon-cache` restore/save steps and the `moon clean --lifetime '7 days'` prune step are removed
**Then** CI jobs still get cache hits (now via the remote cache) and no job regresses to always-cold builds

**Evidence Matrix**:

| AC   | Test Level  | Required Artifact                                                                 | Production Path | Evidence                   |
| ---- | ----------- | --------------------------------------------------------------------------------- | --------------- | -------------------------- |
| AC-5 | Integration | `.github/actions/setup-environment/action.yml` diff + a green CI run post-removal | GitHub Actions  | Filled during verification |

**Test Hooks**:

- Moon Task: full `moon ci --affected` run post-removal
- Integration: a full PR-gate CI run after the removal, confirming build steps still show cache hits (now against `cache.bearlysleeping.com`)
- E2E / Visual: N/A

**Watch Points**:

- This is the point of no easy return per the source brief — must be the last AC implemented, only after AC-3's numbers are in hand.
- Do not also remove the Bun install cache step — that stays.

## Implementation Sequence

1. **Phase 1 (Worker + R2)**: Build the `aikami-cache` Worker at `apps/backend/aikami-cache/` (four routes, bearer-token auth, two-tier tokens), update `AppIdSchema` in `packages/shared/schemas/src/lib/project/project.ts`, add project entry to `.moon/workspace.yml`, provision the dedicated R2 bucket with the 14-day lifecycle rule, add the `APP_CONFIG` entry, adapt `writeWranglerConfig` for pure API Workers (no static assets), deploy via the existing `cloudflare-worker` pipeline to `cache.bearlysleeping.com`. Measure `client:build`'s output tarball size against the 100 MB body cap. Verify AC-1 and AC-2.
2. **Phase 2 (moon wiring)**: Keep `.moon/workspace.yml` free of a `remote` block; distribute `MOON_CACHE_TOKEN` and `MOON_CACHE_READ_TOKEN` via C-441 SOPS, validate that `MOON_REMOTE_HOST` uses `https://`, and set the remaining `MOON_REMOTE_*` overrides only in remote-enabled jobs. Wire PR-gate jobs read-only and trusted push/release jobs read-write. Verify AC-2 and AC-4 before any shared-instance reliance.
3. **Phase 3 (measurement)**: Run at least three AC-3 matched comparisons on equivalent clean runners — primed remote hit versus remote-disabled, `actions/cache`-disabled-or-miss baseline — and record every duration plus both medians in the execution report.
4. **Phase 4 (cutover, only if AC-3 passes)**: Remove the `actions/cache` moon-cache restore/save and prune steps from `setup-environment/action.yml`. Run `moon ci --affected` and a full PR-gate CI pass to confirm AC-5.

## Edge Cases & Gotchas

- **JSON Schema drift**: `moonrepo.dev/schemas/workspace.json` disagrees with the installed moon 2.5.3 binary's accepted `remote:` shape (still v1). Do not let an editor's schema-validation red squiggles drive config changes — trust `moon` itself (e.g. `moon --version`, and whatever `moon ci`/task-run output says about config parsing).
- **100 MB body cap**: Cloudflare Workers free plan caps request bodies at 100 MB. Measure `client:build`'s actual output tarball size before rollout — if it exceeds this, that task either needs `cache: false` (like `client:tauri-build` already has) or the Worker needs a paid-plan body-size increase, which is a cost/scope decision to flag back, not silently work around.
- **No batching**: moon's HTTP remote-cache API has no batch endpoint — a cold restore is one HTTP request per blob. A task with many small output files could see request-count overhead dominate; this is expected and accepted per the source brief, not a bug to fix here.
- **Environment-only activation**: Moon 2.5.3 maps `MOON_REMOTE_HOST`, `MOON_REMOTE_API`, `MOON_REMOTE_AUTH_TOKEN`, and `MOON_REMOTE_CACHE_*` directly to remote settings. Do not commit a `remote.host` interpolation or a partial `remote` block; validate an `https://` host first, then attach the appropriate token-variable name in the job environment.

## Open Questions

- Does moon 2.5.3 fail closed (silently fall back to local cache) or fail hard (error the run) when `MOON_REMOTE_HOST`/`remote.host` is set but the Worker is unreachable? Must be answered before Phase 2 wiring lands in CI, since a hard failure changes the rollback risk profile.
- Exact moon CLI syntax for `moon query hash-diff` with passthrough args (`-- --mode staging`) — confirm against the installed binary's `--help` output, not assumed from the source brief's example.
- Read-only token distribution scope beyond CI/maintainer (which developers, if any, get it) — deferred, not blocking this contract, but flagged so it isn't silently forgotten.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
| ------- | ---- | ------ | ----------- |
| 2.1.0   | 2026-09-02 | Use validated environment-only HTTPS configuration, split PR read credentials from trusted write credentials, and harden AC-3/AC-4 evidence. | User request |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
