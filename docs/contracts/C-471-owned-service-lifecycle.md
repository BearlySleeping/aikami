---
id: C-471
title: "Own service processes and verify the correct application is ready"
source: direct
contract_type: full
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-04T00:00:00Z"
---

# Contract C-471: Own service processes and verify the correct application is ready

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 05 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | `scripts/src/lib/herdr/session.ts`, process helpers, service tool adapters |
| **Type** | full |
| **Priority** | P0 — restart can terminate unrelated/shared processes and readiness can test the wrong checkout |
| **Dependencies** | C-468, C-470; instruction-repair PR 02; serialize shared orchestration edits |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal — shared service ownership and start/stop semantics |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / high; Opus/high design review; target 10–30 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** voice/image/text use shared ports; restart cleans ports unconditionally. `killPort` identifies “ours” by executable substrings and can fall back to an identity-free kill. `isPortReady` accepts any HTTP response below 500.
- **Reproduction:** with two owned fixture processes, bind the requested port from a foreign process and request restart; it must not be terminated or considered the correct application. Do not run this against real development services.
- **Reuse:** `SERVICE_DEFS`, `resolveReadyPort`, `serviceEnvArgs`, `env/process_info.ts`, current shell quoting and service tests, C-392 shared local-stack topology.
- **Known gaps:** port readiness is not checkout identity; missing workspace can produce an empty failure list; unknown process-info may appear successful for no-port services.
- **Baseline tests:** `scripts/src/lib/herdr/session.test.ts`, `scripts/src/lib/env/process_info.test.ts`, C-468 automation tasks.

## User Outcome

Concurrent developers and contract runs can start or reuse only needed services without interrupting each other or verifying the wrong code.

## Success Measures

No unrelated child process is killed in isolation fixtures; incorrect-checkout and unrelated-404 probes never pass. Repeated ensure-ready calls reuse healthy services instead of restarting them.

## Existing System & Reuse Map

| Capability | Existing source | Action |
|---|---|---|
| Service registry/offsets | `scripts/src/lib/herdr/session.ts` | extend |
| OS process operations | `scripts/src/lib/env/process_info.ts` | retain platform boundary |
| Tool invocation | `.pi/extensions/herdr_orchestrator.ts` | expose accurate results |
| Local AI topology | `apps/backend/local-stack/` | reuse as shared, no model downloads in tests |

## Overview

Distinguish run-owned services from shared infrastructure and externally owned listeners. Model readiness, ownership and requested capabilities explicitly so a healthy shared backend can be reused and an unknown process is never treated as disposable.

## Design Reference

Keep C-392's heavy singleton backends and existing offset-aware frontend servers. See [testing conventions](SHARED_SECTIONS.md#testing-conventions).

## Architecture Directives

Extract registry, ownership/health policy and OS operations into small boundaries where useful; do not rewrite the whole service module first. Ownership evidence includes checkout/run/service identity and PID creation identity or an equivalent owned handle. Executable name alone is insufficient. Persisted ownership records are validated and stale records are diagnostic, not authority to kill a reused PID.

Readiness uses service-specific, instance-bound probes; no production endpoint or sensitive absolute-path disclosure is required. `ServiceDef` must define a probe for every reusable service that accepts the expected checkout/run/service identity and returns evidence carrying the observed instance identity. A TCP connection, `isPortReady`, or an HTTP status below 500 may establish liveness only and cannot authorize readiness or reuse. `assessServicePane` validates the probe evidence against the expected identity and returns `unavailable` when evidence is missing, malformed or mismatched. Consume opaque Herdr IDs from responses. Missing workspace/tab/port/probe data is unavailable, not ready. Shared backends are inspected/reused; only their owner or an explicit maintainer action may restart them.

## State & Data Models

Version an ownership record with service, scope (`run`, `shared`, `external`), instance/run identifier, process identity, port and probe configuration. Health distinguishes starting, ready, failed and unavailable. Readiness evidence is tied to the intended instance, not just a port number; a reusable `ServiceDef` without an identity probe is invalid configuration.

## Quality Requirements

- **Offline/degraded:** local probes; missing optional backend reports an actionable state, not a cloud dependency.
- **Accessibility/input:** N/A — CLI/tool status text remains readable.
- **Performance:** bounded concurrent probes; reuse healthy processes; no default GPU service startup.
- **Security/privacy:** never kill unknown holders; no automatic privilege escalation or global process sweeps.
- **Persistence/migration:** stale ownership records cannot authorize cleanup.
- **Cancellation/retry/idempotency:** cancelled startup cleans only owned children; ensure-ready is idempotent.
- **Observability:** report requested instance, observed state and refusal reason.

## Migration & Rollback

Existing tabs/processes without trustworthy ownership are treated as external/unknown and may be adopted only after explicit identity verification or maintainer action. Reverting new ownership code must not trigger legacy unsafe cleanup; stop run-owned fixtures deliberately before rollback. Preserve shared engines and user workspaces.

## Scope Boundaries

- **In Scope:** service scope/ownership, readiness identity, safe cleanup/restart, required-service selection interface, response IDs and platform tests.
- **Out of Scope:** changing AI engines, Docker topology redesign, port-number migrations unrelated to isolation, production health APIs, upstream Herdr internals or forced updates.

## Contract Size & Split Rule

See [split rule](SHARED_SECTIONS.md#contract-size--split-rule). Start/health/stop share one ownership invariant. Keep model installation and desktop packaging out; maximum 99 files.

## Acceptance Criteria

### AC-1: Foreign and shared listeners are protected
**Given** a foreign node/python fixture or a backend shared by another run,
**When** an ordinary contract requests start/restart/stop,
**Then** no unrelated process is killed; a conflict/reuse result identifies the next safe action. Unknown PID lookup never falls back to blind killing.

### AC-2: Readiness proves the intended instance
**Given** wrong-checkout, unrelated 404, missing workspace/tab, booting, crashed and healthy fixtures,
**When** readiness is evaluated,
**Then** `assessServicePane` passes the expected instance identity to the service's required identity probe and only matching, valid evidence can return ready. Port/TCP/HTTP liveness alone never permits reuse; missing, malformed or mismatched probe evidence returns unavailable and blocks readiness and reuse. No-port processes require the same instance-bound evidence rather than absence of a crash.

### AC-3: Start/restart respects service scope
**Given** a pure-script contract or one requiring only client/hub,
**When** its required services are ensured,
**Then** no optional AI backend starts and healthy instances are reused. Explicit owner restart remains supported.

### AC-4: Cleanup is portable and cancellation-safe
**Given** owned child/grandchild processes and an unrelated listener,
**When** startup fails, cancellation occurs or owned stop is requested,
**Then** owned resources are reaped within configured bounds and the unrelated listener survives on Linux, Windows and macOS.

### AC-5: Herdr failures remain failures
**Given** failed tab creation/rename/run, protocol skew or opaque IDs unlike legacy numbering,
**When** the service controller operates,
**Then** it uses returned IDs, preserves the original diagnostic and never reports success for an uncreated service.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | proposed `herdr/service_ownership.test.ts` | service restart | pending implementation |
| AC-2 | Unit/Integration | `herdr/session.test.ts`, matching/missing/malformed/mismatched instance-probe fixtures for port and no-port services | readiness/reuse | pending implementation |
| AC-3 | Unit | service selection/ensure-ready fixtures | contract preflight | pending implementation |
| AC-4 | Integration | `env/process_info.test.ts`, owned child fixtures | cancellation/stop | pending implementation |
| AC-5 | Unit | fake Herdr response fixtures | service creation | pending implementation |

**Test Hooks:** C-468 tooling matrix on native Windows/macOS/Linux, plus one NixOS lifecycle smoke recorded locally. Browser/visual: N/A unless an instance probe requires a small application smoke; use fixture HTTP servers for policy tests. No actual model downloads.
**Watch Points:** PID reuse; port reuse between lookup and termination; path case/separators; shared backend ownership; HTTP liveness versus application readiness.

## Implementation Sequence

1. Add ownership/readiness fault fixtures around the existing functions.
2. Implement scope-aware ensure/stop/probe operations using existing OS helpers.
3. Wire tool/controller results and run three-OS plus NixOS evidence.

## Edge Cases & Gotchas

Windows process-tree and macOS/BSD behavior must be tested natively; WSL is not Windows evidence. Never stop the main Herdr server or a workspace not created by the fixture.

## Open Questions

None for scope approval. Specific per-service probe implementations are design-review choices subject to the privacy/identity invariant above.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).
