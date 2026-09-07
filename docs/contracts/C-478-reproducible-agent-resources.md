---
id: C-478
title: "Pin agent resources and make updates reproducible"
source: direct
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: "https://github.com/BearlySleeping/aikami/pull/261"
  pr_number: 261
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
| **Dependencies** | C-468, C-472, C-474, C-475 |
| **Status** | implemented |
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
**Verification**: fixture checkouts exercise a complete match plus independent lockfile-data, `.pi/settings.json`-selection and generated-content mismatches. Where C-472's launch/preflight seam is available (C-472 approved, pending implementation), reuse it; otherwise the implementer builds equivalent fixture-driven identity checks locally without reimplementing full worktree provisioning. Every mismatch blocks reuse and resolves compatible resources or returns explicit preparation instructions.

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

### Summary

The manifest infrastructure (`resource_manifest.ts`, `resource_check.ts`,
`resource_update.ts`, `resource_provenance.ts`) existed on `main`, but
`.pi/resource-manifest.json` itself had every `installed.contentHash` and
`installed.fileCount` left empty at `0`/`""` — `bun run resource-check`
failed with `0 matched, 11 mismatched` because there was nothing real to
compare against. This pass populates real identities for what is currently
installed on disk, without any network fetch or content replacement:
`hashFile`/`hashDirectory` (already implemented, previously just never run
against the live manifest) computed the actual SHA-256 of `.pi/bun.lock` for
every npm-managed resource and of each `generated-skills/<name>` tree for
the git-skill/generated-skill resources. Also removed the stale
`pi-deepseek-optimized` entry — it has no `package.json` entry, no
`bun.lock` entry and no `node_modules` directory; it was superseded by
`pi-deepinfra` and recording a hash for it would have been claiming
verification of a resource that isn't actually installed.

### AC Status

| AC | Status | Notes |
|---|---|---|
| AC-1 | 🚧 Partial | Content hash/file count now accurate for all 10 remaining entries. Git-skill sources (`pixijs`, `daisyui`, `herdr`, `coderabbit`) still record `"revision": "HEAD"` — resolving each to the exact commit that produced the currently-installed tree requires re-cloning and replacing content via `bun run resource-update`, which this pass deliberately did not run (network fetch + content replacement is a materially bigger, less reviewable change than recording what's already on disk; see Deviations). |
| AC-2 | ✅ (pre-existing) | `resource_check.ts` was already read-only/offline; `bun run resource-check` now reports `10 matched, 0 mismatched, 0 missing` instead of failing on every entry. |
| AC-3 | ✅ (pre-existing) | `resource_update.ts`'s stage/validate/backup/restore flow was already implemented and unchanged by this pass. |
| AC-4 | ✅ (pre-existing) | `computeResourceGraphIdentity`/`compareGraphIdentities` were already implemented and unchanged. |
| AC-5 | 🚧 Partial | `resource_provenance.ts`'s report now reflects real, non-empty identities instead of all-empty placeholders. |

### Files Modified

| File | Change |
|---|---|
| `.pi/resource-manifest.json` | Populated `installed.contentHash`/`fileCount` for all 10 real entries from current on-disk content; removed the stale `pi-deepseek-optimized` entry. |

### Deviations from Spec

Git-skill revisions remain `"HEAD"` (unpinned). Pinning them to an exact
commit requires running `bun run resource-update`, which re-clones each
upstream repo and replaces the installed `generated-skills/<name>` content —
a much larger, network-dependent change whose diff size depends on how far
upstream has drifted since the current content was installed. The contract's
own Edge Cases note explicitly warns against a "latest everything" sweep
inflating the diff; recording accurate identity for the content that is
actually installed today was judged the safer, reviewable increment. Running
the real update (or hand-verifying each upstream revision against the
installed tree) is the remaining work for full AC-1 compliance.

### Test Results

- `bun run resource-check` (from `.pi/`): 10 matched, 0 mismatched, 0
  missing, 0 unchecked — was 0 matched, 11 mismatched before this pass.
