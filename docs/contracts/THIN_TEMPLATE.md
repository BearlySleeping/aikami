---
id: {FEATURE_CODE}
title: "{TITLE}"
source: "{source}"
contract_type: thin
status: draft
github:
  issue_number: null
  issue_url: null
  project_item_id: null
  pr_url: null
created_at: "{created_at}"
---

# Contract {FEATURE_CODE}: {TITLE}

## Metadata

| Field | Value |
|---|---|
| **Source** | `{reference_description}` |
| **Target** | `{path}` — {brief description} |
| **Type** | thin |
| **Priority** | P{0|1|2|3} — {one-line justification} |
| **Dependencies** | {list of contracts or packages this depends on, or "None"} |
| **Status** | draft |
| **Promotion** | `sandbox` \| `integrated` \| `release_verified` \| — |
| **Docs Impact** | {user-facing → page in `apps/frontend/docs/src/content/docs/` \| internal → none} |
| **Contract version** | 2.0.0 |

## Problem & Baseline Evidence

- **Current behavior**: {what is broken or missing today — be concrete}
- **Reproduction**: {steps to reproduce the issue or observe the gap}
- **Existing implementation to reuse**: {paths to code that already partially solves this}
- **Known gaps**: {what the existing code does NOT handle}
- **Baseline tests**: {existing tests that cover related areas — run them before starting}

## User Outcome

After this contract, a {player|creator|developer} can ...

## Scope Boundaries

- **In Scope:** {Bullet list of exactly what this contract covers}
- **Out of Scope:** {Bullet list of what NOT to touch. Use this to protect unrelated systems.}

## Acceptance Criteria

### AC-1: {Scenario Name}
**Given** {precondition — what state the system is in}
**When** {action — what happens}
**Then** {expected outcome — what should be true}

**Verification**: {command or manual check that proves this AC is met}

### AC-2: {Scenario Name}
**Given** {precondition — what state the system is in}
**When** {action — what happens}
**Then** {expected outcome — what should be true}

**Verification**: {command or manual check that proves this AC is met}

## Edge Cases & Gotchas (optional)

- **{Scenario}**: {what to watch for and how to handle it}

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
