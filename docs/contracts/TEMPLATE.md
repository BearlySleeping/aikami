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

{Existing patterns in the repo to follow.}

## Architecture Directives

{Use domain-level names, let Pi decide exact file placement, but general implementation paths are allowed.}

## State & Data Models

{Describe the data shape conceptually. If code is needed, indent 4 spaces. NO backticks.}

## Acceptance Criteria

### AC-1: {Scenario Name}
**Given** {precondition — what state the system is in}
**When** {action — what happens}
**Then** {expected outcome — what should be true}

**Test Hooks**:
- Unit: {what to unit test}
- Integration: {what integration test to run}
- CI: {what CI check should pass}

**Watch Points**:
- {edge case or gotcha specific to this AC}

## Implementation Notes

1. **Files to create**: {list}
2. **Files to modify**: {list}
3. **Files to delete**: {list}
4. **Order of operations**: {sequence}

## Edge Cases & Gotchas

- **{Scenario}**: {what to watch for and how to handle it}
