## Metadata

| Field | Value |
|---|---|
| **Source** | `{reference_description}` |
| **Target** | `{path}` — {brief description} |
| **Priority** | P{0\|1\|2} — {one-line justification} |
| **Dependencies** | {list of contracts or packages this depends on} |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

{2-4 sentences describing what this task is, what changes, and why it matters.}

## Design Reference

{Existing patterns in the repo to follow. Reference specific files, packages, or previous contracts.}

For testing: **Playwright** handles functional E2E (`tests/*.spec.ts`), **Bun Visual Runner** handles AI visual assessment (`src/visual/suites/*.visual.ts`). Do NOT create `*_visual.spec.ts` files or use the old `scripts/*_visual.ts` pattern. See `.pi/skills/testing/SKILL.md` for conventions.

## Architecture Directives

{Use domain-level names and logical paths. Let Pi decide exact file placement based on its aikami-conventions skill.}

## State & Data Models

{Describe the data shape conceptually. STRICTLY FORBIDDEN to write framework boilerplate (Svelte components, context providers, Firebase boilerplate, Dockerfiles, Tauri config). Provide conceptual TypeScript interfaces, JSON shapes, or ECS component structures only. Indent code 4 spaces. NO backticks.}

## Scope Boundaries

- **In Scope:** {Bullet list of exactly what this contract covers}
- **Out of Scope:** {Bullet list of what NOT to touch. Use this to protect unrelated systems.}

## Acceptance Criteria

### AC-1: {Scenario Name}
**Given** {precondition — what state the system is in}
**When** {action — what happens}
**Then** {expected outcome — what should be true}

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
