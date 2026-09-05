---
id: C-481
title: "Converge AI configuration, capability metadata and routing"
source: direct
contract_type: full
status: draft
github: { issue_number: null, issue_url: null, project_item_id: null, pr_url: null }
created_at: "2026-09-05T15:34:22Z"
---
# Contract C-481: Converge AI configuration, capability metadata and routing

## Metadata
| Field | Value |
|---|---|
| **Source** | User-approved AI setup direction; [execution plan](../plans/ai-setup/README.md) |
| **Target** | Shared schemas/types/constants, frontend AI gateway and client configuration/setup services |
| **Type** | full |
| **Priority** | P0 — prevent configuration divergence before new UX |
| **Dependencies** | C-463/C-465 implementation; queue P03/P04 repairs; no dependency on C-482 implementation |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | Update `apps/frontend/docs/src/content/docs/` connection/settings guidance at integration |
| **Contract version** | 1.0.0 |

## Problem & Baseline Evidence
The working tree reviewed at `3bb9af3b` has two live views of configuration: `config_service.svelte.ts` new provider/connection/role mutators omit some projection refreshes, while `capability_view_model.svelte.ts` reads the legacy arrays. Reproduce add-second/edit/delete before reload against real config state.
Provider locality, required URL/key rules, tabs and role sets are repeated; `ai_settings_view_model.svelte.ts` also owns HTTP/model-listing/business rules. Its registry-only lookup can conflate two server endpoints.
Baseline: current config/capability/settings tests and gateway tests. Record actual failures; historical contract counts and identity-rune mocks are not evidence of reactive correctness.

## User Outcome
A player configures an account/server once, uses different models for different features, and sees the same selected configuration during setup, settings and gameplay after reload.

## Success Measures
No network request on configuration load or settings mount; no duplicate credential per model; offline loading remains synchronous after local persistence is loaded. One resolver determines effective generation routing.

## Existing System & Reuse Map
| Existing source | Treatment |
|---|---|
| `packages/shared/schemas/src/lib/domain/providers_config.ts` and inferred types | Extend schema-first; retain provider/connection identity |
| `packages/shared/constants/src/lib/providers.ts` | Canonical provider metadata, not duplicated ViewModel sets |
| `apps/frontend/client/src/lib/services/config/config_service.svelte.ts` | Sole validated mutation/persistence boundary; legacy projections become read-only |
| `packages/frontend/ai-gateway/` and client AI services | Reuse protocol adapters; shared discovery, verification and effective routing |

## Architecture Directives
Definitions describe protocol/auth/model discovery and capabilities; instances describe endpoint/account identity. Protocol name must not imply locality or management ownership. Distinct endpoints/accounts remain distinct even with the same registry ID.
Keep `voice` as the existing TTS capability key. Required text and optional image/voice are declarative. STT/music/ambience/video are future design cases; do not enable them without adapters. Registry completeness tests must expose missing schema/adapter support, not silently treat future jobs as text.
Local/cloud/LAN location, native/container/browser execution and app/external ownership are independent facts. Unknown legacy ownership defaults to external; discovery never grants lifecycle control.
Shared setup services own endpoint validation, credential reuse, model discovery, verification and applying configuration. ViewModels hold presentation only. All operations are transport-injected and expose bounded, typed failures.

## State & Data Models
Retain `AiProvider` (single credential owner) and `AiConnection` (provider reference, model, capability-discriminated params). Optional managed-runtime references identify inventory owned by C-482; observed health is not persisted configuration truth.
Proposed v3 payload uses one canonical `routing: { defaults, overrides }`: defaults map capability to connection; overrides map role to connection. Resolve explicit override, then that role's capability default, otherwise unavailable; never fall back to an arbitrary first row or to cloud.
Legacy `connections`, `roles`, `defaultConnectionId` and `defaultByCapability` are derived compatibility views only. Preserve every explicit legacy role assignment during migration; do not infer that matching values were intentional inheritance. New configurations use defaults with sparse overrides.
Feature availability, endpoint reachability, selected-model compatibility and last successful generation are distinct states. Verification results are timestamped and invalidated by relevant configuration edits.

## Quality Requirements
Offline: no sign-in/cloud boot dependency. Security: keys remain provider-owned and encrypted at rest through the existing vault, never copied into diagnostics or model records; no credential-bearing URL logs.
Persistence: schema-validate loads and mutations, reject cross-capability routing/params and dangling references. Updates are atomic at the persistence boundary; failure retains the last working config. Accessibility is owned by consuming contracts.
Cancellation: network operations have deadlines and caller cancellation; stale responses cannot overwrite a newer draft. No background scans on mount. Redacted diagnostics identify operation and failure category.

## Migration & Rollback
Accept v1 through existing validated v2 migration, then v2 -> v3 in memory. Retain an encrypted pre-migration snapshot; validate the full candidate before an atomic write. Failed migration/write leaves the original untouched and exposes recovery, not empty-state overwrite.
Map each capability's existing primary-role connection to its default; preserve all explicit legacy roles as overrides and stable provider/connection IDs. Preserve user presets, voice/image options and non-AI settings. New defaults must not erase migrated overrides.
Older binaries must not edit a v3 vault directly: rollback uses explicit restoration of the encrypted pre-upgrade snapshot with confirmation that later changes will be lost. No automatic downgrade or deletion of the recovery copy. UI rollback may use read-only legacy projections; there is no second writable backend.

## Scope Boundaries
In scope: canonical configuration/routing, validated migration, definitions/identity, shared setup/verification operations and integration of existing text/image/TTS consumers. Out: installation executors, full UI redesign, new inference capabilities, cloud trial, save-game migration or agent-pipeline changes.

## Contract Size & Split Rule
Use queue P05–P08, splitting review-sized implementation slices as necessary. Each intermediate main must work; do not activate half a migration. See [split rule](SHARED_SECTIONS.md#contract-size--split-rule).

## Acceptance Criteria
| AC | Given / When / Then | Required evidence |
|---|---|---|
| AC-1 | Given two models on one account and a second endpoint, when edited/reloaded, then credentials are shared only by the intended provider and endpoints stay distinct. | Real config persistence unit fixtures; settings integration |
| AC-2 | Given provider/connection/route mutations, when any consumer reads before and after reload, then all legacy and new views agree with canonical state. | Add/edit/delete/default/override regression matrix; compiled or production-route reactivity test |
| AC-3 | Given v1/v2/v3, malformed data and failing storage, when loaded/migrated/restored, then IDs/effective routing survive, retries are idempotent and failed writes preserve the original. | Versioned synthetic vault fixtures and migration/failure/restore tests, no real keys |
| AC-4 | Given defaults and explicit role overrides, when defaults change or a referenced connection is removed, then overrides remain intentional, incompatible assignments are rejected and no silent replacement occurs. | Resolver tests across text/image/voice, unassigned and deleted cases |
| AC-5 | Given local, cloud and same-protocol LAN instances, when listing models/testing, then the selected endpoint/auth/transport is used and configuration alone is not readiness. | Adapter tests for keyless/auth/error/abort/stale response cases |
| AC-6 | Given unsupported/future capabilities or a browser host, when computing available actions, then unsupported installation/jobs are absent while compatible browser/server paths remain. | Definition/platform contract tests; `/capability` and `/settings` E2E |

## Implementation Sequence
P05 freezes definitions/seams; P06 migrates safely; P07 shares setup operations; P08 cuts consumers over and removes writable compatibility paths. Run current `client:test`, affected shared/gateway tests via Moon, then `validate({ test: true })`; use POM E2E and visual evidence for changed production surfaces.

## Edge Cases & Gotchas
Model IDs are provider-scoped; credentials may rotate; endpoint normalization must preserve meaningful paths/ports. Removing a required route makes it visibly unavailable, never silently charge another account. Confirm legacy option precedence with fixtures before removing old readers.

## Open Questions
None delegated to the worker. The v3 routing/migration proposal requires explicit contract approval and the P05 seam review before execution; materially different schemas require an amendment.

## Amendments
No amendments; draft specification. Scope/AC changes require version bump and user approval.

## Promotion Lifecycle
See [shared promotion rules](SHARED_SECTIONS.md#promotion-lifecycle).
## Status Lifecycle
See [shared status rules](SHARED_SECTIONS.md#status-lifecycle). Append an execution report only after implementation; partial PRs do not complete this contract.
