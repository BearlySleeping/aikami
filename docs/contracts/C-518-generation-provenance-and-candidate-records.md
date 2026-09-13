---
id: C-518
title: "Generation provenance and candidate records"
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

# Contract C-518: Generation provenance and candidate records

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../research/asset-generation-review-2026-09.md) |
| **Target** | shared schemas/types; frontend storage; asset registration; catalog preflight |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-510; C-517 for corrected metadata |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.0.0 |
| **Production Surface** | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated |

Allocated as C-518 during the 2026-09-13 import. The 2026-09-13 review pack proposed it as C-517; the asset-generation series shifted up by one because C-516 is the combat direct-control contract. Baseline: see `docs/research/asset-generation-review-2026-09.md`.
## Problem & Baseline Evidence

GeneratedAsset has model/prompt/seed, but generated_asset_registration passes only provenance.source into the current generated-row write seam. There is no durable full provenance or candidate acceptance record. Model-weight licensing is conflated with generated-output licensing in existing contract prose.

Inspect the source in the reuse map at current HEAD before implementation. Baseline is source-reviewed, not freshly test-executed. Run the related existing project tests before editing; do not copy old contract execution reports as current evidence.

## User Outcome

A creator can reload an accepted asset and still inspect its exact generation inputs, transformations and intended-use rights decision.

## Success Measures

- Every mandatory AC below has execution evidence on its named production/tooling path.
- Generation stays asynchronous; no model/GPU/network/sign-in dependency is added to game boot, play or saves.
- Generation latency is measured on named hardware, not inferred from vendor marketing. Cache/accepted outputs are reused without regeneration.

## Existing System & Reuse Map

| Existing source | Action |
|---|---|
| `packages/shared/schemas/src/lib/generation/generated_asset.ts` | extend compatibly |
| `packages/shared/schemas/src/lib/game/asset_provenance.ts` | preserve existing AssetRef compatibility |
| `apps/frontend/client/src/lib/services/assets/generated_asset_registration.ts` | persist complete private record |
| `packages/frontend/storage/src/lib/assets_generated.ts` | add transactional authoring records |
| `scripts/src/lib/catalog/preflight.ts` | reuse rights/attribution entry point |

## Overview

A creator can reload an accepted asset and still inspect its exact generation inputs, transformations and intended-use rights decision. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Create versioned TypeBox schemas and derived types for GenerationProvenance, CandidateRecord, AcceptanceRecord and a public provenance projection. Keep this authoring metadata out of game save payloads and out of flat engine-result metadata.
- Record base model/LoRA IDs, immutable revisions and verified artifact hashes when local; engine/server/workflow versions; recipe and processor hashes; seed; requested/effective controls; reference hashes; raw and prepared hashes; actual measured media properties. Hosted providers may only expose a model version and request ID: record that limitation, never fabricate weight hashes.
- Store private prompts/reference pointers locally by default. Public projection deliberately excludes private prompts, local paths, credentials and unreleased story material. Preserve required attribution and transformation lineage.
- Distinguish inference/deployment permission, output use, in-game redistribution and standalone/community redistribution. Model license is evidence, not the automatically assigned output license. Use structured allowed/denied/unknown decisions with source URL/version/date and intended-use scope. Unknown publication rights block publication, not unrelated offline gameplay. Unknown permission to run a gated model blocks that provider until resolved.
- An acceptance record names an exact prepared hash and validation-report hash. Changed bytes invalidate acceptance. Candidate IDs are immutable; tag display labels are not identity. Accepting two candidates for one logical asset requires an explicit revision decision.
- Preserve authoritative user work through quota pressure. Delete only unreferenced bytes owned by the failed operation; never remove a deduplicated blob used by another tag/pack/job. Give the creator export and explicit delete, with reference checks.
- Do not embed arbitrary free-form license strings into the existing restricted SPDX field. Add an external terms/rights record or a compatible schema field with clear purpose.

## State & Data Models

GenerationProvenance v1 links job/candidate IDs, production input lock, raw/prepared artifact hashes, transformation chain, private references and scoped RightsDecision records. Candidate status is separate from job status: pending_review / accepted / rejected / superseded. Legacy records use unknown provenance, not invented backfills.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Additive local schema migration using existing Turso migration conventions. Preserve old attribution and hashes, mark incomplete provenance unknown. Rollback readers ignore added tables; preserve author data and leave the migration inert. A failed migration must leave old asset resolution usable.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Additive local schema migration using existing Turso migration conventions. Preserve old attribution and hashes, mark incomplete provenance unknown. Rollback readers ignore added tables; preserve author data and leave the migration inert. A failed migration must leave old asset resolution usable.

## Scope Boundaries

Durable lineage/acceptance and rights semantics only. No GPU transport, scheduler, new publishing endpoint or automatic legal determination.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Durable lineage

**Given** an image and an audio descriptor with references and model details, **when** register, close the client and reload, **then** full private lineage and acceptance status survive with the same bytes/hash; the public projection omits private fields.

### AC-2: Rights scopes differ

**Given** fixtures with permissive code but restricted model inference, and game-only output rights, **when** request local generation, game export and community export respectively, **then** each intended use is evaluated independently; no rule automatically copies the model license onto outputs.

### AC-3: Acceptance cannot drift

**Given** a reviewed prepared hash, **when** replace the underlying prepared bytes or change a processor profile, **then** previous acceptance no longer authorizes the new candidate; accepted old content stays resolvable.

### AC-4: Crash and dedup safety

**Given** two tags reference the same cached bytes, **when** force a transaction/quota failure and then delete one candidate, **then** no dangling accepted row and no deletion of bytes referenced by the other tag; retry is idempotent.

### AC-5: Legacy compatibility

**Given** pre-contract generated rows and existing content packs, **when** migrate/reload/export local history, **then** old assets still render; unknown rights/history are explicit; publication preflight requests missing evidence.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | storage integration + production registration smoke | Test/log/media report for this scenario | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated | Unverified — populate during execution |
| AC-2 | unit + catalog preflight integration | Test/log/media report for this scenario | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated | Unverified — populate during execution |
| AC-3 | integration | Test/log/media report for this scenario | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated | Unverified — populate during execution |
| AC-4 | failure-injection integration | Test/log/media report for this scenario | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated | Unverified — populate during execution |
| AC-5 | migration fixture + client smoke | Test/log/media report for this scenario | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under local-ai, schemas, frontend storage, client, Hub and scripts as applicable. Determine exact Moon project task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Inspect actual storage migrations and registration transaction boundaries.
2. Add schemas, private record persistence and public projection.
3. Wire registration, candidate decisions, rights preflight and reference-aware cleanup.
4. Verify round-trip, legacy migration and crash/dedup scenarios.

## Edge Cases & Gotchas

Accepted for local experimentation is not the same decision as approved for community publication.

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
