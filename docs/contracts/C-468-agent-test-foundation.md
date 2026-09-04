---
id: C-468
title: "Repair Pi dependency loading and establish deterministic automation CI"
source: direct
contract_type: thin
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-04T00:00:00Z"
---

# Contract C-468: Repair Pi dependency loading and establish deterministic automation CI

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 01 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | `.pi/` dependency configuration, automation unit tasks and `.github/workflows/` |
| **Type** | thin |
| **Priority** | P0 — the regression suite for the development harness currently fails and is excluded from normal CI |
| **Dependencies** | None — first entry point; run outside the automated contract pipeline |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal — tooling test commands and supported runtimes |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / medium; target 5–15 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** at `f73e5fae`, `cd .pi && bun test extensions/` produced 174 pass, 6 fail, 1 error. Loading Pi's experimental server export could not resolve `@earendil-works/pi-server`. `bun run measure-tools` failed through the same import path.
- **Reproduction:** run those two commands without installing or upgrading anything first; capture installed dependency versions and the import chain. Do not assume adding a package is the correct fix before checking upstream declarations and runtime imports.
- **Existing implementation to reuse:** `.pi/extensions/lib/registration.test.ts`, `.pi/scripts/measure_tool_surface.ts`, `scripts/src/lib/env/runtime_boundary.test.ts`, `.pi/moon.yml`, `scripts/moon.yml`, `.github/workflows/pr-checks.yml`.
- **Known gaps:** Pi/scripts test tasks have `runInCI: false`; existing registration tests do not prove production Node loading when exercised only through Bun.
- **Baseline tests:** Pi extensions; `cd scripts && bun test ./src/lib/agents/contract_pipeline ./src/lib/herdr/session.test.ts` (196 pass in the audit); runtime-boundary tests.

## User Outcome

A contributor can change the agent harness and receive fast deterministic CI feedback without a running Herdr server, cloud credentials or a paid model.

## Scope Boundaries

- **In Scope:** minimal dependency/import correction; matching lockfiles; explicit automation-unit Moon tasks; Node extension-loading smoke; path-gated three-OS tooling CI foundation reusable by later contracts.
- **Out of Scope:** arbitrary latest-version upgrades, all scripts/integration tests on every PR, pipeline behavior changes, global Pi configuration, live-agent tests, generated-skill updates.

## Acceptance Criteria

### AC-1: The installed dependency graph loads the extensions
**Given** a clean install using the committed dependency manifests and locks,
**When** the Pi registration suite and local tool measurement execute,
**Then** both finish successfully without a missing-module workaround or suppressed loader failure.
**Verification**: `.pi` extension suite and `bun run measure-tools`; add a regression test for the identified import/dependency cause. Record exact Node/Bun/Pi versions.

### AC-2: Production runtime loading is tested
**Given** extensions run in Pi's Node process,
**When** a credential-free Node loader smoke instantiates them against the recording API,
**Then** registration succeeds and a fixture importing a forbidden Bun-only dependency fails the boundary check.
**Verification**: extend `scripts/src/lib/env/runtime_boundary.test.ts` and the registration harness; test valid and invalid fixtures, not just a source grep.

### AC-3: Deterministic tooling checks run in CI
**Given** a PR changes Pi/extensions, the pipeline, Herdr helpers or their task inputs,
**When** CI selects affected tooling tests,
**Then** the deterministic suites run on Linux, native Windows and macOS, failures fail the job, and no live agent/server/cloud service is required.
**Verification**: inspect the resolved Moon task graph and obtain a green three-OS workflow run. Separate unsafe/live tests rather than blanket-enabling every scripts test. Include a deliberately failing fixture in a local workflow-equivalent test to prove exit propagation.

### AC-4: The foundation remains small and reproducible
**Given** a developer follows the documented focused-test command,
**When** they run it twice,
**Then** it selects the same suites without modifying source/configuration or downloading an unpinned tool. Docs-only unrelated changes do not trigger expensive platform work.
**Verification**: final diff/working-tree check and CI path-filter fixtures; record suite duration without imposing a flaky wall-clock unit assertion.

## Edge Cases & Gotchas

- A Node-only extension may pass under Bun while failing in production; both runtimes matter.
- Never patch installed `node_modules` as the durable solution. Pin a compatible release or use a tracked, reviewed package patch if necessary.
- The current automated `validate()` can return a false green; use explicit exit codes and independently run relevant structural checks.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).

## Execution Report

Not executed. No implementation or platform evidence is claimed by this planning document.
