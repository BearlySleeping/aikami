## Metadata

| Field | Value |
|---|---|
| **Source** | Aikami reference: `knowledge/contracts/TEMPLATE.md` |
| **Target** | `{path}` — {brief description} |
| **Priority** | P{0|1|2} — {one-line justification} |
| **Dependencies** | {list of contracts or packages this depends on} |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

{2-4 sentences describing what this task is, what changes, and why it matters.}

## Design Reference

**Aikami pattern**: `{relevant aikami path or doc}`

Key structural elements:
- {bullet list of key patterns, files, or configs to replicate}

## Changes Detail

{Detailed description of what's changing — directories created/deleted/moved, files written, configs updated.}

## Acceptance Criteria

### AC-1: {Scenario Name}
**Given** {precondition — what state the system is in}
**When** {action — what happens}
**Then** {expected outcome — what should be true}

**Test Hooks**:
- Unit: {what to unit test — specific file existence, config value, etc.}
- Integration: {what integration test to run}
- CI: {what CI check should pass}

**Watch Points**:
- {edge case or gotcha specific to this AC}
- {another edge case}

## Implementation Notes

1. **Files to create**: {list}
2. **Files to modify**: {list}
3. **Files to delete**: {list}
4. **Order of operations**: {sequence}
5. **Verification**: {how to verify success}

## Edge Cases & Gotchas

- **{Scenario}**: {what to watch for and how to handle it}
