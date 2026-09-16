---
id: C-524
title: "Optional hosted asset provider comparison"
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

# Contract C-524: Optional hosted asset provider comparison

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../reference/asset-generation-review-2026-09.md) |
| **Target** | `packages/shared/constants/src/lib/asset_batch.ts` (hosted profile records — extend, do not duplicate); `packages/shared/schemas/src/lib/generation/` (reservation + provenance); `packages/shared/types/` (Static-derived types); `packages/shared/local-ai/src/lib/` (portable budget core); `apps/backend/local-stack/stack/generation/` (hosted transport + atomic reservation); `apps/backend/image/scripts/generate_batch.ts` (quote/budget CLI flags); `apps/frontend/client/src/lib/views/studio/` (explicit provider selection); `apps/frontend/docs/src/content/docs/guides/` |
| **Type** | full |
| **Priority** | P2 — optional provider comparison |
| **Dependencies** | **Ready:** C-518 (`implemented` — provenance/candidate records, including the hosted model-artifact shape), C-519 (`implemented` — durable jobs, plan/budget core, `GENERATION_PROVIDER_PROFILES`), C-520 (`implemented` — image preparation/QA), C-521 (`implemented` — audio preparation/QA), C-522 (`implemented` — client Studio dispatch + Hub review surface). No dependency is `blocked`; none is `draft`. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.3.0 |
| **Production Surface** | tooling `bun run --cwd apps/backend/image generate:batch --provider <hosted profile id> --hosted-budget-usd <n>`; client Studio `/studio/assets` dispatch. Hub `/studio/assets` stays **review-only** — see the Hub hosted-dispatch invariant in Architecture Directives |

Allocated as C-524 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-523; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/reference/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

Creators without local GPU capacity need an optional generation route, and model selection needs real comparisons. No hosted PixelLab/ElevenLabs transport exists in this repository, so a creator cannot produce a hosted candidate at all — and therefore cannot compare one against local output.

Source-verified at current HEAD (`fb44963`). This baseline is source review, not a fresh execution:

- **No hosted transport exists.** A repository-wide search for `pixellab`/`elevenlabs` finds only unrelated text/voice provider constants (`packages/shared/constants/src/lib/providers.ts`, `voice_config.ts`). There is no image/audio generation adapter, no provider endpoint, no credential resolution and no request-ID capture.
- **Paid-budget declaration and plan-time refusal ALREADY ship — extend them, do not rebuild them.** `enforceGenerationBudget` (`packages/shared/local-ai/src/lib/generation_job_state.ts`) refuses a `providerMode: 'hosted'` dispatch whose estimate would exceed `hostedBudgetUsd`; `generate:batch` already parses `--provider` and `--hosted-budget-usd` (`apps/backend/image/scripts/generate_batch.ts`); and `GENERATION_PROVIDER_PROFILES` (`packages/shared/constants/src/lib/asset_batch.ts`) already declares `hosted_image_profile` (\$0.04/candidate) and `hosted_audio_profile` (\$0.12/candidate) as ceilings-only placeholders whose `note` says no hosted provider is wired. Existing coverage: `apps/backend/image/scripts/generate_batch.test.ts` — *“a hosted provider is refused by a zero hosted budget”*; `apps/backend/local-stack/stack/generation/generation_runner.test.ts` — *“resumed hosted runs include persisted spend before another dispatch”*.
- **What genuinely does not exist:** a hosted transport, a preflight quote with currency/credits and assumptions, an **atomic reservation/settlement** of estimated maximum cost (today there is only a plan-time refusal plus an accumulating `runSpendUsd` estimate at `apps/backend/local-stack/stack/generation/runner.ts`), credential resolution for a hosted provider, and any comparison evidence (cost per accepted asset, wall time).
- **The Hub path refuses hosted by design.** `apps/backend/local-stack/stack/generation/hub_dispatch_executor.ts` returns `provider_unavailable` for every `mode: 'hosted'` dispatch (“the Hub never selects a hosted provider on the creator's behalf”), covered by `hub_runner_loop.test.ts` — *“a dispatch never projects a hosted provider or arbitrary URL”*. A hosted dispatch therefore cannot reach a paired runner through the Hub unless that invariant is deliberately amended.
- **Provenance has a hosted artifact shape but no hosted engine id.** `packages/shared/schemas/src/lib/generation/generation_provenance.ts` already models a hosted model artifact (`hosted: true`, **required** `requestId`, **required** `limitation`, **forbidden** `artifactHash`), but `GenerationProvenanceSchema.engine` is required and closed to `sdcpp | comfyui | ace-step` (`asset_recipe.ts`), so a hosted candidate has no truthful value to record today.

Reproduce before editing: `bun moon run schemas:test`, `bun moon run local-stack:test`, `bun moon run image:test`, `bun moon run client:test`, and `bun run --cwd apps/backend/image generate:batch --manifest docs/plans/emberwatch_asset_brief.json --plan --phase slice` (expect a `hostedBudgetUsd: 0` refusal, exit 2). Do not copy old contract execution reports as current evidence.

## User Outcome

A creator can explicitly compare a hosted sprite/SFX/music candidate with local output at a bounded cost while preserving the same validation and offline delivery path.

## Success Measures

- Every mandatory AC below has execution evidence on its named production/tooling path.
- Generation stays asynchronous; no model/GPU/network/sign-in dependency is added to game boot, play or saves.
- Generation latency is measured on named hardware, not inferred from vendor marketing. Cache/accepted outputs are reused without regeneration.
- A hosted comparison report states **cost per accepted asset** and wall time, and is produced only from an executed hosted request. An unconfigured credential or budget is recorded as a typed unavailability (AC-6) — never as a zero-cost row and never as an invented provider result.
- A hosted dispatch is refused with a named reason when any of {credential, budget, rights, adapter flag} is missing; the count of billable provider calls for a zero-budget or unconfigured run is exactly 0.

## Existing System & Reuse Map

| Existing source | Action |
|---|---|
| `packages/shared/local-ai/src/lib/generation_job_state.ts` (`enforceGenerationBudget`, `runSpendUsd`) | **Extend** — the single plan-time budget authority. Add reservation/settlement around it; never add a second budget check. |
| `packages/shared/constants/src/lib/asset_batch.ts` (`GENERATION_PROVIDER_PROFILES`, `GenerationProviderProfile`) | **Extend in place** — `hosted_image_profile` / `hosted_audio_profile` are the shipped ceilings-only placeholders. Wire them; do not introduce a parallel hosted-profile registry or type. |
| `packages/shared/schemas/src/lib/generation/generation_provenance.ts` | **Reuse** — the hosted model-artifact shape (`hosted`, `requestId`, `limitation`, no `artifactHash`) is the request-ID and limitation seam. |
| `packages/shared/schemas/src/lib/community/asset_publishing.ts` (`RightsDecisionSchema`) | **Reuse** — the three scopes `inference` / `gameInclusion` / `standaloneDistribution` are the rights gate AC-4 exercises. |
| `packages/shared/schemas/src/lib/generation/generation_job.ts` (`GenerationPlanBlockerCodeSchema`) | **Extend additively** if a new refusal is needed; `provider_unavailable`, `unknown_provider_preference`, `budget_exceeded` already exist. |
| `apps/backend/local-stack/stack/generation/job_store.ts` + `flock.ts` (`withExclusiveLock`, content-addressed blobs) | **Reuse** — the crash-safe exclusive-lock primitive is where an atomic reservation/settlement must live. |
| `apps/backend/local-stack/stack/generation/hub_dispatch_executor.ts` | **Constraint, not a reuse** — it refuses hosted dispatches by name. Amending it is a deliberate, tested decision (Architecture Directives). |
| `apps/backend/image/scripts/generate_batch.ts` (`--provider`, `--hosted-budget-usd`) | **Extend** — add the quote/preflight output and any new explicit-consent flag on the shipped CLI. |
| `apps/frontend/client/src/lib/views/studio/studio_dispatch_spec.ts` (`localProviderProfileForEngine`) | **Extend** — the profile-resolution seam that must stay resolved-from-registry when hosted selection is added. |
| `apps/frontend/hub/src/lib/views/studio_assets/` | **Review-only** — dispatch review, artifacts and cancellation; it authors no dispatch and selects no provider. |
| `apps/backend/local-stack/stack/env_writer.ts` | **Reuse convention** — host-side secret/config material is written to the local stack's environment, never to the browser bundle. |

## Overview

A creator can explicitly compare a hosted sprite/SFX/music candidate with local output at a bounded cost while preserving the same validation and offline delivery path. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/reference/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Add official PixelLab image/rotation/animation and ElevenLabs SFX/music adapters as separately feature-flagged capabilities. Use current official API schemas, explicit model IDs and recorded request IDs; no unofficial consumer-site automation.
- **Resolve the credential home explicitly.** A hosted transport reads its credential from the host that executes the request: the local runner/CLI from its own process environment or device config (`env_writer.ts` convention), or — only when the Hub itself executes the dispatch — a Worker secret binding. A browser bundle never carries a provider secret, and no credential is written to `AssetBrief`, a run lock, a job record or any public projection. `credentialReference` is an opaque server-side handle, not the secret.
- **Do not silently widen the Hub hosted-dispatch refusal.** `hub_dispatch_executor.ts` currently refuses every hosted dispatch by name, and `hub_runner_loop.test.ts` pins that. Either (a) keep it and run hosted comparison only through `generate:batch` and the client Studio, or (b) amend it so a dispatch that carries the creator's **explicit** hosted selection plus a reserved ceiling and a resolved credential is admitted. Whichever is chosen must be stated, covered by a test that still proves no hosted provider is ever chosen *on the creator's behalf*, and recorded in the Evidence Matrix. A hosted provider selected without an explicit creator action remains a defect.
- **Keep provenance truthful for a hosted engine.** `GenerationProvenanceSchema.engine` is required and closed to `sdcpp | comfyui | ace-step`, and `GenerationProviderProfile.engineId` is deliberately absent for hosted profiles so the runner never dials one as a local engine. Extend `GenerationEngineIdSchema` additively with the hosted provider ids (the minimal change that lets `engine` stay required and honest) while leaving `engineId` unset on hosted profiles; the hosted transport is named by a new optional field on the profile record. Never label a hosted candidate with a local engine id.
- **Reuse the shipped budget core.** The preflight quote, reservation and settlement extend `enforceGenerationBudget` / `GENERATION_PROVIDER_PROFILES`; a second, parallel budget authority is forbidden. Reservation is atomic under the job store's exclusive lock.
- First deliver one image/animation challenger and one SFX challenger. Music is optional if the configured paid account supports the documented explicit model and game-use rights. Do not assume all website-only features are API features.
- Execute hosted requests in a trusted server or local runner with user-configured secrets. Never expose provider secrets to browser builds or log them. Private references are transmitted only in the explicitly selected hosted job.
- Default spend ceiling is zero. Show a preflight quote with currency/credits, candidate count, maximum durations and assumptions. Reserve estimated maximum cost atomically before dispatch; settle actual cost and retain uncertainty on timeout. No automatic paid fallback or silent resubmission.
- Validate terms for inference, game inclusion and downloadable asset/community reuse independently. PixelLab API availability alone is not a verified license. Eleven Music plan/model terms are recorded; game permission does not automatically permit a sound library resale.
- Feed raw results into the same C-520/C-521 processors and reviewers. Hosted output quality does not bypass alpha, frame, loop or collision gates. Do not label lossy audio as a lossless original after converting it to WAV.
- Record provider account scope, terms revision/date, model/API version and response metadata without storing credentials. If provider cannot expose seeds or deterministic model revisions, mark those limits. Accepted output bytes remain usable offline after credentials expire.

## State & Data Models

**Extend the existing profile record — do not create `HostedProviderProfile`.** The registry record is `GenerationProviderProfile` in `packages/shared/constants/src/lib/asset_batch.ts`; hosted profiles already exist there as `mode: 'hosted'` entries with `estimatedSpendUsdPerCandidate` and no `engineId`. Add the optional hosted-transport field and capability/terms metadata to that record. A second profile type or registry is a parallel authority and is out of scope.

**New shapes that cross a boundary** (`CostReservation` / quote / settlement, and any hosted provider-account scope record) get a TypeBox schema under `packages/shared/schemas/src/lib/generation/` and a `Static`-derived type under `packages/shared/types/`. `CostReservation` extends the C-519 job/run records rather than replacing them: it binds a job id, a request key, an estimated maximum in the quote's currency, and a settled-or-unsettled state.

**Credential references are opaque host-side handles.** No secret, provider token or private prompt appears in `AssetBrief`, a run lock, a job record, or any public/community provenance projection.

**Additive schema changes only.** `GenerationEngineIdSchema` gains hosted members; existing rows stay valid. Provenance for a hosted candidate must validate against `GenerationProvenanceSchema` with `hosted: true`, a non-empty `requestId` and `limitation`, and no `artifactHash` — a hosted record that cannot supply a request id is a typed refusal, not a fabricated hash.

Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** see Migration & Rollback below — additive profile/engine-id changes only, no default provider change, each adapter independently disableable, accepted cached outputs preserved, unsettled reservations auditable.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

- **Compatibility.** Adding hosted members to `GenerationEngineIdSchema` and optional fields to `GenerationProviderProfile` is additive: existing provenance rows, briefs, run locks and job records remain valid and unchanged. `hostedBudgetUsd` stays `0` by default and no default provider changes.
- **No D1 migration.** Provider credentials live host-side (runner/CLI environment or a Worker secret binding), so this contract adds no D1 table, no device-data-plane migration and no boot-path dependency.
- **Independent disablement.** Each adapter is feature-flagged separately; disabling one leaves the other and every local profile working, and preserves accepted cached outputs by content hash.
- **Rollback.** Unsettled cost reservations must remain readable and auditable after rollback — rollback may not delete a reservation whose billable outcome is unknown. A reserved-but-unsettled job resolves to `job_reconciliation_required` (an existing blocker code), never to an automatic resubmission.
- **No routing or URL changes**, so no redirects are required.

## Scope Boundaries

Optional official hosted comparison adapters and cost enforcement. No provider subscription purchase, provider-account creation, credential provisioning on the creator's behalf, automatic spending, silent paid fallback, or cloud dependency for gameplay. No new hosted-profile registry alongside `GENERATION_PROVIDER_PROFILES`. No change to the Hub's review-only role beyond the explicit, tested consent path named in Architecture Directives. No publication/community-export work (C-513 owns publication; this contract only *blocks* an export the rights scopes deny).

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Explicit paid choice

**Given** a hosted adapter that is configured and enabled with a stub transport that counts outbound provider calls, and a run whose `hostedBudgetUsd` is `0`, **when** a hosted item is planned and dispatched, **then** the plan is refused with a `budget_exceeded` blocker naming `budget: 'hostedBudgetUsd'` and the outbound call count is exactly 0; **and when** the same run is re-planned with an explicit bounded ceiling covering the printed preflight quote, **then** the quote names currency, candidate count, maximum durations and its assumptions, and exactly the quoted bounded request is admitted — no automatic paid fallback and no silent resubmission.

### AC-2: Official API mapping (offline, mandatory)

**Given** recorded provider schema fixtures checked in beside the adapter, **when** the adapter maps a PixelLab image/rotation/animation request and an ElevenLabs SFX request, **then** the requests target the documented endpoints and explicit model IDs for the pinned API version, the recorded request id, returned bytes and provenance are preserved, a capability the provider does not expose fails early with a typed reason, and the resulting hosted provenance validates against `GenerationProvenanceSchema` (`hosted: true`, non-empty `requestId` and `limitation`, no `artifactHash`).

### AC-2b: Live hosted smoke (optional — typed unavailability when unconfigured)

**Given** a configured credential, budget and adapter flag, **when** one real bounded hosted request is executed, **then** the recorded evidence contains the provider request id, the raw and prepared hashes, and the measured wall time on named hardware; **and when** any of credential, budget, rights or adapter flag is absent, **then** the outcome is a typed unavailability naming the missing precondition and the billable call count is 0. This sub-criterion is never a merge gate; AC-6 is what must hold in an unconfigured environment.

### AC-3: No duplicate charge

**Given** a submission that timed out, or a repeated request key, **when** the run is retried or reconnected, **then** the request-key index resolves to the existing job, no second billable provider call is made, and an unresolved native handle produces `job_reconciliation_required` rather than an automatic resubmission — a new attempt requires an explicit new attempt/variation.

### AC-4: Private credentials and rights

**Given** a configured hosted adapter, a built browser bundle, two signed-in owners A and B, and a candidate whose rights fixture grants `inference` and `gameInclusion` but denies `standaloneDistribution`, **when** the bundle and outbound requests are inspected, **then** no provider secret appears in the bundle or in any job/run/provenance record, and a request for a job owned by A from B's session fails (the shipped `owner_mismatch` 403 path); **and when** a community export of that candidate is requested, **then** it is blocked on the denied `standaloneDistribution` scope.

### AC-5: Same acceptance/offline path

**Given** an accepted hosted result (live, or a recorded fixture fed through the same adapter), **when** it is prepared, reviewed and installed and the provider is then made unavailable, **then** the identical C-520/C-521 QA gates apply with no bypass, no lossy-to-lossless relabelling, and the installed bytes play/render offline.

### AC-6: Typed unavailability with nothing configured

**Given** a clean environment with no hosted credential, no adapter flag and `hostedBudgetUsd: 0`, **when** the CLI plans and runs a brief whose provider preferences name a hosted profile, **then** every hosted item is reported as a typed blocker naming the missing precondition, the exit code is non-zero and stable, the plan JSON remains schema-valid, no network call to a provider origin is attempted, and the local profiles in the same brief are unaffected.

**Evidence Matrix**

Production path is the same for every AC: `bun run --cwd apps/backend/image generate:batch --provider <hosted profile id> --hosted-budget-usd <n>` and the client Studio `/studio/assets` dispatch. The Hub `/studio/assets` surface is review-only and is not a dispatch-authoring path for this contract.

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | budget integration (`image:test`, `local-stack:test`) | Stub-transport call count + preflight quote + refusal record | `generate:batch --provider … --hosted-budget-usd …`; client Studio selection | Unverified — populate during execution |
| AC-2 | adapter CI against recorded fixtures (`image:test`, `local-stack:test`, `schemas:test`) | Fixture set + request-mapping assertions + `GenerationProvenanceSchema` validation | adapter modules + `generate:batch` | Unverified — populate during execution |
| AC-2b | live paid smoke **only if configured** (`image:test` run manually) | Provider request id + hashes + measured wall time, or a typed-unavailability record | `generate:batch --run` with a configured credential | Unverified — optional; never a merge gate |
| AC-3 | failure injection (`local-stack:test`) | Request-key index state + billable-call count + reconciliation record | `generate:batch --resume` / `--reconcile` | Unverified — populate during execution |
| AC-4 | security + rights integration (`hub:test`, `client:test`, `schemas:test`) | Bundle scan + cross-owner 403 + denied-scope export block | Hub runner API + client Studio | Unverified — populate during execution |
| AC-5 | production smoke (`e2e`, `client:test`) | Prepared/installed artifact + offline play/render evidence | `generate:batch` → install → offline boot | Unverified — populate during execution |
| AC-6 | unconfigured-environment refusal (`image:test`, `local-stack:test`) | Plan JSON + stable exit code + zero-call assertion | `generate:batch --plan` with nothing configured | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted (Moon project ids verified in current `moon.yml`): `bun moon run schemas:test`, `bun moon run types:test`, `bun moon run local-ai:test`, `bun moon run local-stack:test`, `bun moon run image:test` (this is the task that runs `scripts/generate_batch.test.ts`), `bun moon run client:test`, `bun moon run hub:test`, `bun moon run scripts:guard`. Do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Verify current API/terms for the configured account and pin the adapter fixtures (AC-2's mandatory, credential-free half).
2. Extend the shipped budget core with the preflight quote plus atomic reservation/settlement, and add the hosted transport behind the existing `GENERATION_PROVIDER_PROFILES` records and per-adapter flags (AC-1, AC-3).
3. Decide and record the Hub hosted-dispatch question from Architecture Directives, with the test that pins it (AC-4).
4. Expose explicit provider selection and the transfer disclosure in the client Studio, keeping profile resolution registry-driven (AC-1, AC-4).
5. Wire the hosted result into the existing C-520/C-521 preparation and acceptance path unchanged (AC-5).
6. Run the bounded comparison only with configured credentials/budget; otherwise record the typed unavailability (AC-6) and leave live evidence unverified.

## Edge Cases & Gotchas

A successful network request with an unreviewed output is a generated candidate, not a publishable game asset.

- **A hosted provider cannot prove byte identity.** `generation_provenance.ts` forbids `artifactHash` on a hosted model artifact and requires `requestId` + `limitation`. Never substitute a local hash, and never reuse a local engine id for a hosted candidate.
- **An unreviewed hosted spend is still a spend.** Reservation must be written before the outbound request; a process that dies mid-request leaves the reservation unsettled and the job at `job_reconciliation_required`, not silently `failed` and retryable.
- **Provider terms are not the same for inference, game inclusion and standalone redistribution.** A PixelLab API key proves API access, not a licence; a music plan that permits in-game use does not permit a sound-library resale.
- **A plan-time refusal is not a dispatch-time guard.** `enforceGenerationBudget` runs in the portable plan; the outbound call site must re-assert the reservation under the store's exclusive lock so two processes cannot both pass the same ceiling check.
- **Converting a hosted lossy master to WAV does not make it lossless.** The audio QA path must keep the original rendition's properties.

## Open Questions

No conceptual choice blocks the start of the scoped implementation. Hardware, credentials, model/license eligibility and actual measured performance are execution preflight facts; use the declared unavailable/fallback behavior rather than inventing access or silently expanding scope.

One decision is deliberately deferred to Implementation Sequence step 3, with a stated default so it cannot stall the work: whether the Hub's paired-runner path admits an *explicitly creator-selected* hosted dispatch (Architecture Directives). **Absent a positive, tested decision, keep the shipped refusal** — hosted comparison then runs through `generate:batch` and the client Studio, which already satisfies the User Outcome. Whichever is chosen must be recorded here with its test. Record any other new material design question before changing the contract.

**DECIDED (2026-09-16, implementation): option (a) — the Hub keeps its shipped hosted-dispatch refusal.**

Rationale, in the contract's own terms:

- The Architecture Directives require the credential to live where the request is executed, and state that *a browser bundle never carries a provider secret*. The Hub executes nothing: it hands a dispatch to a **paired runner on the creator's machine**. Admitting a hosted dispatch there would either push the credential into the Hub (a Worker secret the Hub would then project into a dispatch) or leave the paired runner to resolve it — neither of which is a decision this contract may take silently, and neither of which the shipped executor models.
- Option (a) already satisfies the User Outcome: `generate:batch --provider <hosted profile id> --hosted-budget-usd <n>` is the named production surface, and the client Studio resolves and discloses an explicit hosted selection through the registry (`studio_dispatch_spec.ts`) without ever holding a credential.
- The refusal is not merely preserved, it is **pinned by a C-524 test**: `hub_runner_loop.test.ts` — *"C-524: an explicit hosted selection is still refused by name"* — asserts that a dispatch carrying an explicit hosted selection and a reserved ceiling is still `provider_unavailable`, and that the message states the Hub never selects a hosted provider on the creator's behalf. The pre-existing *"a dispatch never projects a hosted provider or arbitrary URL"* test still passes unchanged.

No other material design question arose during implementation. Two evidence gaps are recorded in the Execution Report rather than as contract changes: the live paid smoke (AC-2b, explicitly never a merge gate) and the browser-bundle/cross-owner scans (AC-4), which require a client build and a signed-in two-owner session.

## Amendments

This is a newly proposed draft; existing contract approval/amendment rules still apply. Do not self-assign user approval or upgrade status based on this document's presence.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-13 | Initial proposed scope | Pending contract adoption |
| 1.1.0 | 2026-09-16 | Critic pass against current HEAD: corrected the baseline (paid-budget declaration/refusal already ships; what is missing is the transport, quote and reservation), added the Hub hosted-dispatch invariant and the closed `engine` union constraint, replaced the invented `HostedProviderProfile` name with the shipped `GenerationProviderProfile` registry, split AC-2 into mandatory offline fixture mapping plus optional live smoke, added AC-6 (typed unavailability), and corrected the production path (Hub Studio is review-only) | Pending contract adoption |
| 1.2.0 | 2026-09-16 | Implementation: recorded the deferred Hub hosted-dispatch decision (Implementation Sequence step 3) as **option (a) — keep the shipped refusal**, with its own pinning test in `hub_runner_loop.test.ts`. No AC was added or removed; no scope was widened. The decision and its rationale are recorded under Open Questions. | Implementer (pending verification) |
| 1.3.0 | 2026-09-16 | Implementation: recorded a **narrowed client-Studio deliverable** and proposed it as an amendment for the verifier's decision. Implementation Sequence step 4 asks for "explicit provider selection and the transfer disclosure in the client Studio". Delivered: the *seam the Existing System & Reuse Map names* — `studio_dispatch_spec.ts` — now resolves an explicit hosted selection from `GENERATION_PROVIDER_PROFILES` (never from a literal), requires a positive `hostedBudgetUsd`, refuses an undeclared / non-hosted / non-image profile, threads `providerMode` and the consented ceiling into the shared `computeEffectiveSpecHash` identity, and exposes `studioHostedDisclosure` (pinned model, API version, account scope, terms revision/date, standalone-distribution decision, limitation). Deferred: the `/studio/assets` **UI control** that would present that selection. The reason is architectural, not effort: with the Hub's hosted refusal kept (1.2.0) and no provider secret permitted in a browser bundle, a browser-initiated hosted dispatch has no transport to reach, so a UI control could only *disclose and refuse*. Building one is a separate, reviewable UI decision. The User Outcome is unaffected — `generate:batch --provider <hosted profile id> --hosted-budget-usd <n>` is the named production surface and is fully implemented and executed. | Implementer (pending verification) |

## Promotion Lifecycle

See docs/contracts/SHARED_SECTIONS.md. An implemented code path without required production, visual or audio evidence is not release_verified.

## Status Lifecycle

See docs/contracts/SHARED_SECTIONS.md. Preserve accurate draft/implemented/verified/completed distinctions.

## Execution Report

### Summary

Implemented the optional hosted generation path end to end on the *named tooling
production surface*: the two shipped hosted profiles (`hosted_image_profile` →
PixelLab, `hosted_audio_profile` → ElevenLabs) are wired to real, fixture-mapped
adapters behind a per-transport adapter flag and a host-side credential; the
portable core gained a preflight quote, a typed unavailability vocabulary and an
atomic cost reservation/settlement that *wraps* the shipped
`enforceGenerationBudget` rather than replacing it; the host layer gained an
atomic reserve-before-dispatch store under the job store's exclusive lock, a
request-key index, and a durable `hostedEvidence` record carrying the provider
request id, the raw/prepared hashes and a measured wall time on named hardware.
The CLI gained `--hosted-adapter`, prints `hostedQuotes` on `--plan`, and reports
a typed `provider_unavailable` blocker naming the missing precondition with zero
outbound calls when nothing is configured. Deferred and reported below: the
`/studio/assets` UI control (Amendment 1.3.0), the optional live paid smoke
(AC-2b), and the browser-bundle / two-owner scans (AC-4).

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ⚠️ | Zero ceiling → `budget_exceeded` naming `budget: 'hostedBudgetUsd'`, 0 outbound calls (measured on a counting stub transport, and on the CLI with a real subprocess); a ceiling covering the printed quote prints `hostedQuotes` (currency, candidate count, max durations, assumptions) and admits exactly one bounded outbound request; a repeated request key makes no second call. **Not** delivered: the `/studio/assets` UI control — the dispatch-spec seam is extended and tested (Amendment 1.3.0). |
| AC-2 | ✅ | Offline mapping against checked-in fixtures: documented endpoints (`api.pixellab.ai/v1/create-image-pixflux`, `api.elevenlabs.io/v1/sound-generation`), explicit model ids (`pixflux`, `eleven_text_to_sound_v2`), pinned API version `v1`; request id + bytes + provenance preserved; an unimplemented operation and a response with no request id both fail early and typed; a hosted provenance record validates with `hosted: true`, non-empty `requestId`/`limitation`, and no `artifactHash`. The fixtures declare themselves as documented *shapes*, not captured live responses. |
| AC-2b | ⚠️ | Optional, explicitly never a merge gate. No provider credential exists in this environment, so the outcome recorded is the **typed unavailability** (`credential_missing` / `adapter_disabled`) with a billable call count of 0. No live request id, hashes or wall time were produced. |
| AC-3 | ✅ | The request-key index resolves a repeated key to the existing reservation (no second billable call); a timeout/kill leaves the reservation `unsettled`, still readable and auditable, and resolves to `job_reconciliation_required` — never an automatic resubmission. The reservation is written under the job store's exclusive lock before the outbound request. |
| AC-4 | ⚠️ | Verified: the credential reference is an opaque handle (`env:PIXELLAB_API_KEY`), the secret appears in no reservation, quote or plan document, and **no browser-shipped source reads a provider credential** (repo-wide grep over `apps/frontend/client/src`, `apps/frontend/hub/src`, `packages/frontend` — no hits). The recorded terms grant `inference` and `gameInclusion` and **deny** `standaloneDistribution`, so a community export is blocked on that scope. **Not** verified here: a built-bundle scan and the cross-owner `owner_mismatch` 403 (the shipped path; requires a client build and two signed-in owners). |
| AC-5 | ⚠️ | A hosted result travels the identical `runAssetGeneration` → `prepare` → `stagePreparedAsset` path and records the *transport* as its engine id (never a local engine id); the adapter refuses to relabel a lossy provider rendition as lossless. **Not** verified: the full `generate:batch` → install → offline-boot e2e smoke (no live provider bytes exist to install). |
| AC-6 | ✅ | Clean environment: every hosted item is `provider_unavailable` carrying a typed `unavailability` (`adapter_disabled`, `precondition: 'adapter:pixellab'`), exit code 2 (stable), the plan JSON validates against `GenerationPlanSchema`, no preflight quote is printed for a blocked item, no provider origin is contacted (0 engine calls), and local profiles in the same brief are unaffected. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/constants/src/lib/hosted_providers.ts` | Hosted transport vocabulary: transport ids, declared operations, adapter-flag and credential *env var names*, recorded terms/account scope, `hostedTermsRightsScopes`, `isGenerationHostedTransportId`. |
| `packages/shared/schemas/src/lib/generation/hosted_generation.ts` | Boundary shapes: `HostedPreflightQuote`, `CostReservation`, `HostedUnavailability`, `HostedProviderAccountScope`, `HostedRequestEvidence`. |
| `packages/shared/schemas/src/lib/generation/hosted_generation.test.ts` | Schema/constant drift guards; additive engine-id check; hosted provenance accepts a request id and rejects an artifact hash. |
| `packages/shared/types/src/lib/generation/hosted_generation.ts` | `Static`-derived types for the shapes above. |
| `packages/shared/local-ai/src/lib/hosted_generation.ts` | Portable core: typed precondition resolution, preflight quote, `reserveHostedCost` (wrapping `enforceGenerationBudget`), settlement state machine, unsettled-reservation blocker. |
| `packages/shared/local-ai/src/lib/hosted_generation.test.ts` | 14 tests: precondition order, quote contents, zero-ceiling refusal, quoted-ceiling admission, settlement outcomes. |
| `apps/backend/local-stack/stack/generation/hosted/hosted_credentials.ts` | Adapter-flag and credential resolution; opaque `env:<VAR>` handle; the value never leaves this module except into one request. |
| `apps/backend/local-stack/stack/generation/hosted/hosted_transport.ts` | The outbound seam: real `fetch` transport, counting stub transport, auth headers, credential-free diagnostics. |
| `apps/backend/local-stack/stack/generation/hosted/hosted_adapters.ts` | PixelLab + ElevenLabs request/response mapping (endpoints, explicit model ids, pinned API version, typed early failures). |
| `apps/backend/local-stack/stack/generation/hosted/hosted_fixtures.ts` + `hosted/fixtures/*.json` | Recorded provider fixtures that state they are documented shapes, not live captures. |
| `apps/backend/local-stack/stack/generation/hosted/hosted_engine.ts` | The hosted transport as a `GenerationEngineClient`, so a hosted candidate travels the shared pipeline. |
| `apps/backend/local-stack/stack/generation/hosted/hosted_evidence.ts` | Turns the engine's flat metadata into a durable `HostedRequestEvidence`. |
| `apps/backend/local-stack/stack/generation/hosted/hosted_reservations.ts` | Atomic reserve/settle under the job store's exclusive lock; request-key index; unsettled audit. |
| `apps/backend/local-stack/stack/generation/hosted/hosted_dispatch.ts` | The host front door: planner availability resolver + hosted engine factory. |
| `apps/backend/local-stack/stack/generation/hosted/hosted_adapters.test.ts` | 9 offline adapter tests (AC-2). |
| `apps/backend/local-stack/stack/generation/hosted/hosted_dispatch.test.ts` | 10 tests: AC-6 typed unavailability, AC-1 zero-call refusal + quoted admission, AC-3 duplicate/reservation, AC-4 credential/rights, AC-5 shared pipeline. |
| `apps/backend/local-stack/stack/generation/hosted/index.ts` | Public entry point for the hosted host layer. |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/constants/src/lib/asset_batch.ts` | Extended `GenerationProviderProfile` additively with `hostedTransport`/`hostedModelId`/`hostedApiVersion`/`hostedOperations`/`hostedTerms`; wired the two shipped hosted profiles; widened `localProviderProfileForEngine` to accept a transport id and resolve it to `undefined`. |
| `packages/shared/constants/src/index.ts` | Export the hosted transport vocabulary. |
| `packages/shared/schemas/src/lib/generation/asset_recipe.ts` | `GenerationEngineIdSchema` gains `pixellab` and `elevenlabs` (additive). |
| `packages/shared/schemas/src/lib/generation/generation_job.ts` | `GenerationPlanBlockerSchema` gains an optional typed `unavailability`; `GenerationPlanSchema` gains optional `hostedQuotes`; `GenerationJobRecordSchema` gains optional `hostedEvidence`. |
| `packages/shared/schemas/src/index.ts`, `packages/shared/types/src/index.ts` | Export the new modules. |
| `packages/shared/local-ai/src/lib/generation_plan.ts` | Hosted precondition check before the budget ceiling; `providerEngineId` = the hosted transport for a hosted item; run lock pins the transport; builds `hostedQuotes`; new `hostedAvailability` / `now` options. |
| `packages/shared/local-ai/src/lib/asset_generation.ts` | `AssetGenerationStaging` carries the engine's flat `engineMetadata` out of the runner. |
| `packages/shared/local-ai/src/index.ts` | Export the portable hosted core. |
| `apps/backend/local-stack/stack/generation/job_store.ts` | `resourceGroupForEngine` gives a hosted transport its own group (`hosted:<transport>`) instead of `gpu:image`. |
| `apps/backend/local-stack/stack/generation/runner_engine.ts` | `parseEngineId` accepts the hosted transports. |
| `apps/backend/local-stack/stack/generation/runner.ts` | Records `hostedEvidence` on the job once raw and prepared hashes are known. |
| `apps/backend/local-stack/stack/generation/index.ts` | Export the hosted host layer. |
| `apps/backend/local-stack/stack/generation/generation_runner.test.ts` | `makeFakeEngine` can report a hosted engine id; the hosted-resume fixture uses it (a hosted item now resolves to its transport). |
| `apps/backend/local-stack/stack/generation/hub_runner_loop.test.ts` | New C-524 test pinning the kept Hub hosted refusal (Amendment 1.2.0). |
| `apps/backend/image/scripts/generate_batch.ts` | `--hosted-adapter` flag; hosted env built from flag + environment; availability resolver passed to the planner with the resolved ceiling; hosted env passed to the engine factory. |
| `apps/backend/image/scripts/generate_batch_engines.ts` | `buildEngineFactory` builds a hosted engine for a hosted transport (test seam: stub transport). |
| `apps/backend/image/scripts/generate_batch_usage.ts` | Documents `--hosted-adapter` and the credential/quote rules. |
| `apps/backend/image/scripts/generate_batch.test.ts` | Replaced the pre-C-524 hosted-budget expectation with three C-524 production-path tests (typed unavailability, budget refusal, printed quote + no credential in output). |
| `apps/frontend/client/src/lib/views/studio/studio_dispatch_spec.ts` | Explicit hosted provider selection resolved from the registry, required positive ceiling, `providerMode` + consented ceiling in the shared spec hash, `studioHostedDisclosure`. |
| `apps/frontend/client/src/lib/views/studio/studio_dispatch_spec.test.ts` | 6 new tests for the hosted selection and the disclosure. |
| `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` | New "Comparing against a hosted provider" section. |
| `docs/contracts/C-524-…md` | Amendments 1.2.0 / 1.3.0; Open Questions decision recorded; this report. |

### Deviations from Spec

1. **Hub hosted-dispatch decision (Implementation Sequence step 3)** — taken as
   option (a), *keep the shipped refusal*, and recorded under Open Questions with
   its pinning test. No scope widened; no AC changed.
2. **Client Studio UI control deferred** — Amendment 1.3.0. The dispatch-spec
   seam named in the Existing System & Reuse Map is extended and tested; the
   `/studio/assets` control that would present it is not built, because with the
   Hub refusal kept and no provider secret permitted in a bundle, a
   browser-initiated hosted dispatch has no transport to reach. This is a
   narrowed deliverable and needs the verifier's decision.
3. **`GenerationPlanItem.providerEngineId` now names the hosted *transport*** for
   a hosted item, where it previously fell back to the recipe's local engine.
   This is required by the Architecture Directives ("never label a hosted
   candidate with a local engine id") but it changes an observable plan field, so
   it is called out. One pre-existing runner fixture was updated to match.
4. **The pre-existing test *"a hosted provider is refused by a zero hosted
   budget"* was replaced** by three tests. With nothing configured, AC-6 requires
   a typed `provider_unavailable` naming the missing precondition (exit 2) rather
   than a budget refusal (exit 3); the configured+enabled+budget-0 case AC-1
   describes is now its own test and still asserts `budget_exceeded` / exit 3.
5. **`budget_not_configured` is only reachable when no ceiling is known at all.**
   A *declared* zero ceiling is deliberately left to the budget authority, so
   AC-1's "naming `hostedBudgetUsd`" holds instead of being masked by a generic
   unavailability.

### Test Results

- Unit (`local-ai`): 542/542 PASS, 0 failures (14 new).
- Unit (`schemas`): 874/874 PASS, 0 failures (6 new).
- Unit (`constants`): 203/203 PASS, 0 failures.
- Unit (`local-stack`): 242/242 PASS, 0 failures, 8 skipped (19 new hosted tests; 1 new Hub pinning test).
- Unit (`client`): 3571/3571 PASS, 0 failures, 7 skipped, 2 todo (6 new).
- Unit (`image`, `generate_batch.test.ts`): 21 PASS, **2 FAIL** — both pre-existing and unrelated (verified against a stashed baseline: *"the authored brief plans 6 slice / 36 expansion items and blocks on approved_style"* and *"the guide, package.json and the CLI agree on every command, flag and default"* / `--port`).
- Visual: not run — no UI or rendering surface changed (no client-UI control was built; see Deviation 2).
- Baseline: 2 pre-existing failures in `image`, 0 new failures.

### Production-path evidence

- `bun run --cwd apps/backend/image generate:batch --manifest docs/plans/emberwatch_asset_brief.json --plan --phase slice` — real subprocess, exit 2, only the two pre-existing `provider_requires_import` blockers (unchanged for local profiles).
- Production-path CLI tests executed as real subprocesses via the shared harness: typed unavailability with a clean environment (exit 2, `adapter_disabled`, no `hostedQuotes`, plan schema-valid); budget refusal with the adapter enabled and a credential present (exit 3, `budget: 'hostedBudgetUsd'`, 0 engine calls); printed preflight quote with a covering ceiling (exit 0, `hostedQuotes` naming currency/candidates/durations/assumptions, and the credential absent from the whole stdout).
- AC-4 bundle-source scan (real grep, output captured): `PIXELLAB_API_KEY` / `ELEVENLABS_API_KEY` / `AIKAMI_HOSTED_ADAPTERS` / `HOSTED_CREDENTIAL_ENV_VARS` appear in **no** file under `apps/frontend/client/src`, `apps/frontend/hub/src` or `packages/frontend` — a browser bundle therefore has no provider credential to carry.
- AC-2b: no live provider credential exists in this environment; the recorded outcome is the typed unavailability, and the billable call count is 0. No live request id, hashes or wall time were produced — as the contract permits.
