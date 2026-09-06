---
id: C-492
title: "Own the managed engine process lifecycle without touching external servers"
source: "Split of C-482 into PR-sized contracts; AI setup execution plan queue row R04"
contract_type: thin
status: approved
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-06T03:20:00Z"
---

# Contract C-492: Owned process lifecycle, ports and on-demand restart

## Metadata

| Field | Value |
|---|---|
| **Source** | [C-482](C-482-managed-ai-runtime-lifecycle.md) native lifecycle; queue row R04 |
| **Target** | Tauri sidecar lifecycle modules and the client runtime service |
| **Type** | thin |
| **Priority** | P1 — stopping a player's own Ollama would be a serious regression |
| **Dependencies** | C-491 |
| **Status** | approved |
| **Promotion** | — |
| **Docs Impact** | internal → none |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: the app can start a managed engine, but ownership is not a first-class fact, so an externally installed server and an app-owned one are not clearly distinguished.
- **Reproduction**: run an external Ollama on the default port, then have the app start its managed engine, and observe port and ownership handling.
- **Existing implementation to reuse**: existing sidecar service and runtime endpoints.
- **Known gaps**: port conflict resolution is undefined; restart does not provably return the same owned process and model.
- **Baseline tests**: sidecar and runtime-config tests.

## User Outcome

After this contract, a player who already runs their own AI server keeps full control of it, while the app manages only what it installed itself — and restarting brings back the right engine and model.

## Scope Boundaries

- **In Scope:** explicit ownership of managed processes; start, stop and on-demand restart for owned processes only; port conflict detection and visible failure; argument and artifact-ID validation for native commands.
- **Out of Scope:** provisioning integration (C-493), arbitrary `shell` or `http` scope widening, automatic Docker installation, and UI presentation (C-500).

## Acceptance Criteria

### AC-1: External servers are never controlled
**Given** an externally installed and running engine
**When** the app manages its own runtime
**Then** the external process is never started, stopped, reconfigured or deleted, and disconnecting from it removes only the app's connection.

**Verification**: ownership fixtures asserting zero lifecycle calls against external processes.

### AC-2: Port conflicts fail visibly
**Given** the owned engine's port already in use
**When** the app starts its engine
**Then** the conflict is detected and surfaced rather than silently taking over or failing opaquely. If a dynamic port is used it comes from a reviewed bounded range with a validated sidecar argument list, not a widened scope.

**Verification**: occupied-port fixture; assert a typed visible failure and no scope widening.

### AC-3: Restart returns the correct process and model
**Given** an owned engine previously running a specific model
**When** the app restarts it on demand
**Then** the same owned process and model are restored.

**Verification**: restart tests asserting process identity and loaded model.

### AC-4: Native commands validate their inputs
**Given** a native lifecycle command
**When** it receives catalog artifact IDs, paths or operation arguments
**Then** each is validated before use, and an invalid value is rejected.

**Verification**: invalid-ID, invalid-path and invalid-argument cases per command.

## Edge Cases & Gotchas

- **Ready is not running**: a stopped owned engine can be ready-to-start without being Running. Process state must come from runtime observation, never from configuration presence or a connectivity check.
- **Premium check**: C-482 asks for an independent check at this slice; packaged-runtime behavior is not proven by mocks.

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)
