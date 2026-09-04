---
id: C-478
title: "Pin agent resources and make updates reproducible"
source: direct
contract_type: thin
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-04T22:21:38Z"
---

# Contract C-478: Pin agent resources and make updates reproducible

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 12 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | `.pi` resource configuration, update scripts and provenance |
| **Type** | thin |
| **Priority** | P1 — floating package/skill updates change agent behavior without a reproducible environment |
| **Dependencies** | C-468, C-474, C-475 |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal — install/check/update workflow and rollback |
| **Contract version** | 2.0.0 |
| **Execution** | DeepSeek V4 Flash / high; target 8–20 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** `.pi/settings.json` contains floating npm/Git resource sources; `update_skills.ts` shallow-clones upstream tips and replaces vendored directories. Committed vendored files are reproducible until update, but the update inputs/provenance are not pinned by that script.
- **Reproduction:** inspect resource sources, existing dependency locks and updater behavior without running an update. C-468's loader failure illustrates the cost of an incoherent installed graph; do not assume all locks are absent.
- **Existing implementation to reuse:** `.pi/package.json`, `.pi/bun.lock`, project package filters, C-474 role choices, C-475 active-guidance checks and existing updater.
- **Known gaps:** exact upstream revision/content identity, reproducible local patches and failure-safe replacement need explicit support; worktree resource resolution must not silently use incompatible root-installed dependencies.
- **Baseline tests:** C-468 loader/registration tests, C-474 profile snapshots and C-475 guidance tests.

## User Outcome

A contributor can reproduce the project's supported agent resources and review an intentional update without inheriting undocumented changes from upstream or another checkout.

## Scope Boundaries

- **In Scope:** exact version/revision selection, resource provenance, deterministic check/update modes, safe staging/replacement, explicit local patch replay and dependency/profile compatibility checks.
- **Out of Scope:** updating every package or vendored skill body, provider-model checkpoint pinning unsupported by the provider, modifying global user resources, network activity during check-only mode, a new package manager.

## Acceptance Criteria

### AC-1: Supported resources resolve to exact inputs
**Given** committed project resource configuration and dependency locks,
**When** the supported install/check flow resolves them,
**Then** each project-managed package/skill source has an exact version or revision plus content/provenance information where appropriate. Project overrides and user-managed resources are distinguished rather than silently conflated.
**Verification**: proposed `.pi/scripts/update_skills.test.ts` and resource-manifest fixtures; record upstream URL/revision, selected paths and content hash. Reuse package locks for packages instead of duplicating their dependency graph.

### AC-2: Check-only mode is read-only and offline
**Given** installed matching resources, mismatches or missing inputs,
**When** a resource check runs,
**Then** it reports exact differences without downloads, file writes, global configuration changes or automatic upgrades.
**Verification**: temporary-directory/network-denial fixtures assert no mutations and meaningful nonzero exits for required mismatches.

### AC-3: Updates are explicit, reviewable and failure-safe
**Given** an explicitly requested version/revision update,
**When** fetching, validation, local patch replay or replacement fails,
**Then** the last working resource remains usable and partial staging is cleaned safely. Successful updates retain C-474 profile choices and pass C-475 guidance/loader checks before replacing the active resources.
**Verification**: local fake-upstream fixtures for successful update, missing path, hash mismatch, patch conflict and interrupted replacement on Linux/Windows/macOS. Tests perform no external fetches.

### AC-4: A worktree does not silently use the wrong resource graph
**Given** a worktree whose resource/dependency identity differs from the root checkout,
**When** its agent runtime is prepared,
**Then** reuse is permitted only when the complete resource-graph identity matches: the relevant committed lockfile data, normalized `.pi/settings.json` package/extension/skill/prompt selections, and hashes of generated resource content selected by that configuration. If any identity input differs or is unavailable, preparation resolves compatible resources for that checkout or fails with explicit commands/instructions; it does not assume a shared node_modules link or generated resource directory is compatible.
**Verification**: fixture checkouts exercise a complete match plus independent lockfile-data, `.pi/settings.json`-selection and generated-content mismatches through the existing C-472 launch/preflight seam. Every mismatch blocks reuse and resolves compatible resources or returns explicit preparation instructions; do not reimplement worktree provisioning.

### AC-5: Provenance and rollback are inspectable
**Given** a recorded run or proposed update,
**When** a maintainer inspects its resource report,
**Then** exact project-managed inputs/profile identity and unmanaged coverage gaps are visible. Document rollback to a previous committed resource set and the tests required before using it.
**Verification**: report snapshots and C-473 run configuration integration. Keep any actual vendor-content update out of this PR if it would inflate the diff; exercise it using small local fixtures.

## Edge Cases & Gotchas

- This PR establishes reproducibility, not a “latest everything” sweep. Preserve the under-100-file limit even if an upstream update would touch hundreds of files.
- Do not destroy an active resource directory before its replacement is validated. Handle Windows file locks and paths without POSIX shell assumptions.
- Upstream instructions are untrusted input; tests validate files/metadata and never execute commands embedded in skill text.

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
