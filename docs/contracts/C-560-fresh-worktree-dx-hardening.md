---
id: C-560
title: "Fresh-worktree DX hardening"
source: "direct"
contract_type: full
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-25T00:00:00+02:00"
---

# Contract C-560: Fresh-worktree DX hardening

## Metadata

| Field | Value |
|---|---|
| **Source** | Direct request: make fresh Herdr/subagent worktrees self-starting, isolated, repeatable, and evidence-producing. |
| **Target** | Worktree bootstrap, subagent control, Moon test preparation, E2E preflight, visual evidence, route safety, and agent guidance. |
| **Type** | full |
| **Priority** | P0 — fresh worktrees currently fail late, collide with other agents, and produce non-repeatable validation/evidence. |
| **Dependencies** | C-471 process ownership; C-526 E2E preflight; C-548 WebGL/entity guards; C-550/C-553 before/after evidence. |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal → AGENTS, project commands, worktree/Emberwatch guidance. |
| **Contract version** | 2.0.0 |
| **Production Surface** | tooling: `bun run worktree:bootstrap`, `bun moon ci --base=origin/main`, `bun run --cwd apps/e2e capture:evidence`. |

## Problem & Baseline Evidence

- **Current behavior:** `createWorktree()` seeds env files and installs dependencies, but does not generate Emberwatch's seven derived artifacts. Manual bootstrap accepts `--no-install`/`--no-seed`, yet has no content phase or clean-generation postcondition.
- **Current behavior:** local Pi subprocesses force `CI=true`, so local Moon actions silently omit `runInCI: false` tasks.
- **Current behavior:** subagent `base` handling prepends `origin/` in some paths and is absent in others; `origin/main`, local `main`, and a SHA do not flow consistently through creation, diffing, and publication.
- **Current behavior:** E2E preflight treats any HTTP listener as reusable and manual worktrees can collide with another Herdr checkout on the canonical ports.
- **Current behavior:** `client:test` and `client:test-unit` concurrently regenerate `.svelte-kit/tsconfig.json`; the fresh-worktree baseline ended with both test actions failing after a directory-mismatch race.
- **Current behavior:** evidence scripts are contract-specific, use `/tmp` by default, and do not provide one persistent manifest/checksum/montage lane.
- **Baseline:** fresh baseline bootstrap completed in `5.639s`. A forced affected `bun moon ci --base=origin/main` completed in `318.643s` with 260 actions, 5 failures: the known duplicate client test-config race plus six timeout-loaded scripts guard CLI cases nested in the failing automation task. `/usr/bin/time` is absent from the active Nix shell, so timing must not depend on GNU time.
- **Existing implementation to reuse:** central `scripts/src/lib/herdr/worktree.ts`, `EMBERWATCH_BUILD_STEPS`, `emberwatch_candidate_plane.ts`, `local_asset_origin.ts`, E2E preflight/server registry, WebGL/entity guards, process ownership registry, and Herdr subprocess supervision.
- **Known gaps:** content cache/clean postcondition, port allocation identity, generic evidence publication, running-agent steering, and route-guard behavioral tests.

## User Outcome

A developer or captain can create a fresh Herdr worktree and move directly through trusted direnv loading, frozen install, generated local content, green affected Moon CI, isolated E2E, and persistent before/after WebGL evidence without hand-editing another checkout.

## Success Measures

- Three consecutive `bun moon ci --base=origin/main` runs complete without test-config directory mismatch.
- Fresh creation-to-green timing is recorded before and after, without GNU `time` or `/bin/bash` assumptions.
- Every worktree creation automatically runs `direnv allow`; generated env content safely quotes repository paths.
- E2E allocates distinct stable ports per linked worktree, never reuses a foreign listener, and terminates only processes spawned by that run.
- Evidence writes a gitignored `.evidence/<contract>/` lane containing WebGL/entity-gated before/after PNGs, `index.md`, SHA-256 checksums, and a montage.
- Route guard allows read-only grep/sed inspection and blocks escaped route paths only for path-mutating commands.

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| Worktree lifecycle | `scripts/src/lib/herdr/worktree.ts` | modify central lifecycle. |
| Emberwatch order | `scripts/src/lib/ops/emberwatch_build_steps.ts` | reuse exact seven-step list. |
| Candidate asset plane | `local_asset_origin.ts`, `emberwatch_candidate_plane.ts` | reuse read-only overlay semantics. |
| E2E lifecycle | `apps/e2e/src/services/preflight.ts` | modify identity/port policy. |
| Visual guards | `visual/core/{gpu_renderer_guard,entity_texture_guard}.ts` | reuse fail-closed predicates. |
| Process ownership | `herdr/instance_registry.ts`, `port_owner.ts` | reuse no-blind-kill policy. |
| Subagent state | `scripts/src/lib/agents/subagents/` | modify message and publication seams. |

## Overview

C-560 hardens the seams between worktree creation and expensive verification. It keeps the existing central lifecycle, adds a cached deterministic content phase, normalizes Git base refs, preserves truthful local CI semantics, isolates E2E by checkout, and publishes evidence through one gitignored lane. It does not alter game architecture, data-plane behavior, or guard policy.

## Architecture Directives

- All worktree content generation must reuse `EMBERWATCH_BUILD_STEPS`; no second ordered list.
- Content cache identity must include the checkout revision, dirty diff, toolchain, and generation inputs. A cache hit must still verify required outputs.
- Bootstrap must prove generation introduced no new Git status entries; pre-existing user changes are preserved and reported.
- Local Pi wrappers may force color and non-interactive Git behavior, but must not synthesize or overwrite ambient `CI`.
- Base refs are normalized once and resolved through Git; `origin/<name>` never becomes `origin/origin/<name>`.
- E2E ownership is per linked checkout. Preflight reuses a listener only when its service identity proves the current checkout; otherwise it starts a checkout-scoped server and never kills the foreign listener.
- Evidence is transactionally replaced under `.evidence/<contract>/`; every PNG passes WebGL and entity-texture checks before publication.
- Route safety is path-argument-aware, not command-string-wide. Read-only regex text is not a filesystem mutation.
- No guard baseline, waiver, or ceiling may be raised.

## State & Data Models

```ts
type ContentBootstrapResult = {
  fingerprint: string;
  cacheHit: boolean;
  steps: string[];
  cleanGeneration: boolean;
  durationMs: number;
};

type EvidenceCapture = {
  lane: 'before' | 'after';
  id: string;
  file: string;
  sha256: string;
  renderer: 'webgl';
  entityTextureFingerprint: string;
};
```

## Quality Requirements

- **Offline/degraded mode:** bootstrap and E2E remain local; no cloud write is introduced. Evidence may read the public published origin but never mutates it.
- **Accessibility/input:** N/A — no player-facing UI.
- **Performance budget:** cache hits avoid all seven generators; fresh-worktree timings are reported.
- **Security/privacy:** direnv trusts only the managed Herdr path; evidence origin binds loopback; no secrets enter manifests.
- **Persistence/migration:** cache and evidence files are gitignored/regenerable.
- **Cancellation/retry/idempotency:** worktree creation rolls back on thrown bootstrap failure; message inbox and evidence publication are atomic/idempotent.
- **Observability:** phase results, identities, checksums, and actionable errors are recorded.

## Migration & Rollback

N/A — no persistent production state. Rollback removes generated gitignored artifacts, cache records, and the `.evidence` lane; source contracts remain additive.

## Scope Boundaries

- **In Scope:** worktree bootstrap/cache/direnv, base refs, local CI env, subagent steering, E2E ports/identity, evidence lane, client/hub test preparation, route guard, portable timing, docs/tests.
- **Out of Scope:** game systems/content policy, release publication, guard policy changes, CI migration to a new orchestrator, and cross-platform native smoke expansion.

## Contract Size & Split Rule

One PR-sized tooling change, fewer than 60 files. Further worktree portability or native CI matrices split into a follow-up.

## Acceptance Criteria

### AC-1: Self-starting content-complete worktree

**Given** a fresh linked Herdr worktree
**When** any central creation path provisions it
**Then** direnv is trusted, dependencies are frozen-installed, all seven Emberwatch steps run or validate a cache hit, and generation introduces no new Git status entries.

**Test Hooks**:
- Moon Task: `bun moon run scripts:automation-unit`
- Integration: fresh detached worktree bootstrap with and without `--no-content`
- E2E / Visual: N/A — worktree provisioning contract.

### AC-2: Normalized Git bases and truthful local CI

**Given** local branch, `origin/branch`, or SHA base input
**When** a subagent creates, diffs, and publishes its worktree
**Then** every Git operation uses the same resolved ref and no `origin/origin` path is produced; local Pi commands do not synthesize `CI=true`.

**Test Hooks**:
- Moon Task: `bun moon run scripts:automation-unit pi:automation-unit`
- Integration: spawn a credential-free read subagent with each accepted base form
- E2E / Visual: N/A — agent control-plane contract.

### AC-3: Isolated, identity-safe E2E

**Given** two linked worktrees and an unrelated listener on a canonical port
**When** E2E preflight runs
**Then** each checkout receives a stable distinct offset, only a listener proven to belong to that checkout is reused, and teardown signals only PIDs spawned by the run.

**Test Hooks**:
- Moon Task: `bun moon run e2e:typecheck`; package test: `bun run --cwd apps/e2e test:unit`
- Integration: two linked checkouts with one foreign listener
- E2E / Visual: focused `/game` Playwright project in the linked worktree.

### AC-4: Persistent before/after evidence

**Given** before and after clients backed by a read-only published seed plus candidate overlays
**When** evidence capture runs
**Then** WebGL and visible-entity texture guards pass, paired PNGs and a montage are written under `.evidence/<contract>/`, and `index.md` + `checksums.sha256` identify every artifact.

**Test Hooks**:
- Moon Task: `bun moon run e2e:typecheck`; package test: `bun run --cwd apps/e2e test:unit`
- Integration: published-only and candidate-overlay loopback origins
- E2E / Visual: production `/game` before/after capture with WebGL/entity guards.

### AC-5: Repeatable Moon validation

**Given** the complete diff in a fresh linked worktree
**When** `bun moon ci --base=origin/main` runs three times
**Then** all three runs are green and no client/hub test-config directory mismatch occurs.

**Test Hooks**:
- Moon Task: `bun moon run client:test client:test-unit hub:test hub:test-unit`
- Integration: three affected Moon CI runs from a mirrored fresh worktree
- E2E / Visual: N/A — validation determinism contract.

### AC-6: Targeted route safety and steering

**Given** grep/sed regex text or a running subagent
**When** the route guard or `subagent.message` is used
**Then** read-only inspection is allowed, escaped route path arguments to `mkdir`/`touch`/`mv`/`cp` are blocked, and running-agent messages are durably queued for the same session.

**Test Hooks**:
- Moon Task: `bun moon run pi:automation-unit scripts:automation-unit`
- Integration: queue steering while a fake supervised run is active
- E2E / Visual: N/A — local command-safety contract.

### Evidence Matrix

| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration + unit | `scripts/src/lib/herdr/worktree_content.test.ts` | tooling: `bun run worktree:bootstrap -- --cwd <path>` | ✅ seven-step generation, cache hit, and `--no-content` verified |
| AC-2 | Unit | `git_worktree.test.ts`, `subagents.test.ts`, `process_runner.test.ts` | tooling: `bun moon run scripts:automation-unit` | ✅ normalized bases, ambient `CI`, and durable steering covered |
| AC-3 | Unit + E2E | `port_allocation.test.ts`, `preflight.test.ts`, `server_registry.test.ts` | tooling: `bun run --cwd apps/e2e test:unit` | ✅ allocator, capability-aware identity, trusted ownership, and focused boot green; universal legacy sweep deferred |
| AC-4 | Unit + visual | `.evidence/C-560/{before,after,montage.png,index.md,checksums.sha256}` | tooling: `bun run --cwd apps/e2e capture:evidence` | ✅ real guarded capture; 5/5 checksums valid |
| AC-5 | Integration | three Moon CI logs and timing table | tooling: `bun moon run :validate` | ✅ three final affected CI passes green |
| AC-6 | Unit | `route_guard.test.ts`, `subagents.test.ts` | tooling: `bun moon run pi:automation-unit` | ✅ route policy and same-session steering covered |

## Implementation Sequence

1. Add centralized ref/content/bootstrap helpers and tests.
2. Normalize subagent bases, remove forced CI, and add durable steering.
3. Add checkout-scoped E2E ports/identity and fix offset consumers.
4. Add persistent evidence publication helpers/CLI.
5. Make client/hub test preparation a single Moon dependency.
6. Narrow route guard, update guidance, then run validation/timing/evidence.

## Edge Cases & Gotchas

- Bootstrap cache must never copy a complete directory over unrelated user output.
- A dirty worktree may retain pre-existing edits; only newly introduced status is a generation failure.
- `moon ci` intentionally applies CI filters even after local Pi no longer sets `CI`; use `moon run` for local-only tasks.
- Evidence publication must stage then rename so a failed capture never leaves a seemingly complete old/new mixed lane.

## Open Questions

None.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| 2.0.0 | 2026-09-25 | Initial direct contract | user (direct request) |

---

## Execution Report

### Baseline timing

Environment: NixOS x86_64; Bun 1.4.0; Node 24.20.0; Moon 2.5.5; Git
2.55.0; Herdr 0.9.1. Timings use wall-clock milliseconds and include creation
through the requested validation boundary. GNU `time` is not installed and is
not a repository dependency.

| Fresh-worktree phase | Baseline | Result |
|---|---:|---|
| Create detached `~/.herdr/worktrees/aikami/*` checkout | 1.739s | 1.739s |
| Seed env + frozen install | 5.639s | not re-run in the final timing pass (`--no-install` used after the install was verified) |
| Affected `bun moon ci --base=origin/main` | 318.643s, red | 37.933s / 38.465s / 35.164s, all green |
| Creation → validation boundary | 326.021s, red | phase timings recorded below; no single combined install+CI rerun |

The baseline CI run executed 260 actions and failed five tasks. Its terminal
`client:test` / `client:test-unit` pair reproduced the known concurrent
`.svelte-kit/tsconfig.json` directory mismatch; the loaded scripts automation
lane also hit six implicit five-second guard-CLI timeouts. No source change was
present during the baseline run.

### Final implementation timing

All wall-clock measurements below use Bun's monotonic `performance.now()` around
the spawned command. No GNU `time` or `/bin/bash` assumption is involved.

| Boundary | Result |
|---|---:|
| Fresh content bootstrap, `--no-install`, seven generators | 10.549s |
| Warm content bootstrap, cache hit | 0.698s |
| Intentional tool-only bootstrap, `--no-content` | 0.457s |
| `bun moon run :validate` final pass | 13.519s (174 tasks, 119 cached) |
| `bun moon ci --base=origin/main` run 1 | 37.933s, green |
| `bun moon ci --base=origin/main` run 2 | 38.465s, green |
| `bun moon ci --base=origin/main` run 3 | 35.164s, green |

The final bootstrap preserved all 59 pre-existing status entries and introduced
no new status entries. The warm run executed zero generation steps. The three
final Moon CI passes each completed 54 actions with two intentional skips and
exit code 0; the first pass included the cold automation/browser work, while
later passes reused valid Moon results.

### Acceptance criteria status

| AC | Status | Evidence |
|---|---|---|
| AC-1 | ✅ | `worktree:bootstrap --no-install` generated all seven Emberwatch steps; the second run was a verified cache hit; `--no-content` and content tests pass. |
| AC-2 | ✅ | Git base normalization, `origin/<name>` handling, SHA handling, truthful ambient `CI`, and durable steering are covered by scripts/Pi automation tests. |
| AC-3 | ⚠️ | Allocator, capability-aware endpoint/ownership probes, trusted detached process-group + cwd proof, exact PID creation-identity recording, cleanup scoping, and focused game boot tests pass. Universal migration of legacy client/visual canonical-port consumers remains deferred to stay below the 60-path cap. |
| AC-4 | ✅ | `.evidence/C-560/` was recaptured after the final preflight refactor; it contains paired guarded PNGs, montage, manifest, index, and checksums, with 5/5 checksums valid. |
| AC-5 | ✅ | Three final consecutive `bun moon ci --base=origin/main` runs are green after the shared `test-prepare` dependency was added. |
| AC-6 | ✅ | Route-guard policy tests and durable same-session steering tests pass. |

### Verification results

- `bun moon run scripts:automation-unit`: **1,139 pass, 0 fail** across 65 files.
- `bun moon run pi:automation-unit`: **460 pass, 0 fail** across 22 files.
- `CI=true bun run --cwd apps/e2e test:unit`: **72 pass, 0 fail** across 4 files.
- Concurrent `client:test` and `client:test-unit`: **4,104 pass, 0 fail, 7 skip,
  2 todo** in each lane; the shared cached `test-prepare` task serialized the
  SvelteKit config writers.
- Concurrent `hub:test` and `hub:test-unit`: **260 pass, 0 fail** in each lane.
- `bun moon run e2e:test-game -- tests/game/engine_boot_check.spec.ts --workers=1`:
  **1 passed**; preflight started the checkout-scoped client on port **13,524**.
- `bun moon run e2e:test-site -- tests/site/site_pages.spec.ts --workers=1`:
  **12 passed** across Chromium/mobile; real ownership-mode preview startup and
  teardown succeeded on the checkout-scoped site port.
- `bun moon run :validate`: **174 tasks completed, 0 failed**.
- Combined post-import `bun moon ci --base=origin/main`: **54 actions,
  0 failures** (44.210s wall clock).
- `bun run scripts/src/lib/ops/run_guards.ts`: **10/10 structural guards passed**.
- `git diff --check`: passed.
- Evidence SHA-256 verification: **5/5 artifacts passed**.

### Evidence publication

The gitignored lane is `.evidence/C-560/` (recaptured at
`2026-09-25T02:07:33.772Z` after the final preflight refactor):

- `before/evidence.png` and `after/evidence.png` — production `/game` captures.
- `montage.png` — deterministic paired montage.
- `manifest.json` — renderer `webgl`, entity guard
  `visible-entity-textures-v2`, no page errors, read-only local origins, and
  before/published versus after/candidate provenance.
- `index.md` and `checksums.sha256` — human-readable and machine-verifiable
  indexes.

Temporary capture clients (`14524`/`14525`) and loopback asset origins
(`18808`/`18809`) were stopped after capture; no evidence-owned process remains.

### Files and scope

The C-560 implementation itself was **59 changed paths** (52 tracked paths
and 7 new files), below its original 60-path limit. The requested import from
root `main` adds four net paths (the two `cost_guard` files, two
`budget_state` files, plus the required guidance-manifest entry; the overlapping
`project-commands` guidance was merged), making the combined PR branch **64
changed paths**. Main implementation groups are:

- Worktree lifecycle/content/direnv: `scripts/src/lib/herdr/worktree.ts`,
  `worktree_bootstrap.ts`, `worktree_content.ts`, `worktree_environment.ts`,
  and the direnv configuration example.
- Git/subagent control plane: `scripts/src/lib/agents/git_worktree.ts`,
  `scripts/src/lib/agents/subagents/*`, and Pi process/route extensions.
- E2E isolation/evidence: `apps/e2e/src/services/port_allocation.ts`,
  `preflight.ts`, `server_registry.ts`, `service_map.ts`, evidence helpers,
  and the production-route capture CLI.
- Repeatable test preparation: client/hub `moon.yml` and package scripts.
- Guidance and contract: `AGENTS.md`, project-command guidance, and this
  contract.

### Deviations and follow-up boundaries

- The full historical `e2e:test-game --workers=1` suite still contains
  unrelated legacy gameplay assertion/timeout failures; the production boot
  check required by this contract is green.
- AC-3's allocator and preflight are green, including capability-aware endpoint
  versus ownership dispatch, detached group-leader + expected-cwd proof, exact
  PID creation-identity recording, and startup identity verification. A
  follow-up should migrate the remaining client POM/spec/visual literals to
  `EMULATOR_PORTS` and add a checkout identity route to the Wrangler hub worker
  before claiming universal E2E reuse across every historical lane. That sweep
  is deliberately deferred: it adds roughly 14–15 paths and would exceed the
  explicit 59-path PR budget.
- No commit, push, or PR was created.
