---
id: C-476
title: "Close strictness coverage gaps without a repo-wide cleanup"
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

# Contract C-476: Close strictness coverage gaps without a repo-wide cleanup

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 10 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | Biome/TypeScript configuration and structural/type-safety guards |
| **Type** | thin |
| **Priority** | P1 — advertised strictness is not enforced on important agent-written code |
| **Dependencies** | C-469, C-475 |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | internal — rule/enforcement/exception matrix |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / medium; target 10–40 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** `biome.json` excludes `*.svelte.ts`; explicit-any/naming rules are broadly disabled for scripts/Pi/E2E; `guard_type_safety.ts` does not scan `.pi`. TypeScript strict mode alone does not forbid explicit any.
- **Reproduction:** inspect effective configurations and run small fixtures containing explicit any, double assertions, unsafe suppression and rune-bearing TypeScript. Determine why the Svelte exclusion exists before removing it.
- **Existing implementation to reuse:** Biome, existing ratchet guards/baselines, strict base config, C-469 check policy and C-475 canonical examples.
- **Known gaps:** per-file counts can hide replacement violations; baseline/suppression edits need a review signal; global stronger TS flags could otherwise cause an uncontrolled migration.
- **Baseline tests:** current guard suites, canonical examples and affected lint/typecheck tasks; capture existing violations before changing enforcement.

## User Outcome

New agent-generated code is checked against the claimed standards, while legacy debt is explicit and cannot grow invisibly.

## Scope Boundaries

- **In Scope:** coverage audit/matrix, new-code strictness for uncovered areas, safe Svelte-TypeScript lint coverage, narrow reviewed exceptions, monotonic baseline validation and small representative fixes.
- **Out of Scope:** fixing all existing violations, adding Prettier/ESLint, mass application rewrites, blanket flags that force 100+ changed files, changing business behavior or the alias migration from docs/TODO.md.

## Acceptance Criteria

### AC-1: Every required rule has a known enforcement boundary
**Given** current instructions and effective lint/typecheck/guard configuration,
**When** the coverage audit is generated,
**Then** it identifies which source/test/tooling categories enforce each correctness/style rule and names exceptions with reasons. No rule is described as universally enforced while entire relevant source categories are skipped.
**Verification**: commit a concise matrix linked from conventions; fixture tests prove at least explicit-any, unsafe-cast, suppression and architectural-boundary checks in app, scripts and Pi paths.

### AC-2: Rune-bearing TypeScript is not a blanket blind spot
**Given** representative valid `.svelte.ts` files and deliberate invalid fixtures,
**When** the chosen existing parser/linter path checks them,
**Then** valid rune syntax is accepted and relevant violations are detected. If the pinned Biome version cannot parse a construct, document a narrowly tested exception and use the existing compiler/structural guard for that construct rather than excluding every `.svelte.ts` file.
**Verification**: positive/negative fixture suite plus representative current files; run existing Svelte typecheck. Do not pass by stripping away code containing the violation.

### AC-3: Pi/scripts no longer acquire unchecked new unsafe typing
**Given** a new explicit-any or unsafe assertion in production tooling,
**When** changed-code enforcement runs,
**Then** it fails unless a narrowly reviewed boundary exception applies. Test mocks are not a reason to disable checks for the entire directory. Keep legitimate console output in CLI code; do not conflate CLI and Pi TUI logging rules.
**Verification**: include `.pi` in appropriate checks; fixtures distinguish production code, narrowly exempt interop and test-only cases. Record any minimal cleanups separately from configuration changes.

### AC-4: Baseline and suppression growth is visible and controlled
**Given** an existing baseline and a PR adding a violation, changing its identity, adding suppression, disabling a check or skipping a required test,
**When** CI evaluates the policy diff,
**Then** unauthorized weakening fails or requires an explicit reviewer-approved exception recorded in the PR. Moving a violation within an allowed per-file count cannot silently create a new allowance.
**Verification**: baseline comparison tests against the merge base, including same-count replacement, deletion, new suppression and approved narrow exception. Bootstrap any new baseline with an explicit reviewed debt inventory, never an unreviewed “accept current” command.

### AC-5: Adoption remains incremental and verifiable
**Given** existing debt and optional stronger flags such as `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`,
**When** this PR establishes new-code enforcement,
**Then** the changed scope stays below 100 files, all new checks have negative tests, and broader flag adoption is either proven in a bounded clean area or explicitly deferred. No existing mandatory check is weakened to make this task pass.
**Verification**: C-469 validation plan, C-475 examples, guard tests and actual changed-file count; report remaining debt and any proposed follow-up rather than marking it fixed.

## Edge Cases & Gotchas

- Ratchets need stable diagnostic identities that tolerate ordinary line movement but not new violations; prefer parser/diagnostic evidence over brittle string counts.
- An agent cannot approve its own new exemption. Document the existing review mechanism; do not invent a secret CI bypass.
- No repo-wide generated baseline or mass format sweep solely to meet a new stylistic preference.

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
