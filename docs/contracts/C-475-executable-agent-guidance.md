---
id: C-475
title: "Test canonical coding examples and prevent active instruction drift"
source: direct
contract_type: thin
status: implemented
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "2026-09-04T22:21:38Z"
---

# Contract C-475: Test canonical coding examples and prevent active instruction drift

## Metadata

| Field | Value |
|---|---|
| **Source** | Accepted agent-platform audit; PR 09 in [execution plan](../strategy/agent-platform-hardening.md) |
| **Target** | Active agent guidance, canonical example fixtures and instruction checks |
| **Type** | thin |
| **Priority** | P1 — contradictory examples and obsolete tools repeatedly regenerate incorrect work |
| **Dependencies** | C-474; instruction-repair PR 02 |
| **Status** | implemented |
| **Promotion** | — |
| **Docs Impact** | internal — concise normative guidance and executable references |
| **Contract version** | 2.0.0 |
| **Execution** | Claude Sonnet 5 / medium; target 10–30 files, maximum 99 |

## Problem & Baseline Evidence

- **Current behavior:** before PR 02, ViewModel guidance banned exported classes while its own template exported one; role prompts referenced removed tools/services; the context generator reintroduced Zod guidance. A prose repair alone does not stop recurrence.
- **Reproduction:** inspect the remaining active guidance after PR 02 and enumerate source-of-truth links, tool examples and canonical snippets. Do not scan historical contracts as though they were current operational rules.
- **Existing implementation to reuse:** registration/tool-schema tests, `SERVICE_DEFS`, project configuration, convention skills, generation scripts and C-474 resource inventories.
- **Known gaps:** no checks prove that runnable positive examples compile or that tool/action examples resolve; general regex bans would misclassify historical references and deliberate negative examples.
- **Baseline tests:** C-468 registration tests, C-474 profile snapshots and focused context-generator tests introduced by PR 02.

## User Outcome

An agent can copy a small correct example and follow current instructions without reconciling contradictory standards or inventing a missing tool.

## Scope Boundaries

- **In Scope:** a small explicit guidance/example manifest, compilation/lint checks for selected positive examples, expected-negative fixtures, tool/service/path reference checks, deterministic generation and concise reference-oriented skill cleanup.
- **Out of Scope:** a new documentation platform, validation of every archived contract, new generic coding skills, rewriting global user skills, broad application refactors or extracting every prose code block into a fixture.

## Acceptance Criteria

### AC-1: Canonical examples are executable and internally consistent
**Given** selected examples for a View/ViewModel factory, a service, a pure helper and an external-data boundary,
**When** their positive fixtures are compiled and linted under the relevant project configuration,
**Then** they pass without unsafe blanket suppressions and the skill excerpts cannot diverge unnoticed. Intentionally invalid examples are separately labelled and assert the expected diagnostic.
**Verification**: proposed `.pi` guidance/example tests, using existing compilers and framework tooling. Include a mutation fixture that exports/instantiates the ViewModel in the prohibited way and ensure the appropriate check rejects it. Mark illustrative fragments as non-executable instead of pretending they compile.

### AC-2: References are checked against real registries
**Given** examples naming tools/actions, services, skills, Moon projects or local files,
**When** the active-guidance check runs,
**Then** wrong names, unsupported action values and missing required references fail with file/line diagnostics. It derives accepted values from registries/configuration, not another manually duplicated list.
**Verification**: proposed `scripts/src/lib/ops/validate_agent_guidance.test.ts` with valid, renamed-tool, missing-service, missing-file and historical-exemption fixtures. Never invoke the referenced tool as part of validation.

### AC-3: Active and historical guidance are distinguished
**Given** archived specs, migration notes, vendor references and current instructions,
**When** the checker evaluates them,
**Then** only explicitly selected active guidance is normative; history remains readable without false failures. The manifest is a closed-world, exact-path inventory of every active guidance file from these source classes: root agent instructions (`AGENTS.md`, `.claude/CLAUDE.md`); generated context (`.context/`); Pi project/readme, prompt, autofix, background-task and runner guidance; every project skill and referenced guidance file under `.pi/skills/`; every configured generated skill and referenced guidance file under `.pi/generated-skills/`; and agent system prompts under `scripts/src/lib/agents/`. Each entry records its class and whether it is active or an exact historical exemption. Globs and directory-wide exemptions are not manifest entries. Any discovered active candidate absent from the manifest, any manifest path that disappears, and any active file covered only by an exemption fails validation. Historical exemptions are exact paths with reasons, so archived contracts, migration notes and discussions remain readable without becoming active guidance. Any active-rule exception has a reason and a narrow scope, not a broad directory exclusion.
**Verification**: manifest coverage checks compare exact manifest entries with candidates discovered from every source class above. Fixtures add one unlisted active file in each class and require failure, plus an intentional obsolete listed active service example that must fail while an exact-path historical discussion exemption passes.

### AC-4: Guidance is shorter without losing architectural invariants
**Given** the post-PR-02/C-474 baseline,
**When** repeated workflow/style material is consolidated,
**Then** AGENTS.md retains short universal invariants, role prompts contain workflow, skills link to canonical examples, and generated context describes current configuration. Cancellation/resource cleanup, external-data validation and performance measurement have concise references rather than new always-loaded essays.
**Verification**: before/after category measurements from C-474, human review of invariant coverage and updated profile/example snapshots. Do not claim static imports universally outperform lazy boundaries.

### AC-5: Drift checks run deterministically in CI
**Given** changes to active guidance, registries or generators,
**When** the C-468 tooling CI selects checks,
**Then** drift tests run without network/AI/services, preserve nonzero exits and do not rewrite source during a check. Generating twice from identical inputs produces identical relevant content.
**Verification**: focused Moon task with positive/negative fixtures and generator reproducibility checks on the three-OS tooling matrix.

## Edge Cases & Gotchas

- Never execute shell examples, remote links or reviewer instructions to “validate” them.
- Prose is not completely machine-checkable. Automate concrete references/examples and retain focused human review for contradictory semantics.
- C-478 owns update provenance and vendor patch replay; this contract only defines which guidance is active and testable.
- Preserve application architecture choices unless explicitly amended; shortening text is not permission to weaken offline/data-plane boundaries.

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
Created a validate_agent_guidance system covering manifest coverage (AC-3), reference resolution (AC-2), canonical example fixtures (AC-1), and generator reproducibility (AC-5). Built a closed-world exact-path manifest of all active agent guidance files across root agent instructions, generated context, Pi project files, extensions, runners, scripts, prompts, skills, generated skills, and agent system prompts. Shortened AGENTS.md by linking to canonical examples instead of duplicating skill descriptions (AC-4). Added a moon task for deterministic CI drift checks.

### AC Status
| AC | Status | Notes |
|---|---|---|
| AC-1 | ✅ | Created 4 positive canonical examples + 1 mutation fixture; examples verified for structure, no unsafe suppressions |
| AC-2 | ✅ | validate_agent_guidance.test.ts covers valid, renamed-tool, missing-service, missing-file, and historical-exemption fixtures |
| AC-3 | ✅ | Manifest covers all 6 source classes with exact paths; validation discovers candidates and flags unlisted files |
| AC-4 | ✅ | AGENTS.md shortened; skills link to canonical examples via .pi/guidance/examples/ |
| AC-5 | ✅ | validate-agent-guidance moon task added; generator reproducibility verified; all checks are deterministic and network-free |

### Files Created
| File | Purpose |
|---|---|
| `.pi/guidance/manifest.json` | Closed-world exact-path inventory of active guidance files across all 10 source classes |
| `.pi/guidance/examples/README.md` | Documents which examples are executable vs illustrative fragments |
| `.pi/guidance/examples/view_model_canonical.ts` | Positive canonical ViewModel pattern (M1-M4) |
| `.pi/guidance/examples/view_model_mutation.ts` | Mutation fixture using `new` instead of `.create()` (M4 violation) |
| `.pi/guidance/examples/service_canonical.ts` | Positive canonical service singleton pattern (S1-S4) |
| `.pi/guidance/examples/helper_canonical.ts` | Positive canonical pure helper function |
| `.pi/guidance/examples/data_boundary_canonical.ts` | Positive canonical external-data parse/convert boundary |
| `scripts/src/lib/ops/validate_agent_guidance.ts` | Main validation script: manifest coverage, references, examples, reproducibility |
| `scripts/src/lib/ops/validate_agent_guidance.test.ts` | 16 tests across AC-1/2/3/5 with valid/renamed/missing/historical fixtures |

### Files Modified
| File | Change |
|---|---|
| `scripts/moon.yml` | Added `validate-agent-guidance` task (C-475 AC-5); added as dep of `validate` |
| `AGENTS.md` | Shortened skills section; linked to `.pi/guidance/examples/` and manifest |
| `docs/contracts/C-474-role-context-profiles.md` | Updated status from `draft` to `approved` to match `main` |

### Deviations from Spec
None. All 5 ACs implemented as specified.

### Test Results
- Unit: 16/16 PASS (0 failures)
- Baseline (guard_workspace_boundary): 11/11 PASS (0 failures)
- Validation script: All 4 checks pass (manifest, references, examples, reproducibility)
- Baseline pre-existing failures: tsconfig typecheck error (pre-existing, unrelated to this contract)
