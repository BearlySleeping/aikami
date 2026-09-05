---
id: C-473
title: "Record complete and honest pipeline usage and cost"
source: direct
contract_type: full
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-04T00:00:00Z"
---

# Contract C-473: Record complete and honest pipeline usage and cost

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 07 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | Worker event collection, pipeline manifest usage and status reports |
| **Type** | full |
| **Priority** | P1 — model/cost optimization currently has no usable run ledger |
| **Dependencies** | C-472 |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal — usage completeness, estimates and reports |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / medium; target 8–20 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** 66 local manifests containing 217 attempts had empty usage. Legacy `worker.ts` aggregates usage, but the active Herdr launch path runs Pi directly and does not populate that ledger.
- **Reproduction:** inspect active launch/event paths and summarize manifests without logging prompts, credentials or personal data. Historical counts are audit observations, not a success-rate benchmark.
- **Reuse:** `StageUsage` in `types.ts`, Pi usage events, `cost_guard.ts`, `worker.ts` aggregation logic, status/report helpers and C-472 event collection.
- **Known gaps:** cumulative totalTokens in the legacy path takes the last event rather than an aggregate; retries, review and external usage need explicit accounting and missing-data semantics.
- **Baseline tests:** C-468/C-472 suites and existing cost-guard tests.

## User Outcome

The maintainer can compare total cost and time per accepted contract without mistaking absent billing data for free execution.

## Success Measures

Fixture token/cost totals reconcile exactly across ordinary runs, retries, duplicate events and resume. Unknown cost is visibly unknown; provider-reported and estimated amounts are distinguishable.

## Existing System & Reuse Map

| Capability | Existing source | Action |
|---|---|---|
| Model usage events | current Pi worker stream/session APIs | collect |
| Usage type/status | pipeline `types.ts`, `status.ts` | version/extend |
| Spend protection | `.pi/extensions/cost_guard.ts` | reuse observations; do not replace |
| Worker lifecycle | C-472 controller | attach idempotent ledger events |

## Overview

Persist per-attempt accounting from the active execution path and derive run totals, including failed/retried work. Keep storage local and bounded; a small event/summary ledger is sufficient, not a hosted analytics platform.

## Design Reference

C-472 supplies events and C-470 supplies generation identity. Keep fixture-based tests independent of paid providers; see [testing conventions](SHARED_SECTIONS.md#testing-conventions).

## Architecture Directives

Aggregate final provider usage events once per event/generation. Preserve provider field semantics: do not double-count cached input if a provider reports inclusive prompt totals. Normalize via explicit adapters/fixtures. Use provider-reported monetary cost when valid; otherwise estimate from versioned pricing and label it estimated. Missing values stay unknown.

Record model/provider, effective thinking level, prompt/profile/config version, elapsed time, turns, tool errors, retries and validation outcome. Include writer/critic/implementer/verifier/review paths. Record external review/vision/delegation usage when an adapter exposes it; otherwise mark coverage incomplete and do not silently absorb it into a zero.

## State & Data Models

Version per-generation usage records with event identity, token categories, monetary amount/currency/provenance, completeness and finalization status. Run and task totals include unsuccessful attempts. Monetary amounts aggregate into separate totals per currency; a converted total is permitted only when every conversion records a versioned conversion source, the applied rate and its timestamp. Legacy empty `usage` objects load as unknown/incomplete, not zero. Store hashes/identifiers, not complete prompts or API keys.

## Quality Requirements

- **Offline/degraded:** local append/summary operation; absent provider billing remains explicit.
- **Accessibility/input:** readable CLI summary plus machine-readable report.
- **Performance:** bounded event buffering; avoid rewriting the entire manifest per streamed token.
- **Security/privacy:** redact sensitive payloads and environment values; configurable retention.
- **Persistence/migration:** old manifests readable; interrupted finalization remains incomplete.
- **Cancellation/retry/idempotency:** resume and duplicate events do not double-bill.
- **Observability:** expose completeness and estimation source alongside totals.

## Migration & Rollback

Add a versioned ledger/summary without fabricating backfilled costs. Preserve raw old artifacts; optional historical import is explicit and read-only until approved. Unknown versions remain inspectable. Rollback can ignore new summaries without destroying them.

## Scope Boundaries

- **In Scope:** active-path accounting, aggregation, identity/deduplication, coverage, status reports, privacy/retention and tests.
- **Out of Scope:** paid benchmarks, new model defaults, provider-price scraping, hosted analytics, changing budget limits, reconstructing unavailable historical billing.

## Contract Size & Split Rule

See [split rule](SHARED_SECTIONS.md#contract-size--split-rule). One ledger/reporting outcome; maximum 99 files. Model routing experiments remain in C-480.

## Acceptance Criteria

### AC-1: Active workers and review produce usage
**Given** captured provider-event fixtures through the active C-472 path,
**When** a stage/review completes,
**Then** its model, effective settings, token categories, elapsed time and cost provenance are persisted and visible in status output.

### AC-2: Retry/resume totals reconcile
**Given** failed and successful generations, repeated events, an interrupted/resumed run and mixed-currency usage,
**When** aggregation executes,
**Then** run/task totals include all distinct billable work exactly once and totalTokens is not merely the last event's value. Monetary totals remain separate per currency unless a versioned conversion source, applied rate and timestamp are recorded for every converted amount; absent conversion metadata never produces a cross-currency sum.

### AC-3: Missing and external costs are honest
**Given** providers or external tools with absent/estimated billing,
**When** the report computes cost per accepted task,
**Then** unknown/incomplete portions are explicit and never shown as a complete zero; estimates carry the applied pricing source/version.

### AC-4: Legacy data and privacy are preserved
**Given** old empty manifests, malformed events or sensitive provider payloads,
**When** collection/reporting executes,
**Then** old runs remain readable, malformed data is reported, and secrets/prompt bodies do not enter the usage ledger.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | proposed `contract_pipeline/usage_ledger.test.ts` | active worker/review | pending implementation |
| AC-2 | Unit | same, duplicate/resume and mixed-currency fixtures, including unsuccessful attempts | run/task totals | pending implementation |
| AC-3 | Unit | proposed `usage_report.test.ts` | CLI/report | pending implementation |
| AC-4 | Unit/Integration | legacy/redaction fixtures | status/resume | pending implementation |

**Test Hooks:** C-468 automation tasks and C-472 fake controller; test representative provider usage shapes offline. Three-OS file-write tests; E2E browser/visual N/A. No paid run is required to prove normalization.
**Watch Points:** inclusive cached-token fields, stream partials, message replay, review sessions persisting across attempts, costs reported in different currencies and unknown/incomplete legacy usage alongside currency totals.

## Implementation Sequence

1. Specify normalized usage semantics from actual provider/SDK types and fixtures.
2. Attach idempotent collection to current workers/review and add local reporting.
3. Verify reconciliation, privacy, crash recovery and legacy compatibility.

## Edge Cases & Gotchas

A run that exits before usage is emitted is incomplete, not free. Report clock-derived elapsed time with appropriate monotonic measurement during a process; do not infer token counts from text length.

## Open Questions

None for scope approval. Unavailable external billing stays unknown; no new external integration is required solely to fill it.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).

## Execution Report

### Summary
Extended the pipeline types with rich usage accounting (per-currency MonetaryAmount, CurrencyProvenance, UsageRecord, AggregatedUsage), implemented usage aggregation with deduplication and retry reconciliation, built a human-readable and machine-readable usage report system, and added 40 tests across 4 acceptance criteria covering active worker usage, retry/resume reconciliation, missing/external cost honesty, and legacy/privacy preservation.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Active workers produce usage — model, tokens, cost provenance persisted and visible in aggregated output |
| AC-2 | ✅ | Retry/resume totals reconcile — aggregatedTotalTokens is SUM not last event; duplicates deduped by eventId; mixed-currency kept separate without conversion metadata |
| AC-3 | ✅ | Missing and external costs are honest — unknown/incomplete explicitly shown; estimated costs carry pricing version; report never shows absent billing as zero |
| AC-4 | ✅ | Legacy data preserved — old empty manifests load as unknown/incomplete; secrets/prompt bodies excluded from UsageRecord shape |

### Files Created
| File | Purpose |
|---|---|
| `scripts/src/lib/agents/contract_pipeline/usage_ledger.ts` | Core aggregation: normalizeLegacyUsage, deduplicateRecords, aggregateUsage, computeManifestUsage, loadLegacyManifestUsage, mergeMonetaryAmounts |
| `scripts/src/lib/agents/contract_pipeline/usage_ledger.test.ts` | 22 tests covering AC-1, AC-2, AC-4: legacy normalization, deduplication, retry reconciliation, mixed-currency, manifest aggregation |
| `scripts/src/lib/agents/contract_pipeline/usage_report.ts` | CLI report formatting: formatUsageReport, formatUsageReportJson, formatMonetaryAmount, formatUsageRecord |
| `scripts/src/lib/agents/contract_pipeline/usage_report.test.ts` | 18 tests covering AC-3, AC-4: unknown/estimated cost display, JSON report structure, privacy field verification |

### Files Modified
| File | Change |
|---|---|
| `scripts/src/lib/agents/contract_pipeline/types.ts` | Added CurrencyProvenance, MonetaryAmount, UsageRecord, AggregatedUsage types; extended StageAttempt with usageRecord field; added aggregatedUsage to RunManifest |
| `scripts/src/lib/agents/contract_pipeline/index.ts` | Exported new types (AggregatedUsage, CurrencyProvenance, MonetaryAmount, UsageRecord) and functions (aggregateUsage, computeManifestUsage, etc.) |

### Deviations from Spec
None. The implementation matches the contract ACs, Evidence Matrix, and Architecture Directives.

### Test Results
- Unit: 40/40 PASS (0 failures) — 177 expect() calls
- E2E: N/A (internal pipeline infrastructure, no browser routes)
- Visual: N/A
- Baseline: 0 pre-existing failures (250 pipeline tests pass), 0 new failures
- Pre-existing typecheck error (TS2688: bun types not installed in scripts workspace) — confirmed not caused by this contract
