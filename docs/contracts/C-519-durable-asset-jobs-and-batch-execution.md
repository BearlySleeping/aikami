---
id: C-519
title: "Durable asset jobs and batch execution"
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

# Contract C-519: Durable asset jobs and batch execution

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../research/asset-generation-review-2026-09.md) |
| **Target** | `packages/shared/schemas/src/lib/generation/` + `packages/shared/types/` (brief/job/run-lock/budget schemas); `packages/shared/local-ai/src/lib/` (portable plan, spec-hash, blocker and state-transition core); `apps/backend/local-stack/` (host runner: job store adapter, resource scheduler, leases); `apps/backend/image/scripts/` + `apps/backend/image/package.json` (batch CLI); `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-517 (`implemented`), C-518 (`implemented`) |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.1.0 |
| **Production Surface** | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) |

Allocated as C-519 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-518; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

The existing runner produces one asset and engine adapters serialize per instance. Multiple CLI processes or browser tabs can compete for one GPU, repeated prompt slugs can collide in staging, and there is no locked batch plan or recoverable job record.

Source-verified at current HEAD (baseline is source review, not a fresh execution):

- **No cross-process authority.** `runAssetGeneration` constructs a fresh engine per call (`packages/shared/local-ai/src/lib/asset_generation.ts` — `createGenerationEngine(...)` whenever no `engine` is injected) and holds no lease; `apps/backend/local-stack/` ships compose profiles and native launchers only, so nothing arbitrates the GPU between processes.
- **A second, independent submitter exists.** A client tab talks to the engine through its own `ImageEngineClient` abstraction (`apps/frontend/client/src/lib/services/image/image_generation_service.svelte.ts`, C-388), not through `@aikami/local-ai`, so a CLI run and a tab run contend for one engine with no shared budget.
- **The staging collision is real.** `apps/backend/image/scripts/generate_asset.ts` derives the tag from a prompt slug (`slugifyPrompt` → `expandTagTemplate` in `generated_asset.ts`), writes `<out>/<category>/<name><ext>`, and merges `manifest.json`/`hashes.json` with read-modify-write `Bun.write` — no lock, no atomic replace. The same prompt, or two concurrent runs, overwrites bytes and loses the loser's fragment entries.
- **No job or run record exists.** Repository-wide search finds no job/lease/run-lock/`reconciliation_required` vocabulary outside `docs/contracts/`. C-518's shipped tables (`generation_candidates`, `generation_acceptances`, `generation_artifacts` — migration v7 in `packages/frontend/storage/src/lib/migrations.ts`) record candidates and acceptances, not submitted jobs.

Inspect the source in the reuse map at current HEAD before implementation. Baseline is source-reviewed, not freshly test-executed. Run the related existing project tests before editing; do not copy old contract execution reports as current evidence.

## User Outcome

A script, LLM or UI can plan, run, inspect, cancel and resume a bounded asset batch without losing accepted work or accidentally submitting it twice.

## Success Measures

- Every mandatory AC below has execution evidence on its named production/tooling path.
- Generation stays asynchronous; no model/GPU/network/sign-in dependency is added to game boot, play or saves.
- Generation latency is measured on named hardware, not inferred from vendor marketing. Cache/accepted outputs are reused without regeneration.

## Existing System & Reuse Map

| Existing source | Action |
|---|---|
| `packages/shared/local-ai/src/lib/asset_generation.ts` | reuse dispatch/descriptor seams |
| `apps/backend/image/scripts/generate_asset.ts` | retain old CLI; add thin batch front door |
| `packages/shared/local-ai/src/lib/engines/` | reuse transports, expose native job handles where possible |
| `apps/backend/local-stack/` | host opt-in runner with existing topology conventions |
| `runAssetGeneration` engine injection seam (`AssetGenerationOptions.engine`) | reuse to wrap engines in a schedule/lease decorator instead of adding a parallel dispatcher |
| `packages/shared/schemas/src/lib/generation/` (`asset_recipe`, `generated_asset`, `generation_provenance`, `generation_request_audit`) | add brief/job/run-lock/budget modules as siblings in this existing folder |
| `packages/frontend/storage/src/lib/generation_records.ts` + `migrations.ts` v7 | reference the candidate/acceptance record **shape** only — client plane, never a runner runtime dependency |
| `apps/backend/image/scripts/generate_asset.test.ts` (`Bun.serve` fake engine + `$` CLI spawn) | reuse the harness pattern for the lease, crash and resume ACs |
| `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx` | extend with the batch commands and default roots |

## Overview

A script, LLM or UI can plan, run, inspect, cancel and resume a bounded asset batch without losing accepted work or accidentally submitting it twice. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Implement the asset-brief schema at `docs/plans/emberwatch_asset_brief.schema.json` in TypeBox; it is a production brief, not a ContentPackManifest. The authored instance is `docs/plans/emberwatch_asset_brief.json`. Validate all input strictly before side effects. Reuse shared recipe compilation, descriptors, and the C-518 candidate/acceptance **record shape** (its tables are the client-plane authority — the runner must not import that package; see State & Data Models).
- Add one declared entry point — `bun run --cwd apps/backend/image generate:batch` — with `--manifest <path>`, `--phase slice|expansion`, exactly one mode flag (`--plan | --run | --resume <runId> | --status <runId> | --cancel <runId>`), and a `--runs-dir` override for the run-record root. Declare the script in `apps/backend/image/package.json` and document the commands, flags and default roots in `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx`. `--plan` is default and produces a machine-readable job plan only: no engine call, no model download, no spend, no staging write. Old `generate:asset` remains a compatible one-job path.
- Resolve provider preference groups, model revisions, recipe/workflow/processor versions and reference artifacts to a separate immutable run lock. Missing references/rights/hardware return structured blockers. Do not fabricate hashes or silently choose a different provider.
- Persist jobs and native provider handles before returning submission success. Use one host-owned resource scheduler in the runner host with a lease per physical GPU/resource group, not per engine object. Default GPU concurrency is one; bounded CPU finishing may run separately. Because every `--run` invocation is a separate process, the lease and the claim winner must be decided in the shared persistent store (an exclusive lock or a transactional claim in the job store) — an in-process mutex alone cannot satisfy AC-2. The lease is released only on confirmed provider completion or explicit reconciliation. Reuse the existing local data authority where one store is genuinely reachable from both hosts; otherwise keep the job/run-lock store behind a host-owned adapter that consumes the portable schemas, and keep fs/db implementations out of `@aikami/local-ai`. Do **not** import `@aikami/frontend-storage` into the Bun runner — it is the browser/Tauri plane (`@tauri-apps/plugin-fs`, `@sqlite.org/sqlite-wasm`).
- States: planned → queued → running → preparing → awaiting_review → succeeded; plus failed, interrupted, cancelled and reconciliation_required. Cancellation request and confirmed provider cancellation are distinct. A completed unaccepted candidate is not a succeeded accepted asset.
- Use client request keys for API idempotency and a canonical effective-spec hash for duplicate detection. Explicit new variation increments attempt/seed; it is not deduplicated accidentally. Two concurrent attempts to claim the same job have one winner.
- If a submit times out before a native handle is recorded, mark reconciliation_required; never automatically repeat a possibly paid/active generation. On restart reconcile native handles, verify existing bytes, then resume unfinished preparation. Retry transient polling safely with bounded exponential backoff; generation retries consume explicit candidate budgets.
- Write each candidate in its own directory/content-addressed blob store. Stage manifest/hash fragments under an exclusive lock/transaction and atomic replacement. Repeated prompts never overwrite raw originals or accepted revisions.
- LLM access is structured JSON CLI input/output first. No arbitrary command evaluation, provider URLs, workflow code or filesystem paths from prompt text. MCP may wrap these same calls later; do not build a second scheduler.
- Legacy compatibility is retained behavior, not a migration: never move, rewrite or sweep an existing staging directory (`apps/backend/image/src/output/**` or any `--out` dir) or its `manifest.json`/`hashes.json`/`generated_asset.json`/`generation_audit.json`. Namespaced staging is additive, pre-existing staging is imported only through an explicit validated opt-in, and record deletion never deletes staged or accepted bytes.

## State & Data Models

AssetBrief v1 → resolved RunLock → GenerationJob → C-518 Candidate/Acceptance. Identity separates run, batch, job, candidate, artifact hash and logical asset tag: `runId`, `jobId`, `candidateId`, client `requestKey`, canonical `effectiveSpecHash`, `attempt`, `seed`, and the nullable native provider handle. A budget includes candidate count, provider spend ceiling, total duration/pixels and retained bytes.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Concretely: add the brief/job/run-lock/budget schemas as modules under the existing `packages/shared/schemas/src/lib/generation/`, re-export them from `packages/shared/schemas/src/index.ts`, and derive every type via `Static` in `packages/shared/types`. Portable core (plan derivation, effective-spec hashing, blocker classification, state transitions) has no Bun/fs/Svelte imports and lives in `packages/shared/local-ai/src/lib/`; host-only concerns (store adapter, scheduler, clock, process identity) live in the runner host. C-518's `generation_candidates`/`generation_acceptances`/`generation_artifacts` shape is the reference for candidate/acceptance records — reuse that shape, do not fork a second candidate authority.

Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** no UI ships in this contract (client/Hub front doors are C-522); the requirement here is machine-usable output — stable JSON, documented exit codes with a blocked-plan code distinct from an internal error, and no interactive prompt on `--plan`/`--run`/`--status`.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Add versioned job/run-lock records with a documented upgrade path and namespaced staging. Import pre-existing staging only through an explicit validated opt-in; never sweep, move or rewrite an existing output directory. The runner can be disabled while old accepted assets remain usable and `generate:asset` keeps working. Deleting a record never deletes staged or accepted bytes.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Add versioned job/run-lock records (an explicit version field with a documented upgrade path for a record written by an older runner) and namespaced staging. Old staging is imported only through an explicit validated opt-in; existing output directories are never swept, moved or rewritten, and a record whose version the runner cannot read is reported, never deleted. The runner can be disabled or simply not started while old accepted assets stay usable and `generate:asset` keeps producing its documented outputs. Deleting a run record never deletes staged or accepted bytes — artifact cleanup is reference-aware. Rollback is "stop using the batch entry point": nothing on the game boot/play/save path depends on the runner.

## Scope Boundaries

One durable local orchestration authority, CLI batch entry and reusable job protocol. Excludes Hub pairing, hosted providers, media-specific finishing and game map edits.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Plan is strict, side-effect-free and honest about blockers

**Given** the authored Emberwatch brief at `docs/plans/emberwatch_asset_brief.json` (valid against `docs/plans/emberwatch_asset_brief.schema.json` as shipped), **when** run `generate:batch --manifest docs/plans/emberwatch_asset_brief.json --plan` for each phase, **then** strict schema validation succeeds, stdout JSON reports `sliceItems` equal to the brief's `summary.sliceItems` (6) for `--phase slice` and `expansionItems` (36) for `--phase expansion`, every `resolution: "required"` reference that cannot be resolved to verified bytes is listed in `blockers[]` (e.g. `approved_style`, whose locator is a Markdown section — never turned into an invented hash), the process exits with the documented non-zero blocked-plan code (distinct from an internal error), and a recording engine plus a staging-directory diff prove zero engine/model/download/staging activity.

### AC-2: One resource owner across processes

**Given** two concurrent `generate:batch --run` processes plus one in-process submitter using the same validated job specification (the shape a client/Hub front door will submit later — C-522), all pointed at one fake engine on a single resource group, **when** they submit concurrently, **then** exactly one generation executes at a time (the fake engine records no overlapping request), the losing claim returns a structured already-claimed result instead of dispatching a second generation, every staging fragment entry survives a merge interrupted mid-write, and two submissions carrying the same client request key resolve to one job.

### AC-3: Recover without regeneration

**Given** a job completed raw generation before runner crash, **when** restart and resume, **then** verified raw bytes are reused and only remaining processing runs; accepted bytes are never regenerated.

### AC-4: Uncertain submit and cancel

**Given** a submission that times out after the request left the process with no native handle recorded, or an engine that reports `capabilities.cancel === false` (ACE-Step v1 ships that way), **when** retry, `--status` and `--cancel` are invoked, **then** the job is marked `reconciliation_required` and no new attempt is dispatched until reconciliation resolves the native handle, a cancellation *request* is reported distinctly from confirmed provider cancellation, and the JSON output never claims compute stopped when only polling stopped.

### AC-5: Bounded batch

**Given** `candidateLimitPerItem: 2`, `hostedBudgetUsd: 0` and the plan-level duration/pixel/retained-bytes ceilings, **when** request a third variation, a hosted provider, or an item that would exceed a declared budget, **then** the request fails before dispatch with the violated budget named in the result, and one failing item leaves every other item's outputs and records untouched.

### AC-6: Local path works offline

**Given** a fixture brief whose references all resolve to already-installed local bytes (the authored Emberwatch brief's `approved_style` stays blocked, which is AC-1's case), **when** run and resume that fixture batch with external networking blocked, **then** generation, preparation and local persistence require no Hub account or sign-in, and the output can feed C-510 staging and C-518 candidate records.

### AC-7: Duplicate detection does not eat intentional variation

**Given** a job whose effective spec already completed, **when** resubmit the identical effective spec, then resubmit with an explicit new variation, **then** the identical spec resolves to the existing job with no second engine call, while the explicit variation creates a new attempt/seed, consumes candidate budget and is recorded as a distinct job — never silently deduplicated.

### AC-8: Legacy staging and the one-job CLI survive

**Given** a staging directory holding pre-existing generated output and fragments, **when** the new batch front door and the old `generate:asset` path both run, **then** the pre-existing bytes, `manifest.json`, `hashes.json`, `generated_asset.json` and `generation_audit.json` are neither moved, rewritten nor swept, `generate:asset` still emits its documented outputs, and pre-existing staging is imported only through the explicit validated opt-in.

### AC-9: Shipped commands are the documented commands

**Given** the shipped script entry point and its default run-record/staging roots, **when** read `apps/frontend/docs/src/content/docs/guides/generating-assets.mdx`, **then** every documented batch command, flag and default path matches `apps/backend/image/package.json` and the implemented CLI with no invented flag and no stale command, and `docs:build` stays green.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | CLI integration | Recorded plan JSON for both phases + engine/download spy log + staging-directory diff | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-2 | multiprocess integration | Fake-engine concurrency log for both processes and the in-process submitter, plus final `manifest.json`/`hashes.json` after an injected mid-merge kill | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-3 | crash injection integration | Pre-crash run record + post-resume record and byte hashes proving raw reuse and no accepted-bytes regeneration | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-4 | adapter + runner integration | Timeout / `cancel: false` fixture transcript + job state transitions + reconciliation log | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-5 | CLI integration | Budget-refusal JSON naming the violated budget + untouched sibling outputs | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-6 | production CLI smoke | Blocked-network fixture batch log (run + resume) and the C-510 staging consumption step | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-7 | runner integration | Spec-hash dedup assertion (engine call count) + job/candidate counts for the explicit variation | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-8 | CLI regression | Pre/post staging tree listing with hashes + `generate:asset` output from the old path | tooling: `bun run --cwd apps/backend/image generate:asset` (regression) + `generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-9 | docs + CLI contract | Diff of every documented command/flag/default against `apps/backend/image/package.json`, plus `docs:build` output | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted (Moon project ids are flat — verify each against its `moon.yml` before running): `local-ai:test`, `schemas:test`, `types:build`, `image:test` (`apps/backend/image/scripts/generate_asset.test.ts`), `frontend-storage:test` (C-518 records must not regress), `local-stack:*` for anything host-side, `docs:build`. Do not invent passing task output.
- Harness precedent: `apps/backend/image/scripts/generate_asset.test.ts` already spins a `Bun.serve` fake engine and spawns the CLI through `$`. Reuse that pattern for the AC-2 lease/merge-crash assertions and the AC-3 resume assertion (recorded request log + injected mid-run kill + `--runs-dir` in a temp dir). AC-6's blocked network is asserted from the recorded engine log and a fixture-only plan rather than a live provider.
- Functional E2E: this contract's production surface is the tooling CLI, so the Playwright lane applies only if a client or Hub surface is touched — those ACs belong to C-522. Use compiled Svelte tests for reactivity/lifecycle if one is.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Implement strict brief validation and dry plan with exact count/cost/blocker output (AC-1, AC-9 docs started).
2. Add persistent job state, cross-process leases, spec-hash duplicate detection and scoped artifact handles (AC-2, AC-7).
3. Route CLI generation through shared runner semantics and atomic staging (AC-5).
4. Add resume/cancel/reconcile and exercise process/crash boundaries (AC-3, AC-4).
5. Keep the legacy staging directory and `generate:asset` path untouched, then finish the guide against the shipped commands (AC-6, AC-8, AC-9).

## Edge Cases & Gotchas

An AbortSignal may stop waiting without stopping GPU execution. Keep the resource lease until actual provider completion or explicit reconciliation.

## Open Questions

No conceptual choice is required to begin the scoped implementation. Hardware, credentials, model/license eligibility and actual measured performance are execution preflight facts. Use the declared unavailable/fallback behavior rather than inventing access or silently expanding scope. Record any new material design question before changing the contract.

## Amendments

This is a newly proposed draft; existing contract approval/amendment rules still apply. Do not self-assign user approval or upgrade status based on this document's presence.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-13 | Initial proposed scope | Pending contract adoption |
| 1.1.0 | 2026-09-13 | Critic pass: named the concrete schema/core/runner-host homes and the client-plane packages that must not be imported by the Bun runner; made cross-process lease backing explicit; fixed CLI flag/command names; scoped AC-2's submitter so it does not depend on C-522's front doors; added AC-7 (dedup vs. intentional variation), AC-8 (legacy staging + `generate:asset` regression) and AC-9 (docs match shipped commands); replaced placeholder Evidence Matrix artifacts with per-AC observables; removed the vacuously-satisfied UI accessibility clause. No scope change. | Pending |

## Promotion Lifecycle

See docs/contracts/SHARED_SECTIONS.md. An implemented code path without required production, visual or audio evidence is not release_verified.

## Status Lifecycle

See docs/contracts/SHARED_SECTIONS.md. Preserve accurate draft/implemented/verified/completed distinctions.
