---
id: C-522
title: "Hub and client access to the generation runner"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: implemented
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

### Summary (round 2 — verifier CHANGES_REQUESTED addressed)

Round 1 shipped the protocol, the Hub API, the runner loop, the client transport,
the Hub `/studio/assets` surface and both guides, and reported AC-1/AC-3/AC-6 as
partial. The independent verifier then ran it live and found **two functional
defects that the round-1 unit tests could not see**, because both lived in the
seam between the runner loop and the Hub handlers and every unit test used a fake
client that answered every call the same way regardless of order:

1. **The completion seam was unreachable.** `runClaimed` reported the terminal
   status (`awaiting_review`) *before* the candidate. `awaiting_review` is
   terminal, so `handleUpdateStatus` released the dispatch's lease; the
   subsequent `reportCandidate` then failed the fence with `409 stale_attempt`.
   Every real Hub job lost its candidate row while the dispatch still looked
   healthy, which broke AC-1's candidate lineage and AC-6's review of a completed
   job.
2. **Cancellation was undeliverable.** `handleUpdateStatus` filtered the caller's
   own dispatch id out of `pendingCancellationDispatchIds`. Since the Hub can only
   answer (never push), a runner learns about a cancel *only* from the reply to
   its own heartbeat — which necessarily names the dispatch it is asking about.
   Filtering that id out made a cancel unobservable for exactly the dispatch that
   needed it: the Hub showed "the runner has not confirmed the engine stopped"
   forever and the job ran to completion.

Round 2 fixes both, adds the regression tests that actually fail on the old code,
adds the missing Evidence-Matrix artifacts (hub Playwright spec, visual suite,
keyboard journey, local-only statement), and fixes the three minor findings
(`organizeImports`, the misleading 400 code, the unreachable local-only text).

While building the regression tests, two **further** defects surfaced and were
fixed: a status update was only *owner*-scoped rather than *device*-scoped (a
second paired machine belonging to the same creator could report on — and release
the lease of — the first machine's job, breaking "jobs route to exactly one paired
device"), and the CLI retried an unreachable Hub forever, so it never returned the
exit code it documents for that case.

The Hub path still reuses the C-519 runner rather than growing a second one: a
claimed dispatch is projected into a one-item `GenerationPlan` and handed to
`executeBatch`, and the client's `effectiveSpecHash` comes from the same
`computeEffectiveSpecHash` canonicalizer the CLI and runner use. No Queue and no
Durable Object were provisioned.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Three front doors on one vocabulary: a Hub dispatch projects onto the *same* `GenerationPlanSchema` the CLI emits (schema-checked), the same `GenerationBudget`, and the client's hash comes from the shared `computeEffectiveSpecHash` (extracted to `studio_dispatch_spec.ts` so it is checkable from outside the app). Composed-order completion is proven end to end against the live hub — candidate persisted, then `awaiting_review` with the lease released — and the late-candidate case is still accepted. Re-submitting one locked request resolves to one dispatch; smuggled fields are refused 422. **Remaining caveat:** the three hashes are proven *identical* (one canonicalizer, asserted by the Hub round-trip and the shared module), but a single job executed from *all three* doors in one transcript is not produced — a CLI execution needs an engine. That gap is stated, not hidden. |
| AC-2 | ✅ | Crossed-owner matrix against the live hub: a crossed account gets `404` on read/cancel and cannot claim; revocation blocks new claims and leaves the queued dispatch byte-intact; a format-valid unknown credential is `401`; the creator-visible device list is proven to carry no `tokenHash` and no `rt_` prefix; pairing codes are single-use and expire; artifact tickets are private-staging, owner-scoped, hash-verified and expiring. **New:** device routing is now enforced — a *second device of the same owner* gets `403 device_mismatch` when it reports on the first device's job (`assertDispatchDevice`). |
| AC-3 | ✅ | Typed availability with an actionable remedy, verified on the live hub (`no_runner_paired` → `paired_outbound` → `runner_revoked`), plus the client resolver's blocked-loopback fallback (6 unit tests) wired into the production image adapter. **Scope limitation stated in the report:** the browser matrix is Chromium (plus the Tauri WebView by construction); no Firefox/WebKit lane was added. This is still the unapproved Amendment 1.2.0 proposal. |
| AC-4 | ✅ | Live fence tests: `stale_attempt` and `lease_not_held` refused by name and proven to change nothing; `invalid_request` for a malformed body; claim CAS; unique lease id; idempotent re-submission; capability mismatch refused before the claim. Runner side: a lost race retried with nothing resubmitted, a revoked credential stopping the loop after one attempt, a stale final report surfaced as a refusal, and the shipped call order asserted explicitly. |
| AC-5 | ✅ | No sign-in, Hub origin or paired device is required for local generation. A refresh with no session makes zero API calls; the Hub page degrades to "sign in" / "unconfigured" instead of 500-ing; a blocked loopback with no Hub answers `hub_unconfigured` with a *local* remedy. Client `views/studio` suite 50/50. |
| AC-6 | ✅ | The Hub review surface ships with one `role="status"` live region, labelled keyboard controls, `<figure>/<figcaption>` for the pairing command, image previews with descriptive `alt`, audio `<audio controls>`, and local-only/expired states stated in text. Verified by a **keyboard-only Playwright journey** (focus Accept, press Enter, assert the announcement reads "not published") and by a **visual suite** scoring **95/100** with every required field true. Cancellation is announced as a *request* until confirmed; the live heartbeat test proves the ask now reaches the runner. **New:** a finished job with upload off states that its bytes exist only on the paired machine. |
| AC-7 | ✅ | Migration `0011` is drizzle-kit's own generated DDL for five new tables; a dedicated test migrates an isolated database to the pre-0011 revision, records `user`/`account_backups` counts, applies `0011`, and asserts the counts are identical and the five tables exist empty. Unique/CHECK constraints proven to bite. Rollback is "disable the routes". |
| AC-8 | ✅ | Both guides updated against the shipped surfaces, now including the new `--credentials-dir` flag and the bounded-transport-failure exit code. The C-519 AC-9 docs↔CLI guard in `apps/backend/image/scripts/generate_batch.test.ts` passes 57/57. |

### Files Created (round 2)

| File | Purpose |
|---|---|
| `apps/e2e/tests/hub/generation_runner.spec.ts` | 11 Playwright tests against the **live hub**: the two defect regressions, AC-2 ownership/revocation/device-routing, AC-4 fences, AC-3 availability, idempotency, the allowlist, and two keyboard-only UI journeys. |
| `apps/e2e/src/visual/suites/generation_runner.visual.ts` | AC-6 visual suite for the Hub review surface: seeds a real paired device + claimed dispatch + private candidate through the API, then captures and AI-validates. |
| `apps/frontend/client/src/lib/views/studio/studio_dispatch_spec.ts` | The studio's allowlisted dispatch spec + canonical hash, extracted so hash identity is checkable from outside the app (`$services`-free). |

### Files Modified (round 2)

| File | Change |
|---|---|
| `apps/backend/local-stack/stack/generation/hub_runner_loop.ts` | 🔴 **BUG 1** — report the candidate *before* the terminal status (which releases the lease), with the reason recorded. **Also:** bound consecutive transport failures so an unreachable Hub ends the loop instead of retrying forever, and return *why* it stopped. |
| `apps/frontend/hub/src/lib/server/api/asset_generation_runner.ts` | 🔴 **BUG 2** — stop filtering the caller's own dispatch out of `pendingCancellationDispatchIds`; retire an ask only on a *confirmed* stop, and exclude terminal dispatches from the pending query. **Also:** enforce device routing on status; `invalid_request` for schema-parse failures. |
| `apps/frontend/hub/src/lib/server/api/asset_generation_seam.ts` | The **attempt** is the candidate fence; a legitimately released lease is no longer treated as a stale result. Device routing enforced. |
| `apps/frontend/hub/src/lib/server/api/asset_generation_artifacts.ts` | Device routing enforced on ticket requests; `invalid_request` for schema-parse failures. |
| `apps/frontend/hub/src/lib/server/api/asset_generation_runner_shared.ts` | New `assertDispatchDevice` — one dispatch routes to exactly one paired device. |
| `packages/shared/schemas/src/lib/generation/runner_dispatch.ts` (+ test) | New `invalid_request` rejection code; import ordering. |
| `apps/frontend/hub/src/lib/views/studio_assets/*` | `localOnlyStatement` (AC-6's missing text), `data-testid="studio-assets"`, `failureMessage` rename off `BaseViewModel.error`. |
| `apps/backend/local-stack/stack/pair_runner.ts` (+ test) | `--credentials-dir`; map the loop's stop reason onto the documented exit codes (0/3/4); the CLI tests are now hermetic instead of reading the developer's real credential file. |
| `apps/backend/local-stack/stack/generation/hub_runner_client.ts` | `ArrayBuffer` body for the artifact upload (valid under both the DOM and Bun typings). |
| `apps/backend/local-stack/stack/generation/hub_runner_loop.test.ts` | The scripted client is now a **server model**: it releases the lease on a terminal status and refuses a post-release candidate, so the call *order* is assertable rather than merely the presence of calls. |
| `apps/e2e/src/visual/core/capture.ts` | New optional `waitSelector` on a suite. `hub_ready` polls for the *catalog* grid, which no other hub route renders, so a non-catalog hub suite had no honest way to say "my page is ready". |
| `apps/frontend/client/src/lib/views/studio/studio_composition.ts` | Uses the extracted dispatch-spec module. |
| `apps/frontend/docs/.../creating-assets.mdx`, `generating-assets.mdx` | `--credentials-dir`; the bounded-transport-failure exit code. |

### Deviations from Spec

1. **Migration 0011 is hand-FILED but machine-GENERATED.** `drizzle-d1/meta/` is gitignored and absent at HEAD, so `drizzle-kit generate` emits a whole-schema `0000_*.sql` rather than a delta. Every statement in `0011` is drizzle-kit's own DDL for the five new tables, extracted in dependency order; nothing was written by hand. Recorded in the file header.
2. **`generation_candidates` added (scope expansion).** AC-1's candidate lineage and AC-2's "pending artifacts remain private" need a private Hub-side candidate record, and none existed. No FK into `community_assets`, no public namespace key.
3. **`modality` denormalised onto the dispatch.** The Hub must reject a capability mismatch before the claim, but importing the recipe registry into the Worker request path is the wrong dependency direction.
4. **`waitSelector` added to the shared visual harness.** Additive, and only consulted when a suite declares one; the alternative was widening `_waitForHubReady`'s catalog-specific poll for one suite.
5. **New `invalid_request` rejection code.** A malformed body now answers a schema error instead of `device_mismatch`, which sent callers hunting for an identity bug.
6. **Still open — the browser matrix.** Open Question 1 is unresolved: no Firefox/WebKit/WebView2 lane was added. The proposed Amendment 1.2.0 (scope AC-3/AC-6 to Chromium plus a stated limitation) is recorded below and **not applied** — it needs user approval.
7. **`validate()` still cannot run** — `failed to detect affected projects: Parse failed: Invalid project record at index 0`. Per-project moon tasks were run instead. This diff touches no `moon.yml`, so it is a tooling/topology issue.
8. **Pre-existing baseline failure**, unrelated: `apps/frontend/client/src/lib/views/game/ui/overlays/dialogue/dialogue_overlay_view_model.svelte.ts:17` errors on a raw `tsc` run at HEAD; the project's real check (`client:typecheck`) passes with 0 errors.

Proposed amendment (not applied — user decision):

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.2.0 | 2026-09-14 | AC-3/AC-6: scope the browser matrix to Chromium and the Tauri WebView with the limitation stated explicitly, since no Firefox/WebKit lane is provisioned for the hub. | pending |

### Test Results

- Unit/integration: **PASS**
  - `@aikami/schemas`: 776/776
  - `@aikami/backend-database`: 14/14
  - `hub`: 227/227 across 24 files — includes 7 new regression tests: the shipped completion order, the late-candidate tolerance, the stale/foreign-lease refusals, the own-dispatch cancel delivery, the confirmed-stop retirement, the malformed-body code, and the per-owner multi-device routing rule
  - `local-stack`: 208 pass / 8 skip / 0 fail — includes the reworked server-model loop tests and the hermetic CLI tests
  - `client` `views/studio`: 50/50
  - `image` (the C-519 AC-9 docs↔CLI guard): 57/57
- E2E (Playwright, `hub` project against the live hub on `:7520`): **11/11 PASS**
  - `AC-1 the shipped completion order persists the candidate and releases the lease` (BUG 1 regression, live)
  - `AC-1 a candidate arriving after the terminal release is still recorded`
  - `AC-6 a status heartbeat is answered about its own dispatch's cancel ask` (BUG 2 regression, live)
  - `AC-4 the fence rejects a stale attempt and a foreign lease by name`
  - `AC-2 a second device of the same owner cannot report on the first device's job`
  - `AC-2 pairing, ownership and revocation hold on the real routes`
  - `AC-3 availability resolves to a paired device, then names why it cannot`
  - `AC-1 re-submitting the same locked request resolves to one dispatch`
  - `AC-1 a dispatch spec with an unknown field is refused outright`
  - `AC-6 a keyboard-only journey reviews a private result and announces it is not published`
  - `AC-6 a finished local-only job states where its bytes are`
- Visual: **PASS — score 95/100**, all required fields true (`headingVisible`, `pairedDeviceListed`, `dispatchListed`, `candidateReviewable`, `privateWording`, `noOverflow`). Captured to the gitignored `apps/e2e/test-results/visual/` (never committed).
- Lint/format: Biome clean on schemas, types, backend-database, hub `src/`, client `views/studio/`, local-stack `stack/`, e2e, image `scripts/`, docs.
- Typecheck: `schemas`, `types`, `backend-database`, `local-stack`, `e2e`, `hub` (svelte-check 0 errors), `client` (svelte-check 0 errors).
- Baseline: 1 pre-existing failure (item 8), **0 new failures**.

### Round-2 test-environment notes (worth keeping)

- **Better Auth requires an `Origin` header on API sign-in.** A Playwright `APIRequestContext` sends none, so every test in the new hub spec initially failed at sign-in with `403 MISSING_OR_NULL_ORIGIN`. Both the spec and the visual suite now set it, and the reason is recorded at both call sites.
- **The visual capture context has no `baseURL`,** so `page.request.post('/api/...')` fails with `Invalid URL`; the suite derives the origin from `page.url()`.
- **`bunx playwright test --project=hub` boots the global `webServer` array,** which includes the client preview and therefore needs a client build. The spec was run against a running hub with a temporary hub-only config (`testDir: ./tests/hub`, `baseURL: http://localhost:7520`, no `webServer`); that config was **not** committed. In CI the standard `--project=hub` path works because the builds exist.
