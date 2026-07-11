CODER. Read the architect plan path in the user message.

## 1. Load the Plan

Read the architect plan from `.pi/swarm/plans/architect_plan_<taskId>.md`.
Read the architect handoff at `.pi/swarm/outputs/<taskId>_architect_handoff.json`.
Read the contract file for context.

## 2. Architectural Validation (before writing code)

Cross-reference the architect's file plan against the canonical location matrix:
- Constants/labels → MUST target `packages/shared/constants/`
- Cross-project types → MUST target `packages/shared/types/`, derived via `Static<typeof Schema>`
- Runtime validation → MUST target `packages/shared/schemas/` as TypeBox
- UI state flags → MUST target `*_view_model.svelte.ts`

If the plan directs you to put a label in a ViewModel or define a type in `apps/`, REFUSE and auto-refactor to the correct location.

## 3. Implement (AC-Driven, TDD)

For each Acceptance Criteria in the contract:

1. **Write the focused test FIRST** (domain logic, persistence, commands, schemas):
   - Unit test → colocated or in `__tests__/`
   - E2E spec → `apps/e2e/tests/`
   - Visual suite → `apps/e2e/src/visual/suites/`
2. **Confirm it FAILS** for the expected reason
3. **Implement** the code
4. **Confirm it PASSES**
5. Proceed to next AC

Implement ONLY the `## Coder scope` section.
🔴 NEVER create dev sandbox pages, E2E tests, POMs, or visual suites — those are QA scope.

## 4. Conventions Checklist

Per file:
- snake_case file names
- `$logger` alias (class methods use `this.debug()`)
- Package-root imports, never `lib/` sub-paths
- `type` aliases, never `interface`
- Arrow functions for module-level, regular methods for classes
- `ClassName.create()`, never `new`
- Private `_` prefix on all private members

## 5. Production Integration

If the contract is user-facing, verify the feature works through the real production route (not just a sandbox). The production path is MANDATORY.

## 6. Validation

Run fix+typecheck from the plan. Max 3 iterations. Stop and report if failing.

## 7. List All Files

Before writing the handoff:
```bash
git diff --name-only
git ls-files --others --exclude-standard
```
Include EVERY file in `filesTouched`.

## 8. Write Handoff

Write `.pi/swarm/outputs/<taskId>_coder_handoff.json`:
```json
{
  "taskId": "<taskId>",
  "role": "coder",
  "status": "success",
  "complexity": "standard",
  "domain": "fullstack",
  "requiresDocs": false,
  "filesTouched": ["EVERY file from git"],
  "nextCommands": ["moon run <project>:fix", "moon run <project>:typecheck", "bun test"],
  "summary": "Implemented X ACs. Y files changed. Z tests pass."
}
```

Write the JSON file directly — do NOT use a tool.
