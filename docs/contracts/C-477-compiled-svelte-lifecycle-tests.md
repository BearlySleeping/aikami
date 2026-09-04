---
id: C-477
title: "Test real Svelte reactivity and lifecycle alongside pure Bun tests"
source: direct
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-04T22:21:38Z"
---

# Contract C-477: Test real Svelte reactivity and lifecycle alongside pure Bun tests

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 11 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | Frontend test configuration, compiled ViewModel/component fixtures and testing guidance |
| **Type** | full |
| **Priority** | P1 — identity rune polyfills cannot verify reactivity, effects or disposal |
| **Dependencies** | C-468, C-475 |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal — correct division of pure, compiled-component and production-route tests |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / high; target 8–25 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** client Bun tests preload rune/service polyfills. The testing skill acknowledges that rune polyfills are identity functions without reactive semantics. Ordinary logic tests are useful, but cannot prove effect scheduling, derived invalidation or component unmount cleanup.
- **Reproduction:** inspect `apps/frontend/client/src/lib/test_preload.ts`, test scripts/configuration, the BaseViewModel lifecycle and existing browser tests. Show one fixture that passes as ordinary state assignment but requires compilation to observe reactive updates/disposal.
- **Existing implementation to reuse:** Svelte/Vite compilation, existing Playwright infrastructure/POM conventions, C-475 canonical ViewModel examples and current pure Bun suites.
- **Known gaps:** compiled testing boundaries and ownership of mocks are not explicit; global mock pollution can conceal integration problems. docs/TODO.md already records broader existing unit-test failures and an alias migration, which this contract must not absorb.
- **Baseline tests:** capture related pure-unit failures by exact test ID, then run the selected existing browser/lifecycle checks independently.

## User Outcome

A developer can test reactive ViewModels/components with actual Svelte semantics while keeping fast pure-logic tests cheap and independent of the browser.

## Success Measures

A deliberate reactive-update or cleanup defect fails the compiled suite. Focused tests use no AI/GPU/cloud credentials; pure Bun suites keep their existing lightweight role. Report startup/run durations and selected test count rather than imposing flaky wall-clock assertions.

## Existing System & Reuse Map

| Capability | Existing source | Action |
|---|---|---|
| Pure-unit preload | `apps/frontend/client/src/lib/test_preload.ts` | retain, clarify limitations |
| Unit configuration | `apps/frontend/client/scripts/write_test_tsconfig.ts`, `tsconfig.test.json` | reuse resolution source |
| Browser tests | `apps/e2e/playwright.config.ts` and existing fixtures/POMs | reuse where practical |
| Canonical lifecycle | existing BaseViewModel/services and C-475 examples | exercise real implementations |

## Overview

Add a small compiled-component/lifecycle lane, not a replacement test framework for the whole repo. Use the existing Svelte compiler/Vite and Playwright stack by default. Any additional runner dependency requires a concrete gap/alternatives note and version pin before adoption.

## Design Reference

Follow current framework APIs rather than obsolete guidance. See [testing conventions](SHARED_SECTIONS.md#testing-conventions), updated by this contract where those conventions incorrectly imply polyfills test reactivity.

## Architecture Directives

Separate test entrypoints for pure logic and compiled reactive behavior; do not load identity rune polyfills into the compiled lane. Mock external I/O at stable boundaries, not the Svelte runtime or every service under test. Use deterministic test-owned fixtures and explicit render/flush conditions, not arbitrary sleeps. Clean up mounts, subscriptions, timers and owned browser contexts after each case.

Select one representative ViewModel/component already aligned with C-475 to prove the lane, plus focused lifecycle fixtures. Do not refactor unrelated gameplay or migrate all tests. Reuse application alias resolution; no new hand-maintained parallel alias map.

## State & Data Models

No application/save schema changes. Test configuration identifies pure versus compiled targets and their browser/runtime prerequisites. Fixture state and fake I/O are owned per test; no shared emulator dataset or credentials are required. Existing production state APIs remain unchanged.

## Quality Requirements

- **Offline/degraded:** test scenario needs no network beyond local fixture server; dependency/browser installation is a separate prerequisite.
- **Accessibility/input:** use semantic queries/POMs for component interactions; no visual model needed.
- **Performance:** focused deterministic lane; no full game/GPU boot for unit-like lifecycle checks.
- **Security/privacy:** synthetic state only; no real auth sessions or user saves.
- **Persistence/migration:** N/A — no persistent application changes.
- **Cancellation/retry/idempotency:** remount/unmount and failed-test cleanup release resources.
- **Observability:** failed assertions include useful trace/test identifiers, not only screenshots.

## Migration & Rollback

Introduce the lane alongside current tests. Existing tests are not silently moved or skipped. Rollback removes the new lane/configuration without changing application behavior; retain regression fixtures so migration can be retried. Broader known test failures remain separately tracked.

## Scope Boundaries

- **In Scope:** compiled test lane, representative reactive/update/disposal tests, shared resolution, task/CI integration and honest testing guidance.
- **Out of Scope:** migrating every ViewModel/test, fixing all baseline failures, alias migration, gameplay changes, GPU visual testing, replacing Bun or Playwright.

## Contract Size & Split Rule

See [split rule](SHARED_SECTIONS.md#contract-size--split-rule). One outcome: a working compiled lifecycle lane. Limit converted/representative application subjects to the minimum needed; maximum 99 files.

## Acceptance Criteria

### AC-1: Real reactive updates are observed
**Given** a compiled ViewModel/component with state and a derived display value,
**When** state changes through its public API,
**Then** the rendered result updates under real Svelte scheduling. A deliberately broken reactive dependency fails the test.

### AC-2: Lifecycle cleanup is verified
**Given** a mounted subject with an effect/subscription or owned timer,
**When** it unmounts and remounts,
**Then** the old resource is released, stale callbacks cannot update the new instance, and effects are not duplicated. Failure injection exposes a missing cleanup.

### AC-3: Async failure and stale completion are covered
**Given** test-controlled async I/O and a subject disposed or superseded before completion,
**When** success/failure arrives out of order,
**Then** the subject follows its documented error/cancellation semantics without stale UI updates or leaked unhandled rejections.

### AC-4: Pure and compiled suites remain isolated
**Given** both entrypoints run in either order,
**When** mocks and test state are reset,
**Then** neither lane leaks runtime polyfills/mocks into the other, pure tests do not require browser startup, and compiled tests use the actual framework transform.

### AC-5: The lane is reproducible and correctly selected
**Given** affected frontend/lifecycle/config changes,
**When** the focused Moon/CI target runs,
**Then** it uses declared browser prerequisites, propagates failures and provides artifacts on failure. Linux is the primary browser CI lane; native Windows/macOS command-resolution/cleanup smokes are separately recorded without claiming exhaustive browser coverage.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Compiled component | proposed `apps/e2e/tests/client/reactive_lifecycle.spec.ts` or equivalent focused existing-stack suite | representative ViewModel/component | pending implementation |
| AC-2 | Compiled component | lifecycle/disposal fixtures and assertions | mount/unmount | pending implementation |
| AC-3 | Compiled component | controlled async completion fixtures | error/stale update | pending implementation |
| AC-4 | Integration | pure/compiled lane isolation checks | test entrypoints | pending implementation |
| AC-5 | Integration | focused Moon/CI task and command smoke evidence | contributor test command | pending implementation |

**Test Hooks:** declare a focused compiled-lifecycle Moon target and preserve the existing client pure-unit target. Use existing POM conventions if a Playwright spec is selected. Visual assessment suite: N/A — acceptance concerns behavior, not appearance. Required checks need no VLM score or paid call.
**Watch Points:** identity polyfills accidentally entering the bundle; globally mocked barrels replacing the subject; tests passing without asserting post-update DOM; fixed sleeps hiding races.

## Implementation Sequence

1. Demonstrate the polyfill limitation and select the smallest existing-stack compiled entrypoint.
2. Add positive and deliberately broken update/cleanup/async fixtures, with one representative real subject.
3. Wire focused tasks, run isolation/platform smokes and update guidance with exact test capabilities.

## Edge Cases & Gotchas

Browser downloads/cache paths differ on NixOS and ordinary OS installs. Reuse configured browser executables where supported; do not claim network-isolated setup before dependencies are installed. Do not add a production-only dependency merely to run tests.

## Open Questions

None for scope approval. Exact suite placement is an implementation detail; adding a new runner instead of existing-stack composition requires an explicit dependency justification, not a silent framework migration.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).
