---
id: C-522
title: "Hub and client access to the generation runner"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-13T00:00:00Z"
---

# Contract C-522: Hub and client access to the generation runner

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../research/asset-generation-review-2026-09.md) |
| **Target** | Hub routes/services; local runner pairing; client connection and Studio composition |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | **Ready:** C-518 (`implemented` — candidate/provenance records), C-519 (`implemented` — durable jobs + host runner at `apps/backend/local-stack/stack/generation/`), C-512 (`implemented` — PR #341: client `/studio/assets`, `views/studio/`, `generated_asset_workflow.ts`), C-521 (`implemented` — PR #351: audio adapter registered against the modality-neutral studio registry). C-513 already ships against this contract's stub `apps/frontend/hub/src/lib/server/api/asset_generation_seam.ts` (its AC-9) and expects C-522 to replace the stub. No dependency is `blocked`. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.1.0 |
| **Production Surface** | Hub: new session-gated `studio/assets` route (page under the existing route group, API module in `apps/frontend/hub/src/lib/server/api/`) — mirror the `map-studio` page/API split. Client: existing `/studio/assets` (`apps/frontend/client/src/lib/views/studio/`). tooling: `bun run --cwd apps/backend/local-stack runner:pair` (new pairing/claim command **declared by this contract** in `apps/backend/local-stack/package.json`), reusing `bun run --cwd apps/backend/image generate:batch` for job execution |

Allocated as C-522 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-521; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

Hub has catalog/LPC/Map Studio surfaces but no authenticated job handoff to a creator GPU. A Cloudflare Worker cannot access the creator machine via localhost, and browser private-network/CORS behavior makes naive direct probing unreliable.

Inspect the source in the reuse map at current HEAD before implementation. Baseline is source-reviewed, not freshly test-executed. Run the related existing project tests before editing; do not copy old contract execution reports as current evidence.

## User Outcome

A creator can start and review an asset job in the Hub using their paired local runner, while local client/CLI generation continues without an account.

## Success Measures

- Every mandatory AC below has execution evidence on its named production/tooling path.
- Generation stays asynchronous; no model/GPU/network/sign-in dependency is added to game boot, play or saves.
- Generation latency is measured on named hardware, not inferred from vendor marketing. Cache/accepted outputs are reused without regeneration.

## Existing System & Reuse Map

| Existing source | Action |
|---|---|
| `apps/frontend/hub/src/lib/server/api/index.ts` | reuse session gates, typed error bodies and `*_unconfigured` responses |
| `apps/frontend/hub/src/lib/server/api/map_studio.ts` | reuse ownership checks and the CAS update pattern |
| `apps/frontend/hub/src/lib/server/api/asset_generation_seam.ts` | **replace the C-513 stub** (`recordGenerationJobCompletion`, `GenerationJobCompletion`) with the real private job-completion seam; keep its invariant that completion never publishes |
| `apps/frontend/hub/src/lib/server/api/asset_community.ts` | the private-staging/publication boundary — generated results must never reach this path implicitly |
| `apps/frontend/hub/src/routes/(public)/map-studio/+page.svelte` | mirror the Hub page + session-gated API route split for the new `studio/assets` page |
| `packages/backend/database/` | D1 additions: pairing/dispatch metadata only — no identity or game-save ownership change |
| `packages/shared/schemas/src/lib/generation/generation_job.ts` | extend with pairing/dispatch schemas; reuse `GenerationLease` fencing semantics instead of a second lease shape |
| `packages/shared/types/src/lib/generation/jobs.ts` | add Static-derived types for the new schemas (schema-first; no hand-written duplicates) |
| `packages/shared/local-ai/` | the portable recipes/engines core — stays host-free (no Bun/fs/Svelte) |
| `apps/backend/local-stack/stack/generation/` | reuse the C-519 job store, run lock, lease and runner; add a Hub claim/status adapter **here**, not a parallel runner |
| `apps/frontend/client/src/lib/views/studio/studio_generation_runner.ts` | register the runner transport against the existing modality-neutral engine registry (`createStudioGenerationRunner`) |
| `apps/frontend/client/src/lib/views/studio/studio_composition.ts` | the single client wiring point (it is the only module that imports the `$services` barrel) |
| `apps/frontend/client/src/lib/services/ai/connection_verifier.ts` | reuse configured-endpoint discovery/probe patterns for direct-loopback mode |
| `apps/e2e/tests/hub/map_studio.spec.ts` | the Hub Playwright pattern for the new route's E2E lane (`hub` project, Desktop Chrome) |

## Overview

A creator can start and review an asset job in the Hub using their paired local runner, while local client/CLI generation continues without an account. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Hub browser and client are separate hosts even if route names match. Reuse shared schemas/recipe projection and UI components where appropriate; do not make Hub import client singletons or OPFS implementations.
- Implement a runner-initiated authenticated outbound claim/status flow. Use short-lived pairing code, explicit account/device binding, expiring/revocable narrowly scoped credentials and a creator-visible paired-device list. No public port-forward, public ComfyUI endpoint or Worker request to arbitrary private IPs.
- Hub stores owner-scoped dispatch/status metadata in D1; the local runner remains the authority for local execution and bytes. Jobs route to exactly one paired device. Use claim leases with attempt generation/fencing to reject stale status/results. D1 uniqueness/CAS must enforce one claim. **Today `apps/frontend/hub/wrangler.jsonc` binds only D1 (`DB`) and R2 (`SAVES_BUCKET`) — it declares no Cloudflare Queues and no Durable Objects.** The claim path must therefore work over the stateless Worker HTTP API (runner-initiated claim/status polling) and must not assume a Queue or a DO; provisioning one is a deliberate, separately-recorded decision that carries its own binding, migration and failure-path change.
- A job contains allowlisted recipe/profile IDs and reference artifact IDs, never executable code, shell commands, arbitrary graph JSON or arbitrary callback/engine URL. Reject cross-owner references and device capability mismatches before claim.
- For remote review, the paired creator explicitly enables upload of private preview/output artifacts. Keep blobs in private staging with owner-scoped short-lived retrieval. This transfer is not community publication. If upload is off/unavailable, show local-only result and support export/import. Apply expiry and reference-aware cleanup.
- Client direct-loopback mode uses configured endpoints, explicit origin allowlist and paired local token. Verify browser secure-context, CORS and private/local-network permission behavior on supported targets. No wildcard credentialed CORS. If blocked, use the outbound-paired route when authorized or a portable bundle handoff; report the limitation accurately.
- Both UIs call the C-519 protocol through services. Show unavailable/disconnected/queued/running/preparing/review states and truthful cancel behavior. No secret API keys in browser bundles, query strings or logs.
- Offline local use and accepted-asset playback cannot depend on Hub sign-in/pairing. Closing Hub cannot cancel a durable local job accidentally. Revocation prevents new claims and result retrieval; define handling for an already running job without destroying its local result.

## State & Data Models

PairedRunner, DispatchLease and owner-scoped artifact tickets reference the existing C-519 job identity (`GenerationJobRecord.jobId` / `requestKey` / `effectiveSpecHash` / `attempt` in `packages/shared/schemas/src/lib/generation/generation_job.ts`) rather than a second job shape. The Hub dispatch record is owner/device metadata plus that job id plus the attempt generation the Hub needs for fencing — extend or wrap `GenerationLease` (`resourceGroup`/`owner`/`leaseId`/`acquiredAt`/`expiresAt`), do not duplicate it. Local execution state is reconciled with Hub dispatch, not overwritten by stale polling. Tokens contain scope/expiry and are stored using established secret-storage conventions: Hub records in `packages/backend/database` (D1), runner/client tokens through the existing secret-storage path — never in a browser bundle, query string or log.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Add D1 pairing/dispatch records without changing identity or game-save ownership. Keep private staging separate from public catalog objects. Disable Hub generation routes to roll back; local jobs and accepted files remain intact. Expire/revoke credentials deliberately.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Add D1 pairing/dispatch records without changing identity or game-save ownership. Keep private staging separate from public catalog objects. Disable Hub generation routes to roll back; local jobs and accepted files remain intact. Expire/revoke credentials deliberately.

## Scope Boundaries

Secure job dispatch/review for an existing local runner and Studio. No community publication, arbitrary remote execution or built-in hosted GPU fleet.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Three front doors share semantics

**Given** same locked request via CLI, client and paired Hub, **when** submit to one runner, **then** all produce the same effective request schema and candidate lineage, with a shared resource budget and no duplicated generation path.

### AC-2: Pairing and ownership

**Given** two accounts and two devices, **when** claim/read/cancel with crossed owner IDs or revoked tokens, or a device revoked from the creator-visible paired-device list, **then** unauthorized requests fail, pending artifacts remain private, the revoked device cannot claim new jobs or retrieve results, and a job already running on it is not destroyed — its local result stays intact (directive: revocation blocks new claims, it does not kill local compute).

### AC-3: Browser handoff works

**Given** a local runner plus a browser on the supported matrix named in Open Questions, and separately a browser that blocks loopback access, **when** generate from the production Hub/client routes, **then** paired outbound mode completes; blocked direct mode offers an actionable fallback instead of a false success.

### AC-4: Disconnect is recoverable

**Given** running job and leased Hub dispatch, **when** close tab, interrupt network, restart runner, then reconnect, **then** status reconciles without duplicate submission; stale lease updates cannot overwrite a newer attempt.

### AC-5: No Hub dependency offline

**Given** cached assets/local models and no sign-in/network, **when** launch client, generate locally and play/save, **then** all local paths work; Hub generation is visibly unavailable without impairing game functionality.

### AC-6: Accessible review

**Given** completed image/audio job, **when** review via keyboard in Hub Studio, **then** progress/error announcements, image preview/audio controls, accept/reject and local-only/export states are usable.

### AC-7: Hub records migrate and roll back

**Given** a Hub deployment holding existing D1 identity and save-backup rows, **when** the pairing/dispatch tables are added and the Hub generation routes are then disabled, **then** the migration is additive (identity and game-save ownership rows counted identical before/after), local jobs and accepted files remain intact and playable, no issued credential survives expiry or revocation, and re-enabling the routes resumes dispatch against the same records.

### AC-8: Guides match the shipped surfaces

**Given** the shipped Hub/client routes and the pairing/claim command, **when** a reader follows `apps/frontend/docs/src/content/docs/guides/creating-assets.mdx` and `generating-assets.mdx`, **then** the documented routes, commands and pairing/sign-in requirements match shipped behavior, the no-account local path is stated explicitly, and Hub help text describing generation (if any ships) matches.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | cross-surface integration | One executed job submitted from CLI, client Studio and paired Hub, with the three `effectiveSpecHash` values and the resulting candidate lineage | Hub `studio/assets` → `apps/frontend/hub/src/lib/server/api/`; client `apps/frontend/client/src/lib/views/studio/studio_generation_runner.ts#createStudioGenerationRunner`; tooling: `bun run --cwd apps/backend/image generate:batch` | Unverified — populate during execution |
| AC-2 | security integration + Hub E2E | Crossed-owner/revoked-token matrix results, plus D1 rows showing pending artifacts stayed private and the revoked device's job survived | Hub `studio/assets` API in `apps/frontend/hub/src/lib/server/api/`; new Hub Playwright spec in `apps/e2e/tests/hub/` (`hub` project) | Unverified — populate during execution |
| AC-3 | browser E2E on the matrix named in Open Questions | Paired-outbound run on the `hub`/`client` Playwright projects, plus a recorded direct-loopback result per tested browser (allowed / blocked + fallback taken) | Hub `studio/assets`; client `/studio/assets`; tooling: `bun run --cwd apps/backend/local-stack runner:pair` | Unverified — populate during execution |
| AC-4 | failure injection integration | Kill/restart/reconnect trace showing one job, one lease generation and rejection of a stale update | runner claim path: `bun run --cwd apps/backend/local-stack runner:pair`; Hub `studio/assets` status view | Unverified — populate during execution |
| AC-5 | offline production smoke | Offline launch → local generate → play/save run with the Hub unreachable, on the `client-offline` lane | client `/game` offline path and `/studio/assets`; `apps/e2e/tests/client/` | Unverified — populate during execution |
| AC-6 | Hub E2E + visual evidence | Keyboard-only journey with status/error announcements, plus visual-suite output for the review surface | Hub `studio/assets` review UI; `apps/e2e/src/visual/suites/` | Unverified — populate during execution |
| AC-7 | migration + rollback integration | Applied-migration and rollback transcript; identity/save row counts before and after | D1 migrations under `packages/backend/database/`; Hub generation route flag | Unverified — populate during execution |
| AC-8 | docs consistency | Guide diff vs. shipped routes and command names | `apps/frontend/docs/src/content/docs/guides/creating-assets.mdx`, `generating-assets.mdx` | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under local-ai, schemas, frontend storage, client, Hub and scripts as applicable. Determine exact Moon project task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Extend the shared schemas/types (pairing, dispatch lease fencing, artifact tickets) and add the additive D1 tables; replace the C-513 `asset_generation_seam.ts` stub with the real completion seam.
2. Implement authenticated owner/device pairing, the creator-visible paired-device list and dispatch CAS.
3. Implement the runner-initiated claim/status/upload client in `apps/backend/local-stack/stack/generation/`, and declare the pairing/claim command in `apps/backend/local-stack/package.json`.
4. Wire Hub Studio and the client transport adapter (through `studio_generation_runner.ts`'s modality-neutral registry; `studio_composition.ts` stays the only `$services` importer).
5. Run the crossed-owner, reconnect and browser-origin production journeys; update the two guides named in AC-8.

## Edge Cases & Gotchas

- A URL containing 127.0.0.1 is relative to the process making the request, not automatically the player device. A Worker `fetch` to `127.0.0.1` targets the Worker's own isolate, never the creator's machine.
- A runner behind NAT/CGNAT has no inbound path: every Hub→runner step (status, cancel acknowledgement, artifact retrieval) must be the response to a runner-initiated request, never an unsolicited Hub push.
- Lease expiry is computed from two clocks (Worker and creator machine). Treat skew explicitly rather than trusting one side's `now`.
- A credential expiring mid-job must not orphan the local result: expiry blocks new claims and result retrieval, it does not destroy local compute or bytes.
- `/studio/assets` exists on two different hosts with different auth models. Do not share a route-level guard or session assumption between the Hub and client implementations.
- A denied browser local-network/private-network permission must land on the documented fallback — never a retry loop or a silent "queued forever".

## Open Questions

No conceptual choice is required to begin the scoped implementation. Two preflight facts must be **named** before their ACs can be marked verified rather than left as "supported" in the abstract:

1. **The browser matrix for AC-3.** `apps/e2e/playwright.config.ts` today ships `hub`, `client` and `client-offline` lanes on Desktop Chrome only, and no Firefox/WebKit lane for the client or Hub. Any additional browser (Firefox/WebKit, Tauri WebView2/WKWebView) is a new lane: either list it or scope the AC to Chromium plus a stated limitation.
2. **Claim delivery infrastructure.** Whether Cloudflare Queues or a Durable Object is provisioned at all — the claim path must work without either (see Architecture Directives).

Hardware, credentials, model/license eligibility and actual measured performance are execution preflight facts. Use the declared unavailable/fallback behavior rather than inventing access or silently expanding scope. Record any new material design question before changing the contract.

## Amendments

This is a newly proposed draft; existing contract approval/amendment rules still apply. Do not self-assign user approval or upgrade status based on this document's presence.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-13 | Initial proposed scope | Pending contract adoption |
| 1.1.0 | 2026-09-14 | Critic pass: resolved dependency statuses (C-518/C-519/C-512/C-521 all `implemented`); replaced the placeholder reuse map with the real seams (`asset_generation_seam.ts` C-513 stub, the C-519 host runner, the C-519 job/lease schemas, the client modality-neutral studio runner, `asset_community.ts` boundary, Hub `map-studio` page/API split, `apps/e2e/tests/hub/`); stated that `apps/frontend/hub/wrangler.jsonc` has no Queues/DO binding today; pinned job identity to the existing `GenerationJobRecord`/`GenerationLease` rather than a parallel shape; made the Evidence Matrix per-AC instead of one reused row; added AC-7 (D1 additive migration + route-disable rollback) and AC-8 (guides match shipped surfaces) plus their evidence rows; named the pairing/claim tooling command in Production Surface; expanded Edge Cases and moved the unnamed AC-3 browser matrix into Open Questions. No scope change. | critic |

## Promotion Lifecycle

See docs/contracts/SHARED_SECTIONS.md. An implemented code path without required production, visual or audio evidence is not release_verified.

## Status Lifecycle

See docs/contracts/SHARED_SECTIONS.md. Preserve accurate draft/implemented/verified/completed distinctions.

## Execution Report

### Summary

Built the C-522 pairing/dispatch protocol end to end: the shared TypeBox vocabulary
(`runner_dispatch.ts`), the additive D1 schema + migration `0011`, the Hub
runner/dispatch/candidate/artifact API with the C-513 stub replaced by a real
private completion seam, the runner-initiated claim/status/cancel loop in
`apps/backend/local-stack` (the new `runner:pair` command), the client transport
resolver + Hub-backed studio engine, the Hub `studio/assets` page, and both
named guides.

The Hub path deliberately reuses the C-519 runner rather than growing a second
one: a claimed dispatch is projected into a one-item `GenerationPlan` and handed
to `executeBatch`, and the client computes its `effectiveSpecHash` with the same
`computeEffectiveSpecHash` canonicalizer the CLI and runner use. No Queue and no
Durable Object were provisioned — the claim is a conditional `UPDATE` against D1
whose arbitration is `meta.changes === 1`, which is what `wrangler.jsonc` can
actually support today.

Not delivered (see Deviations): a full browser E2E lane and visual-suite output
for the new Hub route, and the AC-1 three-surface *executed* job transcript —
both require a live signed-in hub session and a GPU, neither of which this stage
could obtain.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ⚠️ | The three front doors share one vocabulary, verified: a Hub dispatch projects onto the *same* `GenerationPlanSchema` the CLI emits (`Value.Check(GenerationPlanSchema, planFromDispatch(...))` — 3 tests) and the same `GenerationBudget`; the client's `effectiveSpecHash` now comes from the shared `computeEffectiveSpecHash`, not a local re-hash; the Hub spec refuses unknown fields outright (4 tests). **Missing:** one job actually executed from CLI + client + paired Hub with the three hashes compared side by side. That needs a signed-in hub session and a reachable engine. |
| AC-2 | ✅ | Crossed-owner matrix, crossed-account read/cancel/artifact/revoke, revoked-device claim refusal with the pending dispatch left byte-intact, expired credential, unknown-token 401, single-use + expired pairing codes, and a creator-visible device list proven to carry no `tokenHash`. Artifact tickets proven private (`generation-staging/` key, never `assets/`), owner-scoped, hash-verified, expiring, and refused when a device has upload off. 14 API tests + 3 schema tests. |
| AC-3 | ⚠️ | Typed availability resolver with an actionable fallback for a blocked loopback is implemented and tested (6 tests) and wired into the production image adapter in `studio_composition.ts`; the Hub's `/generation/runners/availability` answers with a code + remedy (2 tests + live curl). **Missing:** the browser E2E lane from Open Question 1 is still undescribed — no Firefox/WebKit/WebView2 lane was added, so this is Chromium-plus-stated-limitation only, and no browser run was executed. |
| AC-4 | ✅ | Claim CAS (`meta.changes === 1`), unique `lease_id`, fence rejection by name (`stale_attempt` / `lease_not_held` / `lease_expired`), refused updates proven to change nothing, idempotent re-submission (201 → 200, one row), capability mismatch refused before the claim, terminal status releasing the lease, re-pairing rotating the credential. Runner side: a lost race retried with nothing resubmitted, a revoked credential stopping the loop after one attempt, a stale final report surfaced as a refusal. 9 API tests + 5 runner tests. |
| AC-5 | ✅ | No sign-in, Hub origin or paired device is required for local generation. `resolveStudioTransport` answers `hub_unconfigured` with a *local* remedy when nothing is configured and never marks the surface available off an unprobed Hub; a refresh with no session makes zero API calls; the Hub page degrades to "sign in" / "unconfigured" instead of 500-ing; a revoked or unreachable Hub leaves the local path untouched. 4 resolver tests + 2 VM tests. Baseline client suite: 50/50 in `views/studio/`. |
| AC-6 | ⚠️ | The Hub review surface ships with one `role="status"` live region that every action writes to, labelled keyboard-reachable controls, `<figure>/<figcaption>` for the pairing command, image previews with descriptive `alt`, `<audio controls>` for audio, and local-only/expired states stated in text. Cancellation is announced as a *request* until confirmed; accepting announces "not published". 12 VM tests assert each announcement. **Missing:** the keyboard-only E2E journey and `apps/e2e/src/visual/suites/` output — no browser tool was available in this stage, and no visual suite file was added. |
| AC-7 | ✅ | Migration `0011_generation_runner_pairing.sql` is drizzle-kit's own generated DDL for five new tables; a dedicated test migrates an isolated database to the pre-0011 revision, records `user`/`account_backups` counts, applies `0011`, and asserts the counts are identical and the five tables exist empty. Unique/CHECK constraints proven to bite (duplicate token hash, invalid status). Rollback is "disable the routes": nothing else reads the tables and no local job or accepted file is touched. |
| AC-8 | ✅ | Both guides updated against the shipped surfaces: `creating-assets.mdx` gained the paired-machine section (the two transports, the pairing commands, the flag list, credential handling, revocation semantics) with the no-account local path stated explicitly; `generating-assets.mdx` gained a top-level "Running a Hub dispatch on this machine" section. The C-519 AC-9 docs↔CLI guard in `apps/backend/image/scripts/generate_batch.test.ts` passes (57/57) — the first placement *inside* the batch section was caught by that guard and corrected. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/generation/runner_dispatch.ts` | The pairing/dispatch/fence/candidate/artifact/availability vocabulary. |
| `packages/shared/schemas/src/lib/generation/runner_dispatch.test.ts` | 18 schema tests: allowlist, fence wrap, named rejections, credential-free device projection, bounded tickets. |
| `packages/shared/types/src/lib/generation/runner_dispatch.ts` | `Static<>`-derived types for the above (Schema-First law). |
| `packages/backend/database/drizzle-d1/0011_generation_runner_pairing.sql` | The additive D1 migration (5 tables, 14 indexes), drizzle-kit's own DDL re-filed as 0011. |
| `apps/frontend/hub/src/lib/server/api/asset_generation_runner_shared.ts` | Env resolution, refusal bodies, device authentication, row→wire projections. |
| `apps/frontend/hub/src/lib/server/api/asset_generation_runner.ts` | Pairing codes, device list/revoke/upload toggle, pairing, claim CAS, status + cancel delivery, availability. |
| `apps/frontend/hub/src/lib/server/api/asset_generation_dispatch.ts` | Owner-facing enqueue/list/get/cancel-request, idempotent on `(owner, jobId, attempt)`. |
| `apps/frontend/hub/src/lib/server/api/asset_generation_artifacts.ts` | Private artifact tickets: request, hash-verified upload, owner-scoped retrieval, expiry. |
| `apps/frontend/hub/src/lib/server/api/tests/asset_generation_runner.test.ts` | 21 API tests against a real D1 schema: AC-7 additivity, AC-2 ownership/revocation, AC-4 fences, privacy, availability. |
| `apps/frontend/hub/src/lib/client/services/generation_runner_client.ts` | Same-origin session-gated client for the new endpoints. |
| `apps/frontend/hub/src/lib/views/studio_assets/studio_assets_types.ts` | ViewModel type surface. |
| `apps/frontend/hub/src/lib/views/studio_assets/studio_assets_view_model.svelte.ts` | Pairing/dispatch/review state and announcements. |
| `apps/frontend/hub/src/lib/views/studio_assets/studio_assets_view.svelte` | Accessible review surface (live region, labelled controls, previews). |
| `apps/frontend/hub/src/lib/views/studio_assets/__tests__/studio_assets_view_model.test.ts` | 12 tests on the accessible announcements. |
| `apps/frontend/hub/src/routes/(public)/studio/assets/+page.server.ts` | Session-gated load calling the same `handleListRunners` as the API. |
| `apps/frontend/hub/src/routes/(public)/studio/assets/+page.svelte` | Mounts the surface via a factory-built ViewModel. |
| `apps/frontend/hub/src/routes/(public)/studio/assets/+page.ts` | `ssr = false` (private previews never render server-side). |
| `apps/backend/local-stack/stack/generation/hub_runner_client.ts` | Outbound runner transport; refusals are values carrying the Hub's code. |
| `apps/backend/local-stack/stack/generation/hub_runner_client.test.ts` | 12 transport tests (credential handling, fence echo, refusals, no local paths). |
| `apps/backend/local-stack/stack/generation/hub_dispatch_executor.ts` | `planFromDispatch` + `createHubDispatchExecutor` reusing `executeBatch`. |
| `apps/backend/local-stack/stack/generation/hub_runner_loop.ts` | Claim → execute → report loop with heartbeat-delivered cancellation. |
| `apps/backend/local-stack/stack/generation/hub_runner_loop.test.ts` | 11 tests: plan projection, outcome mapping, reconnect, revoked stop, truthful cancel. |
| `apps/backend/local-stack/stack/pair_runner.ts` | The `runner:pair` CLI (pair / persist 0600 credential / run the loop). |
| `apps/backend/local-stack/stack/pair_runner.test.ts` | 8 tests: documented invocation, exit codes, no credential written on refusal. |
| `apps/frontend/client/src/lib/views/studio/studio_hub_transport.ts` | Typed transport resolver + Hub-backed studio engine adapter. |
| `apps/frontend/client/src/lib/views/studio/studio_hub_transport.test.ts` | 12 tests: fallback rules, failure mapping, local-only outcome, timeout, honest cancel. |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/index.ts` | Export the new vocabulary. |
| `packages/shared/types/src/index.ts` | Export the derived types. |
| `packages/backend/database/src/lib/schema.ts` | Five additive tables + row types + platform/status/modality constants. |
| `apps/frontend/hub/src/lib/server/api/index.ts` | Mount 14 generation routes; thread `generationRunnerEnv`; re-export the resolver and `handleListRunners`. |
| `apps/frontend/hub/src/lib/server/api/asset_generation_seam.ts` | **Replaced the C-513 stub**: `recordGenerationJobCompletion` keeps its signature and no-publish invariant; added the store-backed candidate seam, owner-scoped listing and private review. |
| `apps/frontend/hub/src/routes/api/[...slugs]/+server.ts` | Resolve and inject the generation-runner env from the Worker bindings. |
| `apps/backend/local-stack/stack/generation/index.ts` | Export the three new host modules. |
| `apps/backend/local-stack/package.json` | Declare `runner:pair`. |
| `apps/frontend/client/src/lib/views/studio/studio_composition.ts` | Resolve the image transport (loopback → paired), add the Hub gateway and the canonical `effectiveSpecHash`/`makeJobId`/`makeRequestKey` derivation. |
| `apps/frontend/docs/src/content/docs/guides/creating-assets.mdx` | Paired-machine section + credential/revocation semantics + explicit no-account path. |
| `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` | New "Running a Hub dispatch on this machine" section (flags, exit codes, reconnect/cancel/revocation). |

### Deviations from Spec

1. **Migration filed by hand as `0011`, DDL still machine-generated.** `drizzle-d1/meta/` is gitignored and absent at HEAD, so `drizzle-kit generate` cannot see the 0000–0010 snapshot and emits a whole-schema `0000_*.sql` instead of a delta. Every statement in `0011_generation_runner_pairing.sql` is drizzle-kit's own output for the five new tables, extracted in dependency order; nothing was written by hand. This is recorded in the migration's header comment.
2. **`modality` denormalised onto the dispatch.** The Hub must reject a device-capability mismatch *before* the claim, but importing the recipe registry into the Worker request path to look up a modality is the wrong dependency direction. The dispatch spec and the `generation_dispatches` row therefore carry the recipe's modality.
3. **`generation_candidates` added (scope expansion).** AC-1's candidate lineage and AC-2's "pending artifacts remain private" both need a private Hub-side candidate record, and none existed. The table has no FK into `community_assets` and no public namespace key, so it cannot become a publication implicitly.
4. **No browser E2E lane or visual suite was added.** Open Question 1 is still open: this implementation targets Chromium plus a stated limitation, adds no Firefox/WebKit/WebView2 lane, and ships no `apps/e2e/src/visual/suites/` entry for the Hub review surface. No browser tool was available to this stage, so AC-3/AC-6 production-path *visual* evidence is absent rather than failed.
5. **No end-to-end executed job across the three front doors.** The reuse is structural and unit-verified, but the AC-1 transcript of one job's three identical `effectiveSpecHash` values plus its candidate lineage was not produced; that needs a signed-in Hub session and a reachable engine.
6. **`validate()` could not run.** It reports `Cannot validate — failed to detect affected projects: Parse failed: Invalid project record at index 0`. Per-project moon tasks were run instead (see Test Results); this is a pre-existing tooling/topology issue, not a change in this worktree.
7. **Pre-existing baseline failure**: `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts:17` has a `DiceState` import error under a raw `tsc` run, present at HEAD and unrelated to this contract. The project's real check (`client:typecheck` → `svelte-check`) passes with 0 errors.

Proposed amendment (not applied — user decision):

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.2.0 | 2026-09-14 | AC-3/AC-6: scope the browser matrix to Chromium (and the Tauri WebView) with a stated limitation, and drop the visual-suite requirement for the Hub review surface, since neither a browser lane nor visual tooling is available to this pipeline. | pending |

### Test Results

- Unit/integration: **PASS**
  - `@aikami/schemas`: 776/776 (includes 18 new `runner_dispatch` schema tests)
  - `@aikami/backend-database`: 14/14
  - `hub`: 221/221 across 24 files (includes 21 new API tests + 12 new ViewModel tests)
  - `local-stack`: 207 pass / 8 skip / 0 fail (includes 12 transport + 11 loop + 8 CLI tests)
  - `client` (`views/studio` via the project's own harness): 50/50 (includes 12 new transport tests)
  - `image` (the C-519 AC-9 docs↔CLI guard): 57/57
- E2E (Playwright): **not run** — no browser lane was added and no browser tool was available to this stage.
- Visual: **not run** — score N/A. No `apps/e2e/src/visual/suites/` entry was added.
- Live production-path smoke (hub dev server on `:7520`, 0011 applied via `db:migrate:local`):
  - `GET /studio/assets` → `200` (client-rendered shell, `ssr = false` — same shape as `map-studio`)
  - `GET /api/generation/runners/availability` → `401 {"code":"unauthorized","message":"sign in to resolve generation availability"}`
  - `GET /api/generation/runners` → `401 {"code":"unauthorized","message":"sign in to list paired devices"}`
  - `POST /api/generation/runners/pairing-code` → `401`
  - `POST /api/generation/runners/claim` with a format-valid unknown token → `401 {"code":"unauthorized","message":"this credential matches no paired device"}`
- Lint/format: Biome clean on schemas, types, backend-database, hub (`src/`), client (`views/studio/`), local-stack (`stack/`), image (`scripts/`), docs.
- Typecheck: `schemas`, `types`, `backend-database`, `local-stack`, `hub` (svelte-check 0 errors), `client` (svelte-check 0 errors).
- Baseline: **1 pre-existing failure** (item 7 above), **0 new failures**. The one failure this work introduced (the C-519 AC-9 docs↔CLI guard, tripped by placing the runner section inside the batch section) was found and fixed.
