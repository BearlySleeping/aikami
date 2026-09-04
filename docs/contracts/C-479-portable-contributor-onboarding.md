---
id: C-479
title: "Verify credential-free contributor onboarding across Linux, macOS and Windows"
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

# Contract C-479: Verify credential-free contributor onboarding across Linux, macOS and Windows

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 13 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | `scripts/src/lib/local_setup/index.ts`, local environment setup, `flake.nix`, `.envrc` and setup guidance |
| **Type** | full |
| **Priority** | P1 — setup must be a verified contributor path, not knowledge specific to the maintainer's machine |
| **Dependencies** | C-471, C-472, C-478 |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal/contributor-facing — setup guide and task-specific prerequisites |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / high; target 10–30 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** `docs/intro/setup.md` advertises a Bun-only path but also contains outdated service/port/prerequisite claims and says macOS is untested. Maintainer Nix/direnv state can conceal missing dependencies or unsafe environment assumptions.
- **Reproduction:** follow the guide in a fresh isolated home/checkout without maintainer keys or global agent configuration. Inspect actual `setup:env`, Moon toolchain and local setup entrypoints before promising that a command is credential-free.
- **Existing implementation to reuse:** local setup checks, `scripts/src/lib/env/` helpers, SOPS tooling, `.bun-version`, `.moon/toolchains.yml`, flake/direnv, C-468 platform matrix and C-478 resource checks.
- **Known gaps:** native Windows without Git Bash, macOS/BSD differences, noninteractive modes and NixOS browser/loader behavior need explicit evidence. C-449 AC-4 owns maintainer Cloudflare/SOPS onboarding; do not duplicate that scope.
- **Baseline tests:** existing setup/env/process tests, C-468 automation targets and the documented install/dev commands in isolated fixtures.

## User Outcome

A new developer can prepare local configuration, run the client and execute a focused check without paid AI, cloud credentials or adopting the maintainer's entire environment. Maintainers retain a pinned Nix/direnv workflow.

## Success Measures

Documented minimal commands work on fresh Linux, macOS and native Windows with the stated prerequisites. No real secrets or privileged setup are required. NixOS-specific smoke evidence is recorded separately; failure reports name the missing prerequisite and next safe action.

## Existing System & Reuse Map

| Capability | Existing source | Action |
|---|---|---|
| Machine checks | `scripts/src/lib/local_setup/index.ts` | extend/reconcile |
| Runtime/platform detection | `scripts/src/lib/env/` | reuse |
| Preferred toolchain | `flake.nix`, `.envrc`, `flake.lock` | preserve and verify |
| Local configuration | current `setup:env` implementation and examples | make safe offline/local behavior explicit |
| Maintainer secrets | existing SOPS tooling; C-449 AC-4 | link, do not reimplement |

## Overview

Separate minimal contributor, optional local-AI/desktop/agent and maintainer-cloud setup. Make diagnosis read-only and application of local setup explicit, repeatable and non-destructive. Prove the supported paths with fresh-environment tests rather than documentation claims alone.

## Design Reference

Use existing task-specific capability checks and cross-platform process boundaries. See [testing conventions](SHARED_SECTIONS.md#testing-conventions) and the [platform evidence matrix](../strategy/agent-platform-hardening.md#platform-and-environment-evidence).

## Architecture Directives

Minimal setup requires Bun and Git plus accurately declared task-specific system dependencies, not Pi/Herdr, Nix, Docker, GPU models, SOPS keys or cloud login. A read-only doctor/check mode reports capabilities and safe instructions; it never installs tools, restarts services, decrypts secrets or edits global settings. Local setup preserves customized values and emits only safe development configuration.

Keep Nix/direnv preferred and pinned. Match declared Bun/tool versions and environment propagation across Nix, CI and native installs. Do not silently let Moon download a different toolchain. Native Windows PowerShell must work without Git Bash; use argv-based runtime helpers rather than shell-only copy/sed/export recipes. Explicitly separate credential-free local config from maintainer decryption/deployment.

No live cloud changes or sudo/elevation are authorized by this contract. First-run dependency downloads may be required and must be documented; offline runtime smoke is tested after dependencies are installed, not falsely advertised as offline installation.

## State & Data Models

Version or document machine-readable doctor output containing capability, status, observed version and suggested remediation. Local environment files remain user-owned: distinguish generated defaults from customized values, never overwrite secrets, and keep examples non-sensitive. No application/save schema migration is involved.

## Quality Requirements

- **Offline/degraded:** after dependency installation, local config and focused local runtime/checks require no cloud or model service.
- **Accessibility/input:** readable CLI plus machine output; noninteractive mode cannot hang on a prompt.
- **Performance:** record cold setup and warm check durations; avoid optional backend startup and repeated downloads.
- **Security/privacy:** no global mutations, privilege escalation, credentials in logs or automatic secret decryption.
- **Persistence/migration:** preserve existing local configuration; back up only changed generated files when needed.
- **Cancellation/retry/idempotency:** interrupted local setup can be rerun safely without half-written config.
- **Observability:** distinguish required/missing, optional/unavailable and failed capabilities with exact remediation.

## Migration & Rollback

Keep existing entrypoints compatible or provide a clear deprecation message. Local setup is additive and preserves user values. Document how to restore any generated local files changed by the new flow; never delete a contributor's personalized environment to recover. Roll back flake/config changes via Git without invalidating unrelated worktrees.

## Scope Boundaries

- **In Scope:** minimal contributor bootstrap, read-only doctor, safe local config, Nix/native parity, prerequisite docs and three-OS/fresh-home smoke tests.
- **Out of Scope:** C-449 maintainer credential enrollment, cloud provisioning, upstream Herdr fixes, full desktop/GPU build matrices, distributing the application, new package managers or mandatory dev containers.

## Contract Size & Split Rule

See [split rule](SHARED_SECTIONS.md#contract-size--split-rule). One contributor-entry outcome. Link to optional task-specific setup rather than rebuilding it; maximum 99 files.

## Acceptance Criteria

### AC-1: Minimal bootstrap is credential-free
**Given** a fresh checkout/home and documented Bun/Git/system prerequisites with no cloud/AI keys,
**When** the minimal install/local-config/dev/focused-check sequence runs,
**Then** the local application starts at the documented address and the focused check exits successfully without requiring optional agents, models, Docker, Nix or maintainer credentials.

### AC-2: Doctor/check mode is safe and actionable
**Given** complete, incomplete, malformed and unsupported environments,
**When** doctor/check runs interactively or in CI,
**Then** it emits accurate capability/version results, fails for missing required prerequisites, distinguishes optional ones, and performs no installation, secret access, service mutation or global config edit.

### AC-3: Local configuration is idempotent
**Given** missing defaults, customized values, pre-existing secret files or interrupted previous setup,
**When** local setup is applied repeatedly,
**Then** safe missing defaults are supplied, custom/secret values remain intact, partial writes are recoverable and logs redact sensitive data.

### AC-4: Native platform and Nix paths are proven
**Given** Linux, macOS, native Windows/PowerShell and the preferred Nix/direnv workflow,
**When** supported bootstrap/doctor/runtime smokes execute,
**Then** paths, environment variables, process cleanup and tool versions behave correctly without assuming GNU utilities or Git Bash. Actual NixOS evidence separately covers configured browser/native-loader handling.

### AC-5: Documentation matches verified capabilities
**Given** the resulting setup commands and CI/local evidence,
**When** a contributor reads the guide,
**Then** prerequisites, ports, supported OS versions/architecture and optional tiers match observed behavior. Unsupported desktop/GPU/CPU combinations are labelled rather than implied tested; maintainer cloud setup links to C-449's existing scope.

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | Integration | proposed `scripts/src/lib/local_setup/bootstrap.test.ts` and fresh-home smoke logs | contributor setup | pending implementation |
| AC-2 | Unit/Integration | proposed `local_setup/doctor.test.ts` | read-only diagnosis | pending implementation |
| AC-3 | Integration | local-config preservation/interruption fixtures | setup:env | pending implementation |
| AC-4 | Integration | three-OS tooling CI and actual NixOS smoke record | native/Nix setup | pending implementation |
| AC-5 | Documentation/Integration | verified setup guide and C-475 reference checks | contributor instructions | pending implementation |

**Test Hooks:** reuse C-468's path-gated tooling matrix, add fresh-home/bootstrap jobs only when setup/toolchain files change. Local application HTTP/behavior smoke is required; visual-model scoring is N/A. Optional desktop/GPU checks remain separate. Record unavailable platform evidence honestly and do not mark that AC verified.
**Watch Points:** ambient credentials masking dependencies; HOME changes damaging real config; Windows paths/CRLF; Nix-installed binaries not matching native versions; old examples leaking retired services.

## Implementation Sequence

1. Capture fresh-environment failures and document capability tiers from actual commands.
2. Implement safe doctor/local setup and correct Nix/native toolchain propagation using existing helpers.
3. Run native three-OS and NixOS smokes; update instructions from the verified results.

## Edge Cases & Gotchas

Tests use disposable homes/checkouts and test-owned processes, never the user's running Herdr server or personal shell profile. Non-Nix macOS support must not be inferred from a Linux Nix check. Keep secret decryption out of a command advertised as credential-free.

## Open Questions

None for scope approval. Tested OS releases/architectures are recorded from the actual validation matrix; untested combinations are not implicitly supported.

## Amendments

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle).

## Status Lifecycle

See [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle).
