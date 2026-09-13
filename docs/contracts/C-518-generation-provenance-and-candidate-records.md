---
id: C-518
title: "Generation provenance and candidate records"
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

# Contract C-518: Generation provenance and candidate records

## Metadata

| Field | Value |
|---|---|
| **Source** | User request; [Asset generation review](../research/asset-generation-review-2026-09.md) |
| **Target** | shared schemas/types; frontend storage; asset registration; catalog preflight |
| **Type** | full |
| **Priority** | P1 — production asset pipeline |
| **Dependencies** | C-510 (`implemented`); C-517 (`implemented`) for corrected metadata. C-513 (`implemented`) is an **interface constraint, not a blocker** — its shipped gate already consumes the seam this contract owns (see the reuse map) |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | User-facing generation/creating-assets guides; affected Hub help |
| **Contract version** | 1.0.1 |
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
| `packages/shared/schemas/src/lib/community/asset_publishing.ts` | **extend in place — this module already owns the C-518 seam.** It declares `RightsScopeDecisionSchema`, `RightsDecisionSchema`, `RIGHTS_SCOPES` and the public `CommunityAssetProvenanceProjectionSchema`, and its header states C-518 "adds the real schema to the shared package when it lands". Landing a parallel module is a defect |
| `packages/shared/schemas/src/lib/community/asset_publish_gate.ts` | **preserve the shipped contract** — `evaluateCommunityPublishGate` (C-513, `implemented`) reads `rights[scope]?.permitted !== true` fail-closed over `inference`, `gameInclusion`, `standaloneDistribution` |
| `packages/shared/schemas/src/lib/catalog/attribution_preflight.ts` | extend `runAttributionPreflight` so publication preflight asks for missing rights evidence (AC-5) |
| `apps/frontend/client/src/lib/services/assets/generated_asset_registration.ts` | persist complete private record |
| `packages/frontend/storage/src/lib/assets_generated.ts` | add transactional authoring records |
| `packages/frontend/storage/src/lib/migrations.ts` | append the additive migration (C-384 append-only list keyed on `PRAGMA user_version`); `assets_generated.ts` already ships `findSaveReferences` / `findIdsByHashes` for AC-4's reference-aware cleanup |
| `scripts/src/lib/catalog/preflight.ts` | reuse rights/attribution entry point (a thin re-export of the `@aikami/schemas` implementation — change the shared module, not this shim) |

**Interface constraint from the shipped C-513 gate.** `RightsDecision` is C-518-owned but already consumed: the hub reserve handler (`apps/frontend/hub/src/lib/server/api/asset_community.ts`) resolves it server-side and `evaluateCommunityPublishGate` treats a missing or non-`true` scope as a refusal. C-518 must extend that record additively and leave `permitted: boolean` readable; a rename or a tri-state replacing the boolean silently converts today's explicit refusals into untyped breakage. C-513's own contract records this as Open Question Q4.

## Overview

A creator can reload an accepted asset and still inspect its exact generation inputs, transformations and intended-use rights decision. This contract extends the existing C-510/C-511 architecture with the bounded behavior below. Keep storage, transport and view concerns in their established layers.

## Design Reference

Read AGENTS.md, .context/CONTEXT.md and .context/index.md; then the applicable .pi/skills conventions, existing contract dependencies, docs/contracts/SHARED_SECTIONS.md, and the execution directives in `docs/research/asset-generation-review-2026-09.md`. The supplied review identifies current-source contradictions; current code and verified production behavior take precedence over historical claims.

## Architecture Directives

- Create versioned TypeBox schemas and derived types for GenerationProvenance, CandidateRecord and AcceptanceRecord, and **extend the existing** `CommunityAssetProvenanceProjectionSchema` for the public projection — one projection shape, not a second one. Keep this authoring metadata out of game save payloads and out of flat engine-result metadata.
- Record base model/LoRA IDs, immutable revisions and verified artifact hashes when local; engine/server/workflow versions; recipe and processor hashes; seed; requested/effective controls; reference hashes; raw and prepared hashes; actual measured media properties. Hosted providers may only expose a model version and request ID: record that limitation, never fabricate weight hashes.
- Store private prompts/reference pointers locally by default. Public projection deliberately excludes private prompts, local paths, credentials and unreleased story material. Preserve required attribution and transformation lineage.
- Distinguish inference/deployment permission, output use, in-game redistribution and standalone/community redistribution. Model license is evidence, not the automatically assigned output license. Use structured allowed/denied/unknown decisions with source URL/version/date and intended-use scope. Unknown publication rights block publication, not unrelated offline gameplay. Unknown permission to run a gated model blocks that provider until resolved. **Reconcile with the shipped seam:** the gated scope keys stay exactly `inference`, `gameInclusion` and `standaloneDistribution`, and each keeps a boolean `permitted` that `evaluateCommunityPublishGate` reads fail-closed. Carry allowed/denied/unknown as an added state field *alongside* `permitted` (`permitted: true` only for allowed) — never by replacing the boolean or renaming a key. The output-use distinction rides as source URL/version/date evidence inside a scope decision; any additional scope key is additive and must not become required by the gate without a C-513 change.
- An acceptance record names an exact prepared hash and validation-report hash. Changed bytes invalidate acceptance. Candidate IDs are immutable; tag display labels are not identity. Accepting two candidates for one logical asset requires an explicit revision decision.
- Preserve authoritative user work through quota pressure. Delete only unreferenced bytes owned by the failed operation; never remove a deduplicated blob used by another tag/pack/job. Give the creator export and explicit delete, with reference checks.
- Do not embed arbitrary free-form license strings into the existing restricted SPDX field. Add an external terms/rights record or a compatible schema field with clear purpose.

## State & Data Models

GenerationProvenance v1 links job/candidate IDs, production input lock, raw/prepared artifact hashes, transformation chain, private references and scoped RightsDecision records. Candidate status is separate from job status: pending_review / accepted / rejected / superseded. The durable job record itself is **not** C-518's: C-519 owns job persistence and batch execution and depends on this contract, so provenance stores an opaque job id link only. Legacy records use unknown provenance, not invented backfills.

All cross-boundary data has TypeBox schemas under packages/shared/schemas and Static-derived types under packages/shared/types. Portable generation core has no Bun/fs/Svelte imports. Use type aliases, not interfaces. New field names are proposed contracts, not claims that today's strict pack schemas already accept them.

## Quality Requirements

- **Offline/degraded mode:** accepted installed assets stay usable without the runner or Hub; unavailable generation returns a typed reason.
- **Accessibility/input:** labelled keyboard controls and status/error announcements for affected UI; CLI surfaces use stable JSON and meaningful exit codes.
- **Performance budget:** default GPU concurrency one; bounded job/payload/artifact sizes; media preparation off the game render thread. Measure wall time, decoded memory and queue behavior.
- **Security/privacy:** validate boundaries, keep secrets/private prompts out of public projections, permit only owned artifact references and supported operations.
- **Persistence/migration:** Additive local schema migration appended to the C-384 append-only list in `packages/frontend/storage/src/lib/migrations.ts` (keyed on `PRAGMA user_version`; take the next free version — do not renumber or edit a released entry). Preserve old attribution and hashes, mark incomplete provenance unknown. Rollback readers ignore added tables; preserve author data and leave the migration inert. A failed migration must leave old asset resolution usable.
- **Cancellation/retry/idempotency:** distinguish stopped waiting from confirmed native cancellation; do not repeat uncertain generation automatically; byte identity is SHA-256.
- **Observability:** job/candidate/profile/hash IDs, stage timings and failure codes; no raw private prompts, credential material or audio/image payloads in routine logs.

## Migration & Rollback

Additive local schema migration appended to the C-384 append-only list in `packages/frontend/storage/src/lib/migrations.ts` (`PRAGMA user_version`; next free version, no renumbering, no edits to released entries — they are `IF NOT EXISTS` DDL and run once per database). Preserve old attribution and hashes, mark incomplete provenance unknown. Rollback readers ignore added tables; preserve author data and leave the migration inert. A failed migration must leave old asset resolution usable, and the pre-existing `assets` / `asset_sources` / `install_state` rows must keep resolving without the new tables.

## Scope Boundaries

Durable lineage/acceptance and rights semantics only. No GPU transport, scheduler, durable job/batch record (C-519), new publishing endpoint or automatic legal determination. Rights decisions are recorded and evaluated, never adjudicated.

## Contract Size & Split Rule

This contract's single outcome is the User Outcome above. Keep implementation behind one coherent path; avoid parallel legacy/new authorities. If live-code discovery reveals another independently mergeable capability, document a follow-up rather than silently broadening this contract. See SHARED_SECTIONS.md.

## Acceptance Criteria

### AC-1: Durable lineage

**Given** an image and an audio descriptor with references and model details, **when** register, close the client and reload, **then** full private lineage and acceptance status survive with the same bytes/hash; the public projection built from the shared `CommunityAssetProvenanceProjectionSchema` omits private fields (prompts, model ids, local paths, credentials, unreleased story material).

### AC-2: Rights scopes differ

**Given** fixtures with permissive code but restricted model inference, and game-only output rights, **when** request local generation, game export and community export respectively (each mapping to one shipped gate scope: `inference`, `gameInclusion`, `standaloneDistribution`), **then** each intended use is evaluated independently through `evaluateCommunityPublishGate`; no rule automatically copies the model license onto outputs, and a scope whose state is `unknown` refuses rather than inherits.

### AC-3: Acceptance cannot drift

**Given** a reviewed prepared hash, **when** replace the underlying prepared bytes or change a recorded transformation/processor descriptor in the provenance chain (a C-518-owned record — real processor profiles arrive in C-520, which depends on this contract), **then** previous acceptance no longer authorizes the new candidate; accepted old content stays resolvable.

### AC-4: Crash and dedup safety

**Given** two tags reference the same cached bytes, **when** force a transaction/quota failure and then delete one candidate, **then** no dangling accepted row and no deletion of bytes referenced by the other tag; retry is idempotent.

### AC-5: Legacy compatibility

**Given** pre-contract generated rows and existing content packs, **when** migrate/reload/export local history, **then** old assets still render; unknown rights/history are explicit; publication preflight requests missing evidence.

### AC-6: Failed migration leaves old assets usable

**Given** an installed database at the previous `PRAGMA user_version` and pre-contract `assets` / `asset_sources` / `install_state` rows, **when** the new migration is made to fail mid-apply (injected failure), **then** the database does not advance its version, opening the local database rejects or retries without a half-applied schema, previously resolvable assets still resolve after reopening, and no author data is dropped.

**Evidence Matrix**

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | storage integration + production registration smoke | Test/log/media report for this scenario | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated | Unverified — populate during execution |
| AC-2 | unit + catalog preflight integration | Test/log/media report for this scenario | publication rights seam: `packages/shared/schemas/src/lib/community/asset_publish_gate.ts` + `catalog/attribution_preflight.ts`, reached from `scripts/src/lib/catalog/preflight.ts` and the hub reserve handler | Unverified — populate during execution |
| AC-3 | integration | Test/log/media report for this scenario | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated (acceptance record + prepared-hash binding) | Unverified — populate during execution |
| AC-4 | failure-injection integration | Test/log/media report for this scenario | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated + `packages/frontend/storage/src/lib/assets_generated.ts` (reference-aware cleanup) | Unverified — populate during execution |
| AC-5 | migration fixture + client smoke | Test/log/media report for this scenario | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated + publication preflight (`packages/shared/schemas/src/lib/catalog/attribution_preflight.ts` via `scripts/src/lib/catalog/preflight.ts`, and the hub reserve gate) | Unverified — populate during execution |
| AC-6 | migration failure-injection integration | Test/log/media report for this scenario | apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts#registerGenerated + `packages/frontend/storage/src/lib/migrations.ts` `applyMigrations` | Unverified — populate during execution |

**Test Hooks**

- Baseline/targeted: existing affected tests under the flat Moon project ids `local-ai`, `schemas`, `types`, `frontend-storage`, `client`, `hub` and `scripts` as applicable. Determine exact task names from current moon.yml; do not invent passing task output.
- Functional E2E: Playwright in apps/e2e/tests/client or tests/hub, exercising the production path above. Use compiled Svelte tests for reactivity/lifecycle.
- Visual: when UI/game rendering changes, use apps/e2e/src/visual/suites with the current defineConfig/export-default and TypeBox case conventions. Assess native-scale readability/geometry and accessible state presentation. Static contact sheets do not replace in-game/animation evidence.
- Audio: when audio changes, save measured reports and listening notes over delivered renditions; automated geometry/schema checks cannot hear a bad loop.
- Final gates: `bun moon run :validate`, applicable guards and touched-project tests. If a required tool/model is unavailable, identify the exact missing gate; do not mark verified/completed.

## Implementation Sequence

1. Inspect actual storage migrations and registration transaction boundaries.
2. Add schemas, private record persistence and public projection.
3. Wire registration, candidate decisions, rights preflight and reference-aware cleanup.
4. Verify round-trip (AC-1), acceptance drift (AC-3), crash/dedup (AC-4), legacy (AC-5) and failed-migration (AC-6) scenarios.

## Edge Cases & Gotchas

Accepted for local experimentation is not the same decision as approved for community publication.

## Open Questions

No conceptual choice is required to begin the scoped implementation. Hardware, credentials, model/license eligibility and actual measured performance are execution preflight facts. Use the declared unavailable/fallback behavior rather than inventing access or silently expanding scope. Record any new material design question before changing the contract.

## Amendments

This is a newly proposed draft; existing contract approval/amendment rules still apply. Do not self-assign user approval or upgrade status based on this document's presence.

| Version | Date | Change | Approved by |
|---|---|---|---|
| 1.0.0 | 2026-09-13 | Initial proposed scope | Pending contract adoption |
| 1.0.1 | 2026-09-13 | Critic pass against current HEAD, no scope change: (a) the reuse map omitted `community/asset_publishing.ts`, which already declares the C-518 seam (`RightsDecision`/`RIGHTS_SCOPES`) and the public projection this contract proposes to "create" — both are now listed as extend-in-place; (b) added the shipped `evaluateCommunityPublishGate` as a preserved interface and pinned the scope keys/`permitted: boolean` so the allowed/denied/unknown state cannot silently break C-513's fail-closed gate; (c) mapped AC-2's intents onto the three shipped gate scopes; (d) AC-3 referenced a C-520 processor profile that cannot exist before C-520 (which depends on this contract) — reworded to the C-518-owned transformation descriptor; (e) named the real migration seam (`migrations.ts`, C-384 append-only list) instead of "existing Turso migration conventions", and added AC-6 for the failed-migration requirement that had no observable AC; (f) stated the C-519 job-record boundary; (g) corrected the Moon project ids in Test Hooks and made the Evidence Matrix production paths AC-specific instead of five copies of one path. | critic |

## Promotion Lifecycle

See docs/contracts/SHARED_SECTIONS.md. An implemented code path without required production, visual or audio evidence is not release_verified.

## Status Lifecycle

See docs/contracts/SHARED_SECTIONS.md. Preserve accurate draft/implemented/verified/completed distinctions.

## Execution Report

### Summary

C-518 landed the durable half of local asset generation: versioned TypeBox
schemas for `GenerationProvenance` v1, `CandidateRecord` and `AcceptanceRecord`
(new `packages/shared/schemas/src/lib/generation/generation_provenance.ts`),
an additive extension of the C-513 rights seam in
`community/asset_publishing.ts` (`state: allowed|denied|unknown` carried
*alongside* the required, still-read `permitted: boolean`), an independent
per-intended-use evaluator plus fail-closed `unknown` handling in the shipped
`evaluateCommunityPublishGate`, a reference-aware generation-record store on a
new append-only migration v7, the client registration seam
(`assetManager.registerGenerated`) persisting lineage and acceptance with the
registry row, a `redactGenerationProvenance` projection, and catalog/preflight
wiring that asks for missing rights evidence.

Deferred (documented under Deviations): the model-terms resolver that would
*block local generation* on an unresolved `inference` scope, and enforcement of
a rights block for catalogs that declare none — both need the C-520 processor
profile / model-profile seam.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Storage round-trip + fresh-connection reload (`generation_records.test.ts`), production registration smoke through `assetManager.registerGenerated` (`generated_asset_lineage.test.ts`), and the public projection omitting prompts/model ids/local paths (`redact_generation_provenance.test.ts`). |
| AC-2 | ✅ | `evaluateIntendedUse` maps `localGeneration`/`gameExport`/`communityExport` to `inference`/`gameInclusion`/`standaloneDistribution` and evaluates each independently; `isScopePermitted` refuses `unknown` even with a stale `permitted: true`; the hub reserve handler returns `rights-unresolved` (not `rights-denied`) for an unknown scope (production path). No rule copies the model licence onto outputs. |
| AC-3 | ✅ | The acceptance stores the prepared hash *and* the transformation-chain hash; replacing bytes or editing a transformation/processor descriptor invalidates it while the accepted content stays resolvable; accepting a second candidate for one tag requires an explicit `revisionOf` decision (`GenerationRevisionConflictError` otherwise). |
| AC-4 | ✅ | Injected transaction failure leaves no candidate and no acceptance; retry converges on one candidate; deleting one of two candidates that share cached bytes reports only the hash that became unreferenced. |
| AC-5 | ⚠️ | Legacy pre-contract rows still resolve and report explicit `unknown` lineage (never backfilled); `runCatalogPublish` refuses before uploading when declared rights evidence is missing or `unknown`. Partial: the rights requirement is opt-in on the catalog declaring a `rights` block — see Deviations. |
| AC-6 | ✅ | Injected mid-apply failure: `user_version` stays at 6, no half-applied table exists, the pre-existing generated row still resolves, and a clean retry reaches 7; the added tables are additive-only for a v6 reader. |

### Files Created

| File | Purpose |
|---|---|
| `packages/shared/schemas/src/lib/generation/generation_provenance.ts` | `GenerationProvenance` v1, `CandidateRecord`, `AcceptanceRecord`, model/transformation/reference/media shapes (hosted-provider limitation, never a fabricated hash). |
| `packages/shared/schemas/src/lib/generation/generation_provenance.test.ts` | Schema-level AC-1/AC-3 assertions. |
| `packages/shared/schemas/src/lib/catalog/attribution_preflight.test.ts` | AC-5 unit: evidence requested, `unknown` is incomplete, undated evidence cannot substantiate. |
| `packages/shared/types/src/lib/generation/provenance.ts` | `Static`-derived public types (Schema-First law). |
| `packages/shared/utils/src/lib/community/redact_generation_provenance.ts` | The single private→public projection derivation (drops prompts, model ids, pointers, local paths). |
| `packages/shared/utils/src/lib/community/redact_generation_provenance.test.ts` | AC-1 projection-omission assertions. |
| `packages/shared/local-ai/src/lib/generation_provenance.ts` | Portable `hashTransformationChain`, `deriveCandidateId`, `buildGenerationProvenance` (the only chain-hash authority). |
| `packages/frontend/storage/src/lib/generation_records.ts` | Candidate/acceptance/artifact store: transactional writes, drift check, reference-aware cleanup. |
| `packages/frontend/storage/src/lib/__tests__/generation_records.test.ts` | AC-1/AC-3/AC-4/AC-5/AC-6 storage evidence. |
| `apps/frontend/client/src/lib/services/assets/generated_asset_lineage.test.ts` | AC-1/AC-3/AC-4 production-registration smoke + projection omission. |
| `scripts/src/lib/catalog/__tests__/publish_rights_preflight.test.ts` | AC-5 production path through `runCatalogPublish`. |

### Files Modified

| File | Change |
|---|---|
| `packages/shared/schemas/src/lib/community/asset_publishing.ts` | Extended the C-518 rights seam additively: `RightsDecisionStateSchema` (`allowed`/`denied`/`unknown`), evidence url/version/date/intended-use fields, and the optional public `generation` block on `CommunityAssetProvenanceProjectionSchema`. `RIGHTS_SCOPES` and `permitted: boolean` are unchanged. |
| `packages/shared/schemas/src/lib/community/asset_publish_gate.ts` | Added `isScopePermitted`, `INTENDED_USES`, `SCOPE_FOR_INTENDED_USE`, `evaluateIntendedUse`; the gate now refuses an `unknown` scope as `rights-unresolved` and keeps explicit refusals as `rights-denied`. |
| `packages/shared/schemas/src/lib/community/asset_publish_gate.test.ts` | New AC-2 block (independent intents, unknown refuses, stale `permitted: true` rejected). |
| `packages/shared/schemas/src/lib/catalog/attribution_preflight.ts` | Optional `rightsEvidenceByTag`; reports `missingRightsEvidenceTags` / `incompleteRightsTags`; behaviour unchanged when no rights data is declared. |
| `packages/shared/schemas/src/index.ts`, `packages/shared/types/src/index.ts`, `packages/shared/types/src/lib/community/asset_publishing.ts`, `packages/shared/utils/src/index.ts`, `packages/shared/local-ai/src/index.ts`, `packages/frontend/storage/src/index.ts` | Barrel exports for the new modules/types. |
| `packages/frontend/storage/src/lib/migrations.ts` | Appended migration v7 (`generation_candidates`, `generation_acceptances`, `generation_artifacts` + indexes); no released entry touched. |
| `packages/frontend/storage/src/lib/assets.ts` | Added a documented `database` getter so the record writes share the registry's connection/transaction. |
| `apps/frontend/client/src/lib/services/assets/generated_asset_registration.ts` | Optional `GeneratedAssetLineage`; writes the record (and acceptance) before the registry row and compensates on failure; returns `candidateId`. |
| `apps/frontend/client/src/lib/services/assets/asset_manager.svelte.ts` | `registerGenerated` passes the lineage through (the contract's production surface). |
| `apps/frontend/client/src/lib/services/image/generated_asset_workflow.ts` | The studio save records a lineage + acceptance; fail-closed `unknown` rights unless a resolver is supplied. |
| `scripts/src/lib/catalog/pipeline.ts`, `scripts/src/lib/catalog/preflight.ts` | Load and pass declared rights evidence; report the new refusal categories. |
| `apps/frontend/hub/src/lib/server/api/tests/asset_publish.test.ts` | AC-2 reserve-path test for an `unknown` scope. |
| `apps/frontend/client/src/lib/services/**/{session,game_overlay,game_save,player_journal,chat,chat_link,persona,npc,npc_schedule,campaign,campaign,agent_registry}_*.test.ts` (12 files) | Mock factories now spread the real `@aikami/frontend/storage` module before overriding `getLocalDatabase`; C-518 was the first runtime import of that package in these chains. |
| `apps/frontend/docs/src/content/docs/guides/creating-assets.mdx` | Short user-facing section on durable lineage, acceptance binding and scoped rights. |

### Deviations from Spec

1. **Catalog rights evidence is opt-in.** `runAttributionPreflight` requires
   evidence only when `asset_credits.json` declares a `rights` block (a catalog
   with no block keeps pre-C-518 behaviour). Requiring it unconditionally would
   have failed the entire ~12.7k-asset shipped catalog on the first publish.
   Follow-up for the amender: decide the migration point for the shipped
   catalog's rights evidence.
2. **No client-side model-terms resolver.** The studio records fail-closed
   `unknown` scopes rather than resolving the model's terms, because no terms
   source is reachable on that path today (the model profile seam arrives in
   C-520). Consequently "unknown permission to run a gated model blocks that
   provider" is enforced at *publication* (gate + preflight) and by
   `evaluateIntendedUse`, not yet by blocking the Studio's generate action.
   Proposed Amendment: name C-520 as the owner of the provider-blocking
   enforcement.
3. **Record store is a new module, not an extension of `assets_generated.ts`.**
   The reuse map named `assets_generated.ts` "add transactional authoring
   records", but that file is 416 lines and the record store is ~430; merging
   would break the 800-line hard limit. `assets_generated.ts` remains the only
   writer of `assets` / `asset_sources`, so there is no second write authority.
4. **`AssetRegistryRepository` gained a `database` getter.** The record writes
   must run on the same connection/transaction as the registry row; a second
   connection could not share it.
5. **No screenshot/visual evidence.** No UI rendering changed and this session
   has no browser/`ai_validate_image` tool available. Production-path evidence
   is the integration suites plus the production dev server booting from the
   worktree and serving `GET /studio/assets` → 200 with no errors.
6. **Test-mock completion.** Twelve client test files' storage mocks were
   incomplete (naming only `getLocalDatabase`); they now spread the real
   module. This was required, not optional — those mocks aborted with
   `Export named 'deleteGenerationCandidate' not found` once the client chain
   imported the package at runtime.

### Test Results

- Unit (schemas): 693/693 (0 failures)
- Unit (utils): 330/330 (0 failures)
- Unit (local-ai): 292/292 (0 failures)
- Unit (frontend-storage): 102/102 (0 failures) — includes 16 new C-518 tests
- Unit (hub): 188/188 (0 failures)
- Unit (client): 3096/3105 (0 failures; 7 skipped, 2 todo) — includes 8 new C-518 tests
- Unit (scripts): 1188/1192 (2 pre-existing failures, 2 skipped) — `pack_index_reconciliation` freshness and `pre_commit` git-inspection, both reproduced on a clean stash of this branch
- Visual: not applicable — no UI rendering change; no browser/`ai_validate_image` tool in this session
- Baseline: 2 pre-existing scripts failures, 0 new failures
- Guards: `guard_source_file_size` passed (2830 files, 111 non-failing warnings)
- `validate({ test: true })`: affected projects (client, docs, frontend-storage, hub, local-ai, schemas, scripts, types, utils) → 4 tasks passed, clean
