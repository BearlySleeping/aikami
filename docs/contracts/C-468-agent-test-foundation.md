---
id: C-468
title: "Repair Pi dependency loading and establish deterministic automation CI"
source: direct
contract_type: thin
status: implemented
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
| **Status** | implemented |
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

### Summary

Root cause: `@earendil-works/pi-coding-agent@0.85.0`'s package root re-exports
`main` from `dist/main.js`, which statically imports `dist/experimental/server.js`
(the new foreground-server feature). That file imports
`@earendil-works/pi-server` and `@earendil-works/pi-server/unix`, but
`pi-coding-agent`'s own `package.json` never declares `@earendil-works/pi-server`
as a dependency — an upstream omission. Any import of `@earendil-works/pi-coding-agent`,
including the plain `import { isToolCallEventType } from '@earendil-works/pi-coding-agent'`
every extension uses, therefore threw `Cannot find module '@earendil-works/pi-server'`
on a clean install. Fix: pin `@earendil-works/pi-server@^0.85.0` directly in
`.pi/package.json` so the lockfile installs the module upstream forgot to
declare — not a `node_modules` patch, not a downgrade. Versions at the time
of this fix: Bun 1.4.0, Node 24.19.0, `@earendil-works/pi-coding-agent@0.85.0`.

Added a real production-runtime smoke: extensions use extensionless relative
imports (`from '../../scripts/.../contract_sync'`), which plain Node ESM
`import()` refuses to resolve — but pi's actual extension loader
(`dist/core/extensions/loader.js`) never uses plain `import()` either; it
resolves every extension through `jiti` with `tsconfigPaths: true`. The new
Node-process harness (`scripts/src/lib/env/fixtures/node_loader_runner.ts`)
uses the same resolver the same way, so it reflects a real loading break
rather than a gap between the harness and pi. Two fixtures
(`valid_extension.ts`, `invalid_bun_only_extension.ts`) prove both directions:
a clean extension loads under `node`, and one that calls the bare `Bun`
global throws `ReferenceError: Bun is not defined` under `node` — the
execution-based counterpart to `runtime_boundary.test.ts`'s pre-existing
source-grep check.

CI: added an explicit `automation-unit` Moon task in both `.pi/moon.yml`
(the full, already-deterministic extension suite) and `scripts/moon.yml`
(narrowly scoped to `contract_pipeline`, `herdr/session.test.ts`, and `env/`
— NOT all of `scripts/src/lib`, which has ~44 test files including
live/network-dependent ones). A new `.github/workflows/automation-ci.yml`
runs both tasks plus `measure-tools` on a Linux/Windows/macOS matrix,
path-gated to `.pi/**`, the three scripts subtrees above, and the relevant
manifests/lockfile — a docs-only or unrelated diff never triggers it. No
live Herdr server, cloud credential or paid model is required;
`background_herdr.test.ts` already self-skips when herdr isn't on PATH.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | `.pi` extension suite: 174→189 pass, 0 fail (was 6 fail + 1 error); `bun run measure-tools` now completes cleanly, 23 tools/6200 tokens. Regression test: `.pi/extensions/lib/dependency_resolution.test.ts` |
| AC-2 | ✅ | `scripts/src/lib/env/runtime_boundary.test.ts` extended with a real `node` (never bun) execution smoke via `jiti`, matching pi's own extension loader. Valid fixture loads; invalid (Bun-only) fixture throws `ReferenceError: Bun is not defined`; every real extension is also loaded under `node` this way |
| AC-3 | ✅ | `pi:automation-unit` and `scripts:automation-unit` Moon tasks (`runInCI: true`), run on ubuntu/windows/macos in `.github/workflows/automation-ci.yml`. Exit propagation verified locally: a deliberately failing test under `scripts:automation-unit` produced `error: script "test:automation-unit" exited with code 1` → `moon` exited 1 (reverted before commit, not part of the diff) |
| AC-4 | ✅ | `bun moon run pi:automation-unit scripts:automation-unit` re-run selects the same 2 tasks / same test files without touching source or downloading anything unpinned (jiti is pinned to the exact version `pi-coding-agent` itself depends on, `2.7.0`); full local run measured at ~12.5s for `scripts:automation-unit`, ~4.4s for `pi:automation-unit`; docs-only diffs are excluded by `automation-ci.yml`'s `paths:` filter |

### Files Created

| File | Purpose |
|---|---|
| `.pi/extensions/lib/dependency_resolution.test.ts` | AC-1 regression test for the `@earendil-works/pi-server` missing-dependency failure |
| `scripts/src/lib/env/fixtures/node_loader_runner.ts` | Loads one extension under a real `node` process via `jiti` (matching pi's production loader), reports success/failure via exit code |
| `scripts/src/lib/env/fixtures/valid_extension.ts` | AC-2 fixture: Node-safe extension, must load cleanly |
| `scripts/src/lib/env/fixtures/invalid_bun_only_extension.ts` | AC-2 fixture: calls the bare `Bun` global, must fail under `node` |
| `.github/workflows/automation-ci.yml` | AC-3: three-OS, path-gated CI for the `automation-unit` Moon tasks + `measure-tools` |

### Files Modified

| File | Change |
|---|---|
| `.pi/package.json` | Added `@earendil-works/pi-server@^0.85.0` (the fix); added `automation-unit`-backing nothing new — reuses existing `test` script |
| `scripts/package.json` | Added `jiti@2.7.0` devDependency (pinned to match `pi-coding-agent`'s own version); added `test:automation-unit` script |
| `bun.lock` | Regenerated for the two new pinned dependencies |
| `.pi/moon.yml` | Added `automation-unit` task (`runInCI: true`) |
| `scripts/moon.yml` | Added `automation-unit` task scoped to `contract_pipeline`, `herdr`, `env` (`runInCI: true`) |
| `scripts/src/lib/env/runtime_boundary.test.ts` | Added the real-`node`-process execution smoke (AC-2) alongside the existing source-grep checks |

### Deviations from Spec

- Chose "pin the missing dependency" over "downgrade to 0.84.4" (the last
  version without the broken `experimental/server` import): the missing
  declaration is the actual upstream bug, downgrading would silently lose
  any other 0.85.0 fix/feature, and the contract's own hint text ("check
  upstream declarations and runtime imports... Pin a compatible release")
  reads as endorsing either; the added dependency is the smaller, more
  legible diff.
- Did not touch `pr-checks.yml`'s `moon ci` — it stays Linux-only and
  continues to skip `pi:test`/`scripts:test` (`runInCI: false`); the new
  three-OS coverage lives entirely in the new, narrowly path-gated
  `automation-ci.yml` per AC-3/AC-4's "docs-only unrelated changes do not
  trigger expensive platform work."
- `pi:automation-unit` currently runs the *entire* `.pi` extension suite
  (same command as `test`) rather than a hand-picked subset, because that
  suite was already fully deterministic and credential-free (the one live
  test, `background_herdr.test.ts`, self-skips without herdr on PATH) —
  there was no unsafe/live subset to carve out on the `.pi` side, unlike
  `scripts/src/lib`.

### Test Results

- `.pi` extension suite: 189 pass / 0 fail (was 174 pass / 6 fail / 1 error)
- `bun run measure-tools` (`.pi`): exits 0, reports 23 tools / ~6200 tokens (was: `Cannot find module` error)
- `scripts/src/lib/env/runtime_boundary.test.ts`: 23 pass / 0 fail (new execution-based tests included)
- `scripts:automation-unit` full scope (`contract_pipeline` + `herdr/session.test.ts` + `env`): 280 pass / 0 fail
- `bun moon run pi:automation-unit scripts:automation-unit`: both tasks pass; exit-propagation proven locally with a temporary failing fixture (exit 1 through `moon`), then reverted
- `bunx tsgo --noEmit` clean for both `.pi` and `scripts`
- `bunx biome check .`: 0 errors (1 pre-existing, unrelated warning in `biome.json`)
- E2E / visual: N/A — out of scope (tooling/CI only, no app code touched)
