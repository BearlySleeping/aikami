# Contract C-315: Define a Versioned Campaign Content Pack and Atomic Loader

## Metadata

| Field | Value |
|---|---|
| **Source** | TODO.md — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Target** | shared TypeBox content-pack schema, authored pack directory, — TBD |
| **Priority** | P0 — production currently hardcodes a sandbox map while content — Phase 1 — Playable, Polished, Offline-Capable Vertical Slice |
| **Dependencies** | C-135, C-136, C-138, C-175, C-210, C-243, C-313, C-314. |
| **Status** | draft |
| **Promotion** | — |
| **Docs Impact** | TBD |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: Define a Versioned Campaign Content Pack and Atomic Loader — see TODO.md for details.
- **Reproduction**: {steps to reproduce the issue or observe the gap}
- **Existing implementation to reuse**: {paths to code that already partially solves this}
- **Known gaps**: {what the existing code does NOT handle}
- **Baseline tests**: {existing tests that cover related areas — run them before starting}

## User Outcome

After this contract, a {player\|creator\|developer} can ...

## Success Measures

- **Time/latency target**: {e.g. "game start under 3s", "response under 500ms"}
- **Offline/degraded behavior**: {what happens when AI/network is unavailable}
- **Production journey enabled**: {the real user flow this unlocks — e.g. "player can create a character and enter the game world"}

## Existing System & Reuse Map

| Capability | Existing source | Reuse / modify / replace |
|---|---|---|
| {capability} | `{file path or contract}` | {reuse \| modify \| replace} |

## Overview

one manifest describes maps, spawn, NPCs, dialogue fallbacks,

## Design Reference

{Existing patterns in the repo to follow. Reference specific files, packages, or previous contracts.}

> 📋 Testing conventions: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#testing-conventions)

## Architecture Directives

{Use domain-level names and logical paths. Let Pi decide exact file placement based on its aikami-conventions skill.}

## State & Data Models

{Describe the data shape conceptually. Use TypeScript `type` aliases, JSON shapes, or ECS component structures — never `interface`. TypeBox schemas go in `packages/shared/schemas/`; derived types in `packages/shared/types/`. Use fenced code blocks with language tags.}

## Quality Requirements

Check each that applies. Use "N/A — reason" when genuinely irrelevant.

- **Offline/degraded mode**: {what happens without network/AI}
- **Accessibility/input**: {keyboard nav, screen reader, input method coverage}
- **Performance budget**: {frame budget, load time, memory limit}
- **Security/privacy**: {auth requirements, data exposure, input sanitization}
- **Persistence/migration**: {state survives reload, old data compatible}
- **Cancellation/retry/idempotency**: {operations can be safely retried or cancelled}
- **Observability**: {logging, error reporting, metrics}

## Migration & Rollback

If this contract changes persistent state (schemas, save format, routing, providers):

- **Old data compatibility**: {how old saves/data are handled}
- **Migration**: {steps to migrate existing data}
- **Rollback**: {steps to undo if deployment fails}
- **Feature flag or kill switch**: {how to disable without redeploying}
- **Failure recovery**: {what happens if migration fails mid-way}

If no persistent state is affected: "N/A — no persistent state changes."

## Scope Boundaries

- **In Scope:** {Bullet list of exactly what this contract covers}
- **Out of Scope:** {Bullet list of what NOT to touch. Use this to protect unrelated systems.}

## Contract Size & Split Rule

> 📋 Split rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#contract-size--split-rule)

**For this contract:**

## Acceptance Criteria

### AC-1: {Scenario Name}
**Given** {precondition — what state the system is in}
**When** {action — what happens}
**Then** {expected outcome — what should be true}

**Evidence Matrix**:
| AC | Test Level | Required Artifact | Production Path | Evidence |
|---|---|---|---|---|
| AC-1 | {Unit \| Integration \| E2E \| Visual} | `{test file path}` | {N/A \| `/game/...`} | Filled during verification |

**Test Hooks**:
- Moon Task: {specific `moon_run_task` command to validate this}
- Integration: {what integration test or manual browser check to run}
- E2E / Visual:
    - **Functional**: {If functional E2E: Specify the Playwright spec file (e.g., `tests/client/feature.spec.ts`), the test cases, and any POMs needed. If not functional, state "N/A".}
    - **Visual**: {If visual: Specify the suite file (`suites/feature.visual.ts`), the declarative test cases (name, route, searchParams), the TypeBox schema shape, and the OpenRouter AI evaluation prompt/criteria (e.g., "Score 90+: Two LPC sprites visible, facing correct directions"). Use `defineConfig` + `export default` pattern. If not visual, state "N/A".}

**Watch Points**:
- {edge case or gotcha specific to this AC}

## Implementation Sequence

1. **Phase 1 (Data/Logic)**: {Describe what to build first}
2. **Phase 2 (Integration)**: {Describe how to wire it in}
3. **Phase 3 (Validation)**: {Run `validate()` and specific Moon tasks}

## Edge Cases & Gotchas

- **{Scenario}**: {what to watch for and how to handle it}

## Open Questions

Must be resolved before status becomes `approved`:

- {question}

## Amendments

Changes to ACs or scope require a version bump and user approval.

| Version | Date | Change | Approved by |
|---|---|---|---|
| — | — | — | — |

## Promotion Lifecycle

> 📋 Promotion states: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#promotion-lifecycle)

## Status Lifecycle

> 📋 Status rules: see [SHARED_SECTIONS.md](SHARED_SECTIONS.md#status-lifecycle)

---
