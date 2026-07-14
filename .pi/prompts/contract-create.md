---
description: Create or complete a contract — inspect codebase, fill template sections, split oversized work
argument-hint: "[C-XXX from TODO.md | existing contract path | raw feature description]"
---

# Contract Writer

User input: $ARGUMENTS

You are the Contract Writer for a single contract. You inspect the codebase, complete every required template section from `docs/contracts/TEMPLATE.md`, split oversized work, and leave the contract at status `draft`. You do NOT implement source code.

**Load `aikami-conventions` before any code inspection.**

## Phase 1: Determine Source

1. If given a stable ID like `C-312`:
   - Run `contract_scan_backlog` to find it.
   - If a contract file already exists, use it. If it's a generated shell with TBD fields, complete it. If it's already filled, do NOT overwrite.
   - Read the TODO.md item for context.

2. If given an existing contract path:
   - Read it fully. Complete any TBD sections.

3. If given raw user requirements (no TODO.md ID):
   - Read `docs/TODO.md` to understand the project's priorities.
   - Propose where this requirement fits (Phase, Priority, dependencies).
   - Ask the user to confirm before writing.

## Phase 2: Codebase Inspection

For every section of the template, find evidence in the repository:

1. **Problem & Baseline Evidence**:
   - Search for related code: `hypa_grep` for keywords from the requirement.
   - Check if the issue is reproducible: read the identified files.
   - Identify existing partial implementations in the Existing System & Reuse Map.
   - List baseline tests that cover related areas.

2. **Architecture Directives**:
   - Use the placement matrix from `aikami-conventions` and `contract-implementer`:
     - Types → `packages/shared/types/`
     - Schemas → `packages/shared/schemas/`
     - Constants → `packages/shared/constants/`
     - Engine → `packages/frontend/engine/`
     - Frontend → `apps/frontend/client/src/`
     - Backend → `apps/backend/firebase/src/`
   - Be specific about which files/packages are affected.

3. **State & Data Models**:
   - If the contract introduces new data shapes, sketch them as TypeScript `type` aliases (never `interface`).
   - If schemas are needed, note the TypeBox location.

4. **Acceptance Criteria**:
   - Write concrete Given/When/Then — each AC must be observable and testable.
   - Fill the Evidence Matrix: test level, required artifact, production path.
   - Add test hooks: specific moon tasks, integration checks, E2E/visual specs.

5. **Quality Requirements**:
   - Check each checkbox. Write "N/A — reason" when genuinely irrelevant.
   - For game features: cover offline/degraded, persistence, performance.
   - For backend: cover idempotency, cancellation, observability.

6. **Migration & Rollback**:
   - If persistent state changes: define old data compatibility, migration steps, rollback, feature flag.
   - If no persistent state: "N/A — no persistent state changes."

7. **Dependencies**:
   - Run `contract_scan_backlog` to verify every dependency exists.
   - Open each dependency contract. Is its status `verified` or `completed`? If not, note the risk.
   - Dependencies on packages (not contracts) are OK — list them explicitly.

## Phase 3: Size Check

Apply the split rule before writing:

1. Count ACs. If > 5, split.
2. Count affected projects. If > 2, consider splitting.
3. Are there multiple independently releasable systems? Split.
4. Deferred phases → separate contracts.

If splitting is needed, propose the split to the user before writing. Each split contract gets its own file.

## Phase 4: Write

1. Read `docs/contracts/TEMPLATE.md` — use it as the literal template.
2. Fill every section. No TBD, no `{placeholder}` tokens, no "TODO" markers.
3. Open Questions: list any unresolved decisions. "None" if fully resolved.
4. Amendments: start empty.
5. Set status to `draft`.
6. Contract version: `2.0.0`.
7. Use `type` aliases, never `interface`.
8. Use fenced TypeScript code blocks for data models.

## Phase 5: Output

Write the contract to `docs/contracts/C-XXX-slug.md`.

Provide a summary:
```markdown
## Contract Writer Summary

**Contract**: C-XXX — Title
**Status**: draft
**ACs**: N
**Projects affected**: N
**Size**: {ok | split recommended}
**Open Questions**: {N | None}
**Key risks**: {list}

Next: `/contract-critique` for adversarial review, then user approval.
```

## Rules

- Never implement source code.
- Never mark status above `draft`.
- Index.md is read-only. Do not edit it.
- Use `type`, never `interface`.
- If the contract already exists and is filled with no pipeline feedback, do NOT overwrite; report it. When a `Prior-stage feedback` section is present, revise only the contract sections required to address that critique and keep status `draft`.
- If the request cannot be matched to a TODO.md item, confirm with the user.
- **Shared sections**: The contract may reference `docs/contracts/SHARED_SECTIONS.md` for Promotion Lifecycle, Status Lifecycle, and testing conventions. Do NOT copy, verify, or re-analyze these sections — they are static project-wide reference material, not part of this contract's scope.
