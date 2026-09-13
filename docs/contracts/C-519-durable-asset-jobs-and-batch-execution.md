---
id: C-519
title: "Durable asset jobs and batch execution"
source: "direct — 2026-09-13 asset generation and Emberwatch review"
contract_type: full
status: draft
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
| **Target** | shared local-ai; local runner host; image CLI; local authoring storage |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-517, C-518 |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.0.0 |
| **Production Surface** | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) |

Allocated as C-519 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-518; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

The existing runner produces one asset and engine adapters serialize per instance. Multiple CLI processes or browser tabs can compete for one GPU, repeated prompt slugs can collide in staging, and there is no locked batch plan or recoverable job record.

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

## Overview

A script, LLM or UI can plan, run, inspect, cancel and resume a bounded asset batch without losing accepted work or accidentally submitting it twice. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Implement the asset-brief schema at `docs/plans/emberwatch_asset_brief.schema.json` in TypeBox; it is a production brief, not a ContentPackManifest. The authored instance is `docs/plans/emberwatch_asset_brief.json`. Validate all input strictly before side effects. Reuse shared recipe compilation, descriptors and C-518 candidate persistence.
- Add `generate:batch --manifest <path> --phase slice|expansion --plan|--run|--resume <runId>` plus status/cancel commands; declare actual script/task names and document them. `--plan` is default, generates a machine-readable job plan and never downloads models or spends money. Old generate:asset remains a compatible one-job path.
- Resolve provider preference groups, model revisions, recipe/workflow/processor versions and reference artifacts to a separate immutable run lock. Missing references/rights/hardware return structured blockers. Do not fabricate hashes or silently choose a different provider.
- Persist jobs and native provider handles before returning submission success. Use one host-owned resource scheduler with a lease per physical GPU/resource group, not per engine object. Default GPU concurrency is one; bounded CPU finishing may run separately. Reuse one local data authority where possible; keep fs/db implementations out of the portable core.
- States: planned → queued → running → preparing → awaiting_review → succeeded; plus failed, interrupted, cancelled and reconciliation_required. Cancellation request and confirmed provider cancellation are distinct. A completed unaccepted candidate is not a succeeded accepted asset.
- Use client request keys for API idempotency and a canonical effective-spec hash for duplicate detection. Explicit new variation increments attempt/seed; it is not deduplicated accidentally. Two concurrent attempts to claim the same job have one winner.
- If a submit times out before a native handle is recorded, mark reconciliation_required; never automatically repeat a possibly paid/active generation. On restart reconcile native handles, verify existing bytes, then resume unfinished preparation. Retry transient polling safely with bounded exponential backoff; generation retries consume explicit candidate budgets.
- Write each candidate in its own directory/content-addressed blob store. Stage manifest/hash fragments under an exclusive lock/transaction and atomic replacement. Repeated prompts never overwrite raw originals or accepted revisions.
- LLM access is structured JSON CLI input/output first. No arbitrary command evaluation, provider URLs, workflow code or filesystem paths from prompt text. MCP may wrap these same calls later; do not build a second scheduler.

## State & Data Models

AssetBrief v1 → resolved RunLock → GenerationJob → C-518 Candidate/Acceptance. Identity separates batch, job, candidate, artifact hash and logical asset tag. A budget includes candidate count, provider spend ceiling, total duration/pixels and retained bytes.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Add versioned job/run-lock records and namespaced staging. Import old staging only through explicit validation; never sweep existing output directories. Runner can be disabled while old accepted assets remain usable; old generate:asset invocation remains supported.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Add versioned job/run-lock records and namespaced staging. Import old staging only through explicit validation; never sweep existing output directories. Runner can be disabled while old accepted assets remain usable; old generate:asset invocation remains supported.

## Scope Boundaries

One durable local orchestration authority, CLI batch entry and reusable job protocol. Excludes Hub pairing, hosted providers, media-specific finishing and game map edits.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Plan without side effects

**Given** the Emberwatch brief at `docs/plans/emberwatch_asset_brief.json` and its unresolved references, **when** run generate:batch in default mode, **then** strict validation succeeds, phases/counts and blockers are printed as JSON, and zero engine/model/download calls occur.

### AC-2: One resource owner

**Given** two CLI processes and one simulated client target the same GPU, **when** submit concurrently, **then** one resource lease executes at a time; no lost staging entries; duplicate request keys resolve to one job.

### AC-3: Recover without regeneration

**Given** a job completed raw generation before runner crash, **when** restart and resume, **then** verified raw bytes are reused and only remaining processing runs; accepted bytes are never regenerated.

### AC-4: Uncertain submit and cancel

**Given** provider submission times out or cancellation is unsupported, **when** retry/status/cancel, **then** uncertain submission is reconciled before any new attempt; UI/JSON does not claim compute stopped when only polling stopped.

### AC-5: Bounded batch

**Given** candidate limit two and hosted budget zero, **when** request extra variations or a hosted provider, **then** request fails before dispatch with actionable reason; one item failure does not delete unrelated outputs.

### AC-6: Local path works offline

**Given** models and references are already installed, **when** run and resume a fixture batch with external networking blocked, **then** generation/preparation/local persistence require no Hub account; output can feed C-510 staging.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | CLI integration | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-2 | multiprocess integration | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-3 | crash injection integration | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-4 | adapter + runner integration | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-5 | CLI integration | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |
| AC-6 | production CLI smoke | Test/log/media report for this scenario | tooling: `bun run --cwd apps/backend/image generate:batch` (declare this new script in this contract) | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under local-ai, schemas, frontend storage, client, Hub and scripts as applicable. Determine exact Moon project task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Implement strict brief validation and dry plan with exact count/cost output.
2. Add persistent job state, leases and scoped artifact handles.
3. Route CLI generation through shared runner semantics and atomic staging.
4. Add resume/cancel and exercise process/crash boundaries.

## Edge Cases & Gotchas

An AbortSignal may stop waiting without stopping GPU execution. Keep the resource lease until actual provider completion or explicit reconciliation.

## Open Questions

No conceptual choice is required to begin the scoped implementation. Hardware, credentials, model/license eligibility and actual measured performance are execution preflight facts. Use the declared unavailable/fallback behavior rather than inventing access or silently expanding scope. Record any new material design question before changing the contract.

## Amendments

This is a newly proposed draft; existing contract approval/amendment rules still apply. Do not self-assign user approval or upgrade status based on this document's presence.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-13 | Initial proposed scope | Pending contract adoption |

## Promotion Lifecycle

See docs/contracts/SHARED_SECTIONS.md. An implemented code path without required production, visual or audio evidence is not release_verified.

## Status Lifecycle

See docs/contracts/SHARED_SECTIONS.md. Preserve accurate draft/implemented/verified/completed distinctions.
