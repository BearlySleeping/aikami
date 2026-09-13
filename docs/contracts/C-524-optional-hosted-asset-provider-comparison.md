---
id: C-524
title: "Optional hosted asset provider comparison"
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

# Contract C-524: Optional hosted asset provider comparison

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../research/asset-generation-review-2026-09.md) |
| **Target** | provider host adapters; server-side credential storage; Studio provider selection |
| **Type** | full |
| **Priority** | P2 — optional provider comparison |
| **Dependencies** | C-518, C-519; C-520/C-521 preparation; C-522 if exposed through Hub |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.0.0 |
| **Production Surface** | tooling `generate:batch` explicit hosted provider; Hub `/studio/assets` when configured |

Allocated as C-524 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-523; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

Creators without local GPU capacity need an optional generation route, and model selection needs real comparisons. The current portable engines have no reviewed hosted PixelLab/ElevenLabs path or paid-job budget enforcement.

Inspect the source in the reuse map at current HEAD before implementation. Baseline is source-reviewed, not freshly test-executed. Run the related existing project tests before editing; do not copy old contract execution reports as current evidence.

## User Outcome

A creator can explicitly compare a hosted sprite/SFX/music candidate with local output at a bounded cost while preserving the same validation and offline delivery path.

## Success Measures

- Every mandatory AC below has execution evidence on its named production/tooling path.
- Generation stays asynchronous; no model/GPU/network/sign-in dependency is added to game boot, play or saves.
- Generation latency is measured on named hardware, not inferred from vendor marketing. Cache/accepted outputs are reused without regeneration.

## Existing System & Reuse Map

| Existing source | Action |
|---|---|
| `packages/shared/local-ai/` | shared schemas/recipe/candidate protocol |
| `apps/frontend/hub/src/lib/server/` | server-side adapter and secret conventions |
| `C-519 runner` | idempotency, budget, job handles |
| `C-518 provenance` | provider request ID and output-rights projection |

## Overview

A creator can explicitly compare a hosted sprite/SFX/music candidate with local output at a bounded cost while preserving the same validation and offline delivery path. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Add official PixelLab image/rotation/animation and ElevenLabs SFX/music adapters as separately feature-flagged capabilities. Use current official API schemas, explicit model IDs and recorded request IDs; no unofficial consumer-site automation.
- First deliver one image/animation challenger and one SFX challenger. Music is optional if the configured paid account supports the documented explicit model and game-use rights. Do not assume all website-only features are API features.
- Execute hosted requests in a trusted server or local runner with user-configured secrets. Never expose provider secrets to browser builds or log them. Private references are transmitted only in the explicitly selected hosted job.
- Default spend ceiling is zero. Show a preflight quote with currency/credits, candidate count, maximum durations and assumptions. Reserve estimated maximum cost atomically before dispatch; settle actual cost and retain uncertainty on timeout. No automatic paid fallback or silent resubmission.
- Validate terms for inference, game inclusion and downloadable asset/community reuse independently. PixelLab API availability alone is not a verified license. Eleven Music plan/model terms are recorded; game permission does not automatically permit a sound library resale.
- Feed raw results into the same C-520/C-521 processors and reviewers. Hosted output quality does not bypass alpha, frame, loop or collision gates. Do not label lossy audio as a lossless original after converting it to WAV.
- Record provider account scope, terms revision/date, model/API version and response metadata without storing credentials. If provider cannot expose seeds or deterministic model revisions, mark those limits. Accepted output bytes remain usable offline after credentials expire.

## State & Data Models

HostedProviderProfile and CostReservation extend C-519 resolution; credential references are opaque server-side handles. No secrets in AssetBrief/run locks/public provenance.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Add provider IDs/capability records compatibly; no default provider changes. Disable each adapter independently and preserve accepted cached outputs. Unsettled cost reservations remain auditable through rollback.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Add provider IDs/capability records compatibly; no default provider changes. Disable each adapter independently and preserve accepted cached outputs. Unsettled cost reservations remain auditable through rollback.

## Scope Boundaries

Optional official hosted comparison adapters and cost enforcement. No provider subscription purchase, credentials creation, automatic spending or cloud dependency for gameplay.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Explicit paid choice

**Given** hosted adapter configured and default budget zero, **when** attempt generation, then supply a bounded permitted ceiling, **then** zero-budget request makes no paid call; approved configured budget admits only the quoted bounded request.

### AC-2: Official API mapping

**Given** recorded current provider schema fixtures, **when** generate a PixelLab candidate and ElevenLabs SFX candidate, **then** real documented endpoints/models are used, handles/bytes/provenance preserved, and unsupported capabilities fail early.

### AC-3: No duplicate charge

**Given** timed-out submission or duplicate request key, **when** retry/reconnect, **then** no automatic second billable submission without reconciliation or explicit new attempt.

### AC-4: Private credentials and rights

**Given** browser bundle, cross-owner job and game-only rights fixture, **when** inspect bundle/requests and request community export, **then** secrets stay server-side, cross-owner access fails, and unsupported redistribution is blocked.

### AC-5: Same acceptance/offline path

**Given** accepted hosted result, **when** process, install and disconnect, **then** same QA gates apply and installed bytes play/render without provider availability.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | budget integration | Test/log/media report for this scenario | tooling `generate:batch` explicit hosted provider; Hub `/studio/assets` when configured | Unverified — populate during execution |
| AC-2 | adapter CI + paid smoke if configured | Test/log/media report for this scenario | tooling `generate:batch` explicit hosted provider; Hub `/studio/assets` when configured | Unverified — populate during execution |
| AC-3 | failure injection | Test/log/media report for this scenario | tooling `generate:batch` explicit hosted provider; Hub `/studio/assets` when configured | Unverified — populate during execution |
| AC-4 | security + rights integration | Test/log/media report for this scenario | tooling `generate:batch` explicit hosted provider; Hub `/studio/assets` when configured | Unverified — populate during execution |
| AC-5 | production smoke | Test/log/media report for this scenario | tooling `generate:batch` explicit hosted provider; Hub `/studio/assets` when configured | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under local-ai, schemas, frontend storage, client, Hub and scripts as applicable. Determine exact Moon project task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Verify current API/terms for the configured account and pin adapter fixtures.
2. Implement budget reservation plus server-side adapters.
3. Expose explicit provider selection and transfer disclosure.
4. Run bounded comparison only with configured credentials/budget; otherwise leave live evidence unverified.

## Edge Cases & Gotchas

A successful network request with an unreviewed output is a generated candidate, not a publishable game asset.

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
